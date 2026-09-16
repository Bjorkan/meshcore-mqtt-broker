#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { configString } from "./config.js";
import { resolveBrokerInstanceId } from "./instance-id.js";
import { getModuleLogger } from "./logger.js";

const log = getModuleLogger("CLI");

const timeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function usage(): string {
  return ["Användning:", "  mc-mqtt status", "  mc-mqtt observer list"].join(
    "\n",
  );
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

  const instanceId = resolveBrokerInstanceId({
    brokerName: configString(["broker", "name"], "Broker"),
  });

  try {
    const [command, subcommand] = argv.filter(
      (argument) => !argument.startsWith("--"),
    );
    if (command === "status" && !subcommand) {
      console.log(`Broker: ${instanceId}`);
      console.log("Lagring: stateless (ingen databas)");
      console.log(`Startad: ${timeFormat.format(new Date())} Europe/Stockholm`);
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
