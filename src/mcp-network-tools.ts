import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { McpConfig } from "./config.js";
import type { PublicMcpQueryService } from "./mcp-public-query.js";
import type { PublicMcpDataPolicy } from "./mcp-public-policy.js";
import {
  annotations,
  envelope,
  logicalPacketIdSchema,
  metricSchema,
  neighborEntrySchema,
  nullableBooleanSchema,
  nullableNumberSchema,
  nullableStringSchema,
  nullableTimestampSchema,
  page,
  pageInput,
  packetHashSchema,
  parseRange,
  publicKeySchema,
  timestampSchema,
  timeInput,
  toolResult,
  upper,
} from "./mcp-tool-common.js";
import { PublicQueryInputError } from "./public-query-errors.js";
import {
  registerPublicTool,
  type PublicToolRegistry,
} from "./public-tool-registry.js";

const bucket = z.enum(["minute", "hour", "day"]);
const bucketMilliseconds = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;

const traceSummary = z
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

const prefixCandidate = z
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

const resolutionStatus = z.enum(["resolved", "ambiguous", "unresolved"]);
const regionSchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/)
  .optional();
const sortOrder = z.enum(["asc", "desc"]).optional();

const pathHop = z
  .object({
    index: z.number().int().nonnegative(),
    prefix: z.string().regex(/^(?:[0-9A-F]{2}){1,3}$/),
    prefix_length_bytes: z.number().int().min(1).max(3),
    resolved_public_key: publicKeySchema.nullable(),
    resolution_status: resolutionStatus,
    confidence: nullableNumberSchema,
    candidates: z.array(prefixCandidate),
  })
  .strict();

const pathObservationItem = z
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
    raw_path: z
      .string()
      .regex(/^(?:[0-9A-F]{2})*$/)
      .nullable(),
    hop_count: z.number().int().nonnegative().nullable(),
    hops: z.array(pathHop),
  })
  .strict();

const pathPrefixItem = z
  .object({
    prefix_hex: z.string().regex(/^(?:[0-9A-F]{2}){1,3}$/),
    prefix_length_bytes: z.number().int().min(1).max(3),
    resolution_status: resolutionStatus,
    resolved_public_key: publicKeySchema.nullable(),
    occurrence_count: z.number().int().nonnegative(),
    logical_packet_count: z.number().int().nonnegative(),
    raw_packet_count: z.number().int().nonnegative(),
    observer_count: z.number().int().nonnegative(),
    first_seen_at: timestampSchema,
    last_seen_at: timestampSchema,
  })
  .strict();

const eventType = z.enum([
  "packet",
  "advert",
  "message",
  "trace",
  "telemetry",
  "observer_status",
]);

