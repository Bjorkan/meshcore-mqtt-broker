import { createHash } from "node:crypto";
import type { PublishPacket } from "aedes";
import type { StorageConfig } from "./config.js";
import {
  CURRENT_SCHEMA_VERSION,
  getDatabaseResetCount,
  type ApplicationDatabase,
  type Transaction,
} from "./database.js";
import { getModuleLogger } from "./logger.js";
import { logicalPacketIdentity } from "./logical-packet-identity.js";
import { canonicalMetricUnit } from "./metric-units.js";
import {
  DefaultMeshCorePacketDecoder,
  type MeshCoreDecodeResult,
  type MeshCorePacketDecoder,
} from "./meshcore-packet-decoder.js";
import { parseMeshcoreIoRadioParams } from "./meshcore-io-utils.js";
import {
  MqttEventRepository,
  ObserverRepository,
  PacketRepository,
  ProcessingRepository,
  RetentionRepository,
  type ReprocessMqttEventFilter,
  type ReprocessPacketFilter,
  type StoredMqttEvent,
} from "./mqtt-history-repositories.js";
import {
  isPrivateHistorySubtopic,
  MQTT_HISTORY_PARSER_NAME,
  MQTT_HISTORY_PARSER_VERSION,
  parsePublicMeshcoreTopic,
  type ParsedPublicMeshcoreTopic,
} from "./mqtt-history-topic.js";

const log = getModuleLogger("MqttHistory");
const PROCESSING_STALE_MS = 5 * 60 * 1_000;
const RETENTION_ORPHAN_BATCH_SIZE = 200;
const MAX_METRICS_PER_STATUS = 256;
const MAX_NEIGHBORS_PER_SNAPSHOT = 4_096;
const MAX_PACKET_BYTES = 512;

type JsonRecord = Record<string, unknown>;

interface PreparedEvent {
  event: StoredMqttEvent;
  topic?: ParsedPublicMeshcoreTopic;
  json?: JsonRecord;
  payloadFormat: string;
  parseStatus: string;
  warnings: PreparedWarning[];
  packet?: {
    bytes: Buffer;
    reportedAtMs?: number;
    rssi?: number;
    snr?: number;
    score?: number;
    direction?: string;
    decode: MeshCoreDecodeResult;
  };
}

interface PreparedWarning {
  stage: string;
  code: string;
  message: string;
}

export interface MqttHistoryMetrics {
  mqttConnected: boolean;
  mqttEventsReceivedTotal: number;
  mqttEventsProcessedTotal: number;
  mqttEventsFailedTotal: number;
  packetsTotal: number;
  packetObservationsTotal: number;
  decodeSuccessTotal: number;
  decodeFailureTotal: number;
  databaseWriteFailuresTotal: number;
  pendingEvents: number;
  lastMqttEventAt?: number;
  lastSuccessfulDatabaseWriteAt?: number;
  retentionLastRunAt?: number;
  retentionLastSuccessAt?: number;
  retentionLastDurationMs?: number;
  retentionRowsDeletedTotal: number;
  retentionFailuresTotal: number;
  databaseSchemaVersion: number;
  databaseResetsTotal: number;
}

export interface MqttHistoryOptions {
  decoder?: MeshCorePacketDecoder;
  channelNameResolver?: (channelHashHex: string) => string | undefined;
  now?: () => number;
  startLoops?: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function integer(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed)
    ? parsed
    : undefined;
}

function text(value: unknown, maxLength = 1_000): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return sanitized || undefined;
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value < 10_000_000_000 ? value * 1_000 : value);
  }
  if (typeof value === "string" && value.length <= 100) {
    const numeric = finiteNumber(value);
    if (numeric !== undefined) return timestampMs(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}

function scopes(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of source) {
    const scope = text(candidate, 96);
    if (!scope || seen.has(scope)) continue;
    seen.add(scope);
    result.push(scope);
    if (result.length >= 64) break;
  }
  return result;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key: string, item: unknown): unknown =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function payloadRecord(decoded: MeshCoreDecodeResult): JsonRecord | undefined {
  const value = decoded.decoded?.payload.decoded;
  return isRecord(value) ? value : undefined;
}

function decodeErrorStatus(status: string): boolean {
  return ["invalid_packet", "unknown_type", "decoder_error"].includes(status);
}

function packetHex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (
    normalized.length < 2 ||
    normalized.length % 2 !== 0 ||
    normalized.length > MAX_PACKET_BYTES * 2 ||
    !/^[0-9a-f]+$/i.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function publicKey(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return /^[0-9A-F]{64}$/.test(normalized) ? normalized : undefined;
}

function roleName(value: unknown): string {
  const roles = ["UNKNOWN", "CHAT", "REPEATER", "ROOM", "SENSOR"];
  const code = integer(value);
  return code !== undefined ? (roles[code] ?? "UNKNOWN") : "UNKNOWN";
}

function prefixBuffer(prefixes: string[]): Buffer {
  return Buffer.concat(prefixes.map((prefix) => Buffer.from(prefix, "hex")));
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 2_000);
}

export class MqttHistoryService {
  private readonly events: MqttEventRepository;
  private readonly observers = new ObserverRepository();
  private readonly packets = new PacketRepository();
  private readonly processing = new ProcessingRepository();
  private readonly retention: RetentionRepository;
  private readonly decoder: MeshCorePacketDecoder;
  private readonly channelNameResolver?: (
    channelHashHex: string,
  ) => string | undefined;
  private readonly now: () => number;
  private readonly startLoops: boolean;
  private draining?: Promise<void>;
  private kickPending = false;
  private retentionTimer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private metrics: MqttHistoryMetrics = {
    mqttConnected: true,
    mqttEventsReceivedTotal: 0,
    mqttEventsProcessedTotal: 0,
    mqttEventsFailedTotal: 0,
    packetsTotal: 0,
    packetObservationsTotal: 0,
    decodeSuccessTotal: 0,
    decodeFailureTotal: 0,
    databaseWriteFailuresTotal: 0,
    pendingEvents: 0,
    retentionRowsDeletedTotal: 0,
    retentionFailuresTotal: 0,
    databaseSchemaVersion: CURRENT_SCHEMA_VERSION,
    databaseResetsTotal: getDatabaseResetCount(),
  };

