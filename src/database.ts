import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  connect,
  type Database,
  type Transaction,
} from "@tursodatabase/database";

export const DATABASE_DIRECTORY = "/data/meshcore-mqtt-broker";
export const DATABASE_FILE = `${DATABASE_DIRECTORY}/meshcore-mqtt-broker.db`;

const SCHEMA_ID = "meshcore-mqtt-broker-turso-v1";
const QUERY_TIMEOUT_MS = 5_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS application_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_id TEXT NOT NULL,
  schema_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retained_packets (
  topic TEXT PRIMARY KEY,
  packet BLOB NOT NULL,
  stored_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS retained_packets_expiration
  ON retained_packets(expires_at_ms);

CREATE TABLE IF NOT EXISTS mqtt_subscriptions (
  client_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  qos INTEGER NOT NULL CHECK (qos BETWEEN 0 AND 2),
  rh INTEGER,
  rap INTEGER,
  nl INTEGER,
  subscription_identifier INTEGER,
  PRIMARY KEY (client_id, topic)
);
CREATE INDEX IF NOT EXISTS mqtt_subscriptions_topic
  ON mqtt_subscriptions(topic);

CREATE TABLE IF NOT EXISTS mqtt_outgoing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  packet BLOB NOT NULL,
  broker_id TEXT,
  broker_counter INTEGER,
  message_id INTEGER,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mqtt_outgoing_client_order
  ON mqtt_outgoing(client_id, id);
CREATE INDEX IF NOT EXISTS mqtt_outgoing_packet
  ON mqtt_outgoing(client_id, broker_id, broker_counter);
CREATE INDEX IF NOT EXISTS mqtt_outgoing_message
  ON mqtt_outgoing(client_id, message_id);

CREATE TABLE IF NOT EXISTS mqtt_incoming (
  client_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  packet BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (client_id, message_id)
);

CREATE TABLE IF NOT EXISTS mqtt_wills (
  client_id TEXT PRIMARY KEY,
  broker_id TEXT NOT NULL,
  packet BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mqtt_wills_broker ON mqtt_wills(broker_id);

CREATE TABLE IF NOT EXISTS target_retained_clears (
  topic TEXT PRIMARY KEY,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS target_retained_clears_expiration
  ON target_retained_clears(expires_at_ms, topic);

CREATE TABLE IF NOT EXISTS observer_profiles (
  public_key TEXT PRIMARY KEY CHECK (length(public_key) = 64),
  node_name TEXT,
  node_name_expires_at_ms INTEGER,
  latest_status_at_ms INTEGER,
  status_expires_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS observer_profiles_name_expiration
  ON observer_profiles(node_name_expires_at_ms);
CREATE INDEX IF NOT EXISTS observer_profiles_status_expiration
  ON observer_profiles(status_expires_at_ms);

CREATE TABLE IF NOT EXISTS observer_state (
  public_key TEXT PRIMARY KEY CHECK (length(public_key) = 64),
  label TEXT NOT NULL,
  broker TEXT NOT NULL,
  region TEXT,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  last_connected_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  messages_json TEXT NOT NULL,
  neighbors_json TEXT,
  neighbors_expires_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS observer_state_last_seen
  ON observer_state(last_seen_at_ms DESC, public_key);
CREATE INDEX IF NOT EXISTS observer_state_neighbors_expiration
  ON observer_state(neighbors_expires_at_ms);

CREATE TABLE IF NOT EXISTS trust_state (
  public_key TEXT PRIMARY KEY CHECK (length(public_key) = 64),
  state_json TEXT NOT NULL,
  status TEXT NOT NULL,
  muted_until_ms INTEGER,
  updated_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trust_state_status_updated
  ON trust_state(status, updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS trust_state_expiration
  ON trust_state(expires_at_ms);

CREATE TABLE IF NOT EXISTS denied_publish_events (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  label TEXT,
  broker TEXT NOT NULL,
  reason TEXT NOT NULL,
  topic TEXT NOT NULL,
  region TEXT,
  denied_until_text TEXT,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS denied_publish_events_order
  ON denied_publish_events(created_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS denied_publish_events_public_key
  ON denied_publish_events(public_key, created_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS denied_publish_events_expiration
  ON denied_publish_events(expires_at_ms);

CREATE TABLE IF NOT EXISTS observer_rejection_events (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL CHECK (length(public_key) = 64),
  stage TEXT NOT NULL CHECK (stage IN ('authentication', 'publish')),
  reason TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS observer_rejection_events_public_key
  ON observer_rejection_events(public_key, created_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS observer_rejection_events_expiration
  ON observer_rejection_events(expires_at_ms);

CREATE TABLE IF NOT EXISTS heard_node_adverts (
  node_public_key TEXT PRIMARY KEY CHECK (length(node_public_key) = 64),
  advert_timestamp INTEGER NOT NULL,
  advert_type TEXT NOT NULL,
  node_name TEXT,
  latitude REAL,
  longitude REAL,
  raw_packet BLOB NOT NULL,
  advert_received_at_ms INTEGER NOT NULL,
  last_heard_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS heard_node_adverts_order
  ON heard_node_adverts(last_heard_at_ms DESC, node_public_key);
CREATE INDEX IF NOT EXISTS heard_node_adverts_expiration
  ON heard_node_adverts(expires_at_ms, node_public_key);

CREATE TABLE IF NOT EXISTS heard_node_regions (
  node_public_key TEXT NOT NULL CHECK (length(node_public_key) = 64),
  region TEXT NOT NULL,
  observer_public_key TEXT NOT NULL CHECK (length(observer_public_key) = 64),
  last_heard_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (node_public_key, region)
);
CREATE INDEX IF NOT EXISTS heard_node_regions_region_order
  ON heard_node_regions(region, last_heard_at_ms DESC, node_public_key);
CREATE INDEX IF NOT EXISTS heard_node_regions_expiration
  ON heard_node_regions(expires_at_ms, node_public_key, region);

CREATE TABLE IF NOT EXISTS meshcore_io_ingress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digest TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  payload BLOB NOT NULL,
  received_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  processing INTEGER NOT NULL DEFAULT 0 CHECK (processing IN (0, 1))
);
CREATE INDEX IF NOT EXISTS meshcore_io_ingress_order
  ON meshcore_io_ingress(id);
CREATE INDEX IF NOT EXISTS meshcore_io_ingress_expiration
  ON meshcore_io_ingress(expires_at_ms);

CREATE TABLE IF NOT EXISTS meshcore_io_ingress_dedup (
  digest TEXT PRIMARY KEY,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS meshcore_io_ingress_dedup_expiration
  ON meshcore_io_ingress_dedup(expires_at_ms);

CREATE TABLE IF NOT EXISTS meshcore_io_observer_radio (
  observer_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS meshcore_io_observer_radio_expiration
  ON meshcore_io_observer_radio(expires_at_ms);

CREATE TABLE IF NOT EXISTS meshcore_io_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  deduplication_key TEXT NOT NULL,
  node_public_key TEXT NOT NULL,
  job_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'retry', 'completed', 'dropped')),
  created_at_ms INTEGER NOT NULL,
  next_attempt_at_ms INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  processing_started_at_ms INTEGER,
  completed_at_ms INTEGER,
  last_error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS meshcore_io_jobs_active_node
  ON meshcore_io_jobs(node_public_key)
  WHERE status IN ('pending', 'processing', 'retry');
CREATE UNIQUE INDEX IF NOT EXISTS meshcore_io_jobs_active_dedup
  ON meshcore_io_jobs(deduplication_key)
  WHERE status IN ('pending', 'processing', 'retry');
CREATE INDEX IF NOT EXISTS meshcore_io_jobs_claim
  ON meshcore_io_jobs(status, next_attempt_at_ms, id);
CREATE INDEX IF NOT EXISTS meshcore_io_jobs_history
  ON meshcore_io_jobs(completed_at_ms DESC, id DESC);

CREATE TABLE IF NOT EXISTS meshcore_io_node_state (
  node_public_key TEXT PRIMARY KEY,
  cooldown_until_ms INTEGER,
  accepted_advert_timestamp INTEGER,
  accepted_expires_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS meshcore_io_node_state_expiration
  ON meshcore_io_node_state(accepted_expires_at_ms);

CREATE TABLE IF NOT EXISTS meshcore_io_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'dropped')),
  request_id TEXT NOT NULL,
  node_name TEXT NOT NULL,
  node_public_key TEXT NOT NULL,
  advert_type TEXT NOT NULL,
  observer_name TEXT,
  worker_instance_id TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS meshcore_io_history_order
  ON meshcore_io_history(at_ms DESC, id DESC);

CREATE TABLE IF NOT EXISTS meshcore_io_map (
  node_public_key TEXT PRIMARY KEY,
  advert_json TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS meshcore_io_map_order
  ON meshcore_io_map(at_ms DESC, node_public_key);

CREATE TABLE IF NOT EXISTS meshcore_io_stats (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  enqueued INTEGER NOT NULL DEFAULT 0,
  uploaded INTEGER NOT NULL DEFAULT 0,
  dropped INTEGER NOT NULL DEFAULT 0,
  invalid INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_error_at_ms INTEGER
);
`;

const REQUIRED_TABLES = [
  "application_metadata",
  "retained_packets",
  "mqtt_subscriptions",
  "mqtt_outgoing",
  "mqtt_incoming",
  "mqtt_wills",
  "target_retained_clears",
  "observer_profiles",
  "observer_state",
  "trust_state",
  "denied_publish_events",
  "observer_rejection_events",
  "heard_node_adverts",
  "heard_node_regions",
  "meshcore_io_ingress",
  "meshcore_io_ingress_dedup",
  "meshcore_io_observer_radio",
  "meshcore_io_jobs",
  "meshcore_io_node_state",
  "meshcore_io_history",
  "meshcore_io_map",
  "meshcore_io_stats",
] as const;

const REQUIRED_COLUMNS: Record<(typeof REQUIRED_TABLES)[number], string[]> = {
  application_metadata: ["singleton", "schema_id", "schema_hash"],
  retained_packets: ["topic", "packet", "stored_at_ms", "expires_at_ms"],
  mqtt_subscriptions: [
    "client_id",
    "topic",
    "qos",
    "rh",
    "rap",
    "nl",
    "subscription_identifier",
  ],
  mqtt_outgoing: [
    "id",
    "client_id",
    "packet",
    "broker_id",
    "broker_counter",
    "message_id",
    "created_at_ms",
  ],
  mqtt_incoming: ["client_id", "message_id", "packet", "created_at_ms"],
  mqtt_wills: ["client_id", "broker_id", "packet", "created_at_ms"],
  target_retained_clears: ["topic", "expires_at_ms"],
  observer_profiles: [
    "public_key",
    "node_name",
    "node_name_expires_at_ms",
    "latest_status_at_ms",
    "status_expires_at_ms",
  ],
  observer_state: [
    "public_key",
    "label",
    "broker",
    "region",
    "active",
    "last_connected_at_ms",
    "last_seen_at_ms",
    "message_count",
    "messages_json",
    "neighbors_json",
    "neighbors_expires_at_ms",
    "updated_at_ms",
  ],
  trust_state: [
    "public_key",
    "state_json",
    "status",
    "muted_until_ms",
    "updated_at_ms",
    "expires_at_ms",
  ],
  denied_publish_events: [
    "id",
    "public_key",
    "label",
    "broker",
    "reason",
    "topic",
    "region",
    "denied_until_text",
    "created_at_ms",
    "expires_at_ms",
  ],
  observer_rejection_events: [
    "id",
    "public_key",
    "stage",
    "reason",
    "created_at_ms",
    "expires_at_ms",
  ],
  heard_node_adverts: [
    "node_public_key",
    "advert_timestamp",
    "advert_type",
    "node_name",
    "latitude",
    "longitude",
    "raw_packet",
    "advert_received_at_ms",
    "last_heard_at_ms",
    "expires_at_ms",
  ],
  heard_node_regions: [
    "node_public_key",
    "region",
    "observer_public_key",
    "last_heard_at_ms",
    "expires_at_ms",
  ],
  meshcore_io_ingress: [
    "id",
    "digest",
    "topic",
    "payload",
    "received_at_ms",
    "expires_at_ms",
    "processing",
  ],
  meshcore_io_ingress_dedup: ["digest", "expires_at_ms"],
  meshcore_io_observer_radio: [
    "observer_id",
    "state_json",
    "updated_at_ms",
    "expires_at_ms",
  ],
  meshcore_io_jobs: [
    "id",
    "request_id",
    "deduplication_key",
    "node_public_key",
    "job_json",
    "status",
    "created_at_ms",
    "next_attempt_at_ms",
    "attempt_count",
    "processing_started_at_ms",
    "completed_at_ms",
    "last_error",
  ],
  meshcore_io_node_state: [
    "node_public_key",
    "cooldown_until_ms",
    "accepted_advert_timestamp",
    "accepted_expires_at_ms",
  ],
  meshcore_io_history: [
    "id",
    "at_ms",
    "status",
    "request_id",
    "node_name",
    "node_public_key",
    "advert_type",
    "observer_name",
    "worker_instance_id",
    "detail",
  ],
  meshcore_io_map: ["node_public_key", "advert_json", "at_ms"],
  meshcore_io_stats: [
    "singleton",
    "enqueued",
    "uploaded",
    "dropped",
    "invalid",
    "retries",
    "last_error",
    "last_error_at_ms",
  ],
};

export class IncompatibleDatabaseError extends Error {
  constructor(detail: string) {
    super(
      `Databasen är inte kompatibel med denna installation (${detail}). Stoppa containern, säkerhetskopiera den bind-monterade katalogen vid behov och starta med en tom datakatalog.`,
    );
    this.name = "IncompatibleDatabaseError";
  }
}

export class ApplicationDatabase {
  private readonly pendingOperations = new Set<Promise<unknown>>();
  private closing = false;

  private constructor(
    private readonly connection: Database,
    readonly file: string,
  ) {}

  static async open(file: string): Promise<ApplicationDatabase> {
    return ApplicationDatabase.connect(file, true);
  }

  static async openExisting(file: string): Promise<ApplicationDatabase> {
    return ApplicationDatabase.connect(file, false);
  }

  private static async connect(
    file: string,
    initialize: boolean,
  ): Promise<ApplicationDatabase> {
    const connection = await connect(file, {
      timeout: QUERY_TIMEOUT_MS,
      defaultQueryTimeout: QUERY_TIMEOUT_MS,
      experimental: ["multiprocess_wal"],
    });
    const database = new ApplicationDatabase(connection, file);
    try {
      if (initialize) {
        await database.initialize();
      } else {
        await database.validateCurrentSchema();
        await database.probe();
      }
      return database;
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    const metadataTable = (await this.connection.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      "application_metadata",
    )) as { name?: string } | undefined;

    if (!metadataTable) {
      const existing = (await this.connection.all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
      )) as Array<{ name: string }>;
      if (existing.length > 0) {
        throw new IncompatibleDatabaseError(
          `schema-id saknas men tabellen ${existing[0].name} finns`,
        );
      }
      await this.connection.exec(SCHEMA);
      const schemaHash = await this.schemaFingerprint();
      await this.connection.run(
        `INSERT INTO application_metadata(singleton, schema_id, schema_hash)
         VALUES (1, ?, ?)`,
        SCHEMA_ID,
        schemaHash,
      );
      await this.connection.run(
        "INSERT INTO meshcore_io_stats(singleton) VALUES (1)",
      );
    }

    await this.validateCurrentSchema();
    await this.probe();
  }

  private async validateSchemaMarker(): Promise<void> {
    try {
      const metadata = (await this.connection.get(
        `SELECT schema_id, schema_hash FROM application_metadata
         WHERE singleton = 1`,
      )) as { schema_id?: string; schema_hash?: string } | undefined;
      if (metadata?.schema_id !== SCHEMA_ID) {
        throw new IncompatibleDatabaseError("okänt schema-id");
      }
      if (metadata.schema_hash !== (await this.schemaFingerprint())) {
        throw new IncompatibleDatabaseError("schemats struktur har ändrats");
      }
    } catch (error) {
      if (error instanceof IncompatibleDatabaseError) throw error;
      throw new IncompatibleDatabaseError(
        `schema-id kan inte läsas: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async validateCurrentSchema(): Promise<void> {
    await this.validateSchemaMarker();

    const rows = (await this.connection.all(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map(() => "?").join(",")})`,
      ...REQUIRED_TABLES,
    )) as Array<{ name: string }>;
    const actual = new Set(rows.map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((table) => !actual.has(table));
    if (missing.length > 0) {
      throw new IncompatibleDatabaseError(
        `tabeller saknas: ${missing.join(", ")}`,
      );
    }

    for (const table of REQUIRED_TABLES) {
      const columns = (await this.connection.all(
        `PRAGMA table_info(${table})`,
      )) as Array<{ name: string }>;
      const names = new Set(columns.map((column) => column.name));
      const missingColumns = REQUIRED_COLUMNS[table].filter(
        (column) => !names.has(column),
      );
      if (missingColumns.length > 0) {
        throw new IncompatibleDatabaseError(
          `kolumner saknas i ${table}: ${missingColumns.join(", ")}`,
        );
      }
    }
  }

  private async schemaFingerprint(): Promise<string> {
    const rows = (await this.connection.all(
      `SELECT type, name, sql FROM sqlite_master
       WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
       ORDER BY type ASC, name ASC`,
    )) as Array<{ type: string; name: string; sql: string | null }>;
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }

  prepare(sql: string) {
    if (this.closing) throw new Error("Databasen håller på att stängas");
    return this.connection.prepare(sql);
  }

  run(sql: string, ...parameters: unknown[]) {
    return this.execute(() => this.connection.run(sql, ...parameters));
  }

  get<T>(sql: string, ...parameters: unknown[]): Promise<T | undefined> {
    return this.execute(
      () => this.connection.get(sql, ...parameters) as Promise<T | undefined>,
    );
  }

  all<T>(sql: string, ...parameters: unknown[]): Promise<T[]> {
    return this.execute(
      () => this.connection.all(sql, ...parameters) as Promise<T[]>,
    );
  }

  transaction<Arguments extends unknown[], Result>(
    operation: (
      transaction: Transaction,
      ...args: Arguments
    ) => Promise<Result>,
  ) {
    const transaction = this.connection.transactionAsync(operation);
    const wrap =
      (run: typeof transaction) =>
      (...args: Arguments): Promise<Result> =>
        this.execute(() => run(...args));
    return Object.assign(wrap(transaction), {
      default: wrap(transaction.default),
      deferred: wrap(transaction.deferred),
      concurrent: wrap(transaction.concurrent),
      immediate: wrap(transaction.immediate),
      exclusive: wrap(transaction.exclusive),
      database: transaction.database,
    });
  }

  async probe(): Promise<void> {
    const row = await this.get<{ ok: number }>(
      "SELECT 1 AS ok FROM application_metadata WHERE singleton = 1 LIMIT 1",
    );
    if (Number(row?.ok) !== 1) {
      throw new Error("Databasens hälsokontroll returnerade inget svar");
    }
  }

  async drain(): Promise<void> {
    for (;;) {
      if (this.pendingOperations.size > 0) {
        await Promise.allSettled([...this.pendingOperations]);
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (this.pendingOperations.size === 0) return;
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.drain();
    await this.connection.close();
  }

  private execute<Result>(operation: () => Promise<Result>): Promise<Result> {
    if (this.closing) {
      return Promise.reject(new Error("Databasen håller på att stängas"));
    }
    const promise = operation();
    this.pendingOperations.add(promise);
    const remove = () => this.pendingOperations.delete(promise);
    void promise.then(remove, remove);
    return promise;
  }
}

async function prepareDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const details = await stat(directory);
  if (!details.isDirectory()) {
    throw new Error(`${directory} är inte en katalog`);
  }
  await access(directory, constants.R_OK | constants.W_OK);
}

export async function openProductionDatabase(): Promise<ApplicationDatabase> {
  try {
    await prepareDirectory(DATABASE_DIRECTORY);
    return await ApplicationDatabase.open(DATABASE_FILE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Lagringen ${DATABASE_DIRECTORY} kan inte användas: ${message}. Kontrollera bind-monteringen och att containeranvändaren har läs- och skrivrättigheter.`,
    );
  }
}

export async function openExistingProductionDatabase(): Promise<ApplicationDatabase> {
  try {
    const details = await stat(DATABASE_DIRECTORY);
    if (!details.isDirectory()) {
      throw new Error(`${DATABASE_DIRECTORY} är inte en katalog`);
    }
    await access(DATABASE_DIRECTORY, constants.R_OK | constants.W_OK);
    return await ApplicationDatabase.openExisting(DATABASE_FILE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Lagringen ${DATABASE_DIRECTORY} kan inte användas: ${message}. Kontrollera bind-monteringen och att containeranvändaren har läs- och skrivrättigheter.`,
    );
  }
}

export async function openTestDatabase(
  file: string,
): Promise<ApplicationDatabase> {
  const absoluteFile = resolve(file);
  await prepareDirectory(dirname(absoluteFile));
  return ApplicationDatabase.open(absoluteFile);
}
