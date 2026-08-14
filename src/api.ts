import { readFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import type { ServerResponse } from "http";
import { getModuleLogger } from "./logger.js";
import { isNeighborSnapshotRecent } from "./neighbors.js";
import type { DashboardSnapshot } from "./dashboard.js";
import {
  normalizePublicKey,
  validatePublicKey,
  type BrokerStateStore,
  type HeardNodeAdvert,
  type InstanceObserverEntry,
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
    version: "1.2.0",
    description:
      "Unauthenticated, read-only API for public MeshCore network data and the broker's own dashboard.",
  },
  tags: [
    { name: "General", description: "API discovery" },
    {
      name: "Dashboard",
      description: "Dashboard-only operational compatibility data",
    },
    { name: "Nodes", description: "Verified MeshCore adverts" },
    { name: "Observers", description: "Observer listings and status lookup" },
    { name: "Regions", description: "Configured and recently active regions" },
  ],
  paths: {
    "/api/v1": {
      get: {
        tags: ["General"],
        summary: "Discover API resources",
        operationId: "getApiIndex",
        responses: {
          "200": {
            description: "Versioned API entry point",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiIndex" },
              },
            },
          },
        },
      },
    },
    "/api/dashboard": {
      get: {
        tags: ["Dashboard"],
        summary: "Get the dashboard snapshot",
        description:
          "Dashboard-internal compatibility route. Returns current broker metrics, observers, subscribers, protection events, regions, and integration state used by the dashboard application. External integrations should use /api/v1 resources instead.",
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
          "Returns lightweight node summaries for maps, directories, and regional views. Every summary includes all MQTT regions where the node was heard during the rolling last seven days, but omits the raw advert and per-observer hearing details available from the node detail route. A normal region matches any active region hearing. SWE filters advert coordinates against Sweden's land boundary and excludes adverts without coordinates.",
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
          {
            name: "type",
            in: "query",
            required: false,
            description:
              "Case-insensitive advert type, for example REPEATER or CHAT.",
            schema: {
              type: "string",
              pattern: "^[A-Za-z][A-Za-z0-9_-]{0,31}$",
            },
          },
          {
            name: "hasLocation",
            in: "query",
            required: false,
            description:
              "Use true for nodes with coordinates or false for nodes without complete coordinates.",
            schema: { type: "boolean" },
          },
        ],
        responses: {
          "200": {
            description: "Latest matching node summaries",
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
    "/api/v1/nodes/{publicKey}": {
      get: {
        tags: ["Nodes"],
        summary: "Get one recently heard node",
        operationId: "getNode",
        parameters: [
          {
            name: "publicKey",
            in: "path",
            required: true,
            description: "64-character hexadecimal node public key.",
            schema: { type: "string", pattern: "^[0-9A-Fa-f]{64}$" },
          },
        ],
        responses: {
          "200": {
            description: "Latest unexpired advert and active region hearings",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NodeResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/observers": {
      get: {
        tags: ["Observers"],
        summary: "List observers",
        description:
          "Lists active observers by default. Results are ordered by activity and never include recent message payloads.",
        operationId: "listObservers",
        parameters: [
          {
            name: "region",
            in: "query",
            required: false,
            description: "Three-letter MQTT region or TEST.",
            schema: {
              type: "string",
              pattern: "^(?:[A-Za-z]{3}|[Tt][Ee][Ss][Tt])$",
            },
          },
          {
            name: "active",
            in: "query",
            required: false,
            description:
              "Select active, inactive, or all observers. Defaults to true.",
            schema: {
              type: "string",
              enum: ["true", "false", "all"],
              default: "true",
            },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Maximum number of observers. Defaults to 100.",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 1000,
              default: 100,
            },
          },
        ],
        responses: {
          "200": {
            description: "Matching observers",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ObserversResponse" },
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
    "/api/v1/regions": {
      get: {
        tags: ["Regions"],
        summary: "List configured and active regions",
        description:
          "Combines public region configuration with counts of nodes having an unexpired hearing in each MQTT region.",
        operationId: "listRegions",
        responses: {
          "200": {
            description: "Configured or recently active MQTT regions",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RegionsResponse" },
              },
            },
          },
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
      NotFound: {
        description: "The requested current resource was not found",
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
        required: ["code", "message"],
        properties: {
          code: {
            type: "string",
            enum: [
              "invalid_request",
              "method_not_allowed",
              "not_found",
              "internal_error",
            ],
          },
          message: { type: "string" },
        },
      },
      ApiIndex: {
        type: "object",
        required: ["name", "version", "documentation", "openapi", "resources"],
        properties: {
          name: { type: "string" },
          version: { type: "string", examples: ["v1"] },
          documentation: { type: "string", examples: ["/api/docs"] },
          openapi: { type: "string", examples: ["/api/openapi.json"] },
          resources: {
            type: "object",
            additionalProperties: { type: "string" },
          },
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
      NodeSummary: {
        type: "object",
        required: [
          "publicKey",
          "advertTimestamp",
          "advertType",
          "heardAt",
          "expiresAt",
          "regions",
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
        },
      },
      NodeDetail: {
        allOf: [
          { $ref: "#/components/schemas/NodeSummary" },
          {
            type: "object",
            required: ["rawPacketHex", "advertHeardAt", "regionHearings"],
            properties: {
              rawPacketHex: { type: "string", pattern: "^[0-9a-f]+$" },
              advertHeardAt: {
                type: "integer",
                format: "int64",
                description:
                  "Unix time in milliseconds when the retained latest advert copy was received.",
              },
              regionHearings: {
                type: "array",
                description:
                  "Last active hearing per region, sorted by region code.",
                items: { $ref: "#/components/schemas/NodeRegionHearing" },
              },
            },
          },
        ],
      },
      NodesResponse: {
        type: "object",
        required: ["generatedAt", "filters", "count", "nodes"],
        properties: {
          generatedAt: { type: "integer", format: "int64" },
          filters: {
            type: "object",
            required: ["region", "type", "hasLocation"],
            properties: {
              region: { type: ["string", "null"], examples: ["SWE"] },
              type: { type: ["string", "null"], examples: ["REPEATER"] },
              hasLocation: { type: ["boolean", "null"] },
            },
          },
          count: { type: "integer", minimum: 0 },
          nodes: {
            type: "array",
            items: { $ref: "#/components/schemas/NodeSummary" },
          },
        },
      },
      NodeResponse: {
        type: "object",
        required: ["generatedAt", "node"],
        properties: {
          generatedAt: { type: "integer", format: "int64" },
          node: { $ref: "#/components/schemas/NodeDetail" },
        },
      },
      PublicObserver: {
        type: "object",
        required: ["publicKey", "name", "region", "active", "lastSeenAt"],
        properties: {
          publicKey: { type: "string", pattern: "^[0-9A-F]{64}$" },
          name: { type: "string" },
          region: { type: ["string", "null"] },
          active: { type: "boolean" },
          lastSeenAt: { type: "integer", format: "int64" },
        },
      },
      ObserversResponse: {
        type: "object",
        required: ["generatedAt", "filters", "count", "observers"],
        properties: {
          generatedAt: { type: "integer", format: "int64" },
          filters: { type: "object", additionalProperties: true },
          count: { type: "integer", minimum: 0 },
          observers: {
            type: "array",
            items: { $ref: "#/components/schemas/PublicObserver" },
          },
        },
      },
      ObserverStatus: {
        type: "object",
        required: ["status", "publicKey"],
        properties: {
          status: { type: "string", enum: ["known", "blocked", "unknown"] },
          publicKey: { type: "string", pattern: "^[0-9A-F]{64}$" },
          name: { type: ["string", "null"] },
          region: { type: ["string", "null"] },
          active: { type: "boolean" },
          lastSeenAt: { type: ["integer", "null"], format: "int64" },
          neighbors: { type: "object", additionalProperties: true },
          block: {
            type: "object",
            required: ["action", "reason"],
            properties: {
              action: {
                type: "string",
                enum: ["muted", "would_mute", "denied"],
              },
              reason: { type: "string" },
              expiresAt: { type: "integer", format: "int64" },
            },
          },
          message: { type: "string" },
        },
      },
      Region: {
        type: "object",
        required: ["code", "name", "primaryRegion", "nodeCount"],
        properties: {
          code: { type: "string", examples: ["STO"] },
          name: { type: "string", examples: ["Stockholm"] },
          primaryRegion: { type: "string", examples: ["STO"] },
          nodeCount: { type: "integer", minimum: 0 },
        },
      },
      RegionsResponse: {
        type: "object",
        required: ["generatedAt", "count", "geographicFilters", "regions"],
        properties: {
          generatedAt: { type: "integer", format: "int64" },
          count: { type: "integer", minimum: 0 },
          geographicFilters: {
            type: "array",
            items: { type: "string", enum: ["SWE"] },
          },
          regions: {
            type: "array",
            items: { $ref: "#/components/schemas/Region" },
          },
        },
      },
    },
  },
} as const;

interface ObserverStatusKnown {
  status: "known";
  publicKey: string;
  name: string | null;
  region: string | null;
  active: boolean;
  lastSeenAt: number;
  neighbors?: unknown;
}

interface ObserverStatusBlocked {
  status: "blocked";
  publicKey: string;
  name: string | null;
  region: string | null;
  active: boolean;
  lastSeenAt: number | null;
  neighbors?: unknown;
  block: {
    reason: string;
    action: "muted" | "would_mute" | "denied";
    expiresAt?: number;
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
  getDashboardSnapshot: () => Promise<DashboardSnapshot>;
  getRegionLookup?: () => NonNullable<DashboardSnapshot["regionLookup"]>;
}

interface PublicObserver {
  publicKey: string;
  name: string;
  region: string | null;
  active: boolean;
  lastSeenAt: number;
}

type PublicNodeSummary = Omit<
  HeardNodeAdvert,
  "rawPacketHex" | "advertHeardAt" | "regionHearings"
>;

export async function lookupObserverStatus(
  publicKey: string,
  stateStore: BrokerStateStore,
): Promise<ObserverStatus> {
  const normalized = normalizePublicKey(publicKey);
  const [ban, deniedPublish, bestObserverEntry, nodeNames] = await Promise.all([
    stateStore.getPublicBan(normalized),
    stateStore.getLatestDeniedPublish(normalized),
    stateStore.getObserver(normalized),
    stateStore.getObserverNodeNames([normalized]),
  ]);
  const blockMatch = ban ?? deniedPublish;
  const currentNeighbors =
    bestObserverEntry?.neighbors &&
    isNeighborSnapshotRecent(bestObserverEntry.neighbors, Date.now())
      ? bestObserverEntry.neighbors
      : undefined;

  if (blockMatch) {
    return {
      status: "blocked",
      publicKey: normalized,
      name: nodeNames.get(normalized) ?? null,
      region: bestObserverEntry?.region ?? blockMatch.region ?? null,
      active: bestObserverEntry?.active ?? false,
      lastSeenAt:
        bestObserverEntry?.lastSeenAt ?? blockMatch.lastUpdatedAt ?? null,
      neighbors: currentNeighbors,
      block: {
        reason: blockMatch.reason,
        action: blockMatch.status,
        expiresAt: blockMatch.mutedUntil,
      },
    };
  }

  if (bestObserverEntry) {
    return {
      status: "known",
      publicKey: normalized,
      name: nodeNames.get(normalized) ?? bestObserverEntry.label,
      region: bestObserverEntry.region ?? null,
      active: bestObserverEntry.active,
      lastSeenAt: bestObserverEntry.lastSeenAt,
      neighbors: currentNeighbors,
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
  status: "invalid" | "not_found" | "error",
  message: string,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  const code =
    status === "invalid"
      ? "invalid_request"
      : status === "not_found"
        ? "not_found"
        : "internal_error";
  response.end(JSON.stringify({ code, message }));
}

function publicObserver(
  entry: InstanceObserverEntry,
  names: Map<string, string>,
): PublicObserver {
  return {
    publicKey: entry.publicKey,
    name: names.get(entry.publicKey) ?? entry.label,
    region: entry.region ?? null,
    active: entry.active,
    lastSeenAt: entry.lastSeenAt,
  };
}

function publicNodeSummary(node: HeardNodeAdvert): PublicNodeSummary {
  return {
    publicKey: node.publicKey,
    advertTimestamp: node.advertTimestamp,
    advertType: node.advertType,
    name: node.name,
    latitude: node.latitude,
    longitude: node.longitude,
    heardAt: node.heardAt,
    expiresAt: node.expiresAt,
    regions: node.regions,
  };
}

function parseLimit(url: URL): number | undefined | null {
  const values = url.searchParams.getAll("limit");
  if (values.length === 0) return undefined;
  if (values.length > 1 || !/^[1-9][0-9]*$/.test(values[0].trim())) {
    return null;
  }
  const value = Number(values[0]);
  return Number.isSafeInteger(value) && value <= 1_000 ? value : null;
}

function parsePublicKeyPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes("/")) return null;
  try {
    return validatePublicKey(decodeURIComponent(encoded));
  } catch {
    return null;
  }
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
        sendApiError(
          response,
          503,
          "error",
          "Dashboard data is temporarily unavailable.",
        );
      }
      return true;
    }
    if (url.pathname === "/api/v1" || url.pathname === "/api/v1/") {
      sendJson(response, {
        name: "MeshCore MQTT Broker API",
        version: "v1",
        documentation: "/api/docs",
        openapi: "/api/openapi.json",
        resources: {
          regions: "/api/v1/regions",
          nodes: "/api/v1/nodes",
          node: "/api/v1/nodes/{publicKey}",
          observers: "/api/v1/observers",
          observerStatus: "/api/v1/observers/{publicKey}/status",
        },
      });
      return true;
    }
    if (url.pathname === "/api/v1/regions") {
      try {
        const nodes = await options.stateStore.listHeardNodeAdverts();
        const nodeCounts = new Map<string, number>();
        for (const node of nodes) {
          for (const region of node.regions) {
            nodeCounts.set(region, (nodeCounts.get(region) ?? 0) + 1);
          }
        }
        const lookup = options.getRegionLookup?.() ?? {};
        const codes = new Set([...Object.keys(lookup), ...nodeCounts.keys()]);
        const regions = [...codes]
          .sort((a, b) => a.localeCompare(b))
          .map((code) => {
            const entry = lookup[code];
            return {
              code,
              name: entry?.friendlyName ?? code,
              primaryRegion: entry?.primaryRegion ?? code,
              nodeCount: nodeCounts.get(code) ?? 0,
            };
          });
        sendJson(response, {
          generatedAt: Date.now(),
          count: regions.length,
          geographicFilters: ["SWE"],
          regions,
        });
      } catch (error) {
        log.error(
          "Could not list regions:",
          error instanceof Error ? error.message : String(error),
        );
        sendApiError(
          response,
          500,
          "error",
          "Regions could not be listed. Try again later.",
        );
      }
      return true;
    }
    if (url.pathname === "/api/v1/observers") {
      const regionValues = url.searchParams.getAll("region");
      const region = regionValues[0]?.trim().toUpperCase();
      const activeValues = url.searchParams.getAll("active");
      const active = activeValues[0]?.trim().toLowerCase() ?? "true";
      const limit = parseLimit(url);
      if (
        regionValues.length > 1 ||
        (region !== undefined && !/^(?:[A-Z]{3}|TEST)$/.test(region)) ||
        activeValues.length > 1 ||
        !/^(?:true|false|all)$/.test(active) ||
        limit === null
      ) {
        sendApiError(
          response,
          400,
          "invalid",
          "Use one valid region, active=true|false|all, and limit=1..1000.",
        );
        return true;
      }
      try {
        const entries = (await options.stateStore.listObservers(1_000))
          .filter((entry) => region === undefined || entry.region === region)
          .filter(
            (entry) => active === "all" || entry.active === (active === "true"),
          )
          .slice(0, limit ?? 100);
        const names = await options.stateStore.getObserverNodeNames(
          entries.map((entry) => entry.publicKey),
        );
        sendJson(response, {
          generatedAt: Date.now(),
          filters: {
            region: region ?? null,
            active: active === "all" ? "all" : active === "true",
            limit: limit ?? 100,
          },
          count: entries.length,
          observers: entries.map((entry) => publicObserver(entry, names)),
        });
      } catch (error) {
        log.error(
          "Could not list observers:",
          error instanceof Error ? error.message : String(error),
        );
        sendApiError(
          response,
          500,
          "error",
          "Observers could not be listed. Try again later.",
        );
      }
      return true;
    }
    if (url.pathname === "/api/v1/nodes") {
      const regionValues = url.searchParams.getAll("region");
      const region = regionValues[0]?.trim().toUpperCase();
      const typeValues = url.searchParams.getAll("type");
      const advertType = typeValues[0]?.trim().toUpperCase();
      const locationValues = url.searchParams.getAll("hasLocation");
      const locationValue = locationValues[0]?.trim().toLowerCase();
      const hasLocation =
        locationValue === undefined
          ? null
          : locationValue === "true"
            ? true
            : locationValue === "false"
              ? false
              : undefined;
      if (
        regionValues.length > 1 ||
        (region !== undefined && !/^(?:[A-Z]{3}|TEST)$/.test(region)) ||
        typeValues.length > 1 ||
        (advertType !== undefined &&
          !/^[A-Z][A-Z0-9_-]{0,31}$/.test(advertType)) ||
        locationValues.length > 1 ||
        hasLocation === undefined
      ) {
        sendApiError(
          response,
          400,
          "invalid",
          "Use one valid region, one advert type, and hasLocation=true|false.",
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
        if (advertType !== undefined) {
          nodes = nodes.filter((node) => node.advertType === advertType);
        }
        if (hasLocation !== null) {
          nodes = nodes.filter(
            (node) =>
              (node.latitude !== undefined && node.longitude !== undefined) ===
              hasLocation,
          );
        }
        sendJson(response, {
          generatedAt: Date.now(),
          filters: {
            region: region ?? null,
            type: advertType ?? null,
            hasLocation,
          },
          count: nodes.length,
          nodes: nodes.map(publicNodeSummary),
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
    if (url.pathname.startsWith("/api/v1/nodes/")) {
      const publicKey = parsePublicKeyPath(url.pathname, "/api/v1/nodes/");
      if (!publicKey) {
        sendApiError(response, 400, "invalid", "Invalid public key.");
        return true;
      }
      try {
        const node = await options.stateStore.getHeardNodeAdvert(publicKey);
        if (!node) {
          sendApiError(
            response,
            404,
            "not_found",
            "No unexpired advert was found for this node.",
          );
          return true;
        }
        sendJson(response, { generatedAt: Date.now(), node });
      } catch (error) {
        log.error(
          "Could not get node:",
          error instanceof Error ? error.message : String(error),
        );
        sendApiError(
          response,
          500,
          "error",
          "The node could not be loaded. Try again later.",
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

    sendApiError(response, 404, "not_found", "API route not found.");
    return true;
  };
}
