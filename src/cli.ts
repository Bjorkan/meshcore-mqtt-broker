#!/usr/bin/env node
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { configString } from "./config.js";
import {
  ClusterStateStore,
  type ClusterInstanceReadiness,
  type DashboardInstanceMetrics,
  type InstanceObserverEntry,
  type PublicBanSummary,
} from "./orchestration.js";
import { resolveBrokerInstanceId } from "./instance-id.js";

interface CliOptions {
  kvUrl: string;
  namespace: string;
  instanceId: string;
}

interface ObserverRow {
  publicKey: string;
  owner: string;
  label?: string;
  region?: string;
  lastSeenAt?: number;
  messageCount?: number;
}

const timeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function resolveOptions(): CliOptions {
  const kvUrl = configString(["broker", "kv_url"]);
  if (!kvUrl) {
    throw new Error("broker.kv_url saknas i config.yaml.");
  }

  return {
    kvUrl,
    namespace: configString(["broker", "kv_namespace"], "meshcore-mqtt-broker"),
    instanceId: resolveBrokerInstanceId({
      brokerName: configString(["broker", "name"], "Broker"),
      runtimeIdFile: configString(["broker", "runtime_id_file"]),
    }),
  };
}

function usage(): string {
  return [
    "Användning:",
    "  mc-mqtt status",
    "  mc-mqtt status --cluster",
    "  mc-mqtt observer list",
    "  mc-mqtt observer list --cluster",
    "  mc-mqtt abuse list",
    "  mc-mqtt abuse clearall",
    "  mc-mqtt abuse remove PUBLIC_KEY",
    "  mc-mqtt reset",
  ].join("\n");
}

function formatTime(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${timeFormat.format(new Date(value))} Europe/Stockholm`
    : "-";
}

function ageMs(value: number | undefined, now = Date.now()): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  const age = Math.max(0, now - value);
  if (age < 1000) return "nu";
  const seconds = Math.round(age / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
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
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

function readinessByInstance(
  readiness: ClusterInstanceReadiness[],
): Map<string, ClusterInstanceReadiness> {
  return new Map(readiness.map((entry) => [entry.instanceId, entry]));
}

function statusRows(
  metrics: DashboardInstanceMetrics[],
  readiness: ClusterInstanceReadiness[],
  onlyInstance?: string,
): string[][] {
  const ready = readinessByInstance(readiness);
  return metrics
    .filter((entry) => !onlyInstance || entry.instanceId === onlyInstance)
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
    .map((entry) => {
      const readyEntry = ready.get(entry.instanceId);
      const readyText = readyEntry?.status === "ready" ? "ja" : "nej";
      return [
        entry.instanceId,
        readyText,
        String(entry.publisherClients),
        String(entry.connectedClients),
        String(entry.messagesLastMinute ?? 0),
        formatTime(entry.startedAt),
        ageMs(entry.lastUpdatedAt),
      ];
    });
}

async function handleStatus(
  store: ClusterStateStore,
  options: CliOptions,
  cluster: boolean,
): Promise<void> {
  const [readiness, metrics] = await Promise.all([
    store.listInstanceReadiness(),
    store.listInstanceMetrics(),
  ]);
  const rows = statusRows(
    metrics,
    readiness,
    cluster ? undefined : options.instanceId,
  );
  printTable(
    [
      "Broker",
      "Ready",
      "Observers",
      "Clients",
      "Pub/min",
      "Startad",
      "Uppdaterad",
    ],
    rows,
  );
  if (!cluster && rows.length === 0) {
    console.log(`Ingen status hittades för instansen ${options.instanceId}.`);
  }
}

function observerRows(
  claims: Map<string, string>,
  observers: InstanceObserverEntry[],
  names: Map<string, string>,
  onlyInstance?: string,
): ObserverRow[] {
  const observersByKey = new Map(
    observers.map((observer) => [observer.publicKey.toUpperCase(), observer]),
  );
  return Array.from(claims.entries())
    .filter(([, owner]) => !onlyInstance || owner === onlyInstance)
    .map(([publicKey, owner]) => {
      const observer = observersByKey.get(publicKey);
      return {
        publicKey,
        owner,
        label: names.get(publicKey) || observer?.label,
        region: observer?.region,
        lastSeenAt: observer?.lastSeenAt,
        messageCount: observer?.messageCount,
      };
    })
    .sort(
      (a, b) =>
        a.owner.localeCompare(b.owner) ||
        (a.label || a.publicKey).localeCompare(b.label || b.publicKey),
    );
}

async function handleObserverList(
  store: ClusterStateStore,
  options: CliOptions,
  cluster: boolean,
): Promise<void> {
  const [claims, observers] = await Promise.all([
    store.listObserverClaims(),
    store.listInstanceObservers(),
  ]);
  const names = await store.getObserverNodeNames(Array.from(claims.keys()));
  const rows = observerRows(
    claims,
    observers,
    names,
    cluster ? undefined : options.instanceId,
  ).map((observer) => [
    shortKey(observer.publicKey),
    observer.label || "-",
    observer.owner,
    observer.region || "-",
    observer.lastSeenAt ? ageMs(observer.lastSeenAt) : "-",
    String(observer.messageCount ?? 0),
  ]);
  printTable(
    ["Observer", "Namn", "Broker", "Region", "Senast", "Meddelanden"],
    rows,
  );
}

async function handleAbuseList(store: ClusterStateStore): Promise<void> {
  const bans = await store.listPublicBans(0);
  const rows = bans.map((ban: PublicBanSummary) => [
    shortKey(ban.node),
    ban.label || "-",
    ban.status,
    ban.reason,
    String(ban.blockCount),
    ban.broker,
    ban.mutedUntil ? formatTime(ban.mutedUntil) : "-",
  ]);
  printTable(
    ["Public key", "Namn", "Status", "Orsak", "Antal", "Broker", "Till"],
    rows,
  );
}

async function handleAbuseClearAll(store: ClusterStateStore): Promise<void> {
  const removed = await store.clearPublicBans();
  console.log(
    `Tömde nekadlistan: ${removed} nekad post${removed === 1 ? "" : "er"} borttag${removed === 1 ? "en" : "na"}.`,
  );
}

async function handleAbuseRemove(
  store: ClusterStateStore,
  publicKey: string | undefined,
): Promise<void> {
  const normalized = publicKey?.trim().toUpperCase();
  if (!normalized || !/^[0-9A-F]{64}$/.test(normalized)) {
    throw new Error("Ange en giltig public key med 64 hex-tecken.");
  }

  const removed = await store.removePublicBan(normalized);
  console.log(
    removed
      ? `Tog bort nekad post för ${normalized}.`
      : `Ingen nekad post hittades för ${normalized}.`,
  );
}

async function confirmReset(namespace: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Detta tömmer ALL Valkey-state i namespace "${namespace}". Fortsätt? [y/N] `,
    );
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

