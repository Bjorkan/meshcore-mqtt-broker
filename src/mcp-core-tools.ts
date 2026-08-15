import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { McpConfig } from "./config.js";
import type { PublicMcpQueryService } from "./mcp-public-query.js";
import type { PublicMcpDataPolicy } from "./mcp-public-policy.js";
import {
  annotations,
  advertSchema,
  envelope,
  logicalPacketIdSchema,
  metricSchema,
  nodeDetailSchema,
  nullableNumberSchema,
  nullableStringSchema,
  nullableTimestampSchema,
  observerDetailSchema,
  page,
  pageInput,
  packetDetailSchema,
  packetHashSchema,
  parseRange,
  prefixSchema,
  publicKeySchema,
  radioSchema,
  timestampSchema,
  timeInput,
  toolResult,
  upper,
} from "./mcp-tool-common.js";
import {
  registerPublicTool,
  type PublicToolRegistry,
} from "./public-tool-registry.js";

function ms(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Date.parse(value);
}

const geospatialInput = {
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radius_km: z.number().positive().max(500).optional(),
  min_latitude: z.number().min(-90).max(90).optional(),
  max_latitude: z.number().min(-90).max(90).optional(),
  min_longitude: z.number().min(-180).max(180).optional(),
  max_longitude: z.number().min(-180).max(180).optional(),
};

function geoFilter(input: {
  latitude?: number;
  longitude?: number;
  radius_km?: number;
  min_latitude?: number;
  max_latitude?: number;
  min_longitude?: number;
  max_longitude?: number;
}):
  | {
      latitude?: number;
      longitude?: number;
      radiusKm?: number;
      minLatitude?: number;
      maxLatitude?: number;
      minLongitude?: number;
      maxLongitude?: number;
    }
  | undefined {
  if (
    input.latitude === undefined &&
    input.longitude === undefined &&
    input.radius_km === undefined &&
    input.min_latitude === undefined &&
    input.max_latitude === undefined &&
    input.min_longitude === undefined &&
    input.max_longitude === undefined
  ) {
    return undefined;
  }
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    radiusKm: input.radius_km,
    minLatitude: input.min_latitude,
    maxLatitude: input.max_latitude,
    minLongitude: input.min_longitude,
    maxLongitude: input.max_longitude,
  };
}

