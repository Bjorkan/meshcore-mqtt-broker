import { config as dotenvConfig } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { AbuseConfig } from './abuse-detector.js';

// Load environment variables
dotenvConfig({ quiet: true });

export interface MqttConfig {
  wsPort: number;
  host: string;
  expectedAudience: string;
  jsonPublishMaxBytes: number;
  wsMaxPayloadBytes: number;
  nodeNameCacheTtlMs: number;
  allowedRegions: string[];
  allowedRegionSources: string[];
}

interface NumberBounds {
  min?: number;
  max?: number;
  greaterThan?: number;
  lessThan?: number;
}

function failConfig(message: string): never {
  console.error(`KRITISKT: ${message}`);
  console.error('Kontrollera .env-filen och se till att alla variabler från .env.example är satta.');
  process.exit(1);
}

function requiredEnv(name: string): string {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === '') {
    failConfig(`Miljövariabeln ${name} saknas eller är tom`);
  }

  return rawValue.trim();
}

function requiredAudience(name: string): string {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    failConfig(`Miljövariabeln ${name} saknas. Sätt ett värde, eller sätt tom sträng för att inaktivera audience-validering`);
  }

  if (rawValue === '') {
    return '';
  }

  const value = rawValue.trim();
  if (value === '') {
    failConfig(`Miljövariabeln ${name} får vara tom eller ett icke-tomt värde, men inte bara mellanslag`);
  }

  return value;
}

function validateNumber(name: string, value: number, options: NumberBounds): number {
  if (options.min !== undefined && value < options.min) {
    failConfig(`Miljövariabeln ${name} måste vara minst ${options.min}`);
  }

  if (options.max !== undefined && value > options.max) {
    failConfig(`Miljövariabeln ${name} får vara högst ${options.max}`);
  }

  if (options.greaterThan !== undefined && value <= options.greaterThan) {
    failConfig(`Miljövariabeln ${name} måste vara större än ${options.greaterThan}`);
  }

  if (options.lessThan !== undefined && value >= options.lessThan) {
    failConfig(`Miljövariabeln ${name} måste vara mindre än ${options.lessThan}`);
  }

  return value;
}

function parseInteger(name: string, rawValue: string, options: NumberBounds = {}): number {
  if (!/^[+-]?\d+$/.test(rawValue)) {
    failConfig(`Miljövariabeln ${name} måste vara ett heltal, fick "${rawValue}"`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) {
    failConfig(`Miljövariabeln ${name} måste vara ett säkert heltal, fick "${rawValue}"`);
  }

  return validateNumber(name, value, options);
}

function parseFloatValue(name: string, rawValue: string, options: NumberBounds = {}): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    failConfig(`Miljövariabeln ${name} måste vara ett giltigt tal, fick "${rawValue}"`);
  }

  return validateNumber(name, value, options);
}

function requiredInt(name: string, options: NumberBounds = {}): number {
  return parseInteger(name, requiredEnv(name), options);
}

function optionalInt(name: string, defaultValue: number, options: NumberBounds = {}): number {
  if (process.env[name] === undefined || process.env[name]?.trim() === '') {
    return defaultValue;
  }

  return parseInteger(name, process.env[name]!.trim(), options);
}

function requiredFloat(name: string, options: NumberBounds = {}): number {
  return parseFloatValue(name, requiredEnv(name), options);
}

function optionalFloat(name: string, defaultValue: number, options: NumberBounds = {}): number {
  if (process.env[name] === undefined || process.env[name]?.trim() === '') {
    return defaultValue;
  }

  return parseFloatValue(name, process.env[name]!.trim(), options);
}

function requiredBool(name: string): boolean {
  const value = requiredEnv(name).toLowerCase();
  if (value !== 'true' && value !== 'false') {
    failConfig(`Miljövariabeln ${name} måste vara "true" eller "false", fick "${value}"`);
  }

  return value === 'true';
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

function parseAllowedRegionsYaml(content: string): string[] {
  const regions: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    const withoutComment = line.split('#')[0].trim();
    const match = withoutComment.match(/^-\s*([A-Za-z]{3})$/);

    if (match) {
      regions.push(match[1]);
    }
  }

  return normalizeRegionList(regions);
}

