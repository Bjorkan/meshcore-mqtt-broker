import { createHash } from "node:crypto";
import type { ChannelKeyEntry } from "./channel-key-registry.js";
import type { McpConfig, RegionConfig, StorageConfig } from "./config.js";
import {
  CURRENT_SCHEMA_VERSION,
  type ApplicationDatabase,
} from "./database.js";
import { canonicalMetricUnit } from "./metric-units.js";
import { SERVER_NAME, SERVER_VERSION } from "./mcp-tool-common.js";
import { PublicQueryInputError } from "./public-query-errors.js";

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
  version: 1;
  query: string;
  filter_hash: string;
  timestamp: number;
  id: number;
  event_type?: string;
  prefix_hex?: string;
  from?: number;
  to?: number;
}

interface CursorContext {
  query: string;
  filterHash: string;
}

export const DEFAULT_NETWORK_SUMMARY_WINDOW_MS = 86_400_000;
export const MAX_ACTIVITY_BUCKETS = 1_440;
export const MAX_MESSAGE_PAYLOAD_IDS = 100;
export const MAX_PATH_OBSERVATIONS_PAGE = 100;
const MAX_PATH_HOP_CANDIDATES = 5;

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

function normalizedPosition(
  latitudeValue: unknown,
  longitudeValue: unknown,
): { latitude: number; longitude: number } | null {
  if (
    latitudeValue === null ||
    latitudeValue === undefined ||
    longitudeValue === null ||
    longitudeValue === undefined
  ) {
    return null;
  }
  const latitude = number(latitudeValue);
  const longitude = number(longitudeValue);
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

function positionQuality(
  latitudeValue: unknown,
  longitudeValue: unknown,
): "zero_zero_sentinel" | null {
  if (
    latitudeValue === null ||
    latitudeValue === undefined ||
    longitudeValue === null ||
    longitudeValue === undefined
  ) {
    return null;
  }
  const latitude = number(latitudeValue);
  const longitude = number(longitudeValue);
  if (latitude === 0 && longitude === 0) return "zero_zero_sentinel";
  return null;
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

function cursorContext(
  query: string,
  filters: Record<string, unknown>,
): CursorContext {
  const normalized = Object.fromEntries(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    query,
    filterHash: createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("base64url")
      .slice(0, 22),
  };
}

function encodeCursor(
  cursor: Pick<
    CursorValue,
    "timestamp" | "id" | "event_type" | "prefix_hex" | "from" | "to"
  >,
  context: CursorContext,
): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      query: context.query,
      filter_hash: context.filterHash,
      ...cursor,
    } satisfies CursorValue),
  ).toString("base64url");
}

function decodePublicMcpCursor(
  value: string,
  context: CursorContext,
): CursorValue {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      (decoded as CursorValue).version !== 1 ||
      (decoded as CursorValue).query !== context.query ||
      (decoded as CursorValue).filter_hash !== context.filterHash ||
      !Number.isSafeInteger((decoded as CursorValue).timestamp) ||
      !Number.isSafeInteger((decoded as CursorValue).id) ||
      (decoded as CursorValue).timestamp < 0 ||
      (decoded as CursorValue).id < 0
    ) {
      throw new Error("invalid cursor payload");
    }
    const eventType = (decoded as CursorValue).event_type;
    if (
      eventType !== undefined &&
      (typeof eventType !== "string" || !/^[a-z_]{1,32}$/.test(eventType))
    ) {
      throw new Error("invalid cursor payload");
    }
    const prefixHex = (decoded as CursorValue).prefix_hex;
    if (
      prefixHex !== undefined &&
      (typeof prefixHex !== "string" ||
        !/^(?:[0-9A-F]{2}){1,3}$/.test(prefixHex))
    ) {
      throw new Error("invalid cursor payload");
    }
    for (const field of ["from", "to"] as const) {
      const value = (decoded as CursorValue)[field];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new Error("invalid cursor payload");
      }
    }
    return decoded as CursorValue;
  } catch {
    throw new PublicQueryInputError(
      "invalid_pagination_cursor",
      "The pagination cursor does not match this tool and filter set.",
    );
  }
}

function assertOrderedRange(
  minimumName: string,
  minimum: number | undefined,
  maximumName: string,
  maximum: number | undefined,
): void {
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new PublicQueryInputError(
      "inconsistent_filter_range",
      `${minimumName} must be less than or equal to ${maximumName}.`,
    );
  }
}

export interface GeoFilterInput {
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  minLatitude?: number;
  maxLatitude?: number;
  minLongitude?: number;
  maxLongitude?: number;
}

const DEGREES_TO_RADIANS = Math.PI / 180;

