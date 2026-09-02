import { createHash } from "node:crypto";
import type { ApplicationDatabase, Transaction } from "./database.js";
import {
  rebuildRegionScopes,
  regionScopesForEvents,
} from "./region-scope-aggregate.js";

export interface StoredMqttEvent {
  id: number;
  topic: string;
  iata: string | null;
  observer_id: number | null;
  subtopic: string | null;
  subtopic_root: string | null;
  payload_blob: Buffer;
  payload_text: string | null;
  payload_sha256: string;
  qos: number;
  retain: boolean;
  dup: boolean;
  received_at_ms: number;
  payload_format: string;
  parse_status: string;
  processing_status: string;
  parser_version: string;
}

export interface MqttReceiptInput {
  topic: string;
  payload: Buffer;
  qos: number;
  retain: boolean;
  dup: boolean;
  receivedAtMs: number;
  collectorInstanceId: string;
  parserName: string;
  parserVersion: string;
}

export interface ProcessingErrorInput {
  mqttEventId: number;
  packetId?: number;
  stage: string;
  code: string;
  message: string;
  processorName: string;
  processorVersion: string;
  receivedAtMs: number;
}

export interface ReprocessMqttEventFilter {
  from?: number;
  to?: number;
  observerPublicKey?: string;
  subtopic?: string;
  processingStatus?: string;
  parserVersion?: string;
  failedOnly?: boolean;
  limit?: number;
  cursor?: { receivedAtMs: number; id: number };
}

export interface ReprocessPacketFilter {
  from?: number;
  to?: number;
  observerPublicKey?: string;
  decodeStatus?: string;
  decoderVersion?: string;
  failedOnly?: boolean;
  limit?: number;
}

function safePayloadText(payload: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    return null;
  }
}

function asNumber(value: unknown): number {
  return Number(value);
}

function placeholders(count: number, start = 1): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(
    ",",
  );
}

