import { randomUUID } from "node:crypto";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  LATEST_PROTOCOL_VERSION,
  McpServer,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { McpConfig, StorageConfig } from "./config.js";
import type { ApplicationDatabase } from "./database.js";
import { getModuleLogger } from "./logger.js";
import type { HttpRouteHandler } from "./web-server.js";
import { PublicMcpQueryService } from "./mcp-public-query.js";
import { registerPublicMcpCoreTools } from "./mcp-core-tools.js";

const log = getModuleLogger("McpV2");
const SERVER_NAME = "meshcore-mqtt-broker-public";
const SERVER_VERSION = "1.0.0";

const capabilitiesSchema = z
  .object({
    server_version: z.string(),
    mcp_version: z.string(),
    public_access: z.literal(true),
    authentication_required: z.literal(false),
    read_only: z.literal(true),
    storage_available: z.boolean(),
    retention_days: z.number().int().positive(),
    supports_observers: z.boolean(),
    supports_nodes: z.boolean(),
    supports_packets: z.boolean(),
    supports_packet_observations: z.boolean(),
    supports_adverts: z.boolean(),
    supports_neighbors: z.boolean(),
    supports_paths: z.boolean(),
    supports_traces: z.boolean(),
    supports_telemetry: z.boolean(),
    supports_messages: z.boolean(),
    supports_raw_packet_bytes: z.boolean(),
  })
  .strict();

export interface PublicMcpServerOptions {
  database: ApplicationDatabase;
  storage: StorageConfig;
  config: McpConfig;
}

function result(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export function createPublicMcpServer(
  options: PublicMcpServerOptions,
): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  const query = new PublicMcpQueryService(
    options.database,
    options.storage,
    options.config,
  );

  server.registerTool(
    "get_capabilities",
    {
      title: "Get public MCP capabilities",
      description:
        "Describe the public, anonymous, read-only MeshCore history interface.",
      inputSchema: z.object({}).strict(),
      outputSchema: capabilitiesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () =>
      result({
        server_version: SERVER_VERSION,
        mcp_version: LATEST_PROTOCOL_VERSION,
        public_access: true,
        authentication_required: false,
        read_only: true,
        storage_available: Boolean(options.database),
        retention_days: options.storage.retentionDays,
        supports_observers: true,
        supports_nodes: true,
        supports_packets: true,
        supports_packet_observations: true,
        supports_adverts: true,
        supports_neighbors: false,
        supports_paths: false,
        supports_traces: false,
        supports_telemetry: false,
        supports_messages: false,
        supports_raw_packet_bytes: true,
      }),
  );

  registerPublicMcpCoreTools(server, query, options.config);

  return server;
}

export interface PublicMcpHttpRuntime {
  routeHandler: HttpRouteHandler;
  close: () => Promise<void>;
}

export function createPublicMcpHttpRuntime(
  options: PublicMcpServerOptions,
): PublicMcpHttpRuntime {
  const handler: McpHttpHandler = createMcpHandler(
    () => createPublicMcpServer(options),
    {
      legacy: "stateless",
      onerror: (error) => {
        log.warn("Public MCP request failed", {
          requestId: randomUUID(),
          errorCode: "mcp_protocol_error",
          message: error.name,
        });
      },
    },
  );
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => {
      log.warn("Public MCP HTTP adapter failed", {
        requestId: randomUUID(),
        errorCode: "mcp_http_error",
        message: error.name,
      });
    },
  });

  const routeHandler: HttpRouteHandler = async (request, response, url) => {
    if (url.pathname !== options.config.path) return false;
    await nodeHandler(request, response);
    return true;
  };

  return {
    routeHandler,
    close: () => handler.close(),
  };
}
