import type { FastifyReply } from "fastify";
import { z } from "zod/v4";
import { metaSchema, resultStatusSchema } from "../mcp-tool-common.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import { PublicQueryInputError } from "../public-query-errors.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import { jsonSchema } from "./query-schemas.js";

export interface RestEnvelope {
  data: unknown;
  meta: unknown;
  status?: string;
  reason?: string;
}

export function envelopeSchema<T extends z.ZodType>(data: T) {
  return z
    .object({
      data,
      meta: metaSchema,
      status: resultStatusSchema.optional(),
      reason: z.string().min(1).max(200).optional(),
    })
    .strict();
}

export function sendRest(
  policy: PublicMcpDataPolicy,
  reply: FastifyReply,
  result: RestEnvelope,
): FastifyReply {
  reply.header("cache-control", "no-store");
  const sanitized = policy.sanitize(result) as RestEnvelope;
  if (sanitized.status === "not_found") {
    return reply.code(404).send({
      status: "not_found",
      reason: sanitized.reason ?? "entity_not_found",
      data: null,
    });
  }
  return reply.send(sanitized);
}

export function notFoundReply(
  policy: PublicMcpDataPolicy,
  reply: FastifyReply,
  reason: string,
): FastifyReply {
  return sendRest(policy, reply, {
    data: null,
    meta: {},
    status: "not_found",
    reason,
  });
}

export function errorPayload(
  status: string,
  reason: string,
  message: string,
): Record<string, string> {
  return { status, reason, message };
}

export function reasonOf(error: unknown): string {
  if (error instanceof PublicQueryInputError) return error.reason;
  return "invalid_request";
}

export interface ListRouteOptions<T extends z.ZodType> {
  path: string;
  tags: string[];
  summary: string;
  description?: string;
  params?: Record<string, unknown>;
  querystring: z.ZodType;
  item: T;
  invoke: (
    query: Record<string, unknown>,
    params: Record<string, unknown>,
  ) => Promise<RestEnvelope>;
}

export interface DetailRouteOptions<T extends z.ZodType> {
  path: string;
  tags: string[];
  summary: string;
  description?: string;
  data: T;
  invoke: () => Promise<RestEnvelope>;
}

export function registerListRoute<T extends z.ZodType>(
  app: RestFastifyInstance,
  policy: PublicMcpDataPolicy,
  options: ListRouteOptions<T>,
): void {
  app.get(
    options.path,
    {
      schema: {
        tags: options.tags,
        summary: options.summary,
        description: options.description,
        params: options.params,
        querystring: jsonSchema(options.querystring),
        response: {
          200: jsonSchema(envelopeSchema(z.array(options.item))),
        },
      },
    },
    async (request, reply) => {
      const result = await options.invoke(
        request.query as Record<string, unknown>,
        request.params as Record<string, unknown>,
      );
      return sendRest(policy, reply, result);
    },
  );
}

export function registerDetailRoute<T extends z.ZodType>(
  app: RestFastifyInstance,
  policy: PublicMcpDataPolicy,
  options: DetailRouteOptions<T>,
): void {
  app.get(
    options.path,
    {
      schema: {
        tags: options.tags,
        summary: options.summary,
        description: options.description,
        response: {
          200: jsonSchema(envelopeSchema(options.data)),
        },
      },
    },
    async (_request, reply) => {
      const result = await options.invoke();
      return sendRest(policy, reply, result);
    },
  );
}
