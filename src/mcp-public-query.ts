import type { McpConfig, StorageConfig } from "./config.js";
import {
  CURRENT_SCHEMA_VERSION,
  type ApplicationDatabase,
} from "./database.js";

type DatabaseRow = Record<string, unknown>;

export interface PageMeta {
  generated_at: string;
  retention_days: number;
  next_cursor: string | null;
  has_more: boolean;
  truncated: boolean;
}

export interface PublicPage<T> {
  data: T[];
  meta: PageMeta;
}

interface CursorValue {
  timestamp: number;
  id: number;
}

export interface TimeRange {
  from?: number;
  to?: number;
}

export interface PageInput {
  limit?: number;
  cursor?: string;
}

function number(value: unknown): number {
  return Number(value);
}

function optionalNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function optionalBoolean(value: unknown): boolean | null {
  return value === null || value === undefined ? null : Number(value) === 1;
}

function iso(value: unknown): string {
  return new Date(number(value)).toISOString();
}

function optionalIso(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function optionalProtocolIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const timestamp = number(value);
  return new Date(
    timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp,
  ).toISOString();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function advertCapabilities(value: unknown) {
  const parsed = jsonValue(value);
  const record =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  return {
    has_location:
      typeof record.hasLocation === "boolean" ? record.hasLocation : null,
    has_name: typeof record.hasName === "boolean" ? record.hasName : null,
  };
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function encodeCursor(cursor: CursorValue): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodePublicMcpCursor(value: string): CursorValue {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !Number.isSafeInteger((decoded as CursorValue).timestamp) ||
      !Number.isSafeInteger((decoded as CursorValue).id) ||
      (decoded as CursorValue).timestamp < 0 ||
      (decoded as CursorValue).id < 0
    ) {
      throw new Error("invalid cursor payload");
    }
    return decoded as CursorValue;
  } catch {
    throw new Error("Invalid pagination cursor");
  }
}

const PUBLIC_DECODED_KEYS = new Set([
  "appData",
  "channel",
  "channelIndex",
  "checksum",
  "ciphertext",
  "destinationHash",
  "decoded",
  "deviceRole",
  "errors",
  "flags",
  "hasLocation",
  "hasName",
  "isValid",
  "latitude",
  "location",
  "longitude",
  "name",
  "path",
  "pathHashes",
  "payload",
  "payloadType",
  "publicKey",
  "rawPayload",
  "routeHashSize",
  "routeType",
  "signature",
  "signatureValid",
  "snrValues",
  "sourceHash",
  "tag",
  "telemetry",
  "text",
  "timestamp",
  "traceTag",
  "type",
  "unit",
  "value",
]);

export function selectPublicDecodedData(value: unknown, depth = 0): unknown {
  if (depth > 12) return null;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 1_000)
      .map((item) => selectPublicDecodedData(item, depth + 1));
  }
  if (typeof value !== "object") return null;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!PUBLIC_DECODED_KEYS.has(key)) continue;
    output[key] = selectPublicDecodedData(item, depth + 1);
  }
  return output;
}

function pageLimit(input: PageInput, config: McpConfig): number {
  return Math.min(input.limit ?? config.defaultLimit, config.maxLimit);
}

