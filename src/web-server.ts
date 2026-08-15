import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { getModuleLogger } from "./logger.js";

const log = getModuleLogger("Web");

export type HttpRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => boolean | Promise<boolean>;

export interface WebServerOptions {
  host: string;
  port: number;
  protocolHandlers?: HttpRouteHandler[];
  handlers: HttpRouteHandler[];
}

export function createWebServer(options: WebServerOptions) {
  const server = createServer((request, response) => {
    void (async () => {
      let url: URL;
      try {
        url = new URL(request.url || "/", "http://localhost");
      } catch {
        response.writeHead(400, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("Bad Request");
        return;
      }

      for (const handler of options.protocolHandlers ?? []) {
        if (await handler(request, response, url)) return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        const isApiRequest = url.pathname.startsWith("/api/");
        response.writeHead(405, {
          allow: "GET, HEAD",
          ...(isApiRequest
            ? {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
              }
            : {}),
        });
        response.end(
          isApiRequest
            ? JSON.stringify({
                code: "method_not_allowed",
                message: "Only GET and HEAD requests are supported.",
              })
            : undefined,
        );
        return;
      }

      for (const handler of options.handlers) {
        if (await handler(request, response, url)) return;
      }

      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("Not found");
    })().catch((error) => {
      log.error(
        "HTTP request failed:",
        error instanceof Error ? error.message : String(error),
      );
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          code: "internal_error",
          message: "The requested service is temporarily unavailable.",
        }),
      );
    });
  });

  server.on("error", (error) => {
    log.error("HTTP server error:", error.message);
  });

  return {
    server,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        try {
          server.listen(options.port, options.host, () => {
            server.removeListener("error", onError);
            const address = server.address() as AddressInfo;
            resolve(address.port);
          });
        } catch (error) {
          server.removeListener("error", onError);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
