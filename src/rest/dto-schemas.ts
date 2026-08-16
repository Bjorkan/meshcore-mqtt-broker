import { z } from "zod/v4";
import {
  advertSchema,
  logicalPacketIdSchema,
  metricSchema,
  nullableBooleanSchema,
  nullableNumberSchema,
  nullableStringSchema,
  nullableTimestampSchema,
  packetHashSchema,
  prefixSchema,
  publicKeySchema,
  radioSchema,
  timestampSchema,
} from "../mcp-tool-common.js";

export const observerRowSchema = z
  .object({
    public_key: publicKeySchema,
    latest_region: nullableStringSchema,
    first_seen_at: timestampSchema,
    last_seen_at: timestampSchema,
    latest_model: nullableStringSchema,
    latest_firmware: nullableStringSchema,
    latest_radio_config: radioSchema.nullable(),
    latest_status_at: nullableTimestampSchema,
    packet_observation_count: z.number().int().nonnegative(),
    has_neighbor_data: z.boolean(),
    latest_neighbor_snapshot_at: nullableTimestampSchema,
    neighbor_count_latest: nullableNumberSchema,
  })
  .strict();

export const statusHistoryRowSchema = z
  .object({
    region: z.string(),
    reported_at: nullableTimestampSchema,
    received_at: timestampSchema,
    origin: nullableStringSchema,
    model: nullableStringSchema,
    firmware_version: nullableStringSchema,
    radio_configuration: radioSchema,
    metrics: z.array(metricSchema),
  })
  .strict();

export const nodeRowSchema = z
  .object({
    public_key: publicKeySchema,
    name: nullableStringSchema,
    role: nullableStringSchema,
    first_seen_at: timestampSchema,
    last_seen_at: timestampSchema,
    latitude: nullableNumberSchema,
    longitude: nullableNumberSchema,
    latest_advert_at: nullableTimestampSchema,
    sighting_count: z.number().int().nonnegative(),
  })
  .strict();

export const sightingRowSchema = z
  .object({
    node_public_key: publicKeySchema,
    observer_public_key: publicKeySchema,
    region: z.string(),
    timestamp: timestampSchema,
    sighting_type: z.string(),
    packet_hash: packetHashSchema,
  })
  .strict();

export const positionHistoryRowSchema = z
  .object({
    logical_advert_id: logicalPacketIdSchema,
    latitude: nullableNumberSchema,
    longitude: nullableNumberSchema,
    name: nullableStringSchema,
    role: nullableStringSchema,
    first_observed_at: timestampSchema,
    last_observed_at: timestampSchema,
    observation_count: z.number().int().nonnegative(),
    first_observed_at_total: timestampSchema,
    last_observed_at_total: timestampSchema,
  })
  .strict();

export const logicalPacketItemSchema = z
  .object({
    logical_packet_id: logicalPacketIdSchema,
    packet_type: nullableStringSchema,
    payload_type: nullableStringSchema,
    first_observed_at: timestampSchema,
    last_observed_at: timestampSchema,
    observation_count: z.number().int().nonnegative(),
    raw_packet_count: z.number().int().nonnegative(),
    first_observed_at_total: timestampSchema,
    last_observed_at_total: timestampSchema,
    observation_count_total: z.number().int().nonnegative(),
    raw_packet_count_total: z.number().int().nonnegative(),
    min_rssi: nullableNumberSchema,
    max_rssi: nullableNumberSchema,
    min_snr: nullableNumberSchema,
    max_snr: nullableNumberSchema,
    hop_count: z.number().int().nonnegative(),
  })
  .strict();

export const rawPacketItemSchema = z
  .object({
    packet_hash: packetHashSchema,
    packet_length: z.number().int().nonnegative(),
    packet_type: nullableStringSchema,
    payload_type: nullableStringSchema,
    route_type: nullableStringSchema,
    decode_status: z.string(),
    first_seen_at: timestampSchema,
    last_seen_at: timestampSchema,
    observation_count: z.number().int().nonnegative(),
    first_seen_at_total: timestampSchema,
    last_seen_at_total: timestampSchema,
    observation_count_total: z.number().int().nonnegative(),
    min_rssi: nullableNumberSchema,
    max_rssi: nullableNumberSchema,
    min_snr: nullableNumberSchema,
    max_snr: nullableNumberSchema,
    hop_count: z.number().int().nonnegative(),
  })
  .strict();

