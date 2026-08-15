import type { FastifyReply } from "fastify";
import { z } from "zod/v4";
import { metaSchema, resultStatusSchema } from "../mcp-tool-common.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import { PublicQueryInputError } from "../public-query-errors.js";

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