function findAllowedRegionsYaml(): string | null {
  const configDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), 'allowed_regions.yaml'),
    join(process.cwd(), 'broker', 'allowed_regions.yaml'),
    join(configDir, '..', 'allowed_regions.yaml'),
    join(configDir, '..', '..', 'allowed_regions.yaml'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadAllowedRegions(): { allowedRegions: string[]; sources: string[] } {
  const allowedRegions = new Set<string>();
  const sources: string[] = [];

  const yamlPath = findAllowedRegionsYaml();
  if (yamlPath) {
    const yamlRegions = parseAllowedRegionsYaml(readFileSync(yamlPath, 'utf-8'));
    for (const region of yamlRegions) {
      allowedRegions.add(region);
    }
    sources.push(`allowed_regions.yaml (${yamlRegions.length})`);
  }

  const envRegions = normalizeRegionList(process.env.ALLOWED_REGIONS?.split(',') || []);
  if (envRegions.length > 0) {
    for (const region of envRegions) {
      allowedRegions.add(region);
    }
    sources.push(`ALLOWED_REGIONS (${envRegions.length})`);
  }

  return {
    allowedRegions: Array.from(allowedRegions),
    sources,
  };
}

// Validate and load MQTT configuration
export function loadMqttConfig(): MqttConfig {
  const { allowedRegions, sources } = loadAllowedRegions();

  return {
    wsPort: requiredInt('MQTT_WS_PORT', { min: 0, max: 65535 }),
    host: requiredEnv('MQTT_HOST'),
    expectedAudience: requiredAudience('AUTH_EXPECTED_AUDIENCE'),
    jsonPublishMaxBytes: optionalInt('MQTT_JSON_PUBLISH_MAX_BYTES', 8192, { min: 1 }),
    wsMaxPayloadBytes: optionalInt('MQTT_WS_MAX_PAYLOAD_BYTES', 65536, { min: 1 }),
    nodeNameCacheTtlMs: optionalInt('BROKER_NODE_NAME_CACHE_TTL_MS', 24 * 60 * 60 * 1000, { greaterThan: 0 }),
    allowedRegions,
    allowedRegionSources: sources,
  };
}

// Validate and load subscriber configuration
export function loadSubscriberConfig() {
  return {
    defaultMaxConnections: requiredInt('SUBSCRIBER_MAX_CONNECTIONS_DEFAULT', { min: 1 }),
  };
}

// Validate and load abuse detection configuration
export function loadAbuseConfig(): AbuseConfig {
  return {
    duplicateWindowSize: requiredInt('ABUSE_DUPLICATE_WINDOW_SIZE', { min: 1 }),
    duplicateWindowMs: requiredInt('ABUSE_DUPLICATE_WINDOW_MS', { min: 1 }),
    duplicateThreshold: requiredInt('ABUSE_DUPLICATE_THRESHOLD', { min: 1 }),
    maxDuplicatesPerPacket: optionalInt('ABUSE_MAX_DUPLICATES_PER_PACKET', 5, { min: 1 }),
    duplicateRateThreshold: optionalFloat('ABUSE_DUPLICATE_RATE_THRESHOLD', 0.3, { min: 0, max: 1 }),
    duplicateRateWindowMs: optionalInt('ABUSE_DUPLICATE_RATE_WINDOW_MS', 300000, { min: 1 }),
    bucketCapacity: requiredInt('ABUSE_BUCKET_CAPACITY', { min: 1 }),
    bucketRefillRate: requiredFloat('ABUSE_BUCKET_REFILL_RATE', { greaterThan: 0 }),
    maxPacketSize: requiredInt('ABUSE_MAX_PACKET_SIZE', { min: 1 }),
    maxTopicsPerDay: requiredInt('ABUSE_MAX_TOPICS_PER_DAY', { min: 1 }),
    anomalyThreshold: requiredInt('ABUSE_ANOMALY_THRESHOLD', { min: 1 }),
    maxIataChanges24h: requiredInt('ABUSE_MAX_IATA_CHANGES_24H', { min: 1 }),
    topicHistorySize: requiredInt('ABUSE_TOPIC_HISTORY_SIZE', { min: 1 }),
    topicHistoryWindowMs: requiredInt('ABUSE_TOPIC_HISTORY_WINDOW_MS', { min: 1 }),
    persistencePath: requiredEnv('ABUSE_PERSISTENCE_PATH'),
    persistenceIntervalMs: requiredInt('ABUSE_PERSISTENCE_INTERVAL_MS', { min: 1 }),
    enforcementEnabled: requiredBool('ABUSE_ENFORCEMENT_ENABLED'),
  };
}
