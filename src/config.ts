import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import type { MeshcoreIoConfig } from "./meshcore-io-types.js";

type ConfigDocument = Record<string, unknown>;

export interface MqttConfig {
  wsPort: number;
  host: string;
  expectedAudience: string;
  /** Seconds; 0 disables expiry enforcement (upstream default). */
  authTokenMaxAgeSeconds: number;
  jsonPublishMaxBytes: number;
  wsMaxPayloadBytes: number;
  /** Display prefix for the per-process broker identity (see server.ts). */
  brokerName: string;
  iata: IataConfig;
}

export interface SecondaryIataConfigEntry {
  code: string;
  primaryIata: string;
}

export interface PrimaryIataConfigEntry {
  code: string;
  friendlyName?: string;
  secondaryIata: string[];
}

export interface IataConfig {
  allowlistEnabled: boolean;
  allowTestIngress: boolean;
  allowedPrimaryIata: string[];
  primaryEntries: Record<string, PrimaryIataConfigEntry>;
  secondaryEntries: Record<string, SecondaryIataConfigEntry>;
}

export interface SubscriberUserConfig {
  username: string;
  password: string;
  role?: number;
  maxConnections?: number;
}

interface NumberBounds {
  min?: number;
  max?: number;
}

interface SettingSpec {
  path: string[];
}

