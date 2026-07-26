#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  type ApplicationDatabase,
  DATABASE_FILE,
  openExistingProductionDatabase,
} from "./database.js";
import { BrokerStateStore, type PublicBanSummary } from "./state-store.js";
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
  return [
    "Användning:",
    "  mc-mqtt status",
    "  mc-mqtt observer list",
    "  mc-mqtt abuse list",
    "  mc-mqtt abuse clearall",
    "  mc-mqtt abuse remove PUBLIC_KEY",
    "  mc-mqtt reset [--force]",
  ].join("\n");
}

function formatTime(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${timeFormat.format(new Date(value))} Europe/Stockholm`
    : "-";
}

function shortKey(publicKey: string): string {
  return publicKey.length > 18
    ? `${publicKey.slice(0, 10)}...${publicKey.slice(-6)}`
    : publicKey;
}

function printTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) {
    console.log("(tomt)");
    return;
  }
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const formatRow = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  console.log(formatRow(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(formatRow(row));
}

async function confirmReset(): Promise<boolean> {
  const terminal = createInterface({ input, output });
  try {
    const answer = await terminal.question(
      `Detta tömmer all programdata i ${DATABASE_FILE}, men tar inte bort filen eller katalogen. Fortsätt? [y/N] `,
    );
    return answer.trim().toLowerCase() === "y";
  } finally {
    terminal.close();
  }
}

export async function runCli(
  argv = process.argv.slice(2),
  dependencies: {
    confirmReset?: () => Promise<boolean>;
    database?: ApplicationDatabase;
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

  const database =
    dependencies.database ?? (await openExistingProductionDatabase());
  const instanceId = resolveBrokerInstanceId({
    brokerName: configString(["broker", "name"], "Broker"),
    runtimeIdFile: configString(["broker", "runtime_id_file"]),
  });
  const store = new BrokerStateStore(database, instanceId);

  try {
    const [command, subcommand, value] = argv.filter(
      (argument) => !argument.startsWith("--"),
    );
    if (command === "status" && !subcommand) {
      await database.probe();
      const [observerCount, banCount] = await Promise.all([
        store.countObservers(),
        store.countPublicBans(),
      ]);
      console.log(`Databas: ${DATABASE_FILE}`);
      console.log("Turso: tillgänglig");
      console.log(`Observatörer: ${observerCount}`);
      console.log(`Aktiva skyddstillstånd: ${banCount}`);
      return 0;
    }

    if (command === "observer" && subcommand === "list") {
      const observers = await store.listObservers();
      const names = await store.getObserverNodeNames(
        observers.map((observer) => observer.publicKey),
      );
      printTable(
        ["Observer", "Namn", "Region", "Aktiv", "Senast", "Meddelanden"],
        observers.map((observer) => [
          shortKey(observer.publicKey),
          names.get(observer.publicKey) || observer.label || "-",
          observer.region || "-",
          observer.active ? "ja" : "nej",
          formatTime(observer.lastSeenAt),
          String(observer.messageCount),
        ]),
      );
      const observerCount = await store.countObservers();
      if (observerCount > observers.length) {
        console.log(
          `Visar ${observers.length} av ${observerCount} observatörer (senast aktiva först).`,
        );
      }
      return 0;
    }

    if (command === "abuse" && subcommand === "list") {
      const bans = await store.listPublicBans(0);
      printTable(
        ["Public key", "Namn", "Status", "Orsak", "Antal", "Till"],
        bans.map((ban: PublicBanSummary) => [
          shortKey(ban.node),
          ban.label || "-",
          ban.status,
          ban.reason,
          String(ban.blockCount),
          formatTime(ban.mutedUntil),
        ]),
      );
      return 0;
    }

    if (command === "abuse" && subcommand === "clearall") {
      const removed = await store.clearPublicBans();
      console.log(`Tog bort ${removed} skyddstillstånd.`);
      return 0;
    }

    if (command === "abuse" && subcommand === "remove") {
      const normalized = value?.trim().toUpperCase();
      if (!normalized || !/^[0-9A-F]{64}$/.test(normalized)) {
        throw new Error("Ange en giltig public key med 64 hex-tecken.");
      }
      const removed = await store.removePublicBan(normalized);
      console.log(
        removed
          ? `Tog bort skyddstillståndet för ${normalized}.`
          : `Inget skyddstillstånd hittades för ${normalized}.`,
      );
      return 0;
    }

    if (command === "reset" && !subcommand) {
      const confirmed =
        argv.includes("--force") ||
        (await (dependencies.confirmReset ?? confirmReset)());
      if (!confirmed) {
        console.log("Avbrutet. Databasen ändrades inte.");
        return 0;
      }
      const removed = await store.resetApplicationState();
      console.log(`Programtillståndet tömdes (${removed} rader borttagna).`);
      return 0;
    }

    throw new Error(`Okänt kommando.\n${usage()}`);
  } finally {
    await store.close();
    if (!dependencies.database) await database.close();
  }
}

function isEntrypoint(): boolean {
  return (
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