export class MqttEventRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  async insertReceived(input: MqttReceiptInput): Promise<number> {
    const payloadText = safePayloadText(input.payload);
    const payloadSha256 = createHash("sha256")
      .update(input.payload)
      .digest("hex");
    const row = await this.database.get<{ id: number }>(
      `INSERT INTO mqtt_events(
         topic, payload_blob, payload_text, payload_sha256, qos, retain, dup,
         received_at_ms, payload_format, parse_status, processing_status,
         parser_name, parser_version, collector_instance_id, created_at_ms,
         updated_at_ms
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 'pending', $10, $11, $12, $13, $14)
       RETURNING id`,
      input.topic,
      input.payload,
      payloadText,
      payloadSha256,
      input.qos,
      input.retain,
      input.dup,
      input.receivedAtMs,
      payloadText === null ? "binary" : "utf8",
      input.parserName,
      input.parserVersion,
      input.collectorInstanceId,
      input.receivedAtMs,
      input.receivedAtMs,
    );
    if (!row) throw new Error("mqtt_events insert returned no id");
    return asNumber(row.id);
  }

  async getById(id: number): Promise<StoredMqttEvent | undefined> {
    return this.database.get<StoredMqttEvent>(
      "SELECT * FROM mqtt_events WHERE id = $1",
      id,
    );
  }

  claimNext(staleBeforeMs: number): Promise<number | undefined> {
    return this.database.transaction(async (transaction) => {
      const now = Date.now();
      const row = await transaction.get<{ id: number }>(
        `WITH pending_event AS (
           SELECT id FROM mqtt_events
           WHERE processing_status = 'pending'
           ORDER BY id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         ), stale_event AS (
           SELECT id FROM mqtt_events
           WHERE processing_status = 'processing' AND processing_started_at_ms <= $1
           ORDER BY id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         ), next_event AS (
           SELECT id FROM pending_event
           UNION ALL
           SELECT id FROM stale_event
           WHERE NOT EXISTS (SELECT 1 FROM pending_event)
         )
         UPDATE mqtt_events event
         SET processing_status = 'processing', processing_started_at_ms = $2,
             processing_attempts = processing_attempts + 1, updated_at_ms = $2
         FROM next_event
         WHERE event.id = next_event.id
         RETURNING event.id`,
        staleBeforeMs,
        now,
      );
      return row === undefined ? undefined : asNumber(row.id);
    })();
  }

  async recoverInterrupted(staleBeforeMs: number): Promise<number> {
    return this.database.changes(
      `UPDATE mqtt_events
       SET processing_status = 'pending', processing_started_at_ms = NULL,
            updated_at_ms = $1
       WHERE (processing_status = 'failed'
              AND NOT EXISTS (
                SELECT 1 FROM processing_errors pe
                WHERE pe.mqtt_event_id = mqtt_events.id
              ))
           OR (processing_status = 'processing' AND processing_started_at_ms <= $2) RETURNING 1`,
      Date.now(),
      staleBeforeMs,
    );
  }

  async complete(
    id: number,
    status: "processed" | "processed_with_warnings",
    parseStatus: string,
    payloadFormat: string,
  ): Promise<void> {
    await this.database.run(
      `UPDATE mqtt_events SET processing_status = $1, parse_status = $2,
       payload_format = $3, processing_started_at_ms = NULL, updated_at_ms = $4
       WHERE id = $5`,
      status,
      parseStatus,
      payloadFormat,
      Date.now(),
      id,
    );
  }

  async fail(id: number): Promise<void> {
    await this.database.run(
      `UPDATE mqtt_events SET processing_status = 'failed',
       processing_started_at_ms = NULL, updated_at_ms = $1 WHERE id = $2`,
      Date.now(),
      id,
    );
  }

  async requeue(filter: ReprocessMqttEventFilter): Promise<number> {
    const clauses: string[] = ["1 = 1"];
    const parameters: unknown[] = [];
    if (filter.from !== undefined) {
      clauses.push(`e.received_at_ms >= $${parameters.length + 1}`);
      parameters.push(filter.from);
    }
    if (filter.to !== undefined) {
      clauses.push(`e.received_at_ms <= $${parameters.length + 1}`);
      parameters.push(filter.to);
    }
    if (filter.observerPublicKey) {
      clauses.push(`o.public_key = $${parameters.length + 1}`);
      parameters.push(filter.observerPublicKey.toUpperCase());
    }
    if (filter.subtopic) {
      clauses.push(`e.subtopic = $${parameters.length + 1}`);
      parameters.push(filter.subtopic);
    }
    if (filter.processingStatus) {
      clauses.push(`e.processing_status = $${parameters.length + 1}`);
      parameters.push(filter.processingStatus);
    }
    if (filter.parserVersion) {
      clauses.push(`e.parser_version = $${parameters.length + 1}`);
      parameters.push(filter.parserVersion);
    }
    if (filter.failedOnly) {
      clauses.push("e.processing_status = 'failed'");
    }
    if (filter.cursor) {
      clauses.push(
        `(e.received_at_ms > $${parameters.length + 1} OR (e.received_at_ms = $${parameters.length + 2} AND e.id > $${parameters.length + 3}))`,
      );
      parameters.push(
        filter.cursor.receivedAtMs,
        filter.cursor.receivedAtMs,
        filter.cursor.id,
      );
    }
    const limit = Math.max(1, Math.min(filter.limit ?? 1_000, 10_000));
    const rows = await this.database.all<{ id: number }>(
      `SELECT e.id FROM mqtt_events e
       LEFT JOIN observers o ON o.id = e.observer_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY e.received_at_ms, e.id LIMIT $${parameters.length + 1}`,
      ...parameters,
      limit,
    );
    if (rows.length === 0) return 0;
    return this.database.changes(
      `UPDATE mqtt_events SET processing_status = 'pending',
       processing_started_at_ms = NULL, updated_at_ms = $1
       WHERE id IN (${placeholders(rows.length, 2)}) RETURNING 1`,
      Date.now(),
      ...rows.map((row) => row.id),
    );
  }

  async pendingCount(): Promise<number> {
    const row = await this.database.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM mqtt_events
       WHERE processing_status IN ('pending', 'processing', 'failed')`,
    );
    return Number(row?.count ?? 0);
  }
}

export class ObserverRepository {
  async resolve(
    transaction: Transaction,
    publicKey: string,
    iata: string,
    seenAtMs: number,
    eventId: number,
  ): Promise<number> {
    const row = await transaction.get(
      `INSERT INTO observers(
         public_key, first_seen_at_ms, last_seen_at_ms, latest_iata,
         latest_iata_event_id, created_at_ms, updated_at_ms
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(public_key) DO UPDATE SET
          last_seen_at_ms = GREATEST(observers.last_seen_at_ms, excluded.last_seen_at_ms),
         latest_iata = CASE
           WHEN excluded.last_seen_at_ms > observers.last_seen_at_ms
             OR (excluded.last_seen_at_ms = observers.last_seen_at_ms
                 AND COALESCE(excluded.latest_iata_event_id, 0) > COALESCE(observers.latest_iata_event_id, 0))
             THEN excluded.latest_iata
           ELSE observers.latest_iata
         END,
         latest_iata_event_id = CASE
           WHEN excluded.last_seen_at_ms > observers.last_seen_at_ms
             OR (excluded.last_seen_at_ms = observers.last_seen_at_ms
                 AND COALESCE(excluded.latest_iata_event_id, 0) > COALESCE(observers.latest_iata_event_id, 0))
             THEN excluded.latest_iata_event_id
           ELSE observers.latest_iata_event_id
         END,
         updated_at_ms = excluded.updated_at_ms
       RETURNING id`,
      publicKey,
      seenAtMs,
      seenAtMs,
      iata,
      eventId,
      seenAtMs,
      seenAtMs,
    );
    if (row?.id === undefined)
      throw new Error("observer upsert returned no id");

    return asNumber(row.id);
  }

  async incrementIata(
    transaction: Transaction,
    observerId: number,
    iata: string,
    receivedAtMs: number,
  ): Promise<void> {
    await transaction.run(
      `INSERT INTO observer_iata_history(
         observer_id, iata, first_seen_at_ms, last_seen_at_ms,
         observation_count
        ) VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT(observer_id, iata) DO UPDATE SET
          first_seen_at_ms = LEAST(observer_iata_history.first_seen_at_ms, excluded.first_seen_at_ms),
          last_seen_at_ms = GREATEST(observer_iata_history.last_seen_at_ms, excluded.last_seen_at_ms),
         observation_count = observer_iata_history.observation_count + 1`,
      observerId,
      iata,
      receivedAtMs,
      receivedAtMs,
    );
  }
}

/**
 * Rebuilds every advert-derived node aggregate (prefix candidates, trusted
 * canonical identity including owner, boundaries) for the given nodes from
 * retained adverts. Used by ingest, reprocess, and retention so all three
 * paths share one deterministic implementation.
 */
export async function rebuildAdvertDerivedNodeState(
  transaction: Transaction,
  rawNodeIds: number[],
  now: number,
): Promise<void> {
  const nodeIds = [...new Set(rawNodeIds)];
  if (nodeIds.length === 0) return;
  const nodePlaceholders = nodeIds.map((_, index) => `$${index + 1}`).join(",");
  await transaction.run(
    `DELETE FROM node_prefix_candidates WHERE node_id IN (${nodePlaceholders})`,
    ...nodeIds,
  );
  for (const prefixLength of [1, 2, 3]) {
    await transaction.run(
      `INSERT INTO node_prefix_candidates(
         prefix_hex, prefix_length_bytes, node_id, first_seen_at_ms,
         last_seen_at_ms, evidence_count, confidence
       )
       SELECT substr(n.public_key, 1, $1), $2, n.id,
              min(a.first_observed_at_ms), max(a.first_observed_at_ms),
               count(*), CASE WHEN bool_or(a.verified) THEN 1.0 ELSE 0.5 END
       FROM nodes n JOIN node_adverts a ON a.node_id = n.id
        WHERE n.id IN (${nodeIds.map((_, index) => `$${index + 3}`).join(",")})
        GROUP BY n.id, substr(n.public_key, 1, $${nodeIds.length + 3})`,
      prefixLength * 2,
      prefixLength,
      ...nodeIds,
      prefixLength * 2,
    );
  }
  await transaction.run(
    `UPDATE nodes SET
       first_seen_at_ms = coalesce((
         SELECT min(seen_at_ms) FROM (
           SELECT received_at_ms AS seen_at_ms FROM node_sightings s WHERE s.node_id = nodes.id
           UNION ALL
           SELECT first_observed_at_ms AS seen_at_ms FROM node_adverts a WHERE a.node_id = nodes.id
         )
       ), first_seen_at_ms),
       last_seen_at_ms = coalesce((
         SELECT max(seen_at_ms) FROM (
           SELECT received_at_ms AS seen_at_ms FROM node_sightings s WHERE s.node_id = nodes.id
           UNION ALL
           SELECT first_observed_at_ms AS seen_at_ms FROM node_adverts a WHERE a.node_id = nodes.id
         )
       ), last_seen_at_ms),
       latest_name = (
          SELECT name FROM node_adverts a WHERE a.node_id = nodes.id AND a.verified
         ORDER BY first_observed_at_ms DESC, id DESC LIMIT 1
       ),
       latest_role = (
          SELECT role FROM node_adverts a WHERE a.node_id = nodes.id AND a.verified
         ORDER BY first_observed_at_ms DESC, id DESC LIMIT 1
       ),
       latest_latitude = (
          SELECT latitude FROM node_adverts a WHERE a.node_id = nodes.id AND a.verified
         ORDER BY first_observed_at_ms DESC, id DESC LIMIT 1
       ),
       latest_longitude = (
          SELECT longitude FROM node_adverts a WHERE a.node_id = nodes.id AND a.verified
         ORDER BY first_observed_at_ms DESC, id DESC LIMIT 1
       ),
       latest_advert_timestamp = (
          SELECT advert_timestamp FROM node_adverts a WHERE a.node_id = nodes.id AND a.verified
         ORDER BY first_observed_at_ms DESC, id DESC LIMIT 1
       ),
       owner_public_key = (
          SELECT owner_public_key FROM node_adverts a WHERE a.node_id = nodes.id AND a.verified
         ORDER BY first_observed_at_ms DESC, id DESC LIMIT 1
       ),
         updated_at_ms = $1
     WHERE id IN (${nodeIds.map((_, index) => `$${index + 2}`).join(",")})`,
    now,
    ...nodeIds,
  );
  await transaction.run(
    `DELETE FROM nodes WHERE id IN (${nodePlaceholders})
     AND NOT EXISTS (SELECT 1 FROM node_adverts a WHERE a.node_id = nodes.id)
     AND NOT EXISTS (SELECT 1 FROM node_sightings s WHERE s.node_id = nodes.id)
     AND NOT EXISTS (SELECT 1 FROM telemetry_events t WHERE t.node_id = nodes.id)
     AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.sender_node_id = nodes.id OR m.destination_node_id = nodes.id)
     AND NOT EXISTS (SELECT 1 FROM trace_events tr WHERE tr.source_node_id = nodes.id)`,
    ...nodeIds,
  );
}

export class ProcessingRepository {
  async resetDerived(transaction: Transaction, mqttEventId: number) {
    // Capture everything this event owns BEFORE any delete so derived state
    // can be rebuilt deterministically afterwards.
    const observationPackets = await transaction.all<{ packet_id: number }>(
      "SELECT DISTINCT packet_id FROM packet_observations WHERE mqtt_event_id = $1",
      mqttEventId,
    );
    const packetIds = [
      ...new Set(observationPackets.map((row) => asNumber(row.packet_id))),
    ];
    let advertNodeIds: number[] = [];
    if (packetIds.length > 0) {
      const rows = await transaction.all<{ node_id: number }>(
        `SELECT DISTINCT node_id FROM node_adverts
         WHERE packet_id IN (${packetIds.map((_, index) => `$${index + 1}`).join(",")})`,
        ...packetIds,
      );
      advertNodeIds = [...new Set(rows.map((row) => asNumber(row.node_id)))];
    }
    const affectedRegionScopes = await regionScopesForEvents(transaction, [
      mqttEventId,
    ]);
    await transaction.run(
      "DELETE FROM observer_status_events WHERE mqtt_event_id = $1",
      mqttEventId,
    );
    await transaction.run(
      "DELETE FROM observer_metrics WHERE mqtt_event_id = $1",
      mqttEventId,
    );
    await transaction.run(
      "DELETE FROM observer_radio_history WHERE mqtt_event_id = $1",
      mqttEventId,
    );
    await transaction.run(
      "DELETE FROM neighbor_snapshots WHERE mqtt_event_id = $1",
      mqttEventId,
    );
    // Packet decode reprocessing uses replace semantics: remove ALL
    // packet-owned decoder-derived advert state before the new decode runs.
    if (packetIds.length > 0) {
      await transaction.run(
        `DELETE FROM node_adverts WHERE packet_id IN (${packetIds.map((_, index) => `$${index + 1}`).join(",")})`,
        ...packetIds,
      );
    }
    await transaction.run(
      "DELETE FROM packet_observations WHERE mqtt_event_id = $1",
      mqttEventId,
    );
    await transaction.run(
      "DELETE FROM processing_errors WHERE mqtt_event_id = $1",
      mqttEventId,
    );
    const event = await transaction.get<{
      observer_id: number | null;
      iata: string | null;
    }>("SELECT observer_id, iata FROM mqtt_events WHERE id = $1", mqttEventId);
    if (!event || event.observer_id === null || event.iata === null) {
      await rebuildRegionScopes(transaction, affectedRegionScopes);
      if (advertNodeIds.length > 0)
        await rebuildAdvertDerivedNodeState(
          transaction,
          advertNodeIds,
          Date.now(),
        );
      return;
    }
    const observerId = asNumber(event.observer_id);
    const iata = event.iata;
    await transaction.run(
      `DELETE FROM observer_iata_history WHERE observer_id = $1 AND iata = $2`,
      observerId,
      iata,
    );
    await transaction.run(
      `INSERT INTO observer_iata_history(
         observer_id, iata, first_seen_at_ms, last_seen_at_ms, observation_count
       )
       SELECT observer_id, iata, min(received_at_ms), max(received_at_ms), count(*)
       FROM mqtt_events
        WHERE observer_id = $1 AND iata = $2 AND id != $3
       GROUP BY observer_id, iata`,
      observerId,
      iata,
      mqttEventId,
    );
    await rebuildRegionScopes(transaction, affectedRegionScopes);
    if (advertNodeIds.length > 0)
      await rebuildAdvertDerivedNodeState(
        transaction,
        advertNodeIds,
        Date.now(),
      );
  }

  async error(transaction: Transaction, input: ProcessingErrorInput) {
    await transaction.run(
      `INSERT INTO processing_errors(
         mqtt_event_id, packet_id, stage, error_code, error_message,
         processor_name, processor_version, received_at_ms, created_at_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (mqtt_event_id, stage, error_code, processor_version) DO NOTHING`,
      input.mqttEventId,
      input.packetId ?? null,
      input.stage,
      input.code,
      input.message.slice(0, 2_000),
      input.processorName,
      input.processorVersion,
      input.receivedAtMs,
      Date.now(),
    );
  }
}

export class PacketRepository {
  async upsert(
    transaction: Transaction,
    rawPacket: Buffer,
    receivedAtMs: number,
  ): Promise<{ id: number; sha256: string }> {
    const sha256 = createHash("sha256").update(rawPacket).digest("hex");
    const row = await transaction.get(
      `INSERT INTO packets(
         packet_sha256, raw_packet_blob, raw_packet_hex, packet_length,
         decode_status, first_seen_at_ms, last_seen_at_ms, created_at_ms,
         updated_at_ms
        ) VALUES ($1, $2, $3, $4, 'not_attempted', $5, $6, $7, $8)
       ON CONFLICT(packet_sha256) DO UPDATE SET
          last_seen_at_ms = GREATEST(packets.last_seen_at_ms, excluded.last_seen_at_ms),
         updated_at_ms = excluded.updated_at_ms
       RETURNING id`,
      sha256,
      rawPacket,
      rawPacket.toString("hex").toUpperCase(),
      rawPacket.length,
      receivedAtMs,
      receivedAtMs,
      receivedAtMs,
      receivedAtMs,
    );
    if (row?.id === undefined) throw new Error("packet upsert returned no id");
    return { id: asNumber(row.id), sha256 };
  }

  async updateDecode(
    transaction: Transaction,
    input: {
      id: number;
      packetType?: string;
      packetTypeCode?: number;
      payloadType?: string;
      payloadTypeCode?: number;
      routeType?: string;
      status: string;
      error?: string;
      decoderName: string;
      decoderVersion: string;
      decodedJson?: string;
      decodedAtMs: number;
    },
  ) {
    await transaction.run(
      `UPDATE packets SET packet_type = $1, packet_type_code = $2,
       payload_type = $3, payload_type_code = $4, route_type = $5,
       decode_status = $6, decode_error = $7, decoder_name = $8,
       decoder_version = $9, decoded_at_ms = $10, decoded_json = $11,
       updated_at_ms = $12 WHERE id = $13`,
      input.packetType ?? null,
      input.packetTypeCode ?? null,
      input.payloadType ?? null,
      input.payloadTypeCode ?? null,
      input.routeType ?? null,
      input.status,
      input.error ?? null,
      input.decoderName,
      input.decoderVersion,
      input.decodedAtMs,
      input.decodedJson ?? null,
      input.decodedAtMs,
      input.id,
    );
  }

  async linkLogicalPacket(
    transaction: Transaction,
    input: {
      packetId: number;
      logicalPacketId: string;
      packetType: string | null;
      payloadType: string | null;
      observedAtMs: number;
    },
  ): Promise<number> {
    const row = await transaction.get(
      `INSERT INTO logical_packets(
         logical_packet_id, packet_type, payload_type, first_observed_at_ms,
         last_observed_at_ms, created_at_ms
        ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(logical_packet_id) DO UPDATE SET
          first_observed_at_ms = LEAST(logical_packets.first_observed_at_ms, excluded.first_observed_at_ms),
          last_observed_at_ms = GREATEST(logical_packets.last_observed_at_ms, excluded.last_observed_at_ms)
       RETURNING id`,
      input.logicalPacketId,
      input.packetType,
      input.payloadType,
      input.observedAtMs,
      input.observedAtMs,
      input.observedAtMs,
    );
    if (row?.id === undefined)
      throw new Error("logical packet upsert returned no id");
    await transaction.run(
      `UPDATE packets SET logical_packet_id = $1, updated_at_ms = $2
       WHERE id = $3`,
      row.id,
      input.observedAtMs,
      input.packetId,
    );
    return asNumber(row.id);
  }

  async insertObservation(
    transaction: Transaction,
    input: {
      packetId: number;
      mqttEventId: number;
      observerId: number;
      iata: string;
      receivedAtMs: number;
      reportedAtMs?: number;
      rssi?: number;
      snr?: number;
      score?: number;
      direction?: string;
      mqttDuplicate: boolean;
    },
  ): Promise<number> {
    const previous = await transaction.get(
      `SELECT received_at_ms FROM packet_observations
        WHERE packet_id = $1 AND observer_id = $2
       ORDER BY received_at_ms DESC, id DESC LIMIT 1`,
      input.packetId,
      input.observerId,
    );
    const rfRetransmission =
      !input.mqttDuplicate &&
      previous?.received_at_ms !== undefined &&
      input.receivedAtMs - Number(previous.received_at_ms) <= 300_000;
    const row = await transaction.get(
      `INSERT INTO packet_observations(
         packet_id, mqtt_event_id, observer_id, iata, received_at_ms,
         reported_at_ms, rssi, snr, score, direction,
         suspected_mqtt_duplicate, suspected_rf_retransmission, created_at_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      input.packetId,
      input.mqttEventId,
      input.observerId,
      input.iata,
      input.receivedAtMs,
      input.reportedAtMs ?? null,
      input.rssi ?? null,
      input.snr ?? null,
      input.score ?? null,
      input.direction ?? null,
      input.mqttDuplicate,
      rfRetransmission,
      input.receivedAtMs,
    );
    if (row?.id === undefined) {
      throw new Error("packet observation insert returned no id");
    }
    return asNumber(row.id);
  }
}

export class RetentionRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  private placeholders(ids: number[], start = 1): string {
    return placeholders(ids.length, start);
  }

  private uniqueIds(rows: Array<{ id: number }>): number[] {
    return [...new Set(rows.map((row) => asNumber(row.id)))];
  }

  private async packetIdsForEvents(
    transaction: Transaction,
    eventIds: number[],
  ): Promise<number[]> {
    if (eventIds.length === 0) return [];
    const rows = await transaction.all<{ id: number }>(
      `SELECT DISTINCT packet_id AS id FROM packet_observations
       WHERE mqtt_event_id IN (${this.placeholders(eventIds)})`,
      ...eventIds,
    );
    return this.uniqueIds(rows);
  }

  private async nodeIdsForPackets(
    transaction: Transaction,
    packetIds: number[],
  ): Promise<number[]> {
    if (packetIds.length === 0) return [];
    const packetPlaceholders = this.placeholders(packetIds);
    const rows = await transaction.all<{ id: number }>(
      `SELECT node_id AS id FROM node_adverts WHERE packet_id IN (${packetPlaceholders})
        UNION
        SELECT node_id AS id FROM node_sightings WHERE packet_id IN (${this.placeholders(packetIds, packetIds.length + 1)})
        UNION
        SELECT source_node_id AS id FROM trace_events
          WHERE packet_id IN (${this.placeholders(packetIds, packetIds.length * 2 + 1)}) AND source_node_id IS NOT NULL
        UNION
        SELECT sender_node_id AS id FROM messages
          WHERE packet_id IN (${this.placeholders(packetIds, packetIds.length * 3 + 1)}) AND sender_node_id IS NOT NULL
        UNION
        SELECT destination_node_id AS id FROM messages
          WHERE packet_id IN (${this.placeholders(packetIds, packetIds.length * 4 + 1)}) AND destination_node_id IS NOT NULL
        UNION
        SELECT node_id AS id FROM telemetry_events
          WHERE packet_id IN (${this.placeholders(packetIds, packetIds.length * 5 + 1)}) AND node_id IS NOT NULL`,
      ...packetIds,
      ...packetIds,
      ...packetIds,
      ...packetIds,
      ...packetIds,
      ...packetIds,
    );
    return this.uniqueIds(rows);
  }

  private async refreshPackets(
    transaction: Transaction,
    packetIds: number[],
    now: number,
  ): Promise<number> {
    if (packetIds.length === 0) return 0;
    const packetPlaceholders = this.placeholders(packetIds);
    const logicalRows = await transaction.all<{
      logical_packet_id: number | null;
    }>(
      `SELECT DISTINCT logical_packet_id FROM packets
        WHERE id IN (${packetPlaceholders}) AND logical_packet_id IS NOT NULL`,
      ...packetIds,
    );
    const logicalIds = logicalRows
      .map((row) => row.logical_packet_id)
      .filter((id): id is number => id !== null);
    await transaction.run(
      `UPDATE packets SET
         first_seen_at_ms = (SELECT min(received_at_ms) FROM packet_observations WHERE packet_id = packets.id),
         last_seen_at_ms = (SELECT max(received_at_ms) FROM packet_observations WHERE packet_id = packets.id),
         updated_at_ms = $1
       WHERE id IN (${this.placeholders(packetIds, 2)})
         AND EXISTS (SELECT 1 FROM packet_observations WHERE packet_id = packets.id)`,
      now,
      ...packetIds,
    );
    const deletedPackets = await transaction.changes(
      `DELETE FROM packets WHERE id IN (${packetPlaceholders})
       AND NOT EXISTS (
         SELECT 1 FROM packet_observations po WHERE po.packet_id = packets.id
       ) RETURNING 1`,
      ...packetIds,
    );
    if (logicalIds.length > 0) {
      const logicalPlaceholders = this.placeholders(logicalIds);
      await transaction.run(
        `UPDATE logical_packets SET
           first_observed_at_ms = (
             SELECT min(po.received_at_ms) FROM packet_observations po
             JOIN packets p ON p.id = po.packet_id
             WHERE p.logical_packet_id = logical_packets.id
           ),
           last_observed_at_ms = (
             SELECT max(po.received_at_ms) FROM packet_observations po
             JOIN packets p ON p.id = po.packet_id
             WHERE p.logical_packet_id = logical_packets.id
           )
         WHERE id IN (${logicalPlaceholders})
           AND EXISTS (
             SELECT 1 FROM packets p JOIN packet_observations po
               ON po.packet_id = p.id
             WHERE p.logical_packet_id = logical_packets.id
           )`,
        ...logicalIds,
      );
      await transaction.run(
        `DELETE FROM logical_packets WHERE id IN (${logicalPlaceholders})
         AND NOT EXISTS (
           SELECT 1 FROM packets p WHERE p.logical_packet_id = logical_packets.id
         )`,
        ...logicalIds,
      );
    }
    return deletedPackets;
  }

  private async refreshObservers(
    transaction: Transaction,
    deletedEvents: Array<{
      id: number;
      observer_id: number | null;
      iata: string | null;
      received_at_ms: number;
    }>,
    now: number,
  ): Promise<number> {
    const deleted = deletedEvents.filter(
      (row) => row.observer_id !== null && row.iata !== null,
    );
    if (deleted.length === 0) return 0;
    const observerIds = [
      ...new Set(deleted.map((row) => asNumber(row.observer_id))),
    ];
    const observerPlaceholders = this.placeholders(observerIds);
    // Recompute each affected (observer, iata) group exactly once from the
    // remaining events; per-row decrementing would double-decrement groups
    // with several deleted rows in one batch.
    const affectedGroups = new Map<
      string,
      { observerId: number; iata: string }
    >();
    for (const row of deleted) {
      const observerId = asNumber(row.observer_id);
      affectedGroups.set(`${observerId}:${row.iata}`, {
        observerId,
        iata: row.iata as string,
      });
    }
    for (const group of affectedGroups.values()) {
      const boundary = await transaction.get(
        `SELECT min(received_at_ms) AS first_seen_at_ms,
                max(received_at_ms) AS last_seen_at_ms,
                count(*) AS observation_count
         FROM mqtt_events WHERE observer_id = $1 AND iata = $2`,
        group.observerId,
        group.iata,
      );
      if (!boundary || Number(boundary.observation_count) === 0) {
        await transaction.run(
          `DELETE FROM observer_iata_history WHERE observer_id = $1 AND iata = $2`,
          group.observerId,
          group.iata,
        );
        continue;
      }
      await transaction.run(
        `INSERT INTO observer_iata_history(
           observer_id, iata, first_seen_at_ms, last_seen_at_ms, observation_count
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(observer_id, iata) DO UPDATE SET
            first_seen_at_ms = excluded.first_seen_at_ms,
            last_seen_at_ms = excluded.last_seen_at_ms,
           observation_count = excluded.observation_count`,
        group.observerId,
        group.iata,
        boundary.first_seen_at_ms,
        boundary.last_seen_at_ms,
        Number(boundary.observation_count),
      );
    }
    for (const observerId of observerIds) {
      const current = await transaction.get(
        `SELECT first_seen_at_ms, last_seen_at_ms FROM observers WHERE id = $1`,
        observerId,
      );
      if (!current) continue;
      const deletedFor = deleted.filter(
        (row) => asNumber(row.observer_id) === observerId,
      );
      const firstTouched = deletedFor.some(
        (row) => current.first_seen_at_ms >= row.received_at_ms,
      );
      const lastTouched = deletedFor.some(
        (row) => current.last_seen_at_ms <= row.received_at_ms,
      );
      const stillExists = await transaction.get(
        `SELECT 1 AS present FROM mqtt_events WHERE observer_id = $1 LIMIT 1`,
        observerId,
      );
      if (!stillExists?.present) continue;
      if (!firstTouched && !lastTouched) continue;
      await transaction.run(
        `UPDATE observers SET
           first_seen_at_ms = coalesce(
             (SELECT min(received_at_ms) FROM mqtt_events WHERE observer_id = observers.id),
             first_seen_at_ms
           ),
           last_seen_at_ms = coalesce(
             (SELECT max(received_at_ms) FROM mqtt_events WHERE observer_id = observers.id),
             last_seen_at_ms
           ),
           latest_iata = (
              SELECT iata FROM mqtt_events WHERE observer_id = observers.id
             ORDER BY received_at_ms DESC, id DESC LIMIT 1
           ),
           latest_iata_event_id = (
              SELECT id FROM mqtt_events WHERE observer_id = observers.id
             ORDER BY received_at_ms DESC, id DESC LIMIT 1
           ),
            updated_at_ms = $1
          WHERE id = $2`,
        now,
        observerId,
      );
    }
    return transaction.changes(
      `DELETE FROM observers WHERE id IN (${observerPlaceholders})
       AND NOT EXISTS (SELECT 1 FROM mqtt_events e WHERE e.observer_id = observers.id)
       AND NOT EXISTS (SELECT 1 FROM packet_observations po WHERE po.observer_id = observers.id)
       AND NOT EXISTS (SELECT 1 FROM observer_status_events se WHERE se.observer_id = observers.id)
       AND NOT EXISTS (SELECT 1 FROM neighbor_snapshots ns WHERE ns.observer_id = observers.id)
       AND NOT EXISTS (SELECT 1 FROM node_sightings s WHERE s.observer_id = observers.id) RETURNING 1`,
      ...observerIds,
    );
  }

  private async refreshNodes(
    transaction: Transaction,
    nodeIds: number[],
    now: number,
  ): Promise<number> {
    if (nodeIds.length === 0) return 0;
    await rebuildAdvertDerivedNodeState(transaction, nodeIds, now);
    return nodeIds.length;
  }

  async deleteExpiredEvents(cutoffMs: number, batchSize: number) {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.all<{
        id: number;
        observer_id: number | null;
        iata: string | null;
        received_at_ms: number;
      }>(
        `SELECT id, observer_id, iata, received_at_ms FROM mqtt_events
         WHERE received_at_ms <= $1 AND processing_status != 'processing'
         ORDER BY received_at_ms, id
         FOR UPDATE SKIP LOCKED
         LIMIT $2`,
        cutoffMs,
        batchSize,
      );
      if (rows.length === 0) return 0;
      const eventIds = rows.map((row) => asNumber(row.id));
      const packetIds = await this.packetIdsForEvents(transaction, eventIds);
      const nodeIds = await this.nodeIdsForPackets(transaction, packetIds);
      const affectedRegionScopes = await regionScopesForEvents(
        transaction,
        eventIds,
      );
      await transaction.run(
        `DELETE FROM mqtt_events WHERE id IN (${this.placeholders(eventIds)})`,
        ...eventIds,
      );
      const now = Date.now();
      await this.refreshPackets(transaction, packetIds, now);
      await this.refreshObservers(transaction, rows, now);
      await this.refreshNodes(transaction, nodeIds, now);
      await rebuildRegionScopes(transaction, affectedRegionScopes);
      return rows.length;
    })();
  }

  async deleteOrphans(batchSize: number): Promise<number> {
    return this.database.transaction(async (transaction) => {
      let deleted = 0;
      const packetRows = await transaction.all<{ id: number }>(
        `SELECT p.id FROM packets p
         WHERE NOT EXISTS (
           SELECT 1 FROM packet_observations po WHERE po.packet_id = p.id
          ) ORDER BY p.id FOR UPDATE SKIP LOCKED LIMIT $1`,
        batchSize,
      );
      const packetIds = this.uniqueIds(packetRows);
      const nodeIds = await this.nodeIdsForPackets(transaction, packetIds);
      deleted += await this.refreshPackets(transaction, packetIds, Date.now());
      deleted += await this.refreshNodes(transaction, nodeIds, Date.now());
      deleted += await transaction.changes(
        `DELETE FROM nodes WHERE id IN (
           SELECT n.id FROM nodes n WHERE
             NOT EXISTS (SELECT 1 FROM node_adverts a WHERE a.node_id = n.id) AND
             NOT EXISTS (SELECT 1 FROM node_sightings s WHERE s.node_id = n.id) AND
             NOT EXISTS (SELECT 1 FROM telemetry_events t WHERE t.node_id = n.id) AND
             NOT EXISTS (SELECT 1 FROM messages m WHERE m.sender_node_id = n.id OR m.destination_node_id = n.id) AND
             NOT EXISTS (SELECT 1 FROM trace_events tr WHERE tr.source_node_id = n.id)
            ORDER BY n.id LIMIT $1
         ) RETURNING 1`,
        batchSize,
      );
      deleted += await transaction.changes(
        `DELETE FROM observers WHERE id IN (
           SELECT o.id FROM observers o WHERE
             NOT EXISTS (SELECT 1 FROM mqtt_events e WHERE e.observer_id = o.id) AND
             NOT EXISTS (SELECT 1 FROM packet_observations po WHERE po.observer_id = o.id) AND
             NOT EXISTS (SELECT 1 FROM observer_status_events se WHERE se.observer_id = o.id) AND
             NOT EXISTS (SELECT 1 FROM neighbor_snapshots ns WHERE ns.observer_id = o.id) AND
             NOT EXISTS (SELECT 1 FROM node_sightings s WHERE s.observer_id = o.id)
            ORDER BY o.id LIMIT $1
         ) RETURNING 1`,
        batchSize,
      );
      return deleted;
    })();
  }
}