  constructor(
    private readonly database: ApplicationDatabase,
    private readonly config: StorageConfig,
    private readonly collectorInstanceId: string,
    options: MqttHistoryOptions = {},
  ) {
    this.events = new MqttEventRepository(database);
    this.retention = new RetentionRepository(database);
    this.decoder = options.decoder ?? new DefaultMeshCorePacketDecoder();
    this.channelNameResolver = options.channelNameResolver;
    this.now = options.now ?? Date.now;
    this.startLoops = options.startLoops ?? true;
  }

  async start(): Promise<void> {
    const recovered = await this.events.recoverInterrupted(
      this.now() - PROCESSING_STALE_MS,
    );
    if (recovered > 0) {
      log.warn(`Recovered ${recovered} interrupted MQTT history events`);
    }
    this.kick();
    if (this.startLoops) {
      this.retentionTimer = setInterval(() => {
        void this.runRetention().catch(() => undefined);
      }, this.config.cleanupIntervalMinutes * 60_000);
      this.retentionTimer.unref();
    }
    this.metrics.pendingEvents = await this.events.pendingCount();
  }

  shouldCapture(topic: string): boolean {
    const parts = topic.split("/");
    if (parts[0] !== "meshcore" || parts.length < 4) return false;
    const subtopicRoot = parts[3].toLowerCase();
    return !isPrivateHistorySubtopic(subtopicRoot, this.config);
  }

  async capturePublish(packet: PublishPacket): Promise<number | undefined> {
    if (!this.shouldCapture(packet.topic)) return undefined;
    if (this.stopped) throw new Error("MQTT history service is stopped");
    const payload = Buffer.isBuffer(packet.payload)
      ? Buffer.from(packet.payload)
      : Buffer.from(packet.payload);
    const receivedAtMs = this.now();
    try {
      const id = await this.events.insertReceived({
        topic: packet.topic,
        payload,
        qos: Number(packet.qos ?? 0),
        retain: Boolean(packet.retain),
        dup: Boolean(packet.dup),
        receivedAtMs,
        collectorInstanceId: this.collectorInstanceId,
        parserName: MQTT_HISTORY_PARSER_NAME,
        parserVersion: MQTT_HISTORY_PARSER_VERSION,
      });
      this.metrics.mqttEventsReceivedTotal += 1;
      this.metrics.lastMqttEventAt = receivedAtMs;
      this.metrics.lastSuccessfulDatabaseWriteAt = this.now();
      this.metrics.pendingEvents += 1;
      this.kick();
      return id;
    } catch (error) {
      this.metrics.databaseWriteFailuresTotal += 1;
      throw error;
    }
  }

  getMetrics(): MqttHistoryMetrics {
    return {
      ...this.metrics,
      databaseResetsTotal: getDatabaseResetCount(),
    };
  }

  async drain(): Promise<void> {
    while (this.draining) await this.draining;
    if (this.stopped) await this.processAvailable();
    await this.database.drain();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.metrics.mqttConnected = false;
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    await this.drain();
  }

  async reprocessMqttEvents(
    filter: ReprocessMqttEventFilter = {},
  ): Promise<number> {
    const count = await this.events.requeue(filter);
    this.metrics.pendingEvents = await this.events.pendingCount();
    this.kick();
    return count;
  }

  async reprocessPackets(filter: ReprocessPacketFilter = {}): Promise<number> {
    const clauses = ["1 = 1"];
    const parameters: unknown[] = [];
    if (filter.from !== undefined) {
      clauses.push(`po.received_at_ms >= $${parameters.length + 1}`);
      parameters.push(filter.from);
    }
    if (filter.to !== undefined) {
      clauses.push(`po.received_at_ms <= $${parameters.length + 1}`);
      parameters.push(filter.to);
    }
    if (filter.observerPublicKey) {
      clauses.push(`o.public_key = $${parameters.length + 1}`);
      parameters.push(filter.observerPublicKey.toUpperCase());
    }
    if (filter.decodeStatus) {
      clauses.push(`p.decode_status = $${parameters.length + 1}`);
      parameters.push(filter.decodeStatus);
    }
    if (filter.decoderVersion) {
      clauses.push(`p.decoder_version = $${parameters.length + 1}`);
      parameters.push(filter.decoderVersion);
    }
    if (filter.failedOnly) {
      clauses.push(
        "p.decode_status IN ('invalid_packet', 'unknown_type', 'decoder_error')",
      );
    }
    const limit = Math.max(1, Math.min(filter.limit ?? 1_000, 10_000));
    const rows = await this.database.all<{ mqtt_event_id: number }>(
      `SELECT po.mqtt_event_id FROM packet_observations po
       JOIN packets p ON p.id = po.packet_id
       JOIN observers o ON o.id = po.observer_id
       WHERE ${clauses.join(" AND ")}
       GROUP BY po.mqtt_event_id
       ORDER BY min(po.received_at_ms), min(po.id)
       LIMIT $${parameters.length + 1}`,
      ...parameters,
      limit,
    );
    if (rows.length === 0) return 0;
    const result = await this.database.run(
      `UPDATE mqtt_events SET processing_status = 'pending',
       processing_started_at_ms = NULL, updated_at_ms = $1
       WHERE id IN (${rows.map((_, index) => `$${index + 2}`).join(",")})`,
      this.now(),
      ...rows.map((row) => row.mqtt_event_id),
    );
    this.kick();
    return result.rowCount ?? 0;
  }

