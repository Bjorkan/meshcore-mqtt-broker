import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  McpServer,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { McpConfig, RegionConfig, StorageConfig } from "./config.js";
import type { ApplicationDatabase } from "./database.js";
import { getModuleLogger } from "./logger.js";
import {
  PUBLIC_MCP_PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
} from "./mcp-tool-common.js";
import type { HttpRouteHandler } from "./web-server.js";
import { PublicMcpQueryService } from "./mcp-public-query.js";
import { registerPublicMcpCoreTools } from "./mcp-core-tools.js";
import { registerPublicMcpNetworkTools } from "./mcp-network-tools.js";
import {
  PublicMcpDataPolicy,
  publicMcpToolResult,
} from "./mcp-public-policy.js";
import {
  registerPublicTool,
  PublicToolRegistry,
} from "./public-tool-registry.js";

const log = getModuleLogger("McpV2");
const MAX_MCP_REQUEST_BYTES = 1_048_576;
const MAX_CONCURRENT_MCP_REQUESTS = 32;
const MCP_BODY_READ_TIMEOUT_MS = 30_000;

const capabilitiesSchema = z
  .object({
    server_version: z.string(),
    mcp_version: z.string(),
    public_access: z.literal(true),
    authentication_required: z.literal(false),
    read_only: z.literal(true),
    storage_available: z.boolean(),
    retention_days: z.number().int().positive(),
    default_page_size: z.number().int().positive(),
    max_page_size: z.number().int().positive(),
    max_timeseries_buckets: z.number().int().positive(),
    default_summary_window_seconds: z.number().int().positive(),
    supported_buckets: z.array(z.string()),
    supported_views: z.array(z.string()),
    supported_count_modes: z.array(z.string()),
    supported_sort_fields: z.record(z.string(), z.array(z.string())),
    supported_event_types: z.array(z.string()),
    logical_packet_grouping: z.literal(true),
    logical_message_grouping: z.literal(true),
    geospatial: z.literal(true),
    batch_lookup: z.literal(true),
    supports_observers: z.boolean(),
    supports_nodes: z.boolean(),
    supports_packets: z.boolean(),
    supports_packet_observations: z.boolean(),
    supports_adverts: z.boolean(),
    supports_neighbors: z.boolean(),
    supports_paths: z.boolean(),
    supports_path_prefix_aggregation: z.boolean(),
    supports_traces: z.boolean(),
    supports_telemetry: z.boolean(),
    supports_messages: z.boolean(),
    supports_message_payload_batch: z.boolean(),
    supports_event_stream: z.boolean(),
    supports_channel_decryption: z.boolean(),
    supports_raw_packet_bytes: z.boolean(),
    supports_regions: z.literal(true),
    max_path_page_size: z.number().int().positive(),
    max_message_payload_batch_size: z.number().int().positive(),
    stateless_queries: z.literal(true),
    stateless_cursors: z.literal(true),
    cursor_version: z.number().int().positive(),
    cursor_integrity_protected: z.literal(true),
    pagination_mode: z.literal("keyset"),
    supports_snapshot_watermark: z.literal(true),
  })
  .strict();

export interface PublicMcpServerOptions {
  database: ApplicationDatabase;
  storage: StorageConfig;
  config: McpConfig;
  regions?: RegionConfig;
}

const EMPTY_REGION_CONFIG: RegionConfig = {
  whitelistEnabled: false,
  allowedPrimaryRegions: [],
  primaryEntries: {},
  secondaryEntries: {},
};

export function createPublicMcpServer(
  options: PublicMcpServerOptions,
  policy = new PublicMcpDataPolicy(),
  registry?: PublicToolRegistry,
  queryService?: PublicMcpQueryService,
): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  const query =
    queryService ??
    new PublicMcpQueryService(
      options.database,
      options.storage,
      options.config,
      Date.now,
      options.regions ?? EMPTY_REGION_CONFIG,
    );

  registerPublicTool(
    server,
    registry,
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
        ...query.capabilitiesData(),
        mcp_version: PUBLIC_MCP_PROTOCOL_VERSION,
      }),
  );

  registerPublicMcpCoreTools(server, query, options.config, policy, registry);
  registerPublicMcpNetworkTools(
    server,
    query,
    options.config,
    policy,
    registry,
  );

  return server;
}

export function createPublicToolRegistry(
  options: PublicMcpServerOptions,
  policy = new PublicMcpDataPolicy(),
  queryService?: PublicMcpQueryService,
): PublicToolRegistry {
  const registry = new PublicToolRegistry();
  createPublicMcpServer(options, policy, registry, queryService);
  return registry;
}

export interface PublicMcpHttpRuntime {
  routeHandler: HttpRouteHandler;
  close: () => Promise<void>;
}

class McpRequestBodyTooLargeError extends Error {}

class McpRequestBodyTimeoutError extends Error {}

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
  policy = new PublicMcpDataPolicy(),
  queryService?: PublicMcpQueryService,
): PublicMcpHttpRuntime {
  const handler: McpHttpHandler = createMcpHandler(
    () => createPublicMcpServer(options, policy, undefined, queryService),
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

  const routeHandler: HttpRouteHandler = async (
    request,
    response,
    url,
    preParsedBody,
  ) => {
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
          ? await (() => {
              if (preParsedBody !== undefined) {
                return Promise.resolve(preParsedBody);
              }
              const bodyPromise = readBoundedJsonBody(request);
              let timer: ReturnType<typeof setTimeout> | undefined;
              return Promise.race([
                bodyPromise,
                new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(() => {
                    if (!response.headersSent) {
                      sendSafeProtocolError(
                        response,
                        408,
                        -32603,
                        "Request body read timed out.",
                      );
                    }
                    request.destroy();
                    reject(
                      new McpRequestBodyTimeoutError(
                        "MCP request body read timed out",
                      ),
                    );
                  }, MCP_BODY_READ_TIMEOUT_MS);
                }),
              ]).finally(() => {
                if (timer !== undefined) clearTimeout(timer);
              });
            })()
          : undefined;
      await nodeHandler(request, response, parsedBody);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
      } else if (error instanceof McpRequestBodyTooLargeError) {
        sendSafeProtocolError(response, 413, -32600, "Request body too large.");
      } else if (error instanceof McpRequestBodyTimeoutError) {
        sendSafeProtocolError(
          response,
          408,
          -32603,
          "Request body read timed out.",
        );
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
