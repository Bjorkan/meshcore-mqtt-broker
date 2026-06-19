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
  allowedRegions: string[];
  allowedRegionSources: string[];
}

// Validate required environment variables
function validateRequiredEnvVars(vars: string[]): void {
  for (const envVar of vars) {
    if (process.env[envVar] === undefined) {
      failConfig(`Obligatorisk miljövariabel saknas: ${envVar}`);
    }
  }
}

function failConfig(message: string): never {
  console.error(`KRITISKT: ${message}`);
  console.error('Kontrollera .env-filen och se till att alla variabler från .env.example är satta.');
  process.exit(1);
}

function readEnvNumber(name: string): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === '') {
    failConfig(`Miljövariabeln ${name} saknar värde`);
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    failConfig(`Miljövariabeln ${name} måste vara ett giltigt tal, fick "${rawValue}"`);
  }

  return value;
}

function validateNumber(name: string, value: number, options: { min?: number; max?: number; integer?: boolean }): number {
  if (options.integer && !Number.isInteger(value)) {
    failConfig(`Miljövariabeln ${name} måste vara ett heltal`);
  }

  if (options.min !== undefined && value < options.min) {
    failConfig(`Miljövariabeln ${name} måste vara minst ${options.min}`);
  }

  if (options.max !== undefined && value > options.max) {
    failConfig(`Miljövariabeln ${name} får vara högst ${options.max}`);
  }

  return value;
}

function requiredInt(name: string, options: { min?: number; max?: number } = {}): number {
  return validateNumber(name, readEnvNumber(name), { ...options, integer: true });
}

function optionalInt(name: string, defaultValue: number, options: { min?: number; max?: number } = {}): number {
  if (process.env[name] === undefined || process.env[name]?.trim() === '') {
    return defaultValue;
  }

  return requiredInt(name, options);
}

function requiredFloat(name: string, options: { min?: number; max?: number } = {}): number {
  return validateNumber(name, readEnvNumber(name), options);
}

function optionalFloat(name: string, defaultValue: number, options: { min?: number; max?: number } = {}): number {
  if (process.env[name] === undefined || process.env[name]?.trim() === '') {
    return defaultValue;
  }

  return requiredFloat(name, options);
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
  validateRequiredEnvVars([
    'MQTT_WS_PORT',
    'MQTT_HOST',
    'AUTH_EXPECTED_AUDIENCE',
  ]);

  const { allowedRegions, sources } = loadAllowedRegions();

  return {
    wsPort: requiredInt('MQTT_WS_PORT', { min: 1, max: 65535 }),
    host: process.env.MQTT_HOST!,
    expectedAudience: process.env.AUTH_EXPECTED_AUDIENCE!,
    jsonPublishMaxBytes: optionalInt('MQTT_JSON_PUBLISH_MAX_BYTES', 8192, { min: 1 }),
    wsMaxPayloadBytes: optionalInt('MQTT_WS_MAX_PAYLOAD_BYTES', 65536, { min: 1 }),
    allowedRegions,
    allowedRegionSources: sources,
  };
}

// Validate and load subscriber configuration
export function loadSubscriberConfig() {
  validateRequiredEnvVars([
    'SUBSCRIBER_MAX_CONNECTIONS_DEFAULT',
  ]);

  return {
    defaultMaxConnections: requiredInt('SUBSCRIBER_MAX_CONNECTIONS_DEFAULT', { min: 1 }),
  };
}

// Validate and load abuse detection configuration
export function loadAbuseConfig(): AbuseConfig {
  validateRequiredEnvVars([
    'ABUSE_DUPLICATE_WINDOW_SIZE',
    'ABUSE_DUPLICATE_WINDOW_MS',
    'ABUSE_DUPLICATE_THRESHOLD',
    'ABUSE_BUCKET_CAPACITY',
    'ABUSE_BUCKET_REFILL_RATE',
    'ABUSE_MAX_PACKET_SIZE',
    'ABUSE_MAX_TOPICS_PER_DAY',
    'ABUSE_ANOMALY_THRESHOLD',
    'ABUSE_MAX_IATA_CHANGES_24H',
    'ABUSE_TOPIC_HISTORY_SIZE',
    'ABUSE_TOPIC_HISTORY_WINDOW_MS',
    'ABUSE_PERSISTENCE_PATH',
    'ABUSE_PERSISTENCE_INTERVAL_MS',
    'ABUSE_ENFORCEMENT_ENABLED',
  ]);

  return {
    duplicateWindowSize: requiredInt('ABUSE_DUPLICATE_WINDOW_SIZE', { min: 1 }),
    duplicateWindowMs: requiredInt('ABUSE_DUPLICATE_WINDOW_MS', { min: 1 }),
    duplicateThreshold: requiredInt('ABUSE_DUPLICATE_THRESHOLD', { min: 1 }),
    maxDuplicatesPerPacket: optionalInt('ABUSE_MAX_DUPLICATES_PER_PACKET', 5, { min: 1 }),
    duplicateRateThreshold: optionalFloat('ABUSE_DUPLICATE_RATE_THRESHOLD', 0.3, { min: 0, max: 1 }),
    duplicateRateWindowMs: optionalInt('ABUSE_DUPLICATE_RATE_WINDOW_MS', 300000, { min: 1 }),
    bucketCapacity: requiredInt('ABUSE_BUCKET_CAPACITY', { min: 1 }),
    bucketRefillRate: requiredFloat('ABUSE_BUCKET_REFILL_RATE', { min: 0 }),
    maxPacketSize: requiredInt('ABUSE_MAX_PACKET_SIZE', { min: 1 }),
    maxTopicsPerDay: requiredInt('ABUSE_MAX_TOPICS_PER_DAY', { min: 1 }),
    anomalyThreshold: requiredInt('ABUSE_ANOMALY_THRESHOLD', { min: 1 }),
    maxIataChanges24h: requiredInt('ABUSE_MAX_IATA_CHANGES_24H', { min: 1 }),
    topicHistorySize: requiredInt('ABUSE_TOPIC_HISTORY_SIZE', { min: 1 }),
    topicHistoryWindowMs: requiredInt('ABUSE_TOPIC_HISTORY_WINDOW_MS', { min: 1 }),
    persistencePath: process.env.ABUSE_PERSISTENCE_PATH!,
    persistenceIntervalMs: requiredInt('ABUSE_PERSISTENCE_INTERVAL_MS', { min: 1 }),
    enforcementEnabled: process.env.ABUSE_ENFORCEMENT_ENABLED === 'true',
  };
}
