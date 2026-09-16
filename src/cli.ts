#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { configString } from "./config.js";
import { getModuleLogger } from "./logger.js";

const log = getModuleLogger("CLI");

function usage(): string {
  return ["Användning:", "  mc-mqtt status", "  mc-mqtt observer list"].join(
    "\n",
  );
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

export async function runCli(
  argv = process.argv.slice(2),
  dependencies: {
    confirmReset?: () => Promise<boolean>;
  } = {},
): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return argv.length === 0 ? 1 : 0;
  }
  if (argv.some((argument) => argument.startsWith("--database"))) {
    throw new Error(
      "Databassökvägen är fast och kan inte anges som ett argument.",
    );
  }

  try {
    const [command, subcommand] = argv.filter(
      (argument) => !argument.startsWith("--"),
    );
    if (command === "status" && !subcommand) {
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

    if (command === "observer" && subcommand === "list") {
      console.log("(tomt)");
      console.log(
        "Observatörslistan är processlokal och kräver en körande broker.",
      );
      return 0;
    }

    if (command === "abuse") {
      console.log(
        "Missbruksskyddet är observe-only; IP-blockering hanteras av CrowdSec/Traefik.",
      );
      return 0;
    }

    if (command === "reset") {
      if (!process.stdin.isTTY && dependencies.confirmReset === undefined) {
        console.log(
          "Inget bestående tillstånd att tömma (stateless). Bekräfta med --force i interaktiv terminal.",
        );
        return 0;
      }
      const terminal = createInterface({ input, output });
      try {
        const answer = await (dependencies.confirmReset
          ? dependencies.confirmReset()
          : terminal.question(
              `Detta återställer inget bestående tillstånd (stateless). Fortsätt? [y/N] `,
            ));
        if (
          typeof answer === "string" &&
          answer.trim().toLowerCase() !== "y" &&
          dependencies.confirmReset === undefined
        ) {
          console.log("Avbrutet. Inget ändrades.");
          return 0;
        }
      } finally {
        terminal.close();
      }
      console.log("Inget bestående tillstånd att tömma (stateless).");
      return 0;
    }

    throw new Error(`Okänt kommando.\n${usage()}`);
  } catch (error) {
    void log;
    throw error;
  }
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
