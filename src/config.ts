import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import type { AbuseConfig } from "./abuse-detector.js";
import type { MeshcoreIoConfig } from "./meshcore-io-types.js";
import { resolveBrokerInstanceId } from "./instance-id.js";

type ConfigDocument = Record<string, unknown>;

export interface MqttConfig {
  wsPort: number;
  dashboardPort: number;
  host: string;
  expectedAudience: string;
  jsonPublishMaxBytes: number;
  wsMaxPayloadBytes: number;
  nodeNameCacheTtlMs: number;
  kvUrl: string;
  kvNamespace: string;
  instanceId: string;
  allowedRegions: string[];
  allowedRegionSources: string[];
}

export interface SubscriberUserConfig {
  username: string;
  password: string;
  role?: number;
  maxConnections?: number;
}

export interface SubscriberConfig {
  defaultMaxConnections: number;
  users: SubscriberUserConfig[];
}

interface NumberBounds {
  min?: number;
  max?: number;
  greaterThan?: number;
  lessThan?: number;
}

interface SettingSpec {
  path: string[];
}

const DEFAULT_CONFIG_PATHS = [
  "config.yaml",
  "broker/config.yaml",
  "/run/configs/meshcore-mqtt-broker-config.yaml",
  "/run/configs/config.yaml",
];

let cachedConfig: { path?: string; document: ConfigDocument } | undefined;

function failConfig(message: string): never {
  console.error(`KRITISKT: ${message}`);
  console.error("Kontrollera broker/config.yaml.");
  process.exit(1);
}

function findConfigYaml(): string | undefined {
  const configDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...DEFAULT_CONFIG_PATHS.map((path) => join(process.cwd(), path)),
    join(configDir, "..", "config.yaml"),
    join(configDir, "..", "..", "broker", "config.yaml"),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

export function loadConfigDocument(): {
  path?: string;
  document: ConfigDocument;
} {
  if (cachedConfig) {
    return cachedConfig;
  }

  const path = findConfigYaml();
  if (!path) {
    cachedConfig = { document: {} };
    return cachedConfig;
  }

  try {
    const parsed: unknown = parseYaml(readFileSync(path, "utf-8"));
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      failConfig(
        `config.yaml måste innehålla ett YAML-objekt i roten (${path})`,
      );
    }
    cachedConfig = { path, document: parsed as ConfigDocument };
    return cachedConfig;
  } catch (error) {
    failConfig(
      `Kunde inte läsa config.yaml (${path}): ${(error as Error).message}`,
    );
  }
}

export function resetConfigCacheForTests(): void {
  cachedConfig = undefined;
}

export function setConfigDocumentForTests(document: ConfigDocument): void {
  cachedConfig = { path: "<test>", document };
}