export const observationItemSchema = z
  .object({
    observation_id: z.number().int().positive(),
    observer_public_key: publicKeySchema,
    region: z.string(),
    received_at: timestampSchema,
    reported_at: nullableTimestampSchema,
    rssi: nullableNumberSchema,
    snr: nullableNumberSchema,
    score: nullableNumberSchema,
    direction: nullableStringSchema,
    path: z
      .object({
        raw_path: z.string().regex(/^(?:[0-9A-F]{2})*$/),
        hop_count: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const regionEntrySchema = z
  .object({
    code: z.string().regex(/^[A-Z]{3}$/),
    name: nullableStringSchema,
    code_system: z.literal("IATA"),
    type: z.literal("region"),
    is_primary: z.boolean().nullable(),
    is_allowed: z.boolean(),
    primary_region: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
  })
  .strict();

export const messageLogicalItemSchema = z
  .object({
    logical_message_id: logicalPacketIdSchema,
    message_type: z.string(),
    channel: nullableStringSchema,
    channel_index: nullableNumberSchema,
    channel_name: nullableStringSchema,
    channel_key: nullableStringSchema,
    sender_prefix: nullableStringSchema,
    sender_public_key: publicKeySchema.nullable(),
    destination_prefix: nullableStringSchema,
    destination_public_key: publicKeySchema.nullable(),
    encrypted: z.boolean(),
    text: nullableStringSchema,
    decrypted_sender: nullableStringSchema,
    decrypted_flags: nullableNumberSchema,
    signature: nullableStringSchema,
    signature_valid: nullableBooleanSchema,
    first_observed_at: timestampSchema,
    last_observed_at: timestampSchema,
    observation_count: z.number().int().nonnegative(),
    raw_packet_count: z.number().int().nonnegative(),
    first_observed_at_total: timestampSchema,
    last_observed_at_total: timestampSchema,
    observation_count_total: z.number().int().nonnegative(),
    raw_packet_count_total: z.number().int().nonnegative(),
    packet_hash: packetHashSchema,
    raw_packet_hashes: z.array(packetHashSchema),
  })
  .strict();

export const messageRawItemSchema = z
  .object({
    message_id: z.number().int().positive(),
    message_type: z.string(),
    channel: nullableStringSchema,
    channel_index: nullableNumberSchema,
    channel_name: nullableStringSchema,
    channel_key: nullableStringSchema,
    sender_prefix: nullableStringSchema,
    sender_public_key: publicKeySchema.nullable(),
    destination_prefix: nullableStringSchema,
    destination_public_key: publicKeySchema.nullable(),
    encrypted: z.boolean(),
    text: nullableStringSchema,
    decrypted_sender: nullableStringSchema,
    decrypted_flags: nullableNumberSchema,
    signature: nullableStringSchema,
    signature_valid: nullableBooleanSchema,
    reported_at: nullableTimestampSchema,
    received_at: timestampSchema,
    packet_hash: packetHashSchema,
    observation_count: z.number().int().nonnegative(),
  })
  .strict();

export const messagePayloadBatchDataSchema = z
  .object({
    payloads: z.array(
      z
        .object({
          message_id: z.number().int().positive(),
          encrypted: z.boolean(),
          payload_hex: nullableStringSchema,
        })
        .strict(),
    ),
    missing_message_ids: z.array(z.number().int().positive()),
  })
  .strict();

export const telemetryRowSchema = metricSchema
  .extend({
    timestamp: timestampSchema,
    reported_at: nullableTimestampSchema,
    node_public_key: publicKeySchema,
    observer_public_key: publicKeySchema,
    region: z.string(),
    channel: nullableNumberSchema,
    packet_hash: packetHashSchema,
  })
  .strict();

export const nodeTelemetryRowSchema = metricSchema
  .extend({
    timestamp: timestampSchema,
    reported_at: nullableTimestampSchema,
    channel: nullableNumberSchema,
    packet_hash: packetHashSchema,
  })
  .strict();

export const signalBucketSchema = z
  .object({
    timestamp: timestampSchema,
    rssi: nullableNumberSchema,
    snr: nullableNumberSchema,
    score: nullableNumberSchema,
    packet_count: z.number().int().nonnegative(),
  })
  .strict();

export const neighborRowSchema = z
  .object({
    observer_public_key: publicKeySchema,
    neighbor_public_key: publicKeySchema,
    region: z.string(),
    snapshot_timestamp: timestampSchema,
    reported_timestamp: nullableTimestampSchema,
    mqtt_retained: z.boolean(),
    snr: nullableNumberSchema,
    rssi: nullableNumberSchema,
    heard_secs_ago: nullableNumberSchema,
    calculated_last_heard_at: nullableTimestampSchema,
    status: z.string(),
    scopes: z.array(z.string()),
  })
  .strict();

export const traceSummarySchema = z
  .object({
    trace_id: z.number().int().positive(),
    packet_hash: packetHashSchema,
    observer_public_key: publicKeySchema,
    source_public_key: publicKeySchema.nullable(),
    tag: nullableStringSchema,
    reported_at: nullableTimestampSchema,
    received_at: timestampSchema,
    hop_count: z.number().int().nonnegative(),
  })
  .strict();

export const prefixCandidateSchema = z
  .object({
    public_key: publicKeySchema,
    name: nullableStringSchema,
    role: nullableStringSchema,
    latitude: nullableNumberSchema,
    longitude: nullableNumberSchema,
    confidence: z.number(),
    evidence_count: z.number().int().nonnegative(),
  })
  .strict();

export const prefixResolutionDataSchema = z
  .object({
    prefix_hex: prefixSchema,
    prefix_length_bytes: z.number().int().min(1).max(32),
    candidates: z.array(prefixCandidateSchema),
    resolution_status: z.enum(["resolved", "ambiguous", "unresolved"]),
    ambiguous: z.boolean(),
  })
  .strict();

export const traceDetailDataSchema = z
  .object({
    trace_id: z.number().int().positive(),
    packet_hash: packetHashSchema,
    observer_public_key: publicKeySchema,
    source_public_key: publicKeySchema.nullable(),
    tag: nullableStringSchema,
    reported_at: nullableTimestampSchema,
    received_at: timestampSchema,
    hops: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          prefix: z.string(),
          prefix_length_bytes: z.number().int().min(1).max(3),
          snr: nullableNumberSchema,
          resolved_public_key: publicKeySchema.nullable(),
          resolution_status: z.string(),
          confidence: nullableNumberSchema,
          candidates: z.array(prefixCandidateSchema),
        })
        .strict(),
    ),
  })
  .strict();

export const activityBucketSchema = z
  .object({
    timestamp: timestampSchema,
    unique_packets: z.number().int().nonnegative(),
    logical_packets: z.number().int().nonnegative(),
    packet_observations: z.number().int().nonnegative(),
    active_observers: z.number().int().nonnegative(),
    active_nodes: z.number().int().nonnegative(),
    adverts: z.number().int().nonnegative(),
    traces: z.number().int().nonnegative(),
    telemetry: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
  })
  .strict();

export const packetTypeSummaryRowSchema = z
  .object({
    packet_type: nullableStringSchema,
    logical_packet_count: z.number().int().nonnegative(),
    raw_packet_count: z.number().int().nonnegative(),
    observation_count: z.number().int().nonnegative(),
    median_rssi: nullableNumberSchema,
    median_snr: nullableNumberSchema,
    first_seen_at: timestampSchema,
    last_seen_at: timestampSchema,
  })
  .strict();

export const observerSummaryRowSchema = z
  .object({
    observer_public_key: publicKeySchema,
    observation_count: z.number().int().nonnegative(),
    unique_packets: z.number().int().nonnegative(),
    logical_packet_count: z.number().int().nonnegative(),
    node_count: z.number().int().nonnegative(),
    median_rssi: nullableNumberSchema,
    median_snr: nullableNumberSchema,
    first_seen_at: timestampSchema,
    last_seen_at: timestampSchema,
  })
  .strict();

export const nodeSummaryRowSchema = z
  .object({
    public_key: publicKeySchema,
    name: nullableStringSchema,
    role: nullableStringSchema,
    latitude: nullableNumberSchema,
    longitude: nullableNumberSchema,
    observation_count: z.number().int().nonnegative(),
    observer_count: z.number().int().nonnegative(),
    logical_packet_count: z.number().int().nonnegative(),
    median_rssi: nullableNumberSchema,
    median_snr: nullableNumberSchema,
    first_seen_at: timestampSchema,
    last_seen_at: timestampSchema,
  })
  .strict();

export const nodeSignalSummaryRowSchema = z
  .object({
    observer_public_key: publicKeySchema,
    packet_count: z.number().int().nonnegative(),
    median_rssi: nullableNumberSchema,
    median_snr: nullableNumberSchema,
    first_seen_at: timestampSchema,
    last_seen_at: timestampSchema,
  })
  .strict();

export const topologyDataSchema = z
  .object({
    evidence_types: z.array(z.string()),
    edges: z.array(
      z
        .object({
          from_node: publicKeySchema,
          to_node: publicKeySchema,
          evidence: z.array(z.string()),
          observation_count: z.number().int().nonnegative(),
          avg_snr_db: nullableNumberSchema,
          first_seen_at: timestampSchema,
          last_seen_at: timestampSchema,
          confidence: z.number().min(0).max(1),
        })
        .strict(),
    ),
  })
  .strict();

export const dataQualityDataSchema = z
  .object({
    window_from: timestampSchema,
    window_to: timestampSchema,
    invalid_signatures: z.number().int().nonnegative(),
    decoder_errors: z.number().int().nonnegative(),
    unknown_packet_types: z.number().int().nonnegative(),
    implausible_embedded_timestamps: z.number().int().nonnegative(),
    future_timestamps: z.number().int().nonnegative(),
    zero_zero_positions: z.number().int().nonnegative(),
    missing_rssi_snr: z.number().int().nonnegative(),
    unresolved_path_prefixes: z.number().int().nonnegative(),
    ambiguous_path_prefixes: z.number().int().nonnegative(),
    logical_packets_with_multiple_routes: z.number().int().nonnegative(),
    processing_errors: z.number().int().nonnegative(),
  })
  .strict();

const pathResolutionStatusSchema = z.enum([
  "resolved",
  "ambiguous",
  "unresolved",
]);

export const pathObservationItemSchema = z
  .object({
    logical_packet_id: logicalPacketIdSchema.nullable(),
    packet_hash: packetHashSchema,
    observation_id: z.number().int().positive(),
    received_at: timestampSchema,
    reported_at: nullableTimestampSchema,
    observer_public_key: publicKeySchema,
    region: z.string(),
    rssi: nullableNumberSchema,
    snr: nullableNumberSchema,
    score: nullableNumberSchema,
    direction: nullableStringSchema,
    raw_path: z.string().regex(/^(?:[0-9A-F]{2})*$/),
    hop_count: z.number().int().nonnegative(),
    hops: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          prefix: z.string().regex(/^(?:[0-9A-F]{2}){1,3}$/),
          prefix_length_bytes: z.number().int().min(1).max(3),
          resolved_public_key: publicKeySchema.nullable(),
          resolution_status: pathResolutionStatusSchema,
          confidence: nullableNumberSchema,
          candidates: z.array(prefixCandidateSchema),
        })
        .strict(),
    ),
  })
  .strict();

