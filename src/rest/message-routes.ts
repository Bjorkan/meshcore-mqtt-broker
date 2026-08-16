import { z } from "zod/v4";
import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { McpConfig } from "../config.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import {
  messageLogicalItemSchema,
  messageRawItemSchema,
  rawPacketItemSchema,
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
  messageIdParams,
  messageSearchQuery,
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

function searchInput(input: Record<string, unknown>) {
  return {
    view: input.view as "logical" | "raw" | undefined,
    packetHash:
      typeof input.packet_hash === "string"
        ? input.packet_hash.toLowerCase()
        : undefined,
    logicalPacketId:
      typeof input.logical_packet_id === "string"
        ? input.logical_packet_id
        : undefined,
    senderNodePublicKey: upper(input.sender_node_public_key),
    destinationNodePublicKey: upper(input.destination_node_public_key),
    messageType: upper(input.message_type),
    channel: typeof input.channel === "string" ? input.channel : undefined,
    encrypted: input.encrypted as boolean | undefined,
    signatureValid: input.signature_valid as boolean | undefined,
    region: upper(input.region),
    observerPublicKey: upper(input.observer_public_key),
    from: parseTime(input.from),
    to: parseTime(input.to),
    limit: input.limit as number | undefined,
    cursor: input.cursor as string | undefined,
  };
}

export function registerMessageRoutes(
  app: RestFastifyInstance,
  deps: ResourceRouteDependencies,
): void {
  const { query, policy, config } = deps;

  registerListRoute(app, policy, {
    path: "/api/v2/messages",
    tags: ["messages"],
    summary: "Search logical messages (default) or per-observation records",
    querystring: messageSearchQuery(config.maxLimit),
    item: z.union([messageLogicalItemSchema, messageRawItemSchema]),
    invoke: (input) => query.searchMessages(searchInput(input)),
  });

  app.get(
    "/api/v2/messages/:messageId",
    {
      schema: {
        tags: ["messages"],
        summary: "Get one stored message record",
        params: messageIdParams,
        response: {
          200: jsonSchema(
            envelopeSchema(
              z
                .object({
                  message_id: z.number(),
                  logical_message_id: z.string().nullable(),
                  message_type: z.string(),
                  channel: z.string().nullable(),
                  channel_index: z.number().nullable(),
                  sender_prefix: z.string().nullable(),
                  sender_public_key: z.string().nullable(),
                  destination_prefix: z.string().nullable(),
                  destination_public_key: z.string().nullable(),
                  encrypted: z.boolean(),
                  text: z.string().nullable(),
                  signature_valid: z.boolean().nullable(),
                  reported_at: z.string().nullable(),
                  received_at: z.string(),
                  packet_hash: z.string(),
                  raw_packet_count: z.number(),
                  observation_count: z.number(),
                  first_observed_at: z.string().nullable(),
                  last_observed_at: z.string().nullable(),
                })
                .strict()
                .nullable(),
            ),
          ),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { messageId: number };
      const message = await query.getMessage(Number(params.messageId));
      return sendRest(
        policy,
        reply,
        message ?? {
          data: null,
          meta: {},
          status: "not_found",
          reason: "entity_not_found",
        },
      );
    },
  );

  app.get(
    "/api/v2/messages/:messageId/raw-packets",
    {
      schema: {
        tags: ["messages"],
        summary: "Expand one message to its raw packet instances",
        params: messageIdParams,
        response: {
          200: jsonSchema(envelopeSchema(z.array(rawPacketItemSchema))),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { messageId: number };
      const message = await query.getMessage(Number(params.messageId));
      if (!message || message.data.logical_message_id === null) {
        const fallback: RestEnvelope = {
          data: null,
          meta: message?.meta ?? {},
          status: "not_found",
          reason: message
            ? "message_has_no_logical_identity"
            : "entity_not_found",
        };
        return sendRest(policy, reply, fallback);
      }
      const result = await query.searchPackets({
        view: "raw",
        logicalPacketId: String(message.data.logical_message_id),
        limit: 250,
      });
      return sendRest(policy, reply, result);
    },
  );
}
