import { z } from "zod/v4";
import type { McpConfig } from "./config.js";
import {
  publicMcpToolResult,
  type PublicMcpDataPolicy,
} from "./mcp-public-policy.js";

export const SERVER_NAME = "meshcore-mqtt-broker-public";
export const SERVER_VERSION = "1.0.0";
export const PUBLIC_MCP_PROTOCOL_VERSION = "2025-11-25";

export const publicKeySchema = z
  .string()
  .regex(/^[0-9A-Fa-f]{64}$/)
  .describe("64-character MeshCore public key in hexadecimal");
export const packetHashSchema = z
  .string()
  .regex(/^[0-9A-Fa-f]{64}$/)
  .describe("SHA-256 packet hash in hexadecimal");
export const prefixSchema = z
  .string()
  .regex(/^(?:[0-9A-Fa-f]{2}){1,32}$/)
  .describe("One to 32 bytes of a MeshCore public-key prefix");
export const logicalPacketIdSchema = z
  .string()
  .regex(/^lp_[0-9A-Fa-f]{64}$/)
  .describe("Route-independent logical packet identity");
export const timestampSchema = z.iso.datetime({ offset: true });
export const nullableTimestampSchema = timestampSchema.nullable();
export const nullableStringSchema = z.string().nullable();
export const nullableNumberSchema = z.number().nullable();
export const nullableBooleanSchema = z.boolean().nullable();

