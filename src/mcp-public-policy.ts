import { randomUUID } from "node:crypto";
import { getModuleLogger } from "./logger.js";
import { PublicQueryInputError } from "./public-query-errors.js";

const log = getModuleLogger("McpPublicPolicy");
const MAX_DEPTH = 32;
const MAX_VISITED_VALUES = 100_000;
const MAX_SERIALIZED_OUTPUT_BYTES = 4_194_304;

const DENIED_FIELDS = new Set([
  "email",
  "email_address",
  "ip",
  "ip_address",
  "remote_ip",
  "client_ip",
  "proxy_ip",
  "origin_ip",
  "password",
  "passwd",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "authorization_header",
  "cookie",
  "cookies",
  "private_key",
  "seed_phrase",
  "mnemonic",
  "secret",
  "api_key",
  "jwt",
  "jwt_payload",
  "turso_token",
  "database_url",
  "database_credentials",
  "connection_string",
  "internal",
  "internal_state",
  "auth_state",
  "authentication_state",
  "client_connection_ip",
  "connection_ip",
  "source_ip",
  "destination_ip",
  "client_ipv6",
  "remote_ipv6",
  "cloudflare_metadata",
  "stack_trace",
  "sql_error",
]);

export interface PublicMcpPolicyMetrics {
  blockedSensitiveFieldsTotal: number;
  sanitizationFailuresTotal: number;
}

export class PublicMcpSanitizationError extends Error {
  constructor() {
    super("Public MCP output could not be sanitized");
    this.name = "PublicMcpSanitizationError";
  }
}

function normalizedFieldName(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
}

function sensitiveFieldName(key: string): boolean {
  const normalized = normalizedFieldName(key);
  if (DENIED_FIELDS.has(normalized)) return true;
  return /(?:^|_)(?:email|password|passwd|token|secret|private_key|api_key|jwt|cookie|authorization|client_ip|remote_ip|proxy_ip|origin_ip|connection_ip|source_ip)$/.test(
    normalized,
  );
}

export class PublicMcpDataPolicy {
  private readonly metrics: PublicMcpPolicyMetrics = {
    blockedSensitiveFieldsTotal: 0,
    sanitizationFailuresTotal: 0,
  };

  sanitize(value: unknown): unknown {
    const seen = new WeakSet<object>();
    const state = { visited: 0 };
    try {
      return this.sanitizeValue(value, 0, seen, state);
    } catch (error) {
      this.metrics.sanitizationFailuresTotal += 1;
      log.error("Public MCP sanitizer failed closed", {
        errorCode: "mcp_output_sanitization_failed",
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      throw new PublicMcpSanitizationError();
    }
  }

  getMetrics(): PublicMcpPolicyMetrics {
    return { ...this.metrics };
  }

  serialize(value: Record<string, unknown>): string {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > MAX_SERIALIZED_OUTPUT_BYTES) {
      this.metrics.sanitizationFailuresTotal += 1;
      log.error("Public MCP output exceeded the serialization limit", {
        errorCode: "mcp_output_size_exceeded",
      });
      throw new PublicMcpSanitizationError();
    }
    return serialized;
  }

  private sanitizeValue(
    value: unknown,
    depth: number,
    seen: WeakSet<object>,
    state: { visited: number },
  ): unknown {
    state.visited += 1;
    if (depth > MAX_DEPTH || state.visited > MAX_VISITED_VALUES) {
      throw new Error("sanitizer complexity limit exceeded");
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("non-finite number");
      return value;
    }
    if (typeof value === "string") return value;
    if (typeof value !== "object") {
      throw new Error("unsupported output value");
    }
    if (seen.has(value)) throw new Error("cyclic output value");
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        return value.map((item) =>
          this.sanitizeValue(item, depth + 1, seen, state),
        );
      }
      if (Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error("non-plain output object");
      }
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (sensitiveFieldName(key)) {
          this.metrics.blockedSensitiveFieldsTotal += 1;
          continue;
        }
        output[key] = this.sanitizeValue(item, depth + 1, seen, state);
      }
      return output;
    } finally {
      seen.delete(value);
    }
  }
}

export async function publicMcpToolResult(
  policy: PublicMcpDataPolicy,
  toolName: string,
  value: object | Promise<object>,
) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  let failureCode = "mcp_query_failed";
  try {
    const resolved = await value;
    failureCode = "mcp_output_sanitization_failed";
    const sanitized = policy.sanitize(resolved);
    if (
      typeof sanitized !== "object" ||
      sanitized === null ||
      Array.isArray(sanitized)
    ) {
      throw new PublicMcpSanitizationError();
    }
    const structuredContent = sanitized as Record<string, unknown>;
    const serializedContent = policy.serialize(structuredContent);
    const data = structuredContent.data;
    const resultCount = Array.isArray(data)
      ? data.length
      : data === null
        ? 0
        : 1;
    const meta = structuredContent.meta;
    const truncated =
      typeof meta === "object" &&
      meta !== null &&
      "truncated" in meta &&
      meta.truncated === true;
    log.info("Public MCP tool completed", {
      requestId,
      toolName,
      durationMs: Date.now() - startedAt,
      success: true,
      resultCount,
      truncated,
    });
    return {
      content: [{ type: "text" as const, text: serializedContent }],
      structuredContent,
    };
  } catch (error) {
    if (error instanceof PublicQueryInputError) {
      log.info("Public MCP tool rejected invalid arguments", {
        requestId,
        toolName,
        durationMs: Date.now() - startedAt,
        success: false,
        errorCode: "invalid_request",
        reason: error.reason,
        resultCount: 0,
        truncated: false,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              code: "invalid_request",
              reason: error.reason,
              message: error.message,
            }),
          },
        ],
        isError: true,
      };
    }
    log.warn("Public MCP tool failed safely", {
      requestId,
      toolName,
      durationMs: Date.now() - startedAt,
      success: false,
      errorCode: failureCode,
      resultCount: 0,
      truncated: false,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            code: "safe_internal_error",
            message: "The public result could not be returned safely.",
          }),
        },
      ],
      isError: true,
    };
  }
}
