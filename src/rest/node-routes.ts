import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { McpConfig } from "../config.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import { advertSchema, nodeDetailSchema } from "../mcp-tool-common.js";
import {
  nodeRowSchema,
  nodeTelemetryRowSchema,
  positionHistoryRowSchema,
  sightingRowSchema,
} from "./dto-schemas.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import { envelopeSchema, registerListRoute, sendRest } from "./helpers.js";
import {
  jsonSchema,
  nodeListQuery,
  publicKeyParams,
  sightingsQuery,
  telemetryQuery,
  timePageQuery,
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

export function registerNodeRoutes(
  app: RestFastifyInstance,
  deps: ResourceRouteDependencies,
): void {
  const { query, policy, config } = deps;

  registerListRoute(app, policy, {
    path: "/api/v2/nodes",
    tags: ["nodes"],
    summary: "List nodes with geospatial and activity filters",
    querystring: nodeListQuery(config.maxLimit),
    item: nodeRowSchema,
    invoke: (input) =>
      query.listNodes({
        role: upper(input.role),
        name: typeof input.name === "string" ? input.name : undefined,
        publicKey: upper(input.public_key),
        region: upper(input.region),
        activeSince: parseTime(input.active_since),
        geo: geoFilter(input),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  app.get(
    "/api/v2/nodes/:publicKey",
    {
      schema: {
        tags: ["nodes"],
        summary: "Get one node",
        params: publicKeyParams,
        response: {
          200: jsonSchema(envelopeSchema(nodeDetailSchema.nullable())),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { publicKey: string };
      const node = await query.getNode(params.publicKey.toUpperCase());
      return sendRest(
        policy,
        reply,
        node ?? {
          data: null,
          meta: {},
          status: "not_found",
          reason: "entity_not_found",
        },
      );
    },
  );

  registerListRoute(app, policy, {
    path: "/api/v2/nodes/:publicKey/adverts",
    tags: ["nodes"],
    summary: "Logical advert history for one node",
    params: publicKeyParams,
    querystring: timePageQuery(config.maxLimit),
    item: advertSchema,
    invoke: (input, params) =>
      query.getNodeAdverts({
        publicKey: String(params.publicKey).toUpperCase(),
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  registerListRoute(app, policy, {
    path: "/api/v2/nodes/:publicKey/sightings",
    tags: ["nodes"],
    summary: "Observer sightings for one node",
    params: publicKeyParams,
    querystring: sightingsQuery(config.maxLimit),
    item: sightingRowSchema,
    invoke: (input, params) =>
      query.getNodeSightings({
        nodePublicKey: String(params.publicKey).toUpperCase(),
        observerPublicKey: upper(input.observer_public_key),
        region: upper(input.region),
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  registerListRoute(app, policy, {
    path: "/api/v2/nodes/:publicKey/telemetry",
    tags: ["nodes"],
    summary: "Telemetry history for one node",
    params: publicKeyParams,
    querystring: telemetryQuery(config.maxLimit),
    item: nodeTelemetryRowSchema,
    invoke: (input, params) =>
      query.getTelemetry({
        nodePublicKey: String(params.publicKey).toUpperCase(),
        metric: typeof input.metric === "string" ? input.metric : undefined,
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  registerListRoute(app, policy, {
    path: "/api/v2/nodes/:publicKey/positions",
    tags: ["nodes"],
    summary: "Deduplicated logical-advert positions for one node",
    params: publicKeyParams,
    querystring: timePageQuery(config.maxLimit),
    item: positionHistoryRowSchema,
    invoke: (input, params) =>
      query.getNodePositionHistory({
        publicKey: String(params.publicKey).toUpperCase(),
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });
}
