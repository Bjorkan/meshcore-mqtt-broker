import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
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
import { registerPublicMcpNetworkTools } from "./mcp-network-tools.js";
import {
  PublicMcpDataPolicy,
  publicMcpToolResult,
} from "./mcp-public-policy.js";

const log = getModuleLogger("McpV2");
const SERVER_NAME = "meshcore-mqtt-broker-public";
const SERVER_VERSION = "1.0.0";
const MAX_MCP_REQUEST_BYTES = 1_048_576;
const MAX_CONCURRENT_MCP_REQUESTS = 32;

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

export function createPublicMcpServer(
  options: PublicMcpServerOptions,
  policy = new PublicMcpDataPolicy(),
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
      publicMcpToolResult(policy, "get_capabilities", {
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
        supports_neighbors: true,
        supports_paths: true,
        supports_traces: true,
        supports_telemetry: true,
        supports_messages: true,
        supports_raw_packet_bytes: true,
      }),
  );

  registerPublicMcpCoreTools(server, query, options.config, policy);
  registerPublicMcpNetworkTools(server, query, options.config, policy);

  return server;
}

export interface PublicMcpHttpRuntime {
  routeHandler: HttpRouteHandler;
  close: () => Promise<void>;
}

class McpRequestBodyTooLargeError extends Error {}

async function readBoundedJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of request) {
    const chunk: unknown = rawChunk;
    const buffer =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk
          : undefined;
    if (!buffer) throw new SyntaxError("Invalid request body chunk");
    size += buffer.length;
    if (size > MAX_MCP_REQUEST_BYTES) {
      throw new McpRequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendSafeProtocolError(
  response: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code, message },
    }),
  );
}

export function createPublicMcpHttpRuntime(
  options: PublicMcpServerOptions,
): PublicMcpHttpRuntime {
  const policy = new PublicMcpDataPolicy();
  const handler: McpHttpHandler = createMcpHandler(
    () => createPublicMcpServer(options, policy),
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
  let activeRequests = 0;

  const routeHandler: HttpRouteHandler = async (request, response, url) => {
    if (url.pathname !== options.config.path) return false;
    if (activeRequests >= MAX_CONCURRENT_MCP_REQUESTS) {
      sendSafeProtocolError(
        response,
        503,
        -32603,
        "Public MCP concurrency limit reached.",
      );
      return true;
    }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_MCP_REQUEST_BYTES
    ) {
      sendSafeProtocolError(response, 413, -32600, "Request body too large.");
      return true;
    }
    activeRequests += 1;
    try {
      const parsedBody =
        request.method === "POST"
          ? await readBoundedJsonBody(request)
          : undefined;
      await nodeHandler(request, response, parsedBody);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
      } else if (error instanceof McpRequestBodyTooLargeError) {
        sendSafeProtocolError(response, 413, -32600, "Request body too large.");
      } else if (error instanceof SyntaxError) {
        sendSafeProtocolError(response, 400, -32700, "Parse error.");
      } else {
        log.warn("Public MCP request handling failed", {
          requestId: randomUUID(),
          errorCode: "mcp_request_failed",
          message: error instanceof Error ? error.name : "UnknownError",
        });
        sendSafeProtocolError(response, 500, -32603, "Internal MCP error.");
      }
    } finally {
      activeRequests -= 1;
    }
    return true;
  };

  return {
    routeHandler,
    close: () => handler.close(),
  };
}
