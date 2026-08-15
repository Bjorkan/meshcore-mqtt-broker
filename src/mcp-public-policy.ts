import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { getModuleLogger } from "./logger.js";

const log = getModuleLogger("McpPublicPolicy");
const REDACTED_EMAIL = "[REDACTED_EMAIL]";
const REDACTED_IP = "[REDACTED_IP]";
const REDACTED_SECRET = "[REDACTED_SECRET]";
const REDACTED_INTERNAL = "[REDACTED_INTERNAL]";
const REDACTED_PATH = "[REDACTED_PATH]";
const MAX_DEPTH = 32;
const MAX_VISITED_VALUES = 100_000;

const EMAIL_PATTERN =
  /(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}(?![A-Z0-9._%+-])/gi;
const IPV4_PATTERN = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
const IPV6_CANDIDATE_PATTERN = /\[?[0-9A-Fa-f:.]{2,}\]?/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_PATTERN =
  /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const PEM_PRIVATE_PATTERN =
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gi;
const LABELED_SECRET_PATTERN =
  /\b(?:api[_ -]?key|password|passwd|secret|turso[_ -]?token|mqtt[_ -]?(?:password|token)|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*[^\s,;]+/gi;
const FORBIDDEN_TOPIC_PATTERN =
  /(?:\$SYS(?:\/[^\s"']*)?|\/internal(?:\/[^\s"']*)?|\/serial\/(?:commands|responses)(?:\/[^\s"']*)?)/gi;
const SENSITIVE_PATH_PATTERN =
  /(?:\/data\/meshcore-mqtt-broker(?:\/[^\s"']*)?|\/home\/[^\s"']+\/(?:\.env|config\.ya?ml|[^\s"']*\.db))/gi;

const ALWAYS_ALLOWED_FIELDS = new Set([
  "public_key",
  "observer_public_key",
  "node_public_key",
  "neighbor_public_key",
  "resolved_public_key",
  "sender_public_key",
  "destination_public_key",
  "raw_packet_hex",
  "packet_hash",
  "prefix_hex",
  "path",
  "paths",
]);

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
  "cloudflare_metadata",
  "stack_trace",
  "sql_error",
]);

export interface PublicMcpPolicyMetrics {
  redactedEmailsTotal: number;
  redactedIpsTotal: number;
  redactedSecretsTotal: number;
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
  if (ALWAYS_ALLOWED_FIELDS.has(normalized)) return false;
  if (DENIED_FIELDS.has(normalized)) return true;
  return /(?:^|_)(?:email|password|passwd|token|secret|private_key|api_key|jwt|cookie|authorization|client_ip|remote_ip|proxy_ip|origin_ip)$/.test(
    normalized,
  );
}

export class PublicMcpDataPolicy {
  private readonly metrics: PublicMcpPolicyMetrics = {
    redactedEmailsTotal: 0,
    redactedIpsTotal: 0,
    redactedSecretsTotal: 0,
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
    if (typeof value === "string") return this.sanitizeString(value);
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

  private sanitizeString(value: string): string {
    let output = value.replace(EMAIL_PATTERN, () => {
      this.metrics.redactedEmailsTotal += 1;
      return REDACTED_EMAIL;
    });
    output = output.replace(IPV4_PATTERN, (candidate) => {
      if (isIP(candidate) !== 4) return candidate;
      this.metrics.redactedIpsTotal += 1;
      return REDACTED_IP;
    });
    output = output.replace(IPV6_CANDIDATE_PATTERN, (candidate) => {
      const unwrapped = candidate.replace(/^\[/, "").replace(/\]$/, "");
      if (isIP(unwrapped) !== 6) return candidate;
      this.metrics.redactedIpsTotal += 1;
      return REDACTED_IP;
    });
    output = output.replace(BEARER_PATTERN, () => {
      this.metrics.redactedSecretsTotal += 1;
      return REDACTED_SECRET;
    });
    output = output.replace(JWT_PATTERN, () => {
      this.metrics.redactedSecretsTotal += 1;
      return REDACTED_SECRET;
    });
    output = output.replace(PEM_PRIVATE_PATTERN, () => {
      this.metrics.redactedSecretsTotal += 1;
      return REDACTED_SECRET;
    });
    output = output.replace(LABELED_SECRET_PATTERN, () => {
      this.metrics.redactedSecretsTotal += 1;
      return REDACTED_SECRET;
    });
    output = output.replace(FORBIDDEN_TOPIC_PATTERN, REDACTED_INTERNAL);
    output = output.replace(SENSITIVE_PATH_PATTERN, REDACTED_PATH);
    return output;
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
      content: [
        { type: "text" as const, text: JSON.stringify(structuredContent) },
      ],
      structuredContent,
    };
  } catch {
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
