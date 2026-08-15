import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import type { AbuseConfig } from "./abuse-detector.js";
import type { MeshcoreIoConfig } from "./meshcore-io-types.js";
import { DOCKER_HEALTH_USERNAME } from "./docker-health-user.js";
import { resolveBrokerInstanceId } from "./instance-id.js";

type ConfigDocument = Record<string, unknown>;

export interface MqttConfig {
  wsPort: number;
  host: string;
  expectedAudience: string;
  jsonPublishMaxBytes: number;
  wsMaxPayloadBytes: number;
  nodeNameCacheTtlMs: number;
  instanceId: string;
  branding: BrandingConfig;
  regions: RegionConfig;
}

export interface BrandingConfig {
  operatorName: string;
  dashboardTitle: string;
  dashboardSubtitle: string;
  websiteUrl?: string;
}

export interface SecondaryRegionConfigEntry {
  code: string;
  primaryRegion: string;
}

export interface PrimaryRegionConfigEntry {
  code: string;
  friendlyName?: string;
  secondaryRegions: string[];
}

export interface RegionConfig {
  whitelistEnabled: boolean;
  allowedPrimaryRegions: string[];
  primaryEntries: Record<string, PrimaryRegionConfigEntry>;
  secondaryEntries: Record<string, SecondaryRegionConfigEntry>;
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

export interface StorageConfig {
  retentionDays: number;
  cleanupIntervalMinutes: number;
  cleanupBatchSize: number;
  storeInternal: boolean;
  storeSerial: boolean;
}

export const PUBLIC_MCP_PATH = "/mcp/v2";

export interface McpConfig {
  enabled: boolean;
  path: typeof PUBLIC_MCP_PATH;
  defaultLimit: number;
  maxLimit: number;
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
  console.error(`CRITICAL: ${message}`);
  console.error(
    "Check the mounted config.yaml file (/run/configs/meshcore-mqtt-broker-config.yaml in Docker).",
  );
  process.exit(1);
}

function findConfigYaml(): string | undefined {
  const configDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...DEFAULT_CONFIG_PATHS.map((path) => resolve(process.cwd(), path)),
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
        `config.yaml must contain a YAML object at its root (${path})`,
      );
    }
    cachedConfig = { path, document: parsed as ConfigDocument };
    return cachedConfig;
  } catch (error) {
    failConfig(
      `Could not read config.yaml (${path}): ${(error as Error).message}`,
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
    failConfig(`Configuration value ${settingName(spec)} is missing or empty`);
  }

  return rawValue.trim();
}

