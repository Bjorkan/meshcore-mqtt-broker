import { z } from "zod/v4";
import { timestampSchema } from "../mcp-tool-common.js";
import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import {
  activityBucketSchema,
  dataQualityDataSchema,
  nodeSignalSummaryRowSchema,
  nodeSummaryRowSchema,
  observerSummaryRowSchema,
  packetTypeSummaryRowSchema,
  processingErrorRowSchema,
  telemetryRowSchema,
  topologyDataSchema,
  traceDetailDataSchema,
  traceSummarySchema,
} from "./dto-schemas.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import { envelopeSchema, registerListRoute, sendRest } from "./helpers.js";
import { jsonSchema, publicKeyParams } from "./query-schemas.js";

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

const tracesQuery = z
  .object({
    source_node_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    observer_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    tag: z.string().min(1).max(100).optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

const telemetrySearchQuery = z
  .object({
    node_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    metric: z.string().min(1).max(200).optional(),
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

const neighborSearchQuery = z
  .object({
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    observer_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    neighbor_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    min_snr: z.coerce.number().min(-100).max(100).optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

const activityQuery = z
  .object({
    from: timestampSchema,
    to: timestampSchema,
    bucket: z.enum(["minute", "hour", "day"]),
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    observer_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

const summaryQuery = z
  .object({
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
  })
  .strict();

const nodeSummaryQuery = z
  .object({
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    role: z.string().min(1).max(32).optional(),
    min_observations: z.coerce.number().int().min(1).max(1_000_000).optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
  })
  .strict();

const nodeSignalQuery = z
  .object({
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
  })
  .strict();

const topologyQuery = z
  .object({
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    evidence_types: z.string().min(1).max(64).optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
  })
  .strict();

const processingErrorsQuery = z
  .object({
    stage: z.string().min(1).max(64).optional(),
    code: z.string().min(1).max(100).optional(),
    packet_hash: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    observer_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

const traceIdParams = {
  type: "object",
  required: ["traceId"],
  properties: { traceId: { type: "integer", minimum: 1 } },
} as const;

const BUCKET_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

export function registerAnalysisRoutes(
  app: RestFastifyInstance,
  deps: ResourceRouteDependencies,
): void {
  const { query, policy } = deps;

  registerListRoute(app, policy, {
    path: "/api/v2/traces",
    tags: ["traces"],
    summary: "Search TRACE events",
    querystring: tracesQuery,
    item: traceSummarySchema,
    invoke: (input) =>
      query.searchTraces({
        sourceNodePublicKey: upper(input.source_node_public_key),
        observerPublicKey: upper(input.observer_public_key),
        tag: typeof input.tag === "string" ? input.tag : undefined,
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  app.get(
    "/api/v2/traces/:traceId",
    {
      schema: {
        tags: ["traces"],
        summary: "Get one TRACE event with diagnostic payload hops",
        params: traceIdParams,
        response: {
          200: jsonSchema(envelopeSchema(traceDetailDataSchema.nullable())),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { traceId: number };
      const trace = await query.getTrace(Number(params.traceId));
      return sendRest(
        policy,
        reply,
        trace ?? {
          data: null,
          meta: {},
          status: "not_found",
          reason: "entity_not_found",
        },
      );
    },
  );

  registerListRoute(app, policy, {
    path: "/api/v2/telemetry",
    tags: ["telemetry"],
    summary: "Search telemetry values across nodes",
    querystring: telemetrySearchQuery,
    item: telemetryRowSchema,
    invoke: (input) =>
      query.searchTelemetry({
        nodePublicKey: upper(input.node_public_key),
        metric: typeof input.metric === "string" ? input.metric : undefined,
        region: upper(input.region),
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  registerListRoute(app, policy, {
    path: "/api/v2/neighbors",
    tags: ["neighbors"],
    summary: "Global neighbor entry search across observers",
    querystring: neighborSearchQuery,
    item: z
      .object({
        observer_public_key: z.string(),
        neighbor_public_key: z.string(),
        region: z.string(),
        snapshot_timestamp: z.string(),
        reported_timestamp: z.string().nullable(),
        mqtt_retained: z.boolean(),
        snr: z.number().nullable(),
        rssi: z.number().nullable(),
        heard_secs_ago: z.number().nullable(),
        calculated_last_heard_at: z.string().nullable(),
        status: z.string(),
        scopes: z.array(z.string()),
      })
      .strict(),
    invoke: (input) =>
      query.searchNeighbors({
        region: upper(input.region),
        observerPublicKey: upper(input.observer_public_key),
        neighborPublicKey: upper(input.neighbor_public_key),
        minSnr: numberValue(input.min_snr),
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  app.get(
    "/api/v2/nodes/:publicKey/signals",
    {
      schema: {
        tags: ["signals"],
        summary: "Per-observer signal summary for one node",
        params: publicKeyParams,
        querystring: jsonSchema(nodeSignalQuery),
        response: {
          200: jsonSchema(envelopeSchema(z.array(nodeSignalSummaryRowSchema))),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { publicKey: string };
      const input = request.query as {
        region?: string;
        from?: string;
        to?: string;
      };
      const result = await query.getNodeSignalSummary({
        nodePublicKey: params.publicKey.toUpperCase(),
        region: upper(input.region),
        from: parseTime(input.from),
        to: parseTime(input.to),
      });
      return sendRest(policy, reply, result);
    },
  );

  registerListRoute(app, policy, {
    path: "/api/v2/activity",
    tags: ["activity"],
    summary: "Bounded activity timeseries with logical counts",
    querystring: activityQuery,
    item: activityBucketSchema,
    invoke: (input) =>
      query.getActivityTimeseries({
        from: Date.parse(String(input.from)),
        to: Date.parse(String(input.to)),
        bucketMs: BUCKET_MS[String(input.bucket)] ?? 3_600_000,
        observerPublicKey: upper(input.observer_public_key),
        region: upper(input.region),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });

  app.get(
    "/api/v2/network/topology",
    {
      schema: {
        tags: ["network"],
        summary: "Observed network topology with evidence and confidence",
        querystring: jsonSchema(topologyQuery),
        response: {
          200: jsonSchema(envelopeSchema(topologyDataSchema)),
        },
      },
    },
    async (request, reply) => {
      const input = request.query as {
        region?: string;
        evidence_types?: string;
        from?: string;
        to?: string;
      };
      const evidenceTypes = input.evidence_types
        ? input.evidence_types
            .split(",")
            .filter((value) => ["path", "trace", "neighbor"].includes(value))
        : undefined;
      const result = await query.getTopology({
        region: upper(input.region),
        evidenceTypes:
          evidenceTypes && evidenceTypes.length > 0
            ? (evidenceTypes as Array<"path" | "trace" | "neighbor">)
            : undefined,
        from: parseTime(input.from),
        to: parseTime(input.to),
      });
      return sendRest(policy, reply, result);
    },
  );

  registerListRoute(app, policy, {
    path: "/api/v2/network/packet-types",
    tags: ["network"],
    summary: "Rank packet types by logical, raw, and observation counts",
    querystring: summaryQuery,
    item: packetTypeSummaryRowSchema,
    invoke: (input) =>
      query.getPacketTypeSummary({
        region: upper(input.region),
        from: parseTime(input.from),
        to: parseTime(input.to),
      }),
  });

  registerListRoute(app, policy, {
    path: "/api/v2/observers/summary",
    tags: ["summary"],
    summary: "Rank observers by activity",
    querystring: summaryQuery,
    item: observerSummaryRowSchema,
    invoke: (input) =>
      query.getObserverSummary({
        region: upper(input.region),
        from: parseTime(input.from),
        to: parseTime(input.to),
      }),
  });

  registerListRoute(app, policy, {
    path: "/api/v2/nodes/summary",
    tags: ["summary"],
    summary: "Rank nodes by sightings and logical packets",
    querystring: nodeSummaryQuery,
    item: nodeSummaryRowSchema,
    invoke: (input) =>
      query.getNodeSummary({
        region: upper(input.region),
        role: upper(input.role),
        minObservations: numberValue(input.min_observations),
        from: parseTime(input.from),
        to: parseTime(input.to),
      }),
  });

  app.get(
    "/api/v2/data-quality",
    {
      schema: {
        tags: ["data-quality"],
        summary: "Data-quality counters over the reported window",
        querystring: jsonSchema(summaryQuery),
        response: {
          200: jsonSchema(envelopeSchema(dataQualityDataSchema)),
        },
      },
    },
    async (request, reply) => {
      const input = request.query as {
        region?: string;
        from?: string;
        to?: string;
      };
      const result = await query.getDataQualitySummary({
        region: upper(input.region),
        from: parseTime(input.from),
        to: parseTime(input.to),
      });
      return sendRest(policy, reply, result);
    },
  );

  registerListRoute(app, policy, {
    path: "/api/v2/processing-errors",
    tags: ["data-quality"],
    summary: "Sanitized processing and decode diagnostics",
    querystring: processingErrorsQuery,
    item: processingErrorRowSchema,
    invoke: (input) =>
      query.searchProcessingErrors({
        stage: typeof input.stage === "string" ? input.stage : undefined,
        code: typeof input.code === "string" ? input.code : undefined,
        packetHash:
          typeof input.packet_hash === "string"
            ? input.packet_hash.toLowerCase()
            : undefined,
        observerPublicKey: upper(input.observer_public_key),
        region: upper(input.region),
        from: parseTime(input.from),
        to: parseTime(input.to),
        limit: input.limit as number | undefined,
        cursor: input.cursor as string | undefined,
      }),
  });
}
