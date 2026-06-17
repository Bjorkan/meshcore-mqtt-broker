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
  allowedRegions: string[];
  allowedRegionSources: string[];
}

// Validate required environment variables
function validateRequiredEnvVars(vars: string[]): void {
  for (const envVar of vars) {
    if (process.env[envVar] === undefined) {
      console.error(`KRITISKT: Obligatorisk miljövariabel saknas: ${envVar}`);
      console.error('Kontrollera .env-filen och se till att alla variabler från .env.example är satta.');
      process.exit(1);
    }
  }
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
    wsPort: parseInt(process.env.MQTT_WS_PORT!),
    host: process.env.MQTT_HOST!,
    expectedAudience: process.env.AUTH_EXPECTED_AUDIENCE!,
    jsonPublishMaxBytes: parseInt(process.env.MQTT_JSON_PUBLISH_MAX_BYTES || '8192'),
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
    defaultMaxConnections: parseInt(process.env.SUBSCRIBER_MAX_CONNECTIONS_DEFAULT!),
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
    duplicateWindowSize: parseInt(process.env.ABUSE_DUPLICATE_WINDOW_SIZE!),
    duplicateWindowMs: parseInt(process.env.ABUSE_DUPLICATE_WINDOW_MS!),
    duplicateThreshold: parseInt(process.env.ABUSE_DUPLICATE_THRESHOLD!),
    maxDuplicatesPerPacket: parseInt(process.env.ABUSE_MAX_DUPLICATES_PER_PACKET || '5'),
    duplicateRateThreshold: parseFloat(process.env.ABUSE_DUPLICATE_RATE_THRESHOLD || '0.3'),
    duplicateRateWindowMs: parseInt(process.env.ABUSE_DUPLICATE_RATE_WINDOW_MS || '300000'),
    bucketCapacity: parseInt(process.env.ABUSE_BUCKET_CAPACITY!),
    bucketRefillRate: parseFloat(process.env.ABUSE_BUCKET_REFILL_RATE!),
    maxPacketSize: parseInt(process.env.ABUSE_MAX_PACKET_SIZE!),
    maxTopicsPerDay: parseInt(process.env.ABUSE_MAX_TOPICS_PER_DAY!),
    anomalyThreshold: parseInt(process.env.ABUSE_ANOMALY_THRESHOLD!),
    maxIataChanges24h: parseInt(process.env.ABUSE_MAX_IATA_CHANGES_24H!),
    topicHistorySize: parseInt(process.env.ABUSE_TOPIC_HISTORY_SIZE!),
    topicHistoryWindowMs: parseInt(process.env.ABUSE_TOPIC_HISTORY_WINDOW_MS!),
    persistencePath: process.env.ABUSE_PERSISTENCE_PATH!,
    persistenceIntervalMs: parseInt(process.env.ABUSE_PERSISTENCE_INTERVAL_MS!),
    enforcementEnabled: process.env.ABUSE_ENFORCEMENT_ENABLED === 'true',
  };
}