function readPath(document: ConfigDocument, path: string[]): unknown {
  let current: unknown = document;
  for (const part of path) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !(part in current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function settingName(spec: SettingSpec): string {
  return spec.path.join(".");
}

function optionalSetting(spec: SettingSpec): string | undefined {
  return stringValue(readPath(loadConfigDocument().document, spec.path));
}

function requiredSetting(spec: SettingSpec): string {
  const rawValue = optionalSetting(spec);
  if (rawValue === undefined || rawValue.trim() === "") {
    failConfig(`Konfigvärdet ${settingName(spec)} saknas eller är tomt`);
  }

  return rawValue.trim();
}

function requiredAudience(spec: SettingSpec): string {
  const rawValue = optionalSetting(spec);
  if (rawValue === undefined) {
    failConfig(
      `Konfigvärdet ${settingName(spec)} saknas. Sätt ett värde, eller sätt tom sträng för att inaktivera audience-validering`,
    );
  }

  if (rawValue === "") {
    return "";
  }

  const value = rawValue.trim();
  if (value === "") {
    failConfig(
      `Konfigvärdet ${settingName(spec)} får vara tomt eller ett icke-tomt värde, men inte bara mellanslag`,
    );
  }

  return value;
}

function validateNumber(
  name: string,
  value: number,
  options: NumberBounds,
): number {
  if (options.min !== undefined && value < options.min) {
    failConfig(`Konfigvärdet ${name} måste vara minst ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    failConfig(`Konfigvärdet ${name} får vara högst ${options.max}`);
  }
  if (options.greaterThan !== undefined && value <= options.greaterThan) {
    failConfig(
      `Konfigvärdet ${name} måste vara större än ${options.greaterThan}`,
    );
  }
  if (options.lessThan !== undefined && value >= options.lessThan) {
    failConfig(`Konfigvärdet ${name} måste vara mindre än ${options.lessThan}`);
  }

  return value;
}

function parseInteger(
  name: string,
  rawValue: string,
  options: NumberBounds = {},
): number {
  if (!/^[+-]?\d+$/.test(rawValue)) {
    failConfig(
      `Konfigvärdet ${name} måste vara ett heltal, fick "${rawValue}"`,
    );
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) {
    failConfig(
      `Konfigvärdet ${name} måste vara ett säkert heltal, fick "${rawValue}"`,
    );
  }

  return validateNumber(name, value, options);
}

function parseFloatValue(
  name: string,
  rawValue: string,
  options: NumberBounds = {},
): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    failConfig(
      `Konfigvärdet ${name} måste vara ett giltigt tal, fick "${rawValue}"`,
    );
  }

  return validateNumber(name, value, options);
}

function requiredInt(spec: SettingSpec, options: NumberBounds = {}): number {
  return parseInteger(settingName(spec), requiredSetting(spec), options);
}

function optionalInt(
  spec: SettingSpec,
  defaultValue: number,
  options: NumberBounds = {},
): number {
  const rawValue = optionalSetting(spec);
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  return parseInteger(settingName(spec), rawValue.trim(), options);
}

function requiredFloat(spec: SettingSpec, options: NumberBounds = {}): number {
  return parseFloatValue(settingName(spec), requiredSetting(spec), options);
}

function optionalFloat(
  spec: SettingSpec,
  defaultValue: number,
  options: NumberBounds = {},
): number {
  const rawValue = optionalSetting(spec);
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  return parseFloatValue(settingName(spec), rawValue.trim(), options);
}

function requiredBool(spec: SettingSpec): boolean {
  const value = requiredSetting(spec).toLowerCase();
  if (value !== "true" && value !== "false") {
    failConfig(
      `Konfigvärdet ${settingName(spec)} måste vara "true" eller "false", fick "${value}"`,
    );
  }

  return value === "true";
}

function optionalString(spec: SettingSpec, defaultValue: string): string {
  const value = optionalSetting(spec);
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  return value.trim();
}

export function configString(path: string[], defaultValue = ""): string {
  return optionalString({ path }, defaultValue);
}

export function configBool(path: string[], defaultValue: boolean): boolean {
  const rawValue = optionalSetting({ path });
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  const lower = rawValue.toLowerCase();
  if (["1", "true", "yes", "on"].includes(lower)) return true;
  if (["0", "false", "no", "off"].includes(lower)) return false;

  failConfig(
    `Konfigvärdet ${path.join(".")} måste vara true/false/yes/no/on/off/1/0, fick "${rawValue}"`,
  );
}

export function configInt(
  path: string[],
  defaultValue: number,
  options: NumberBounds = {},
): number {
  return optionalInt({ path }, defaultValue, options);
}

function normalizeRegionList(rawRegions: string[]): string[] {
  const regions = new Set<string>();

  for (const rawRegion of rawRegions) {
    const region = rawRegion.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(region)) {
      regions.add(region);
    }
  }

  return Array.from(regions);
}

function regionsFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeRegionList(
      value.flatMap((entry) => (typeof entry === "string" ? [entry] : [])),
    );
  }

  if (value && typeof value === "object") {
    return normalizeRegionList(Object.keys(value));
  }

  return [];
}

function loadAllowedRegions(): { allowedRegions: string[]; sources: string[] } {
  const configRegions = regionsFromUnknown(
    readPath(loadConfigDocument().document, ["allowed_regions"]),
  );

  return {
    allowedRegions: configRegions,
    sources:
      configRegions.length > 0
        ? [`config.yaml allowed_regions (${configRegions.length})`]
        : [],
  };
}

const SETTINGS = {
  wsPort: { path: ["mqtt", "ws_port"] },
  dashboardPort: { path: ["dashboard", "port"] },
  host: { path: ["mqtt", "host"] },
  expectedAudience: { path: ["auth", "expected_audience"] },
  jsonPublishMaxBytes: { path: ["mqtt", "json_publish_max_bytes"] },
  wsMaxPayloadBytes: { path: ["mqtt", "ws_max_payload_bytes"] },
  nodeNameCacheTtlMs: { path: ["broker", "node_name_cache_ttl_ms"] },
  kvUrl: { path: ["broker", "kv_url"] },
  kvNamespace: { path: ["broker", "kv_namespace"] },
  brokerName: { path: ["broker", "name"] },
  brokerRuntimeIdFile: { path: ["broker", "runtime_id_file"] },
  subscriberDefaultMaxConnections: {
    path: ["subscribers", "default_max_connections"],
  },
  abuseDuplicateWindowSize: { path: ["abuse", "duplicate_window_size"] },
  abuseDuplicateWindowMs: { path: ["abuse", "duplicate_window_ms"] },
  abuseDuplicateThreshold: { path: ["abuse", "duplicate_threshold"] },
  abuseMaxDuplicatesPerPacket: { path: ["abuse", "max_duplicates_per_packet"] },
  abuseDuplicateRateThreshold: { path: ["abuse", "duplicate_rate_threshold"] },
  abuseDuplicateRateWindowMs: { path: ["abuse", "duplicate_rate_window_ms"] },
  abuseBucketCapacity: { path: ["abuse", "bucket_capacity"] },
  abuseBucketRefillRate: { path: ["abuse", "bucket_refill_rate"] },
  abuseMaxPacketSize: { path: ["abuse", "max_packet_size"] },
  abuseMaxTopicsPerDay: { path: ["abuse", "max_topics_per_day"] },
  abuseAnomalyThreshold: { path: ["abuse", "anomaly_threshold"] },
  abuseMaxIataChanges24h: { path: ["abuse", "max_iata_changes_24h"] },
  abuseTopicHistorySize: { path: ["abuse", "topic_history_size"] },
  abuseTopicHistoryWindowMs: { path: ["abuse", "topic_history_window_ms"] },
  abuseEnforcementEnabled: { path: ["abuse", "enforcement_enabled"] },
} satisfies Record<string, SettingSpec>;

export function loadMqttConfig(): MqttConfig {
  const { allowedRegions, sources } = loadAllowedRegions();

  return {
    wsPort: requiredInt(SETTINGS.wsPort, { min: 0, max: 65535 }),
    dashboardPort: optionalInt(SETTINGS.dashboardPort, 8080, {
      min: 0,
      max: 65535,
    }),
    host: requiredSetting(SETTINGS.host),
    expectedAudience: requiredAudience(SETTINGS.expectedAudience),
    jsonPublishMaxBytes: optionalInt(SETTINGS.jsonPublishMaxBytes, 8192, {
      min: 1,
    }),
    wsMaxPayloadBytes: optionalInt(SETTINGS.wsMaxPayloadBytes, 65536, {
      min: 1,
    }),
    nodeNameCacheTtlMs: optionalInt(
      SETTINGS.nodeNameCacheTtlMs,
      24 * 60 * 60 * 1000,
      { greaterThan: 0 },
    ),
    kvUrl: requiredSetting(SETTINGS.kvUrl),
    kvNamespace: optionalString(SETTINGS.kvNamespace, "meshcore-mqtt-broker"),
    instanceId: resolveBrokerInstanceId({
      persist: true,
      brokerName: optionalString(SETTINGS.brokerName, "Broker"),
      runtimeIdFile: optionalSetting(SETTINGS.brokerRuntimeIdFile),
    }),
    allowedRegions,
    allowedRegionSources: sources,
  };
}

export function loadSubscriberConfig() {
  const usersRaw = readPath(loadConfigDocument().document, [
    "subscribers",
    "users",
  ]);
  if (usersRaw !== undefined && !Array.isArray(usersRaw)) {
    failConfig("Konfigvärdet subscribers.users måste vara en lista");
  }

  const users = (Array.isArray(usersRaw) ? usersRaw : []).map(
    (entry, index): SubscriberUserConfig => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        failConfig(
          `Konfigvärdet subscribers.users[${index}] måste vara ett objekt`,
        );
      }
      const record = entry as Record<string, unknown>;
      const username = stringValue(record.username)?.trim();
      const password = stringValue(record.password)?.trim();
      if (!username || !password) {
        failConfig(
          `Konfigvärdet subscribers.users[${index}] måste ha username och password`,
        );
      }

      const roleRaw = stringValue(record.role);
      const maxConnectionsRaw = stringValue(
        record.max_connections ?? record.maxConnections,
      );

      return {
        username,
        password,
        role:
          roleRaw === undefined || roleRaw.trim() === ""
            ? undefined
            : parseInteger(`subscribers.users[${index}].role`, roleRaw.trim()),
        maxConnections:
          maxConnectionsRaw === undefined || maxConnectionsRaw.trim() === ""
            ? undefined
            : parseInteger(
                `subscribers.users[${index}].max_connections`,
                maxConnectionsRaw.trim(),
                { min: 1 },
              ),
      };
    },
  );

  return {
    defaultMaxConnections: requiredInt(
      SETTINGS.subscriberDefaultMaxConnections,
      { min: 1 },
    ),
    users,
  };
}

export function loadMeshcoreIoConfig(): MeshcoreIoConfig {
  const requestTimeoutMs = configInt(
    ["meshcore_io", "request_timeout_ms"],
    10_000,
    { min: 1_000, max: 120_000 },
  );
  const retryDelayMs = configInt(["meshcore_io", "retry_delay_ms"], 5_000, {
    min: 0,
    max: 300_000,
  });

  return {
    enabled: configBool(["meshcore_io", "enabled"], false),
    apiUrl: configString(
      ["meshcore_io", "api_url"],
      "https://map.meshcore.io/api/v1/uploader/node",
    ),
    dryRun: configBool(["meshcore_io", "dry_run"], false),
    minReuploadIntervalSeconds: configInt(
      ["meshcore_io", "min_reupload_seconds"],
      3_600,
      { min: 0, max: 86_400 },
    ),
    requestTimeoutMs,
    workersPerBroker: configInt(["meshcore_io", "workers_per_broker"], 1, {
      min: 1,
      max: 32,
    }),
    maxQueuedUploads: configInt(["meshcore_io", "max_queued_uploads"], 250, {
      min: 1,
      max: 100_000,
    }),
    retriesAllowed: configInt(["meshcore_io", "attempts"], 3, {
      min: 1,
      max: 100,
    }),
    retryDelayMs,
    producerLeaseMs: configInt(["meshcore_io", "producer_lease_ms"], 15_000, {
      min: 5_000,
      max: 300_000,
    }),
    producerPollMs: configInt(["meshcore_io", "producer_poll_ms"], 1_000, {
      min: 100,
      max: 30_000,
    }),
    ingressDedupMs: configInt(["meshcore_io", "ingress_dedup_ms"], 10_000, {
      min: 1_000,
      max: 300_000,
    }),
    workerClaimTimeoutMs: configInt(
      ["meshcore_io", "worker_claim_timeout_ms"],
      Math.max(60_000, requestTimeoutMs + retryDelayMs + 10_000),
      { min: 10_000, max: 15 * 60_000 },
    ),
  };
}

export function loadAbuseConfig(): AbuseConfig {
  return {
    duplicateWindowSize: requiredInt(SETTINGS.abuseDuplicateWindowSize, {
      min: 1,
    }),
    duplicateWindowMs: requiredInt(SETTINGS.abuseDuplicateWindowMs, { min: 1 }),
    duplicateThreshold: requiredInt(SETTINGS.abuseDuplicateThreshold, {
      min: 1,
    }),
    maxDuplicatesPerPacket: optionalInt(
      SETTINGS.abuseMaxDuplicatesPerPacket,
      5,
      { min: 1 },
    ),
    duplicateRateThreshold: optionalFloat(
      SETTINGS.abuseDuplicateRateThreshold,
      0.3,
      { min: 0, max: 1 },
    ),
    duplicateRateWindowMs: optionalInt(
      SETTINGS.abuseDuplicateRateWindowMs,
      300000,
      { min: 1 },
    ),
    bucketCapacity: requiredInt(SETTINGS.abuseBucketCapacity, { min: 1 }),
    bucketRefillRate: requiredFloat(SETTINGS.abuseBucketRefillRate, {
      greaterThan: 0,
    }),
    maxPacketSize: requiredInt(SETTINGS.abuseMaxPacketSize, { min: 1 }),
    maxTopicsPerDay: requiredInt(SETTINGS.abuseMaxTopicsPerDay, { min: 1 }),
    anomalyThreshold: requiredInt(SETTINGS.abuseAnomalyThreshold, { min: 1 }),
    maxIataChanges24h: requiredInt(SETTINGS.abuseMaxIataChanges24h, { min: 1 }),
    topicHistorySize: requiredInt(SETTINGS.abuseTopicHistorySize, { min: 1 }),
    topicHistoryWindowMs: requiredInt(SETTINGS.abuseTopicHistoryWindowMs, {
      min: 1,
    }),
    enforcementEnabled: requiredBool(SETTINGS.abuseEnforcementEnabled),
  };
}
