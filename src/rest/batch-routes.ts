import { z } from "zod/v4";
import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import {
  nodeDetailSchema,
  observerDetailSchema,
  packetDetailSchema,
} from "../mcp-tool-common.js";
import {
  prefixResolutionDataSchema,
  traceDetailDataSchema,
} from "./dto-schemas.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import { envelopeSchema, sendRest } from "./helpers.js";
import { jsonSchema } from "./query-schemas.js";

export interface ResourceRouteDependencies {
  query: PublicMcpQueryService;
  policy: PublicMcpDataPolicy;
}

const publicKeysBody = z
  .object({
    public_keys: z
      .array(z.string().regex(/^[0-9A-Fa-f]{64}$/))
      .min(1)
      .max(50),
  })
  .strict();

const packetHashesBody = z
  .object({
    packet_hashes: z
      .array(z.string().regex(/^[0-9A-Fa-f]{64}$/))
      .min(1)
      .max(50),
  })
  .strict();

const prefixesBody = z
  .object({
    prefixes: z
      .array(z.string().regex(/^(?:[0-9A-Fa-f]{2}){1,32}$/))
      .min(1)
      .max(50),
  })
  .strict();

const traceIdsBody = z
  .object({
    trace_ids: z.array(z.number().int().positive()).min(1).max(50),
  })
  .strict();

const nodesBatchDataSchema = z
  .object({
    nodes: z.array(nodeDetailSchema),
    missing_public_keys: z.array(z.string()),
  })
  .strict();

const observersBatchDataSchema = z
  .object({
    observers: z.array(observerDetailSchema),
    missing_public_keys: z.array(z.string()),
  })
  .strict();

const packetsBatchDataSchema = z
  .object({
    packets: z.array(packetDetailSchema),
    missing_packet_hashes: z.array(z.string()),
  })
  .strict();

const prefixBatchDataSchema = z
  .object({
    resolutions: z.array(prefixResolutionDataSchema),
  })
  .strict();

const traceBatchDataSchema = z
  .object({
    traces: z.array(traceDetailDataSchema.nullable()),
    missing_trace_ids: z.array(z.number().int().positive()),
  })
  .strict();

export function registerBatchRoutes(
  app: RestFastifyInstance,
  deps: ResourceRouteDependencies,
): void {
  const { query, policy } = deps;

  app.post(
    "/api/v2/batch/nodes",
    {
      schema: {
        tags: ["batch"],
        summary: "Batch node lookup for up to 50 public keys",
        body: jsonSchema(publicKeysBody),
        response: {
          200: jsonSchema(envelopeSchema(nodesBatchDataSchema)),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { public_keys: string[] };
      const result = await query.getNodesBatch(
        body.public_keys.map((key) => key.toUpperCase()),
      );
      return sendRest(policy, reply, result);
    },
  );

  app.post(
    "/api/v2/batch/observers",
    {
      schema: {
        tags: ["batch"],
        summary: "Batch observer lookup for up to 50 public keys",
        body: jsonSchema(publicKeysBody),
        response: {
          200: jsonSchema(envelopeSchema(observersBatchDataSchema)),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { public_keys: string[] };
      const result = await query.getObserversBatch(
        body.public_keys.map((key) => key.toUpperCase()),
      );
      return sendRest(policy, reply, result);
    },
  );

  app.post(
    "/api/v2/batch/raw-packets",
    {
      schema: {
        tags: ["batch"],
        summary: "Batch raw packet lookup for up to 50 packet hashes",
        body: jsonSchema(packetHashesBody),
        response: {
          200: jsonSchema(envelopeSchema(packetsBatchDataSchema)),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { packet_hashes: string[] };
      const result = await query.getPacketsBatch(
        body.packet_hashes.map((hash) => hash.toLowerCase()),
      );
      return sendRest(policy, reply, result);
    },
  );

  app.post(
    "/api/v2/batch/prefix-resolution",
    {
      schema: {
        tags: ["batch"],
        summary: "Batch prefix resolution for up to 50 prefixes",
        body: jsonSchema(prefixesBody),
        response: {
          200: jsonSchema(envelopeSchema(prefixBatchDataSchema)),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { prefixes: string[] };
      const result = await query.resolveNodePrefixesBatch(
        body.prefixes.map((prefix) => prefix.toUpperCase()),
      );
      return sendRest(policy, reply, result);
    },
  );

  app.post(
    "/api/v2/batch/traces",
    {
      schema: {
        tags: ["batch"],
        summary: "Batch trace lookup for up to 50 trace ids",
        body: jsonSchema(traceIdsBody),
        response: {
          200: jsonSchema(envelopeSchema(traceBatchDataSchema)),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { trace_ids: number[] };
      const result = await query.getTracesBatch(body.trace_ids);
      return sendRest(policy, reply, result);
    },
  );
}
