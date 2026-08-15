import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { z } from "zod/v4";
import type { DashboardSnapshot } from "./dashboard.js";
import { getModuleLogger } from "./logger.js";
import type {
  PublicToolDescription,
  PublicToolRegistry,
} from "./public-tool-registry.js";
import type { HttpRouteHandler } from "./web-server.js";

const log = getModuleLogger("API");
const require = createRequire(import.meta.url);
const swaggerDirectory = dirname(
  require.resolve("swagger-ui-dist/swagger-ui.css"),
);
const swaggerAssetNames = new Set([
  "swagger-ui.css",
  "swagger-ui-bundle.js",
  "swagger-ui-standalone-preset.js",
]);
const swaggerAssetCache = new Map<string, Buffer>();

const SWAGGER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MeshCore MQTT Broker Public Query API</title>
  <link rel="stylesheet" href="/api/docs/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/docs/swagger-ui-bundle.js"></script>
  <script src="/api/docs/swagger-ui-standalone-preset.js"></script>
  <script src="/api/docs/swagger-initializer.js"></script>
</body>
</html>`;

const SWAGGER_INITIALIZER = `window.onload = () => {
  window.ui = SwaggerUIBundle({
    url: "/api/openapi.json",
    dom_id: "#swagger-ui",
    deepLinking: true,
    displayRequestDuration: true,
    tryItOutEnabled: true,
    supportedSubmitMethods: ["get", "post"],
    validatorUrl: null,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: "StandaloneLayout"
  });
};`;

function withoutSchemaDialect(schema: z.core.JSONSchema.JSONSchema): object {
  const { $schema: _schema, ...openApiSchema } = schema;
  return openApiSchema;
}

function toolPath(tool: PublicToolDescription) {
  return {
    post: {
      tags: ["Public queries"],
      summary: tool.title ?? tool.name,
      description:
        tool.description ??
        "Run the identically named public read-only MCP query.",
      operationId: tool.name,
      requestBody: {
        required: true,
        description:
          "The same strict arguments object accepted by the MCP V2 tool.",
        content: {
          "application/json": {
            schema: withoutSchemaDialect(z.toJSONSchema(tool.inputSchema)),
          },
        },
      },
      responses: {
        "200": {
          description:
            "The same sanitized structured content returned by the MCP V2 tool.",
          content: {
            "application/json": {
              schema: withoutSchemaDialect(z.toJSONSchema(tool.outputSchema)),
            },
          },
        },
        "400": { $ref: "#/components/responses/InvalidRequest" },
        "413": { $ref: "#/components/responses/RequestTooLarge" },
        "500": { $ref: "#/components/responses/InternalError" },
        "503": { $ref: "#/components/responses/ServiceUnavailable" },
      },
      security: [],
    },
  };
}

export function createOpenApiDocument(publicTools?: PublicToolRegistry) {
  const tools = publicTools?.descriptions() ?? [];
  return {
    openapi: "3.1.0",
    info: {
      title: "MeshCore MQTT Broker Public Query API",
      version: "2.0.0",
      description:
        "Public, anonymous, read-only HTTP access to the same normalized MeshCore history queries as MCP V2. No credentials are accepted or required.",
    },
    tags: [
      { name: "General", description: "API discovery" },
      {
        name: "Public queries",
        description:
          "Strict, bounded, sanitized queries shared with the MCP V2 tool registry",
      },
    ],
    paths: {
      "/api/v2": {
        get: {
          tags: ["General"],
          summary: "Discover public query operations",
          operationId: "getPublicQueryIndex",
          security: [],
          responses: {
            "200": {
              description: "Public read-only operation discovery",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: [
                      "version",
                      "publicAccess",
                      "authenticationRequired",
                      "readOnly",
                      "tools",
                    ],
                    properties: {
                      version: { type: "string", const: "v2" },
                      publicAccess: { type: "boolean", const: true },
                      authenticationRequired: {
                        type: "boolean",
                        const: false,
                      },
                      readOnly: { type: "boolean", const: true },
                      tools: {
                        type: "array",
                        items: {
                          type: "object",
                          required: ["name", "method", "path"],
                          properties: {
                            name: { type: "string" },
                            title: { type: "string" },
                            description: { type: "string" },
                            method: { type: "string", const: "POST" },
                            path: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      ...Object.fromEntries(
        tools.map((tool) => [`/api/v2/tools/${tool.name}`, toolPath(tool)]),
      ),
    },
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["code", "message"],
          additionalProperties: false,
          properties: {
            code: { type: "string" },
            message: { type: "string" },
          },
        },
      },
      responses: {
        InvalidRequest: {
          description: "The JSON body does not match the tool input schema.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        RequestTooLarge: {
          description: "The JSON request body exceeds 1 MiB.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        InternalError: {
          description: "The query failed without exposing internal detail.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        ServiceUnavailable: {
          description: "The bounded public query concurrency is exhausted.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  } as const;
}

export const OPENAPI_DOCUMENT = createOpenApiDocument();

export interface ApiHandlerOptions {
  getDashboardSnapshot: () => Promise<DashboardSnapshot>;
  publicTools?: PublicToolRegistry;
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function sendApiError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(response, status, { code, message });
}

function sendSwaggerAsset(response: ServerResponse, assetName: string): void {
  let body = swaggerAssetCache.get(assetName);
  if (!body) {
    body = readFileSync(join(swaggerDirectory, assetName));
    swaggerAssetCache.set(assetName, body);
  }
  response.writeHead(200, {
    "content-type": assetName.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "text/javascript; charset=utf-8",
    "cache-control": "public, max-age=86400",
  });
  response.end(body);
}

export function createApiHandler(options: ApiHandlerOptions): HttpRouteHandler {
  return async (_request, response, url) => {
    if (!url.pathname.startsWith("/api/")) return false;

    if (url.pathname === "/api/docs" || url.pathname === "/api/docs/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'",
      });
      response.end(SWAGGER_HTML);
      return true;
    }
    if (url.pathname === "/api/docs/swagger-initializer.js") {
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(SWAGGER_INITIALIZER);
      return true;
    }
    const swaggerAsset = url.pathname.slice("/api/docs/".length);
    if (
      url.pathname.startsWith("/api/docs/") &&
      swaggerAssetNames.has(swaggerAsset)
    ) {
      sendSwaggerAsset(response, swaggerAsset);
      return true;
    }
    if (url.pathname === "/api/openapi.json") {
      sendJson(response, 200, createOpenApiDocument(options.publicTools));
      return true;
    }
    if (url.pathname === "/api/dashboard") {
      try {
        sendJson(response, 200, await options.getDashboardSnapshot());
      } catch {
        log.error("Could not load dashboard snapshot", {
          errorCode: "dashboard_snapshot_failed",
        });
        sendApiError(
          response,
          503,
          "temporarily_unavailable",
          "Dashboard data is temporarily unavailable.",
        );
      }
      return true;
    }
    if (url.pathname === "/api/v2" || url.pathname === "/api/v2/") {
      const tools = options.publicTools?.descriptions() ?? [];
      sendJson(response, 200, {
        version: "v2",
        publicAccess: true,
        authenticationRequired: false,
        readOnly: true,
        tools: tools.map((tool) => ({
          name: tool.name,
          title: tool.title ?? tool.name,
          description: tool.description ?? "Public read-only query.",
          method: "POST",
          path: `/api/v2/tools/${tool.name}`,
        })),
      });
      return true;
    }
    if (
      url.pathname === "/api/v1" ||
      url.pathname === "/api/v1/" ||
      url.pathname.startsWith("/api/v1/")
    ) {
      sendApiError(
        response,
        410,
        "gone",
        "API v1 has been removed. Use /api/v2 and its public query operations.",
      );
      return true;
    }

    sendApiError(response, 404, "not_found", "API route not found.");
    return true;
  };
}