function requiredAudience(spec: SettingSpec): string {
  const rawValue = optionalSetting(spec);
  if (rawValue === undefined) {
    failConfig(
      `Configuration value ${settingName(spec)} is missing. Set a value, or use an empty string to disable audience validation`,
    );
  }

  if (rawValue === "") {
    return "";
  }

  const value = rawValue.trim();
  if (value === "") {
    failConfig(
      `Configuration value ${settingName(spec)} may be empty or non-empty, but may not contain only whitespace`,
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
    failConfig(`Configuration value ${name} must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    failConfig(`Configuration value ${name} must be at most ${options.max}`);
  }
  if (options.greaterThan !== undefined && value <= options.greaterThan) {
    failConfig(
      `Configuration value ${name} must be greater than ${options.greaterThan}`,
    );
  }
  if (options.lessThan !== undefined && value >= options.lessThan) {
    failConfig(
      `Configuration value ${name} must be less than ${options.lessThan}`,
    );
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
      `Configuration value ${name} must be an integer, got "${rawValue}"`,
    );
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) {
    failConfig(
      `Configuration value ${name} must be a safe integer, got "${rawValue}"`,
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
      `Configuration value ${name} must be a valid number, got "${rawValue}"`,
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
      `Configuration value ${settingName(spec)} must be "true" or "false", got "${value}"`,
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

  const lower = rawValue.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(lower)) return true;
  if (["0", "false", "no", "off"].includes(lower)) return false;

  failConfig(
    `Configuration value ${path.join(".")} must be true/false/yes/no/on/off/1/0, got "${rawValue}"`,
  );
}

export function configInt(
  path: string[],
  defaultValue: number,
  options: NumberBounds = {},
): number {
  return optionalInt({ path }, defaultValue, options);
}

const BRANDING_DEFAULTS: BrandingConfig = {
  operatorName: "MeshCore MQTT",
  dashboardTitle: "MeshCore MQTT Broker",
  dashboardSubtitle: "Operations dashboard",
};
const BRANDING_TEXT_LIMITS = {
  operator_name: 80,
  dashboard_title: 120,
  dashboard_subtitle: 160,
} as const;
const FRIENDLY_NAME_MAX_LENGTH = 120;

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function brandingText(
  key: keyof typeof BRANDING_TEXT_LIMITS,
  defaultValue: string,
): string {
  const path = `branding.${key}`;
  const raw = readPath(loadConfigDocument().document, ["branding", key]);
  if (raw === undefined) return defaultValue;
  if (typeof raw !== "string") {
    failConfig(`Configuration value ${path} must be a string`);
  }
  const value = raw.trim();
  if (!value) failConfig(`Configuration value ${path} must not be empty`);
  if (value.length > BRANDING_TEXT_LIMITS[key]) {
    failConfig(
      `Configuration value ${path} must be at most ${BRANDING_TEXT_LIMITS[key]} characters`,
    );
  }
  if (hasControlCharacters(raw)) {
    failConfig(
      `Configuration value ${path} must not contain control characters`,
    );
  }
  return value;
}

export function loadBrandingConfig(): BrandingConfig {
  const rawWebsiteUrl = readPath(loadConfigDocument().document, [
    "branding",
    "website_url",
  ]);
  if (rawWebsiteUrl !== undefined && typeof rawWebsiteUrl !== "string") {
    failConfig("Configuration value branding.website_url must be a string");
  }
  const websiteUrl =
    typeof rawWebsiteUrl === "string" ? rawWebsiteUrl.trim() : undefined;
  if (
    websiteUrl &&
    typeof rawWebsiteUrl === "string" &&
    hasControlCharacters(rawWebsiteUrl)
  ) {
    failConfig(
      "Configuration value branding.website_url must not contain control characters",
    );
  }
  if (websiteUrl) {
    if (websiteUrl.length > 2_048) {
      failConfig(
        "Configuration value branding.website_url must be at most 2048 characters",
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(websiteUrl);
    } catch {
      failConfig(
        "Configuration value branding.website_url must be empty or a valid http:/https: URL",
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      failConfig(
        "Configuration value branding.website_url must be empty or an http:/https: URL",
      );
    }
    if (parsed.username || parsed.password) {
      failConfig(
        "Configuration value branding.website_url must not include credentials",
      );
    }
  }

  return {
    operatorName: brandingText("operator_name", BRANDING_DEFAULTS.operatorName),
    dashboardTitle: brandingText(
      "dashboard_title",
      BRANDING_DEFAULTS.dashboardTitle,
    ),
    dashboardSubtitle: brandingText(
      "dashboard_subtitle",
      BRANDING_DEFAULTS.dashboardSubtitle,
    ),
    websiteUrl: websiteUrl || undefined,
  };
}

function normalizeRegionCode(rawCode: string, path: string): string {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    failConfig(
      `Configuration value ${path} must normalize to exactly three letters, got "${rawCode}"`,
    );
  }
  return code;
}

function parseFriendlyName(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    failConfig(`Configuration value ${path} must be a string`);
  }
  const friendlyName = value.trim();
  if (!friendlyName) {
    failConfig(`Configuration value ${path} must not be empty`);
  }
  if (friendlyName.length > FRIENDLY_NAME_MAX_LENGTH) {
    failConfig(
      `Configuration value ${path} must be at most ${FRIENDLY_NAME_MAX_LENGTH} characters`,
    );
  }
  if (hasControlCharacters(value)) {
    failConfig(
      `Configuration value ${path} must not contain control characters`,
    );
  }
  return friendlyName;
}

function parseSecondaryRegions(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (typeof value !== "string") {
    failConfig(
      `Configuration value ${path} must be a comma-separated string such as "LLA, MMX, SDL"`,
    );
  }
  const items = value.split(",");
  if (items.some((item) => item.trim() === "")) {
    failConfig(
      `Configuration value ${path} contains an empty secondary-region item`,
    );
  }
  const seen = new Set<string>();
  return items.map((item) => {
    const code = normalizeRegionCode(item, `${path} item "${item.trim()}"`);
    if (seen.has(code)) {
      failConfig(
        `Configuration value ${path} contains duplicate item "${code}"`,
      );
    }
    seen.add(code);
    return code;
  });
}

export function loadRegionConfig(): RegionConfig {
  const rawRegions = readPath(loadConfigDocument().document, [
    "allowed_regions",
  ]);
  // Existing configurations used allowed_regions as an active allowlist before
  // IATA_whitelist was introduced. Preserve that authorization boundary.
  const whitelistEnabled = configBool(
    ["IATA_whitelist"],
    rawRegions !== undefined,
  );
  const inactive: RegionConfig = {
    whitelistEnabled,
    allowedPrimaryRegions: [],
    primaryEntries: {},
    secondaryEntries: {},
  };
  if (!whitelistEnabled) return inactive;

  if (
    !Array.isArray(rawRegions) &&
    (!rawRegions || typeof rawRegions !== "object")
  ) {
    failConfig(
      "Configuration value allowed_regions must be a non-empty list or object when IATA_whitelist is true",
    );
  }

  const rawEntries: Array<[string, unknown, string]> = Array.isArray(rawRegions)
    ? rawRegions.map((entry, index) => {
        if (typeof entry !== "string") {
          failConfig(
            `Configuration value allowed_regions[${index}] must be a region-code string`,
          );
        }
        return [entry, {}, `allowed_regions[${index}]`];
      })
    : Object.entries(rawRegions).map(([key, value]) => [
        key,
        value === null ? {} : value,
        `allowed_regions.${key}`,
      ]);

  if (rawEntries.length === 0) {
    failConfig(
      "Configuration value allowed_regions must not be empty when IATA_whitelist is true",
    );
  }

  const allowedPrimaryRegions: string[] = [];
  const primaryEntries: Record<string, PrimaryRegionConfigEntry> = {};
  for (const [rawCode, rawEntry, path] of rawEntries) {
    const code = normalizeRegionCode(rawCode, path);
    if (primaryEntries[code]) {
      failConfig(
        `Configuration value ${path} duplicates primary region "${code}" after normalization`,
      );
    }
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      failConfig(`Configuration value ${path} must be an object`);
    }
    const entry = rawEntry as Record<string, unknown>;
    const unknownKeys = Object.keys(entry).filter(
      (key) => key !== "friendly_name" && key !== "secondary_region",
    );
    if (unknownKeys.length > 0) {
      failConfig(
        `Configuration value ${path}.${unknownKeys[0]} is not supported`,
      );
    }
    allowedPrimaryRegions.push(code);
    primaryEntries[code] = {
      code,
      friendlyName: parseFriendlyName(
        entry.friendly_name,
        `${path}.friendly_name`,
      ),
      secondaryRegions: parseSecondaryRegions(
        entry.secondary_region,
        `${path}.secondary_region`,
      ),
    };
  }

  const secondaryEntries: Record<string, SecondaryRegionConfigEntry> = {};
  for (const primary of allowedPrimaryRegions) {
    const entry = primaryEntries[primary];
    for (const code of entry.secondaryRegions) {
      const path = `allowed_regions.${primary}.secondary_region`;
      if (primaryEntries[code]) {
        failConfig(
          `Configuration value ${path} item "${code}" must not also be a top-level allowed region`,
        );
      }
      const existing = secondaryEntries[code];
      if (existing) {
        failConfig(
          `Configuration value ${path} item "${code}" is already assigned to primary region ${existing.primaryRegion}`,
        );
      }
      secondaryEntries[code] = { code, primaryRegion: primary };
    }
  }

  return {
    whitelistEnabled,
    allowedPrimaryRegions,
    primaryEntries,
    secondaryEntries,
  };
}

const SETTINGS = {
  wsPort: { path: ["mqtt", "ws_port"] },
  host: { path: ["mqtt", "host"] },
  expectedAudience: { path: ["auth", "expected_audience"] },
  jsonPublishMaxBytes: { path: ["mqtt", "json_publish_max_bytes"] },
  wsMaxPayloadBytes: { path: ["mqtt", "ws_max_payload_bytes"] },
  nodeNameCacheTtlMs: { path: ["broker", "node_name_cache_ttl_ms"] },
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
  return {
    wsPort: requiredInt(SETTINGS.wsPort, { min: 0, max: 65535 }),
    host: requiredSetting(SETTINGS.host),
    expectedAudience: requiredAudience(SETTINGS.expectedAudience),
    jsonPublishMaxBytes: optionalInt(SETTINGS.jsonPublishMaxBytes, 8192, {
      min: 1,
    }),
    wsMaxPayloadBytes: optionalInt(SETTINGS.wsMaxPayloadBytes, 65536, {
      min: 1,
    }),
    nodeNameCacheTtlMs: optionalInt(SETTINGS.nodeNameCacheTtlMs, 300_000, {
      greaterThan: 0,
    }),
    instanceId: resolveBrokerInstanceId({
      persist: true,
      brokerName: optionalString(SETTINGS.brokerName, "Broker"),
      runtimeIdFile: optionalSetting(SETTINGS.brokerRuntimeIdFile),
    }),
    branding: loadBrandingConfig(),
    regions: loadRegionConfig(),
  };
}

export function loadSubscriberConfig() {
  const usersRaw = readPath(loadConfigDocument().document, [
    "subscribers",
    "users",
  ]);
  if (usersRaw !== undefined && !Array.isArray(usersRaw)) {
    failConfig("Configuration value subscribers.users must be a list");
  }

  const users = (Array.isArray(usersRaw) ? usersRaw : []).map(
    (entry, index): SubscriberUserConfig => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        failConfig(
          `Configuration value subscribers.users[${index}] must be an object`,
        );
      }
      const record = entry as Record<string, unknown>;
      const username = stringValue(record.username)?.trim();
      const password = stringValue(record.password)?.trim();
      if (!username || !password) {
        failConfig(
          `Configuration value subscribers.users[${index}] must have username and password`,
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

  const seenUsernames = new Set<string>();
  for (const user of users) {
    if (user.username === DOCKER_HEALTH_USERNAME) {
      failConfig(
        `Configuration value subscribers.users must not use the reserved username ${DOCKER_HEALTH_USERNAME}`,
      );
    }
    if (seenUsernames.has(user.username)) {
      failConfig(
        `Configuration value subscribers.users contains duplicate username ${user.username}`,
      );
    }
    seenUsernames.add(user.username);
  }

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
    workers: configInt(["meshcore_io", "workers"], 1, {
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
    ingressDedupMs: configInt(["meshcore_io", "ingress_dedup_ms"], 10_000, {
      min: 1_000,
      max: 300_000,
    }),
  };
}

export function loadStorageConfig(): StorageConfig {
  return {
    retentionDays: configInt(["storage", "retention_days"], 30, { min: 1 }),
    cleanupIntervalMinutes: configInt(
      ["storage", "cleanup_interval_minutes"],
      60,
      { min: 1 },
    ),
    cleanupBatchSize: configInt(["storage", "cleanup_batch_size"], 1_000, {
      min: 1,
      max: 10_000,
    }),
    storeInternal: configBool(["storage", "store_internal"], false),
    storeSerial: configBool(["storage", "store_serial"], false),
  };
}

export function loadMcpConfig(): McpConfig {
  const path = configString(["mcp", "path"], PUBLIC_MCP_PATH);
  if (path !== PUBLIC_MCP_PATH) {
    failConfig(
      `Configuration value mcp.path must be exactly ${PUBLIC_MCP_PATH}`,
    );
  }

  const maxLimit = configInt(["mcp", "max_limit"], 250, {
    min: 1,
    max: 1_000,
  });
  const defaultLimit = configInt(["mcp", "default_limit"], 50, {
    min: 1,
    max: maxLimit,
  });

  return {
    enabled: configBool(["mcp", "enabled"], true),
    path: PUBLIC_MCP_PATH,
    defaultLimit,
    maxLimit,
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