async function handleReset(
  store: ClusterStateStore,
  options: CliOptions,
  confirm: (namespace: string) => Promise<boolean>,
): Promise<void> {
  const confirmed = await confirm(options.namespace);
  if (!confirmed) {
    console.log("Avbrutet. Valkey ändrades inte.");
    return;
  }

  const removed = await store.resetNamespace();
  console.log(
    `Valkey namespace "${options.namespace}" tömt: ${removed} nyckel${removed === 1 ? "" : "ar"} borttag${removed === 1 ? "en" : "na"}.`,
  );
}

export async function runCli(
  argv = process.argv.slice(2),
  dependencies: { confirmReset?: (namespace: string) => Promise<boolean> } = {},
): Promise<number> {
  const args = [...argv];
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return args.length === 0 ? 1 : 0;
  }

  const options = resolveOptions();
  const store = new ClusterStateStore({
    kvUrl: options.kvUrl,
    namespace: options.namespace,
    instanceId: options.instanceId,
    backgroundRefresh: false,
  });

  try {
    const [command, subcommand, value] = args.filter(
      (arg) => !arg.startsWith("--"),
    );
    const cluster = args.includes("--cluster");

    if (command === "status" && !subcommand) {
      await handleStatus(store, options, cluster);
      return 0;
    }

    if (command === "observer" && subcommand === "list") {
      await handleObserverList(store, options, cluster);
      return 0;
    }

    if (command === "abuse" && subcommand === "list") {
      await handleAbuseList(store);
      return 0;
    }

    if (command === "abuse" && subcommand === "clearall") {
      await handleAbuseClearAll(store);
      return 0;
    }

    if (command === "abuse" && subcommand === "remove") {
      await handleAbuseRemove(store, value);
      return 0;
    }

    if (command === "reset" && !subcommand) {
      await handleReset(
        store,
        options,
        dependencies.confirmReset || confirmReset,
      );
      return 0;
    }

    throw new Error(`Okänt kommando.\n${usage()}`);
  } finally {
    await store.disconnect();
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
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[mc-mqtt] ${message}`);
    process.exitCode = 1;
  }
}