export class PublicMcpQueryService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly storage: StorageConfig,
    private readonly config: McpConfig,
    private readonly now: () => number = Date.now,
  ) {}

  private meta(nextCursor: string | null = null, hasMore = false): PageMeta {
    return {
      generated_at: new Date(this.now()).toISOString(),
      retention_days: this.storage.retentionDays,
      next_cursor: nextCursor,
      has_more: hasMore,
      truncated: hasMore,
    };
  }

  notFound() {
    return { data: null, meta: this.meta() };
  }

  private range(input: TimeRange): { from: number; to: number } {
    const now = this.now();
    const retainedFrom = now - this.storage.retentionDays * 86_400_000;
    return {
      from: Math.max(input.from ?? retainedFrom, retainedFrom),
      to: Math.min(input.to ?? now, now),
    };
  }

  private page<T extends DatabaseRow, U>(
    rows: T[],
    limit: number,
    timestampField: keyof T,
    mapper: (row: T) => U,
  ): PublicPage<U> {
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const last = selected[selected.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            timestamp: number(last[timestampField]),
            id: number(last.id),
          })
        : null;
    return {
      data: selected.map(mapper),
      meta: this.meta(nextCursor, hasMore),
    };
  }

  async getStorageInfo() {
    const [events, packets, observations, observers, nodes] = await Promise.all(
      [
        this.database.get<DatabaseRow>(
          `SELECT min(received_at_ms) AS oldest_event_at_ms,
                  max(received_at_ms) AS newest_event_at_ms,
                  max(received_at_ms) AS last_ingest_at_ms
           FROM mqtt_events
           WHERE subtopic_root IN ('status', 'packets', 'neighbors')`,
        ),
        this.database.get<DatabaseRow>("SELECT count(*) AS count FROM packets"),
        this.database.get<DatabaseRow>(
          "SELECT count(*) AS count FROM packet_observations",
        ),
        this.database.get<DatabaseRow>(
          "SELECT count(*) AS count FROM observers",
        ),
        this.database.get<DatabaseRow>("SELECT count(*) AS count FROM nodes"),
      ],
    );
    return {
      data: {
        schema_version: CURRENT_SCHEMA_VERSION,
        retention_days: this.storage.retentionDays,
        oldest_event_at: optionalIso(events?.oldest_event_at_ms),
        newest_event_at: optionalIso(events?.newest_event_at_ms),
        packet_count: number(packets?.count ?? 0),
        packet_observation_count: number(observations?.count ?? 0),
        observer_count: number(observers?.count ?? 0),
        node_count: number(nodes?.count ?? 0),
        database_available: true,
        last_ingest_at: optionalIso(events?.last_ingest_at_ms),
      },
      meta: this.meta(),
    };
  }

  async getNetworkSummary(input: TimeRange) {
    const range = this.range(input);
    const [counts, known, median, events] = await Promise.all([
      this.database.get<DatabaseRow>(
        `SELECT
           (SELECT count(DISTINCT observer_id) FROM mqtt_events
             WHERE subtopic_root IN ('status','packets','neighbors')
               AND received_at_ms BETWEEN ? AND ?) AS active_observers,
           (SELECT count(DISTINCT node_id) FROM node_sightings
             WHERE received_at_ms BETWEEN ? AND ?) AS active_nodes,
           (SELECT count(*) FROM nodes WHERE latest_role = 'REPEATER'
             AND last_seen_at_ms BETWEEN ? AND ?) AS active_repeaters,
           (SELECT count(DISTINCT packet_id) FROM packet_observations
             WHERE received_at_ms BETWEEN ? AND ?) AS unique_packets,
           (SELECT count(*) FROM packet_observations
             WHERE received_at_ms BETWEEN ? AND ?) AS packet_observations,
           (SELECT count(*) FROM node_adverts
             WHERE first_observed_at_ms BETWEEN ? AND ?) AS advert_count,
           (SELECT count(*) FROM neighbor_snapshots
             WHERE received_at_ms BETWEEN ? AND ?) AS neighbor_snapshot_count,
           (SELECT count(*) FROM trace_events
             WHERE received_at_ms BETWEEN ? AND ?) AS trace_count,
           (SELECT count(*) FROM telemetry_events
             WHERE received_at_ms BETWEEN ? AND ?) AS telemetry_event_count,
           (SELECT count(*) FROM messages
             WHERE received_at_ms BETWEEN ? AND ?) AS message_count`,
        ...Array.from({ length: 10 }, () => [range.from, range.to]).flat(),
      ),
      this.database.get<DatabaseRow>(
        `SELECT (SELECT count(*) FROM observers) AS known_observers,
                (SELECT count(*) FROM nodes) AS known_nodes`,
      ),
      this.database.get<DatabaseRow>(
        `SELECT
           (SELECT avg(value) FROM (
              SELECT rssi AS value,
                     row_number() OVER (ORDER BY rssi) AS row_number,
                     count(*) OVER () AS value_count
              FROM packet_observations
              WHERE received_at_ms BETWEEN ? AND ? AND rssi IS NOT NULL
            ) WHERE row_number IN ((value_count + 1) / 2, (value_count + 2) / 2)
           ) AS median_rssi,
           (SELECT avg(value) FROM (
              SELECT snr AS value,
                     row_number() OVER (ORDER BY snr) AS row_number,
                     count(*) OVER () AS value_count
              FROM packet_observations
              WHERE received_at_ms BETWEEN ? AND ? AND snr IS NOT NULL
            ) WHERE row_number IN ((value_count + 1) / 2, (value_count + 2) / 2)
           ) AS median_snr`,
        range.from,
        range.to,
        range.from,
        range.to,
      ),
      this.database.get<DatabaseRow>(
        `SELECT min(received_at_ms) AS first_event_at_ms,
                max(received_at_ms) AS last_event_at_ms
         FROM mqtt_events
         WHERE subtopic_root IN ('status','packets','neighbors')
           AND received_at_ms BETWEEN ? AND ?`,
        range.from,
        range.to,
      ),
    ]);
    return {
      data: {
        active_observers: number(counts?.active_observers ?? 0),
        known_observers: number(known?.known_observers ?? 0),
        active_nodes: number(counts?.active_nodes ?? 0),
        known_nodes: number(known?.known_nodes ?? 0),
        active_repeaters: number(counts?.active_repeaters ?? 0),
        unique_packets: number(counts?.unique_packets ?? 0),
        packet_observations: number(counts?.packet_observations ?? 0),
        advert_count: number(counts?.advert_count ?? 0),
        neighbor_snapshot_count: number(counts?.neighbor_snapshot_count ?? 0),
        trace_count: number(counts?.trace_count ?? 0),
        telemetry_event_count: number(counts?.telemetry_event_count ?? 0),
        message_count: number(counts?.message_count ?? 0),
        median_rssi: optionalNumber(median?.median_rssi),
        median_snr: optionalNumber(median?.median_snr),
        first_event_at: optionalIso(events?.first_event_at_ms),
        last_event_at: optionalIso(events?.last_event_at_ms),
      },
      meta: this.meta(),
    };
  }

  async listObservers(
    input: PageInput & { region?: string; activeSince?: number },
  ) {
    const limit = pageLimit(input, this.config);
    const clauses = ["1 = 1"];
    const parameters: unknown[] = [];
    if (input.region) {
      clauses.push("o.latest_region = ?");
      parameters.push(input.region);
    }
    if (input.activeSince !== undefined) {
      clauses.push("o.last_seen_at_ms >= ?");
      parameters.push(input.activeSince);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor);
      clauses.push(
        "(o.last_seen_at_ms < ? OR (o.last_seen_at_ms = ? AND o.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT o.id, o.public_key, o.latest_region, o.first_seen_at_ms,
              o.last_seen_at_ms,
              (SELECT model FROM observer_status_events se
                WHERE se.observer_id = o.id
                ORDER BY received_at_ms DESC, id DESC LIMIT 1) AS latest_model,
              (SELECT firmware_version FROM observer_status_events se
                WHERE se.observer_id = o.id
                ORDER BY received_at_ms DESC, id DESC LIMIT 1) AS latest_firmware,
              (SELECT received_at_ms FROM observer_status_events se
                WHERE se.observer_id = o.id
                ORDER BY received_at_ms DESC, id DESC LIMIT 1) AS latest_status_at_ms,
              (SELECT count(*) FROM packet_observations po
                WHERE po.observer_id = o.id) AS packet_observation_count,
              (SELECT json_object(
                  'frequency_mhz', frequency_mhz,
                  'bandwidth_khz', bandwidth_khz,
                  'spreading_factor', spreading_factor,
                  'coding_rate', coding_rate,
                  'tx_power_dbm', tx_power_dbm)
                FROM observer_radio_history rh WHERE rh.observer_id = o.id
                ORDER BY received_at_ms DESC, id DESC LIMIT 1) AS radio_json
       FROM observers o WHERE ${clauses.join(" AND ")}
       ORDER BY o.last_seen_at_ms DESC, o.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "last_seen_at_ms", (row) => ({
      public_key: String(row.public_key),
      latest_region: optionalText(row.latest_region),
      first_seen_at: iso(row.first_seen_at_ms),
      last_seen_at: iso(row.last_seen_at_ms),
      latest_model: optionalText(row.latest_model),
      latest_firmware: optionalText(row.latest_firmware),
      latest_radio_config: jsonValue(row.radio_json),
      latest_status_at: optionalIso(row.latest_status_at_ms),
      packet_observation_count: number(row.packet_observation_count),
    }));
  }

  async getObserver(publicKey: string) {
    const observer = await this.database.get<DatabaseRow>(
      `SELECT o.id, o.public_key, o.first_seen_at_ms, o.last_seen_at_ms,
              (SELECT count(*) FROM packet_observations po
                WHERE po.observer_id = o.id) AS packet_observation_count
       FROM observers o WHERE o.public_key = ?`,
      publicKey,
    );
    if (!observer) return null;
    const [regions, status, metrics, radio] = await Promise.all([
      this.database.all<DatabaseRow>(
        `SELECT region FROM observer_region_history WHERE observer_id = ?
         ORDER BY last_seen_at_ms DESC, region`,
        observer.id,
      ),
      this.database.get<DatabaseRow>(
        `SELECT id, mqtt_event_id, region, reported_at_ms, received_at_ms,
                origin, model, firmware_version
         FROM observer_status_events WHERE observer_id = ?
         ORDER BY received_at_ms DESC, id DESC LIMIT 1`,
        observer.id,
      ),
      this.database.all<DatabaseRow>(
        `SELECT metric_name, numeric_value, text_value, boolean_value, unit
         FROM observer_metrics WHERE observer_id = ?
           AND mqtt_event_id = (
             SELECT mqtt_event_id FROM observer_status_events
             WHERE observer_id = ? ORDER BY received_at_ms DESC, id DESC LIMIT 1
           ) ORDER BY metric_name`,
        observer.id,
        observer.id,
      ),
      this.database.get<DatabaseRow>(
        `SELECT frequency_mhz, bandwidth_khz, spreading_factor, coding_rate,
                tx_power_dbm, received_at_ms
         FROM observer_radio_history WHERE observer_id = ?
         ORDER BY received_at_ms DESC, id DESC LIMIT 1`,
        observer.id,
      ),
    ]);
    return {
      data: {
        public_key: String(observer.public_key),
        first_seen_at: iso(observer.first_seen_at_ms),
        last_seen_at: iso(observer.last_seen_at_ms),
        regions: regions.map((row) => String(row.region)),
        latest_status: status
          ? {
              region: String(status.region),
              reported_at: optionalIso(status.reported_at_ms),
              received_at: iso(status.received_at_ms),
              origin: optionalText(status.origin),
              model: optionalText(status.model),
              firmware_version: optionalText(status.firmware_version),
            }
          : null,
        model: optionalText(status?.model),
        firmware: optionalText(status?.firmware_version),
        radio_configuration: radio
          ? {
              frequency_mhz: optionalNumber(radio.frequency_mhz),
              bandwidth_khz: optionalNumber(radio.bandwidth_khz),
              spreading_factor: optionalNumber(radio.spreading_factor),
              coding_rate: optionalNumber(radio.coding_rate),
              tx_power_dbm: optionalNumber(radio.tx_power_dbm),
              received_at: iso(radio.received_at_ms),
            }
          : null,
        public_status_metrics: metrics.map((row) => ({
          metric_name: String(row.metric_name),
          numeric_value: optionalNumber(row.numeric_value),
          text_value: optionalText(row.text_value),
          boolean_value: optionalBoolean(row.boolean_value),
          unit: optionalText(row.unit),
        })),
        packet_observation_count: number(observer.packet_observation_count),
      },
      meta: this.meta(),
    };
  }

  async getObserverStatusHistory(
    input: PageInput &
      TimeRange & {
        observerPublicKey: string;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const parameters: unknown[] = [
      input.observerPublicKey,
      range.from,
      range.to,
    ];
    const cursorClause = input.cursor
      ? "AND (se.received_at_ms < ? OR (se.received_at_ms = ? AND se.id < ?))"
      : "";
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor);
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT se.id, se.mqtt_event_id, se.region, se.reported_at_ms,
              se.received_at_ms, se.origin, se.model, se.firmware_version,
              rh.frequency_mhz, rh.bandwidth_khz, rh.spreading_factor,
              rh.coding_rate, rh.tx_power_dbm
       FROM observer_status_events se
       JOIN observers o ON o.id = se.observer_id
       LEFT JOIN observer_radio_history rh ON rh.mqtt_event_id = se.mqtt_event_id
       WHERE o.public_key = ? AND se.received_at_ms BETWEEN ? AND ?
       ${cursorClause}
       ORDER BY se.received_at_ms DESC, se.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    const eventIds = rows
      .slice(0, limit)
      .map((row) => number(row.mqtt_event_id));
    const metricRows =
      eventIds.length === 0
        ? []
        : await this.database.all<DatabaseRow>(
            `SELECT mqtt_event_id, metric_name, numeric_value, text_value,
                    boolean_value, unit FROM observer_metrics
             WHERE mqtt_event_id IN (${eventIds.map(() => "?").join(",")})
             ORDER BY mqtt_event_id, metric_name`,
            ...eventIds,
          );
    const metrics = new Map<number, DatabaseRow[]>();
    for (const metric of metricRows) {
      const eventId = number(metric.mqtt_event_id);
      const list = metrics.get(eventId) ?? [];
      list.push(metric);
      metrics.set(eventId, list);
    }
    return this.page(rows, limit, "received_at_ms", (row) => ({
      region: String(row.region),
      reported_at: optionalIso(row.reported_at_ms),
      received_at: iso(row.received_at_ms),
      origin: optionalText(row.origin),
      model: optionalText(row.model),
      firmware_version: optionalText(row.firmware_version),
      radio_configuration: {
        frequency_mhz: optionalNumber(row.frequency_mhz),
        bandwidth_khz: optionalNumber(row.bandwidth_khz),
        spreading_factor: optionalNumber(row.spreading_factor),
        coding_rate: optionalNumber(row.coding_rate),
        tx_power_dbm: optionalNumber(row.tx_power_dbm),
      },
      metrics: (metrics.get(number(row.mqtt_event_id)) ?? []).map((metric) => ({
        metric_name: String(metric.metric_name),
        numeric_value: optionalNumber(metric.numeric_value),
        text_value: optionalText(metric.text_value),
        boolean_value: optionalBoolean(metric.boolean_value),
        unit: optionalText(metric.unit),
      })),
    }));
  }

  async listNodes(
    input: PageInput & {
      role?: string;
      name?: string;
      publicKey?: string;
      region?: string;
      activeSince?: number;
    },
  ) {
    const limit = pageLimit(input, this.config);
    const clauses = ["1 = 1"];
    const parameters: unknown[] = [];
    if (input.role) {
      clauses.push("n.latest_role = ?");
      parameters.push(input.role);
    }
    if (input.name) {
      clauses.push("n.latest_name LIKE ? ESCAPE '\\'");
      parameters.push(`%${input.name.replace(/[\\%_]/g, "\\$&")}%`);
    }
    if (input.publicKey) {
      clauses.push("n.public_key = ?");
      parameters.push(input.publicKey);
    }
    if (input.region) {
      clauses.push(
        "EXISTS (SELECT 1 FROM node_sightings s WHERE s.node_id = n.id AND s.region = ?)",
      );
      parameters.push(input.region);
    }
    if (input.activeSince !== undefined) {
      clauses.push("n.last_seen_at_ms >= ?");
      parameters.push(input.activeSince);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor);
      clauses.push(
        "(n.last_seen_at_ms < ? OR (n.last_seen_at_ms = ? AND n.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT n.id, n.public_key, n.latest_name, n.latest_role,
              n.first_seen_at_ms, n.last_seen_at_ms, n.latest_latitude,
              n.latest_longitude, n.latest_advert_timestamp,
              (SELECT count(*) FROM node_sightings s WHERE s.node_id = n.id)
                AS sighting_count
       FROM nodes n WHERE ${clauses.join(" AND ")}
       ORDER BY n.last_seen_at_ms DESC, n.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "last_seen_at_ms", (row) => ({
      public_key: String(row.public_key),
      name: optionalText(row.latest_name),
      role: optionalText(row.latest_role),
      first_seen_at: iso(row.first_seen_at_ms),
      last_seen_at: iso(row.last_seen_at_ms),
      latitude: optionalNumber(row.latest_latitude),
      longitude: optionalNumber(row.latest_longitude),
      latest_advert_at: optionalIso(row.latest_advert_timestamp),
      sighting_count: number(row.sighting_count),
    }));
  }

  async getNode(publicKey: string) {
    const node = await this.database.get<DatabaseRow>(
      `SELECT n.*,
              (SELECT count(DISTINCT observer_id) FROM node_sightings s
                WHERE s.node_id = n.id) AS observer_count,
              (SELECT count(*) FROM node_sightings s
                WHERE s.node_id = n.id) AS sighting_count
       FROM nodes n WHERE n.public_key = ?`,
      publicKey,
    );
    if (!node) return null;
    const [advert, regions, telemetry] = await Promise.all([
      this.database.get<DatabaseRow>(
        `SELECT a.*, p.packet_sha256 FROM node_adverts a
         JOIN packets p ON p.id = a.packet_id WHERE a.node_id = ?
         ORDER BY a.first_observed_at_ms DESC, a.id DESC LIMIT 1`,
        node.id,
      ),
      this.database.all<DatabaseRow>(
        `SELECT region, max(received_at_ms) AS last_seen_at_ms
         FROM node_sightings WHERE node_id = ? GROUP BY region
         ORDER BY last_seen_at_ms DESC, region`,
        node.id,
      ),
      this.database.all<DatabaseRow>(
        `SELECT tv.metric_name, tv.numeric_value, tv.text_value,
                tv.boolean_value, tv.unit, tv.channel, te.received_at_ms
         FROM telemetry_values tv
         JOIN telemetry_events te ON te.id = tv.telemetry_event_id
         WHERE te.node_id = ? ORDER BY te.received_at_ms DESC, tv.id DESC
         LIMIT 50`,
        node.id,
      ),
    ]);
    return {
      data: {
        public_key: String(node.public_key),
        name: optionalText(node.latest_name),
        role: optionalText(node.latest_role),
        first_seen_at: iso(node.first_seen_at_ms),
        last_seen_at: iso(node.last_seen_at_ms),
        latest_position:
          node.latest_latitude !== null && node.latest_longitude !== null
            ? {
                latitude: number(node.latest_latitude),
                longitude: number(node.latest_longitude),
              }
            : null,
        latest_advert: advert
          ? {
              advert_timestamp: optionalProtocolIso(advert.advert_timestamp),
              first_observed_at: iso(advert.first_observed_at_ms),
              name: optionalText(advert.name),
              role: optionalText(advert.role),
              latitude: optionalNumber(advert.latitude),
              longitude: optionalNumber(advert.longitude),
              flags: optionalNumber(advert.flags),
              capabilities: advertCapabilities(advert.capabilities_json),
              verified: number(advert.verified) === 1,
              signature_valid: optionalBoolean(advert.signature_valid),
              packet_hash: String(advert.packet_sha256),
            }
          : null,
        regions_seen: regions.map((row) => ({
          region: String(row.region),
          last_seen_at: iso(row.last_seen_at_ms),
        })),
        observer_count: number(node.observer_count),
        sighting_count: number(node.sighting_count),
        recent_telemetry_summary: telemetry.map((row) => ({
          timestamp: iso(row.received_at_ms),
          metric_name: String(row.metric_name),
          numeric_value: optionalNumber(row.numeric_value),
          text_value: optionalText(row.text_value),
          boolean_value: optionalBoolean(row.boolean_value),
          unit: optionalText(row.unit),
          channel: optionalNumber(row.channel),
        })),
      },
      meta: this.meta(),
    };
  }

  async getNodeAdverts(input: PageInput & TimeRange & { publicKey: string }) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const parameters: unknown[] = [input.publicKey, range.from, range.to];
    let cursorClause = "";
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor);
      cursorClause =
        "AND (a.first_observed_at_ms < ? OR (a.first_observed_at_ms = ? AND a.id < ?))";
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT a.*, p.packet_sha256 FROM node_adverts a
       JOIN nodes n ON n.id = a.node_id JOIN packets p ON p.id = a.packet_id
       WHERE n.public_key = ? AND a.first_observed_at_ms BETWEEN ? AND ?
       ${cursorClause}
       ORDER BY a.first_observed_at_ms DESC, a.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "first_observed_at_ms", (row) => ({
      advert_timestamp: optionalProtocolIso(row.advert_timestamp),
      first_observed_at: iso(row.first_observed_at_ms),
      public_key: String(row.node_public_key),
      name: optionalText(row.name),
      role: optionalText(row.role),
      latitude: optionalNumber(row.latitude),
      longitude: optionalNumber(row.longitude),
      flags: optionalNumber(row.flags),
      capabilities: advertCapabilities(row.capabilities_json),
      verified: number(row.verified) === 1,
      signature_valid: optionalBoolean(row.signature_valid),
      packet_hash: String(row.packet_sha256),
    }));
  }

  async getNodeSightings(
    input: PageInput &
      TimeRange & {
        nodePublicKey: string;
        observerPublicKey?: string;
        region?: string;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const clauses = ["n.public_key = ?", "s.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [input.nodePublicKey, range.from, range.to];
    if (input.observerPublicKey) {
      clauses.push("o.public_key = ?");
      parameters.push(input.observerPublicKey);
    }
    if (input.region) {
      clauses.push("s.region = ?");
      parameters.push(input.region);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor);
      clauses.push(
        "(s.received_at_ms < ? OR (s.received_at_ms = ? AND s.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT s.id, s.received_at_ms, s.region, s.sighting_type,
              o.public_key AS observer_public_key, p.packet_sha256
       FROM node_sightings s JOIN nodes n ON n.id = s.node_id
       JOIN observers o ON o.id = s.observer_id
       JOIN packets p ON p.id = s.packet_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY s.received_at_ms DESC, s.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "received_at_ms", (row) => ({
      node_public_key: input.nodePublicKey,
      observer_public_key: String(row.observer_public_key),
      region: String(row.region),
      timestamp: iso(row.received_at_ms),
      sighting_type: String(row.sighting_type),
      packet_hash: String(row.packet_sha256),
    }));
  }

  async resolveNodePrefix(prefixHex: string) {
    const candidates = await this.database.all<DatabaseRow>(
      `SELECT n.public_key, n.latest_name, n.latest_role,
              max(pc.confidence) AS confidence,
              sum(pc.evidence_count) AS evidence_count
       FROM node_prefix_candidates pc JOIN nodes n ON n.id = pc.node_id
       WHERE n.public_key LIKE ?
       GROUP BY n.id, n.public_key, n.latest_name, n.latest_role
       ORDER BY confidence DESC, evidence_count DESC, n.public_key LIMIT 251`,
      `${prefixHex}%`,
    );
    return {
      data: {
        prefix_hex: prefixHex,
        prefix_length_bytes: prefixHex.length / 2,
        candidates: candidates.slice(0, 250).map((row) => ({
          public_key: String(row.public_key),
          name: optionalText(row.latest_name),
          role: optionalText(row.latest_role),
          confidence: number(row.confidence),
          evidence_count: number(row.evidence_count),
        })),
        ambiguous: candidates.length !== 1,
      },
      meta: this.meta(null, candidates.length > 250),
    };
  }

  async searchPackets(
    input: PageInput &
      TimeRange & {
        packetHash?: string;
        observerPublicKey?: string;
        nodePublicKey?: string;
        region?: string;
        packetType?: string;
        payloadType?: string;
        routeType?: string;
        minRssi?: number;
        maxRssi?: number;
        minSnr?: number;
        maxSnr?: number;
        minScore?: number;
        maxScore?: number;
        minHops?: number;
        maxHops?: number;
        decodeStatus?: string;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const clauses = ["po.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [range.from, range.to];
    const equalFilters: Array<[unknown, string]> = [
      [input.packetHash, "p.packet_sha256 = ?"],
      [input.observerPublicKey, "o.public_key = ?"],
      [input.region, "po.region = ?"],
      [input.packetType, "p.packet_type = ?"],
      [input.payloadType, "p.payload_type = ?"],
      [input.routeType, "p.route_type = ?"],
      [input.decodeStatus, "p.decode_status = ?"],
    ];
    for (const [value, clause] of equalFilters) {
      if (value !== undefined) {
        clauses.push(clause);
        parameters.push(value);
      }
    }
    const rangeFilters: Array<[number | undefined, string]> = [
      [input.minRssi, "po.rssi >= ?"],
      [input.maxRssi, "po.rssi <= ?"],
      [input.minSnr, "po.snr >= ?"],
      [input.maxSnr, "po.snr <= ?"],
      [input.minScore, "po.score >= ?"],
      [input.maxScore, "po.score <= ?"],
      [input.minHops, "coalesce(pp.hop_count, 0) >= ?"],
      [input.maxHops, "coalesce(pp.hop_count, 0) <= ?"],
    ];
    for (const [value, clause] of rangeFilters) {
      if (value !== undefined) {
        clauses.push(clause);
        parameters.push(value);
      }
    }
    if (input.nodePublicKey) {
      clauses.push(
        "EXISTS (SELECT 1 FROM node_sightings s JOIN nodes n ON n.id = s.node_id WHERE s.packet_id = p.id AND n.public_key = ?)",
      );
      parameters.push(input.nodePublicKey);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor);
      clauses.push(
        "(p.last_seen_at_ms < ? OR (p.last_seen_at_ms = ? AND p.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT p.id, p.packet_sha256, p.packet_length, p.packet_type,
              p.payload_type, p.route_type, p.decode_status,
              p.first_seen_at_ms, p.last_seen_at_ms,
              count(DISTINCT po.id) AS observation_count,
              min(po.rssi) AS min_rssi, max(po.rssi) AS max_rssi,
              min(po.snr) AS min_snr, max(po.snr) AS max_snr,
              max(coalesce(pp.hop_count, 0)) AS hop_count
       FROM packets p JOIN packet_observations po ON po.packet_id = p.id
       JOIN observers o ON o.id = po.observer_id
       LEFT JOIN packet_paths pp ON pp.packet_observation_id = po.id
       WHERE ${clauses.join(" AND ")}
       GROUP BY p.id ORDER BY p.last_seen_at_ms DESC, p.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "last_seen_at_ms", (row) => ({
      packet_hash: String(row.packet_sha256),
      packet_length: number(row.packet_length),
      packet_type: optionalText(row.packet_type),
      payload_type: optionalText(row.payload_type),
      route_type: optionalText(row.route_type),
      decode_status: String(row.decode_status),
      first_seen_at: iso(row.first_seen_at_ms),
      last_seen_at: iso(row.last_seen_at_ms),
      observation_count: number(row.observation_count),
      min_rssi: optionalNumber(row.min_rssi),
      max_rssi: optionalNumber(row.max_rssi),
      min_snr: optionalNumber(row.min_snr),
      max_snr: optionalNumber(row.max_snr),
      hop_count: number(row.hop_count),
    }));
  }

  async getPacket(packetHash: string) {
    const packet = await this.database.get<DatabaseRow>(
      `SELECT p.*,
              (SELECT count(*) FROM packet_observations po
                WHERE po.packet_id = p.id) AS observation_count
       FROM packets p WHERE p.packet_sha256 = ?`,
      packetHash,
    );
    if (!packet) return null;
    const paths = await this.database.all<DatabaseRow>(
      `SELECT pp.id, hex(pp.raw_path_blob) AS raw_path, pp.hop_count,
              po.id AS observation_id, po.received_at_ms
       FROM packet_paths pp
       JOIN packet_observations po ON po.id = pp.packet_observation_id
       WHERE po.packet_id = ? ORDER BY po.received_at_ms DESC, po.id DESC
       LIMIT 250`,
      packet.id,
    );
    return {
      data: {
        packet_hash: String(packet.packet_sha256),
        packet_length: number(packet.packet_length),
        packet_type: optionalText(packet.packet_type),
        packet_type_code: optionalNumber(packet.packet_type_code),
        payload_type: optionalText(packet.payload_type),
        payload_type_code: optionalNumber(packet.payload_type_code),
        route_type: optionalText(packet.route_type),
        decode_status: String(packet.decode_status),
        decoder_name: optionalText(packet.decoder_name),
        decoder_version: optionalText(packet.decoder_version),
        decoded_data: selectPublicDecodedData(jsonValue(packet.decoded_json)),
        raw_packet_hex: String(packet.raw_packet_hex),
        first_seen_at: iso(packet.first_seen_at_ms),
        last_seen_at: iso(packet.last_seen_at_ms),
        observation_count: number(packet.observation_count),
        paths: paths.map((row) => ({
          observation_id: number(row.observation_id),
          raw_path: String(row.raw_path),
          hop_count: number(row.hop_count),
          received_at: iso(row.received_at_ms),
        })),
      },
      meta: this.meta(null, paths.length === 250),
    };
  }

  async getPacketObservations(
    input: PageInput & {
      packetHash: string;
      observerPublicKey?: string;
    },
  ) {
    const limit = pageLimit(input, this.config);
    const clauses = ["p.packet_sha256 = ?"];
    const parameters: unknown[] = [input.packetHash];
    if (input.observerPublicKey) {
      clauses.push("o.public_key = ?");
      parameters.push(input.observerPublicKey);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor);
      clauses.push(
        "(po.received_at_ms < ? OR (po.received_at_ms = ? AND po.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT po.id, o.public_key AS observer_public_key, po.region,
              po.received_at_ms, po.reported_at_ms, po.rssi, po.snr,
              po.score, po.direction, hex(pp.raw_path_blob) AS raw_path,
              pp.hop_count
       FROM packet_observations po JOIN packets p ON p.id = po.packet_id
       JOIN observers o ON o.id = po.observer_id
       LEFT JOIN packet_paths pp ON pp.packet_observation_id = po.id
       WHERE ${clauses.join(" AND ")}
       ORDER BY po.received_at_ms DESC, po.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "received_at_ms", (row) => ({
      observation_id: number(row.id),
      observer_public_key: String(row.observer_public_key),
      region: String(row.region),
      received_at: iso(row.received_at_ms),
      reported_at: optionalIso(row.reported_at_ms),
      rssi: optionalNumber(row.rssi),
      snr: optionalNumber(row.snr),
      score: optionalNumber(row.score),
      direction: optionalText(row.direction),
      path:
        typeof row.raw_path !== "string"
          ? null
          : {
              raw_path: row.raw_path,
              hop_count: number(row.hop_count),
            },
    }));
  }

  async getNeighbors(input: { observerPublicKey: string; at?: number }) {
    const snapshot = await this.database.get<DatabaseRow>(
      `SELECT ns.id, o.public_key AS observer_public_key, ns.reported_at_ms,
              ns.received_at_ms, ns.mqtt_retained, ns.self_scopes_json
       FROM neighbor_snapshots ns JOIN observers o ON o.id = ns.observer_id
       WHERE o.public_key = ? ${input.at === undefined ? "" : "AND ns.received_at_ms <= ?"}
       ORDER BY ns.received_at_ms DESC, ns.id DESC LIMIT 1`,
      input.observerPublicKey,
      ...(input.at === undefined ? [] : [input.at]),
    );
    if (!snapshot) return this.notFound();
    const neighbors = await this.database.all<DatabaseRow>(
      `SELECT neighbor_public_key, snr, rssi, heard_secs_ago,
              calculated_last_heard_at_ms, status, scopes_json
       FROM neighbor_entries WHERE snapshot_id = ?
       ORDER BY neighbor_public_key LIMIT 250`,
      snapshot.id,
    );
    return {
      data: {
        observer_public_key: String(snapshot.observer_public_key),
        snapshot_timestamp: iso(snapshot.received_at_ms),
        reported_timestamp: optionalIso(snapshot.reported_at_ms),
        mqtt_retained: number(snapshot.mqtt_retained) === 1,
        observer_scopes: jsonValue(snapshot.self_scopes_json),
        neighbors: neighbors.map((row) => ({
          public_key: String(row.neighbor_public_key),
          snr: optionalNumber(row.snr),
          rssi: optionalNumber(row.rssi),
          heard_secs_ago: optionalNumber(row.heard_secs_ago),
          calculated_last_heard_at: optionalIso(
            row.calculated_last_heard_at_ms,
          ),
          status: String(row.status),
          scopes: jsonValue(row.scopes_json),
        })),
      },
      meta: this.meta(null, neighbors.length === 250),
    };
  }

  async getNeighborHistory(
    input: PageInput &
      TimeRange & {
        observerPublicKey: string;
        neighborPublicKey?: string;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const clauses = ["o.public_key = ?", "ns.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [
      input.observerPublicKey,
      range.from,
      range.to,
    ];
    if (input.neighborPublicKey) {
      clauses.push("ne.neighbor_public_key = ?");
      parameters.push(input.neighborPublicKey);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor);
      clauses.push(
        "(ns.received_at_ms < ? OR (ns.received_at_ms = ? AND ne.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT ne.id, o.public_key AS observer_public_key,
              ne.neighbor_public_key, ns.received_at_ms,
              ns.reported_at_ms, ns.mqtt_retained, ne.snr, ne.rssi,
              ne.heard_secs_ago, ne.calculated_last_heard_at_ms,
              ne.status, ne.scopes_json
       FROM neighbor_entries ne
       JOIN neighbor_snapshots ns ON ns.id = ne.snapshot_id
       JOIN observers o ON o.id = ns.observer_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY ns.received_at_ms DESC, ne.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "received_at_ms", (row) => ({
      observer_public_key: String(row.observer_public_key),
      neighbor_public_key: String(row.neighbor_public_key),
      snapshot_timestamp: iso(row.received_at_ms),
      reported_timestamp: optionalIso(row.reported_at_ms),
      mqtt_retained: number(row.mqtt_retained) === 1,
      snr: optionalNumber(row.snr),
      rssi: optionalNumber(row.rssi),
      heard_secs_ago: optionalNumber(row.heard_secs_ago),
      calculated_last_heard_at: optionalIso(row.calculated_last_heard_at_ms),
      status: String(row.status),
      scopes: jsonValue(row.scopes_json),
    }));
  }

  async getPacketPath(input: { packetHash: string; observationId?: number }) {
    const path = await this.database.get<DatabaseRow>(
      `SELECT pp.id, po.id AS observation_id, hex(pp.raw_path_blob) AS raw_path,
              pp.hop_count, po.received_at_ms
       FROM packet_paths pp
       JOIN packet_observations po ON po.id = pp.packet_observation_id
       JOIN packets p ON p.id = po.packet_id
       WHERE p.packet_sha256 = ? ${input.observationId === undefined ? "" : "AND po.id = ?"}
       ORDER BY po.received_at_ms DESC, po.id DESC LIMIT 1`,
      input.packetHash,
      ...(input.observationId === undefined ? [] : [input.observationId]),
    );
    if (!path) return this.notFound();
    const hops = await this.database.all<DatabaseRow>(
      `SELECT ph.hop_index, ph.prefix_hex, ph.prefix_length_bytes,
              n.public_key AS resolved_public_key, ph.resolution_status,
              ph.resolution_confidence
       FROM packet_path_hops ph
       LEFT JOIN nodes n ON n.id = ph.resolved_node_id
       WHERE ph.path_id = ? ORDER BY ph.hop_index`,
      path.id,
    );
    return {
      data: {
        packet_hash: input.packetHash,
        observation_id: number(path.observation_id),
        raw_path: String(path.raw_path),
        hop_count: number(path.hop_count),
        received_at: iso(path.received_at_ms),
        hops: hops.map((row) => ({
          index: number(row.hop_index),
          prefix: String(row.prefix_hex),
          prefix_length_bytes: number(row.prefix_length_bytes),
          resolved_public_key: optionalText(row.resolved_public_key),
          resolution_status: String(row.resolution_status),
          confidence: optionalNumber(row.resolution_confidence),
        })),
      },
      meta: this.meta(),
    };
  }

  async getSignalHistory(input: {
    observerPublicKey: string;
    nodePublicKey?: string;
    packetType?: string;
    from: number;
    to: number;
    bucketMs: number;
    limit?: number;
  }) {
    const limit = Math.min(
      input.limit ?? this.config.defaultLimit,
      this.config.maxLimit,
    );
    const range = this.range(input);
    const clauses = ["o.public_key = ?", "po.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [
      input.observerPublicKey,
      range.from,
      range.to,
    ];
    if (input.nodePublicKey) {
      clauses.push(
        "EXISTS (SELECT 1 FROM node_sightings s JOIN nodes n ON n.id = s.node_id WHERE s.packet_observation_id = po.id AND n.public_key = ?)",
      );
      parameters.push(input.nodePublicKey);
    }
    if (input.packetType) {
      clauses.push("p.packet_type = ?");
      parameters.push(input.packetType);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT CAST(po.received_at_ms / ? AS INTEGER) * ? AS bucket_at_ms,
              avg(po.rssi) AS rssi, avg(po.snr) AS snr,
              avg(po.score) AS score, count(*) AS packet_count
       FROM packet_observations po JOIN observers o ON o.id = po.observer_id
       JOIN packets p ON p.id = po.packet_id
       WHERE ${clauses.join(" AND ")}
       GROUP BY bucket_at_ms ORDER BY bucket_at_ms DESC LIMIT ?`,
      input.bucketMs,
      input.bucketMs,
      ...parameters,
      limit + 1,
    );
    const hasMore = rows.length > limit;
    return {
      data: rows.slice(0, limit).map((row) => ({
        timestamp: iso(row.bucket_at_ms),
        rssi: optionalNumber(row.rssi),
        snr: optionalNumber(row.snr),
        score: optionalNumber(row.score),
        packet_count: number(row.packet_count),
      })),
      meta: this.meta(null, hasMore),
    };
  }

  async searchTraces(
    input: PageInput &
      TimeRange & {
        sourceNodePublicKey?: string;
        observerPublicKey?: string;
        tag?: string;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const clauses = ["tr.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [range.from, range.to];
    if (input.sourceNodePublicKey) {
      clauses.push("source.public_key = ?");
      parameters.push(input.sourceNodePublicKey);
    }
    if (input.observerPublicKey) {
      clauses.push("o.public_key = ?");
      parameters.push(input.observerPublicKey);
    }
    if (input.tag) {
      clauses.push("tr.tag = ?");
      parameters.push(input.tag);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor);
      clauses.push(
        "(tr.received_at_ms < ? OR (tr.received_at_ms = ? AND tr.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT tr.id, p.packet_sha256, o.public_key AS observer_public_key,
              source.public_key AS source_public_key, tr.tag,
              tr.reported_at_ms, tr.received_at_ms,
              (SELECT count(*) FROM trace_hops th
                WHERE th.trace_event_id = tr.id) AS hop_count
       FROM trace_events tr JOIN packets p ON p.id = tr.packet_id
       JOIN packet_observations po ON po.id = tr.packet_observation_id
       JOIN observers o ON o.id = po.observer_id
       LEFT JOIN nodes source ON source.id = tr.source_node_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY tr.received_at_ms DESC, tr.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "received_at_ms", (row) => ({
      trace_id: number(row.id),
      packet_hash: String(row.packet_sha256),
      observer_public_key: String(row.observer_public_key),
      source_public_key: optionalText(row.source_public_key),
      tag: optionalText(row.tag),
      reported_at: optionalIso(row.reported_at_ms),
      received_at: iso(row.received_at_ms),
      hop_count: number(row.hop_count),
    }));
  }

  async getTrace(traceId: number) {
    const trace = await this.database.get<DatabaseRow>(
      `SELECT tr.id, p.packet_sha256, o.public_key AS observer_public_key,
              source.public_key AS source_public_key, tr.tag,
              tr.reported_at_ms, tr.received_at_ms
       FROM trace_events tr JOIN packets p ON p.id = tr.packet_id
       JOIN packet_observations po ON po.id = tr.packet_observation_id
       JOIN observers o ON o.id = po.observer_id
       LEFT JOIN nodes source ON source.id = tr.source_node_id
       WHERE tr.id = ?`,
      traceId,
    );
    if (!trace) return this.notFound();
    const hops = await this.database.all<DatabaseRow>(
      `SELECT th.hop_index, th.prefix_hex, th.prefix_length_bytes, th.snr,
              n.public_key AS resolved_public_key, th.resolution_confidence
       FROM trace_hops th LEFT JOIN nodes n ON n.id = th.resolved_node_id
       WHERE th.trace_event_id = ? ORDER BY th.hop_index`,
      traceId,
    );
    return {
      data: {
        trace_id: number(trace.id),
        packet_hash: String(trace.packet_sha256),
        observer_public_key: String(trace.observer_public_key),
        source_public_key: optionalText(trace.source_public_key),
        tag: optionalText(trace.tag),
        reported_at: optionalIso(trace.reported_at_ms),
        received_at: iso(trace.received_at_ms),
        hops: hops.map((row) => ({
          index: number(row.hop_index),
          prefix: String(row.prefix_hex),
          prefix_length_bytes: number(row.prefix_length_bytes),
          snr: optionalNumber(row.snr),
          resolved_public_key: optionalText(row.resolved_public_key),
          confidence: optionalNumber(row.resolution_confidence),
        })),
      },
      meta: this.meta(),
    };
  }

  async getTelemetry(
    input: PageInput &
      TimeRange & {
        nodePublicKey: string;
        metric?: string;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const clauses = ["n.public_key = ?", "te.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [input.nodePublicKey, range.from, range.to];
    if (input.metric) {
      clauses.push("tv.metric_name = ?");
      parameters.push(input.metric);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor);
      clauses.push(
        "(te.received_at_ms < ? OR (te.received_at_ms = ? AND tv.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT tv.id, te.received_at_ms, te.reported_at_ms, tv.metric_name,
              tv.numeric_value, tv.text_value, tv.boolean_value, tv.unit,
              tv.channel, p.packet_sha256
       FROM telemetry_values tv
       JOIN telemetry_events te ON te.id = tv.telemetry_event_id
       JOIN nodes n ON n.id = te.node_id JOIN packets p ON p.id = te.packet_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY te.received_at_ms DESC, tv.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "received_at_ms", (row) => ({
      timestamp: iso(row.received_at_ms),
      reported_at: optionalIso(row.reported_at_ms),
      metric_name: String(row.metric_name),
      numeric_value: optionalNumber(row.numeric_value),
      text_value: optionalText(row.text_value),
      boolean_value: optionalBoolean(row.boolean_value),
      unit: optionalText(row.unit),
      channel: optionalNumber(row.channel),
      packet_hash: String(row.packet_sha256),
    }));
  }

  async searchMessages(
    input: PageInput &
      TimeRange & {
        senderNodePublicKey?: string;
        destinationNodePublicKey?: string;
        messageType?: string;
        channel?: string;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const clauses = ["m.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [range.from, range.to];
    if (input.senderNodePublicKey) {
      clauses.push("sender.public_key = ?");
      parameters.push(input.senderNodePublicKey);
    }
    if (input.destinationNodePublicKey) {
      clauses.push("destination.public_key = ?");
      parameters.push(input.destinationNodePublicKey);
    }
    if (input.messageType) {
      clauses.push("m.message_type = ?");
      parameters.push(input.messageType);
    }
    if (input.channel) {
      clauses.push("m.channel = ?");
      parameters.push(input.channel);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor);
      clauses.push(
        "(m.received_at_ms < ? OR (m.received_at_ms = ? AND m.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT m.id, m.message_type, m.channel, m.channel_index,
              m.sender_prefix, sender.public_key AS sender_public_key,
              m.destination_prefix,
              destination.public_key AS destination_public_key,
              m.encrypted, m.text, m.signature_valid, m.reported_at_ms,
              m.received_at_ms, p.packet_sha256
       FROM messages m JOIN packets p ON p.id = m.packet_id
       LEFT JOIN nodes sender ON sender.id = m.sender_node_id
       LEFT JOIN nodes destination ON destination.id = m.destination_node_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY m.received_at_ms DESC, m.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "received_at_ms", (row) => ({
      message_id: number(row.id),
      message_type: String(row.message_type),
      channel: optionalText(row.channel),
      channel_index: optionalNumber(row.channel_index),
      sender_prefix: optionalText(row.sender_prefix),
      sender_public_key: optionalText(row.sender_public_key),
      destination_prefix: optionalText(row.destination_prefix),
      destination_public_key: optionalText(row.destination_public_key),
      encrypted: number(row.encrypted) === 1,
      text: number(row.encrypted) === 1 ? null : optionalText(row.text),
      signature_valid: optionalBoolean(row.signature_valid),
      reported_at: optionalIso(row.reported_at_ms),
      received_at: iso(row.received_at_ms),
      packet_hash: String(row.packet_sha256),
    }));
  }

  async getActivityTimeseries(input: {
    from: number;
    to: number;
    bucketMs: number;
    observerPublicKey?: string;
    region?: string;
  }) {
    const range = this.range(input);
    const observationClauses = ["po.received_at_ms BETWEEN ? AND ?"];
    const eventClauses = [
      "e.subtopic_root IN ('status','packets','neighbors')",
      "e.received_at_ms BETWEEN ? AND ?",
    ];
    const observationParameters: unknown[] = [range.from, range.to];
    const eventParameters: unknown[] = [range.from, range.to];
    if (input.observerPublicKey) {
      observationClauses.push("o.public_key = ?");
      eventClauses.push("o.public_key = ?");
      observationParameters.push(input.observerPublicKey);
      eventParameters.push(input.observerPublicKey);
    }
    if (input.region) {
      observationClauses.push("po.region = ?");
      eventClauses.push("e.region = ?");
      observationParameters.push(input.region);
      eventParameters.push(input.region);
    }
    const [events, packets, nodes, derived] = await Promise.all([
      this.database.all<DatabaseRow>(
        `SELECT CAST(e.received_at_ms / ? AS INTEGER) * ? AS bucket_at_ms,
                count(DISTINCT e.observer_id) AS active_observers
         FROM mqtt_events e JOIN observers o ON o.id = e.observer_id
         WHERE ${eventClauses.join(" AND ")}
         GROUP BY bucket_at_ms`,
        input.bucketMs,
        input.bucketMs,
        ...eventParameters,
      ),
      this.database.all<DatabaseRow>(
        `SELECT CAST(po.received_at_ms / ? AS INTEGER) * ? AS bucket_at_ms,
                count(DISTINCT po.packet_id) AS unique_packets,
                count(*) AS packet_observations
         FROM packet_observations po JOIN observers o ON o.id = po.observer_id
         WHERE ${observationClauses.join(" AND ")}
         GROUP BY bucket_at_ms`,
        input.bucketMs,
        input.bucketMs,
        ...observationParameters,
      ),
      this.database.all<DatabaseRow>(
        `SELECT CAST(s.received_at_ms / ? AS INTEGER) * ? AS bucket_at_ms,
                count(DISTINCT s.node_id) AS active_nodes
         FROM node_sightings s JOIN observers o ON o.id = s.observer_id
         WHERE s.received_at_ms BETWEEN ? AND ?
           ${input.observerPublicKey ? "AND o.public_key = ?" : ""}
           ${input.region ? "AND s.region = ?" : ""}
         GROUP BY bucket_at_ms`,
        input.bucketMs,
        input.bucketMs,
        range.from,
        range.to,
        ...(input.observerPublicKey ? [input.observerPublicKey] : []),
        ...(input.region ? [input.region] : []),
      ),
      this.database.all<DatabaseRow>(
        `SELECT bucket_at_ms, kind, count(*) AS count FROM (
           SELECT CAST(po.received_at_ms / ? AS INTEGER) * ? AS bucket_at_ms,
                  'adverts' AS kind
             FROM node_adverts a JOIN packet_observations po ON po.packet_id = a.packet_id
             JOIN observers o ON o.id = po.observer_id
             WHERE ${observationClauses.join(" AND ")}
           UNION ALL
           SELECT CAST(po.received_at_ms / ? AS INTEGER) * ?, 'traces'
             FROM trace_events tr JOIN packet_observations po ON po.id = tr.packet_observation_id
             JOIN observers o ON o.id = po.observer_id
             WHERE ${observationClauses.join(" AND ")}
           UNION ALL
           SELECT CAST(po.received_at_ms / ? AS INTEGER) * ?, 'telemetry'
             FROM telemetry_events te JOIN packet_observations po ON po.id = te.packet_observation_id
             JOIN observers o ON o.id = po.observer_id
             WHERE ${observationClauses.join(" AND ")}
           UNION ALL
           SELECT CAST(po.received_at_ms / ? AS INTEGER) * ?, 'messages'
             FROM messages m JOIN packet_observations po ON po.id = m.packet_observation_id
             JOIN observers o ON o.id = po.observer_id
             WHERE ${observationClauses.join(" AND ")}
         ) GROUP BY bucket_at_ms, kind`,
        ...["adverts", "traces", "telemetry", "messages"].flatMap(() => [
          input.bucketMs,
          input.bucketMs,
          ...observationParameters,
        ]),
      ),
    ]);
    const buckets = new Map<number, Record<string, number>>();
    const bucket = (timestamp: unknown) => {
      const key = number(timestamp);
      const value = buckets.get(key) ?? {
        unique_packets: 0,
        packet_observations: 0,
        active_observers: 0,
        active_nodes: 0,
        adverts: 0,
        traces: 0,
        telemetry: 0,
        messages: 0,
      };
      buckets.set(key, value);
      return value;
    };
    for (const row of events) {
      bucket(row.bucket_at_ms).active_observers = number(row.active_observers);
    }
    for (const row of packets) {
      const value = bucket(row.bucket_at_ms);
      value.unique_packets = number(row.unique_packets);
      value.packet_observations = number(row.packet_observations);
    }
    for (const row of nodes) {
      bucket(row.bucket_at_ms).active_nodes = number(row.active_nodes);
    }
    for (const row of derived) {
      const kind = String(row.kind);
      bucket(row.bucket_at_ms)[kind] = number(row.count);
    }
    const rows = [...buckets.entries()].sort(([left], [right]) => left - right);
    const hasMore = rows.length > this.config.maxLimit;
    return {
      data: rows.slice(0, this.config.maxLimit).map(([timestamp, values]) => ({
        timestamp: iso(timestamp),
        ...values,
      })),
      meta: this.meta(null, hasMore),
    };
  }
}
