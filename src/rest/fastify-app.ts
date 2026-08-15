import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server as HttpServer,
} from "node:http";
import { randomUUID } from "node:crypto";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { McpConfig } from "../config.js";
import { getModuleLogger } from "../logger.js";
import type { PublicMcpQueryService } from "../mcp-public-query.js";
import type { PublicMcpDataPolicy } from "../mcp-public-policy.js";
import { PublicQueryInputError } from "../public-query-errors.js";
import { PublicMcpSanitizationError } from "../mcp-public-policy.js";
import type { HttpRouteHandler } from "../web-server.js";
import { registerSystemRoutes } from "./system-routes.js";

const log = getModuleLogger("RestFastify");

const HTTP_REQUEST_TIMEOUT_MS = 30_000;
const HTTP_HEADERS_TIMEOUT_MS = 15_000;
const HTTP_KEEP_ALIVE_TIMEOUT_MS = 5_000;
const MAX_REQUEST_BYTES = 1_048_576;

export type RestFastifyInstance = FastifyInstance<
  HttpServer,
  IncomingMessage,
  ServerResponse
>;

export interface FastifyAppDependencies {
  query: PublicMcpQueryService;
  policy: PublicMcpDataPolicy;
  config: McpConfig;
  httpServer?: HttpServer;
  mcpHandler?: HttpRouteHandler;
  toolApiHandler?: HttpRouteHandler;
  apiHandler: HttpRouteHandler;
  dashboardHandler: HttpRouteHandler;
}

function serverFactory(
  httpServer: HttpServer | undefined,
): (
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) => HttpServer {
  if (httpServer) {
    return (handler) => {
      httpServer.on("request", handler);
      return httpServer;
    };
  }
  return (handler) => {
    const server = createServer(handler);
    server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
    server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
    server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
    return server;
  };
}

export async function createFastifyApp(
  deps: FastifyAppDependencies,
): Promise<RestFastifyInstance> {
  const app = Fastify<HttpServer, IncomingMessage, ServerResponse>({
    serverFactory: serverFactory(deps.httpServer),
    bodyLimit: MAX_REQUEST_BYTES,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    ajv: {
      customOptions: { removeAdditional: false },
    },
  });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/v2")) {
      reply.header("cache-control", "no-store");
    }
    return payload;
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "MeshCore MQTT Broker Public REST API",
        description:
          "Public, anonymous, read-only REST access to the same normalized MeshCore history used by the MCP endpoint. No credentials are accepted or required.",
        version: "2.0.0",
      },
      tags: [
        {
          name: "system",
          description: "System, capability, and discovery resources",
        },
      ],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/api/v2/docs",
    uiConfig: {
      deepLinking: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
      supportedSubmitMethods: ["get"],
    },
  });

  app.get(
    "/api/v2/openapi.json",
    { schema: { hide: true } },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");
      return app.swagger();
    },
  );

  registerSystemRoutes(app, {
    query: deps.query,
    policy: deps.policy,
    config: deps.config,
  });

  app.setErrorHandler((error, request, reply) => {
    if (reply.sent) return;
    if (error instanceof PublicQueryInputError) {
      return reply.code(400).send({
        status: "invalid_request",
        reason: error.reason,
        message: error.message,
      });
    }
    const fastifyError = error as { statusCode?: number };
    if (fastifyError.statusCode === 400) {
      return reply.code(400).send({
        status: "invalid_request",
        reason: "invalid_arguments",
        message: "The request does not match the public REST API schema.",
      });
    }
    if (fastifyError.statusCode === 413) {
      return reply.code(413).send({
        status: "invalid_request",
        reason: "request_too_large",
        message: "Request body too large.",
      });
    }
    if (fastifyError.statusCode === 415) {
      return reply.code(415).send({
        status: "invalid_request",
        reason: "unsupported_media_type",
        message: "The request content type is not supported.",
      });
    }
    if (error instanceof PublicMcpSanitizationError) {
      log.warn("Public REST output could not be sanitized", {
        requestId: request.id,
        errorCode: "rest_output_sanitization_failed",
      });
      return reply.code(500).send({
        status: "internal_error",
        message: "The public result could not be returned safely.",
      });
    }
    log.warn("Public REST request failed safely", {
      requestId: request.id,
      errorCode: "rest_request_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return reply.code(500).send({
      status: "internal_error",
      message: "The requested resource could not be returned safely.",
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.hijack();
    void (async () => {
      let url: URL;
      try {
        url = new URL(request.raw.url || "/", "http://localhost");
      } catch {
        reply.raw.writeHead(400, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        reply.raw.end(
          JSON.stringify({
            status: "invalid_request",
            reason: "invalid_url",
            message: "The request URL could not be parsed.",
          }),
        );
        return;
      }
      const isRestPath = url.pathname.startsWith("/api/v2");
      if (!isRestPath) {
        const handlers = [
          deps.mcpHandler,
          deps.toolApiHandler,
          deps.apiHandler,
          deps.dashboardHandler,
        ].filter(
          (handler): handler is HttpRouteHandler => handler !== undefined,
        );
        for (const handler of handlers) {
          if (await handler(request.raw, reply.raw, url, request.body)) return;
        }
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        const knownGetRoute =
          isRestPath && app.hasRoute({ method: "GET", url: url.pathname });
        if (knownGetRoute || !isRestPath) {
          const isApiRequest =
            knownGetRoute || url.pathname.startsWith("/api/");
          reply.raw.writeHead(405, {
            allow: "GET, HEAD",
            ...(isApiRequest
              ? {
                  "content-type": "application/json; charset=utf-8",
                  "cache-control": "no-store",
                }
              : {}),
          });
          reply.raw.end(
            isApiRequest
              ? JSON.stringify({
                  status: "invalid_request",
                  reason: "method_not_allowed",
                  message: "Only GET and HEAD requests are supported here.",
                })
              : undefined,
          );
          return;
        }
      }
      const isApiRequest = isRestPath || url.pathname.startsWith("/api/");
      reply.raw.writeHead(404, {
        ...(isApiRequest
          ? {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            }
          : {}),
      });
      reply.raw.end(
        isApiRequest
          ? JSON.stringify({
              status: "not_found",
              message: "REST route not found.",
            })
          : undefined,
      );
    })().catch((error) => {
      log.warn("Public REST fallback failed", {
        requestId: request.id,
        errorCode: "rest_fallback_failed",
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      if (reply.raw.headersSent) {
        reply.raw.destroy();
        return;
      }
      reply.raw.writeHead(503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      reply.raw.end(
        JSON.stringify({
          status: "service_unavailable",
          message: "The requested service is temporarily unavailable.",
        }),
      );
    });
  });

  return app;
}
