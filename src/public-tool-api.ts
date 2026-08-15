import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DEFAULT_PUBLIC_TOOL_API_PATH } from "./config.js";
import { getModuleLogger } from "./logger.js";
import {
  PublicToolInputError,
  PublicToolOutputError,
  type PublicToolRegistry,
} from "./public-tool-registry.js";
import type { HttpRouteHandler } from "./web-server.js";

const log = getModuleLogger("PublicToolApi");
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_CONCURRENT_REQUESTS = 32;

class RequestBodyTooLargeError extends Error {}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : typeof rawChunk === "string"
        ? Buffer.from(rawChunk)
        : undefined;
    if (!chunk) throw new SyntaxError("Invalid request body");
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new RequestBodyTooLargeError();
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function resultCount(value: Record<string, unknown>): number {
  const data = value.data;
  if (Array.isArray(data)) return data.length;
  return data === null ? 0 : 1;
}

function publicResultError(result: {
  content: Array<{ type: string; text?: string }>;
}): { code: "invalid_request"; reason: string; message: string } | undefined {
  const first = result.content[0];
  if (first?.type !== "text" || typeof first.text !== "string")
    return undefined;
  try {
    const parsed: unknown = JSON.parse(first.text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).code === "invalid_request" &&
      typeof (parsed as Record<string, unknown>).reason === "string" &&
      typeof (parsed as Record<string, unknown>).message === "string"
    ) {
      return parsed as {
        code: "invalid_request";
        reason: string;
        message: string;
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function createPublicToolApiHandler(
  registry: PublicToolRegistry,
  path: string = DEFAULT_PUBLIC_TOOL_API_PATH,
): HttpRouteHandler {
  let activeRequests = 0;
  const prefix = `${path}/tools/`;

  return async (request, response, url) => {
    if (!url.pathname.startsWith(prefix)) return false;
    const toolName = url.pathname.slice(prefix.length);
    if (!toolName || toolName.includes("/")) {
      sendJson(response, 404, {
        code: "not_found",
        message: "Public tool route not found.",
      });
      return true;
    }
    if (!registry.has(toolName)) {
      sendJson(response, 404, {
        code: "not_found",
        message: "Public tool not found.",
      });
      return true;
    }
    if (request.method !== "POST") {
      sendJson(
        response,
        405,
        {
          code: "method_not_allowed",
          message: "Use POST with a JSON object containing the tool arguments.",
        },
        { allow: "POST" },
      );
      return true;
    }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      sendJson(response, 413, {
        code: "request_too_large",
        message: "Request body too large.",
      });
      return true;
    }
    if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
      sendJson(response, 503, {
        code: "temporarily_unavailable",
        message: "Public query concurrency limit reached.",
      });
      return true;
    }

    const requestId = randomUUID();
    const startedAt = Date.now();
    activeRequests += 1;
    try {
      const input = await readJsonBody(request);
      const result = await registry.invoke(toolName, input);
      if (result.isError || !result.structuredContent) {
        const invalidRequest = publicResultError(result);
        if (invalidRequest) {
          sendJson(response, 400, invalidRequest);
          log.info("Public HTTP tool rejected invalid arguments", {
            requestId,
            toolName,
            durationMs: Date.now() - startedAt,
            success: false,
            errorCode: invalidRequest.code,
            reason: invalidRequest.reason,
            resultCount: 0,
            truncated: false,
          });
          return true;
        }
        sendJson(response, 500, {
          code: "internal_error",
          message: "The public result could not be returned safely.",
        });
        log.warn("Public HTTP tool failed safely", {
          requestId,
          toolName,
          durationMs: Date.now() - startedAt,
          success: false,
          errorCode: "safe_public_tool_error",
          resultCount: 0,
          truncated: false,
        });
        return true;
      }
      const output = result.structuredContent;
      const meta = output.meta;
      const truncated =
        typeof meta === "object" &&
        meta !== null &&
        "truncated" in meta &&
        meta.truncated === true;
      sendJson(response, 200, output);
      log.info("Public HTTP tool completed", {
        requestId,
        toolName,
        durationMs: Date.now() - startedAt,
        success: true,
        resultCount: resultCount(output),
        truncated,
      });
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        sendJson(response, 413, {
          code: "request_too_large",
          message: "Request body too large.",
        });
      } else if (
        error instanceof SyntaxError ||
        error instanceof PublicToolInputError
      ) {
        sendJson(response, 400, {
          code: "invalid_request",
          message: "Invalid public tool arguments.",
        });
      } else {
        sendJson(response, 500, {
          code: "internal_error",
          message: "The public query could not be completed.",
        });
      }
      log.warn("Public HTTP tool request failed", {
        requestId,
        toolName,
        durationMs: Date.now() - startedAt,
        success: false,
        errorCode:
          error instanceof PublicToolInputError || error instanceof SyntaxError
            ? "invalid_request"
            : error instanceof PublicToolOutputError
              ? "invalid_tool_output"
              : error instanceof RequestBodyTooLargeError
                ? "request_too_large"
                : "public_query_failed",
        resultCount: 0,
        truncated: false,
      });
    } finally {
      activeRequests -= 1;
    }
    return true;
  };
}