const eventItem = z
  .object({
    timestamp: timestampSchema,
    event_type: eventType,
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

export function registerPublicMcpNetworkTools(
  server: McpServer,
  query: PublicMcpQueryService,
  config: McpConfig,
  policy: PublicMcpDataPolicy,
  registry?: PublicToolRegistry,
): void {
  registerPublicTool(
    server,
    registry,
    "get_neighbors",
    {
      title: "Get a public neighbor snapshot",
      description:
        "Return the latest or at-time normalized /neighbors snapshot for one observer.",
      inputSchema: z
        .object({
          observer_public_key: publicKeySchema,
          at: timestampSchema.optional(),
          latest: z.boolean().default(true),
        })
        .strict(),
      outputSchema: envelope(
        z
          .object({
            observer_public_key: publicKeySchema,
            snapshot_timestamp: timestampSchema,
            reported_timestamp: nullableTimestampSchema,
            mqtt_retained: z.boolean(),
            observer_scopes: z.array(z.string()),
            neighbors: z.array(neighborEntrySchema),
          })
          .strict()
          .nullable(),
      ),
      annotations,
    },
    async ({ observer_public_key, at, latest }) =>
      toolResult(
        policy,
        "get_neighbors",
        (async () => {
          if (!latest && at === undefined) {
            throw new PublicQueryInputError(
              "invalid_arguments",
              "at is required when latest is false",
            );
          }
          return query.getNeighbors({
            observerPublicKey: observer_public_key.toUpperCase(),
            at: at === undefined ? undefined : Date.parse(at),
          });
        })(),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_neighbor_history",
    {
      title: "Get public neighbor history",
      description:
        "Analyze one observer's neighbor relationships over time with bounded cursor pagination.",
      inputSchema: z
        .object({
          observer_public_key: publicKeySchema,
          neighbor_public_key: publicKeySchema.optional(),
          ...timeInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        neighborEntrySchema
          .omit({ public_key: true })
          .extend({
            observer_public_key: publicKeySchema,
            neighbor_public_key: publicKeySchema,
            snapshot_timestamp: timestampSchema,
            reported_timestamp: nullableTimestampSchema,
            mqtt_retained: z.boolean(),
          })
          .strict(),
      ),
      annotations,
    },
    async ({
      observer_public_key,
      neighbor_public_key,
      from,
      to,
      limit,
      cursor,
    }) =>
      toolResult(
        policy,
        "get_neighbor_history",
        query.getNeighborHistory({
          observerPublicKey: observer_public_key.toUpperCase(),
          neighborPublicKey: upper(neighbor_public_key),
          ...parseRange(from, to),
          limit,
          cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_signal_history",
    {
      title: "Get public RF signal history",
      description:
        "Aggregate RSSI, SNR, score, and packet counts into bounded time buckets.",
      inputSchema: z
        .object({
          observer_public_key: publicKeySchema,
          node_public_key: publicKeySchema.optional(),
          packet_type: z.string().min(1).max(64).optional(),
          from: timestampSchema,
          to: timestampSchema,
          bucket: bucket.default("hour"),
          limit: z.number().int().min(1).max(config.maxLimit).optional(),
          cursor: z.string().min(1).max(512).optional(),
        })
        .strict(),
      outputSchema: page(
        z
          .object({
            timestamp: timestampSchema,
            rssi: nullableNumberSchema,
            snr: nullableNumberSchema,
            score: nullableNumberSchema,
            packet_count: z.number().int().nonnegative(),
          })
          .strict(),
      ),
      annotations,
    },
    async ({
      observer_public_key,
      node_public_key,
      packet_type,
      from,
      to,
      bucket: selectedBucket,
      limit,
      cursor,
    }) => {
      const range = parseRange(from, to);
      return toolResult(
        policy,
        "get_signal_history",
        query.getSignalHistory({
          observerPublicKey: observer_public_key.toUpperCase(),
          nodePublicKey: upper(node_public_key),
          packetType: upper(packet_type),
          from: range.from as number,
          to: range.to as number,
          bucketMs: bucketMilliseconds[selectedBucket],
          limit,
          cursor,
        }),
      );
    },
  );

  registerPublicTool(
    server,
    registry,
    "search_traces",
    {
      title: "Search public MeshCore TRACE events",
      description:
        "Search normalized TRACE events and public path metadata with bounded pagination.",
      inputSchema: z
        .object({
          source_node_public_key: publicKeySchema.optional(),
          observer_public_key: publicKeySchema.optional(),
          tag: z.string().min(1).max(100).optional(),
          ...timeInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(traceSummary),
      annotations,
    },
    async ({
      source_node_public_key,
      observer_public_key,
      tag,
      from,
      to,
      limit,
      cursor,
    }) =>
      toolResult(
        policy,
        "search_traces",
        query.searchTraces({
          sourceNodePublicKey: upper(source_node_public_key),
          observerPublicKey: upper(observer_public_key),
          tag,
          ...parseRange(from, to),
          limit,
          cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_trace",
    {
      title: "Get a public MeshCore TRACE event",
      description:
        "Return one TRACE event with prefixes, hop SNR, and resolved public keys.",
      inputSchema: z.object({ trace_id: z.number().int().positive() }).strict(),
      outputSchema: envelope(
        traceSummary
          .omit({ hop_count: true })
          .extend({
            hops: z.array(
              z
                .object({
                  index: z.number().int().nonnegative(),
                  prefix: z.string().regex(/^(?:[0-9A-F]{2}){1,3}$/),
                  prefix_length_bytes: z.number().int().min(1).max(3),
                  snr: nullableNumberSchema,
                  resolved_public_key: publicKeySchema.nullable(),
                  resolution_status: z.string(),
                  confidence: nullableNumberSchema,
                  candidates: z.array(prefixCandidate),
                })
                .strict(),
            ),
          })
          .strict()
          .nullable(),
      ),
      annotations,
    },
    async ({ trace_id }) =>
      toolResult(policy, "get_trace", query.getTrace(trace_id)),
  );

  registerPublicTool(
    server,
    registry,
    "get_telemetry",
    {
      title: "Get public MeshCore telemetry",
      description:
        "Return normalized telemetry values for a known node with bounded pagination.",
      inputSchema: z
        .object({
          node_public_key: publicKeySchema,
          metric: z.string().min(1).max(200).optional(),
          ...timeInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        metricSchema
          .extend({
            timestamp: timestampSchema,
            reported_at: nullableTimestampSchema,
            channel: nullableNumberSchema,
            packet_hash: packetHashSchema,
          })
          .strict(),
      ),
      annotations,
    },
    async ({ node_public_key, metric, from, to, limit, cursor }) =>
      toolResult(
        policy,
        "get_telemetry",
        query.getTelemetry({
          nodePublicKey: node_public_key.toUpperCase(),
          metric,
          ...parseRange(from, to),
          limit,
          cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "search_telemetry",
    {
      title: "Search public MeshCore telemetry globally",
      description:
        "Search telemetry values across nodes with node, metric, and observation-region filters.",
      inputSchema: z
        .object({
          node_public_key: publicKeySchema.optional(),
          metric: z.string().min(1).max(200).optional(),
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          ...timeInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        metricSchema
          .extend({
            timestamp: timestampSchema,
            reported_at: nullableTimestampSchema,
            node_public_key: publicKeySchema,
            observer_public_key: publicKeySchema,
            region: z.string(),
            channel: nullableNumberSchema,
            packet_hash: packetHashSchema,
          })
          .strict(),
      ),
      annotations,
    },
    async ({ node_public_key, metric, region, from, to, limit, cursor }) =>
      toolResult(
        policy,
        "search_telemetry",
        query.searchTelemetry({
          nodePublicKey: upper(node_public_key),
          metric,
          region: upper(region),
          ...parseRange(from, to),
          limit,
          cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_node_signal_summary",
    {
      title: "Get per-observer signal summary for a node",
      description:
        "Rank observers that heard a node by packet count with median RSSI and SNR.",
      inputSchema: z
        .object({
          node_public_key: publicKeySchema,
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          ...timeInput,
        })
        .strict(),
      outputSchema: envelope(
        z.array(
          z
            .object({
              observer_public_key: publicKeySchema,
              packet_count: z.number().int().nonnegative(),
              median_rssi: nullableNumberSchema,
              median_snr: nullableNumberSchema,
              first_seen_at: timestampSchema,
              last_seen_at: timestampSchema,
            })
            .strict(),
        ),
      ),
      annotations,
    },
    async ({ node_public_key, region, from, to }) =>
      toolResult(
        policy,
        "get_node_signal_summary",
        query.getNodeSignalSummary({
          nodePublicKey: node_public_key.toUpperCase(),
          region: upper(region),
          ...parseRange(from, to),
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "search_neighbors",
    {
      title: "Search public neighbor entries globally",
      description:
        "Search normalized neighbor entries across observers with region, observer, neighbor, and SNR filters.",
      inputSchema: z
        .object({
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          observer_public_key: publicKeySchema.optional(),
          neighbor_public_key: publicKeySchema.optional(),
          min_snr: z.number().min(-100).max(100).optional(),
          ...timeInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        z
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
          .strict(),
      ),
      annotations,
    },
    async ({
      region,
      observer_public_key,
      neighbor_public_key,
      min_snr,
      from,
      to,
      limit,
      cursor,
    }) =>
      toolResult(
        policy,
        "search_neighbors",
        query.searchNeighbors({
          region: upper(region),
          observerPublicKey: upper(observer_public_key),
          neighborPublicKey: upper(neighbor_public_key),
          minSnr: min_snr,
          ...parseRange(from, to),
          limit,
          cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "search_messages",
    {
      title: "Search stored public MeshCore messages",
      description:
        "Search normalized messages from public packets; encrypted payloads only become plaintext when the operator has configured the channel key for local decryption.",
      inputSchema: z
        .object({
          view: z.enum(["logical", "raw"]).optional(),
          packet_hash: packetHashSchema.optional(),
          logical_packet_id: z
            .string()
            .regex(/^lp_[0-9A-Fa-f]{64}$/)
            .optional(),
          sender_node_public_key: publicKeySchema.optional(),
          destination_node_public_key: publicKeySchema.optional(),
          message_type: z.string().min(1).max(64).optional(),
          channel: z.string().min(1).max(100).optional(),
          encrypted: z.boolean().optional(),
          signature_valid: z.boolean().optional(),
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          observer_public_key: publicKeySchema.optional(),
          ...timeInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: z.union([
        page(
          z
            .object({
              logical_message_id: z.string().regex(/^lp_[0-9A-Fa-f]{64}$/),
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
            })
            .strict(),
        ),
        page(
          z
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
            })
            .strict(),
        ),
      ]),
      annotations,
    },
    async ({
      view,
      packet_hash,
      logical_packet_id,
      sender_node_public_key,
      destination_node_public_key,
      message_type,
      channel,
      encrypted,
      signature_valid,
      region,
      observer_public_key,
      from,
      to,
      limit,
      cursor,
    }) =>
      toolResult(
        policy,
        "search_messages",
        query.searchMessages({
          view,
          packetHash: packet_hash?.toLowerCase(),
          logicalPacketId: logical_packet_id,
          senderNodePublicKey: upper(sender_node_public_key),
          destinationNodePublicKey: upper(destination_node_public_key),
          messageType: upper(message_type),
          channel,
          encrypted,
          signatureValid: signature_valid,
          region: upper(region),
          observerPublicKey: upper(observer_public_key),
          ...parseRange(from, to),
          limit,
          cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_message",
    {
      title: "Get a stored public MeshCore message",
      description:
        "Return one stored message record with its raw packet, logical message identity, and observation counts.",
      inputSchema: z
        .object({ message_id: z.number().int().positive() })
        .strict(),
      outputSchema: envelope(
        z
          .object({
            message_id: z.number().int().positive(),
            logical_message_id: z
              .string()
              .regex(/^lp_[0-9A-Fa-f]{64}$/)
              .nullable(),
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
            payload_hex: nullableStringSchema,
            reported_at: nullableTimestampSchema,
            received_at: timestampSchema,
            packet_hash: packetHashSchema,
            raw_packet_count: z.number().int().nonnegative(),
            observation_count: z.number().int().nonnegative(),
            first_observed_at: nullableTimestampSchema,
            last_observed_at: nullableTimestampSchema,
          })
          .strict()
          .nullable(),
      ),
      annotations,
    },
    async ({ message_id }) =>
      toolResult(
        policy,
        "get_message",
        query.getMessage(message_id).then((value) => value ?? query.notFound()),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_activity_timeseries",
    {
      title: "Get public MeshCore activity timeseries",
      description:
        "Aggregate public packet, observer, node, advert, TRACE, telemetry, and message activity.",
      inputSchema: z
        .object({
          from: timestampSchema,
          to: timestampSchema,
          bucket,
          observer_public_key: publicKeySchema.optional(),
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          limit: z.number().int().min(1).max(config.maxLimit).optional(),
          cursor: z.string().min(1).max(512).optional(),
        })
        .strict(),
      outputSchema: page(
        z
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
          .strict(),
      ),
      annotations,
    },
    async ({
      from,
      to,
      bucket: selectedBucket,
      observer_public_key,
      region,
      limit,
      cursor,
    }) => {
      const range = parseRange(from, to);
      const bucketMs = bucketMilliseconds[selectedBucket];
      return toolResult(
        policy,
        "get_activity_timeseries",
        query.getActivityTimeseries({
          from: range.from as number,
          to: range.to as number,
          bucketMs,
          observerPublicKey: upper(observer_public_key),
          region: upper(region),
          limit,
          cursor,
        }),
      );
    },
  );

  registerPublicTool(
    server,
    registry,
    "search_paths",
    {
      title: "Search observed MeshCore packet paths",
      description:
        "Search per-observation packet paths with live hop-prefix resolution against currently known nodes, server-side prefix/node filters, and stateless keyset pagination.",
      inputSchema: z
        .object({
          ...timeInput,
          region: regionSchema,
          logical_packet_id: logicalPacketIdSchema.optional(),
          packet_hash: packetHashSchema.optional(),
          observer_public_key: publicKeySchema.optional(),
          contains_prefix_hex: z
            .string()
            .regex(/^(?:[0-9A-Fa-f]{2}){1,3}$/)
            .optional(),
          contains_node_public_key: publicKeySchema.optional(),
          min_hops: z.number().int().min(0).optional(),
          max_hops: z.number().int().min(0).optional(),
          resolution_status: resolutionStatus.optional(),
          sort: z.literal("received_at").optional(),
          order: sortOrder,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(pathObservationItem),
      annotations,
    },
    async ({
      from,
      to,
      region,
      logical_packet_id,
      packet_hash,
      observer_public_key,
      contains_prefix_hex,
      contains_node_public_key,
      min_hops,
      max_hops,
      resolution_status,
      order,
      limit,
      cursor,
    }) => {
      const range = parseRange(from, to);
      return toolResult(
        policy,
        "search_paths",
        query.searchPaths({
          region: upper(region),
          logicalPacketId: logical_packet_id,
          packetHash: packet_hash?.toLowerCase(),
          observerPublicKey: upper(observer_public_key),
          containsPrefixHex: contains_prefix_hex?.toUpperCase(),
          containsNodePublicKey: upper(contains_node_public_key),
          minHops: min_hops,
          maxHops: max_hops,
          resolutionStatus: resolution_status,
          sort: {
            field: "received_at",
            order: order === "asc" ? "asc" : "desc",
          },
          from: range.from,
          to: range.to,
          limit,
          cursor,
        }),
      );
    },
  );

  registerPublicTool(
    server,
    registry,
    "search_path_prefixes",
    {
      title: "Aggregate observed MeshCore path prefixes",
      description:
        "Aggregate path prefixes over observed paths with counts, observers, live resolution status, and first/last seen times. Neutral aggregation without anomaly scoring or node classification.",
      inputSchema: z
        .object({
          ...timeInput,
          region: regionSchema,
          prefix_hex: z
            .string()
            .regex(/^(?:[0-9A-Fa-f]{2}){1,3}$/)
            .optional(),
          resolution_status: resolutionStatus.optional(),
          min_occurrences: z.number().int().min(1).optional(),
          sort: z
            .enum(["occurrence_count", "first_seen_at", "last_seen_at"])
            .optional(),
          order: sortOrder,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(pathPrefixItem),
      annotations,
    },
    async ({
      from,
      to,
      region,
      prefix_hex,
      resolution_status,
      min_occurrences,
      sort,
      order,
      limit,
      cursor,
    }) => {
      const range = parseRange(from, to);
      return toolResult(
        policy,
        "search_path_prefixes",
        query.searchPathPrefixes({
          region: upper(region),
          prefixHex: prefix_hex?.toUpperCase(),
          resolutionStatus: resolution_status,
          minOccurrences: min_occurrences,
          sort:
            sort === undefined
              ? undefined
              : { field: sort, order: order === "asc" ? "asc" : "desc" },
          from: range.from,
          to: range.to,
          limit,
          cursor,
        }),
      );
    },
  );

  registerPublicTool(
    server,
    registry,
    "search_events",
    {
      title: "Search a time-ordered public event stream",
      description:
        "Correlate packet, advert, message, trace, telemetry, and observer status events in one stateless time-ordered stream. Clients supply from=<their watermark>; the server stores no client state.",
      inputSchema: z
        .object({
          ...timeInput,
          region: regionSchema,
          node_public_key: publicKeySchema.optional(),
          observer_public_key: publicKeySchema.optional(),
          event_types: z.array(eventType).min(1).optional(),
          sort: z.literal("received_at").optional(),
          order: sortOrder,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(eventItem),
      annotations,
    },
    async ({
      from,
      to,
      region,
      node_public_key,
      observer_public_key,
      event_types,
      order,
      limit,
      cursor,
    }) => {
      const range = parseRange(from, to);
      return toolResult(
        policy,
        "search_events",
        query.searchEvents({
          region: upper(region),
          nodePublicKey: upper(node_public_key),
          observerPublicKey: upper(observer_public_key),
          eventTypes: event_types,
          sort: {
            field: "received_at",
            order: order === "asc" ? "asc" : "desc",
          },
          from: range.from,
          to: range.to,
          limit,
          cursor,
        }),
      );
    },
  );
}
