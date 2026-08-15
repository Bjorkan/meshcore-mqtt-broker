import { z } from "zod/v4";
import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import { advertSchema } from "../mcp-tool-common.js";
import { rawPacketItemSchema } from "./dto-schemas.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import { envelopeSchema, registerListRoute, sendRest } from "./helpers.js";
import {
  advertSearchQuery,
  jsonSchema,
  logicalAdvertIdParams,
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

function geoFilter(input: Record<string, unknown>) {
  if (
    input.lat === undefined &&
    input.lon === undefined &&
    input.radius_km === undefined &&
    input.min_lat === undefined &&
    input.max_lat === undefined &&
    input.min_lon === undefined &&
    input.max_lon === undefined
  ) {
    return undefined;
  }
  return {
    latitude: numberValue(input.lat),
    longitude: numberValue(input.lon),
    radiusKm: numberValue(input.radius_km),
    minLatitude: numberValue(input.min_lat),
    maxLatitude: numberValue(input.max_lat),
    minLongitude: numberValue(input.min_lon),
    maxLongitude: numberValue(input.max_lon),
  };
}

export function registerAdvertRoutes(
  app: RestFastifyInstance,
  deps: ResourceRouteDependencies,
): void {
  const { query, policy } = deps;

  registerListRoute(app, policy, {
    path: "/api/v2/adverts",
    tags: ["adverts"],
    summary: "Search logical adverts across all nodes",
    querystring: advertSearchQuery,
    item: advertSchema,
    invoke: (input) =>
      query.searchAdverts({
        nodePublicKey: upper(input.node_public_key),
        prefixHex: upper(input.prefix_hex),
        logicalPacketId:
          typeof input.logical_packet_id === "string"
            ? input.logical_packet_id
            : undefined,
        name: typeof input.name === "string" ? input.name : undefined,
        role: upper(input.role),
        region: upper(input.region),
        verified: input.verified as boolean | undefined,
        signatureValid: input.signature_valid as boolean | undefined,
        hasLocation: input.has_location as boolean | undefined,
        geo: geoFilter(input),
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  app.get(
    "/api/v2/adverts/:logicalAdvertId",
    {
      schema: {
        tags: ["adverts"],
        summary: "Get one logical advert",
        params: logicalAdvertIdParams,
        response: {
          200: jsonSchema(envelopeSchema(z.array(advertSchema))),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { logicalAdvertId: string };
      const result = await query.searchAdverts({
        logicalPacketId: params.logicalAdvertId,
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
    path: "/api/v2/adverts/:logicalAdvertId/raw-packets",
    tags: ["adverts"],
    summary: "Expand one logical advert to its raw packet instances",
    params: logicalAdvertIdParams,
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
        logicalPacketId: String(params.logicalAdvertId),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });
}