const DEFAULT_CONFIG_PATHS = [
  "config.yaml",
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

function envOverrideName(path: string[]): string {
  return (
    "MESHCORE_" +
    path
      .join("_")
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_")
  );
}

function optionalSetting(spec: SettingSpec): string | undefined {
  const envValue = process.env[envOverrideName(spec.path)];
  if (envValue !== undefined && envValue.trim() !== "") {
    return envValue.trim();
  }
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

const FRIENDLY_NAME_MAX_LENGTH = 120;

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function normalizeIataCode(rawCode: string, path: string): string {
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

function parseSecondaryIata(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (typeof value !== "string") {
    failConfig(
      `Configuration value ${path} must be a comma-separated string such as "LLA, MMX, SDL"`,
    );
  }
  const items = value.split(",");
  if (items.some((item) => item.trim() === "")) {
    failConfig(
      `Configuration value ${path} contains an empty secondary-IATA item`,
    );
  }
  const seen = new Set<string>();
  return items.map((item) => {
    const code = normalizeIataCode(item, `${path} item "${item.trim()}"`);
    if (seen.has(code)) {
      failConfig(
        `Configuration value ${path} contains duplicate item "${code}"`,
      );
    }
    seen.add(code);
    return code;
  });
}

export function loadIataConfig(): IataConfig {
  const document = loadConfigDocument().document;
  const canonicalEntries = readPath(document, ["allowed_iata"]);
  const legacyEntries = readPath(document, ["allowed_regions"]);
  const rawEntriesDocument = canonicalEntries ?? legacyEntries;
  const entriesName =
    canonicalEntries !== undefined ? "allowed_iata" : "allowed_regions";
  const canonicalEnabled = readPath(document, ["iata", "allowlist_enabled"]);
  const legacyEnabled = readPath(document, ["IATA_whitelist"]);
  const allowlistEnabled =
    canonicalEnabled !== undefined
      ? configBool(["iata", "allowlist_enabled"], false)
      : canonicalEntries !== undefined
        ? true
        : legacyEnabled !== undefined
          ? configBool(["IATA_whitelist"], false)
          : legacyEntries !== undefined;
  const inactive: IataConfig = {
    allowlistEnabled,
    allowTestIngress: configBool(["iata", "allow_test_ingress"], false),
    allowedPrimaryIata: [],
    primaryEntries: {},
    secondaryEntries: {},
  };
  if (!allowlistEnabled) {
    failConfig(
      "Configuration value iata.allowlist_enabled must be true; normalized ingest requires a configured primary IATA code",
    );
  }

  if (
    !Array.isArray(rawEntriesDocument) &&
    (!rawEntriesDocument || typeof rawEntriesDocument !== "object")
  ) {
    failConfig(
      `Configuration value ${entriesName} must be a non-empty list or object when the IATA allowlist is enabled`,
    );
  }

  const rawEntries: Array<[string, unknown, string]> = Array.isArray(
    rawEntriesDocument,
  )
    ? rawEntriesDocument.map((entry, index) => {
        if (typeof entry !== "string") {
          failConfig(
            `Configuration value ${entriesName}[${index}] must be an IATA-code string`,
          );
        }
        return [entry, {}, `${entriesName}[${index}]`];
      })
    : Object.entries(rawEntriesDocument).map(([key, value]) => [
        key,
        value === null ? {} : value,
        `${entriesName}.${key}`,
      ]);

  if (rawEntries.length === 0) {
    failConfig(
      `Configuration value ${entriesName} must not be empty when the IATA allowlist is enabled`,
    );
  }

  const allowedPrimaryIata: string[] = [];
  const primaryEntries: Record<string, PrimaryIataConfigEntry> = {};
  for (const [rawCode, rawEntry, path] of rawEntries) {
    const code = normalizeIataCode(rawCode, path);
    if (primaryEntries[code]) {
      failConfig(
        `Configuration value ${path} duplicates primary IATA "${code}" after normalization`,
      );
    }
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      failConfig(`Configuration value ${path} must be an object`);
    }
    const entry = rawEntry as Record<string, unknown>;
    const secondarySetting =
      entriesName === "allowed_iata" ? "secondary_iata" : "secondary_region";
    const unknownKeys = Object.keys(entry).filter(
      (key) => key !== "friendly_name" && key !== secondarySetting,
    );
    if (unknownKeys.length > 0) {
      failConfig(
        `Configuration value ${path}.${unknownKeys[0]} is not supported`,
      );
    }
    allowedPrimaryIata.push(code);
    primaryEntries[code] = {
      code,
      friendlyName: parseFriendlyName(
        entry.friendly_name,
        `${path}.friendly_name`,
      ),
      secondaryIata: parseSecondaryIata(
        entry[secondarySetting],
        `${path}.${secondarySetting}`,
      ),
    };
  }

  const secondaryEntries: Record<string, SecondaryIataConfigEntry> = {};
  for (const primary of allowedPrimaryIata) {
    const entry = primaryEntries[primary];
    for (const code of entry.secondaryIata) {
      const secondarySetting =
        entriesName === "allowed_iata" ? "secondary_iata" : "secondary_region";
      const path = `${entriesName}.${primary}.${secondarySetting}`;
      if (primaryEntries[code]) {
        failConfig(
          `Configuration value ${path} item "${code}" must not also be a top-level allowed IATA`,
        );
      }
      const existing = secondaryEntries[code];
      if (existing) {
        failConfig(
          `Configuration value ${path} item "${code}" is already assigned to primary IATA ${existing.primaryIata}`,
        );
      }
      secondaryEntries[code] = { code, primaryIata: primary };
    }
  }

  return {
    allowlistEnabled,
    allowTestIngress: inactive.allowTestIngress,
    allowedPrimaryIata,
    primaryEntries,
    secondaryEntries,
  };
}

const SETTINGS = {
  wsPort: { path: ["mqtt", "ws_port"] },
  host: { path: ["mqtt", "host"] },
  expectedAudience: { path: ["auth", "expected_audience"] },
  authTokenMaxAgeSeconds: { path: ["auth", "token_max_age_seconds"] },
  jsonPublishMaxBytes: { path: ["mqtt", "json_publish_max_bytes"] },
  wsMaxPayloadBytes: { path: ["mqtt", "ws_max_payload_bytes"] },
  brokerName: { path: ["broker", "name"] },
  subscriberDefaultMaxConnections: {
    path: ["subscribers", "default_max_connections"],
  },
} satisfies Record<string, SettingSpec>;

export function loadMqttConfig(): MqttConfig {
  return {
    wsPort: requiredInt(SETTINGS.wsPort, { min: 0, max: 65535 }),
    host: requiredSetting(SETTINGS.host),
    expectedAudience: requiredAudience(SETTINGS.expectedAudience),
    authTokenMaxAgeSeconds: optionalInt(SETTINGS.authTokenMaxAgeSeconds, 0, {
      min: 0,
    }),
    jsonPublishMaxBytes: optionalInt(SETTINGS.jsonPublishMaxBytes, 8192, {
      min: 1,
    }),
    wsMaxPayloadBytes: optionalInt(SETTINGS.wsMaxPayloadBytes, 65536, {
      min: 1,
      max: 2_147_483_647,
    }),
    brokerName: optionalString(SETTINGS.brokerName, "Broker"),
    iata: loadIataConfig(),
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
    // Observer and subscriber namespaces share the MQTT username field:
    // aedes.authenticate checks subscribers first. A `v1_<key>` subscriber
    // would shadow that observer's JWT auth, so reject it at config load.
    if (/^v1_/i.test(user.username)) {
      failConfig(
        `Configuration value subscribers.users[${users.indexOf(user)}].username must not start with "v1_": that prefix is reserved for observer authentication`,
      );
    }
    if (seenUsernames.has(user.username.toLowerCase())) {
      failConfig(
        `Configuration value subscribers.users contains duplicate username ${user.username}`,
      );
    }
    seenUsernames.add(user.username.toLowerCase());
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
  const apiUrl = configString(
    ["meshcore_io", "api_url"],
    "https://map.meshcore.io/api/v1/uploader/node",
  );
  if (apiUrl) {
    let parsed: URL;
    try {
      parsed = new URL(apiUrl);
    } catch {
      failConfig(
        "Configuration value meshcore_io.api_url must be a valid http:/https: URL",
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      failConfig(
        "Configuration value meshcore_io.api_url must be a valid http:/https: URL",
      );
    }
    if (parsed.username || parsed.password) {
      failConfig(
        "Configuration value meshcore_io.api_url must not include credentials",
      );
    }
  }

  return {
    enabled: configBool(["meshcore_io", "enabled"], false),
    apiUrl,
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
