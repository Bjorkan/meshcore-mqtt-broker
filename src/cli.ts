#!/usr/bin/env bun
import { configString } from "./config.js";
import { getModuleLogger } from "./logger.js";

const log = getModuleLogger("CLI");

function usage(): string {
  return "Användning:\n  mc-mqtt status";
}

async function fetchBrokerStatus(): Promise<{
  instanceId?: unknown;
  uptimeMs?: unknown;
  observers?: unknown;
  storage?: unknown;
} | null> {
  const port =
    configString(["healthcheck", "http_port"]) ||
    configString(["mqtt", "ws_port"], "8883");
  const url =
    configString(["healthcheck", "http_url"]) ||
    `http://127.0.0.1:${port}/status`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  if (
    argv.length === 0 ||
    (argv.length === 1 && ["--help", "-h"].includes(argv[0]))
  ) {
    console.log(usage());
    return argv.length === 0 ? 1 : 0;
  }
  if (argv.length !== 1 || argv[0] !== "status") {
    throw new Error(`Okänt kommando eller argument.\n${usage()}`);
  }
  // Single-broker design: the identity is per-process and rotates on
  // restart. Query the live broker instead of fabricating an id.
  const live = await fetchBrokerStatus();
  if (live) {
    const brokerId =
      typeof live.instanceId === "string" ? live.instanceId : "(okänd)";
    console.log(`Broker: ${brokerId}`);
    console.log("Lagring: stateless (ingen databas)");
    if (typeof live.uptimeMs === "number") {
      console.log(`Uptime: ${Math.round(live.uptimeMs / 1000)}s`);
    }
    if (typeof live.observers === "number") {
      console.log(`Observatörer: ${live.observers}`);
    }
  } else {
    console.log("Broker: (kör inte — ingen kontakt via GET /status)");
    console.log("Lagring: stateless (ingen databas)");
  }
  return 0;
}

function isEntrypoint(): boolean {
  return (
    process.argv[1]?.endsWith("/cli.ts") ||
    process.argv[1]?.endsWith("/cli.js") ||
    process.argv[1]?.endsWith("/mc-mqtt")
  );
}

if (isEntrypoint()) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