  async runRetention(now = this.now()): Promise<number> {
    const startedAt = this.now();
    this.metrics.retentionLastRunAt = now;
    const cutoffMs = now - this.config.retentionDays * 86_400_000;
    let deleted = 0;
    let expiredBatchFailures = 0;
    try {
      for (;;) {
        let count: number;
        try {
          count = await this.retention.deleteExpiredEvents(
            cutoffMs,
            this.config.cleanupBatchSize,
          );
        } catch (error) {
          expiredBatchFailures += 1;
          log.error(
            "Retention: expired-event batch interrupted, resuming on the next run",
            error,
          );
          break;
        }
        deleted += count;
        if (count < this.config.cleanupBatchSize) break;
      }
      if (deleted > 0) {
        const orphanBatchSize = Math.min(
          this.config.cleanupBatchSize,
          RETENTION_ORPHAN_BATCH_SIZE,
        );
        for (;;) {
          let count: number;
          try {
            count = await this.retention.deleteOrphans(orphanBatchSize);
          } catch (error) {
            log.error(
              "Retention: orphan cleanup interrupted, resuming on the next run",
              error,
            );
            break;
          }
          deleted += count;
          if (count === 0) break;
        }
      }
      this.metrics.retentionRowsDeletedTotal += deleted;
      if (expiredBatchFailures > 0) {
        this.metrics.retentionFailuresTotal += expiredBatchFailures;
        this.metrics.retentionLastSuccessAt = undefined;
      } else {
        this.metrics.retentionLastSuccessAt = this.now();
      }
      this.metrics.retentionLastDurationMs = this.now() - startedAt;
      return deleted;
    } catch (error) {
      this.metrics.retentionFailuresTotal += 1;
      log.error("Retention cleanup failed", error);
      throw error;
    }
  }

  private kick(): void {
    if (this.stopped) return;
    if (this.draining) {
      this.kickPending = true;
      return;
    }
    this.draining = this.processAvailable()
      .catch((error) => {
        this.metrics.databaseWriteFailuresTotal += 1;
        log.error(
          "MQTT history processor stopped with a database error",
          error,
        );
      })
      .finally(() => {
        this.draining = undefined;
        if (this.kickPending) {
          this.kickPending = false;
          this.kick();
        }
      });
  }

  private async processAvailable(): Promise<void> {
    for (;;) {
      const id = await this.events.claimNext(this.now() - PROCESSING_STALE_MS);
      if (id === undefined) break;
      try {
        await this.processEvent(id);
        this.metrics.mqttEventsProcessedTotal += 1;
        this.metrics.pendingEvents = Math.max(
          0,
          this.metrics.pendingEvents - 1,
        );
        this.metrics.lastSuccessfulDatabaseWriteAt = this.now();
      } catch (error) {
        this.metrics.mqttEventsFailedTotal += 1;
        this.metrics.databaseWriteFailuresTotal += 1;
        await this.events.fail(id).catch(() => undefined);
        log.error(`MQTT history event ${id} failed`, error);
      }
    }
    this.metrics.pendingEvents = await this.events.pendingCount();
  }

  private async prepare(event: StoredMqttEvent): Promise<PreparedEvent> {
    const prepared: PreparedEvent = {
      event,
      payloadFormat: event.payload_text === null ? "binary" : "utf8",
      parseStatus: "parsed",
      warnings: [],
    };
    const parsedTopic = parsePublicMeshcoreTopic(event.topic);
    if (!parsedTopic.ok) {
      prepared.parseStatus = "topic_error";
      prepared.warnings.push({
        stage: "topic_parse",
        code: parsedTopic.code,
        message: parsedTopic.message,
      });
      return prepared;
    }
    prepared.topic = parsedTopic.value;

    if (event.payload_text === null) {
      prepared.parseStatus = "json_error";
      prepared.warnings.push({
        stage: "json_parse",
        code: "invalid_utf8",
        message: "MQTT payload is not valid UTF-8",
      });
      return prepared;
    }

    try {
      const parsed: unknown = JSON.parse(event.payload_text);
      if (!isRecord(parsed)) throw new Error("JSON root must be an object");
      prepared.json = parsed;
      prepared.payloadFormat = "json";
    } catch (error) {
      prepared.parseStatus = "json_error";
      prepared.warnings.push({
        stage: "json_parse",
        code: "invalid_json",
        message: errorText(error),
      });
      return prepared;
    }

    const origin = publicKey(prepared.json.origin_id);
    if (origin !== prepared.topic.observerPublicKey) {
      prepared.warnings.push({
        stage: "identity_validation",
        code: origin ? "origin_mismatch" : "invalid_origin_id",
        message: "Payload origin_id does not match the topic observer",
      });
    }

    if (prepared.topic.subtopicRoot !== "packets") return prepared;
    const hex = packetHex(
      prepared.json.raw ??
        prepared.json.packet ??
        prepared.json.payload ??
        prepared.json.data,
    );
    if (!hex) {
      prepared.warnings.push({
        stage: "packet_extract",
        code: "invalid_packet_hex",
        message: "Packet envelope contains no valid MeshCore packet bytes",
      });
      return prepared;
    }
    const bytes = Buffer.from(hex, "hex");
    prepared.packet = {
      bytes,
      reportedAtMs: timestampMs(
        prepared.json.timestamp ?? prepared.json.reported_at,
      ),
      rssi: finiteNumber(prepared.json.rssi ?? prepared.json.RSSI),
      snr: finiteNumber(prepared.json.snr ?? prepared.json.SNR),
      score: finiteNumber(prepared.json.score),
      direction: text(prepared.json.direction, 50),
      decode: await this.decoder.decode(bytes),
    };
    if (decodeErrorStatus(prepared.packet.decode.status)) {
      prepared.warnings.push({
        stage: "packet_decode",
        code: prepared.packet.decode.status,
        message: prepared.packet.decode.error ?? "MeshCore decoding failed",
      });
    } else if (prepared.packet.decode.status === "partially_decoded") {
      prepared.warnings.push({
        stage: "packet_decode",
        code: "partially_decoded",
        message:
          prepared.packet.decode.error ?? "Packet was only partially decoded",
      });
    }
    return prepared;
  }