export const pathPrefixItemSchema = z
  .object({
    prefix_hex: z.string().regex(/^(?:[0-9A-F]{2}){1,3}$/),
    prefix_length_bytes: z.number().int().min(1).max(3),
    resolution_status: pathResolutionStatusSchema,
    resolved_public_key: publicKeySchema.nullable(),
    occurrence_count: z.number().int().nonnegative(),
    logical_packet_count: z.number().int().nonnegative(),
    raw_packet_count: z.number().int().nonnegative(),
    observer_count: z.number().int().nonnegative(),
    first_seen_at: timestampSchema,
    last_seen_at: timestampSchema,
  })
  .strict();

export const eventItemSchema = z
  .object({
    timestamp: timestampSchema,
    event_type: z.enum([
      "packet",
      "advert",
      "message",
      "trace",
      "telemetry",
      "observer_status",
    ]),
    event_id: z.number().int().positive(),
    region: nullableStringSchema,
    node_public_key: publicKeySchema.nullable(),
    observer_public_key: publicKeySchema.nullable(),
    packet_hash: packetHashSchema.nullable(),
    logical_packet_id: logicalPacketIdSchema.nullable(),
    rssi: nullableNumberSchema,
    snr: nullableNumberSchema,
    reported_at: nullableTimestampSchema,
    payload: z.json(),
  })
  .strict();

export const processingErrorRowSchema = z
  .object({
    error_id: z.number().int().positive(),
    stage: z.string(),
    error_code: z.string(),
    error_message: z.string(),
    processor_name: nullableStringSchema,
    processor_version: nullableStringSchema,
    received_at: timestampSchema,
    packet_hash: nullableStringSchema,
    observer_public_key: nullableStringSchema,
    region: nullableStringSchema,
  })
  .strict();

export { advertSchema };
