import { z } from "zod/v4";
import type { McpConfig } from "../config.js";
import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import { PUBLIC_MCP_PROTOCOL_VERSION } from "../mcp-tool-common.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import { envelopeSchema, sendRest } from "./helpers.js";
import { jsonSchema, timeRangeQuery } from "./query-schemas.js";

export interface SystemRouteDependencies {
  query: PublicMcpQueryService;
  policy: PublicMcpDataPolicy;
  config: McpConfig;
}

const storageDataSchema = z
  .object({
    schema_version: z.number(),
    retention_days: z.number(),
    oldest_event_at: z.string().nullable(),
    newest_event_at: z.string().nullable(),
    packet_count: z.number(),
    packet_observation_count: z.number(),
    observer_count: z.number(),
    node_count: z.number(),
    database_available: z.boolean(),
    last_ingest_at: z.string().nullable(),
  })
  .strict();

const capabilitiesDataSchema = z
  .object({
    server_version: z.string(),
    public_access: z.literal(true),
    authentication_required: z.literal(false),
    read_only: z.literal(true),
    storage_available: z.boolean(),
    retention_days: z.number(),
    default_page_size: z.number(),
    max_page_size: z.number(),
    max_timeseries_buckets: z.number(),
    default_summary_window_seconds: z.number(),
    supported_buckets: z.array(z.string()),
    supported_views: z.array(z.string()),
    supported_count_modes: z.array(z.string()),
    logical_packet_grouping: z.boolean(),
    logical_message_grouping: z.boolean(),
    geospatial: z.boolean(),
    batch_lookup: z.boolean(),
    supports_observers: z.boolean(),
    supports_nodes: z.boolean(),
    supports_packets: z.boolean(),
    supports_packet_observations: z.boolean(),
    supports_adverts: z.boolean(),
    supports_neighbors: z.boolean(),
    supports_paths: z.boolean(),
    supports_path_prefix_aggregation: z.boolean(),
    supports_traces: z.boolean(),
    supports_telemetry: z.boolean(),
    supports_messages: z.boolean(),
    supports_message_payload_batch: z.boolean(),
    supports_event_stream: z.boolean(),
    supports_channel_decryption: z.boolean(),
    supports_raw_packet_bytes: z.boolean(),
    supports_regions: z.boolean(),
    supported_sort_fields: z.record(z.string(), z.array(z.string())),
    supported_event_types: z.array(z.string()),
    max_path_page_size: z.number(),
    max_message_payload_batch_size: z.number(),
    mcp: z
      .object({
        endpoint: z.string(),
        sdk_reported_protocol_version: z.string(),
      })
      .strict(),
  })
  .strict();

const summaryDataSchema = z
  .object({
    window_from: z.string(),
    window_to: z.string(),
    active_observers: z.number(),
    known_observers: z.number(),
    active_nodes: z.number(),
    known_nodes: z.number(),
    active_repeaters: z.number(),
    unique_packets: z.number(),
    packet_observations: z.number(),
    logical_packet_count: z.number(),
    advert_count: z.number(),
    advert_raw_packet_count: z.number(),
    advert_observation_count: z.number(),
    neighbor_snapshot_count: z.number(),
    trace_count: z.number(),
    telemetry_event_count: z.number(),
    message_count: z.number(),
    message_observation_count: z.number(),
    median_rssi: z.number().nullable(),
    median_snr: z.number().nullable(),
    first_event_at: z.string().nullable(),
    last_event_at: z.string().nullable(),
  })
  .strict();

