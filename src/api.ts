import type { ServerResponse } from "node:http";
import type { DashboardSnapshot } from "./dashboard.js";
import { getModuleLogger } from "./logger.js";
import type { HttpRouteHandler } from "./web-server.js";

const log = getModuleLogger("API");

export interface ApiHandlerOptions {
  getDashboardSnapshot: () => Promise<DashboardSnapshot>;
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

export function createApiHandler(options: ApiHandlerOptions): HttpRouteHandler {
  return async (_request, response, url) => {
    if (!url.pathname.startsWith("/api/")) return false;

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
    if (
      url.pathname === "/api/v1" ||
      url.pathname === "/api/v1/" ||
      url.pathname.startsWith("/api/v1/")
    ) {
      sendApiError(
        response,
        410,
        "gone",
        "API v1 has been removed. Use the REST API at /api/v2.",
      );
      return true;
    }

    sendApiError(response, 404, "not_found", "API route not found.");
    return true;
  };
}
