import { readFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import type { ServerResponse } from "http";
import { getModuleLogger } from "./logger.js";
import { isNeighborSnapshotRecent } from "./neighbors.js";
import {
  normalizePublicKey,
  validatePublicKey,
  type BrokerStateStore,
} from "./state-store.js";
import { isPointInSweden } from "./sweden-geofence.js";
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
  <title>MeshCore MQTT Broker API</title>
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
    supportedSubmitMethods: ["get"],
    validatorUrl: null,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: "StandaloneLayout"
  });
};`;

export const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "MeshCore MQTT Broker API",
    version: "1.0.0",
    description:
      "Unauthenticated, read-only operational API for the local MeshCore MQTT broker.",
  },
  tags: [
    { name: "Dashboard", description: "Dashboard operational data" },
    { name: "Nodes", description: "Verified MeshCore adverts" },
    { name: "Observers", description: "Observer status lookup" },
  ],
  paths: {
    "/api/dashboard": {
      get: {
        tags: ["Dashboard"],
        summary: "Get the dashboard snapshot",
        description:
          "Returns current broker metrics, observers, subscribers, protection events, regions, and integration state used by the dashboard application.",
        operationId: "getDashboardSnapshot",
        responses: {
          "200": {
            description: "Current operational snapshot",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DashboardSnapshot" },
              },
            },
          },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },
    "/api/v1/nodes": {
      get: {
        tags: ["Nodes"],
        summary: "List recently heard nodes",
        description:
          "Returns the latest verified advert per node together with every MQTT region where the node was heard during the rolling last seven days. Each region hearing expires independently after seven days. A normal region matches any active region hearing. SWE filters advert coordinates against Sweden's land boundary and excludes adverts without coordinates.",
        operationId: "listNodes",
        parameters: [
          {
            name: "region",
            in: "query",
            required: false,
            description:
              "Three-letter MQTT region, TEST, or SWE for geographic filtering.",
            schema: {
              type: "string",
              pattern: "^(?:[A-Za-z]{3}|[Tt][Ee][Ss][Tt])$",
            },
            examples: {
              mqttRegion: { value: "STO" },
              swedenBoundary: { value: "SWE" },
            },
          },
        ],
        responses: {
          "200": {
            description: "Latest matching node adverts",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NodesResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidRequest" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/observers/{publicKey}/status": {
      get: {
        tags: ["Observers"],
        summary: "Look up observer status",
        operationId: "getObserverStatus",
        parameters: [
          {
            name: "publicKey",
            in: "path",
            required: true,
            description: "64-character hexadecimal observer public key.",
            schema: { type: "string", pattern: "^[0-9A-Fa-f]{64}$" },
          },
        ],
        responses: {
          "200": {
            description: "Known, blocked, or unknown observer status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ObserverStatus" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidRequest" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
  },
  components: {
    responses: {
      InvalidRequest: {
        description: "Invalid path or parameter",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      InternalError: {
        description: "Storage or processing failure",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      ServiceUnavailable: {
        description: "Service temporarily unavailable",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        required: ["status", "message"],
        properties: {
          status: { type: "string", examples: ["error"] },
          message: { type: "string" },
        },
      },
      DashboardSnapshot: {
        type: "object",
        description:
          "Operational dashboard state. Nested fields may grow compatibly as dashboard features are added.",
        required: [
          "generatedAt",
          "respondingBroker",
          "summary",
          "brokers",
          "observers",
          "recentPublishes",
          "bans",
          "subscribers",
        ],
        properties: {
          generatedAt: { type: "integer", format: "int64" },
          respondingBroker: { type: "string" },
          summary: { type: "object", additionalProperties: true },
          brokers: { type: "array", items: { type: "object" } },
          observers: { type: "array", items: { type: "object" } },
          recentPublishes: { type: "array", items: { type: "object" } },
          bans: { type: "array", items: { type: "object" } },
          subscribers: { type: "array", items: { type: "object" } },
          regionLookup: { type: "object", additionalProperties: true },
          countyLookup: {
            type: "object",
            deprecated: true,
            additionalProperties: true,
          },
          meshcoreIo: { type: "object", additionalProperties: true },
          error: { type: "string" },
        },
      },
      NodeRegionHearing: {
        type: "object",
        required: ["region", "observerPublicKey", "heardAt", "expiresAt"],
        properties: {
          region: { type: "string", examples: ["STO"] },
          observerPublicKey: { type: "string", pattern: "^[0-9A-F]{64}$" },
          heardAt: {
            type: "integer",
            format: "int64",
            description:
              "Unix time in milliseconds when the node was last heard in this region.",
          },
          expiresAt: {
            type: "integer",
            format: "int64",
            description:
              "Unix time in milliseconds when this region hearing stops being returned unless refreshed.",
          },
        },
      },
      NodeAdvert: {
        type: "object",
        required: [
          "publicKey",
          "advertTimestamp",
          "advertType",
          "rawPacketHex",
          "advertHeardAt",
          "heardAt",
          "expiresAt",
          "regions",
          "regionHearings",
        ],
        properties: {
          publicKey: { type: "string", pattern: "^[0-9A-F]{64}$" },
          advertTimestamp: {
            type: "integer",
            description: "MeshCore advert Unix timestamp in seconds.",
          },
          advertType: { type: "string", examples: ["REPEATER"] },
          name: { type: "string" },
          latitude: { type: "number", minimum: -90, maximum: 90 },
          longitude: { type: "number", minimum: -180, maximum: 180 },
          rawPacketHex: { type: "string", pattern: "^[0-9a-f]+$" },
          advertHeardAt: {
            type: "integer",
            format: "int64",
            description:
              "Unix time in milliseconds when the retained latest advert copy was received.",
          },
          heardAt: {
            type: "integer",
            format: "int64",
            description:
              "Unix time in milliseconds when the node was most recently heard in any region.",
          },
          expiresAt: {
            type: "integer",
            format: "int64",
            description:
              "Unix time in milliseconds when the node stops being returned unless heard again.",
          },
          regions: {
            type: "array",
            description:
              "Sorted MQTT regions where the node was heard during the rolling last seven days.",
            items: { type: "string" },
          },
          regionHearings: {
            type: "array",
            description:
              "Last active hearing per region, sorted by region code.",
            items: { $ref: "#/components/schemas/NodeRegionHearing" },
          },
        },
      },
      NodesResponse: {
        type: "object",
        required: ["generatedAt", "region", "count", "nodes"],
        properties: {
          generatedAt: { type: "integer", format: "int64" },
          region: { type: ["string", "null"], examples: ["SWE"] },
          count: { type: "integer", minimum: 0 },
          nodes: {
            type: "array",
            items: { $ref: "#/components/schemas/NodeAdvert" },
          },
        },
      },
      ObserverSummary: {
        type: "object",
        required: ["publicKey", "shortKey"],
        properties: {
          publicKey: { type: "string", pattern: "^[0-9A-F]{64}$" },
          shortKey: { type: "string" },
          region: { type: "string" },
          name: { type: "string" },
          brokerId: { type: "string" },
          lastSeen: { type: "integer", format: "int64" },
          neighbors: { type: "object", additionalProperties: true },
        },
      },
      ObserverStatus: {
        type: "object",
        required: ["status", "publicKey"],
        properties: {
          status: { type: "string", enum: ["known", "blocked", "unknown"] },
          publicKey: { type: "string", pattern: "^[0-9A-F]{64}$" },
          observer: { $ref: "#/components/schemas/ObserverSummary" },
          block: { type: "object", additionalProperties: true },
          message: { type: "string" },
        },
      },
    },
  },
} as const;

interface ObserverStatusKnown {
  status: "known";
  publicKey: string;
  observer: {
    publicKey: string;
    shortKey: string;
    region?: string;
    name?: string;
    brokerId?: string;
    lastSeen?: number;
    neighbors?: unknown;
  };
}

interface ObserverStatusBlocked {
  status: "blocked";
  publicKey: string;
  observer: ObserverStatusKnown["observer"];
  block: {
    reason: string;
    status: string;
    deniedUntilText?: string;
    mutedUntil?: number;
    region?: string;
    brokerId?: string;
    lastSeen?: number;
  };
}

interface ObserverStatusUnknown {
  status: "unknown";
  publicKey: string;
  message: string;
}

type ObserverStatus =
  ObserverStatusKnown | ObserverStatusBlocked | ObserverStatusUnknown;

export interface ApiHandlerOptions {
  stateStore: BrokerStateStore;
  getDashboardSnapshot: () => Promise<unknown>;
}

function shortKey(publicKey: string): string {
  return publicKey.length <= 18
    ? publicKey
    : `${publicKey.slice(0, 10)}...${publicKey.slice(-6)}`;
}

export async function lookupObserverStatus(
  publicKey: string,
  stateStore: BrokerStateStore,
): Promise<ObserverStatus> {
  const normalized = normalizePublicKey(publicKey);
  const short = shortKey(normalized);
  const [ban, deniedPublish, bestObserverEntry, nodeNames] = await Promise.all([
    stateStore.getPublicBan(normalized),
    stateStore.getLatestDeniedPublish(normalized),
    stateStore.getObserver(normalized),
    stateStore.getObserverNodeNames([normalized]),
  ]);
  const blockMatch = ban ?? deniedPublish;

  if (blockMatch) {
    return {
      status: "blocked",
      publicKey: normalized,
      observer: {
        publicKey: normalized,
        shortKey: short,
        region: blockMatch.region,
        name: nodeNames.get(normalized),
        brokerId: blockMatch.broker,
        lastSeen: blockMatch.lastUpdatedAt,
        neighbors:
          bestObserverEntry?.neighbors &&
          isNeighborSnapshotRecent(bestObserverEntry.neighbors, Date.now())
            ? bestObserverEntry.neighbors
            : undefined,
      },
      block: {
        reason: blockMatch.reason,
        status: blockMatch.status,
        deniedUntilText: blockMatch.deniedUntilText,
        mutedUntil: blockMatch.mutedUntil,
        region: blockMatch.region,
        brokerId: blockMatch.broker,
        lastSeen: blockMatch.lastUpdatedAt,
      },
    };
  }

  if (bestObserverEntry) {
    return {
      status: "known",
      publicKey: normalized,
      observer: {
        publicKey: normalized,
        shortKey: short,
        region: bestObserverEntry.region,
        name: nodeNames.get(normalized),
        brokerId: bestObserverEntry.broker,
        lastSeen: bestObserverEntry.lastSeenAt,
        neighbors:
          bestObserverEntry.neighbors &&
          isNeighborSnapshotRecent(bestObserverEntry.neighbors, Date.now())
            ? bestObserverEntry.neighbors
            : undefined,
      },
    };
  }

  return {
    status: "unknown",
    publicKey: normalized,
    message: "This observer has not been seen by any broker instance.",
  };
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function sendApiError(
  response: ServerResponse,
  statusCode: number,
  status: "invalid" | "error",
  message: string,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify({ status, message }));
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
      sendJson(response, OPENAPI_DOCUMENT);
      return true;
    }
    if (url.pathname === "/api/dashboard") {
      try {
        sendJson(response, await options.getDashboardSnapshot());
      } catch (error) {
        log.error(
          "Could not load dashboard snapshot:",
          error instanceof Error ? error.message : String(error),
        );
        response.writeHead(503, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(
          JSON.stringify({
            status: "error",
            message: "Dashboard data is temporarily unavailable.",
          }),
        );
      }
      return true;
    }
    if (url.pathname === "/api/v1/nodes") {
      const regionValues = url.searchParams.getAll("region");
      const region = regionValues[0]?.trim().toUpperCase();
      if (
        regionValues.length > 1 ||
        (region !== undefined && !/^(?:[A-Z]{3}|TEST)$/.test(region))
      ) {
        sendApiError(
          response,
          400,
          "invalid",
          "Region must be SWE, TEST, or a three-letter code.",
        );
        return true;
      }
      try {
        let nodes = await options.stateStore.listHeardNodeAdverts(
          region === "SWE" ? undefined : region,
        );
        if (region === "SWE") {
          nodes = nodes.filter(
            (node) =>
              node.latitude !== undefined &&
              node.longitude !== undefined &&
              isPointInSweden(node.latitude, node.longitude),
          );
        }
        sendJson(response, {
          generatedAt: Date.now(),
          region: region ?? null,
          count: nodes.length,
          nodes,
        });
      } catch (error) {
        log.error(
          "Could not list nodes:",
          error instanceof Error ? error.message : String(error),
        );
        sendApiError(
          response,
          500,
          "error",
          "Nodes could not be listed. Try again later.",
        );
      }
      return true;
    }
    if (url.pathname.startsWith("/api/v1/observers/")) {
      const parts = url.pathname.split("/");
      if (parts.length !== 6 || parts[5] !== "status") {
        sendApiError(response, 400, "invalid", "Invalid public key");
        return true;
      }
      let rawPublicKey: string;
      try {
        rawPublicKey = decodeURIComponent(parts[4]);
      } catch {
        sendApiError(response, 400, "invalid", "Invalid public key");
        return true;
      }
      const publicKey = validatePublicKey(rawPublicKey);
      if (!publicKey) {
        sendApiError(response, 400, "invalid", "Invalid public key");
        return true;
      }
      try {
        sendJson(
          response,
          await lookupObserverStatus(publicKey, options.stateStore),
        );
      } catch (error) {
        log.error(
          "Could not check observer:",
          error instanceof Error ? error.message : String(error),
        );
        sendApiError(
          response,
          500,
          "error",
          "Observer status could not be checked. Try again later.",
        );
      }
      return true;
    }

    return false;
  };
}