const schemaDataSchema = z
  .object({
    server_name: z.string(),
    server_version: z.string(),
    node_roles: z.array(z.string()),
    packet_types: z.array(z.string()),
    payload_types: z.array(z.string()),
    route_types: z.array(z.string()),
    decode_statuses: z.array(z.string()),
    message_types: z.array(z.string()),
    metric_units: z.record(z.string(), z.string()),
    region_codes: z.array(z.string()),
    region_code_system: z.literal("IATA"),
    views: z.array(z.string()),
    count_modes: z.array(z.string()),
    count_semantics: z.record(z.string(), z.string()),
    timestamp_semantics: z.array(z.string()),
    filter_dimensions: z.record(z.string(), z.array(z.string())),
    event_types: z.array(z.string()),
    path_resolution_statuses: z.array(z.string()),
    channel_decryption: z
      .object({
        enabled: z.boolean(),
        semantics: z.string(),
      })
      .strict(),
    pagination: z
      .object({
        default_page_size: z.number(),
        max_page_size: z.number(),
        max_path_page_size: z.number(),
        max_message_payload_batch_size: z.number(),
        max_timeseries_buckets: z.number(),
        default_summary_window_seconds: z.number(),
      })
      .strict(),
    result_statuses: z.array(z.string()),
  })
  .strict();

export function registerSystemRoutes(
  app: RestFastifyInstance,
  deps: SystemRouteDependencies,
): void {
  const { query, policy, config } = deps;

  app.get(
    "/api/v2",
    {
      schema: {
        hide: false,
        tags: ["system"],
        summary: "REST API discovery",
        response: {
          200: jsonSchema(
            z
              .object({
                name: z.string(),
                version: z.string(),
                server_version: z.string(),
                public_access: z.literal(true),
                authentication_required: z.literal(false),
                read_only: z.literal(true),
                resources: z.record(z.string(), z.string()),
                mcp: z
                  .object({
                    endpoint: z.string(),
                  })
                  .strict(),
              })
              .strict(),
          ),
        },
      },
    },
    () => {
      return {
        name: "meshcore-mqtt-broker-rest",
        version: "v2",
        server_version: query.capabilitiesData().server_version,
        public_access: true,
        authentication_required: false,
        read_only: true,
        resources: {
          capabilities: "/api/v2/capabilities",
          storage: "/api/v2/storage",
          schema: "/api/v2/schema",
          network: "/api/v2/network/summary",
        },
        mcp: { endpoint: config.path },
      };
    },
  );

  app.get(
    "/api/v2/capabilities",
    {
      schema: {
        tags: ["system"],
        summary: "Public API capabilities and limits",
        response: {
          200: jsonSchema(envelopeSchema(capabilitiesDataSchema)),
        },
      },
    },
    (_request, reply) => {
      const data = {
        ...query.capabilitiesData(),
        mcp: {
          endpoint: config.path,
          sdk_reported_protocol_version: PUBLIC_MCP_PROTOCOL_VERSION,
        },
      };
      return sendRest(policy, reply, { data, meta: query.pageMeta() });
    },
  );

  app.get(
    "/api/v2/storage",
    {
      schema: {
        tags: ["system"],
        summary: "Public history storage information",
        response: {
          200: jsonSchema(envelopeSchema(storageDataSchema)),
        },
      },
    },
    async (_request, reply) =>
      sendRest(policy, reply, await query.getStorageInfo()),
  );

  app.get(
    "/api/v2/schema",
    {
      schema: {
        tags: ["system"],
        summary: "Self-describing public data dictionary",
        response: {
          200: jsonSchema(envelopeSchema(schemaDataSchema)),
        },
      },
    },
    async (_request, reply) =>
      sendRest(policy, reply, await query.getSchemaDictionary()),
  );

  app.get(
    "/api/v2/network/summary",
    {
      schema: {
        tags: ["system"],
        summary: "Bounded network activity summary",
        querystring: jsonSchema(timeRangeQuery),
        response: {
          200: jsonSchema(envelopeSchema(summaryDataSchema)),
        },
      },
    },
    async (request, reply) => {
      const { from, to } = request.query as { from?: string; to?: string };
      return sendRest(
        policy,
        reply,
        await query.getNetworkSummary({
          from: from === undefined ? undefined : Date.parse(from),
          to: to === undefined ? undefined : Date.parse(to),
        }),
      );
    },
  );
}
