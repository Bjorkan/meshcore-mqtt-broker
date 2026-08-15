import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { McpConfig } from "./config.js";
import type { PublicMcpQueryService } from "./mcp-public-query.js";
import {
  publicMcpToolResult,
  type PublicMcpDataPolicy,
} from "./mcp-public-policy.js";

const publicKeySchema = z
  .string()
  .regex(/^[0-9A-Fa-f]{64}$/)
  .describe("64-character MeshCore public key in hexadecimal");
const packetHashSchema = z
  .string()
  .regex(/^[0-9A-Fa-f]{64}$/)
  .describe("SHA-256 packet hash in hexadecimal");
const prefixSchema = z
  .string()
  .regex(/^(?:[0-9A-Fa-f]{2}){1,32}$/)
  .describe("One to 32 bytes of a MeshCore public-key prefix");
const timestampSchema = z.iso.datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();
const nullableStringSchema = z.string().nullable();
const nullableNumberSchema = z.number().nullable();
const nullableBooleanSchema = z.boolean().nullable();

const metaSchema = z
  .object({
    generated_at: timestampSchema,
    retention_days: z.number().int().positive(),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();

function envelope<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: metaSchema }).strict();
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

const timeInput = {
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
};

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function ms(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Date.parse(value);
}

function range(from: string | undefined, to: string | undefined) {
  const parsed = { from: ms(from), to: ms(to) };
  if (
    parsed.from !== undefined &&
    parsed.to !== undefined &&
    parsed.from > parsed.to
  ) {
    throw new Error("from must be earlier than or equal to to");
  }
  return parsed;
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

const radioSchema = z
  .object({
    frequency_mhz: nullableNumberSchema,
    bandwidth_khz: nullableNumberSchema,
    spreading_factor: nullableNumberSchema,
    coding_rate: nullableNumberSchema,
    tx_power_dbm: nullableNumberSchema,
  })
  .strict();

const metricSchema = z
  .object({
    metric_name: z.string(),
    numeric_value: nullableNumberSchema,
    text_value: nullableStringSchema,
    boolean_value: nullableBooleanSchema,
    unit: nullableStringSchema,
  })
  .strict();

const neighborEntrySchema = z
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

const neighborSnapshotSchema = z
  .object({
    snapshot_timestamp: timestampSchema,
    reported_timestamp: nullableTimestampSchema,
    mqtt_retained: z.boolean(),
    observer_scopes: z.array(z.string()),
    neighbors: z.array(neighborEntrySchema),
  })
  .strict();

const advertSchema = z
  .object({
    advert_timestamp: nullableTimestampSchema,
    first_observed_at: timestampSchema,
    public_key: publicKeySchema,
    name: nullableStringSchema,
    role: nullableStringSchema,
    latitude: nullableNumberSchema,
    longitude: nullableNumberSchema,
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

export function registerPublicMcpCoreTools(
  server: McpServer,
  query: PublicMcpQueryService,
  config: McpConfig,
  policy: PublicMcpDataPolicy,
): void {
  server.registerTool(
    "get_storage_info",
    {
      title: "Get public history storage information",
      description:
        "Return public counts, retention, schema version, and ingest timestamps without storage paths or credentials.",
      inputSchema: z.object({}).strict(),
      outputSchema: envelope(
        z
          .object({
            schema_version: z.number().int().positive(),
            retention_days: z.number().int().positive(),
            oldest_event_at: nullableTimestampSchema,
            newest_event_at: nullableTimestampSchema,
            packet_count: z.number().int().nonnegative(),
            packet_observation_count: z.number().int().nonnegative(),
            observer_count: z.number().int().nonnegative(),
            node_count: z.number().int().nonnegative(),
            database_available: z.boolean(),
            last_ingest_at: nullableTimestampSchema,
          })
          .strict(),
      ),
      annotations,
    },
    async () => toolResult(policy, "get_storage_info", query.getStorageInfo()),
  );

  server.registerTool(
    "get_network_summary",
    {
      title: "Get MeshCore network summary",
      description:
        "Summarize public observer, node, packet, advert, neighbor, trace, telemetry, and message activity.",
      inputSchema: z.object(timeInput).strict(),
      outputSchema: envelope(
        z
          .object({
            active_observers: z.number().int().nonnegative(),
            known_observers: z.number().int().nonnegative(),
            active_nodes: z.number().int().nonnegative(),
            known_nodes: z.number().int().nonnegative(),
            active_repeaters: z.number().int().nonnegative(),
            unique_packets: z.number().int().nonnegative(),
            packet_observations: z.number().int().nonnegative(),
            advert_count: z.number().int().nonnegative(),
            neighbor_snapshot_count: z.number().int().nonnegative(),
            trace_count: z.number().int().nonnegative(),
            telemetry_event_count: z.number().int().nonnegative(),
            message_count: z.number().int().nonnegative(),
            median_rssi: nullableNumberSchema,
            median_snr: nullableNumberSchema,
            first_event_at: nullableTimestampSchema,
            last_event_at: nullableTimestampSchema,
          })
          .strict(),
      ),
      annotations,
    },
    async ({ from, to }) =>
      toolResult(
        policy,
        "get_network_summary",
        query.getNetworkSummary(range(from, to)),
      ),
  );

  server.registerTool(
    "list_observers",
    {
      title: "List public MeshCore observers",
      description:
        "List observers with latest public status and bounded cursor pagination.",
      inputSchema: z
        .object({
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          active_since: timestampSchema.optional(),
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        z
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
          })
          .strict(),
      ),
      annotations,
    },
    async ({ region, active_since, limit, cursor }) =>
      toolResult(
        policy,
        "list_observers",
        query.listObservers({
          region: upper(region),
          activeSince: ms(active_since),
          limit,
          cursor,
        }),
      ),
  );

  server.registerTool(
    "get_observer",
    {
      title: "Get a public MeshCore observer",
      description:
        "Return one observer's public regions, latest status, radio configuration, and metrics.",
      inputSchema: z.object({ public_key: publicKeySchema }).strict(),
      outputSchema: envelope(
        z
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
          .strict()
          .nullable(),
      ),
      annotations,
    },
    async ({ public_key }) =>
      toolResult(
        policy,
        "get_observer",
        query
          .getObserver(public_key.toUpperCase())
          .then((value) => value ?? query.notFound()),
      ),
  );

  server.registerTool(
    "get_observer_status_history",
    {
      title: "Get observer public status history",
      description:
        "Return normalized public /status observations with bounded cursor pagination.",
      inputSchema: z
        .object({
          observer_public_key: publicKeySchema,
          ...timeInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        z
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
          .strict(),
      ),
      annotations,
    },
    async ({ observer_public_key, from, to, limit, cursor }) =>
      toolResult(
        policy,
        "get_observer_status_history",
        query.getObserverStatusHistory({
          observerPublicKey: observer_public_key.toUpperCase(),
          ...range(from, to),
          limit,
          cursor,
        }),
      ),
  );

  server.registerTool(
    "list_nodes",
    {
      title: "List public MeshCore nodes",
      description:
        "List nodes derived from MeshCore packets and verified advertisements.",
      inputSchema: z
        .object({
          role: z.string().min(1).max(32).optional(),
          name: z.string().min(1).max(120).optional(),
          public_key: publicKeySchema.optional(),
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          active_since: timestampSchema.optional(),
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        z
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
          .strict(),
      ),
      annotations,
    },
    async ({ role, name, public_key, region, active_since, limit, cursor }) =>
      toolResult(
        policy,
        "list_nodes",
        query.listNodes({
          role: upper(role),
          name,
          publicKey: upper(public_key),
          region: upper(region),
          activeSince: ms(active_since),
          limit,
          cursor,
        }),
      ),
  );

  server.registerTool(
    "get_node",
    {
      title: "Get a public MeshCore node",
      description:
        "Return verified advert state, advertised position, sightings, regions, and recent telemetry for a node.",
      inputSchema: z.object({ public_key: publicKeySchema }).strict(),
      outputSchema: envelope(
        z
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
            latest_advert: advertSchema
              .omit({ public_key: true })
              .strict()
              .nullable(),
            regions_seen: z.array(
              z
                .object({ region: z.string(), last_seen_at: timestampSchema })
                .strict(),
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
          .strict()
          .nullable(),
      ),
      annotations,
    },
    async ({ public_key }) =>
      toolResult(
        policy,
        "get_node",
        query
          .getNode(public_key.toUpperCase())
          .then((value) => value ?? query.notFound()),
      ),
  );

  server.registerTool(
    "get_node_adverts",
    {
      title: "Get MeshCore node advertisement history",
      description:
        "Return bounded verified and unverified advert history derived from public packets.",
      inputSchema: z
        .object({
          public_key: publicKeySchema,
          ...timeInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(advertSchema),
      annotations,
    },
    async ({ public_key, from, to, limit, cursor }) =>
      toolResult(
        policy,
        "get_node_adverts",
        query.getNodeAdverts({
          publicKey: public_key.toUpperCase(),
          ...range(from, to),
          limit,
          cursor,
        }),
      ),
  );

  server.registerTool(
    "get_node_sightings",
    {
      title: "Get public MeshCore node sightings",
      description:
        "Return observers, regions, packets, and timestamps that sighted a node.",
      inputSchema: z
        .object({
          node_public_key: publicKeySchema,
          observer_public_key: publicKeySchema.optional(),
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          ...timeInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        z
          .object({
            node_public_key: publicKeySchema,
            observer_public_key: publicKeySchema,
            region: z.string(),
            timestamp: timestampSchema,
            sighting_type: z.string(),
            packet_hash: packetHashSchema,
          })
          .strict(),
      ),
      annotations,
    },
    async ({
      node_public_key,
      observer_public_key,
      region,
      from,
      to,
      limit,
      cursor,
    }) =>
      toolResult(
        policy,
        "get_node_sightings",
        query.getNodeSightings({
          nodePublicKey: node_public_key.toUpperCase(),
          observerPublicKey: upper(observer_public_key),
          region: upper(region),
          ...range(from, to),
          limit,
          cursor,
        }),
      ),
  );

  server.registerTool(
    "resolve_node_prefix",
    {
      title: "Resolve a MeshCore public-key prefix",
      description:
        "Return all matching node candidates and mark ambiguous prefixes without guessing uniqueness.",
      inputSchema: z.object({ prefix_hex: prefixSchema }).strict(),
      outputSchema: envelope(
        z
          .object({
            prefix_hex: prefixSchema,
            prefix_length_bytes: z.number().int().min(1).max(32),
            candidates: z.array(
              z
                .object({
                  public_key: publicKeySchema,
                  name: nullableStringSchema,
                  role: nullableStringSchema,
                  confidence: z.number(),
                  evidence_count: z.number().int().nonnegative(),
                })
                .strict(),
            ),
            ambiguous: z.boolean(),
          })
          .strict(),
      ),
      annotations,
    },
    async ({ prefix_hex }) =>
      toolResult(
        policy,
        "resolve_node_prefix",
        query.resolveNodePrefix(prefix_hex.toUpperCase()),
      ),
  );

  server.registerTool(
    "search_packets",
    {
      title: "Search public MeshCore packets",
      description:
        "Search normalized /packets data using bounded validated filters; raw MQTT events are never returned.",
      inputSchema: z
        .object({
          ...timeInput,
          packet_hash: packetHashSchema.optional(),
          observer_public_key: publicKeySchema.optional(),
          node_public_key: publicKeySchema.optional(),
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          packet_type: z.string().min(1).max(64).optional(),
          payload_type: z.string().min(1).max(64).optional(),
          route_type: z.string().min(1).max(64).optional(),
          min_rssi: z.number().min(-300).max(100).optional(),
          max_rssi: z.number().min(-300).max(100).optional(),
          min_snr: z.number().min(-100).max(100).optional(),
          max_snr: z.number().min(-100).max(100).optional(),
          min_score: z.number().min(-1_000_000).max(1_000_000).optional(),
          max_score: z.number().min(-1_000_000).max(1_000_000).optional(),
          min_hops: z.number().int().min(0).max(64).optional(),
          max_hops: z.number().int().min(0).max(64).optional(),
          decode_status: z
            .enum([
              "not_attempted",
              "decoded",
              "partially_decoded",
              "unknown_type",
              "invalid_packet",
              "decoder_error",
            ])
            .optional(),
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        z
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
            min_rssi: nullableNumberSchema,
            max_rssi: nullableNumberSchema,
            min_snr: nullableNumberSchema,
            max_snr: nullableNumberSchema,
            hop_count: z.number().int().nonnegative(),
          })
          .strict(),
      ),
      annotations,
    },
    async (input) =>
      toolResult(
        policy,
        "search_packets",
        query.searchPackets({
          ...range(input.from, input.to),
          packetHash: input.packet_hash?.toLowerCase(),
          observerPublicKey: upper(input.observer_public_key),
          nodePublicKey: upper(input.node_public_key),
          region: upper(input.region),
          packetType: upper(input.packet_type),
          payloadType: upper(input.payload_type),
          routeType: upper(input.route_type),
          minRssi: input.min_rssi,
          maxRssi: input.max_rssi,
          minSnr: input.min_snr,
          maxSnr: input.max_snr,
          minScore: input.min_score,
          maxScore: input.max_score,
          minHops: input.min_hops,
          maxHops: input.max_hops,
          decodeStatus: input.decode_status,
          limit: input.limit,
          cursor: input.cursor,
        }),
      ),
  );

  server.registerTool(
    "get_packet",
    {
      title: "Get a public MeshCore packet",
      description:
        "Return normalized packet metadata, allowlisted decoded fields, raw MeshCore packet hex, and bounded paths.",
      inputSchema: z.object({ packet_hash: packetHashSchema }).strict(),
      outputSchema: envelope(
        z
          .object({
            packet_hash: packetHashSchema,
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
          .strict()
          .nullable(),
      ),
      annotations,
    },
    async ({ packet_hash }) =>
      toolResult(
        policy,
        "get_packet",
        query
          .getPacket(packet_hash.toLowerCase())
          .then((value) => value ?? query.notFound()),
      ),
  );

  server.registerTool(
    "get_packet_observations",
    {
      title: "Get public packet observations",
      description:
        "Return RF observations for one MeshCore packet with bounded cursor pagination.",
      inputSchema: z
        .object({
          packet_hash: packetHashSchema,
          observer_public_key: publicKeySchema.optional(),
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        z
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
          .strict(),
      ),
      annotations,
    },
    async ({ packet_hash, observer_public_key, limit, cursor }) =>
      toolResult(
        policy,
        "get_packet_observations",
        query.getPacketObservations({
          packetHash: packet_hash.toLowerCase(),
          observerPublicKey: upper(observer_public_key),
          limit,
          cursor,
        }),
      ),
  );
}
