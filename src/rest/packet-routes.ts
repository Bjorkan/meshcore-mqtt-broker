import { z } from "zod/v4";
import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { McpConfig } from "../config.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import { packetDetailSchema } from "../mcp-tool-common.js";
import { logicalPacketItemSchema, rawPacketItemSchema } from "./dto-schemas.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import { envelopeSchema, registerListRoute, sendRest } from "./helpers.js";
import {
  jsonSchema,
  logicalPacketIdParams,
  packetHashParams,
  packetSearchQuery,
  pageLimitSchema,
} from "./query-schemas.js";

export interface ResourceRouteDependencies {
  query: PublicMcpQueryService;
  policy: PublicMcpDataPolicy;
  config: McpConfig;
}

function upper(value: unknown): string | undefined {
  return typeof value === "string" ? value.toUpperCase() : undefined;
}

function parseTime(value: unknown): number | undefined {
  return typeof value === "string" ? Date.parse(value) : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function searchInput(input: Record<string, unknown>) {
  return {
    view: input.view as "logical" | "raw" | undefined,
    packetHash:
      typeof input.packet_hash === "string"
        ? input.packet_hash.toLowerCase()
        : undefined,
    logicalPacketId:
      typeof input.logical_packet_id === "string"
        ? input.logical_packet_id
        : undefined,
    observerPublicKey: upper(input.observer_public_key),
    nodePublicKey: upper(input.node_public_key),
    region: upper(input.region),
    packetType: upper(input.packet_type),
    payloadType: upper(input.payload_type),
    routeType: upper(input.route_type),
    minRssi: numberValue(input.min_rssi),
    maxRssi: numberValue(input.max_rssi),
    minSnr: numberValue(input.min_snr),
    maxSnr: numberValue(input.max_snr),
    minScore: numberValue(input.min_score),
    maxScore: numberValue(input.max_score),
    minHops: numberValue(input.min_hops),
    maxHops: numberValue(input.max_hops),
    decodeStatus:
      typeof input.decode_status === "string" ? input.decode_status : undefined,
    sort:
      typeof input.sort === "string"
        ? {
            field: input.sort,
            order: input.order === "asc" ? ("asc" as const) : ("desc" as const),
          }
        : undefined,
    from: parseTime(input.from),
    to: parseTime(input.to),
    limit: input.limit as number | undefined,
    cursor: input.cursor as string | undefined,
  };
}

export function registerPacketRoutes(
  app: RestFastifyInstance,
  deps: ResourceRouteDependencies,
): void {
  const { query, policy, config } = deps;

  registerListRoute(app, policy, {
    path: "/api/v2/packets",
    tags: ["packets"],
    summary: "Search logical packets (default) or raw packet instances",
    querystring: packetSearchQuery(config.maxLimit),
    item: z.union([logicalPacketItemSchema, rawPacketItemSchema]),
    invoke: (input) => query.searchPackets(searchInput(input)),
  });

  app.get(
    "/api/v2/packets/:logicalPacketId",
    {
      schema: {
        tags: ["packets"],
        summary: "Get one logical packet",
        params: logicalPacketIdParams,
        response: {
          200: jsonSchema(envelopeSchema(logicalPacketItemSchema.nullable())),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { logicalPacketId: string };
      const result = await query.searchPackets({
        view: "logical",
        logicalPacketId: params.logicalPacketId,
        limit: 1,
      });
      if (result.data.length === 0) {
        return sendRest(policy, reply, {
          data: null,
          meta: result.meta,
          status: "not_found",
          reason: "entity_not_found",
        });
      }
      return sendRest(policy, reply, {
        data: result.data[0],
        meta: result.meta,
      });
    },
  );

  registerListRoute(app, policy, {
    path: "/api/v2/packets/:logicalPacketId/raw-packets",
    tags: ["packets"],
    summary: "Expand one logical packet to its raw packet instances",
    params: logicalPacketIdParams,
    querystring: z
      .object({
        limit: pageLimitSchema(config.maxLimit),
        cursor: z.string().min(1).max(512).optional(),
      })
      .strict(),
    item: rawPacketItemSchema,
    invoke: (input, params) =>
      query.searchPackets({
        view: "raw",
        logicalPacketId: String(params.logicalPacketId),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  app.get(
    "/api/v2/raw-packets/:packetHash",
    {
      schema: {
        tags: ["packets"],
        summary: "Get one raw packet",
        params: packetHashParams,
        response: {
          200: jsonSchema(envelopeSchema(packetDetailSchema.nullable())),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { packetHash: string };
      const packet = await query.getPacket(params.packetHash.toLowerCase());
      return sendRest(
        policy,
        reply,
        packet ?? {
          data: null,
          meta: {},
          status: "not_found",
          reason: "entity_not_found",
        },
      );
    },
  );
}
