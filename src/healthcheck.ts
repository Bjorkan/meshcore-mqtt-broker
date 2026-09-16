import { pathToFileURL } from "url";
import { configInt, configString } from "./config.js";
import { getModuleLogger } from "./logger.js";

const log = getModuleLogger("Healthcheck");

const DEFAULT_HEALTHCHECK_TIMEOUT_MS = 8_000;
const DEFAULT_HEALTHCHECK_PORT = "8883";

export interface HttpStatusHealthcheckOptions {
  url: string;
  timeoutMs: number;
}

function readTimeoutMs(): number {
  return configInt(
    ["healthcheck", "http_timeout_ms"],
    DEFAULT_HEALTHCHECK_TIMEOUT_MS,
    {
      min: 1_000,
      max: 10_000,
    },
  );
}

/**
 * Docker HEALTHCHECK: probe GET /status on the shared listener. The broker
 * is stateless with no volume, so no MQTT credentials are needed — the
 * endpoint reports { status: "ok", storage: "stateless", ... } when alive.
 * Query strings are not matched by the broker, so the path is exactly
 * /status (no trailing slash).
 */
export function resolveHealthcheckOptionsFromConfig(): HttpStatusHealthcheckOptions {
  const port =
    configString(["healthcheck", "http_port"]) ||
    configString(["mqtt", "ws_port"], DEFAULT_HEALTHCHECK_PORT);
  const url =
    configString(["healthcheck", "http_url"]) ||
    `http://127.0.0.1:${port}/status`;
  if (!/^https?:\/\/[^/]+\/status$/.test(url)) {
    throw new Error(
      `Configuration value healthcheck.http_url must be an http(s) URL with exact path /status, got "${url}"`,
    );
  }
  return { url, timeoutMs: readTimeoutMs() };
}

export async function runHttpStatusHealthcheck(
  options: HttpStatusHealthcheckOptions,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(options.url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) {
      throw new Error(
        `Healthcheck: GET ${options.url} returned HTTP ${response.status}`,
      );
    }
    const body = (await response.json()) as {
      status?: unknown;
      storage?: unknown;
    };
    if (body.status !== "ok" || body.storage !== "stateless") {
      throw new Error(
        `Healthcheck: unexpected /status body: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(
        `Healthcheck: GET ${options.url} timed out after ${options.timeoutMs} ms`,
      );
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

// Backwards-compatible alias for tests and external callers.
export const runMqttLoopbackHealthcheck = runHttpStatusHealthcheck;
export type MqttLoopbackHealthcheckOptions = HttpStatusHealthcheckOptions;

function isEntrypoint(): boolean {
  return (
    Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

if (isEntrypoint()) {
  try {
    const options = resolveHealthcheckOptionsFromConfig();
    await runHttpStatusHealthcheck(options);
    log.info(`Healthcheck: GET ${options.url} ok (stateless)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(message);
    process.exit(1);
  }
}
