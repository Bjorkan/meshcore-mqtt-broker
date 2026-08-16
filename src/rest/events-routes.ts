import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { McpConfig } from "../config.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import { PublicQueryInputError } from "../public-query-errors.js";
import { eventItemSchema } from "./dto-schemas.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import { registerListRoute } from "./helpers.js";
import { eventsSearchQuery } from "./query-schemas.js";

export interface ResourceRouteDependencies {
  query: PublicMcpQueryService;
  policy: PublicMcpDataPolicy;
  config: McpConfig;
}

const EVENT_TYPES = new Set([
  "packet",
  "advert",
  "message",
  "trace",
  "telemetry",
  "observer_status",
]);

function upper(value: unknown): string | undefined {
  return typeof value === "string" ? value.toUpperCase() : undefined;
}

function parseTime(value: unknown): number | undefined {
  return typeof value === "string" ? Date.parse(value) : undefined;
}

export function registerEventRoutes(
  app: RestFastifyInstance,
  deps: ResourceRouteDependencies,
): void {
  const { query, policy, config } = deps;

  registerListRoute(app, policy, {
    path: "/api/v2/events",
    tags: ["events"],
    summary: "Time-ordered public event stream across all data families",
    querystring: eventsSearchQuery(config.maxLimit),
    item: eventItemSchema,
    invoke: (input) => {
      const rawTypes = input.event_types;
      const eventTypes =
        typeof rawTypes === "string"
          ? rawTypes
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0)
          : undefined;
      if (eventTypes) {
        for (const eventType of eventTypes) {
          if (!EVENT_TYPES.has(eventType)) {
            throw new PublicQueryInputError(
              "invalid_event_types",
              "event_types must be a comma-separated list of supported event types.",
            );
          }
        }
      }
      return query.searchEvents({
        region: upper(input.region),
        nodePublicKey: upper(input.node_public_key),
        observerPublicKey: upper(input.observer_public_key),
        eventTypes:
          eventTypes && eventTypes.length > 0 ? eventTypes : undefined,
        sort: {
          field: "received_at",
          order: input.order === "asc" ? ("asc" as const) : ("desc" as const),
        },
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      });
    },
  });
}