function geospatialClauses(
  latitudeField: string,
  longitudeField: string,
  input: GeoFilterInput,
): { clause: string; parameters: unknown[] } {
  assertOrderedRange(
    "min_latitude",
    input.minLatitude,
    "max_latitude",
    input.maxLatitude,
  );
  assertOrderedRange(
    "min_longitude",
    input.minLongitude,
    "max_longitude",
    input.maxLongitude,
  );
  if (input.radiusKm !== undefined) {
    if (input.latitude === undefined || input.longitude === undefined) {
      throw new PublicQueryInputError(
        "invalid_geo_filter",
        "radius_km requires both latitude and longitude.",
      );
    }
    const latitudeRad = input.latitude * DEGREES_TO_RADIANS;
    const longitudeRad = input.longitude * DEGREES_TO_RADIANS;
    const sinLatitude = Math.sin(latitudeRad);
    const cosLatitude = Math.cos(latitudeRad);
    return {
      clause: `(6371.0088 * acos(min(1.0, max(-1.0, ${sinLatitude} * sin(${latitudeField} * ${DEGREES_TO_RADIANS}) + ${cosLatitude} * cos(${latitudeField} * ${DEGREES_TO_RADIANS}) * cos((${longitudeField} * ${DEGREES_TO_RADIANS}) - ${longitudeRad}))))) <= ?`,
      parameters: [input.radiusKm],
    };
  }
  const clauses: string[] = [];
  const parameters: unknown[] = [];
  if (input.minLatitude !== undefined) {
    clauses.push(`${latitudeField} >= ?`);
    parameters.push(input.minLatitude);
  }
  if (input.maxLatitude !== undefined) {
    clauses.push(`${latitudeField} <= ?`);
    parameters.push(input.maxLatitude);
  }
  if (input.minLongitude !== undefined) {
    clauses.push(`${longitudeField} >= ?`);
    parameters.push(input.minLongitude);
  }
  if (input.maxLongitude !== undefined) {
    clauses.push(`${longitudeField} <= ?`);
    parameters.push(input.maxLongitude);
  }
  return { clause: clauses.join(" AND "), parameters };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export interface SortSpec {
  field: string;
  order: "asc" | "desc";
}

export function keysetClauses(
  sort: SortSpec | undefined,
  primaryField: string,
  idField: string,
): { orderBy: string; cursor: string } {
  const direction = sort?.order === "asc" ? "ASC" : "DESC";
  const orderBy = `${sort?.field ?? primaryField} ${direction}, ${idField} ${direction}`;
  const cursor =
    direction === "DESC"
      ? `(${sort?.field ?? primaryField} < ? OR (${sort?.field ?? primaryField} = ? AND ${idField} < ?))`
      : `(${sort?.field ?? primaryField} > ? OR (${sort?.field ?? primaryField} = ? AND ${idField} > ?))`;
  return { orderBy, cursor };
}

export function allowedSort(
  sort: SortSpec | undefined,
  fields: string[],
): SortSpec | undefined {
  if (sort === undefined) return undefined;
  const field = fields.find((candidate) => candidate === sort.field);
  if (field === undefined) {
    throw new PublicQueryInputError(
      "invalid_sort_field",
      `sort must be one of: ${fields.join(", ")}`,
    );
  }
  return { field, order: sort.order === "asc" ? "asc" : "desc" };
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
    private readonly regions: RegionConfig = {
      whitelistEnabled: false,
      allowedPrimaryRegions: [],
      primaryEntries: {},
      secondaryEntries: {},
    },
    private readonly channelKeyResolver?: (
      channelHashHex: string,
    ) => ChannelKeyEntry | undefined,
  ) {}

  private channelEntry(channelHash: unknown): ChannelKeyEntry | undefined {
    if (typeof channelHash !== "string") return undefined;
    return this.channelKeyResolver?.(channelHash.toLowerCase());
  }

  private channelKeyFor(channelHash: unknown): string | null {
    const entry = this.channelEntry(channelHash);
    return entry?.kind === "psk" ? entry.key : null;
  }

  private meta(
    nextCursor: string | null = null,
    hasMore = false,
    truncated = hasMore,
  ): PageMeta {
    return {
      generated_at: new Date(this.now()).toISOString(),
      retention_days: this.storage.retentionDays,
      next_cursor: nextCursor,
      has_more: hasMore,
      truncated,
    };
  }

  pageMeta(): PageMeta {
    return this.meta();
  }

  notFound() {
    return {
      data: null,
      meta: this.meta(),
      status: "not_found",
      reason: "entity_not_found",
    };
  }

  noData(reason: string) {
    return { data: null, meta: this.meta(), status: "no_data", reason };
  }

  capabilitiesData() {
    return {
      server_version: SERVER_VERSION,
      public_access: true,
      authentication_required: false,
      read_only: true,
      storage_available: true,
      retention_days: this.storage.retentionDays,
      default_page_size: this.config.defaultLimit,
      max_page_size: this.config.maxLimit,
      max_timeseries_buckets: MAX_ACTIVITY_BUCKETS,
      default_summary_window_seconds: DEFAULT_NETWORK_SUMMARY_WINDOW_MS / 1_000,
      supported_buckets: ["minute", "hour", "day"],
      supported_views: ["logical", "raw"],
      supported_count_modes: ["logical", "raw_packet", "observation"],
      supported_sort_fields: {
        nodes: ["last_seen_at", "first_seen_at"],
        observers: ["last_seen_at", "first_seen_at"],
        packets: ["last_observed_at", "first_observed_at"],
        paths: ["received_at"],
        path_prefixes: ["occurrence_count", "first_seen_at", "last_seen_at"],
        events: ["received_at"],
      },
      supported_event_types: [
        "packet",
        "advert",
        "message",
        "trace",
        "telemetry",
        "observer_status",
      ],
      logical_packet_grouping: true,
      logical_message_grouping: true,
      geospatial: true,
      batch_lookup: true,
      supports_observers: true,
      supports_nodes: true,
      supports_packets: true,
      supports_packet_observations: true,
      supports_adverts: true,
      supports_neighbors: true,
      supports_paths: true,
      supports_path_prefix_aggregation: true,
      supports_traces: true,
      supports_telemetry: true,
      supports_messages: true,
      supports_message_payload_batch: true,
      supports_event_stream: true,
      supports_channel_decryption: this.channelKeyResolver !== undefined,
      supports_raw_packet_bytes: true,
      supports_regions: true,
      max_path_page_size: MAX_PATH_OBSERVATIONS_PAGE,
      max_message_payload_batch_size: MAX_MESSAGE_PAYLOAD_IDS,
    };
  }

  async getSchemaDictionary() {
    const regions = await this.listRegions();
    const regionCodes = Array.isArray(regions.data)
      ? (regions.data as Array<{ code: string }>).map((entry) => entry.code)
      : [];
    const data = {
      server_name: SERVER_NAME,
      server_version: SERVER_VERSION,
      node_roles: ["UNKNOWN", "CLIENT", "REPEATER", "ROUTER_CLIENT", "ROUTER"],
      packet_types: [
        "REQUEST",
        "RESPONSE",
        "TXT_MSG",
        "ACK",
        "ADVERT",
        "GRP_TXT",
        "GRP_DATA",
        "ANON_REQ",
        "PATH",
        "TRACE",
        "MULTIPART",
        "CONTROL",
      ],
      payload_types: [
        "REQUEST",
        "RESPONSE",
        "TXT_MSG",
        "ACK",
        "ADVERT",
        "GRP_TXT",
        "GRP_DATA",
        "ANON_REQ",
        "PATH",
        "TRACE",
        "MULTIPART",
        "CONTROL",
      ],
      route_types: ["FLOOD", "DIRECT"],
      decode_statuses: [
        "not_attempted",
        "decoded",
        "partially_decoded",
        "unknown_type",
        "invalid_packet",
        "decoder_error",
      ],
      message_types: ["TXT_MSG", "GRP_TXT", "GRP_DATA"],
      metric_units: {
        "stats.battery_mv": "mV",
        "stats.last_rssi": "dBm",
        "stats.noise_floor": "dBm",
        "stats.last_snr": "dB",
        uptime: "s",
        rx_airtime: "s",
        tx_airtime: "s",
        frequency: "MHz",
        tx_power: "dBm",
        temperature: "°C",
      },
      region_codes: regionCodes,
      region_code_system: "IATA",
      views: ["logical", "raw"],
      count_modes: ["logical", "raw_packet", "observation"],
      count_semantics: {
        logical_packet:
          "One MeshCore transmission grouped across FLOOD routes; only undecodable packets fall back to raw-byte identity",
        raw_packet: "One byte-identical packet instance",
        observation: "One observer RF reception of a raw packet",
        advert_count: "Logical advert transmissions",
        message_count: "Logical message transmissions",
        position_quality:
          "zero_zero_sentinel marks an advertised 0,0 position normalized to null latitude/longitude",
        active_vs_known:
          "known_* spans retained history; active_* and other summary counters are scoped to the reported window",
        node_public_key_filter:
          "Matches any sighted node: advert owner, message sender or destination, TRACE or telemetry source, or resolved path hop",
        topology_edge:
          "Observed evidence from paths, TRACE hops, or neighbor snapshots; confidence is evidence strength, not ground truth",
      },
      timestamp_semantics: [
        "canonical times are server observation times",
        "advert_timestamp_raw preserves the node's embedded timestamp",
        "first/last observed aggregate the observations matching the query",
        "*_total fields report global history outside the query window",
        "TRACE hops are payload diagnostics; transport packet paths are separate data",
      ],
      filter_dimensions: {
        nodes: [
          "role",
          "name",
          "public_key",
          "region",
          "active_since",
          "latitude",
          "longitude",
          "radius_km",
          "bounding_box",
        ],
        packets: [
          "packet_hash",
          "logical_packet_id",
          "observer_public_key",
          "node_public_key",
          "region",
          "packet_type",
          "payload_type",
          "route_type",
          "min_rssi",
          "max_rssi",
          "min_snr",
          "max_snr",
          "min_score",
          "max_score",
          "min_hops",
          "max_hops",
          "decode_status",
        ],
        adverts: [
          "node_public_key",
          "prefix_hex",
          "name",
          "role",
          "region",
          "verified",
          "signature_valid",
          "has_location",
          "latitude",
          "longitude",
          "radius_km",
          "bounding_box",
        ],
        messages: [
          "packet_hash",
          "logical_packet_id",
          "sender_node_public_key",
          "destination_node_public_key",
          "message_type",
          "channel",
        ],
        neighbors: [
          "region",
          "observer_public_key",
          "neighbor_public_key",
          "min_snr",
        ],
        telemetry: ["node_public_key", "metric", "region"],
        paths: [
          "region",
          "logical_packet_id",
          "packet_hash",
          "observer_public_key",
          "contains_prefix_hex",
          "contains_node_public_key",
          "min_hops",
          "max_hops",
          "resolution_status",
        ],
        path_prefixes: [
          "region",
          "prefix_hex",
          "resolution_status",
          "min_occurrences",
        ],
        events: [
          "region",
          "node_public_key",
          "observer_public_key",
          "event_types",
        ],
      },
      event_types: [
        "packet",
        "advert",
        "message",
        "trace",
        "telemetry",
        "observer_status",
      ],
      path_resolution_statuses: ["resolved", "ambiguous", "unresolved"],
      channel_decryption: {
        enabled: this.channelKeyResolver !== undefined,
        semantics:
          "Configured channels are decrypted at ingest; their plaintext and channel PSKs are public through this surface",
      },
      pagination: {
        default_page_size: this.config.defaultLimit,
        max_page_size: this.config.maxLimit,
        max_path_page_size: MAX_PATH_OBSERVATIONS_PAGE,
        max_message_payload_batch_size: MAX_MESSAGE_PAYLOAD_IDS,
        max_timeseries_buckets: MAX_ACTIVITY_BUCKETS,
        default_summary_window_seconds:
          DEFAULT_NETWORK_SUMMARY_WINDOW_MS / 1_000,
      },
      result_statuses: [
        "ok",
        "not_found",
        "no_data",
        "ambiguous",
        "invalid_request",
        "unresolved",
        "data_quality_error",
      ],
    };
    return { data, meta: regions.meta };
  }

  private range(
    input: TimeRange,
    defaultWindowMs?: number,
  ): { from: number; to: number } {
    if (
      (input.from !== undefined &&
        (!Number.isFinite(input.from) || input.from < 0)) ||
      (input.to !== undefined && (!Number.isFinite(input.to) || input.to < 0))
    ) {
      throw new PublicQueryInputError(
        "invalid_time_range",
        "from and to must be finite non-negative millisecond timestamps.",
      );
    }
    const now = this.now();
    const retainedFrom = now - this.storage.retentionDays * 86_400_000;
    if (
      input.from !== undefined &&
      input.to !== undefined &&
      input.from > input.to
    ) {
      throw new PublicQueryInputError(
        "invalid_time_range",
        "from must be earlier than or equal to to.",
      );
    }
    const to = Math.min(input.to ?? now, now);
    const defaultFrom =
      defaultWindowMs === undefined
        ? retainedFrom
        : Math.max(to - defaultWindowMs, retainedFrom);
    const from = Math.max(input.from ?? defaultFrom, retainedFrom);
    if (from > to) {
      throw new PublicQueryInputError(
        "invalid_time_range",
        "The requested time range does not overlap retained history.",
      );
    }
    return { from, to };
  }

  private async candidatesForPrefixes(hops: DatabaseRow[]) {
    const unique = new Map<string, { prefix: string; length: number }>();
    for (const hop of hops) {
      const prefix = String(hop.prefix_hex);
      const length = number(hop.prefix_length_bytes);
      unique.set(`${length}:${prefix}`, { prefix, length });
    }
    if (unique.size === 0) return new Map<string, DatabaseRow[]>();
    const conditions = [...unique.values()].map(
      () => "(pc.prefix_hex = ? AND pc.prefix_length_bytes = ?)",
    );
    const parameters = [...unique.values()].flatMap(({ prefix, length }) => [
      prefix,
      length,
    ]);
    const rows = await this.database.all<DatabaseRow>(
      `WITH ranked AS (
         SELECT pc.prefix_hex, pc.prefix_length_bytes, pc.confidence,
                pc.evidence_count, n.public_key, n.latest_name, n.latest_role,
                n.latest_latitude, n.latest_longitude,
                row_number() OVER (
                  PARTITION BY pc.prefix_hex, pc.prefix_length_bytes
                  ORDER BY pc.confidence DESC, pc.evidence_count DESC, n.public_key
                ) AS candidate_rank
         FROM node_prefix_candidates pc JOIN nodes n ON n.id = pc.node_id
         WHERE ${conditions.join(" OR ")}
       )
       SELECT * FROM ranked WHERE candidate_rank <= 250
       ORDER BY prefix_length_bytes, prefix_hex, candidate_rank`,
      ...parameters,
    );
    const candidates = new Map<string, DatabaseRow[]>();
    for (const row of rows) {
      const key = `${number(row.prefix_length_bytes)}:${String(row.prefix_hex)}`;
      const list = candidates.get(key) ?? [];
      list.push(row);
      candidates.set(key, list);
    }
    return candidates;
  }

  private page<T extends DatabaseRow, U>(
    rows: T[],
    limit: number,
    timestampField: keyof T,
    context: CursorContext,
    mapper: (row: T) => U,
  ): PublicPage<U> {
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const last = selected[selected.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(
            {
              timestamp: number(last[timestampField]),
              id: number(last.id),
            },
            context,
          )
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

  private validateRegion(code: string): string {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      throw new PublicQueryInputError(
        "invalid_region",
        "Region codes are three-letter IATA codes.",
      );
    }
    if (!this.regions.whitelistEnabled) return normalized;
    if (
      this.regions.primaryEntries[normalized] !== undefined ||
      this.regions.secondaryEntries[normalized] !== undefined
    ) {
      return normalized;
    }
    throw new PublicQueryInputError(
      "invalid_region",
      `Region ${normalized} is not configured on this broker.`,
    );
  }

  async listRegions() {
    if (this.regions.whitelistEnabled) {
      const entries: Array<{
        code: string;
        name: string | null;
        code_system: "IATA";
        type: "region";
        is_primary: boolean;
        is_allowed: boolean;
        primary_region: string | null;
      }> = [];
      for (const code of this.regions.allowedPrimaryRegions) {
        const entry = this.regions.primaryEntries[code];
        entries.push({
          code,
          name: entry?.friendlyName ?? null,
          code_system: "IATA",
          type: "region",
          is_primary: true,
          is_allowed: true,
          primary_region: null,
        });
      }
      for (const [code, entry] of Object.entries(
        this.regions.secondaryEntries,
      )) {
        entries.push({
          code,
          name:
            this.regions.primaryEntries[entry.primaryRegion]?.friendlyName ??
            null,
          code_system: "IATA",
          type: "region",
          is_primary: false,
          is_allowed: false,
          primary_region: entry.primaryRegion,
        });
      }
      entries.sort((left, right) => left.code.localeCompare(right.code));
      return { data: entries, meta: this.meta() };
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT DISTINCT region FROM observer_region_history
       ORDER BY region LIMIT 251`,
    );
    return {
      data: rows.slice(0, 250).map((row) => ({
        code: String(row.region),
        name: null,
        code_system: "IATA",
        type: "region",
        is_primary: null,
        is_allowed: true,
        primary_region: null,
      })),
      meta: this.meta(null, false, rows.length > 250),
    };
  }

  async getRegionSummary(input: TimeRange & { region: string }) {
    const code = this.validateRegion(input.region);
    const range = this.range(input, DEFAULT_NETWORK_SUMMARY_WINDOW_MS);
    const summary = await this.database.get<DatabaseRow>(
      `SELECT
         (SELECT count(DISTINCT observer_id) FROM observer_region_history
           WHERE region = ?) AS observer_count,
         (SELECT count(DISTINCT observer_id) FROM mqtt_events
           WHERE region = ? AND subtopic_root IN ('status','packets','neighbors')
             AND received_at_ms BETWEEN ? AND ?) AS active_observers,
         (SELECT count(DISTINCT node_id) FROM node_sightings
           WHERE region = ?) AS node_count,
         (SELECT count(DISTINCT s.node_id) FROM node_sightings s
           JOIN nodes n ON n.id = s.node_id
           WHERE s.region = ? AND n.latest_role = 'REPEATER') AS repeater_count,
         (SELECT count(DISTINCT po.packet_id) FROM packet_observations po
           WHERE po.region = ? AND po.received_at_ms BETWEEN ? AND ?) AS unique_packets,
         (SELECT count(DISTINCT p.logical_packet_id) FROM packet_observations po
           JOIN packets p ON p.id = po.packet_id
           WHERE po.region = ? AND po.received_at_ms BETWEEN ? AND ?
             AND p.logical_packet_id IS NOT NULL) AS logical_packet_count,
         (SELECT count(DISTINCT p.logical_packet_id) FROM node_adverts a
           JOIN packets p ON p.id = a.packet_id
           WHERE p.logical_packet_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM packet_observations po2
                          WHERE po2.packet_id = p.id AND po2.region = ?
                            AND po2.received_at_ms BETWEEN ? AND ?)) AS logical_advert_count,
         (SELECT count(DISTINCT p.logical_packet_id) FROM messages m
           JOIN packets p ON p.id = m.packet_id
           WHERE p.logical_packet_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM packet_observations po2
                          WHERE po2.packet_id = p.id AND po2.region = ?
                            AND po2.received_at_ms BETWEEN ? AND ?)) AS message_count,
         (SELECT max(received_at_ms) FROM mqtt_events
           WHERE region = ?
             AND subtopic_root IN ('status','packets','neighbors')) AS last_activity_at_ms`,
      code,
      code,
      range.from,
      range.to,
      code,
      code,
      code,
      range.from,
      range.to,
      code,
      range.from,
      range.to,
      code,
      range.from,
      range.to,
      code,
      range.from,
      range.to,
      code,
    );
    return {
      data: {
        code,
        code_system: "IATA",
        name:
          this.regions.primaryEntries[code]?.friendlyName ??
          this.regions.primaryEntries[
            this.regions.secondaryEntries[code]?.primaryRegion ?? ""
          ]?.friendlyName ??
          null,
        is_allowed:
          !this.regions.whitelistEnabled ||
          this.regions.primaryEntries[code] !== undefined,
        window_from: iso(range.from),
        window_to: iso(range.to),
        observer_count: number(summary?.observer_count ?? 0),
        active_observers: number(summary?.active_observers ?? 0),
        node_count: number(summary?.node_count ?? 0),
        repeater_count: number(summary?.repeater_count ?? 0),
        unique_packets: number(summary?.unique_packets ?? 0),
        logical_packet_count: number(summary?.logical_packet_count ?? 0),
        logical_advert_count: number(summary?.logical_advert_count ?? 0),
        message_count: number(summary?.message_count ?? 0),
        last_activity_at: optionalIso(summary?.last_activity_at_ms),
      },
      meta: this.meta(),
    };
  }

  async getNetworkSummary(input: TimeRange) {
    const range = this.range(input, DEFAULT_NETWORK_SUMMARY_WINDOW_MS);
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
           (SELECT count(DISTINCT p.logical_packet_id)
              FROM packets p JOIN packet_observations po ON po.packet_id = p.id
             WHERE po.received_at_ms BETWEEN ? AND ?
               AND p.logical_packet_id IS NOT NULL) AS logical_packet_count,
           (SELECT count(DISTINCT p.logical_packet_id)
              FROM node_adverts a JOIN packets p ON p.id = a.packet_id
             WHERE p.logical_packet_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM packet_observations po2
                            WHERE po2.packet_id = p.id
                              AND po2.received_at_ms BETWEEN ? AND ?)) AS advert_count,
           (SELECT count(*) FROM node_adverts
             WHERE first_observed_at_ms BETWEEN ? AND ?) AS advert_raw_packet_count,
           (SELECT count(*) FROM packet_observations po
              JOIN node_adverts a ON a.packet_id = po.packet_id
             WHERE po.received_at_ms BETWEEN ? AND ?) AS advert_observation_count,
           (SELECT count(*) FROM neighbor_snapshots
             WHERE received_at_ms BETWEEN ? AND ?) AS neighbor_snapshot_count,
           (SELECT count(*) FROM trace_events
             WHERE received_at_ms BETWEEN ? AND ?) AS trace_count,
           (SELECT count(*) FROM telemetry_events
             WHERE received_at_ms BETWEEN ? AND ?) AS telemetry_event_count,
           (SELECT count(DISTINCT p.logical_packet_id)
              FROM messages m JOIN packets p ON p.id = m.packet_id
             WHERE m.received_at_ms BETWEEN ? AND ?
               AND p.logical_packet_id IS NOT NULL) AS message_count,
           (SELECT count(*) FROM messages
             WHERE received_at_ms BETWEEN ? AND ?) AS message_observation_count`,
        ...Array.from({ length: 14 }, () => [range.from, range.to]).flat(),
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
        window_from: iso(range.from),
        window_to: iso(range.to),
        active_observers: number(counts?.active_observers ?? 0),
        known_observers: number(known?.known_observers ?? 0),
        active_nodes: number(counts?.active_nodes ?? 0),
        known_nodes: number(known?.known_nodes ?? 0),
        active_repeaters: number(counts?.active_repeaters ?? 0),
        unique_packets: number(counts?.unique_packets ?? 0),
        packet_observations: number(counts?.packet_observations ?? 0),
        logical_packet_count: number(counts?.logical_packet_count ?? 0),
        advert_count: number(counts?.advert_count ?? 0),
        advert_raw_packet_count: number(counts?.advert_raw_packet_count ?? 0),
        advert_observation_count: number(counts?.advert_observation_count ?? 0),
        neighbor_snapshot_count: number(counts?.neighbor_snapshot_count ?? 0),
        trace_count: number(counts?.trace_count ?? 0),
        telemetry_event_count: number(counts?.telemetry_event_count ?? 0),
        message_count: number(counts?.message_count ?? 0),
        message_observation_count: number(
          counts?.message_observation_count ?? 0,
        ),
        median_rssi: optionalNumber(median?.median_rssi),
        median_snr: optionalNumber(median?.median_snr),
        first_event_at: optionalIso(events?.first_event_at_ms),
        last_event_at: optionalIso(events?.last_event_at_ms),
      },
      meta: this.meta(),
    };
  }

  async listObservers(
    input: PageInput & {
      region?: string;
      activeSince?: number;
      hasNeighborData?: boolean;
      sort?: SortSpec;
    },
  ) {
    const limit = pageLimit(input, this.config);
    const sort = allowedSort(input.sort, ["last_seen_at", "first_seen_at"]);
    const sortSql =
      sort?.field === "first_seen_at"
        ? "o.first_seen_at_ms"
        : "o.last_seen_at_ms";
    const keyset = keysetClauses(
      sort ? { field: sortSql, order: sort.order } : undefined,
      "o.last_seen_at_ms",
      "o.id",
    );
    const context = cursorContext("list_observers", {
      region: input.region,
      active_since: input.activeSince,
      has_neighbor_data: input.hasNeighborData,
      sort: sort?.field,
      order: sort?.order,
    });
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
    if (input.hasNeighborData === true) {
      clauses.push(
        "EXISTS (SELECT 1 FROM neighbor_snapshots ns WHERE ns.observer_id = o.id)",
      );
    }
    if (input.hasNeighborData === false) {
      clauses.push(
        "NOT EXISTS (SELECT 1 FROM neighbor_snapshots ns WHERE ns.observer_id = o.id)",
      );
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      clauses.push(keyset.cursor);
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
               (SELECT count(*) FROM neighbor_snapshots ns
                 WHERE ns.observer_id = o.id) AS neighbor_snapshot_count,
               (SELECT received_at_ms FROM neighbor_snapshots ns
                 WHERE ns.observer_id = o.id
                 ORDER BY received_at_ms DESC, id DESC LIMIT 1) AS latest_neighbor_snapshot_at_ms,
               (SELECT entry_count FROM neighbor_snapshots ns
                 WHERE ns.observer_id = o.id
                 ORDER BY received_at_ms DESC, id DESC LIMIT 1) AS neighbor_count_latest,
               rh.frequency_mhz, rh.bandwidth_khz, rh.spreading_factor,
               rh.coding_rate, rh.tx_power_dbm
        FROM observers o
        LEFT JOIN observer_radio_history rh ON rh.id = (
          SELECT id FROM observer_radio_history latest
          WHERE latest.observer_id = o.id
          ORDER BY received_at_ms DESC, id DESC LIMIT 1
        )
        WHERE ${clauses.join(" AND ")}
        ORDER BY ${keyset.orderBy} LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(
      rows,
      limit,
      sort?.field === "first_seen_at" ? "first_seen_at_ms" : "last_seen_at_ms",
      context,
      (row) => ({
        public_key: String(row.public_key),
        latest_region: optionalText(row.latest_region),
        first_seen_at: iso(row.first_seen_at_ms),
        last_seen_at: iso(row.last_seen_at_ms),
        latest_model: optionalText(row.latest_model),
        latest_firmware: optionalText(row.latest_firmware),
        latest_radio_config: {
          frequency_mhz: optionalNumber(row.frequency_mhz),
          bandwidth_khz: optionalNumber(row.bandwidth_khz),
          spreading_factor: optionalNumber(row.spreading_factor),
          coding_rate: optionalNumber(row.coding_rate),
          tx_power_dbm: optionalNumber(row.tx_power_dbm),
        },
        latest_status_at: optionalIso(row.latest_status_at_ms),
        packet_observation_count: number(row.packet_observation_count),
        has_neighbor_data: number(row.neighbor_snapshot_count) > 0,
        latest_neighbor_snapshot_at: optionalIso(
          row.latest_neighbor_snapshot_at_ms,
        ),
        neighbor_count_latest: optionalNumber(row.neighbor_count_latest),
      }),
    );
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
    const [regions, status, metrics, radio, neighborSnapshot] =
      await Promise.all([
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
        this.database.get<DatabaseRow>(
          `SELECT id, reported_at_ms, received_at_ms, mqtt_retained,
                self_scopes_json
         FROM neighbor_snapshots WHERE observer_id = ?
         ORDER BY received_at_ms DESC, id DESC LIMIT 1`,
          observer.id,
        ),
      ]);
    const neighborEntries = neighborSnapshot
      ? await this.database.all<DatabaseRow>(
          `SELECT neighbor_public_key, snr, rssi, heard_secs_ago,
                  calculated_last_heard_at_ms, status, scopes_json
           FROM neighbor_entries WHERE snapshot_id = ?
           ORDER BY neighbor_public_key LIMIT 250`,
          neighborSnapshot.id,
        )
      : [];
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
          unit: canonicalMetricUnit(
            String(row.metric_name),
            optionalText(row.unit),
          ),
        })),
        packet_observation_count: number(observer.packet_observation_count),
        latest_neighbor_snapshot: neighborSnapshot
          ? {
              snapshot_timestamp: iso(neighborSnapshot.received_at_ms),
              reported_timestamp: optionalIso(neighborSnapshot.reported_at_ms),
              mqtt_retained: number(neighborSnapshot.mqtt_retained) === 1,
              observer_scopes: jsonValue(neighborSnapshot.self_scopes_json),
              neighbors: neighborEntries.map((row) => ({
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
            }
          : null,
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
    const context = cursorContext("get_observer_status_history", {
      observer_public_key: input.observerPublicKey,
      from: input.from,
      to: input.to,
    });
    const parameters: unknown[] = [
      input.observerPublicKey,
      range.from,
      range.to,
    ];
    const cursorClause = input.cursor
      ? "AND (se.received_at_ms < ? OR (se.received_at_ms = ? AND se.id < ?))"
      : "";
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
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
    return this.page(rows, limit, "received_at_ms", context, (row) => ({
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
        unit: canonicalMetricUnit(
          String(metric.metric_name),
          optionalText(metric.unit),
        ),
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
      geo?: GeoFilterInput;
      sort?: SortSpec;
    },
  ) {
    const limit = pageLimit(input, this.config);
    const sort = allowedSort(input.sort, ["last_seen_at", "first_seen_at"]);
    const sortSql =
      sort?.field === "first_seen_at"
        ? "n.first_seen_at_ms"
        : "n.last_seen_at_ms";
    const keyset = keysetClauses(
      sort ? { field: sortSql, order: sort.order } : undefined,
      "n.last_seen_at_ms",
      "n.id",
    );
    const context = cursorContext("list_nodes", {
      role: input.role,
      name: input.name,
      public_key: input.publicKey,
      region: input.region,
      active_since: input.activeSince,
      sort: sort?.field,
      order: sort?.order,
      latitude: input.geo?.latitude,
      longitude: input.geo?.longitude,
      radius_km: input.geo?.radiusKm,
      min_latitude: input.geo?.minLatitude,
      max_latitude: input.geo?.maxLatitude,
      min_longitude: input.geo?.minLongitude,
      max_longitude: input.geo?.maxLongitude,
    });
    const clauses = ["1 = 1"];
    const parameters: unknown[] = [];
    if (input.role) {
      clauses.push("n.latest_role = ?");
      parameters.push(input.role);
    }
    if (input.name) {
      clauses.push("n.latest_name LIKE ? ESCAPE '\\'");
      parameters.push(`%${escapeLike(input.name)}%`);
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
    if (input.geo) {
      const geo = geospatialClauses(
        "n.latest_latitude",
        "n.latest_longitude",
        input.geo,
      );
      if (geo.clause) {
        clauses.push(geo.clause);
        parameters.push(...geo.parameters);
      }
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      clauses.push(keyset.cursor);
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT n.id, n.public_key, n.latest_name, n.latest_role,
              n.first_seen_at_ms, n.last_seen_at_ms, n.latest_latitude,
              n.latest_longitude,
              (SELECT p.last_seen_at_ms FROM node_adverts a
                JOIN packets p ON p.id = a.packet_id
                WHERE a.node_id = n.id AND a.verified = 1
                ORDER BY a.first_observed_at_ms DESC, a.id DESC LIMIT 1)
                AS latest_advert_observed_at_ms,
              (SELECT count(*) FROM node_sightings s WHERE s.node_id = n.id)
                AS sighting_count
       FROM nodes n WHERE ${clauses.join(" AND ")}
       ORDER BY ${keyset.orderBy} LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(
      rows,
      limit,
      sort?.field === "first_seen_at" ? "first_seen_at_ms" : "last_seen_at_ms",
      context,
      (row) => ({
        public_key: String(row.public_key),
        name: optionalText(row.latest_name),
        role: optionalText(row.latest_role),
        first_seen_at: iso(row.first_seen_at_ms),
        last_seen_at: iso(row.last_seen_at_ms),
        latitude:
          normalizedPosition(row.latest_latitude, row.latest_longitude)
            ?.latitude ?? null,
        longitude:
          normalizedPosition(row.latest_latitude, row.latest_longitude)
            ?.longitude ?? null,
        latest_advert_at: optionalIso(row.latest_advert_observed_at_ms),
        sighting_count: number(row.sighting_count),
      }),
    );
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
        `SELECT a.advert_timestamp, a.node_public_key, a.name, a.role,
                a.latitude, a.longitude, a.flags, a.capabilities_json,
                a.verified, a.signature_valid,
                lp.logical_packet_id AS logical_advert_id,
                lp.first_observed_at_ms AS matched_first_observed_at_ms,
                lp.last_observed_at_ms AS matched_last_observed_at_ms,
                lp.first_observed_at_ms AS first_observed_at_total_ms,
                lp.last_observed_at_ms AS last_observed_at_total_ms,
                (SELECT count(*) FROM packets ptotal
                  WHERE ptotal.logical_packet_id = lp.id) AS raw_packet_count,
                (SELECT count(*) FROM packet_observations total
                   JOIN packets ptotal ON ptotal.id = total.packet_id
                  WHERE ptotal.logical_packet_id = lp.id) AS observation_count_total,
                (SELECT count(*) FROM packet_observations total
                   JOIN packets ptotal ON ptotal.id = total.packet_id
                  WHERE ptotal.logical_packet_id = lp.id) AS observation_count,
                (SELECT count(DISTINCT coalesce(hex(pp2.raw_path_blob), ''))
                   FROM packets ptotal
                   JOIN packet_observations pototal ON pototal.packet_id = ptotal.id
                   LEFT JOIN packet_paths pp2 ON pp2.packet_observation_id = pototal.id
                  WHERE ptotal.logical_packet_id = lp.id) AS route_count,
                (SELECT packet_sha256 FROM packets p2
                  WHERE p2.logical_packet_id = lp.id
                  ORDER BY p2.first_seen_at_ms, p2.id LIMIT 1) AS packet_sha256,
                (SELECT json_group_array(sha) FROM (
                   SELECT p3.packet_sha256 AS sha FROM packets p3
                    WHERE p3.logical_packet_id = lp.id
                    ORDER BY p3.first_seen_at_ms, p3.id LIMIT 250
                 )) AS raw_packet_hashes_json
         FROM node_adverts a
         JOIN packets p ON p.id = a.packet_id
         JOIN logical_packets lp ON lp.id = p.logical_packet_id
         WHERE a.node_id = ?
         ORDER BY lp.first_observed_at_ms DESC, a.id DESC LIMIT 1`,
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
        latest_position: normalizedPosition(
          node.latest_latitude,
          node.latest_longitude,
        ),
        latest_advert: advert ? this.mapLogicalAdvert(advert) : null,
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
          unit: canonicalMetricUnit(
            String(row.metric_name),
            optionalText(row.unit),
          ),
          channel: optionalNumber(row.channel),
        })),
      },
      meta: this.meta(),
    };
  }

  private mapLogicalAdvert(row: DatabaseRow) {
    return {
      logical_advert_id: String(row.logical_advert_id),
      raw_packet_count: number(row.raw_packet_count),
      route_count: number(row.route_count),
      raw_packet_hashes: Array.isArray(jsonValue(row.raw_packet_hashes_json))
        ? (jsonValue(row.raw_packet_hashes_json) as string[])
        : [String(row.packet_sha256)],
      advert_timestamp_raw: optionalProtocolIso(row.advert_timestamp),
      first_observed_at: iso(row.matched_first_observed_at_ms),
      last_observed_at: iso(row.matched_last_observed_at_ms),
      observation_count: number(row.observation_count),
      first_observed_at_total: iso(row.first_observed_at_total_ms),
      last_observed_at_total: iso(row.last_observed_at_total_ms),
      observation_count_total: number(row.observation_count_total),
      public_key: String(row.node_public_key),
      name: optionalText(row.name),
      role: optionalText(row.role),
      latitude:
        normalizedPosition(row.raw_latitude, row.raw_longitude)?.latitude ??
        null,
      longitude:
        normalizedPosition(row.raw_latitude, row.raw_longitude)?.longitude ??
        null,
      position_quality: positionQuality(row.raw_latitude, row.raw_longitude),
      flags: optionalNumber(row.flags),
      capabilities: advertCapabilities(row.capabilities_json),
      verified: number(row.verified) === 1,
      signature_valid: optionalBoolean(row.signature_valid),
      packet_hash: String(row.packet_sha256),
    };
  }

  private async pageLogicalAdverts(input: {
    context: CursorContext;
    clauses: string[];
    parameters: unknown[];
    cursorClause: string;
    limit: number;
    range: { from: number; to: number };
  }): Promise<
    PublicPage<ReturnType<PublicMcpQueryService["mapLogicalAdvert"]>>
  > {
    const rows = await this.database.all<DatabaseRow>(
      `SELECT a.advert_timestamp, a.node_public_key, a.name, a.role,
              coalesce(
                a.latitude,
                json_extract(a.decoded_json, '$.appData.location.latitude')
              ) AS raw_latitude,
              coalesce(
                a.longitude,
                json_extract(a.decoded_json, '$.appData.location.longitude')
              ) AS raw_longitude,
              a.flags, a.capabilities_json,
              a.verified, a.signature_valid,
              lp.id AS id,
              lp.logical_packet_id AS logical_advert_id,
              min(po.received_at_ms) AS matched_first_observed_at_ms,
              max(po.received_at_ms) AS matched_last_observed_at_ms,
              count(DISTINCT po.id) AS observation_count,
              count(DISTINCT p.id) AS raw_packet_count,
              count(DISTINCT coalesce(hex(pp.raw_path_blob), '')) AS route_count,
              lp.first_observed_at_ms AS first_observed_at_total_ms,
              lp.last_observed_at_ms AS last_observed_at_total_ms,
              (SELECT count(*) FROM packet_observations total
                 JOIN packets ptotal ON ptotal.id = total.packet_id
                WHERE ptotal.logical_packet_id = lp.id) AS observation_count_total,
              (SELECT packet_sha256 FROM packets p2
                WHERE p2.logical_packet_id = lp.id
                ORDER BY p2.first_seen_at_ms, p2.id LIMIT 1) AS packet_sha256,
              (SELECT json_group_array(sha) FROM (
                 SELECT p3.packet_sha256 AS sha FROM packets p3
                  WHERE p3.logical_packet_id = lp.id
                    AND EXISTS (SELECT 1 FROM packet_observations po4
                      WHERE po4.packet_id = p3.id
                        AND po4.received_at_ms BETWEEN ? AND ?)
                  ORDER BY p3.first_seen_at_ms, p3.id LIMIT 250
               )) AS raw_packet_hashes_json
       FROM node_adverts a
       JOIN nodes n ON n.id = a.node_id
       JOIN packets p ON p.id = a.packet_id
       JOIN logical_packets lp ON lp.id = p.logical_packet_id
       JOIN packet_observations po ON po.packet_id = p.id
       LEFT JOIN packet_paths pp ON pp.packet_observation_id = po.id
       WHERE ${input.clauses.join(" AND ")}
       GROUP BY lp.id
       ${input.cursorClause}
       ORDER BY matched_last_observed_at_ms DESC, lp.id DESC LIMIT ?`,
      input.range.from,
      input.range.to,
      ...input.parameters,
      input.limit + 1,
    );
    return this.page(
      rows,
      input.limit,
      "matched_last_observed_at_ms",
      input.context,
      (row) => this.mapLogicalAdvert(row),
    );
  }

  async getNodeAdverts(input: PageInput & TimeRange & { publicKey: string }) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const context = cursorContext("get_node_adverts", {
      public_key: input.publicKey,
      from: input.from,
      to: input.to,
    });
    const parameters: unknown[] = [input.publicKey, range.from, range.to];
    let cursorClause = "";
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      cursorClause =
        "HAVING (max(po.received_at_ms) < ? OR (max(po.received_at_ms) = ? AND lp.id < ?))";
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    return this.pageLogicalAdverts({
      context,
      clauses: ["n.public_key = ?", "po.received_at_ms BETWEEN ? AND ?"],
      parameters,
      cursorClause,
      limit,
      range,
    });
  }

  async searchAdverts(
    input: PageInput &
      TimeRange & {
        nodePublicKey?: string;
        prefixHex?: string;
        logicalPacketId?: string;
        name?: string;
        role?: string;
        region?: string;
        verified?: boolean;
        signatureValid?: boolean;
        hasLocation?: boolean;
        geo?: GeoFilterInput;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const context = cursorContext("search_adverts", {
      node_public_key: input.nodePublicKey,
      prefix_hex: input.prefixHex,
      logical_packet_id: input.logicalPacketId,
      name: input.name,
      role: input.role,
      region: input.region,
      verified: input.verified,
      signature_valid: input.signatureValid,
      has_location: input.hasLocation,
      latitude: input.geo?.latitude,
      longitude: input.geo?.longitude,
      radius_km: input.geo?.radiusKm,
      min_latitude: input.geo?.minLatitude,
      max_latitude: input.geo?.maxLatitude,
      min_longitude: input.geo?.minLongitude,
      max_longitude: input.geo?.maxLongitude,
      from: input.from,
      to: input.to,
    });
    const clauses = ["po.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [range.from, range.to];
    if (input.logicalPacketId) {
      clauses.push("lp.logical_packet_id = ?");
      parameters.push(input.logicalPacketId);
    }
    if (input.nodePublicKey) {
      clauses.push("n.public_key = ?");
      parameters.push(input.nodePublicKey);
    }
    if (input.prefixHex) {
      clauses.push("n.public_key LIKE ?");
      parameters.push(`${input.prefixHex}%`);
    }
    if (input.name) {
      clauses.push("a.name LIKE ? ESCAPE '\\'");
      parameters.push(`%${escapeLike(input.name)}%`);
    }
    if (input.role) {
      clauses.push("a.role = ?");
      parameters.push(input.role);
    }
    if (input.region) {
      clauses.push("po.region = ?");
      parameters.push(input.region);
    }
    if (input.verified !== undefined) {
      clauses.push("a.verified = ?");
      parameters.push(input.verified ? 1 : 0);
    }
    if (input.signatureValid !== undefined) {
      clauses.push("a.signature_valid = ?");
      parameters.push(input.signatureValid ? 1 : 0);
    }
    if (input.hasLocation === true) clauses.push("a.latitude IS NOT NULL");
    if (input.hasLocation === false) clauses.push("a.latitude IS NULL");
    if (input.geo) {
      const geo = geospatialClauses("a.latitude", "a.longitude", input.geo);
      if (geo.clause) {
        clauses.push(geo.clause);
        parameters.push(...geo.parameters);
      }
    }
    let cursorClause = "";
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      cursorClause =
        "HAVING (max(po.received_at_ms) < ? OR (max(po.received_at_ms) = ? AND lp.id < ?))";
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    return this.pageLogicalAdverts({
      context,
      clauses,
      parameters,
      cursorClause,
      limit,
      range,
    });
  }

  async getNodesBatch(publicKeys: string[]) {
    const results = await Promise.all(
      publicKeys.map(async (publicKey) => {
        const node = await this.getNode(publicKey);
        return { publicKey, node };
      }),
    );
    const found: unknown[] = [];
    const missing: string[] = [];
    for (const { publicKey, node } of results) {
      if (node) found.push(node.data);
      else missing.push(publicKey);
    }
    return {
      data: { nodes: found, missing_public_keys: missing },
      meta: this.meta(),
    };
  }

  async getObserversBatch(publicKeys: string[]) {
    const results = await Promise.all(
      publicKeys.map(async (publicKey) => {
        const observer = await this.getObserver(publicKey);
        return { publicKey, observer };
      }),
    );
    const found: unknown[] = [];
    const missing: string[] = [];
    for (const { publicKey, observer } of results) {
      if (observer) found.push(observer.data);
      else missing.push(publicKey);
    }
    return {
      data: { observers: found, missing_public_keys: missing },
      meta: this.meta(),
    };
  }

  async getPacketsBatch(packetHashes: string[]) {
    const results = await Promise.all(
      packetHashes.map(async (packetHash) => {
        const packet = await this.getPacket(packetHash);
        return { packetHash, packet };
      }),
    );
    const found: unknown[] = [];
    const missing: string[] = [];
    for (const { packetHash, packet } of results) {
      if (packet) found.push(packet.data);
      else missing.push(packetHash);
    }
    return {
      data: { packets: found, missing_packet_hashes: missing },
      meta: this.meta(),
    };
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
    const context = cursorContext("get_node_sightings", {
      node_public_key: input.nodePublicKey,
      observer_public_key: input.observerPublicKey,
      region: input.region,
      from: input.from,
      to: input.to,
    });
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
      const cursor = decodePublicMcpCursor(input.cursor, context);
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
    return this.page(rows, limit, "received_at_ms", context, (row) => ({
      node_public_key: input.nodePublicKey,
      observer_public_key: String(row.observer_public_key),
      region: String(row.region),
      timestamp: iso(row.received_at_ms),
      sighting_type: String(row.sighting_type),
      packet_hash: String(row.packet_sha256),
    }));
  }

  async getNodePositionHistory(
    input: PageInput & TimeRange & { publicKey: string },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const context = cursorContext("get_node_position_history", {
      public_key: input.publicKey,
      from: input.from,
      to: input.to,
    });
    const parameters: unknown[] = [input.publicKey, range.from, range.to];
    let cursorClause = "";
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      cursorClause =
        "HAVING (min(po.received_at_ms) < ? OR (min(po.received_at_ms) = ? AND lp.id < ?))";
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT lp.id AS id,
              lp.logical_packet_id AS logical_advert_id,
              coalesce(
                a.latitude,
                json_extract(a.decoded_json, '$.appData.location.latitude')
              ) AS raw_latitude,
              coalesce(
                a.longitude,
                json_extract(a.decoded_json, '$.appData.location.longitude')
              ) AS raw_longitude,
              a.name, a.role,
              min(po.received_at_ms) AS matched_first_observed_at_ms,
              max(po.received_at_ms) AS matched_last_observed_at_ms,
              lp.first_observed_at_ms AS first_observed_at_total_ms,
              lp.last_observed_at_ms AS last_observed_at_total_ms,
              count(DISTINCT po.id) AS observation_count
       FROM node_adverts a
       JOIN nodes n ON n.id = a.node_id
       JOIN packets p ON p.id = a.packet_id
       JOIN logical_packets lp ON lp.id = p.logical_packet_id
       JOIN packet_observations po ON po.packet_id = p.id
       WHERE n.public_key = ? AND po.received_at_ms BETWEEN ? AND ?
         AND (
           a.latitude IS NOT NULL
           OR json_extract(a.decoded_json, '$.appData.location.latitude') IS NOT NULL
         )
       GROUP BY lp.id
       ${cursorClause}
       ORDER BY matched_first_observed_at_ms DESC, lp.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(
      rows,
      limit,
      "matched_first_observed_at_ms",
      context,
      (row) => ({
        logical_advert_id: String(row.logical_advert_id),
        latitude:
          normalizedPosition(row.raw_latitude, row.raw_longitude)?.latitude ??
          null,
        longitude:
          normalizedPosition(row.raw_latitude, row.raw_longitude)?.longitude ??
          null,
        position_quality: positionQuality(row.raw_latitude, row.raw_longitude),
        name: optionalText(row.name),
        role: optionalText(row.role),
        first_observed_at: iso(row.matched_first_observed_at_ms),
        last_observed_at: iso(row.matched_last_observed_at_ms),
        observation_count: number(row.observation_count),
        first_observed_at_total: iso(row.first_observed_at_total_ms),
        last_observed_at_total: iso(row.last_observed_at_total_ms),
      }),
    );
  }

  async searchProcessingErrors(
    input: PageInput &
      TimeRange & {
        stage?: string;
        code?: string;
        packetHash?: string;
        observerPublicKey?: string;
        region?: string;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const context = cursorContext("search_processing_errors", {
      stage: input.stage,
      code: input.code,
      packet_hash: input.packetHash,
      observer_public_key: input.observerPublicKey,
      region: input.region,
      from: input.from,
      to: input.to,
    });
    const clauses = ["pe.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [range.from, range.to];
    if (input.stage) {
      clauses.push("pe.stage = ?");
      parameters.push(input.stage);
    }
    if (input.code) {
      clauses.push("pe.error_code = ?");
      parameters.push(input.code);
    }
    if (input.packetHash) {
      clauses.push("p.packet_sha256 = ?");
      parameters.push(input.packetHash);
    }
    if (input.observerPublicKey) {
      clauses.push("o.public_key = ?");
      parameters.push(input.observerPublicKey);
    }
    if (input.region) {
      clauses.push("e.region = ?");
      parameters.push(input.region);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      clauses.push(
        "(pe.received_at_ms < ? OR (pe.received_at_ms = ? AND pe.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT pe.id, pe.stage, pe.error_code, pe.error_message,
              pe.processor_name, pe.processor_version, pe.received_at_ms,
              p.packet_sha256, o.public_key AS observer_public_key, e.region
       FROM processing_errors pe
       JOIN mqtt_events e ON e.id = pe.mqtt_event_id
       LEFT JOIN packets p ON p.id = pe.packet_id
       LEFT JOIN observers o ON o.id = e.observer_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY pe.received_at_ms DESC, pe.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "received_at_ms", context, (row) => ({
      error_id: number(row.id),
      stage: String(row.stage),
      error_code: String(row.error_code),
      error_message: String(row.error_message),
      processor_name: optionalText(row.processor_name),
      processor_version: optionalText(row.processor_version),
      received_at: iso(row.received_at_ms),
      packet_hash: optionalText(row.packet_sha256),
      observer_public_key: optionalText(row.observer_public_key),
      region: optionalText(row.region),
    }));
  }

  async getDataQualitySummary(input: TimeRange & { region?: string }) {
    const range = this.range(input, DEFAULT_NETWORK_SUMMARY_WINDOW_MS);
    const nowSeconds = Math.floor(this.now() / 1_000);
    const regionClause = input.region ? "AND po.region = ?" : "";
    const regionParameters = input.region ? [input.region] : [];
    const summary = await this.database.get<DatabaseRow>(
      `SELECT
         (SELECT count(*) FROM node_adverts a
           JOIN packets p ON p.id = a.packet_id
           JOIN packet_observations po ON po.packet_id = p.id
           WHERE po.received_at_ms BETWEEN ? AND ? ${regionClause}
             AND a.signature_valid = 0) AS invalid_signatures,
         (SELECT count(*) FROM packets p
           JOIN packet_observations po ON po.packet_id = p.id
           WHERE po.received_at_ms BETWEEN ? AND ? ${regionClause}
             AND p.decode_status IN ('unknown_type','invalid_packet','decoder_error')) AS decoder_errors,
         (SELECT count(*) FROM packets p
           JOIN packet_observations po ON po.packet_id = p.id
           WHERE po.received_at_ms BETWEEN ? AND ? ${regionClause}
             AND p.decode_status = 'unknown_type') AS unknown_packet_types,
         (SELECT count(*) FROM node_adverts a
           JOIN packets p ON p.id = a.packet_id
           JOIN packet_observations po ON po.packet_id = p.id
           WHERE po.received_at_ms BETWEEN ? AND ? ${regionClause}
             AND a.advert_timestamp IS NOT NULL
             AND a.advert_timestamp < 946684800) AS implausible_embedded_timestamps,
         (SELECT count(*) FROM node_adverts a
           JOIN packets p ON p.id = a.packet_id
           JOIN packet_observations po ON po.packet_id = p.id
           WHERE po.received_at_ms BETWEEN ? AND ? ${regionClause}
             AND a.advert_timestamp IS NOT NULL
             AND a.advert_timestamp > ?) AS future_timestamps,
         (SELECT count(*) FROM node_adverts a
           JOIN packets p ON p.id = a.packet_id
           JOIN packet_observations po ON po.packet_id = p.id
           WHERE po.received_at_ms BETWEEN ? AND ? ${regionClause}
             AND json_extract(a.decoded_json, '$.appData.hasLocation') = 1
             AND json_extract(a.decoded_json, '$.appData.location.latitude') = 0
             AND json_extract(a.decoded_json, '$.appData.location.longitude') = 0) AS zero_zero_positions,
         (SELECT count(*) FROM packet_observations po
           WHERE po.received_at_ms BETWEEN ? AND ? ${regionClause}
             AND (po.rssi IS NULL OR po.snr IS NULL)) AS missing_rssi_snr,
         (SELECT count(*) FROM packet_path_hops ph
           JOIN packet_paths pp ON pp.id = ph.path_id
           JOIN packet_observations po ON po.id = pp.packet_observation_id
           WHERE po.received_at_ms BETWEEN ? AND ? ${regionClause}
             AND ph.resolution_status = 'unresolved') AS unresolved_path_prefixes,
         (SELECT count(*) FROM packet_path_hops ph
           JOIN packet_paths pp ON pp.id = ph.path_id
           JOIN packet_observations po ON po.id = pp.packet_observation_id
           WHERE po.received_at_ms BETWEEN ? AND ? ${regionClause}
             AND ph.resolution_status = 'ambiguous') AS ambiguous_path_prefixes,
         (SELECT count(*) FROM (
            SELECT p.logical_packet_id FROM packets p
            JOIN packet_observations po ON po.packet_id = p.id
            WHERE po.received_at_ms BETWEEN ? AND ? ${regionClause}
              AND p.logical_packet_id IS NOT NULL
            GROUP BY p.logical_packet_id HAVING count(DISTINCT p.id) > 1
          )) AS logical_packets_with_multiple_routes,
         (SELECT count(*) FROM processing_errors pe
           JOIN mqtt_events e ON e.id = pe.mqtt_event_id
           WHERE pe.received_at_ms BETWEEN ? AND ?
             ${input.region ? "AND e.region = ?" : ""}) AS processing_errors`,
      ...Array.from({ length: 5 }, () => [
        range.from,
        range.to,
        ...regionParameters,
      ]).flat(),
      nowSeconds + 86_400,
      ...Array.from({ length: 5 }, () => [
        range.from,
        range.to,
        ...regionParameters,
      ]).flat(),
      range.from,
      range.to,
      ...regionParameters,
    );
    return {
      data: {
        window_from: iso(range.from),
        window_to: iso(range.to),
        invalid_signatures: number(summary?.invalid_signatures ?? 0),
        decoder_errors: number(summary?.decoder_errors ?? 0),
        unknown_packet_types: number(summary?.unknown_packet_types ?? 0),
        implausible_embedded_timestamps: number(
          summary?.implausible_embedded_timestamps ?? 0,
        ),
        future_timestamps: number(summary?.future_timestamps ?? 0),
        zero_zero_positions: number(summary?.zero_zero_positions ?? 0),
        missing_rssi_snr: number(summary?.missing_rssi_snr ?? 0),
        unresolved_path_prefixes: number(
          summary?.unresolved_path_prefixes ?? 0,
        ),
        ambiguous_path_prefixes: number(summary?.ambiguous_path_prefixes ?? 0),
        logical_packets_with_multiple_routes: number(
          summary?.logical_packets_with_multiple_routes ?? 0,
        ),
        processing_errors: number(summary?.processing_errors ?? 0),
      },
      meta: this.meta(),
    };
  }

  async resolveNodePrefix(prefixHex: string) {
    const candidates = await this.database.all<DatabaseRow>(
      `SELECT n.public_key, n.latest_name, n.latest_role,
              n.latest_latitude, n.latest_longitude,
              max(pc.confidence) AS confidence,
              sum(pc.evidence_count) AS evidence_count
       FROM node_prefix_candidates pc JOIN nodes n ON n.id = pc.node_id
       WHERE n.public_key LIKE ? AND pc.prefix_length_bytes = ?
       GROUP BY n.id, n.public_key, n.latest_name, n.latest_role
       ORDER BY confidence DESC, evidence_count DESC, n.public_key LIMIT 251`,
      `${prefixHex}%`,
      prefixHex.length / 2,
    );
    return {
      data: {
        prefix_hex: prefixHex,
        prefix_length_bytes: prefixHex.length / 2,
        candidates: candidates.slice(0, 250).map((row) => ({
          public_key: String(row.public_key),
          name: optionalText(row.latest_name),
          role: optionalText(row.latest_role),
          latitude:
            normalizedPosition(row.latest_latitude, row.latest_longitude)
              ?.latitude ?? null,
          longitude:
            normalizedPosition(row.latest_latitude, row.latest_longitude)
              ?.longitude ?? null,
          confidence: number(row.confidence),
          evidence_count: number(row.evidence_count),
        })),
        resolution_status:
          candidates.length === 0
            ? "unresolved"
            : candidates.length === 1
              ? "resolved"
              : "ambiguous",
        ambiguous: candidates.length > 1,
      },
      meta: this.meta(null, false, candidates.length > 250),
    };
  }

  async searchPackets(
    input: PageInput &
      TimeRange & {
        view?: "logical" | "raw";
        packetHash?: string;
        logicalPacketId?: string;
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
        sort?: SortSpec;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const view = input.view ?? "logical";
    const sort = allowedSort(input.sort, [
      "last_observed_at",
      "first_observed_at",
    ]);
    const sortAlias =
      sort?.field === "first_observed_at"
        ? "matched_first_seen_at_ms"
        : "matched_last_seen_at_ms";
    const keyset = keysetClauses(
      sort ? { field: sortAlias, order: sort.order } : undefined,
      "matched_last_seen_at_ms",
      view === "logical" ? "lp.id" : "p.id",
    );
    assertOrderedRange("min_rssi", input.minRssi, "max_rssi", input.maxRssi);
    assertOrderedRange("min_snr", input.minSnr, "max_snr", input.maxSnr);
    assertOrderedRange(
      "min_score",
      input.minScore,
      "max_score",
      input.maxScore,
    );
    assertOrderedRange("min_hops", input.minHops, "max_hops", input.maxHops);
    const context = cursorContext("search_packets", {
      view,
      packet_hash: input.packetHash,
      logical_packet_id: input.logicalPacketId,
      observer_public_key: input.observerPublicKey,
      node_public_key: input.nodePublicKey,
      region: input.region,
      packet_type: input.packetType,
      payload_type: input.payloadType,
      route_type: input.routeType,
      min_rssi: input.minRssi,
      max_rssi: input.maxRssi,
      min_snr: input.minSnr,
      max_snr: input.maxSnr,
      min_score: input.minScore,
      max_score: input.maxScore,
      min_hops: input.minHops,
      max_hops: input.maxHops,
      decode_status: input.decodeStatus,
      sort: sort?.field,
      order: sort?.order,
      from: input.from,
      to: input.to,
    });
    const clauses = ["po.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [range.from, range.to];
    if (input.packetHash) {
      clauses.push("p.packet_sha256 = ?");
      parameters.push(input.packetHash);
    }
    if (input.logicalPacketId) {
      clauses.push(
        view === "logical"
          ? "lp.logical_packet_id = ?"
          : "EXISTS (SELECT 1 FROM logical_packets lp2 WHERE lp2.id = p.logical_packet_id AND lp2.logical_packet_id = ?)",
      );
      parameters.push(input.logicalPacketId);
    }
    const equalFilters: Array<[unknown, string]> = [
      [input.observerPublicKey, "o.public_key = ?"],
      [input.region, "po.region = ?"],
      [input.routeType, "p.route_type = ?"],
      [input.decodeStatus, "p.decode_status = ?"],
    ];
    if (view === "logical") {
      if (input.packetType !== undefined) {
        clauses.push("lp.packet_type = ?");
        parameters.push(input.packetType);
      }
      if (input.payloadType !== undefined) {
        clauses.push("lp.payload_type = ?");
        parameters.push(input.payloadType);
      }
    } else {
      if (input.packetType !== undefined) {
        clauses.push("p.packet_type = ?");
        parameters.push(input.packetType);
      }
      if (input.payloadType !== undefined) {
        clauses.push("p.payload_type = ?");
        parameters.push(input.payloadType);
      }
    }
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
    let cursorClause = "";
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      cursorClause = `HAVING ${keyset.cursor}`;
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    if (view === "logical") {
      const rows = await this.database.all<DatabaseRow>(
        `SELECT lp.id, lp.logical_packet_id, lp.packet_type, lp.payload_type,
                min(po.received_at_ms) AS matched_first_seen_at_ms,
                max(po.received_at_ms) AS matched_last_seen_at_ms,
                lp.first_observed_at_ms AS first_seen_at_total_ms,
                lp.last_observed_at_ms AS last_seen_at_total_ms,
                count(DISTINCT po.id) AS observation_count,
                count(DISTINCT p.id) AS raw_packet_count,
                (SELECT count(*) FROM packet_observations total
                   JOIN packets ptotal ON ptotal.id = total.packet_id
                  WHERE ptotal.logical_packet_id = lp.id) AS observation_count_total,
                (SELECT count(*) FROM packets ptotal
                  WHERE ptotal.logical_packet_id = lp.id) AS raw_packet_count_total,
                min(po.rssi) AS min_rssi, max(po.rssi) AS max_rssi,
                min(po.snr) AS min_snr, max(po.snr) AS max_snr,
                max(coalesce(pp.hop_count, 0)) AS hop_count
         FROM logical_packets lp
         JOIN packets p ON p.logical_packet_id = lp.id
         JOIN packet_observations po ON po.packet_id = p.id
         JOIN observers o ON o.id = po.observer_id
         LEFT JOIN packet_paths pp ON pp.packet_observation_id = po.id
         WHERE ${clauses.join(" AND ")}
         GROUP BY lp.id ${cursorClause}
         ORDER BY ${keyset.orderBy} LIMIT ?`,
        ...parameters,
        limit + 1,
      );
      return this.page(rows, limit, sortAlias, context, (row) => ({
        logical_packet_id: String(row.logical_packet_id),
        packet_type: optionalText(row.packet_type),
        payload_type: optionalText(row.payload_type),
        first_observed_at: iso(row.matched_first_seen_at_ms),
        last_observed_at: iso(row.matched_last_seen_at_ms),
        observation_count: number(row.observation_count),
        raw_packet_count: number(row.raw_packet_count),
        first_observed_at_total: iso(row.first_seen_at_total_ms),
        last_observed_at_total: iso(row.last_seen_at_total_ms),
        observation_count_total: number(row.observation_count_total),
        raw_packet_count_total: number(row.raw_packet_count_total),
        min_rssi: optionalNumber(row.min_rssi),
        max_rssi: optionalNumber(row.max_rssi),
        min_snr: optionalNumber(row.min_snr),
        max_snr: optionalNumber(row.max_snr),
        hop_count: number(row.hop_count),
      }));
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT p.id, p.packet_sha256, p.packet_length, p.packet_type,
              p.payload_type, p.route_type, p.decode_status,
              min(po.received_at_ms) AS matched_first_seen_at_ms,
              max(po.received_at_ms) AS matched_last_seen_at_ms,
              p.first_seen_at_ms AS first_seen_at_total_ms,
              p.last_seen_at_ms AS last_seen_at_total_ms,
              (SELECT count(*) FROM packet_observations total
                WHERE total.packet_id = p.id) AS observation_count_total,
              count(DISTINCT po.id) AS observation_count,
              min(po.rssi) AS min_rssi, max(po.rssi) AS max_rssi,
              min(po.snr) AS min_snr, max(po.snr) AS max_snr,
              max(coalesce(pp.hop_count, 0)) AS hop_count
       FROM packets p JOIN packet_observations po ON po.packet_id = p.id
       JOIN observers o ON o.id = po.observer_id
       LEFT JOIN packet_paths pp ON pp.packet_observation_id = po.id
       WHERE ${clauses.join(" AND ")}
       GROUP BY p.id ${cursorClause}
       ORDER BY ${keyset.orderBy} LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, sortAlias, context, (row) => ({
      packet_hash: String(row.packet_sha256),
      packet_length: number(row.packet_length),
      packet_type: optionalText(row.packet_type),
      payload_type: optionalText(row.payload_type),
      route_type: optionalText(row.route_type),
      decode_status: String(row.decode_status),
      first_seen_at: iso(row.matched_first_seen_at_ms),
      last_seen_at: iso(row.matched_last_seen_at_ms),
      observation_count: number(row.observation_count),
      first_seen_at_total: iso(row.first_seen_at_total_ms),
      last_seen_at_total: iso(row.last_seen_at_total_ms),
      observation_count_total: number(row.observation_count_total),
      min_rssi: optionalNumber(row.min_rssi),
      max_rssi: optionalNumber(row.max_rssi),
      min_snr: optionalNumber(row.min_snr),
      max_snr: optionalNumber(row.max_snr),
      hop_count: number(row.hop_count),
    }));
  }

  async getPacket(packetHash: string) {
    const packet = await this.database.get<DatabaseRow>(
      `SELECT p.*, lp.logical_packet_id,
              (SELECT count(*) FROM packet_observations po
                WHERE po.packet_id = p.id) AS observation_count,
              (SELECT count(*) FROM packets p2
                WHERE p2.logical_packet_id = p.logical_packet_id
                  AND p.logical_packet_id IS NOT NULL) AS raw_packet_count
       FROM packets p
       LEFT JOIN logical_packets lp ON lp.id = p.logical_packet_id
       WHERE p.packet_sha256 = ?`,
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
        logical_packet_id: optionalText(packet.logical_packet_id),
        raw_packet_count: number(packet.raw_packet_count),
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
      meta: this.meta(null, false, paths.length === 250),
    };
  }

  async searchPaths(
    input: PageInput &
      TimeRange & {
        region?: string;
        logicalPacketId?: string;
        packetHash?: string;
        observerPublicKey?: string;
        containsPrefixHex?: string;
        containsNodePublicKey?: string;
        minHops?: number;
        maxHops?: number;
        containsResolutionStatus?: string;
        sort?: SortSpec;
        order?: "asc" | "desc";
      },
  ) {
    const limit = Math.min(
      pageLimit(input, this.config),
      MAX_PATH_OBSERVATIONS_PAGE,
    );
    let range = this.range(input);
    const sort: SortSpec = input.sort
      ? (allowedSort(input.sort, ["received_at"]) ?? {
          field: "received_at",
          order: "desc",
        })
      : { field: "received_at", order: input.order ?? "desc" };
    const ascending = sort.order === "asc";
    const context = cursorContext("search_paths", {
      region: input.region,
      logical_packet_id: input.logicalPacketId,
      packet_hash: input.packetHash,
      observer_public_key: input.observerPublicKey,
      contains_prefix_hex: input.containsPrefixHex,
      contains_node_public_key: input.containsNodePublicKey,
      min_hops: input.minHops,
      max_hops: input.maxHops,
      contains_resolution_status: input.containsResolutionStatus,
      order: sort.order,
      from: input.from,
      to: input.to,
    });
    assertOrderedRange("min_hops", input.minHops, "max_hops", input.maxHops);
    const clauses = ["po.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [range.from, range.to];
    if (input.region) {
      clauses.push("po.region = ?");
      parameters.push(input.region);
    }
    if (input.logicalPacketId) {
      clauses.push("lp.logical_packet_id = ?");
      parameters.push(input.logicalPacketId);
    }
    if (input.packetHash) {
      clauses.push("p.packet_sha256 = ?");
      parameters.push(input.packetHash);
    }
    if (input.observerPublicKey) {
      clauses.push("o.public_key = ?");
      parameters.push(input.observerPublicKey);
    }
    if (input.minHops !== undefined) {
      clauses.push("pp.hop_count >= ?");
      parameters.push(input.minHops);
    }
    if (input.maxHops !== undefined) {
      clauses.push("pp.hop_count <= ?");
      parameters.push(input.maxHops);
    }
    if (input.containsPrefixHex) {
      if (!/^(?:[0-9A-Fa-f]{2}){1,3}$/.test(input.containsPrefixHex)) {
        throw new PublicQueryInputError(
          "invalid_prefix_hex",
          "contains_prefix_hex must be 2, 4 or 6 hex characters.",
        );
      }
      clauses.push(
        "EXISTS (SELECT 1 FROM packet_path_hops ph WHERE ph.path_id = pp.id AND ph.prefix_hex LIKE ?)",
      );
      parameters.push(`${input.containsPrefixHex.toUpperCase()}%`);
    }
    if (input.containsNodePublicKey) {
      clauses.push(
        "EXISTS (SELECT 1 FROM packet_path_hops ph JOIN node_prefix_candidates pc ON pc.prefix_hex = ph.prefix_hex AND pc.prefix_length_bytes = ph.prefix_length_bytes JOIN nodes n2 ON n2.id = pc.node_id WHERE ph.path_id = pp.id AND n2.public_key = ?)",
      );
      parameters.push(input.containsNodePublicKey);
    }
    if (input.containsResolutionStatus) {
      const comparison =
        input.containsResolutionStatus === "resolved"
          ? "= 1"
          : input.containsResolutionStatus === "unresolved"
            ? "= 0"
            : "> 1";
      clauses.push(
        `EXISTS (SELECT 1 FROM packet_path_hops ph WHERE ph.path_id = pp.id AND (SELECT count(*) FROM node_prefix_candidates pc WHERE pc.prefix_hex = ph.prefix_hex AND pc.prefix_length_bytes = ph.prefix_length_bytes) ${comparison})`,
      );
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      if (cursor.from !== undefined && cursor.to !== undefined) {
        range = { from: cursor.from, to: cursor.to };
        parameters[0] = range.from;
        parameters[1] = range.to;
      }
      clauses.push(
        ascending
          ? "(po.received_at_ms > ? OR (po.received_at_ms = ? AND po.id > ?))"
          : "(po.received_at_ms < ? OR (po.received_at_ms = ? AND po.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT po.id, o.public_key AS observer_public_key, po.region,
              po.received_at_ms, po.reported_at_ms, po.rssi, po.snr,
              po.score, po.direction, p.packet_sha256,
              lp.logical_packet_id, pp.id AS path_id,
              hex(pp.raw_path_blob) AS raw_path, pp.hop_count
       FROM packet_observations po JOIN packets p ON p.id = po.packet_id
       LEFT JOIN logical_packets lp ON lp.id = p.logical_packet_id
       JOIN observers o ON o.id = po.observer_id
       JOIN packet_paths pp ON pp.packet_observation_id = po.id
       WHERE ${clauses.join(" AND ")}
       ORDER BY po.received_at_ms ${ascending ? "ASC" : "DESC"},
                po.id ${ascending ? "ASC" : "DESC"} LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    const selectedRows = rows.slice(0, limit);
    const pathIds = selectedRows
      .map((row) => number(row.path_id))
      .filter((id) => id > 0);
    const hops =
      pathIds.length === 0
        ? []
        : await this.database.all<DatabaseRow>(
            `SELECT ph.path_id, ph.hop_index, ph.prefix_hex,
                    ph.prefix_length_bytes
             FROM packet_path_hops ph
             WHERE ph.path_id IN (${pathIds.map(() => "?").join(",")})
             ORDER BY ph.path_id, ph.hop_index`,
            ...pathIds,
          );
    const candidates = await this.candidatesForPrefixes(hops);
    const hopsByPath = new Map<number, DatabaseRow[]>();
    for (const hop of hops) {
      const pathId = number(hop.path_id);
      const list = hopsByPath.get(pathId) ?? [];
      list.push(hop);
      hopsByPath.set(pathId, list);
    }
    const hasMore = rows.length > limit;
    const last = selectedRows[selectedRows.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(
            {
              timestamp: number(last.received_at_ms),
              id: number(last.id),
              from: range.from,
              to: range.to,
            },
            context,
          )
        : null;
    return {
      data: selectedRows.map((row) => {
        const pathId = number(row.path_id);
        return {
          logical_packet_id: optionalText(row.logical_packet_id),
          packet_hash: String(row.packet_sha256),
          observation_id: number(row.id),
          received_at: iso(row.received_at_ms),
          reported_at: optionalIso(row.reported_at_ms),
          observer_public_key: String(row.observer_public_key),
          region: String(row.region),
          rssi: optionalNumber(row.rssi),
          snr: optionalNumber(row.snr),
          score: optionalNumber(row.score),
          direction: optionalText(row.direction),
          raw_path: String(row.raw_path),
          hop_count: number(row.hop_count),
          hops: (hopsByPath.get(pathId) ?? []).map((hop) => {
            const prefix = String(hop.prefix_hex);
            const prefixLength = number(hop.prefix_length_bytes);
            const matches = candidates.get(`${prefixLength}:${prefix}`) ?? [];
            const mapped = matches
              .slice(0, MAX_PATH_HOP_CANDIDATES)
              .map((candidate) => ({
                public_key: String(candidate.public_key),
                name: optionalText(candidate.latest_name),
                role: optionalText(candidate.latest_role),
                latitude:
                  normalizedPosition(
                    candidate.latest_latitude,
                    candidate.latest_longitude,
                  )?.latitude ?? null,
                longitude:
                  normalizedPosition(
                    candidate.latest_latitude,
                    candidate.latest_longitude,
                  )?.longitude ?? null,
                confidence: number(candidate.confidence),
                evidence_count: number(candidate.evidence_count),
              }));
            return {
              index: number(hop.hop_index),
              prefix,
              prefix_length_bytes: prefixLength,
              resolved_public_key:
                matches.length === 1 ? (mapped[0]?.public_key ?? null) : null,
              resolution_status:
                matches.length === 0
                  ? "unresolved"
                  : matches.length === 1
                    ? "resolved"
                    : "ambiguous",
              confidence:
                matches.length === 1 ? (mapped[0]?.confidence ?? null) : null,
              candidates: matches.length > 1 ? mapped : [],
            };
          }),
        };
      }),
      meta: this.meta(nextCursor, hasMore),
    };
  }

  async searchPathPrefixes(
    input: PageInput &
      TimeRange & {
        region?: string;
        prefixHex?: string;
        resolutionStatus?: string;
        minOccurrences?: number;
        sort?: SortSpec;
      },
  ) {
    const limit = pageLimit(input, this.config);
    let range = this.range(input);
    const sort = allowedSort(input.sort, [
      "occurrence_count",
      "first_seen_at",
      "last_seen_at",
    ]);
    const sortAlias =
      sort?.field === "first_seen_at"
        ? "first_seen_at_ms"
        : sort?.field === "last_seen_at"
          ? "last_seen_at_ms"
          : "occurrence_count";
    const sortExpression =
      sortAlias === "occurrence_count" ? "count(*)" : sortAlias;
    const ascending = sort?.order === "asc";
    const context = cursorContext("search_path_prefixes", {
      region: input.region,
      prefix_hex: input.prefixHex,
      resolution_status: input.resolutionStatus,
      min_occurrences: input.minOccurrences,
      sort: sort?.field,
      order: sort?.order,
      from: input.from,
      to: input.to,
    });
    const clauses = ["po.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [range.from, range.to];
    const having: string[] = [];
    if (input.minOccurrences !== undefined) {
      if (
        !Number.isSafeInteger(input.minOccurrences) ||
        input.minOccurrences < 1
      ) {
        throw new PublicQueryInputError(
          "invalid_min_occurrences",
          "min_occurrences must be a positive integer.",
        );
      }
      having.push("count(*) >= ?");
      parameters.push(input.minOccurrences);
    }
    if (input.region) {
      clauses.push("po.region = ?");
      parameters.push(input.region);
    }
    if (input.prefixHex) {
      if (!/^(?:[0-9A-Fa-f]{2}){1,3}$/.test(input.prefixHex)) {
        throw new PublicQueryInputError(
          "invalid_prefix_hex",
          "prefix_hex must be 2, 4 or 6 hex characters.",
        );
      }
      clauses.push("ph.prefix_hex LIKE ?");
      parameters.push(`${input.prefixHex.toUpperCase()}%`);
    }
    if (input.resolutionStatus) {
      const comparison =
        input.resolutionStatus === "resolved"
          ? "= 1"
          : input.resolutionStatus === "unresolved"
            ? "= 0"
            : "> 1";
      having.push(
        `(SELECT count(*) FROM node_prefix_candidates pc WHERE pc.prefix_hex = ph.prefix_hex AND pc.prefix_length_bytes = ph.prefix_length_bytes) ${comparison}`,
      );
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      if (cursor.from !== undefined && cursor.to !== undefined) {
        range = { from: cursor.from, to: cursor.to };
        parameters[0] = range.from;
        parameters[1] = range.to;
      }
      having.push(
        ascending
          ? `(${sortExpression} > ? OR (${sortExpression} = ? AND ph.prefix_hex > ?))`
          : `(${sortExpression} < ? OR (${sortExpression} = ? AND ph.prefix_hex > ?))`,
      );
      parameters.push(
        cursor.timestamp,
        cursor.timestamp,
        cursor.prefix_hex ?? "",
      );
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT ph.prefix_hex, ph.prefix_length_bytes,
              count(*) AS occurrence_count,
              count(DISTINCT p.id) AS raw_packet_count,
              count(DISTINCT lp.id) AS logical_packet_count,
              count(DISTINCT po.observer_id) AS observer_count,
              min(po.received_at_ms) AS first_seen_at_ms,
              max(po.received_at_ms) AS last_seen_at_ms,
              (SELECT count(*) FROM node_prefix_candidates pc
                WHERE pc.prefix_hex = ph.prefix_hex
                  AND pc.prefix_length_bytes = ph.prefix_length_bytes)
                AS candidate_count,
              (SELECT n.public_key FROM node_prefix_candidates pc
                JOIN nodes n ON n.id = pc.node_id
                WHERE pc.prefix_hex = ph.prefix_hex
                  AND pc.prefix_length_bytes = ph.prefix_length_bytes
                LIMIT 1) AS resolved_public_key
       FROM packet_path_hops ph
       JOIN packet_paths pp ON pp.id = ph.path_id
       JOIN packet_observations po ON po.id = pp.packet_observation_id
       JOIN packets p ON p.id = po.packet_id
       LEFT JOIN logical_packets lp ON lp.id = p.logical_packet_id
       WHERE ${clauses.join(" AND ")}
       GROUP BY ph.prefix_hex, ph.prefix_length_bytes
       ${having.length > 0 ? `HAVING ${having.join(" AND ")}` : ""}
       ORDER BY ${sortExpression} ${ascending ? "ASC" : "DESC"},
                ph.prefix_hex ASC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const last = selected[selected.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(
            {
              timestamp: number(last[sortAlias]),
              id: 0,
              prefix_hex: String(last.prefix_hex),
              from: range.from,
              to: range.to,
            },
            context,
          )
        : null;
    return {
      data: selected.map((row) => {
        const candidateCount = number(row.candidate_count);
        return {
          prefix_hex: String(row.prefix_hex),
          prefix_length_bytes: number(row.prefix_length_bytes),
          resolution_status:
            candidateCount === 0
              ? "unresolved"
              : candidateCount === 1
                ? "resolved"
                : "ambiguous",
          resolved_public_key:
            candidateCount === 1 ? optionalText(row.resolved_public_key) : null,
          occurrence_count: number(row.occurrence_count),
          logical_packet_count: number(row.logical_packet_count),
          raw_packet_count: number(row.raw_packet_count),
          observer_count: number(row.observer_count),
          first_seen_at: iso(row.first_seen_at_ms),
          last_seen_at: iso(row.last_seen_at_ms),
        };
      }),
      meta: this.meta(nextCursor, hasMore),
    };
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
    if (!snapshot) {
      const observer = await this.database.get<DatabaseRow>(
        "SELECT id FROM observers WHERE public_key = ?",
        input.observerPublicKey,
      );
      return observer
        ? this.noData("observer_exists_but_has_no_neighbor_snapshot")
        : this.notFound();
    }
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
      meta: this.meta(null, false, neighbors.length === 250),
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
    const context = cursorContext("get_neighbor_history", {
      observer_public_key: input.observerPublicKey,
      neighbor_public_key: input.neighborPublicKey,
      from: input.from,
      to: input.to,
    });
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
      const cursor = decodePublicMcpCursor(input.cursor, context);
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
    return this.page(rows, limit, "received_at_ms", context, (row) => ({
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

  async searchEvents(
    input: PageInput &
      TimeRange & {
        region?: string;
        nodePublicKey?: string;
        observerPublicKey?: string;
        eventTypes?: string[];
        sort?: SortSpec;
        order?: "asc" | "desc";
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const sort: SortSpec = input.sort
      ? (allowedSort(input.sort, ["received_at"]) ?? {
          field: "received_at",
          order: "desc",
        })
      : { field: "received_at", order: input.order ?? "desc" };
    const ascending = sort.order === "asc";
    const context = cursorContext("search_events", {
      region: input.region,
      node_public_key: input.nodePublicKey,
      observer_public_key: input.observerPublicKey,
      event_types: input.eventTypes?.slice().sort(),
      order: sort.order,
      from: input.from,
      to: input.to,
    });
    const nodeKey = input.nodePublicKey;
    const observerKey = input.observerPublicKey;
    const branches: Array<{ sql: string; params: unknown[] }> = [
      {
        sql: `SELECT p.first_seen_at_ms AS received_at_ms, 'packet' AS event_type,
                p.id AS event_id,
                (SELECT po2.region FROM packet_observations po2
                  WHERE po2.packet_id = p.id
                  ORDER BY po2.received_at_ms DESC, po2.id DESC LIMIT 1)
                  AS region,
                (SELECT n.public_key FROM node_sightings s
                  JOIN nodes n ON n.id = s.node_id
                  WHERE s.packet_id = p.id ORDER BY s.id LIMIT 1)
                  AS node_public_key,
                (SELECT o5.public_key FROM packet_observations po7
                  JOIN observers o5 ON o5.id = po7.observer_id
                  WHERE po7.packet_id = p.id
                  ORDER BY po7.received_at_ms DESC, po7.id DESC LIMIT 1)
                  AS observer_public_key,
                p.packet_sha256 AS packet_hash, lp.logical_packet_id,
                NULL AS rssi, NULL AS snr, NULL AS reported_at_ms,
                json_object('packet', json_object(
                  'packet_type', p.packet_type, 'payload_type', p.payload_type,
                  'route_type', p.route_type, 'decode_status', p.decode_status,
                  'packet_length', p.packet_length)) AS payload_json
         FROM packets p
         LEFT JOIN logical_packets lp ON lp.id = p.logical_packet_id
         WHERE p.first_seen_at_ms BETWEEN ? AND ?
         ${
           nodeKey
             ? "AND EXISTS (SELECT 1 FROM node_sightings s JOIN nodes n ON n.id = s.node_id WHERE s.packet_id = p.id AND n.public_key = ?)"
             : ""
         }
         ${
           observerKey
             ? "AND EXISTS (SELECT 1 FROM packet_observations po7 JOIN observers o5 ON o5.id = po7.observer_id WHERE po7.packet_id = p.id AND o5.public_key = ?)"
             : ""
         }`,
        params: [
          range.from,
          range.to,
          ...(nodeKey ? [nodeKey] : []),
          ...(observerKey ? [observerKey] : []),
        ],
      },
      {
        sql: `SELECT na.first_observed_at_ms, 'advert', na.id,
                (SELECT po3.region FROM packet_observations po3
                  WHERE po3.packet_id = na.packet_id
                  ORDER BY po3.received_at_ms, po3.id LIMIT 1),
                na.node_public_key,
                (SELECT o6.public_key FROM packet_observations po8
                  JOIN observers o6 ON o6.id = po8.observer_id
                  WHERE po8.packet_id = na.packet_id
                  ORDER BY po8.received_at_ms, po8.id LIMIT 1),
                p2.packet_sha256, lp2.logical_packet_id,
                NULL, NULL, na.advert_timestamp * 1000,
                json_object('advert', json_object(
                  'name', na.name, 'role', na.role,
                  'latitude', na.latitude, 'longitude', na.longitude,
                  'signature_valid', CASE WHEN na.signature_valid = 1
                    THEN json('true') WHEN na.signature_valid = 0
                    THEN json('false') ELSE NULL END,
                  'verified', CASE WHEN na.verified = 1
                    THEN json('true') ELSE json('false') END))
         FROM node_adverts na JOIN packets p2 ON p2.id = na.packet_id
         LEFT JOIN logical_packets lp2 ON lp2.id = p2.logical_packet_id
         WHERE na.first_observed_at_ms BETWEEN ? AND ?
         ${nodeKey ? "AND na.node_public_key = ?" : ""}
         ${
           observerKey
             ? "AND EXISTS (SELECT 1 FROM packet_observations po8 JOIN observers o6 ON o6.id = po8.observer_id WHERE po8.packet_id = na.packet_id AND o6.public_key = ?)"
             : ""
         }`,
        params: [
          range.from,
          range.to,
          ...(nodeKey ? [nodeKey] : []),
          ...(observerKey ? [observerKey] : []),
        ],
      },
      {
        sql: `SELECT m.received_at_ms, 'message', m.id, po4.region,
                (SELECT n.public_key FROM nodes n
                  WHERE n.id = m.sender_node_id),
                o.public_key, p3.packet_sha256, lp3.logical_packet_id,
                po4.rssi, po4.snr, m.reported_at_ms,
                json_object('message', json_object(
                  'message_type', m.message_type, 'channel', m.channel,
                  'channel_name', m.channel_name,
                  'encrypted', CASE WHEN m.encrypted = 1
                    THEN json('true') ELSE json('false') END,
                  'text', CASE WHEN m.encrypted = 1 THEN NULL ELSE m.text END,
                  'signature_valid', CASE WHEN m.signature_valid = 1
                    THEN json('true') WHEN m.signature_valid = 0
                    THEN json('false') ELSE NULL END))
         FROM messages m JOIN packets p3 ON p3.id = m.packet_id
         LEFT JOIN logical_packets lp3 ON lp3.id = p3.logical_packet_id
         JOIN packet_observations po4 ON po4.id = m.packet_observation_id
         JOIN observers o ON o.id = po4.observer_id
         WHERE m.received_at_ms BETWEEN ? AND ?
         ${
           nodeKey
             ? "AND EXISTS (SELECT 1 FROM nodes n WHERE n.id IN (m.sender_node_id, m.destination_node_id) AND n.public_key = ?)"
             : ""
         }
         ${observerKey ? "AND o.public_key = ?" : ""}`,
        params: [
          range.from,
          range.to,
          ...(nodeKey ? [nodeKey] : []),
          ...(observerKey ? [observerKey] : []),
        ],
      },
      {
        sql: `SELECT te.received_at_ms, 'trace', te.id, po5.region,
                (SELECT n2.public_key FROM nodes n2
                  WHERE n2.id = te.source_node_id),
                o2.public_key, p4.packet_sha256, lp4.logical_packet_id,
                po5.rssi, po5.snr, te.reported_at_ms,
                json_object('trace', json_object(
                  'tag', te.tag,
                  'hop_count', (SELECT count(*) FROM trace_hops th
                    WHERE th.trace_event_id = te.id)))
         FROM trace_events te JOIN packets p4 ON p4.id = te.packet_id
         LEFT JOIN logical_packets lp4 ON lp4.id = p4.logical_packet_id
         JOIN packet_observations po5 ON po5.id = te.packet_observation_id
         JOIN observers o2 ON o2.id = po5.observer_id
         WHERE te.received_at_ms BETWEEN ? AND ?
         ${
           nodeKey
             ? "AND EXISTS (SELECT 1 FROM nodes n2 WHERE n2.id = te.source_node_id AND n2.public_key = ?)"
             : ""
         }
         ${observerKey ? "AND o2.public_key = ?" : ""}`,
        params: [
          range.from,
          range.to,
          ...(nodeKey ? [nodeKey] : []),
          ...(observerKey ? [observerKey] : []),
        ],
      },
      {
        sql: `SELECT tv.received_at_ms, 'telemetry', tv.id, po6.region,
                n3.public_key, o3.public_key,
                p5.packet_sha256, lp5.logical_packet_id,
                po6.rssi, po6.snr, tv.reported_at_ms,
                json_object('telemetry', json_object(
                  'metric_names', COALESCE((SELECT json_group_array(metric_name)
                    FROM (SELECT DISTINCT metric_name FROM telemetry_values
                      WHERE telemetry_event_id = tv.id
                      ORDER BY metric_name LIMIT 20)), json_array())))
         FROM telemetry_events tv JOIN packets p5 ON p5.id = tv.packet_id
         LEFT JOIN logical_packets lp5 ON lp5.id = p5.logical_packet_id
         LEFT JOIN nodes n3 ON n3.id = tv.node_id
         JOIN packet_observations po6 ON po6.id = tv.packet_observation_id
         JOIN observers o3 ON o3.id = po6.observer_id
         WHERE tv.received_at_ms BETWEEN ? AND ?
         ${nodeKey ? "AND n3.public_key = ?" : ""}
         ${observerKey ? "AND o3.public_key = ?" : ""}`,
        params: [
          range.from,
          range.to,
          ...(nodeKey ? [nodeKey] : []),
          ...(observerKey ? [observerKey] : []),
        ],
      },
      {
        sql: `SELECT se.received_at_ms, 'observer_status', se.id, se.region,
                NULL, o4.public_key, NULL, NULL,
                NULL, NULL, se.reported_at_ms,
                json_object('observer_status', json_object(
                  'origin', se.origin, 'model', se.model,
                  'firmware_version', se.firmware_version))
         FROM observer_status_events se
         JOIN observers o4 ON o4.id = se.observer_id
         WHERE se.received_at_ms BETWEEN ? AND ?
         ${nodeKey ? "AND 1 = 0" : ""}
         ${observerKey ? "AND o4.public_key = ?" : ""}`,
        params: [range.from, range.to, ...(observerKey ? [observerKey] : [])],
      },
    ];
    const outerClauses: string[] = [];
    const outerParameters: unknown[] = [];
    if (input.region) {
      outerClauses.push("region = ?");
      outerParameters.push(input.region);
    }
    if (input.eventTypes && input.eventTypes.length > 0) {
      outerClauses.push(
        `event_type IN (${input.eventTypes.map(() => "?").join(",")})`,
      );
      outerParameters.push(...input.eventTypes);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      const eventType = cursor.event_type ?? "";
      outerClauses.push(
        ascending
          ? "(received_at_ms > ? OR (received_at_ms = ? AND event_type > ?) OR (received_at_ms = ? AND event_type = ? AND event_id > ?))"
          : "(received_at_ms < ? OR (received_at_ms = ? AND event_type < ?) OR (received_at_ms = ? AND event_type = ? AND event_id < ?))",
      );
      outerParameters.push(
        cursor.timestamp,
        cursor.timestamp,
        eventType,
        cursor.timestamp,
        eventType,
        cursor.id,
      );
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT * FROM (${branches
        .map((branch) => branch.sql)
        .join(" UNION ALL ")}) ${
        outerClauses.length > 0 ? `WHERE ${outerClauses.join(" AND ")}` : ""
      }
       ORDER BY received_at_ms ${ascending ? "ASC" : "DESC"},
                event_type ${ascending ? "ASC" : "DESC"},
                event_id ${ascending ? "ASC" : "DESC"} LIMIT ?`,
      ...branches.flatMap((branch) => branch.params),
      ...outerParameters,
      limit + 1,
    );
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const last = selected[selected.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(
            {
              timestamp: number(last.received_at_ms),
              id: number(last.event_id),
              event_type: String(last.event_type),
            },
            context,
          )
        : null;
    return {
      data: selected.map((row) => ({
        timestamp: iso(row.received_at_ms),
        event_type: String(row.event_type),
        event_id: number(row.event_id),
        region: optionalText(row.region),
        node_public_key: optionalText(row.node_public_key),
        observer_public_key: optionalText(row.observer_public_key),
        packet_hash: optionalText(row.packet_hash),
        logical_packet_id: optionalText(row.logical_packet_id),
        rssi: optionalNumber(row.rssi),
        snr: optionalNumber(row.snr),
        reported_at: optionalIso(row.reported_at_ms),
        payload: jsonValue(row.payload_json),
      })),
      meta: this.meta(nextCursor, hasMore),
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
    cursor?: string;
  }) {
    const limit = Math.min(
      input.limit ?? this.config.defaultLimit,
      this.config.maxLimit,
    );
    const range = this.range(input);
    if (!Number.isFinite(input.bucketMs) || input.bucketMs <= 0) {
      throw new PublicQueryInputError(
        "invalid_time_range",
        "bucket must be a positive millisecond duration.",
      );
    }
    const bucketCount = Math.ceil((range.to - range.from) / input.bucketMs);
    if (bucketCount > MAX_ACTIVITY_BUCKETS) {
      throw new PublicQueryInputError(
        "too_many_time_buckets",
        `The requested range produces ${bucketCount} buckets; use a coarser bucket or request at most ${MAX_ACTIVITY_BUCKETS} buckets.`,
      );
    }
    const context = cursorContext("get_signal_history", {
      observer_public_key: input.observerPublicKey,
      node_public_key: input.nodePublicKey,
      packet_type: input.packetType,
      from: input.from,
      to: input.to,
      bucket_ms: input.bucketMs,
    });
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
    let cursorClause = "";
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      cursorClause = "HAVING bucket_at_ms < ?";
      parameters.push(cursor.timestamp);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT CAST(po.received_at_ms / ? AS INTEGER) * ? AS bucket_at_ms,
              avg(po.rssi) AS rssi, avg(po.snr) AS snr,
              avg(po.score) AS score, count(*) AS packet_count
       FROM packet_observations po JOIN observers o ON o.id = po.observer_id
       JOIN packets p ON p.id = po.packet_id
       WHERE ${clauses.join(" AND ")}
       GROUP BY bucket_at_ms ${cursorClause}
       ORDER BY bucket_at_ms DESC LIMIT ?`,
      input.bucketMs,
      input.bucketMs,
      ...parameters,
      limit + 1,
    );
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const last = selected[selected.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ timestamp: number(last.bucket_at_ms), id: 0 }, context)
        : null;
    return {
      data: selected.map((row) => ({
        timestamp: iso(row.bucket_at_ms),
        rssi: optionalNumber(row.rssi),
        snr: optionalNumber(row.snr),
        score: optionalNumber(row.score),
        packet_count: number(row.packet_count),
      })),
      meta: this.meta(nextCursor, hasMore),
    };
  }

  async getNodeSignalSummary(
    input: TimeRange & {
      nodePublicKey: string;
      region?: string;
    },
  ) {
    const range = this.range(input);
    const clauses = ["n.public_key = ?", "po.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [input.nodePublicKey, range.from, range.to];
    if (input.region) {
      clauses.push("po.region = ?");
      parameters.push(input.region);
    }
    const rows = await this.database.all<DatabaseRow>(
      `WITH filtered AS (
         SELECT po.id, po.observer_id, po.rssi, po.snr, po.received_at_ms
         FROM packet_observations po
         JOIN node_sightings s ON s.packet_observation_id = po.id
         JOIN nodes n ON n.id = s.node_id
         WHERE ${clauses.join(" AND ")}
       ),
       ranked_rssi AS (
         SELECT observer_id, rssi,
                row_number() OVER (PARTITION BY observer_id ORDER BY rssi) AS rn,
                count(*) OVER (PARTITION BY observer_id) AS cnt
         FROM filtered WHERE rssi IS NOT NULL
       ),
       ranked_snr AS (
         SELECT observer_id, snr,
                row_number() OVER (PARTITION BY observer_id ORDER BY snr) AS rn,
                count(*) OVER (PARTITION BY observer_id) AS cnt
         FROM filtered WHERE snr IS NOT NULL
       ),
       medians AS (
         SELECT observer_id,
                (SELECT avg(rssi) FROM ranked_rssi r
                  WHERE r.observer_id = f.observer_id
                    AND r.rn IN ((r.cnt + 1) / 2, (r.cnt + 2) / 2)) AS median_rssi,
                (SELECT avg(snr) FROM ranked_snr r
                  WHERE r.observer_id = f.observer_id
                    AND r.rn IN ((r.cnt + 1) / 2, (r.cnt + 2) / 2)) AS median_snr
         FROM filtered f GROUP BY f.observer_id
       )
       SELECT o.public_key AS observer_public_key,
              count(*) AS packet_count,
              m.median_rssi, m.median_snr,
              min(f.received_at_ms) AS first_seen_at_ms,
              max(f.received_at_ms) AS last_seen_at_ms
       FROM filtered f
       JOIN observers o ON o.id = f.observer_id
       JOIN medians m ON m.observer_id = f.observer_id
       GROUP BY f.observer_id, o.public_key, m.median_rssi, m.median_snr
       ORDER BY packet_count DESC, last_seen_at_ms DESC, o.public_key
       LIMIT 250`,
      ...parameters,
    );
    return {
      data: rows.map((row) => ({
        observer_public_key: String(row.observer_public_key),
        packet_count: number(row.packet_count),
        median_rssi: optionalNumber(row.median_rssi),
        median_snr: optionalNumber(row.avg_snr),
        first_seen_at: iso(row.first_seen_at_ms),
        last_seen_at: iso(row.last_seen_at_ms),
      })),
      meta: this.meta(null, false, rows.length === 250),
    };
  }

  async searchNeighbors(
    input: PageInput &
      TimeRange & {
        region?: string;
        observerPublicKey?: string;
        neighborPublicKey?: string;
        minSnr?: number;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const context = cursorContext("search_neighbors", {
      region: input.region,
      observer_public_key: input.observerPublicKey,
      neighbor_public_key: input.neighborPublicKey,
      min_snr: input.minSnr,
      from: input.from,
      to: input.to,
    });
    const clauses = ["ns.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [range.from, range.to];
    if (input.region) {
      clauses.push("ns.region = ?");
      parameters.push(input.region);
    }
    if (input.observerPublicKey) {
      clauses.push("o.public_key = ?");
      parameters.push(input.observerPublicKey);
    }
    if (input.neighborPublicKey) {
      clauses.push("ne.neighbor_public_key = ?");
      parameters.push(input.neighborPublicKey);
    }
    if (input.minSnr !== undefined) {
      clauses.push("ne.snr >= ?");
      parameters.push(input.minSnr);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      clauses.push(
        "(ns.received_at_ms < ? OR (ns.received_at_ms = ? AND ne.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT ne.id, o.public_key AS observer_public_key,
              ns.region, ne.neighbor_public_key, ns.received_at_ms,
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
    return this.page(rows, limit, "received_at_ms", context, (row) => ({
      observer_public_key: String(row.observer_public_key),
      neighbor_public_key: String(row.neighbor_public_key),
      region: String(row.region),
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

  async searchTelemetry(
    input: PageInput &
      TimeRange & {
        nodePublicKey?: string;
        metric?: string;
        region?: string;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const context = cursorContext("search_telemetry", {
      node_public_key: input.nodePublicKey,
      metric: input.metric,
      region: input.region,
      from: input.from,
      to: input.to,
    });
    const clauses = ["te.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [range.from, range.to];
    if (input.nodePublicKey) {
      clauses.push("n.public_key = ?");
      parameters.push(input.nodePublicKey);
    }
    if (input.metric) {
      clauses.push("tv.metric_name = ?");
      parameters.push(input.metric);
    }
    if (input.region) {
      clauses.push("po.region = ?");
      parameters.push(input.region);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      clauses.push(
        "(te.received_at_ms < ? OR (te.received_at_ms = ? AND tv.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT tv.id, te.received_at_ms, te.reported_at_ms, tv.metric_name,
              tv.numeric_value, tv.text_value, tv.boolean_value, tv.unit,
              tv.channel, p.packet_sha256, o.public_key AS observer_public_key,
              po.region, n.public_key AS node_public_key
       FROM telemetry_values tv
       JOIN telemetry_events te ON te.id = tv.telemetry_event_id
       JOIN nodes n ON n.id = te.node_id
       JOIN packets p ON p.id = te.packet_id
       JOIN packet_observations po ON po.id = te.packet_observation_id
       JOIN observers o ON o.id = po.observer_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY te.received_at_ms DESC, tv.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "received_at_ms", context, (row) => ({
      timestamp: iso(row.received_at_ms),
      reported_at: optionalIso(row.reported_at_ms),
      node_public_key: String(row.node_public_key),
      observer_public_key: String(row.observer_public_key),
      region: String(row.region),
      metric_name: String(row.metric_name),
      numeric_value: optionalNumber(row.numeric_value),
      text_value: optionalText(row.text_value),
      boolean_value: optionalBoolean(row.boolean_value),
      unit: canonicalMetricUnit(
        String(row.metric_name),
        optionalText(row.unit),
      ),
      channel: optionalNumber(row.channel),
      packet_hash: String(row.packet_sha256),
    }));
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
    const context = cursorContext("search_traces", {
      source_node_public_key: input.sourceNodePublicKey,
      observer_public_key: input.observerPublicKey,
      tag: input.tag,
      from: input.from,
      to: input.to,
    });
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
      const cursor = decodePublicMcpCursor(input.cursor, context);
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
    return this.page(rows, limit, "received_at_ms", context, (row) => ({
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
      `SELECT th.hop_index, th.prefix_hex, th.prefix_length_bytes, th.snr
       FROM trace_hops th
       WHERE th.trace_event_id = ? ORDER BY th.hop_index`,
      traceId,
    );
    const candidates = await this.candidatesForPrefixes(hops);
    return {
      data: {
        trace_id: number(trace.id),
        packet_hash: String(trace.packet_sha256),
        observer_public_key: String(trace.observer_public_key),
        source_public_key: optionalText(trace.source_public_key),
        tag: optionalText(trace.tag),
        reported_at: optionalIso(trace.reported_at_ms),
        received_at: iso(trace.received_at_ms),
        hops: hops.map((row) => {
          const prefix = String(row.prefix_hex);
          const prefixLength = number(row.prefix_length_bytes);
          const matches = candidates.get(`${prefixLength}:${prefix}`) ?? [];
          const mapped = matches.map((candidate) => ({
            public_key: String(candidate.public_key),
            name: optionalText(candidate.latest_name),
            role: optionalText(candidate.latest_role),
            latitude:
              normalizedPosition(
                candidate.latest_latitude,
                candidate.latest_longitude,
              )?.latitude ?? null,
            longitude:
              normalizedPosition(
                candidate.latest_latitude,
                candidate.latest_longitude,
              )?.longitude ?? null,
            confidence: number(candidate.confidence),
            evidence_count: number(candidate.evidence_count),
          }));
          return {
            index: number(row.hop_index),
            prefix,
            prefix_length_bytes: prefixLength,
            snr: optionalNumber(row.snr),
            resolved_public_key:
              mapped.length === 1 ? (mapped[0]?.public_key ?? null) : null,
            resolution_status:
              mapped.length === 0
                ? "unresolved"
                : mapped.length === 1
                  ? "resolved"
                  : "ambiguous",
            confidence:
              mapped.length === 1 ? (mapped[0]?.confidence ?? null) : null,
            candidates: mapped.length > 1 ? mapped : [],
          };
        }),
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
    const context = cursorContext("get_telemetry", {
      node_public_key: input.nodePublicKey,
      metric: input.metric,
      from: input.from,
      to: input.to,
    });
    const clauses = ["n.public_key = ?", "te.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [input.nodePublicKey, range.from, range.to];
    if (input.metric) {
      clauses.push("tv.metric_name = ?");
      parameters.push(input.metric);
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
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
    return this.page(rows, limit, "received_at_ms", context, (row) => ({
      timestamp: iso(row.received_at_ms),
      reported_at: optionalIso(row.reported_at_ms),
      metric_name: String(row.metric_name),
      numeric_value: optionalNumber(row.numeric_value),
      text_value: optionalText(row.text_value),
      boolean_value: optionalBoolean(row.boolean_value),
      unit: canonicalMetricUnit(
        String(row.metric_name),
        optionalText(row.unit),
      ),
      channel: optionalNumber(row.channel),
      packet_hash: String(row.packet_sha256),
    }));
  }

  async searchMessages(
    input: PageInput &
      TimeRange & {
        view?: "logical" | "raw";
        packetHash?: string;
        logicalPacketId?: string;
        senderNodePublicKey?: string;
        destinationNodePublicKey?: string;
        messageType?: string;
        channel?: string;
        encrypted?: boolean;
        signatureValid?: boolean;
        region?: string;
        observerPublicKey?: string;
      },
  ) {
    const limit = pageLimit(input, this.config);
    const range = this.range(input);
    const view = input.view ?? "logical";
    const context = cursorContext("search_messages", {
      view,
      packet_hash: input.packetHash,
      logical_packet_id: input.logicalPacketId,
      sender_node_public_key: input.senderNodePublicKey,
      destination_node_public_key: input.destinationNodePublicKey,
      message_type: input.messageType,
      channel: input.channel,
      encrypted: input.encrypted,
      signature_valid: input.signatureValid,
      region: input.region,
      observer_public_key: input.observerPublicKey,
      from: input.from,
      to: input.to,
    });
    const clauses = ["m.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [range.from, range.to];
    if (input.packetHash) {
      clauses.push("p.packet_sha256 = ?");
      parameters.push(input.packetHash);
    }
    if (input.logicalPacketId) {
      clauses.push(
        view === "logical"
          ? "lp.logical_packet_id = ?"
          : "EXISTS (SELECT 1 FROM logical_packets lp2 WHERE lp2.id = p.logical_packet_id AND lp2.logical_packet_id = ?)",
      );
      parameters.push(input.logicalPacketId);
    }
    if (input.encrypted !== undefined) {
      clauses.push("m.encrypted = ?");
      parameters.push(input.encrypted ? 1 : 0);
    }
    if (input.signatureValid !== undefined) {
      clauses.push("m.signature_valid = ?");
      parameters.push(input.signatureValid ? 1 : 0);
    }
    if (input.region) {
      clauses.push(
        view === "logical"
          ? "po.region = ?"
          : "EXISTS (SELECT 1 FROM packet_observations po3 WHERE po3.id = m.packet_observation_id AND po3.region = ?)",
      );
      parameters.push(input.region);
    }
    if (input.observerPublicKey) {
      clauses.push(
        view === "logical"
          ? "o.public_key = ?"
          : "EXISTS (SELECT 1 FROM packet_observations po4 JOIN observers o4 ON o4.id = po4.observer_id WHERE po4.id = m.packet_observation_id AND o4.public_key = ?)",
      );
      parameters.push(input.observerPublicKey);
    }
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
    if (view === "logical") {
      let cursorClause = "";
      if (input.cursor) {
        const cursor = decodePublicMcpCursor(input.cursor, context);
        cursorClause =
          "HAVING (max(po.received_at_ms) < ? OR (max(po.received_at_ms) = ? AND lp.id < ?))";
        parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
      }
      const rows = await this.database.all<DatabaseRow>(
        `SELECT lp.id, lp.logical_packet_id AS logical_message_id,
                m.message_type, m.channel, m.channel_index, m.channel_name,
                m.sender_prefix, sender.public_key AS sender_public_key,
                m.destination_prefix,
                destination.public_key AS destination_public_key,
                m.encrypted, m.text, m.decrypted_sender, m.decrypted_flags,
                m.signature, m.signature_valid,
                min(po.received_at_ms) AS matched_first_observed_at_ms,
                max(po.received_at_ms) AS matched_last_observed_at_ms,
                lp.first_observed_at_ms AS first_observed_at_total_ms,
                lp.last_observed_at_ms AS last_observed_at_total_ms,
                count(DISTINCT po.id) AS observation_count,
                count(DISTINCT p.id) AS raw_packet_count,
                (SELECT count(*) FROM packets ptotal
                  WHERE ptotal.logical_packet_id = lp.id) AS raw_packet_count_total,
                (SELECT count(*) FROM packet_observations total
                   JOIN packets ptotal ON ptotal.id = total.packet_id
                  WHERE ptotal.logical_packet_id = lp.id) AS observation_count_total,
                (SELECT packet_sha256 FROM packets p2
                  WHERE p2.logical_packet_id = lp.id
                  ORDER BY p2.first_seen_at_ms, p2.id LIMIT 1) AS packet_sha256
         FROM logical_packets lp
         JOIN packets p ON p.logical_packet_id = lp.id
         JOIN messages m ON m.packet_id = p.id
         JOIN packet_observations po ON po.packet_id = p.id
         JOIN observers o ON o.id = po.observer_id
         LEFT JOIN nodes sender ON sender.id = m.sender_node_id
         LEFT JOIN nodes destination ON destination.id = m.destination_node_id
         WHERE ${clauses.join(" AND ")}
         GROUP BY lp.id ${cursorClause}
         ORDER BY matched_last_observed_at_ms DESC, lp.id DESC LIMIT ?`,
        ...parameters,
        limit + 1,
      );
      return this.page(
        rows,
        limit,
        "matched_last_observed_at_ms",
        context,
        (row) => ({
          logical_message_id: String(row.logical_message_id),
          message_type: String(row.message_type),
          channel: optionalText(row.channel),
          channel_index: optionalNumber(row.channel_index),
          channel_name: optionalText(row.channel_name),
          channel_key: this.channelKeyFor(row.channel),
          sender_prefix: optionalText(row.sender_prefix),
          sender_public_key: optionalText(row.sender_public_key),
          destination_prefix: optionalText(row.destination_prefix),
          destination_public_key: optionalText(row.destination_public_key),
          encrypted: number(row.encrypted) === 1,
          text: number(row.encrypted) === 1 ? null : optionalText(row.text),
          decrypted_sender: optionalText(row.decrypted_sender),
          decrypted_flags: optionalNumber(row.decrypted_flags),
          signature: optionalText(row.signature),
          signature_valid: optionalBoolean(row.signature_valid),
          first_observed_at: iso(row.matched_first_observed_at_ms),
          last_observed_at: iso(row.matched_last_observed_at_ms),
          observation_count: number(row.observation_count),
          raw_packet_count: number(row.raw_packet_count),
          first_observed_at_total: iso(row.first_observed_at_total_ms),
          last_observed_at_total: iso(row.last_observed_at_total_ms),
          observation_count_total: number(row.observation_count_total),
          raw_packet_count_total: number(row.raw_packet_count_total),
          packet_hash: String(row.packet_sha256),
        }),
      );
    }
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      clauses.push(
        "(m.received_at_ms < ? OR (m.received_at_ms = ? AND m.id < ?))",
      );
      parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT m.id, m.message_type, m.channel, m.channel_index, m.channel_name,
              m.sender_prefix, sender.public_key AS sender_public_key,
              m.destination_prefix,
              destination.public_key AS destination_public_key,
              m.encrypted, m.text, m.decrypted_sender, m.decrypted_flags,
              m.signature, m.signature_valid, m.reported_at_ms,
              m.received_at_ms, p.packet_sha256
       FROM messages m JOIN packets p ON p.id = m.packet_id
       LEFT JOIN nodes sender ON sender.id = m.sender_node_id
       LEFT JOIN nodes destination ON destination.id = m.destination_node_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY m.received_at_ms DESC, m.id DESC LIMIT ?`,
      ...parameters,
      limit + 1,
    );
    return this.page(rows, limit, "received_at_ms", context, (row) => ({
      message_id: number(row.id),
      message_type: String(row.message_type),
      channel: optionalText(row.channel),
      channel_index: optionalNumber(row.channel_index),
      channel_name: optionalText(row.channel_name),
      channel_key: this.channelKeyFor(row.channel),
      sender_prefix: optionalText(row.sender_prefix),
      sender_public_key: optionalText(row.sender_public_key),
      destination_prefix: optionalText(row.destination_prefix),
      destination_public_key: optionalText(row.destination_public_key),
      encrypted: number(row.encrypted) === 1,
      text: number(row.encrypted) === 1 ? null : optionalText(row.text),
      decrypted_sender: optionalText(row.decrypted_sender),
      decrypted_flags: optionalNumber(row.decrypted_flags),
      signature: optionalText(row.signature),
      signature_valid: optionalBoolean(row.signature_valid),
      reported_at: optionalIso(row.reported_at_ms),
      received_at: iso(row.received_at_ms),
      packet_hash: String(row.packet_sha256),
    }));
  }

  async getMessage(messageId: number) {
    const message = await this.database.get<DatabaseRow>(
      `SELECT m.id, m.message_type, m.channel, m.channel_index, m.channel_name,
              m.sender_prefix, sender.public_key AS sender_public_key,
              m.destination_prefix,
              destination.public_key AS destination_public_key,
              m.encrypted, m.text, m.decrypted_sender, m.decrypted_flags,
              m.signature, m.signature_valid, m.reported_at_ms,
              m.received_at_ms, p.packet_sha256,
              hex(m.payload_blob) AS payload_hex,
              lp.logical_packet_id AS logical_message_id,
              lp.first_observed_at_ms AS logical_first_observed_at_ms,
              lp.last_observed_at_ms AS logical_last_observed_at_ms,
               (SELECT count(*) FROM packets p2
                 WHERE p2.logical_packet_id = lp.id
                   AND lp.id IS NOT NULL) AS raw_packet_count,
               (SELECT count(*) FROM packet_observations total
                 JOIN packets pp ON pp.id = total.packet_id
                 WHERE pp.logical_packet_id = lp.id
                   AND lp.id IS NOT NULL) AS observation_count
       FROM messages m
       JOIN packets p ON p.id = m.packet_id
       LEFT JOIN logical_packets lp ON lp.id = p.logical_packet_id
       LEFT JOIN nodes sender ON sender.id = m.sender_node_id
       LEFT JOIN nodes destination ON destination.id = m.destination_node_id
       WHERE m.id = ?`,
      messageId,
    );
    if (!message) return null;
    return {
      data: {
        message_id: number(message.id),
        logical_message_id: optionalText(message.logical_message_id),
        message_type: String(message.message_type),
        channel: optionalText(message.channel),
        channel_index: optionalNumber(message.channel_index),
        channel_name: optionalText(message.channel_name),
        channel_key: this.channelKeyFor(message.channel),
        sender_prefix: optionalText(message.sender_prefix),
        sender_public_key: optionalText(message.sender_public_key),
        destination_prefix: optionalText(message.destination_prefix),
        destination_public_key: optionalText(message.destination_public_key),
        encrypted: number(message.encrypted) === 1,
        text:
          number(message.encrypted) === 1 ? null : optionalText(message.text),
        decrypted_sender: optionalText(message.decrypted_sender),
        decrypted_flags: optionalNumber(message.decrypted_flags),
        signature: optionalText(message.signature),
        signature_valid: optionalBoolean(message.signature_valid),
        payload_hex:
          typeof message.payload_hex === "string" && message.payload_hex
            ? message.payload_hex.toUpperCase()
            : null,
        reported_at: optionalIso(message.reported_at_ms),
        received_at: iso(message.received_at_ms),
        packet_hash: String(message.packet_sha256),
        raw_packet_count: number(message.raw_packet_count),
        observation_count: number(message.observation_count),
        first_observed_at: optionalIso(message.logical_first_observed_at_ms),
        last_observed_at: optionalIso(message.logical_last_observed_at_ms),
      },
      meta: this.meta(),
    };
  }

  async getMessagePayloads(messageIds: number[]) {
    const uniqueIds = [...new Set(messageIds)];
    if (uniqueIds.length === 0 || uniqueIds.length > MAX_MESSAGE_PAYLOAD_IDS) {
      throw new PublicQueryInputError(
        "invalid_message_payload_batch",
        `Request between 1 and ${MAX_MESSAGE_PAYLOAD_IDS} unique message ids.`,
      );
    }
    const rows = await this.database.all<DatabaseRow>(
      `SELECT id, encrypted, hex(payload_blob) AS payload_hex
       FROM messages WHERE id IN (${uniqueIds.map(() => "?").join(",")})
       ORDER BY id`,
      ...uniqueIds,
    );
    const byId = new Map(rows.map((row) => [number(row.id), row]));
    return {
      data: {
        payloads: uniqueIds
          .filter((id) => byId.has(id))
          .map((id) => {
            const row = byId.get(id)!;
            const payloadHex = row.payload_hex;
            return {
              message_id: id,
              encrypted: number(row.encrypted) === 1,
              payload_hex:
                typeof payloadHex === "string" && payloadHex
                  ? payloadHex.toUpperCase()
                  : null,
            };
          }),
        missing_message_ids: uniqueIds.filter((id) => !byId.has(id)),
      },
      meta: this.meta(),
    };
  }

  async getActivityTimeseries(input: {
    from: number;
    to: number;
    bucketMs: number;
    observerPublicKey?: string;
    region?: string;
    limit?: number;
    cursor?: string;
  }) {
    const range = this.range(input);
    if (!Number.isFinite(input.bucketMs) || input.bucketMs <= 0) {
      throw new PublicQueryInputError(
        "invalid_time_range",
        "bucket must be a positive millisecond duration.",
      );
    }
    const bucketCount =
      Math.floor((range.to - range.from) / input.bucketMs) + 1;
    if (bucketCount > MAX_ACTIVITY_BUCKETS) {
      throw new PublicQueryInputError(
        "too_many_time_buckets",
        `The requested range produces ${bucketCount} buckets; use a coarser bucket or request at most ${MAX_ACTIVITY_BUCKETS} buckets.`,
      );
    }
    const context = cursorContext("get_activity_timeseries", {
      from: input.from,
      to: input.to,
      bucket_ms: input.bucketMs,
      observer_public_key: input.observerPublicKey,
      region: input.region,
    });
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
                count(DISTINCT p.logical_packet_id) AS logical_packets,
                count(*) AS packet_observations
         FROM packet_observations po
         JOIN packets p ON p.id = po.packet_id
         JOIN observers o ON o.id = po.observer_id
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
           SELECT CAST(min(po.received_at_ms) / ? AS INTEGER) * ? AS bucket_at_ms,
                  'adverts' AS kind
             FROM node_adverts a
             JOIN packets p ON p.id = a.packet_id
             JOIN logical_packets lp ON lp.id = p.logical_packet_id
             JOIN packet_observations po ON po.packet_id = p.id
             JOIN observers o ON o.id = po.observer_id
             WHERE ${observationClauses.join(" AND ")}
             GROUP BY lp.id
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
           SELECT CAST(min(po.received_at_ms) / ? AS INTEGER) * ?, 'messages'
             FROM messages m
             JOIN packets p ON p.id = m.packet_id
             JOIN logical_packets lp ON lp.id = p.logical_packet_id
             JOIN packet_observations po ON po.packet_id = p.id
             JOIN observers o ON o.id = po.observer_id
             WHERE ${observationClauses.join(" AND ")}
             GROUP BY lp.id
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
        logical_packets: 0,
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
      value.logical_packets = number(row.logical_packets);
      value.packet_observations = number(row.packet_observations);
    }
    for (const row of nodes) {
      bucket(row.bucket_at_ms).active_nodes = number(row.active_nodes);
    }
    for (const row of derived) {
      const kind = String(row.kind);
      bucket(row.bucket_at_ms)[kind] = number(row.count);
    }
    const sorted = [...buckets.entries()].sort(
      ([left], [right]) => left - right,
    );
    let startIndex = 0;
    if (input.cursor) {
      const cursor = decodePublicMcpCursor(input.cursor, context);
      startIndex = sorted.findIndex(
        ([timestamp]) => timestamp > cursor.timestamp,
      );
      if (startIndex === -1) startIndex = sorted.length;
    }
    const limit = Math.min(
      input.limit ?? this.config.defaultLimit,
      this.config.maxLimit,
    );
    const selected = sorted.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < sorted.length;
    const last = selected[selected.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ timestamp: last[0], id: 0 }, context)
        : null;
    return {
      data: selected.map(([timestamp, values]) => ({
        timestamp: iso(timestamp),
        ...values,
      })),
      meta: this.meta(nextCursor, hasMore),
    };
  }

  async getPacketTypeSummary(input: TimeRange & { region?: string }) {
    const range = this.range(input, DEFAULT_NETWORK_SUMMARY_WINDOW_MS);
    const regionClause = input.region ? "AND po.region = ?" : "";
    const regionParameters = input.region ? [input.region] : [];
    const rows = await this.database.all<DatabaseRow>(
      `WITH filtered AS (
         SELECT p.id AS packet_id, p.packet_type, p.logical_packet_id,
                po.id AS observation_id, po.rssi, po.snr, po.received_at_ms
         FROM packets p JOIN packet_observations po ON po.packet_id = p.id
         WHERE po.received_at_ms BETWEEN ? AND ? ${regionClause}
       ),
       ranked_rssi AS (
         SELECT packet_type, rssi,
                row_number() OVER (PARTITION BY packet_type ORDER BY rssi) AS rn,
                count(*) OVER (PARTITION BY packet_type) AS cnt
         FROM filtered WHERE rssi IS NOT NULL
       ),
       ranked_snr AS (
         SELECT packet_type, snr,
                row_number() OVER (PARTITION BY packet_type ORDER BY snr) AS rn,
                count(*) OVER (PARTITION BY packet_type) AS cnt
         FROM filtered WHERE snr IS NOT NULL
       ),
       medians AS (
         SELECT f.packet_type,
                (SELECT avg(rssi) FROM ranked_rssi r
                  WHERE r.packet_type = f.packet_type
                    AND r.rn IN ((r.cnt + 1) / 2, (r.cnt + 2) / 2)) AS median_rssi,
                (SELECT avg(snr) FROM ranked_snr r
                  WHERE r.packet_type = f.packet_type
                    AND r.rn IN ((r.cnt + 1) / 2, (r.cnt + 2) / 2)) AS median_snr
         FROM filtered f GROUP BY f.packet_type
       )
       SELECT f.packet_type,
              count(DISTINCT f.logical_packet_id) AS logical_packet_count,
              count(DISTINCT f.packet_id) AS raw_packet_count,
              count(DISTINCT f.observation_id) AS observation_count,
              m.median_rssi, m.median_snr,
              min(f.received_at_ms) AS first_seen_at_ms,
              max(f.received_at_ms) AS last_seen_at_ms
       FROM filtered f JOIN medians m ON m.packet_type = f.packet_type
       GROUP BY f.packet_type, m.median_rssi, m.median_snr
       ORDER BY observation_count DESC, f.packet_type LIMIT 250`,
      range.from,
      range.to,
      ...regionParameters,
    );
    return {
      data: rows.map((row) => ({
        packet_type: optionalText(row.packet_type),
        logical_packet_count: number(row.logical_packet_count),
        raw_packet_count: number(row.raw_packet_count),
        observation_count: number(row.observation_count),
        median_rssi: optionalNumber(row.median_rssi),
        median_snr: optionalNumber(row.avg_snr),
        first_seen_at: iso(row.first_seen_at_ms),
        last_seen_at: iso(row.last_seen_at_ms),
      })),
      meta: this.meta(null, false, rows.length === 250),
    };
  }

  async getObserverSummary(input: TimeRange & { region?: string }) {
    const range = this.range(input, DEFAULT_NETWORK_SUMMARY_WINDOW_MS);
    const regionClause = input.region ? "AND po.region = ?" : "";
    const regionParameters = input.region ? [input.region] : [];
    const rows = await this.database.all<DatabaseRow>(
      `WITH filtered AS (
         SELECT po.id AS observation_id, po.packet_id, po.observer_id,
                po.rssi, po.snr, po.received_at_ms
         FROM packet_observations po
         WHERE po.received_at_ms BETWEEN ? AND ? ${regionClause}
       ),
       ranked_rssi AS (
         SELECT observer_id, rssi,
                row_number() OVER (PARTITION BY observer_id ORDER BY rssi) AS rn,
                count(*) OVER (PARTITION BY observer_id) AS cnt
         FROM filtered WHERE rssi IS NOT NULL
       ),
       ranked_snr AS (
         SELECT observer_id, snr,
                row_number() OVER (PARTITION BY observer_id ORDER BY snr) AS rn,
                count(*) OVER (PARTITION BY observer_id) AS cnt
         FROM filtered WHERE snr IS NOT NULL
       ),
       medians AS (
         SELECT f.observer_id,
                (SELECT avg(rssi) FROM ranked_rssi r
                  WHERE r.observer_id = f.observer_id
                    AND r.rn IN ((r.cnt + 1) / 2, (r.cnt + 2) / 2)) AS median_rssi,
                (SELECT avg(snr) FROM ranked_snr r
                  WHERE r.observer_id = f.observer_id
                    AND r.rn IN ((r.cnt + 1) / 2, (r.cnt + 2) / 2)) AS median_snr
         FROM filtered f GROUP BY f.observer_id
       )
       SELECT o.public_key,
              count(DISTINCT f.observation_id) AS observation_count,
              count(DISTINCT f.packet_id) AS unique_packets,
              count(DISTINCT p2.logical_packet_id) AS logical_packet_count,
              count(DISTINCT s.node_id) AS node_count,
              m.median_rssi, m.median_snr,
              min(f.received_at_ms) AS first_seen_at_ms,
              max(f.received_at_ms) AS last_seen_at_ms
       FROM filtered f
       JOIN observers o ON o.id = f.observer_id
       JOIN packets p2 ON p2.id = f.packet_id
       LEFT JOIN node_sightings s ON s.packet_observation_id = f.observation_id
       JOIN medians m ON m.observer_id = f.observer_id
       GROUP BY o.id, o.public_key, m.median_rssi, m.median_snr
       ORDER BY observation_count DESC, o.public_key LIMIT 250`,
      range.from,
      range.to,
      ...regionParameters,
    );
    return {
      data: rows.map((row) => ({
        observer_public_key: String(row.public_key),
        observation_count: number(row.observation_count),
        unique_packets: number(row.unique_packets),
        logical_packet_count: number(row.logical_packet_count),
        node_count: number(row.node_count),
        median_rssi: optionalNumber(row.median_rssi),
        median_snr: optionalNumber(row.avg_snr),
        first_seen_at: iso(row.first_seen_at_ms),
        last_seen_at: iso(row.last_seen_at_ms),
      })),
      meta: this.meta(null, false, rows.length === 250),
    };
  }

  async getNodeSummary(
    input: TimeRange & {
      region?: string;
      role?: string;
      minObservations?: number;
    },
  ) {
    const range = this.range(input, DEFAULT_NETWORK_SUMMARY_WINDOW_MS);
    const clauses = ["po.received_at_ms BETWEEN ? AND ?"];
    const parameters: unknown[] = [range.from, range.to];
    if (input.region) {
      clauses.push("po.region = ?");
      parameters.push(input.region);
    }
    if (input.role) {
      clauses.push("n.latest_role = ?");
      parameters.push(input.role);
    }
    const minObservations = input.minObservations ?? 1;
    const rows = await this.database.all<DatabaseRow>(
      `WITH filtered AS (
         SELECT po.id AS observation_id, po.packet_id, po.observer_id,
                po.rssi, po.snr, po.received_at_ms, s.node_id
         FROM packet_observations po
         JOIN node_sightings s ON s.packet_observation_id = po.id
         WHERE ${clauses.join(" AND ")}
       ),
       ranked_rssi AS (
         SELECT node_id, rssi,
                row_number() OVER (PARTITION BY node_id ORDER BY rssi) AS rn,
                count(*) OVER (PARTITION BY node_id) AS cnt
         FROM filtered WHERE rssi IS NOT NULL
       ),
       ranked_snr AS (
         SELECT node_id, snr,
                row_number() OVER (PARTITION BY node_id ORDER BY snr) AS rn,
                count(*) OVER (PARTITION BY node_id) AS cnt
         FROM filtered WHERE snr IS NOT NULL
       ),
       medians AS (
         SELECT f.node_id,
                (SELECT avg(rssi) FROM ranked_rssi r
                  WHERE r.node_id = f.node_id
                    AND r.rn IN ((r.cnt + 1) / 2, (r.cnt + 2) / 2)) AS median_rssi,
                (SELECT avg(snr) FROM ranked_snr r
                  WHERE r.node_id = f.node_id
                    AND r.rn IN ((r.cnt + 1) / 2, (r.cnt + 2) / 2)) AS median_snr
         FROM filtered f GROUP BY f.node_id
       )
       SELECT n.public_key, n.latest_name, n.latest_role,
              n.latest_latitude, n.latest_longitude,
              count(DISTINCT f.observation_id) AS observation_count,
              count(DISTINCT f.observer_id) AS observer_count,
              count(DISTINCT p2.logical_packet_id) AS logical_packet_count,
              m.median_rssi, m.median_snr,
              min(f.received_at_ms) AS first_seen_at_ms,
              max(f.received_at_ms) AS last_seen_at_ms
       FROM filtered f
       JOIN nodes n ON n.id = f.node_id
       JOIN packets p2 ON p2.id = f.packet_id
       JOIN medians m ON m.node_id = f.node_id
       GROUP BY n.id, n.public_key, n.latest_name, n.latest_role,
                n.latest_latitude, n.latest_longitude, m.median_rssi, m.median_snr
       HAVING count(DISTINCT f.observation_id) >= ?
       ORDER BY observation_count DESC, n.public_key LIMIT 250`,
      ...parameters,
      minObservations,
    );
    return {
      data: rows.map((row) => ({
        public_key: String(row.public_key),
        name: optionalText(row.latest_name),
        role: optionalText(row.latest_role),
        latitude:
          normalizedPosition(row.latest_latitude, row.latest_longitude)
            ?.latitude ?? null,
        longitude:
          normalizedPosition(row.latest_latitude, row.latest_longitude)
            ?.longitude ?? null,
        observation_count: number(row.observation_count),
        observer_count: number(row.observer_count),
        logical_packet_count: number(row.logical_packet_count),
        median_rssi: optionalNumber(row.median_rssi),
        median_snr: optionalNumber(row.avg_snr),
        first_seen_at: iso(row.first_seen_at_ms),
        last_seen_at: iso(row.last_seen_at_ms),
      })),
      meta: this.meta(null, false, rows.length === 250),
    };
  }

  async getTopology(
    input: TimeRange & {
      region?: string;
      evidenceTypes?: Array<"path" | "trace" | "neighbor">;
    },
  ) {
    const range = this.range(input, DEFAULT_NETWORK_SUMMARY_WINDOW_MS);
    const requested = new Set(
      input.evidenceTypes ?? ["path", "trace", "neighbor"],
    );
    const regionClause = input.region ? "AND region = ?" : "";
    const regionParameters = input.region ? [input.region] : [];
    const edges = new Map<
      string,
      {
        from: string;
        to: string;
        evidence: Set<string>;
        observations: number;
        snrTotal: number;
        snrCount: number;
        firstSeen: number;
        lastSeen: number;
      }
    >();
    const addEdge = (
      from: unknown,
      to: unknown,
      evidence: string,
      observations: number,
      medianSnr: number | null,
      firstSeen: number,
      lastSeen: number,
    ) => {
      const fromKey = optionalText(from);
      const toKey = optionalText(to);
      if (!fromKey || !toKey || fromKey === toKey) return;
      const key = `${fromKey}|${toKey}`;
      const edge = edges.get(key) ?? {
        from: fromKey,
        to: toKey,
        evidence: new Set<string>(),
        observations: 0,
        snrTotal: 0,
        snrCount: 0,
        firstSeen,
        lastSeen,
      };
      edge.evidence.add(evidence);
      edge.observations += observations;
      if (medianSnr !== null) {
        edge.snrTotal += medianSnr;
        edge.snrCount += 1;
      }
      edge.firstSeen = Math.min(edge.firstSeen, firstSeen);
      edge.lastSeen = Math.max(edge.lastSeen, lastSeen);
      edges.set(key, edge);
    };
    const [pathRows, traceRows, neighborRows] = await Promise.all([
      requested.has("path")
        ? this.database.all<DatabaseRow>(
            `WITH hops AS (
               SELECT ph.path_id, ph.hop_index, ph.resolved_node_id,
                      po.received_at_ms, po.region
               FROM packet_path_hops ph
               JOIN packet_paths pp ON pp.id = ph.path_id
               JOIN packet_observations po ON po.id = pp.packet_observation_id
               WHERE ph.resolved_node_id IS NOT NULL
                 AND ph.resolution_status = 'resolved'
                 AND po.received_at_ms BETWEEN ? AND ? ${regionClause}
             )
             SELECT a.public_key AS from_key, b.public_key AS to_key,
                    count(*) AS observations,
                    min(h1.received_at_ms) AS first_seen_at_ms,
                    max(h1.received_at_ms) AS last_seen_at_ms
             FROM hops h1
             JOIN hops h2 ON h2.path_id = h1.path_id
               AND h2.hop_index = h1.hop_index + 1
             JOIN nodes a ON a.id = h1.resolved_node_id
             JOIN nodes b ON b.id = h2.resolved_node_id
             GROUP BY a.public_key, b.public_key
             LIMIT 2_000`,
            range.from,
            range.to,
            ...regionParameters,
          )
        : [],
      requested.has("trace")
        ? this.database.all<DatabaseRow>(
            `WITH hops AS (
               SELECT th.trace_event_id, th.hop_index, th.resolved_node_id,
                      po.received_at_ms, po.region, th.snr
               FROM trace_hops th
               JOIN trace_events tr ON tr.id = th.trace_event_id
               JOIN packet_observations po ON po.id = tr.packet_observation_id
               WHERE th.resolved_node_id IS NOT NULL
                 AND po.received_at_ms BETWEEN ? AND ? ${regionClause}
             )
             SELECT a.public_key AS from_key, b.public_key AS to_key,
                    count(*) AS observations,
                    avg(h1.snr) AS median_snr,
                    min(h1.received_at_ms) AS first_seen_at_ms,
                    max(h1.received_at_ms) AS last_seen_at_ms
             FROM hops h1
             JOIN hops h2 ON h2.trace_event_id = h1.trace_event_id
               AND h2.hop_index = h1.hop_index + 1
             JOIN nodes a ON a.id = h1.resolved_node_id
             JOIN nodes b ON b.id = h2.resolved_node_id
             GROUP BY a.public_key, b.public_key
             LIMIT 2_000`,
            range.from,
            range.to,
            ...regionParameters,
          )
        : [],
      requested.has("neighbor")
        ? this.database.all<DatabaseRow>(
            `SELECT o.public_key AS from_key, ne.neighbor_public_key AS to_key,
                    count(*) AS observations,
                    avg(ne.snr) AS avg_snr,
                    min(ns.received_at_ms) AS first_seen_at_ms,
                    max(ns.received_at_ms) AS last_seen_at_ms
             FROM neighbor_entries ne
             JOIN neighbor_snapshots ns ON ns.id = ne.snapshot_id
             JOIN observers o ON o.id = ns.observer_id
             WHERE ns.received_at_ms BETWEEN ? AND ?
               ${input.region ? "AND ns.region = ?" : ""}
             GROUP BY o.public_key, ne.neighbor_public_key
             LIMIT 2_000`,
            range.from,
            range.to,
            ...regionParameters,
          )
        : [],
    ]);
    for (const row of pathRows) {
      addEdge(
        row.from_key,
        row.to_key,
        "path",
        number(row.observations),
        null,
        number(row.first_seen_at_ms),
        number(row.last_seen_at_ms),
      );
    }
    for (const row of traceRows) {
      addEdge(
        row.from_key,
        row.to_key,
        "trace",
        number(row.observations),
        optionalNumber(row.avg_snr),
        number(row.first_seen_at_ms),
        number(row.last_seen_at_ms),
      );
    }
    for (const row of neighborRows) {
      addEdge(
        row.from_key,
        row.to_key,
        "neighbor",
        number(row.observations),
        optionalNumber(row.avg_snr),
        number(row.first_seen_at_ms),
        number(row.last_seen_at_ms),
      );
    }
    const sorted = [...edges.values()].sort(
      (left, right) =>
        right.observations - left.observations ||
        left.from.localeCompare(right.from) ||
        left.to.localeCompare(right.to),
    );
    const selected = sorted.slice(0, 250);
    return {
      data: {
        evidence_types: [...requested].sort(),
        edges: selected.map((edge) => ({
          from_node: edge.from,
          to_node: edge.to,
          evidence: [...edge.evidence].sort(),
          observation_count: edge.observations,
          avg_snr_db:
            edge.snrCount === 0 ? null : edge.snrTotal / edge.snrCount,
          first_seen_at: iso(edge.firstSeen),
          last_seen_at: iso(edge.lastSeen),
          confidence: Math.min(1, edge.observations / 10),
        })),
      },
      meta: this.meta(null, false, sorted.length > 250),
    };
  }

  async resolveNodePrefixesBatch(prefixes: string[]) {
    const results = await Promise.all(
      prefixes.map(async (prefix) => {
        const resolution = await this.resolveNodePrefix(prefix);
        return { prefix, resolution };
      }),
    );
    return {
      data: {
        resolutions: results.map(({ resolution }) => resolution.data),
      },
      meta: this.meta(),
    };
  }

  async getTracesBatch(traceIds: number[]) {
    const results = await Promise.all(
      traceIds.map(async (traceId) => {
        const trace = await this.getTrace(traceId);
        return { traceId, trace };
      }),
    );
    const found: unknown[] = [];
    const missing: number[] = [];
    for (const { traceId, trace } of results) {
      if (trace && trace.data !== null) found.push(trace.data);
      else missing.push(traceId);
    }
    return {
      data: { traces: found, missing_trace_ids: missing },
      meta: this.meta(),
    };
  }
}
