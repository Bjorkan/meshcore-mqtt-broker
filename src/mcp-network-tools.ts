import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { McpConfig } from "./config.js";
import type { PublicMcpQueryService } from "./mcp-public-query.js";
import {
  publicMcpToolResult,
  type PublicMcpDataPolicy,
} from "./mcp-public-policy.js";
import {
  registerPublicTool,
  type PublicToolRegistry,
} from "./public-tool-registry.js";

const publicKey = z.string().regex(/^[0-9A-Fa-f]{64}$/);
const packetHash = z.string().regex(/^[0-9A-Fa-f]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const nullableTimestamp = timestamp.nullable();
const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();
const nullableBoolean = z.boolean().nullable();
const bucket = z.enum(["minute", "hour", "day"]);
const bucketMilliseconds = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;

const meta = z
  .object({
    generated_at: timestamp,
    retention_days: z.number().int().positive(),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();

function envelope<T extends z.ZodType>(data: T) {
  return z.object({ data, meta }).strict();
}

function page<T extends z.ZodType>(item: T) {
  return envelope(z.array(item));
}

function pageInput(config: McpConfig) {
  return {
    limit: z.number().int().min(1).max(config.maxLimit).optional(),
    cursor: z.string().min(1).max(512).optional(),
  };
}

const timeInput = { from: timestamp.optional(), to: timestamp.optional() };
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function parseRange(from: string | undefined, to: string | undefined) {
  return {
    from: from === undefined ? undefined : Date.parse(from),
    to: to === undefined ? undefined : Date.parse(to),
  };
}

function upper(value: string | undefined): string | undefined {
  return value?.toUpperCase();
}

function toolResult(
  policy: PublicMcpDataPolicy,
  toolName: string,
  value: Promise<{ data: unknown; meta: unknown }>,
) {
  return publicMcpToolResult(policy, toolName, value);
}

const neighborEntry = z
  .object({
    public_key: publicKey,
    snr: nullableNumber,
    rssi: nullableNumber,
    heard_secs_ago: nullableNumber,
    calculated_last_heard_at: nullableTimestamp,
    status: z.string(),
    scopes: z.array(z.string()),
  })
  .strict();

const traceSummary = z
  .object({
    trace_id: z.number().int().positive(),
    packet_hash: packetHash,
    observer_public_key: publicKey,
    source_public_key: publicKey.nullable(),
    tag: nullableString,
    reported_at: nullableTimestamp,
    received_at: timestamp,
    hop_count: z.number().int().nonnegative(),
  })
  .strict();

const prefixCandidate = z
  .object({
    public_key: publicKey,
    name: nullableString,
    role: nullableString,
    latitude: nullableNumber,
    longitude: nullableNumber,
    confidence: z.number(),
    evidence_count: z.number().int().nonnegative(),
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
          observer_public_key: publicKey,
          at: timestamp.optional(),
          latest: z.boolean().default(true),
        })
        .strict(),
      outputSchema: envelope(
        z
          .object({
            observer_public_key: publicKey,
            snapshot_timestamp: timestamp,
            reported_timestamp: nullableTimestamp,
            mqtt_retained: z.boolean(),
            observer_scopes: z.array(z.string()),
            neighbors: z.array(neighborEntry),
          })
          .strict()
          .nullable(),
      ),
      annotations,
    },
    async ({ observer_public_key, at, latest }) => {
      if (!latest && at === undefined) {
        throw new Error("at is required when latest is false");
      }
      return toolResult(
        policy,
        "get_neighbors",
        query.getNeighbors({
          observerPublicKey: observer_public_key.toUpperCase(),
          at: at === undefined ? undefined : Date.parse(at),
        }),
      );
    },
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
          observer_public_key: publicKey,
          neighbor_public_key: publicKey.optional(),
          ...timeInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        neighborEntry
          .omit({ public_key: true })
          .extend({
            observer_public_key: publicKey,
            neighbor_public_key: publicKey,
            snapshot_timestamp: timestamp,
            reported_timestamp: nullableTimestamp,
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
    "get_packet_path",
    {
      title: "Get a resolved MeshCore packet path",
      description:
        "Return path prefixes and honest node-prefix resolution for a packet observation.",
      inputSchema: z
        .object({
          packet_hash: packetHash,
          observation_id: z.number().int().positive().optional(),
        })
        .strict(),
      outputSchema: envelope(
        z
          .object({
            packet_hash: packetHash,
            observation_id: z.number().int().positive(),
            raw_path: z.string().regex(/^(?:[0-9A-F]{2})*$/),
            hop_count: z.number().int().nonnegative(),
            received_at: timestamp,
            hops: z.array(
              z
                .object({
                  index: z.number().int().nonnegative(),
                  prefix: z.string().regex(/^(?:[0-9A-F]{2}){1,3}$/),
                  prefix_length_bytes: z.number().int().min(1).max(3),
                  resolved_public_key: publicKey.nullable(),
                  resolution_status: z.string(),
                  confidence: nullableNumber,
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
    async ({ packet_hash, observation_id }) =>
      toolResult(
        policy,
        "get_packet_path",
        query.getPacketPath({
          packetHash: packet_hash.toLowerCase(),
          observationId: observation_id,
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
          observer_public_key: publicKey,
          node_public_key: publicKey.optional(),
          packet_type: z.string().min(1).max(64).optional(),
          from: timestamp,
          to: timestamp,
          bucket: bucket.default("hour"),
          limit: z.number().int().min(1).max(config.maxLimit).optional(),
          cursor: z.string().min(1).max(512).optional(),
        })
        .strict(),
      outputSchema: page(
        z
          .object({
            timestamp,
            rssi: nullableNumber,
            snr: nullableNumber,
            score: nullableNumber,
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
          source_node_public_key: publicKey.optional(),
          observer_public_key: publicKey.optional(),
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
                  snr: nullableNumber,
                  resolved_public_key: publicKey.nullable(),
                  resolution_status: z.string(),
                  confidence: nullableNumber,
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
          node_public_key: publicKey,
          metric: z.string().min(1).max(200).optional(),
          ...timeInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        z
          .object({
            timestamp,
            reported_at: nullableTimestamp,
            metric_name: z.string(),
            numeric_value: nullableNumber,
            text_value: nullableString,
            boolean_value: nullableBoolean,
            unit: nullableString,
            channel: nullableNumber,
            packet_hash: packetHash,
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
    "search_messages",
    {
      title: "Search stored public MeshCore messages",
      description:
        "Search normalized messages from public packets; encrypted payloads never become plaintext.",
      inputSchema: z
        .object({
          view: z.enum(["logical", "raw"]).optional(),
          sender_node_public_key: publicKey.optional(),
          destination_node_public_key: publicKey.optional(),
          message_type: z.string().min(1).max(64).optional(),
          channel: z.string().min(1).max(100).optional(),
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
              channel: nullableString,
              channel_index: nullableNumber,
              sender_prefix: nullableString,
              sender_public_key: publicKey.nullable(),
              destination_prefix: nullableString,
              destination_public_key: publicKey.nullable(),
              encrypted: z.boolean(),
              text: nullableString,
              signature_valid: nullableBoolean,
              first_observed_at: timestamp,
              last_observed_at: timestamp,
              observation_count: z.number().int().nonnegative(),
              raw_packet_count: z.number().int().nonnegative(),
              first_observed_at_total: timestamp,
              last_observed_at_total: timestamp,
              observation_count_total: z.number().int().nonnegative(),
              raw_packet_count_total: z.number().int().nonnegative(),
              packet_hash: packetHash,
            })
            .strict(),
        ),
        page(
          z
            .object({
              message_id: z.number().int().positive(),
              message_type: z.string(),
              channel: nullableString,
              channel_index: nullableNumber,
              sender_prefix: nullableString,
              sender_public_key: publicKey.nullable(),
              destination_prefix: nullableString,
              destination_public_key: publicKey.nullable(),
              encrypted: z.boolean(),
              text: nullableString,
              signature_valid: nullableBoolean,
              reported_at: nullableTimestamp,
              received_at: timestamp,
              packet_hash: packetHash,
            })
            .strict(),
        ),
      ]),
      annotations,
    },
    async ({
      view,
      sender_node_public_key,
      destination_node_public_key,
      message_type,
      channel,
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
          senderNodePublicKey: upper(sender_node_public_key),
          destinationNodePublicKey: upper(destination_node_public_key),
          messageType: upper(message_type),
          channel,
          ...parseRange(from, to),
          limit,
          cursor,
        }),
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
          from: timestamp,
          to: timestamp,
          bucket,
          observer_public_key: publicKey.optional(),
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
        })
        .strict(),
      outputSchema: page(
        z
          .object({
            timestamp,
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
        }),
      );
    },
  );
}
