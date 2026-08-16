import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { McpConfig } from "../config.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import {
  pathObservationItemSchema,
  pathPrefixItemSchema,
} from "./dto-schemas.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import { registerListRoute } from "./helpers.js";
import { pathPrefixSearchQuery, pathSearchQuery } from "./query-schemas.js";

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

function sortInput(input: Record<string, unknown>, defaultField: string) {
  return {
    field: typeof input.sort === "string" ? input.sort : defaultField,
    order: input.order === "asc" ? ("asc" as const) : ("desc" as const),
  };
}

export function registerPathRoutes(
  app: RestFastifyInstance,
  deps: ResourceRouteDependencies,
): void {
  const { query, policy, config } = deps;

  registerListRoute(app, policy, {
    path: "/api/v2/paths",
    tags: ["paths"],
    summary:
      "Search per-observation packet paths with live hop-prefix resolution",
    querystring: pathSearchQuery(config.maxLimit),
    item: pathObservationItemSchema,
    invoke: (input) =>
      query.searchPaths({
        region: upper(input.region),
        logicalPacketId:
          typeof input.logical_packet_id === "string"
            ? input.logical_packet_id
            : undefined,
        packetHash:
          typeof input.packet_hash === "string"
            ? input.packet_hash.toLowerCase()
            : undefined,
        observerPublicKey: upper(input.observer_public_key),
        containsPrefixHex: upper(input.contains_prefix_hex),
        containsNodePublicKey: upper(input.contains_node_public_key),
        minHops: numberValue(input.min_hops),
        maxHops: numberValue(input.max_hops),
        resolutionStatus:
          typeof input.resolution_status === "string"
            ? input.resolution_status
            : undefined,
        sort: sortInput(input, "received_at"),
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  registerListRoute(app, policy, {
    path: "/api/v2/path-prefixes",
    tags: ["paths"],
    summary: "Aggregate observed path prefixes with live resolution status",
    querystring: pathPrefixSearchQuery(config.maxLimit),
    item: pathPrefixItemSchema,
    invoke: (input) =>
      query.searchPathPrefixes({
        region: upper(input.region),
        prefixHex: upper(input.prefix_hex),
        resolutionStatus:
          typeof input.resolution_status === "string"
            ? input.resolution_status
            : undefined,
        minOccurrences: numberValue(input.min_occurrences),
        sort: sortInput(input, "occurrence_count"),
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });
}
