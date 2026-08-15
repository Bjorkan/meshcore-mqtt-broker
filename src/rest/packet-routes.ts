import { z } from "zod/v4";
import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import { packetDetailSchema } from "../mcp-tool-common.js";
import {
  logicalPacketItemSchema,
  observationItemSchema,
  rawPacketItemSchema,
} from "./dto-schemas.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import { envelopeSchema, registerListRoute, sendRest } from "./helpers.js";
import {
  jsonSchema,
  logicalPacketIdParams,
  packetHashParams,
  packetSearchQuery,
} from "./query-schemas.js";

export interface ResourceRouteDependencies {
  query: PublicMcpQueryService;
  policy: PublicMcpDataPolicy;
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
    from: parseTime(input.from),
    to: parseTime(input.to),
    limit: input.limit as number | undefined,
    cursor: input.cursor as string | undefined,
  };
}

const pathDetailSchema = z
  .object({
    packet_hash: z.string(),
    observation_id: z.number(),
    raw_path: z.string(),
    hop_count: z.number(),
    received_at: z.string(),
    hops: z.array(
      z
        .object({
          index: z.number(),
          prefix: z.string(),
          prefix_length_bytes: z.number(),
          resolved_public_key: z.string().nullable(),
          resolution_status: z.string(),
          confidence: z.number().nullable(),
          candidates: z.array(
            z
              .object({
                public_key: z.string(),
                name: z.string().nullable(),
                role: z.string().nullable(),
                latitude: z.number().nullable(),
                longitude: z.number().nullable(),
                confidence: z.number(),
                evidence_count: z.number(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export function registerPacketRoutes(
  app: RestFastifyInstance,
  deps: ResourceRouteDependencies,
): void {
  const { query, policy } = deps;

  registerListRoute(app, policy, {
    path: "/api/v2/packets",
    tags: ["packets"],
    summary: "Search logical packets (default) or raw packet instances",
    querystring: packetSearchQuery,
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
          200: jsonSchema(envelopeSchema(z.array(logicalPacketItemSchema))),
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
      return sendRest(policy, reply, result);
    },
  );

  registerListRoute(app, policy, {
    path: "/api/v2/packets/:logicalPacketId/raw-packets",
    tags: ["packets"],
    summary: "Expand one logical packet to its raw packet instances",
    params: logicalPacketIdParams,
    querystring: z
      .object({
        limit: z.coerce.number().int().min(1).max(250).optional(),
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

  registerListRoute(app, policy, {
    path: "/api/v2/raw-packets/:packetHash/observations",
    tags: ["packets"],
    summary: "RF observations for one raw packet",
    params: packetHashParams,
    querystring: z
      .object({
        observer_public_key: z
          .string()
          .regex(/^[0-9A-Fa-f]{64}$/)
          .optional(),
        limit: z.coerce.number().int().min(1).max(250).optional(),
        cursor: z.string().min(1).max(512).optional(),
      })
      .strict(),
    item: observationItemSchema,
    invoke: (input, params) =>
      query.getPacketObservations({
        packetHash: String(params.packetHash).toLowerCase(),
        observerPublicKey: upper(input.observer_public_key),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  app.get(
    "/api/v2/raw-packets/:packetHash/path",
    {
      schema: {
        tags: ["packets"],
        summary: "Resolved packet path with per-hop candidate sets",
        params: packetHashParams,
        querystring: jsonSchema(
          z
            .object({
              observation_id: z.coerce.number().int().positive().optional(),
            })
            .strict(),
        ),
        response: {
          200: jsonSchema(envelopeSchema(pathDetailSchema.nullable())),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { packetHash: string };
      const input = request.query as { observation_id?: number };
      const result = await query.getPacketPath({
        packetHash: params.packetHash.toLowerCase(),
        observationId: input.observation_id,
      });
      return sendRest(policy, reply, result);
    },
  );
}
