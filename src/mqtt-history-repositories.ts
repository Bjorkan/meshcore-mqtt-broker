import { createHash } from "node:crypto";
import type { Transaction } from "@tursodatabase/database";
import type { ApplicationDatabase } from "./database.js";

export interface StoredMqttEvent {
  id: number;
  topic: string;
  region: string | null;
  observer_id: number | null;
  subtopic: string | null;
  subtopic_root: string | null;
  payload_blob: Buffer;
  payload_text: string | null;
  payload_sha256: string;
  qos: number;
  retain: number;
  dup: number;
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
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?, ?, ?, ?)
       RETURNING id`,
      input.topic,
      input.payload,
      payloadText,
      payloadSha256,
      input.qos,
      input.retain ? 1 : 0,
      input.dup ? 1 : 0,
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
      "SELECT * FROM mqtt_events WHERE id = ?",
      id,
    );
  }

  claimNext(staleBeforeMs: number): Promise<number | undefined> {
    const claim = this.database.transaction(async (transaction) => {
      const row = (await transaction.get(
        `SELECT id FROM mqtt_events
         WHERE processing_status = 'pending'
            OR (processing_status = 'processing' AND processing_started_at_ms <= ?)
         ORDER BY id ASC LIMIT 1`,
        staleBeforeMs,
      )) as { id?: number } | undefined;
      if (row?.id === undefined) return undefined;

      const updated = await transaction.run(
        `UPDATE mqtt_events
         SET processing_status = 'processing', processing_started_at_ms = ?,
             processing_attempts = processing_attempts + 1, updated_at_ms = ?
         WHERE id = ? AND (
           processing_status = 'pending'
           OR (processing_status = 'processing' AND processing_started_at_ms <= ?)
         )`,
        Date.now(),
        Date.now(),
        row.id,
        staleBeforeMs,
      );
      return Number(updated.changes) === 1 ? asNumber(row.id) : undefined;
    });
    return claim.immediate();
  }

  async recoverInterrupted(staleBeforeMs: number): Promise<number> {
    const result = await this.database.run(
      `UPDATE mqtt_events
       SET processing_status = 'pending', processing_started_at_ms = NULL,
           updated_at_ms = ?
       WHERE (processing_status = 'failed'
              AND NOT EXISTS (
                SELECT 1 FROM processing_errors pe
                WHERE pe.mqtt_event_id = mqtt_events.id
              ))
          OR (processing_status = 'processing' AND processing_started_at_ms <= ?)`,
      Date.now(),
      staleBeforeMs,
    );
    return Number(result.changes);
  }

  async complete(
    id: number,
    status: "processed" | "processed_with_warnings",
    parseStatus: string,
    payloadFormat: string,
  ): Promise<void> {
    await this.database.run(
      `UPDATE mqtt_events SET processing_status = ?, parse_status = ?,
       payload_format = ?, processing_started_at_ms = NULL, updated_at_ms = ?
       WHERE id = ?`,
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
       processing_started_at_ms = NULL, updated_at_ms = ? WHERE id = ?`,
      Date.now(),
      id,
    );
  }

  async requeue(filter: ReprocessMqttEventFilter): Promise<number> {
    const clauses: string[] = ["1 = 1"];
    const parameters: unknown[] = [];
    if (filter.from !== undefined) {
      clauses.push("e.received_at_ms >= ?");
      parameters.push(filter.from);
    }
    if (filter.to !== undefined) {
      clauses.push("e.received_at_ms <= ?");
      parameters.push(filter.to);
    }
    if (filter.observerPublicKey) {
      clauses.push("o.public_key = ?");
      parameters.push(filter.observerPublicKey.toUpperCase());
    }
    if (filter.subtopic) {
      clauses.push("e.subtopic = ?");
      parameters.push(filter.subtopic);
    }
    if (filter.processingStatus) {
      clauses.push("e.processing_status = ?");
      parameters.push(filter.processingStatus);
    }
    if (filter.parserVersion) {
      clauses.push("e.parser_version = ?");
      parameters.push(filter.parserVersion);
    }
    if (filter.failedOnly) {
      clauses.push("e.processing_status = 'failed'");
    }
    if (filter.cursor) {
      clauses.push(
        "(e.received_at_ms > ? OR (e.received_at_ms = ? AND e.id > ?))",
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
       ORDER BY e.received_at_ms, e.id LIMIT ?`,
      ...parameters,
      limit,
    );
    if (rows.length === 0) return 0;
    const result = await this.database.run(
      `UPDATE mqtt_events SET processing_status = 'pending',
       processing_started_at_ms = NULL, updated_at_ms = ?
       WHERE id IN (${rows.map(() => "?").join(",")})`,
      Date.now(),
      ...rows.map((row) => row.id),
    );
    return Number(result.changes);
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
    region: string,
    seenAtMs: number,
  ): Promise<number> {
    const row = (await transaction.get(
      `INSERT INTO observers(
         public_key, first_seen_at_ms, last_seen_at_ms, latest_region,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(public_key) DO UPDATE SET
         last_seen_at_ms = max(observers.last_seen_at_ms, excluded.last_seen_at_ms),
         latest_region = excluded.latest_region,
         updated_at_ms = excluded.updated_at_ms
       RETURNING id`,
      publicKey,
      seenAtMs,
      seenAtMs,
      region,
      seenAtMs,
      seenAtMs,
    )) as { id?: number } | undefined;
    if (row?.id === undefined)
      throw new Error("observer upsert returned no id");

    return asNumber(row.id);
  }

  async incrementRegion(
    transaction: Transaction,
    observerId: number,
    region: string,
    receivedAtMs: number,
  ): Promise<void> {
    await transaction.run(
      `INSERT INTO observer_region_history(
         observer_id, region, first_seen_at_ms, last_seen_at_ms,
         observation_count
       ) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(observer_id, region) DO UPDATE SET
         first_seen_at_ms = min(observer_region_history.first_seen_at_ms, excluded.first_seen_at_ms),
         last_seen_at_ms = max(observer_region_history.last_seen_at_ms, excluded.last_seen_at_ms),
         observation_count = observer_region_history.observation_count + 1`,
      observerId,
      region,
      receivedAtMs,
      receivedAtMs,
    );
  }
}

export class ProcessingRepository {
  async resetDerived(transaction: Transaction, mqttEventId: number) {
    await transaction.run(
      "DELETE FROM observer_status_events WHERE mqtt_event_id = ?",
      mqttEventId,
    );
    await transaction.run(
      "DELETE FROM observer_metrics WHERE mqtt_event_id = ?",
      mqttEventId,
    );
    await transaction.run(
      "DELETE FROM observer_radio_history WHERE mqtt_event_id = ?",
      mqttEventId,
    );
    await transaction.run(
      "DELETE FROM neighbor_snapshots WHERE mqtt_event_id = ?",
      mqttEventId,
    );
    await transaction.run(
      "DELETE FROM packet_observations WHERE mqtt_event_id = ?",
      mqttEventId,
    );
    await transaction.run(
      "DELETE FROM processing_errors WHERE mqtt_event_id = ?",
      mqttEventId,
    );
    const event = (await transaction.get(
      "SELECT observer_id, region FROM mqtt_events WHERE id = ?",
      mqttEventId,
    )) as { observer_id: number | null; region: string | null } | undefined;
    if (!event || event.observer_id === null || event.region === null) return;
    const observerId = asNumber(event.observer_id);
    const region = event.region;
    await transaction.run(
      `DELETE FROM observer_region_history WHERE observer_id = ? AND region = ?`,
      observerId,
      region,
    );
    await transaction.run(
      `INSERT INTO observer_region_history(
         observer_id, region, first_seen_at_ms, last_seen_at_ms, observation_count
       )
       SELECT observer_id, region, min(received_at_ms), max(received_at_ms), count(*)
       FROM mqtt_events
       WHERE observer_id = ? AND region = ? AND id != ?
       GROUP BY observer_id, region`,
      observerId,
      region,
      mqttEventId,
    );
  }

  async error(transaction: Transaction, input: ProcessingErrorInput) {
    await transaction.run(
      `INSERT OR IGNORE INTO processing_errors(
         mqtt_event_id, packet_id, stage, error_code, error_message,
         processor_name, processor_version, received_at_ms, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    const row = (await transaction.get(
      `INSERT INTO packets(
         packet_sha256, raw_packet_blob, raw_packet_hex, packet_length,
         decode_status, first_seen_at_ms, last_seen_at_ms, created_at_ms,
         updated_at_ms
       ) VALUES (?, ?, ?, ?, 'not_attempted', ?, ?, ?, ?)
       ON CONFLICT(packet_sha256) DO UPDATE SET
         last_seen_at_ms = max(packets.last_seen_at_ms, excluded.last_seen_at_ms),
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
    )) as { id?: number } | undefined;
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
      `UPDATE packets SET packet_type = ?, packet_type_code = ?,
       payload_type = ?, payload_type_code = ?, route_type = ?,
       decode_status = ?, decode_error = ?, decoder_name = ?,
       decoder_version = ?, decoded_at_ms = ?, decoded_json = ?,
       updated_at_ms = ? WHERE id = ?`,
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

  async insertObservation(
    transaction: Transaction,
    input: {
      packetId: number;
      mqttEventId: number;
      observerId: number;
      region: string;
      receivedAtMs: number;
      reportedAtMs?: number;
      rssi?: number;
      snr?: number;
      score?: number;
      direction?: string;
      mqttDuplicate: boolean;
    },
  ): Promise<number> {
    const previous = (await transaction.get(
      `SELECT received_at_ms FROM packet_observations
       WHERE packet_id = ? AND observer_id = ?
       ORDER BY received_at_ms DESC, id DESC LIMIT 1`,
      input.packetId,
      input.observerId,
    )) as { received_at_ms?: number } | undefined;
    const rfRetransmission =
      !input.mqttDuplicate &&
      previous?.received_at_ms !== undefined &&
      input.receivedAtMs - Number(previous.received_at_ms) <= 300_000;
    const row = (await transaction.get(
      `INSERT INTO packet_observations(
         packet_id, mqtt_event_id, observer_id, region, received_at_ms,
         reported_at_ms, rssi, snr, score, direction,
         suspected_mqtt_duplicate, suspected_rf_retransmission, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      input.packetId,
      input.mqttEventId,
      input.observerId,
      input.region,
      input.receivedAtMs,
      input.reportedAtMs ?? null,
      input.rssi ?? null,
      input.snr ?? null,
      input.score ?? null,
      input.direction ?? null,
      input.mqttDuplicate ? 1 : 0,
      rfRetransmission ? 1 : 0,
      input.receivedAtMs,
    )) as { id?: number } | undefined;
    if (row?.id === undefined) {
      throw new Error("packet observation insert returned no id");
    }
    return asNumber(row.id);
  }
}

export class RetentionRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  private placeholders(ids: number[]): string {
    return ids.map(() => "?").join(",");
  }

  private uniqueIds(rows: Array<{ id: number }>): number[] {
    return [...new Set(rows.map((row) => asNumber(row.id)))];
  }

  private async packetIdsForEvents(
    transaction: Transaction,
    eventIds: number[],
  ): Promise<number[]> {
    if (eventIds.length === 0) return [];
    const rows = (await transaction.all(
      `SELECT DISTINCT packet_id AS id FROM packet_observations
       WHERE mqtt_event_id IN (${this.placeholders(eventIds)})`,
      ...eventIds,
    )) as Array<{ id: number }>;
    return this.uniqueIds(rows);
  }

  private async nodeIdsForPackets(
    transaction: Transaction,
    packetIds: number[],
  ): Promise<number[]> {
    if (packetIds.length === 0) return [];
    const placeholders = this.placeholders(packetIds);
    const rows = (await transaction.all(
      `SELECT node_id AS id FROM node_adverts WHERE packet_id IN (${placeholders})
       UNION
       SELECT node_id AS id FROM node_sightings WHERE packet_id IN (${placeholders})
       UNION
       SELECT source_node_id AS id FROM trace_events
         WHERE packet_id IN (${placeholders}) AND source_node_id IS NOT NULL
       UNION
       SELECT sender_node_id AS id FROM messages
         WHERE packet_id IN (${placeholders}) AND sender_node_id IS NOT NULL
       UNION
       SELECT destination_node_id AS id FROM messages
         WHERE packet_id IN (${placeholders}) AND destination_node_id IS NOT NULL
       UNION
       SELECT node_id AS id FROM telemetry_events
         WHERE packet_id IN (${placeholders}) AND node_id IS NOT NULL`,
      ...packetIds,
      ...packetIds,
      ...packetIds,
      ...packetIds,
      ...packetIds,
      ...packetIds,
    )) as Array<{ id: number }>;
    return this.uniqueIds(rows);
  }

  private async refreshPackets(
    transaction: Transaction,
    packetIds: number[],
    now: number,
  ): Promise<number> {
    if (packetIds.length === 0) return 0;
    const placeholders = this.placeholders(packetIds);
    await transaction.run(
      `UPDATE packets SET
         first_seen_at_ms = (SELECT min(received_at_ms) FROM packet_observations WHERE packet_id = packets.id),
         last_seen_at_ms = (SELECT max(received_at_ms) FROM packet_observations WHERE packet_id = packets.id),
         updated_at_ms = ?
       WHERE id IN (${placeholders})
         AND EXISTS (SELECT 1 FROM packet_observations WHERE packet_id = packets.id)`,
      now,
      ...packetIds,
    );
    const result = await transaction.run(
      `DELETE FROM packets WHERE id IN (${placeholders})
       AND NOT EXISTS (
         SELECT 1 FROM packet_observations po WHERE po.packet_id = packets.id
       )`,
      ...packetIds,
    );
    return Number(result.changes);
  }

  private async refreshObservers(
    transaction: Transaction,
    deletedEvents: Array<{
      id: number;
      observer_id: number | null;
      region: string | null;
      received_at_ms: number;
    }>,
    now: number,
  ): Promise<number> {
    const deleted = deletedEvents.filter(
      (row) => row.observer_id !== null && row.region !== null,
    );
    if (deleted.length === 0) return 0;
    const observerIds = [
      ...new Set(deleted.map((row) => asNumber(row.observer_id))),
    ];
    const placeholders = this.placeholders(observerIds);
    for (const row of deleted) {
      const observerId = asNumber(row.observer_id);
      const region = row.region as string;
      const current = (await transaction.get(
        `SELECT first_seen_at_ms, last_seen_at_ms, observation_count
         FROM observer_region_history WHERE observer_id = ? AND region = ?`,
        observerId,
        region,
      )) as
        | {
            first_seen_at_ms: number;
            last_seen_at_ms: number;
            observation_count: number;
          }
        | undefined;
      if (!current) continue;
      const remaining = current.observation_count - 1;
      if (remaining <= 0) {
        await transaction.run(
          `DELETE FROM observer_region_history WHERE observer_id = ? AND region = ?`,
          observerId,
          region,
        );
        continue;
      }
      const firstTouched = current.first_seen_at_ms >= row.received_at_ms;
      const lastTouched = current.last_seen_at_ms <= row.received_at_ms;
      if (!firstTouched && !lastTouched) {
        await transaction.run(
          `UPDATE observer_region_history SET observation_count = observation_count - 1
           WHERE observer_id = ? AND region = ?`,
          observerId,
          region,
        );
        continue;
      }
      const boundary = (await transaction.get(
        `SELECT min(received_at_ms) AS first_seen_at_ms, max(received_at_ms) AS last_seen_at_ms,
                count(*) AS observation_count
         FROM mqtt_events WHERE observer_id = ? AND region = ?`,
        observerId,
        region,
      )) as
        | {
            first_seen_at_ms: number;
            last_seen_at_ms: number;
            observation_count: number;
          }
        | undefined;
      if (!boundary || boundary.observation_count === 0) {
        await transaction.run(
          `DELETE FROM observer_region_history WHERE observer_id = ? AND region = ?`,
          observerId,
          region,
        );
        continue;
      }
      await transaction.run(
        `UPDATE observer_region_history SET
           first_seen_at_ms = ?, last_seen_at_ms = ?, observation_count = ?
         WHERE observer_id = ? AND region = ?`,
        boundary.first_seen_at_ms,
        boundary.last_seen_at_ms,
        boundary.observation_count,
        observerId,
        region,
      );
    }
    for (const observerId of observerIds) {
      const current = (await transaction.get(
        `SELECT first_seen_at_ms, last_seen_at_ms FROM observers WHERE id = ?`,
        observerId,
      )) as { first_seen_at_ms: number; last_seen_at_ms: number } | undefined;
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
      const stillExists = (await transaction.get(
        `SELECT 1 AS present FROM mqtt_events WHERE observer_id = ? LIMIT 1`,
        observerId,
      )) as { present?: number } | undefined;
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
           latest_region = (
             SELECT region FROM mqtt_events WHERE observer_id = observers.id
             ORDER BY received_at_ms DESC, id DESC LIMIT 1
           ),
           updated_at_ms = ?
         WHERE id = ?`,
        now,
        observerId,
      );
    }
    const result = await transaction.run(
      `DELETE FROM observers WHERE id IN (${placeholders})
       AND NOT EXISTS (SELECT 1 FROM mqtt_events e WHERE e.observer_id = observers.id)
       AND NOT EXISTS (SELECT 1 FROM packet_observations po WHERE po.observer_id = observers.id)
       AND NOT EXISTS (SELECT 1 FROM observer_status_events se WHERE se.observer_id = observers.id)
       AND NOT EXISTS (SELECT 1 FROM neighbor_snapshots ns WHERE ns.observer_id = observers.id)
       AND NOT EXISTS (SELECT 1 FROM node_sightings s WHERE s.observer_id = observers.id)`,
      ...observerIds,
    );
    return Number(result.changes);
  }

  private async refreshNodes(
    transaction: Transaction,
    nodeIds: number[],
    now: number,
  ): Promise<number> {
    if (nodeIds.length === 0) return 0;
    const placeholders = this.placeholders(nodeIds);
    await transaction.run(
      `DELETE FROM node_prefix_candidates WHERE node_id IN (${placeholders})`,
      ...nodeIds,
    );
    for (const prefixLength of [1, 2, 3]) {
      await transaction.run(
        `INSERT INTO node_prefix_candidates(
           prefix_hex, prefix_length_bytes, node_id, first_seen_at_ms,
           last_seen_at_ms, evidence_count, confidence
         )
         SELECT substr(n.public_key, 1, ?), ?, n.id,
                min(a.first_observed_at_ms), max(a.first_observed_at_ms),
                count(*), CASE WHEN max(a.verified) = 1 THEN 1.0 ELSE 0.5 END
         FROM nodes n JOIN node_adverts a ON a.node_id = n.id
         WHERE n.id IN (${placeholders})
         GROUP BY n.id, substr(n.public_key, 1, ?)`,
        prefixLength * 2,
        prefixLength,
        ...nodeIds,
        prefixLength * 2,
      );
    }
    await transaction.run(
      `UPDATE nodes SET
         first_seen_at_ms = coalesce(
           (SELECT min(seen_at_ms) FROM (
             SELECT received_at_ms AS seen_at_ms FROM node_sightings s WHERE s.node_id = nodes.id
             UNION ALL
             SELECT first_observed_at_ms AS seen_at_ms FROM node_adverts a WHERE a.node_id = nodes.id
           )),
           first_seen_at_ms
         ),
         last_seen_at_ms = coalesce(
           (SELECT max(seen_at_ms) FROM (
             SELECT received_at_ms AS seen_at_ms FROM node_sightings s WHERE s.node_id = nodes.id
             UNION ALL
             SELECT first_observed_at_ms AS seen_at_ms FROM node_adverts a WHERE a.node_id = nodes.id
           )),
           last_seen_at_ms
         ),
          latest_name = (
            SELECT name FROM node_adverts a WHERE a.node_id = nodes.id AND a.verified = 1
            ORDER BY first_observed_at_ms DESC, id DESC LIMIT 1
          ),
          latest_role = (
            SELECT role FROM node_adverts a WHERE a.node_id = nodes.id AND a.verified = 1
            ORDER BY first_observed_at_ms DESC, id DESC LIMIT 1
          ),
          latest_latitude = (
            SELECT latitude FROM node_adverts a WHERE a.node_id = nodes.id AND a.verified = 1
            ORDER BY first_observed_at_ms DESC, id DESC LIMIT 1
          ),
          latest_longitude = (
            SELECT longitude FROM node_adverts a WHERE a.node_id = nodes.id AND a.verified = 1
            ORDER BY first_observed_at_ms DESC, id DESC LIMIT 1
          ),
          latest_advert_timestamp = (
            SELECT advert_timestamp FROM node_adverts a WHERE a.node_id = nodes.id AND a.verified = 1
            ORDER BY first_observed_at_ms DESC, id DESC LIMIT 1
          ),
         updated_at_ms = ?
       WHERE id IN (${placeholders})`,
      now,
      ...nodeIds,
    );
    const result = await transaction.run(
      `DELETE FROM nodes WHERE id IN (${placeholders})
       AND NOT EXISTS (SELECT 1 FROM node_adverts a WHERE a.node_id = nodes.id)
       AND NOT EXISTS (SELECT 1 FROM node_sightings s WHERE s.node_id = nodes.id)
       AND NOT EXISTS (SELECT 1 FROM telemetry_events t WHERE t.node_id = nodes.id)
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.sender_node_id = nodes.id OR m.destination_node_id = nodes.id)
       AND NOT EXISTS (SELECT 1 FROM trace_events tr WHERE tr.source_node_id = nodes.id)`,
      ...nodeIds,
    );
    return Number(result.changes);
  }

  async deleteExpiredEvents(cutoffMs: number, batchSize: number) {
    const remove = this.database.transaction(async (transaction) => {
      const rows = (await transaction.all(
        `SELECT id, observer_id, region, received_at_ms FROM mqtt_events
         WHERE received_at_ms <= ? AND processing_status != 'processing'
         ORDER BY received_at_ms, id LIMIT ?`,
        cutoffMs,
        batchSize,
      )) as Array<{
        id: number;
        observer_id: number | null;
        region: string | null;
        received_at_ms: number;
      }>;
      if (rows.length === 0) return 0;
      const eventIds = rows.map((row) => asNumber(row.id));
      const packetIds = await this.packetIdsForEvents(transaction, eventIds);
      const nodeIds = await this.nodeIdsForPackets(transaction, packetIds);
      await transaction.run(
        `DELETE FROM mqtt_events WHERE id IN (${this.placeholders(eventIds)})`,
        ...eventIds,
      );
      const now = Date.now();
      await this.refreshPackets(transaction, packetIds, now);
      await this.refreshObservers(transaction, rows, now);
      await this.refreshNodes(transaction, nodeIds, now);
      return rows.length;
    });
    return remove.immediate();
  }

  async deleteOrphans(batchSize: number): Promise<number> {
    const clean = this.database.transaction(async (transaction) => {
      let deleted = 0;
      const packetRows = (await transaction.all(
        `SELECT p.id FROM packets p
         WHERE NOT EXISTS (
           SELECT 1 FROM packet_observations po WHERE po.packet_id = p.id
         ) ORDER BY p.id LIMIT ?`,
        batchSize,
      )) as Array<{ id: number }>;
      const packetIds = this.uniqueIds(packetRows);
      const nodeIds = await this.nodeIdsForPackets(transaction, packetIds);
      deleted += await this.refreshPackets(transaction, packetIds, Date.now());
      deleted += await this.refreshNodes(transaction, nodeIds, Date.now());
      const nodes = await transaction.run(
        `DELETE FROM nodes WHERE id IN (
           SELECT n.id FROM nodes n WHERE
             NOT EXISTS (SELECT 1 FROM node_adverts a WHERE a.node_id = n.id) AND
             NOT EXISTS (SELECT 1 FROM node_sightings s WHERE s.node_id = n.id) AND
             NOT EXISTS (SELECT 1 FROM telemetry_events t WHERE t.node_id = n.id) AND
             NOT EXISTS (SELECT 1 FROM messages m WHERE m.sender_node_id = n.id OR m.destination_node_id = n.id) AND
             NOT EXISTS (SELECT 1 FROM trace_events tr WHERE tr.source_node_id = n.id)
           ORDER BY n.id LIMIT ?
         )`,
        batchSize,
      );
      deleted += Number(nodes.changes);
      const observers = await transaction.run(
        `DELETE FROM observers WHERE id IN (
           SELECT o.id FROM observers o WHERE
             NOT EXISTS (SELECT 1 FROM mqtt_events e WHERE e.observer_id = o.id) AND
             NOT EXISTS (SELECT 1 FROM packet_observations po WHERE po.observer_id = o.id) AND
             NOT EXISTS (SELECT 1 FROM observer_status_events se WHERE se.observer_id = o.id) AND
             NOT EXISTS (SELECT 1 FROM neighbor_snapshots ns WHERE ns.observer_id = o.id) AND
             NOT EXISTS (SELECT 1 FROM node_sightings s WHERE s.observer_id = o.id)
           ORDER BY o.id LIMIT ?
         )`,
        batchSize,
      );
      deleted += Number(observers.changes);
      return deleted;
    });
    return clean.immediate();
  }
}