export const metaSchema = z
  .object({
    generated_at: timestampSchema,
    retention_days: z.number().int().positive(),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();

export const resultStatusSchema = z.enum([
  "ok",
  "not_found",
  "no_data",
  "ambiguous",
  "invalid_request",
  "unresolved",
  "data_quality_error",
]);

export function envelope<T extends z.ZodType>(data: T) {
  return z
    .object({
      data,
      meta: metaSchema,
      status: resultStatusSchema.optional(),
      reason: z.string().min(1).max(200).optional(),
    })
    .strict();
}

export function page<T extends z.ZodType>(item: T) {
  return envelope(z.array(item));
}

export function pageInput(config: McpConfig) {
  return {
    limit: z.number().int().min(1).max(config.maxLimit).optional(),
    cursor: z.string().min(1).max(512).optional(),
  };
}

export const timeInput = {
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
};

export const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function upper(value: string | undefined): string | undefined {
  return value?.toUpperCase();
}

export function parseRange(
  from: string | undefined,
  to: string | undefined,
): { from: number | undefined; to: number | undefined } {
  return {
    from: from === undefined ? undefined : Date.parse(from),
    to: to === undefined ? undefined : Date.parse(to),
  };
}

export function toolResult(
  policy: PublicMcpDataPolicy,
  toolName: string,
  value: Promise<{ data: unknown; meta: unknown }>,
) {
  return publicMcpToolResult(policy, toolName, value);
}

export const radioSchema = z
  .object({
    frequency_mhz: nullableNumberSchema,
    bandwidth_khz: nullableNumberSchema,
    spreading_factor: nullableNumberSchema,
    coding_rate: nullableNumberSchema,
    tx_power_dbm: nullableNumberSchema,
  })
  .strict();

export const metricSchema = z
  .object({
    metric_name: z.string(),
    numeric_value: nullableNumberSchema,
    text_value: nullableStringSchema,
    boolean_value: nullableBooleanSchema,
    unit: nullableStringSchema,
  })
  .strict();

export const neighborEntrySchema = z
  .object({
    public_key: publicKeySchema,
    snr: nullableNumberSchema,
    rssi: nullableNumberSchema,
    heard_secs_ago: nullableNumberSchema,
    calculated_last_heard_at: nullableTimestampSchema,
    status: z.string(),
    scopes: z.array(z.string()),
  })
  .strict();

export const neighborSnapshotSchema = z
  .object({
    snapshot_timestamp: timestampSchema,
    reported_timestamp: nullableTimestampSchema,
    mqtt_retained: z.boolean(),
    observer_scopes: z.array(z.string()),
    neighbors: z.array(neighborEntrySchema),
  })
  .strict();

export const advertSchema = z
  .object({
    logical_advert_id: logicalPacketIdSchema,
    raw_packet_count: z.number().int().nonnegative(),
    route_count: z.number().int().nonnegative(),
    raw_packet_hashes: z.array(packetHashSchema),
    advert_timestamp_raw: nullableTimestampSchema,
    first_observed_at: timestampSchema,
    last_observed_at: timestampSchema,
    observation_count: z.number().int().positive().optional(),
    first_observed_at_total: timestampSchema.optional(),
    last_observed_at_total: timestampSchema.optional(),
    observation_count_total: z.number().int().positive().optional(),
    public_key: publicKeySchema,
    name: nullableStringSchema,
    role: nullableStringSchema,
    latitude: nullableNumberSchema,
    longitude: nullableNumberSchema,
    position_quality: z.enum(["zero_zero_sentinel"]).nullable(),
    flags: nullableNumberSchema,
    capabilities: z
      .object({
        has_location: nullableBooleanSchema,
        has_name: nullableBooleanSchema,
      })
      .strict(),
    verified: z.boolean(),
    signature_valid: nullableBooleanSchema,
    packet_hash: packetHashSchema,
  })
  .strict();

export const observerDetailSchema = z
  .object({
    public_key: publicKeySchema,
    first_seen_at: timestampSchema,
    last_seen_at: timestampSchema,
    regions: z.array(z.string()),
    latest_status: z
      .object({
        region: z.string(),
        reported_at: nullableTimestampSchema,
        received_at: timestampSchema,
        origin: nullableStringSchema,
        model: nullableStringSchema,
        firmware_version: nullableStringSchema,
      })
      .strict()
      .nullable(),
    model: nullableStringSchema,
    firmware: nullableStringSchema,
    radio_configuration: radioSchema
      .extend({ received_at: timestampSchema })
      .strict()
      .nullable(),
    public_status_metrics: z.array(metricSchema),
    packet_observation_count: z.number().int().nonnegative(),
    latest_neighbor_snapshot: neighborSnapshotSchema.nullable(),
  })
  .strict();

export const nodeDetailSchema = z
  .object({
    public_key: publicKeySchema,
    name: nullableStringSchema,
    role: nullableStringSchema,
    first_seen_at: timestampSchema,
    last_seen_at: timestampSchema,
    latest_position: z
      .object({ latitude: z.number(), longitude: z.number() })
      .strict()
      .nullable(),
    latest_advert: advertSchema.strict().nullable(),
    regions_seen: z.array(
      z.object({ region: z.string(), last_seen_at: timestampSchema }).strict(),
    ),
    observer_count: z.number().int().nonnegative(),
    sighting_count: z.number().int().nonnegative(),
    recent_telemetry_summary: z.array(
      metricSchema
        .extend({
          timestamp: timestampSchema,
          channel: nullableNumberSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const packetDetailSchema = z
  .object({
    packet_hash: packetHashSchema,
    logical_packet_id: logicalPacketIdSchema.nullable(),
    raw_packet_count: z.number().int().nonnegative(),
    packet_length: z.number().int().nonnegative(),
    packet_type: nullableStringSchema,
    packet_type_code: nullableNumberSchema,
    payload_type: nullableStringSchema,
    payload_type_code: nullableNumberSchema,
    route_type: nullableStringSchema,
    decode_status: z.string(),
    decoder_name: nullableStringSchema,
    decoder_version: nullableStringSchema,
    decoded_data: z.json(),
    raw_packet_hex: z.string().regex(/^(?:[0-9A-F]{2})+$/),
    first_seen_at: timestampSchema,
    last_seen_at: timestampSchema,
    observation_count: z.number().int().nonnegative(),
    paths: z.array(
      z
        .object({
          observation_id: z.number().int().positive(),
          raw_path: z.string().regex(/^(?:[0-9A-F]{2})*$/),
          hop_count: z.number().int().nonnegative(),
          received_at: timestampSchema,
        })
        .strict(),
    ),
  })
  .strict();