  private async processEvent(id: number): Promise<void> {
    const event = await this.events.getById(id);
    if (!event) return;
    const prepared = await this.prepare(event);
    const normalize = this.database.transaction(async (transaction) => {
      await this.processing.resetDerived(transaction, id);
      let observerId: number | undefined;
      if (prepared.topic) {
        observerId = await this.observers.resolve(
          transaction,
          prepared.topic.observerPublicKey,
          prepared.topic.region,
          event.received_at_ms,
        );
        await transaction.run(
          `UPDATE mqtt_events SET region = $1, observer_id = $2, subtopic = $3,
           subtopic_root = $4, parser_name = $5, parser_version = $6 WHERE id = $7`,
          prepared.topic.region,
          observerId,
          prepared.topic.subtopic,
          prepared.topic.subtopicRoot,
          MQTT_HISTORY_PARSER_NAME,
          MQTT_HISTORY_PARSER_VERSION,
          id,
        );
        await this.observers.incrementRegion(
          transaction,
          observerId,
          prepared.topic.region,
          event.received_at_ms,
        );
      }
      for (const warning of prepared.warnings) {
        await this.processing.error(transaction, {
          mqttEventId: id,
          stage: warning.stage,
          code: warning.code,
          message: warning.message,
          processorName: MQTT_HISTORY_PARSER_NAME,
          processorVersion: MQTT_HISTORY_PARSER_VERSION,
          receivedAtMs: event.received_at_ms,
        });
      }
      if (prepared.topic && prepared.json && observerId !== undefined) {
        if (prepared.topic.subtopicRoot === "status") {
          await this.normalizeStatus(transaction, prepared, observerId);
        } else if (prepared.topic.subtopicRoot === "neighbors") {
          await this.normalizeNeighbors(transaction, prepared, observerId);
        } else if (
          prepared.topic.subtopicRoot === "packets" &&
          prepared.packet
        ) {
          await this.normalizePacket(transaction, prepared, observerId);
        }
      }
    });
    await normalize();
    await this.events.complete(
      id,
      prepared.warnings.length > 0 ? "processed_with_warnings" : "processed",
      prepared.parseStatus,
      prepared.payloadFormat,
    );
  }

