import { z } from "zod/v4";
import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import { regionEntrySchema } from "./dto-schemas.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import { envelopeSchema, registerListRoute, sendRest } from "./helpers.js";
import {
  jsonSchema,
  regionParams,
  regionSummaryQuery,
} from "./query-schemas.js";

export interface ResourceRouteDependencies {
  query: PublicMcpQueryService;
  policy: PublicMcpDataPolicy;
}

export function registerRegionRoutes(
  app: RestFastifyInstance,
  deps: ResourceRouteDependencies,
): void {
  const { query, policy } = deps;

  registerListRoute(app, policy, {
    path: "/api/v2/regions",
    tags: ["regions"],
    summary: "List configured or observed IATA regions",
    querystring: z.object({}).strict(),
    item: regionEntrySchema,
    invoke: () => query.listRegions(),
  });

  app.get(
    "/api/v2/regions/:region",
    {
      schema: {
        tags: ["regions"],
        summary: "Get one IATA region",
        params: regionParams,
        response: {
          200: jsonSchema(envelopeSchema(regionEntrySchema)),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { region: string };
      const regions = await query.listRegions();
      const entries = Array.isArray(regions.data) ? regions.data : [];
      const match = (entries as Array<{ code: string }>).find(
        (entry) => entry.code === params.region.toUpperCase(),
      );
      return sendRest(
        policy,
        reply,
        match
          ? { data: match, meta: regions.meta }
          : {
              data: null,
              meta: regions.meta,
              status: "not_found",
              reason: "region_not_found",
            },
      );
    },
  );

  app.get(
    "/api/v2/regions/:region/summary",
    {
      schema: {
        tags: ["regions"],
        summary: "Per-region activity summary",
        params: regionParams,
        querystring: jsonSchema(regionSummaryQuery),
        response: {
          200: jsonSchema(
            envelopeSchema(
              z
                .object({
                  code: z.string(),
                  code_system: z.literal("IATA"),
                  name: z.string().nullable(),
                  is_allowed: z.boolean(),
                  window_from: z.string(),
                  window_to: z.string(),
                  observer_count: z.number(),
                  active_observers: z.number(),
                  node_count: z.number(),
                  repeater_count: z.number(),
                  unique_packets: z.number(),
                  logical_packet_count: z.number(),
                  logical_advert_count: z.number(),
                  message_count: z.number(),
                  last_activity_at: z.string().nullable(),
                })
                .strict(),
            ),
          ),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { region: string };
      const { from, to } = request.query as {
        from?: string;
        to?: string;
      };
      const result = await query.getRegionSummary({
        region: params.region.toUpperCase(),
        from: from === undefined ? undefined : Date.parse(from),
        to: to === undefined ? undefined : Date.parse(to),
      });
      return sendRest(policy, reply, result);
    },
  );
}
