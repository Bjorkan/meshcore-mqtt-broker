import { z } from "zod/v4";
import type { PublicMcpQueryService } from "../mcp-public-query.js";
import { PublicQueryInputError } from "../public-query-errors.js";
import type { McpConfig } from "../config.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import { observerDetailSchema } from "../mcp-tool-common.js";
import {
  observerRowSchema,
  signalBucketSchema,
  statusHistoryRowSchema,
} from "./dto-schemas.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import {
  envelopeSchema,
  registerListRoute,
  sendRest,
  type RestEnvelope,
} from "./helpers.js";
import {
  jsonSchema,
  neighborsQuery,
  observerListQuery,
  publicKeyParams,
  signalQuery,
  timePageQuery,
} from "./query-schemas.js";

export interface ResourceRouteDependencies {
  query: PublicMcpQueryService;
  policy: PublicMcpDataPolicy;
  config: McpConfig;
}

const BUCKET_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

function upper(value: unknown): string | undefined {
  return typeof value === "string" ? value.toUpperCase() : undefined;
}

function parseTime(value: unknown): number | undefined {
  return typeof value === "string" ? Date.parse(value) : undefined;
}

const observerNeighborDataSchema = z
  .object({
    observer_public_key: z.string(),
    snapshot_timestamp: z.string(),
    reported_timestamp: z.string().nullable(),
    mqtt_retained: z.boolean(),
    observer_scopes: z.array(z.string()),
    neighbors: z.array(
      z
        .object({
          public_key: z.string(),
          snr: z.number().nullable(),
          rssi: z.number().nullable(),
          heard_secs_ago: z.number().nullable(),
          calculated_last_heard_at: z.string().nullable(),
          status: z.string(),
          scopes: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

export function registerObserverRoutes(
  app: RestFastifyInstance,
  deps: ResourceRouteDependencies,
): void {
  const { query, policy, config } = deps;

  registerListRoute(app, policy, {
    path: "/api/v2/observers",
    tags: ["observers"],
    summary: "List observers with neighbor-data availability",
    querystring: observerListQuery(config.maxLimit),
    item: observerRowSchema,
    invoke: (input) =>
      query.listObservers({
        region: upper(input.region),
        activeSince: parseTime(input.active_since),
        hasNeighborData: input.has_neighbor_data as boolean | undefined,
        sort:
          typeof input.sort === "string"
            ? {
                field: input.sort,
                order: input.order === "asc" ? "asc" : "desc",
              }
            : undefined,
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  app.get(
    "/api/v2/observers/:publicKey",
    {
      schema: {
        tags: ["observers"],
        summary: "Get one observer",
        params: publicKeyParams,
        response: {
          200: jsonSchema(envelopeSchema(observerDetailSchema.nullable())),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { publicKey: string };
      const observer = await query.getObserver(params.publicKey.toUpperCase());
      return sendRest(
        policy,
        reply,
        observer ?? {
          data: null,
          meta: {},
          status: "not_found",
          reason: "entity_not_found",
        },
      );
    },
  );

  app.get(
    "/api/v2/observers/:publicKey/status",
    {
      schema: {
        tags: ["observers"],
        summary: "Observer public status history",
        params: publicKeyParams,
        querystring: jsonSchema(timePageQuery(config.maxLimit)),
        response: {
          200: jsonSchema(envelopeSchema(z.array(statusHistoryRowSchema))),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { publicKey: string };
      const input = request.query as {
        from?: string;
        to?: string;
        limit?: number;
        cursor?: string;
      };
      const result = await query.getObserverStatusHistory({
        observerPublicKey: params.publicKey.toUpperCase(),
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit,
        cursor: input.cursor,
      });
      return sendRest(policy, reply, result);
    },
  );

  app.get(
    "/api/v2/observers/:publicKey/neighbors",
    {
      schema: {
        tags: ["observers"],
        summary: "Latest or at-time neighbor snapshot",
        params: publicKeyParams,
        querystring: jsonSchema(neighborsQuery),
        response: {
          200: jsonSchema(
            envelopeSchema(observerNeighborDataSchema.nullable()),
          ),
          400: jsonSchema(
            z
              .object({
                status: z.string(),
                reason: z.string(),
                message: z.string(),
              })
              .strict(),
          ),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { publicKey: string };
      const queryParams = request.query as { at?: string; latest?: boolean };
      if (queryParams.latest === false && queryParams.at === undefined) {
        return reply.code(400).send({
          status: "invalid_request",
          reason: "invalid_arguments",
          message: "at is required when latest is false.",
        });
      }
      const result: RestEnvelope = await query.getNeighbors({
        observerPublicKey: params.publicKey.toUpperCase(),
        at: parseTime(queryParams.at),
      });
      return sendRest(policy, reply, result);
    },
  );

  app.get(
    "/api/v2/observers/:publicKey/signals",
    {
      schema: {
        tags: ["observers"],
        summary: "Time-bucketed signal history for one observer",
        params: publicKeyParams,
        querystring: jsonSchema(signalQuery(config.maxLimit)),
        response: {
          200: jsonSchema(envelopeSchema(z.array(signalBucketSchema))),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { publicKey: string };
      const input = request.query as {
        node_public_key?: string;
        packet_type?: string;
        from?: string;
        to?: string;
        bucket?: string;
        limit?: number;
        cursor?: string;
      };
      if (
        input.cursor === undefined &&
        (input.from === undefined || input.to === undefined)
      ) {
        throw new PublicQueryInputError(
          "invalid_arguments",
          "from and to are required on the first page; continuation pages may send only the cursor.",
        );
      }
      const result = await query.getSignalHistory({
        observerPublicKey: params.publicKey.toUpperCase(),
        nodePublicKey: upper(input.node_public_key),
        packetType: upper(input.packet_type),
        from: Date.parse(String(input.from)),
        to: Date.parse(String(input.to)),
        bucketMs: BUCKET_MS[input.bucket ?? "hour"] ?? 3_600_000,
        limit: input.limit,
        cursor: input.cursor,
      });
      return sendRest(policy, reply, result);
    },
  );
}