  private async normalizeStatus(
    transaction: Transaction,
    prepared: PreparedEvent,
    observerId: number,
  ) {
    const { event, topic, json } = prepared;
    if (!topic || !json) return;
    const reportedAtMs = timestampMs(json.timestamp ?? json.reported_at);
    await transaction.run(
      `INSERT INTO observer_status_events(
         mqtt_event_id, observer_id, region, reported_at_ms, received_at_ms,
         origin, model, firmware_version, raw_json, created_at_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      event.id,
      observerId,
      topic.region,
      reportedAtMs ?? null,
      event.received_at_ms,
      text(json.origin, 200) ?? null,
      text(json.model ?? json.device_model, 200) ?? null,
      text(json.firmware_version ?? json.firmware ?? json.version, 200) ?? null,
      safeJson(json),
      this.now(),
    );

    const metricSources: Array<[string, JsonRecord]> = [["", json]];
    for (const key of ["metrics", "stats"]) {
      if (isRecord(json[key])) metricSources.push([`${key}.`, json[key]]);
    }
    const ignored = new Set([
      "origin_id",
      "origin",
      "timestamp",
      "reported_at",
      "model",
      "device_model",
      "firmware",
      "firmware_version",
      "version",
      "metrics",
      "stats",
      "params",
      "radio",
    ]);
    let metricCount = 0;
    for (const [prefix, source] of metricSources) {
      for (const [name, value] of Object.entries(source)) {
        if (
          metricCount >= MAX_METRICS_PER_STATUS ||
          (!prefix && ignored.has(name))
        ) {
          continue;
        }
        const metricName = `${prefix}${name}`.slice(0, 200);
        const numericValue = finiteNumber(value);
        const booleanValue = typeof value === "boolean" ? value : undefined;
        const textValue =
          numericValue === undefined && booleanValue === undefined
            ? text(value, 500)
            : undefined;
        if (
          numericValue === undefined &&
          booleanValue === undefined &&
          textValue === undefined
        ) {
          continue;
        }
        await transaction.run(
          `INSERT INTO observer_metrics(
             observer_id, mqtt_event_id, received_at_ms, reported_at_ms,
             metric_name, numeric_value, text_value, boolean_value, unit
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (mqtt_event_id, metric_name) DO NOTHING`,
          observerId,
          event.id,
          event.received_at_ms,
          reportedAtMs ?? null,
          metricName,
          numericValue ?? null,
          textValue ?? null,
          booleanValue ?? null,
          canonicalMetricUnit(metricName),
        );
        metricCount += 1;
      }
    }

    const radio = parseMeshcoreIoRadioParams(json);
    const txPower = finiteNumber(
      json.tx_power_dbm ?? json.tx_power ?? json.txPower,
    );
    if (
      radio.freq !== undefined ||
      radio.bw !== undefined ||
      radio.sf !== undefined ||
      radio.cr !== undefined ||
      txPower !== undefined
    ) {
      await transaction.run(
        `INSERT INTO observer_radio_history(
           observer_id, mqtt_event_id, frequency_mhz, bandwidth_khz,
           spreading_factor, coding_rate, tx_power_dbm, received_at_ms
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        observerId,
        event.id,
        radio.freq ?? null,
        radio.bw ?? null,
        radio.sf ?? null,
        radio.cr ?? null,
        txPower ?? null,
        event.received_at_ms,
      );
    }
  }

  private async normalizeNeighbors(
    transaction: Transaction,
    prepared: PreparedEvent,
    observerId: number,
  ) {
    const { event, topic, json } = prepared;
    if (!topic || !json) return;
    const reportedAtMs = timestampMs(json.timestamp ?? json.reported_at);
    const candidates = Array.isArray(json.neighbors) ? json.neighbors : [];
    if (!Array.isArray(json.neighbors)) {
      prepared.warnings.push({
        stage: "json_parse",
        code: "missing_neighbors",
        message: "Neighbors payload has no neighbors array",
      });
      await this.processing.error(transaction, {
        mqttEventId: event.id,
        stage: "json_parse",
        code: "missing_neighbors",
        message: "Neighbors payload has no neighbors array",
        processorName: MQTT_HISTORY_PARSER_NAME,
        processorVersion: MQTT_HISTORY_PARSER_VERSION,
        receivedAtMs: event.received_at_ms,
      });
    }
    const self = isRecord(json.self) ? json.self : undefined;
    const reportedTotalNeighbors = integer(json.total_neighbors);
    const reportedQueriedNeighbors = integer(json.queried_neighbors);
    const replay = await transaction.get(
      `SELECT ns.id, ns.received_at_ms FROM neighbor_snapshots ns
       JOIN mqtt_events previous ON previous.id = ns.mqtt_event_id
        WHERE ns.observer_id = $1 AND previous.topic = $2
          AND previous.payload_sha256 = $3
          AND previous.id <> $4 AND ns.reported_at_ms IS NOT DISTINCT FROM $5
       ORDER BY ns.id DESC LIMIT 1`,
      observerId,
      event.topic,
      event.payload_sha256,
      event.id,
      reportedAtMs ?? null,
    );
    const snapshot = await transaction.get(
      `INSERT INTO neighbor_snapshots(
         mqtt_event_id, observer_id, region, reported_at_ms, received_at_ms,
         mqtt_retained, suspected_replay, replay_of_snapshot_id,
          self_scopes_json, self_default_scope, reported_total_neighbors,
          reported_queried_neighbors, reported_truncated, entry_count, raw_json
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, $14) RETURNING id`,
      event.id,
      observerId,
      topic.region,
      reportedAtMs ?? null,
      event.received_at_ms,
      event.retain,
      replay?.id !== undefined,
      replay?.id ?? null,
      safeJson(scopes(self?.scopes)),
      text(self?.default_scope, 100) ?? null,
      reportedTotalNeighbors !== undefined && reportedTotalNeighbors >= 0
        ? reportedTotalNeighbors
        : null,
      reportedQueriedNeighbors !== undefined && reportedQueriedNeighbors >= 0
        ? reportedQueriedNeighbors
        : null,
      typeof json.truncated === "boolean" ? json.truncated : null,
      safeJson(json),
    );
    if (snapshot?.id === undefined) {
      throw new Error("neighbor snapshot insert returned no id");
    }
    for (const scope of scopes(self?.scopes)) {
      await transaction.run(
        "INSERT INTO neighbor_snapshot_scopes(snapshot_id, scope) VALUES ($1, $2)",
        snapshot.id,
        scope,
      );
    }

    const seen = new Set<string>();
    let count = 0;
    let invalid = 0;
    for (const candidate of candidates.slice(0, MAX_NEIGHBORS_PER_SNAPSHOT)) {
      if (!isRecord(candidate)) {
        invalid += 1;
        continue;
      }
      const neighborKey = publicKey(
        candidate.pubkey ?? candidate.public_key ?? candidate.publicKey,
      );
      if (!neighborKey || seen.has(neighborKey)) {
        invalid += 1;
        continue;
      }
      const heardSecsAgo = integer(
        candidate.heard_secs_ago ?? candidate.heardSecsAgo,
      );
      if (heardSecsAgo !== undefined && heardSecsAgo < 0) {
        invalid += 1;
        continue;
      }
      seen.add(neighborKey);
      const lastHeardBase =
        replay?.received_at_ms === undefined
          ? event.received_at_ms
          : Number(replay.received_at_ms);
      const entry = await transaction.get<{ id: number }>(
        `INSERT INTO neighbor_entries(
           snapshot_id, neighbor_public_key, snr, rssi, heard_secs_ago,
           calculated_last_heard_at_ms, status, scopes_json
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        snapshot.id,
        neighborKey,
        finiteNumber(candidate.snr ?? candidate.SNR) ?? null,
        finiteNumber(candidate.rssi ?? candidate.RSSI) ?? null,
        heardSecsAgo ?? null,
        heardSecsAgo === undefined
          ? null
          : lastHeardBase - heardSecsAgo * 1_000,
        text(candidate.status, 100) ?? "unknown",
        safeJson(scopes(candidate.scopes)),
      );
      if (entry?.id === undefined) {
        throw new Error("neighbor entry insert returned no id");
      }
      for (const scope of scopes(candidate.scopes)) {
        await transaction.run(
          "INSERT INTO neighbor_entry_scopes(entry_id, scope) VALUES ($1, $2)",
          entry.id,
          scope,
        );
      }
      count += 1;
    }
    invalid += Math.max(0, candidates.length - MAX_NEIGHBORS_PER_SNAPSHOT);
    await transaction.run(
      "UPDATE neighbor_snapshots SET entry_count = $1 WHERE id = $2",
      count,
      snapshot.id,
    );
    if (invalid > 0) {
      prepared.warnings.push({
        stage: "json_parse",
        code: "invalid_neighbor_entries",
        message: `${invalid} malformed or duplicate neighbor entries were skipped`,
      });
      await this.processing.error(transaction, {
        mqttEventId: event.id,
        stage: "json_parse",
        code: "invalid_neighbor_entries",
        message: `${invalid} malformed or duplicate neighbor entries were skipped`,
        processorName: MQTT_HISTORY_PARSER_NAME,
        processorVersion: MQTT_HISTORY_PARSER_VERSION,
        receivedAtMs: event.received_at_ms,
      });
    }
  }

  private async normalizePacket(
    transaction: Transaction,
    prepared: PreparedEvent,
    observerId: number,
  ) {
    const { event, topic, packet } = prepared;
    if (!topic || !packet) return;
    const stored = await this.packets.upsert(
      transaction,
      packet.bytes,
      event.received_at_ms,
    );
    const decodedJson = packet.decode.decoded
      ? safeJson(packet.decode.decoded)
      : undefined;
    await this.packets.updateDecode(transaction, {
      id: stored.id,
      packetType: packet.decode.packetType,
      packetTypeCode: packet.decode.packetTypeCode,
      payloadType: packet.decode.payloadType,
      payloadTypeCode: packet.decode.payloadTypeCode,
      routeType: packet.decode.routeType,
      status: packet.decode.status,
      error: packet.decode.error,
      decoderName: this.decoder.name,
      decoderVersion: this.decoder.version,
      decodedJson,
      decodedAtMs: this.now(),
    });
    const logicalIdentity = logicalPacketIdentity({
      packetType: packet.decode.packetType,
      payloadType: packet.decode.payloadType,
      payload: payloadRecord(packet.decode),
      payloadRawHex:
        typeof packet.decode.decoded?.payload.raw === "string"
          ? packet.decode.decoded.payload.raw
          : undefined,
      rawSha256: stored.sha256,
    });
    await this.packets.linkLogicalPacket(transaction, {
      packetId: stored.id,
      logicalPacketId: logicalIdentity.id,
      packetType: logicalIdentity.packetType,
      payloadType: logicalIdentity.payloadType,
      observedAtMs: event.received_at_ms,
    });
    await transaction.run(
      `UPDATE processing_errors SET packet_id = $1
       WHERE mqtt_event_id = $2 AND stage = 'packet_decode'`,
      stored.id,
      event.id,
    );
    const observationId = await this.packets.insertObservation(transaction, {
      packetId: stored.id,
      mqttEventId: event.id,
      observerId,
      region: topic.region,
      receivedAtMs: event.received_at_ms,
      reportedAtMs: packet.reportedAtMs,
      rssi: packet.rssi,
      snr: packet.snr,
      score: packet.score,
      direction: packet.direction,
      mqttDuplicate: Boolean(event.dup),
    });
    this.metrics.packetObservationsTotal += 1;
    const observations = await transaction.get(
      "SELECT COUNT(*) AS count FROM packet_observations WHERE packet_id = $1",
      stored.id,
    );
    if (Number(observations?.count) === 1) {
      this.metrics.packetsTotal += 1;
    }
    if (decodeErrorStatus(packet.decode.status)) {
      this.metrics.decodeFailureTotal += 1;
    } else {
      this.metrics.decodeSuccessTotal += 1;
    }
    if (!packet.decode.decoded) return;
    if (packet.decode.packetType !== "TRACE") {
      await this.normalizePath(
        transaction,
        packet.decode,
        observationId,
        event.received_at_ms,
      );
    }
    await this.normalizeAdvert(
      transaction,
      prepared,
      observerId,
      stored.id,
      observationId,
    );
    await this.normalizeTrace(
      transaction,
      prepared,
      observerId,
      stored.id,
      observationId,
    );
    await this.normalizeMessage(
      transaction,
      prepared,
      observerId,
      stored.id,
      observationId,
    );
    await this.normalizeTelemetry(
      transaction,
      prepared,
      observerId,
      stored.id,
      observationId,
    );
  }

  private async resolvePrefix(
    transaction: Transaction,
    prefix: string | undefined,
  ): Promise<{ nodeId?: number; status: string; confidence?: number }> {
    if (!prefix || !/^[0-9A-F]{2,6}$/i.test(prefix) || prefix.length % 2) {
      return { status: "invalid" };
    }
    const rows = await transaction.all(
      `SELECT node_id, confidence FROM node_prefix_candidates
       WHERE prefix_hex = $1 AND prefix_length_bytes = $2
       ORDER BY confidence DESC, node_id`,
      prefix.toUpperCase(),
      prefix.length / 2,
    );
    if (rows.length === 0) return { status: "unresolved" };
    if (rows.length > 1) return { status: "ambiguous" };
    return {
      nodeId: Number(rows[0].node_id),
      status: "resolved",
      confidence: Number(rows[0].confidence),
    };
  }

  private async normalizePath(
    transaction: Transaction,
    decode: MeshCoreDecodeResult,
    observationId: number,
    receivedAtMs: number,
  ) {
    const path = decode.decoded?.path;
    if (!path || path.length === 0) return;
    const normalized = path.map((item) => item.toUpperCase());
    const row = await transaction.get(
      `INSERT INTO packet_paths(
         packet_observation_id, raw_path_blob, hop_count, received_at_ms
        ) VALUES ($1, $2, $3, $4) RETURNING id`,
      observationId,
      prefixBuffer(normalized),
      normalized.length,
      receivedAtMs,
    );
    if (row?.id === undefined)
      throw new Error("packet path insert returned no id");
    for (const [hopIndex, prefix] of normalized.entries()) {
      const resolved = await this.resolvePrefix(transaction, prefix);
      await transaction.run(
        `INSERT INTO packet_path_hops(
           path_id, hop_index, prefix_hex, prefix_length_bytes,
           resolved_node_id, resolution_status, resolution_confidence
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        row.id,
        hopIndex,
        prefix,
        prefix.length / 2,
        resolved.nodeId ?? null,
        resolved.status,
        resolved.confidence ?? null,
      );
    }
  }

  private async normalizeAdvert(
    transaction: Transaction,
    prepared: PreparedEvent,
    observerId: number,
    packetId: number,
    observationId: number,
  ) {
    if (prepared.packet?.decode.packetType !== "ADVERT") return;
    const payload = payloadRecord(prepared.packet.decode);
    const key = publicKey(payload?.publicKey);
    if (!payload || !key) return;
    const appData = isRecord(payload.appData) ? payload.appData : {};
    const payloadMqtt = isRecord(payload.mqtt) ? payload.mqtt : undefined;
    const appDataMqtt = isRecord(appData.mqtt) ? appData.mqtt : undefined;
    const ownerPublicKey =
      publicKey(payloadMqtt?.owner) ?? publicKey(appDataMqtt?.owner);
    const advertTimestamp = integer(payload.timestamp);
    const signatureValid =
      typeof payload.signatureValid === "boolean"
        ? payload.signatureValid
        : undefined;
    const verified = signatureValid === true && payload.isValid !== false;
    if (!verified) {
      prepared.warnings.push({
        stage: "advert_decode",
        code: "advert_not_verified",
        message:
          text(payload.signatureError, 1_000) ??
          "Advertisement signature could not be verified",
      });
      await this.processing.error(transaction, {
        mqttEventId: prepared.event.id,
        packetId,
        stage: "advert_decode",
        code: "advert_not_verified",
        message:
          text(payload.signatureError, 1_000) ??
          "Advertisement signature could not be verified",
        processorName: this.decoder.name,
        processorVersion: this.decoder.version,
        receivedAtMs: prepared.event.received_at_ms,
      });
    }
    const location = isRecord(appData.location) ? appData.location : undefined;
    const latitude = finiteNumber(location?.latitude);
    const longitude = finiteNumber(location?.longitude);
    const validLocation =
      latitude !== undefined &&
      longitude !== undefined &&
      (latitude !== 0 || longitude !== 0) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180;
    const name = text(appData.name, 200);
    const role = roleName(appData.deviceRole);
    const seenAt = prepared.event.received_at_ms;
    const previousAdvert = await transaction.get(
      "SELECT node_id FROM node_adverts WHERE packet_id = $1",
      packetId,
    );
    const node = await transaction.get(
      `INSERT INTO nodes(
         public_key, first_seen_at_ms, last_seen_at_ms, latest_name,
         latest_role, latest_latitude, latest_longitude, owner_public_key,
         latest_advert_timestamp, created_at_ms, updated_at_ms
         ) VALUES ($1, $2, $3, NULL, NULL, NULL, NULL, $4, NULL, $5, $6)
        ON CONFLICT(public_key) DO UPDATE SET
           first_seen_at_ms = LEAST(nodes.first_seen_at_ms, excluded.first_seen_at_ms),
           last_seen_at_ms = GREATEST(nodes.last_seen_at_ms, excluded.last_seen_at_ms),
          owner_public_key = excluded.owner_public_key,
          updated_at_ms = excluded.updated_at_ms
        RETURNING id`,
      key,
      seenAt,
      seenAt,
      ownerPublicKey ?? null,
      seenAt,
      seenAt,
    );
    if (node?.id === undefined) throw new Error("node upsert returned no id");
    await transaction.run(
      `INSERT INTO node_adverts(
         packet_id, node_id, node_public_key, advert_timestamp,
         first_observed_at_ms, name, role, latitude, longitude, flags,
         capabilities_json, signature_valid, verified, verification_error,
         decoded_json, created_at_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT(packet_id) DO UPDATE SET
         node_id = excluded.node_id,
         node_public_key = excluded.node_public_key,
         advert_timestamp = excluded.advert_timestamp,
          first_observed_at_ms = LEAST(node_adverts.first_observed_at_ms, excluded.first_observed_at_ms),
         name = excluded.name,
         role = excluded.role,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         flags = excluded.flags,
         capabilities_json = excluded.capabilities_json,
         signature_valid = excluded.signature_valid,
         verified = excluded.verified,
         verification_error = excluded.verification_error,
         decoded_json = excluded.decoded_json`,
      packetId,
      node.id,
      key,
      advertTimestamp ?? null,
      seenAt,
      name ?? null,
      role,
      validLocation ? latitude : null,
      validLocation ? longitude : null,
      integer(appData.flags) ?? null,
      safeJson({
        hasLocation: validLocation && appData.hasLocation !== false,
        hasName: appData.hasName,
      }),
      signatureValid ?? null,
      verified,
      text(payload.signatureError, 1_000) ??
        (signatureValid === false ? "Advert signature is invalid" : null),
      safeJson(payload),
      this.now(),
    );
    await transaction.run(
      `INSERT INTO node_sightings(
         node_id, observer_id, packet_id, packet_observation_id, region,
         sighting_type, received_at_ms
        ) VALUES ($1, $2, $3, $4, $5, 'advert', $6)
        ON CONFLICT (node_id, packet_observation_id, sighting_type) DO NOTHING`,
      node.id,
      observerId,
      packetId,
      observationId,
      prepared.topic?.region,
      seenAt,
    );
    await this.refreshAdvertNodes(
      transaction,
      [previousAdvert?.node_id, Number(node.id)].filter(
        (value): value is number => value !== undefined,
      ),
      this.now(),
    );
  }

  private async refreshAdvertNodes(
    transaction: Transaction,
    rawNodeIds: number[],
    now: number,
  ): Promise<void> {
    const nodeIds = [...new Set(rawNodeIds)];
    if (nodeIds.length === 0) return;
    const placeholders = nodeIds.map((_, index) => `$${index + 1}`).join(",");
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
           updated_at_ms = $1
        WHERE id IN (${nodeIds.map((_, index) => `$${index + 2}`).join(",")})`,
      now,
      ...nodeIds,
    );
    await transaction.run(
      `DELETE FROM nodes WHERE id IN (${placeholders})
       AND NOT EXISTS (SELECT 1 FROM node_adverts a WHERE a.node_id = nodes.id)
       AND NOT EXISTS (SELECT 1 FROM node_sightings s WHERE s.node_id = nodes.id)
       AND NOT EXISTS (SELECT 1 FROM telemetry_events t WHERE t.node_id = nodes.id)
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.sender_node_id = nodes.id OR m.destination_node_id = nodes.id)
       AND NOT EXISTS (SELECT 1 FROM trace_events tr WHERE tr.source_node_id = nodes.id)`,
      ...nodeIds,
    );
  }

  private async normalizeTrace(
    transaction: Transaction,
    prepared: PreparedEvent,
    observerId: number,
    packetId: number,
    observationId: number,
  ) {
    if (prepared.packet?.decode.packetType !== "TRACE") return;
    const payload = payloadRecord(prepared.packet.decode);
    if (!payload) return;
    const pathHashes = Array.isArray(payload.pathHashes)
      ? payload.pathHashes.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const snrValues = Array.isArray(payload.snrValues) ? payload.snrValues : [];
    const sourcePrefix = text(payload.sourceHash, 6)?.toUpperCase();
    const source = await this.resolvePrefix(transaction, sourcePrefix);
    const row = await transaction.get(
      `INSERT INTO trace_events(
         packet_id, packet_observation_id, source_node_id, tag,
         reported_at_ms, received_at_ms, decoded_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      packetId,
      observationId,
      source.nodeId ?? null,
      text(payload.traceTag ?? payload.tag, 100) ?? null,
      prepared.packet.reportedAtMs ?? null,
      prepared.event.received_at_ms,
      safeJson(payload),
    );
    if (row?.id === undefined)
      throw new Error("trace event insert returned no id");
    if (source.nodeId !== undefined) {
      await transaction.run(
        `INSERT INTO node_sightings(
           node_id, observer_id, packet_id, packet_observation_id, region,
           sighting_type, received_at_ms
          ) VALUES ($1, $2, $3, $4, $5, 'trace_source', $6)
          ON CONFLICT (node_id, packet_observation_id, sighting_type) DO NOTHING`,
        source.nodeId,
        observerId,
        packetId,
        observationId,
        prepared.topic?.region,
        prepared.event.received_at_ms,
      );
    }
    for (const [index, rawPrefix] of pathHashes.entries()) {
      const prefix = rawPrefix.toUpperCase();
      if (!/^[0-9A-F]{2,6}$/.test(prefix) || prefix.length % 2) continue;
      const resolved = await this.resolvePrefix(transaction, prefix);
      await transaction.run(
        `INSERT INTO trace_hops(
           trace_event_id, hop_index, prefix_hex, prefix_length_bytes, snr,
           resolved_node_id, resolution_confidence
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        row.id,
        index,
        prefix,
        prefix.length / 2,
        finiteNumber(snrValues[index]) ?? null,
        resolved.nodeId ?? null,
        resolved.confidence ?? null,
      );
    }
  }

  private async normalizeMessage(
    transaction: Transaction,
    prepared: PreparedEvent,
    observerId: number,
    packetId: number,
    observationId: number,
  ) {
    const packet = prepared.packet;
    const type = packet?.decode.packetType;
    if (!type || !["TXT_MSG", "GRP_TXT", "GRP_DATA"].includes(type)) return;
    const payload = payloadRecord(packet.decode) ?? {};
    const decrypted = isRecord(payload.decrypted)
      ? payload.decrypted
      : undefined;
    const senderPrefix = text(payload.sourceHash, 6)?.toUpperCase();
    const destinationPrefix = text(payload.destinationHash, 6)?.toUpperCase();
    const sender = await this.resolvePrefix(transaction, senderPrefix);
    const destination = await this.resolvePrefix(
      transaction,
      destinationPrefix,
    );
    const message = text(decrypted?.message, 10_000);
    const channelHash = text(payload.channelHash, 100);
    const channelName =
      channelHash === undefined
        ? undefined
        : this.channelNameResolver?.(channelHash.toLowerCase());
    const decryptedSender = text(decrypted?.sender, 200);
    const decryptedFlags = integer(decrypted?.flags);
    const rawPayloadHex =
      text(payload.ciphertext, 10_000) ??
      packet.decode.decoded?.payload.raw ??
      "";
    const rawPayload = /^[0-9a-f]*$/i.test(rawPayloadHex)
      ? Buffer.from(rawPayloadHex, "hex")
      : Buffer.from(rawPayloadHex);
    await transaction.run(
      `INSERT INTO messages(
         packet_id, packet_observation_id, message_type, channel,
         channel_index, channel_name, sender_prefix, sender_node_id,
         destination_prefix, destination_node_id, encrypted, text,
         decrypted_sender, decrypted_flags, payload_blob, signature,
         signature_valid, reported_at_ms, received_at_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      packetId,
      observationId,
      type,
      channelHash ?? null,
      integer(payload.channelIndex) ?? null,
      channelName ?? null,
      senderPrefix ?? null,
      sender.nodeId ?? null,
      destinationPrefix ?? null,
      destination.nodeId ?? null,
      message === undefined,
      message ?? null,
      decryptedSender ?? null,
      decryptedFlags ?? null,
      rawPayload,
      text(payload.signature, 500) ?? null,
      typeof payload.signatureValid === "boolean"
        ? payload.signatureValid
          ? 1
          : 0
        : null,
      timestampMs(decrypted?.timestamp) ?? packet.reportedAtMs ?? null,
      prepared.event.received_at_ms,
    );
    if (sender.nodeId !== undefined) {
      await transaction.run(
        `INSERT INTO node_sightings(
           node_id, observer_id, packet_id, packet_observation_id, region,
           sighting_type, received_at_ms
          ) VALUES ($1, $2, $3, $4, $5, 'message_sender', $6)
          ON CONFLICT (node_id, packet_observation_id, sighting_type) DO NOTHING`,
        sender.nodeId,
        observerId,
        packetId,
        observationId,
        prepared.topic?.region,
        prepared.event.received_at_ms,
      );
    }
  }

  private async normalizeTelemetry(
    transaction: Transaction,
    prepared: PreparedEvent,
    observerId: number,
    packetId: number,
    observationId: number,
  ) {
    const payload = prepared.packet
      ? payloadRecord(prepared.packet.decode)
      : undefined;
    if (!payload) return;
    const telemetry = Array.isArray(payload.telemetry)
      ? payload.telemetry
      : Array.isArray(payload.values)
        ? payload.values
        : undefined;
    if (!telemetry) return;
    const sourcePrefix = text(payload.sourceHash, 6)?.toUpperCase();
    const source = await this.resolvePrefix(transaction, sourcePrefix);
    const row = await transaction.get(
      `INSERT INTO telemetry_events(
         packet_id, packet_observation_id, node_id, reported_at_ms,
         received_at_ms, decoded_json
        ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      packetId,
      observationId,
      source.nodeId ?? null,
      prepared.packet?.reportedAtMs ?? null,
      prepared.event.received_at_ms,
      safeJson(payload),
    );
    if (row?.id === undefined)
      throw new Error("telemetry event insert returned no id");
    if (source.nodeId !== undefined) {
      await transaction.run(
        `INSERT INTO node_sightings(
           node_id, observer_id, packet_id, packet_observation_id, region,
           sighting_type, received_at_ms
          ) VALUES ($1, $2, $3, $4, $5, 'telemetry_source', $6)
          ON CONFLICT (node_id, packet_observation_id, sighting_type) DO NOTHING`,
        source.nodeId,
        observerId,
        packetId,
        observationId,
        prepared.topic?.region,
        prepared.event.received_at_ms,
      );
    }
    for (const [index, candidate] of telemetry.entries()) {
      if (!isRecord(candidate)) continue;
      const value = candidate.value;
      const numericValue = finiteNumber(value);
      const booleanValue = typeof value === "boolean" ? value : undefined;
      const textValue =
        numericValue === undefined && booleanValue === undefined
          ? text(value, 1_000)
          : undefined;
      if (
        numericValue === undefined &&
        booleanValue === undefined &&
        textValue === undefined
      ) {
        continue;
      }
      await transaction.run(
        `INSERT INTO telemetry_values(
           telemetry_event_id, metric_name, numeric_value, text_value,
           boolean_value, unit, channel, metadata_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        row.id,
        text(candidate.metric_name ?? candidate.name ?? candidate.type, 200) ??
          `value_${index}`,
        numericValue ?? null,
        textValue ?? null,
        booleanValue ?? null,
        canonicalMetricUnit(
          text(
            candidate.metric_name ?? candidate.name ?? candidate.type,
            200,
          ) ?? `value_${index}`,
          text(candidate.unit, 100),
        ),
        integer(candidate.channel) ?? null,
        safeJson(candidate),
      );
    }
  }
}

export function mqttPayloadDigest(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}
