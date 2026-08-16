import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import { prefixResolutionDataSchema } from "./dto-schemas.js";
import type { RestFastifyInstance } from "./fastify-app.js";
import { envelopeSchema, sendRest } from "./helpers.js";
import { jsonSchema, prefixParams } from "./query-schemas.js";

export interface ResourceRouteDependencies {
  query: PublicMcpQueryService;
  policy: PublicMcpDataPolicy;
}

export function registerPrefixRoutes(
  app: RestFastifyInstance,
  deps: ResourceRouteDependencies,
): void {
  const { query, policy } = deps;

  app.get(
    "/api/v2/prefixes/:prefix/resolution",
    {
      schema: {
        tags: ["prefixes"],
        summary: "Resolve a MeshCore public-key prefix to explicit candidates",
        params: prefixParams,
        response: {
          200: jsonSchema(envelopeSchema(prefixResolutionDataSchema)),
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { prefix: string };
      const result = await query.resolveNodePrefix(params.prefix.toUpperCase());
      return sendRest(policy, reply, result);
    },
  );
}