export function registerPublicMcpCoreTools(
  server: McpServer,
  query: PublicMcpQueryService,
  config: McpConfig,
  policy: PublicMcpDataPolicy,
  registry?: PublicToolRegistry,
): void {
  registerPublicTool(
    server,
    registry,
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

  registerPublicTool(
    server,
    registry,
    "list_regions",
    {
      title: "List public MeshCore regions",
      description:
        "List configured or observed three-letter IATA regions with primary/secondary status.",
      inputSchema: z.object({}).strict(),
      outputSchema: page(
        z
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
          .strict(),
      ),
      annotations,
    },
    async () => toolResult(policy, "list_regions", query.listRegions()),
  );

  registerPublicTool(
    server,
    registry,
    "get_region_summary",
    {
      title: "Get a public MeshCore region summary",
      description:
        "Summarize observer, node, repeater, packet, advert, and message activity for one IATA region.",
      inputSchema: z
        .object({
          region: z.string().regex(/^[A-Za-z]{3}$/),
          ...timeInput,
        })
        .strict(),
      outputSchema: envelope(
        z
          .object({
            code: z.string().regex(/^[A-Z]{3}$/),
            code_system: z.literal("IATA"),
            name: nullableStringSchema,
            is_allowed: z.boolean(),
            window_from: timestampSchema,
            window_to: timestampSchema,
            observer_count: z.number().int().nonnegative(),
            active_observers: z.number().int().nonnegative(),
            node_count: z.number().int().nonnegative(),
            repeater_count: z.number().int().nonnegative(),
            unique_packets: z.number().int().nonnegative(),
            logical_packet_count: z.number().int().nonnegative(),
            logical_advert_count: z.number().int().nonnegative(),
            message_count: z.number().int().nonnegative(),
            last_activity_at: nullableTimestampSchema,
          })
          .strict(),
      ),
      annotations,
    },
    async ({ region, from, to }) =>
      toolResult(
        policy,
        "get_region_summary",
        query.getRegionSummary({
          region: region.toUpperCase(),
          ...parseRange(from, to),
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_network_summary",
    {
      title: "Get MeshCore network summary",
      description:
        "Summarize public observer, node, packet, advert, neighbor, trace, telemetry, and message activity.",
      inputSchema: z.object(timeInput).strict(),
      outputSchema: envelope(
        z
          .object({
            window_from: timestampSchema,
            window_to: timestampSchema,
            active_observers: z.number().int().nonnegative(),
            known_observers: z.number().int().nonnegative(),
            active_nodes: z.number().int().nonnegative(),
            known_nodes: z.number().int().nonnegative(),
            active_repeaters: z.number().int().nonnegative(),
            unique_packets: z.number().int().nonnegative(),
            packet_observations: z.number().int().nonnegative(),
            logical_packet_count: z.number().int().nonnegative(),
            advert_count: z.number().int().nonnegative(),
            advert_raw_packet_count: z.number().int().nonnegative(),
            advert_observation_count: z.number().int().nonnegative(),
            neighbor_snapshot_count: z.number().int().nonnegative(),
            trace_count: z.number().int().nonnegative(),
            telemetry_event_count: z.number().int().nonnegative(),
            message_count: z.number().int().nonnegative(),
            message_observation_count: z.number().int().nonnegative(),
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
        query.getNetworkSummary(parseRange(from, to)),
      ),
  );

  registerPublicTool(
    server,
    registry,
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
          has_neighbor_data: z.boolean().optional(),
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
            has_neighbor_data: z.boolean(),
            latest_neighbor_snapshot_at: nullableTimestampSchema,
            neighbor_count_latest: nullableNumberSchema,
          })
          .strict(),
      ),
      annotations,
    },
    async ({ region, active_since, has_neighbor_data, limit, cursor }) =>
      toolResult(
        policy,
        "list_observers",
        query.listObservers({
          region: upper(region),
          activeSince: ms(active_since),
          hasNeighborData: has_neighbor_data,
          limit,
          cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_observer",
    {
      title: "Get a public MeshCore observer",
      description:
        "Return one observer's public regions, latest status, radio configuration, and metrics.",
      inputSchema: z.object({ public_key: publicKeySchema }).strict(),
      outputSchema: envelope(observerDetailSchema.nullable()),
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

  registerPublicTool(
    server,
    registry,
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
          ...parseRange(from, to),
          limit,
          cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
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
          ...geospatialInput,
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
    async (input) =>
      toolResult(
        policy,
        "list_nodes",
        query.listNodes({
          role: upper(input.role),
          name: input.name,
          publicKey: upper(input.public_key),
          region: upper(input.region),
          activeSince: ms(input.active_since),
          geo: geoFilter(input),
          limit: input.limit,
          cursor: input.cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_node",
    {
      title: "Get a public MeshCore node",
      description:
        "Return verified advert state, advertised position, sightings, regions, and recent telemetry for a node.",
      inputSchema: z.object({ public_key: publicKeySchema }).strict(),
      outputSchema: envelope(nodeDetailSchema.nullable()),
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

  registerPublicTool(
    server,
    registry,
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
          ...parseRange(from, to),
          limit,
          cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
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
          ...parseRange(from, to),
          limit,
          cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
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
                  latitude: nullableNumberSchema,
                  longitude: nullableNumberSchema,
                  confidence: z.number(),
                  evidence_count: z.number().int().nonnegative(),
                })
                .strict(),
            ),
            resolution_status: z.enum(["resolved", "ambiguous", "unresolved"]),
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

  registerPublicTool(
    server,
    registry,
    "search_packets",
    {
      title: "Search public MeshCore packets",
      description:
        "Search normalized /packets data using bounded validated filters; raw MQTT events are never returned.",
      inputSchema: z
        .object({
          ...timeInput,
          view: z.enum(["logical", "raw"]).optional(),
          packet_hash: packetHashSchema.optional(),
          logical_packet_id: logicalPacketIdSchema.optional(),
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
      outputSchema: z.union([
        page(
          z
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
            .strict(),
        ),
        page(
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
              first_seen_at_total: timestampSchema,
              last_seen_at_total: timestampSchema,
              observation_count_total: z.number().int().nonnegative(),
              min_rssi: nullableNumberSchema,
              max_rssi: nullableNumberSchema,
              min_snr: nullableNumberSchema,
              max_snr: nullableNumberSchema,
              hop_count: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      ]),
      annotations,
    },
    async (input) =>
      toolResult(
        policy,
        "search_packets",
        query.searchPackets({
          ...parseRange(input.from, input.to),
          view: input.view,
          packetHash: input.packet_hash?.toLowerCase(),
          logicalPacketId: input.logical_packet_id,
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

  registerPublicTool(
    server,
    registry,
    "get_packet",
    {
      title: "Get a public MeshCore packet",
      description:
        "Return normalized packet metadata, allowlisted decoded fields, raw MeshCore packet hex, and bounded paths.",
      inputSchema: z.object({ packet_hash: packetHashSchema }).strict(),
      outputSchema: envelope(packetDetailSchema.nullable()),
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

  registerPublicTool(
    server,
    registry,
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

  registerPublicTool(
    server,
    registry,
    "search_adverts",
    {
      title: "Search public MeshCore adverts globally",
      description:
        "Search logical adverts across all nodes with node, name, role, region, verification, location, and geospatial filters.",
      inputSchema: z
        .object({
          ...timeInput,
          node_public_key: publicKeySchema.optional(),
          prefix_hex: prefixSchema.optional(),
          logical_packet_id: logicalPacketIdSchema.optional(),
          name: z.string().min(1).max(120).optional(),
          role: z.string().min(1).max(32).optional(),
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          verified: z.boolean().optional(),
          signature_valid: z.boolean().optional(),
          has_location: z.boolean().optional(),
          ...geospatialInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(advertSchema),
      annotations,
    },
    async (input) =>
      toolResult(
        policy,
        "search_adverts",
        query.searchAdverts({
          ...parseRange(input.from, input.to),
          nodePublicKey: upper(input.node_public_key),
          prefixHex: upper(input.prefix_hex),
          logicalPacketId: input.logical_packet_id,
          name: input.name,
          role: upper(input.role),
          region: upper(input.region),
          verified: input.verified,
          signatureValid: input.signature_valid,
          hasLocation: input.has_location,
          geo: geoFilter(input),
          limit: input.limit,
          cursor: input.cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_nodes",
    {
      title: "Get public MeshCore nodes in batch",
      description:
        "Return up to 100 node details in one call and list any unknown public keys.",
      inputSchema: z
        .object({
          public_keys: z.array(publicKeySchema).min(1).max(100),
        })
        .strict(),
      outputSchema: envelope(
        z
          .object({
            nodes: z.array(nodeDetailSchema),
            missing_public_keys: z.array(publicKeySchema),
          })
          .strict(),
      ),
      annotations,
    },
    async ({ public_keys }) =>
      toolResult(
        policy,
        "get_nodes",
        query.getNodesBatch(public_keys.map((key) => key.toUpperCase())),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_observers",
    {
      title: "Get public MeshCore observers in batch",
      description:
        "Return up to 100 observer details in one call and list any unknown public keys.",
      inputSchema: z
        .object({
          public_keys: z.array(publicKeySchema).min(1).max(100),
        })
        .strict(),
      outputSchema: envelope(
        z
          .object({
            observers: z.array(observerDetailSchema),
            missing_public_keys: z.array(publicKeySchema),
          })
          .strict(),
      ),
      annotations,
    },
    async ({ public_keys }) =>
      toolResult(
        policy,
        "get_observers",
        query.getObserversBatch(public_keys.map((key) => key.toUpperCase())),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_packets",
    {
      title: "Get public MeshCore packets in batch",
      description:
        "Return up to 100 packet details in one call and list any unknown packet hashes.",
      inputSchema: z
        .object({
          packet_hashes: z.array(packetHashSchema).min(1).max(100),
        })
        .strict(),
      outputSchema: envelope(
        z
          .object({
            packets: z.array(packetDetailSchema),
            missing_packet_hashes: z.array(packetHashSchema),
          })
          .strict(),
      ),
      annotations,
    },
    async ({ packet_hashes }) =>
      toolResult(
        policy,
        "get_packets",
        query.getPacketsBatch(packet_hashes.map((hash) => hash.toLowerCase())),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_node_position_history",
    {
      title: "Get public node position history",
      description:
        "Return deduplicated logical-advert positions for one node with bounded cursor pagination.",
      inputSchema: z
        .object({
          node_public_key: publicKeySchema,
          ...timeInput,
          ...pageInput(config),
        })
        .strict(),
      outputSchema: page(
        z
          .object({
            logical_advert_id: logicalPacketIdSchema,
            latitude: nullableNumberSchema,
            longitude: nullableNumberSchema,
            position_quality: z.enum(["zero_zero_sentinel"]).nullable(),
            name: nullableStringSchema,
            role: nullableStringSchema,
            first_observed_at: timestampSchema,
            last_observed_at: timestampSchema,
            observation_count: z.number().int().nonnegative(),
            first_observed_at_total: timestampSchema,
            last_observed_at_total: timestampSchema,
          })
          .strict(),
      ),
      annotations,
    },
    async ({ node_public_key, from, to, limit, cursor }) =>
      toolResult(
        policy,
        "get_node_position_history",
        query.getNodePositionHistory({
          publicKey: node_public_key.toUpperCase(),
          ...parseRange(from, to),
          limit,
          cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "search_processing_errors",
    {
      title: "Search sanitized public processing errors",
      description:
        "Search processing and decode diagnostics by stage, code, packet, observer, and region; SQL, paths, credentials, and stack traces are never returned.",
      inputSchema: z
        .object({
          stage: z.string().min(1).max(64).optional(),
          code: z.string().min(1).max(100).optional(),
          packet_hash: packetHashSchema.optional(),
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
          .strict(),
      ),
      annotations,
    },
    async (input) =>
      toolResult(
        policy,
        "search_processing_errors",
        query.searchProcessingErrors({
          stage: input.stage,
          code: input.code,
          packetHash: input.packet_hash?.toLowerCase(),
          observerPublicKey: upper(input.observer_public_key),
          region: upper(input.region),
          ...parseRange(input.from, input.to),
          limit: input.limit,
          cursor: input.cursor,
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_data_quality_summary",
    {
      title: "Get public data quality summary",
      description:
        "Count invalid signatures, decoder errors, implausible or future embedded timestamps, 0,0 positions, missing RSSI/SNR, unresolved or ambiguous path prefixes, multi-route logical packets, and processing errors.",
      inputSchema: z
        .object({
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          ...timeInput,
        })
        .strict(),
      outputSchema: envelope(
        z
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
            logical_packets_with_multiple_routes: z
              .number()
              .int()
              .nonnegative(),
            processing_errors: z.number().int().nonnegative(),
          })
          .strict(),
      ),
      annotations,
    },
    async ({ region, from, to }) =>
      toolResult(
        policy,
        "get_data_quality_summary",
        query.getDataQualitySummary({
          region: upper(region),
          ...parseRange(from, to),
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_packet_type_summary",
    {
      title: "Get public packet type summary",
      description:
        "Rank packet types by logical, raw, and observation counts with median RSSI/SNR.",
      inputSchema: z
        .object({
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
              packet_type: nullableStringSchema,
              logical_packet_count: z.number().int().nonnegative(),
              raw_packet_count: z.number().int().nonnegative(),
              observation_count: z.number().int().nonnegative(),
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
    async ({ region, from, to }) =>
      toolResult(
        policy,
        "get_packet_type_summary",
        query.getPacketTypeSummary({
          region: upper(region),
          ...parseRange(from, to),
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_observer_summary",
    {
      title: "Get public observer activity summary",
      description:
        "Rank observers by observation, packet, logical packet, and heard-node counts with median RSSI/SNR.",
      inputSchema: z
        .object({
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
              observation_count: z.number().int().nonnegative(),
              unique_packets: z.number().int().nonnegative(),
              logical_packet_count: z.number().int().nonnegative(),
              node_count: z.number().int().nonnegative(),
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
    async ({ region, from, to }) =>
      toolResult(
        policy,
        "get_observer_summary",
        query.getObserverSummary({
          region: upper(region),
          ...parseRange(from, to),
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_node_summary",
    {
      title: "Get public node activity summary",
      description:
        "Rank nodes by sighting observations, distinct observers, and logical packets with median RSSI/SNR.",
      inputSchema: z
        .object({
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          role: z.string().min(1).max(32).optional(),
          min_observations: z.number().int().min(1).max(1_000_000).optional(),
          ...timeInput,
        })
        .strict(),
      outputSchema: envelope(
        z.array(
          z
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
            .strict(),
        ),
      ),
      annotations,
    },
    async ({ region, role, min_observations, from, to }) =>
      toolResult(
        policy,
        "get_node_summary",
        query.getNodeSummary({
          region: upper(region),
          role: upper(role),
          minObservations: min_observations,
          ...parseRange(from, to),
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_topology",
    {
      title: "Get observed network topology",
      description:
        "Return directed node-to-node edges derived from resolved packet paths, TRACE hops, and neighbor snapshots. Edges are observed evidence, not absolute truth; each edge carries evidence types, observation counts, timing, median SNR, and an evidence-strength confidence.",
      inputSchema: z
        .object({
          region: z
            .string()
            .regex(/^[A-Za-z]{3}$/)
            .optional(),
          evidence_types: z
            .array(z.enum(["path", "trace", "neighbor"]))
            .min(1)
            .max(3)
            .optional(),
          ...timeInput,
        })
        .strict(),
      outputSchema: envelope(
        z
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
          .strict(),
      ),
      annotations,
    },
    async ({ region, evidence_types, from, to }) =>
      toolResult(
        policy,
        "get_topology",
        query.getTopology({
          region: upper(region),
          evidenceTypes: evidence_types,
          ...parseRange(from, to),
        }),
      ),
  );

  registerPublicTool(
    server,
    registry,
    "get_schema",
    {
      title: "Get the public data dictionary",
      description:
        "Describe node roles, packet and message types, decode statuses, metric units, regions, views, count and timestamp semantics, filter dimensions, and pagination limits.",
      inputSchema: z.object({}).strict(),
      outputSchema: envelope(
        z
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
            pagination: z
              .object({
                default_page_size: z.number().int().positive(),
                max_page_size: z.number().int().positive(),
                max_timeseries_buckets: z.number().int().positive(),
                default_summary_window_seconds: z.number().int().positive(),
              })
              .strict(),
            result_statuses: z.array(z.string()),
          })
          .strict(),
      ),
      annotations,
    },
    async () => toolResult(policy, "get_schema", query.getSchemaDictionary()),
  );
}
