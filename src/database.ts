import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { SQL } from "bun";
import { regionScopeRegistryEntries } from "./region-scopes.js";
import { getModuleLogger } from "./logger.js";

/** Retained for CLI display compatibility; PostgreSQL has no local database file. */
export const DATABASE_FILE = "PostgreSQL";
/**
 * Current canonical schema version. Version 11 records when this database
 * generation was created so resets are observable without retaining state.
 */
export const CURRENT_SCHEMA_VERSION = 11;
/**
 * Version 10 can be upgraded in place. Other incompatible but reachable
 * application databases are reprovisioned after that one migration attempt.
 */
const ACCEPTED_SCHEMA_VERSIONS: readonly number[] = [11];
const FINGERPRINT_FORMAT_V2 = "fingerprint-v2";

export const SCHEMA_ID = "meshcore-mqtt-broker-postgres-v1";
/** Placeholder stored by the static initdb asset until the first broker start computes the real fingerprint. */
const SCHEMA_HASH_PENDING = "pending";
const QUERY_TIMEOUT_MS = 5_000;
const DEFAULT_MIGRATION_TIMEOUT_MS = 30_000;
const MIN_MIGRATION_TIMEOUT_MS = 1_000;
const MAX_MIGRATION_TIMEOUT_MS = 300_000;
const MESHCORE_DATABASE = "meshcore";
/**
 * Broker-owned schema resolution. Applied as a connection startup GUC so
 * every pooled connection starts with the same search_path. Sessions that
 * must pin pg_catalog (fingerprinting) restore it with an explicit SET —
 * PostgreSQL RESET goes to the compiled-in default, not the startup value.
 */
const SCHEMA_SEARCH_PATH = "meshcore_private,meshcore_public";
let databaseResetCount = 0;
const recoveryLog = getModuleLogger("DatabaseRecovery");

export interface DatabaseOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  max?: number;
  /** Milliseconds; mapped to Bun.SQL `connectionTimeout` seconds. */
  connectionTimeoutMillis?: number;
  /** Milliseconds; mapped to the statement_timeout startup GUC. */
  query_timeout?: number;
  ssl?: boolean | { rejectUnauthorized: boolean };
}

/**
 * Loose row shape mirroring node-postgres' permissive column access so the
 * ~200 first-party statements keep their exact call-site semantics after the
 * driver swap; explicitly typed calls remain fully typed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DatabaseRow = { [column: string]: any };
type SqlRows = Array<DatabaseRow>;
/** Driver-neutral execution surface shared by pool, transactions and reserved sessions. */
export type SqlExecutor = {
  unsafe(text: string, parameters?: unknown[]): Promise<SqlRows>;
};

/**
 * Normalizes array bind values into a safe PostgreSQL array literal bound as
 * a positional parameter (call sites already cast `$n::text[]`/`::int[]`).
 * Plain JS arrays are rejected by Bun.SQL binding ("malformed array literal"),
 * and runtime input must never become identifier/SQL text, so only allowlisted
 * element types are accepted here — anything else fails loudly.
 */
function normalizeParameters(parameters: readonly unknown[]): unknown[] {
  return parameters.map((value) => {
    if (!Array.isArray(value)) return value;
    const elements = value.map((element) => {
      if (typeof element === "string")
        return `"${element.replace(/\\/g, "\\\\")}"`;
      if (typeof element === "number" && Number.isFinite(element))
        return String(element);
      throw new Error(
        "array query parameters stöder endast string[] eller number[]",
      );
    });
    return `{${elements.join(",")}}`;
  });
}

/** Builds an explicit Bun.SQL pool instance from broker database options. */
export function createSqlInstance(
  config: DatabaseOptions,
  options: { searchPath?: boolean } = {},
): SQL {
  return sqlInstance(config, options);
}

function sqlInstance(
  config: DatabaseOptions,
  instanceOptions: { searchPath?: boolean } = {},
): SQL {
  // Explicit configuration wins over ambient DATABASE_URL/POSTGRES_URL.
  // Explicit configuration wins over ambient DATABASE_URL/POSTGRES_URL.
  let hostname = config.host;
  let port = config.port;
  let database = config.database;
  let username = config.user;
  let password = config.password;
  if (
    config.connectionString !== undefined &&
    (hostname === undefined ||
      port === undefined ||
      database === undefined ||
      username === undefined ||
      password === undefined)
  ) {
    const url = new URL(config.connectionString);
    hostname ??= url.hostname;
    port ??= Number(url.port || 5432);
    database ??= decodeURIComponent(url.pathname.slice(1));
    username ??= decodeURIComponent(url.username);
    password ??= decodeURIComponent(url.password);
  }
  if (
    hostname === undefined ||
    port === undefined ||
    database === undefined ||
    username === undefined ||
    password === undefined
  )
    throw new Error(
      "Databasanslutningen kräver connectionString eller explicit host/port/database/user/password",
    );
  const statementTimeoutMs =
    config.query_timeout ?? config.connectionTimeoutMillis ?? QUERY_TIMEOUT_MS;
  const connectionTimeoutSeconds = Math.max(
    1,
    Math.round(statementTimeoutMs / 1_000),
  );
  return new SQL({
    adapter: "postgres",
    hostname,
    port,
    database,
    username,
    password,
    max: config.max ?? 10,
    idleTimeout: 30,
    connectionTimeout: connectionTimeoutSeconds,
    // Migration/admin tooling connects before roles/schemas exist and must
    // not depend on USAGE rights for broker schemas, so it opts out.
    ...(instanceOptions.searchPath === false
      ? { connection: { statement_timeout: statementTimeoutMs } }
      : {
          connection: {
            search_path: SCHEMA_SEARCH_PATH,
            statement_timeout: statementTimeoutMs,
          },
        }),
    ...(config.ssl
      ? {
          tls:
            typeof config.ssl === "object" && config.ssl !== null
              ? { rejectUnauthorized: config.ssl.rejectUnauthorized }
              : { rejectUnauthorized: true },
        }
      : {}),
  });
}

async function execute(
  text: string,
  executor: SQL | SqlExecutor,
  parameters: readonly unknown[] = [],
): Promise<SqlRows> {
  const bound = normalizeParameters(parameters);
  // Array.from strips Bun's extra enumerable result metadata properties so
  // consumers see plain row arrays.
  type UnsafeRunner = {
    unsafe(
      text: string,
      parameters?: readonly unknown[],
    ): Promise<SqlRows | undefined>;
  };
  const runner = executor as UnsafeRunner;
  const raw = (await runner.unsafe(text, [...bound])) ?? [];
  return Array.from(raw);
}

export type DatabaseRecoveryReason =
  | "unsupported_schema_version"
  | "future_schema_version"
  | "unknown_schema"
  | "fingerprint_mismatch"
  | "missing_schema_objects"
  | "migration_failed"
  | "migration_timeout"
  | "post_migration_validation_failed";

const PRIVATE_TABLES = [
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
  "heard_node_iata",
  "meshcore_io_ingress",
  "meshcore_io_ingress_dedup",
  "meshcore_io_observer_radio",
  "meshcore_io_jobs",
  "meshcore_io_node_state",
  "meshcore_io_history",
  "meshcore_io_map",
  "meshcore_io_stats",
  "observers",
  "mqtt_events",
  "observer_iata_history",
  "observer_status_events",
  "observer_metrics",
  "observer_radio_history",
  "neighbor_snapshots",
  "neighbor_entries",
  "neighbor_snapshot_scopes",
  "neighbor_entry_scopes",
  "logical_packets",
  "packets",
  "packet_observations",
  "nodes",
  "node_adverts",
  "node_sightings",
  "node_prefix_candidates",
  "packet_paths",
  "packet_path_hops",
  "trace_events",
  "trace_hops",
  "messages",
  "telemetry_events",
  "telemetry_values",
  "processing_errors",
] as const;

const PUBLIC_TABLES = [
  "schema_metadata",
  "nodes",
  "observers",
  "observer_status",
  "observer_metrics",
  "packets",
  "packet_observations",
  "node_adverts",
  "node_sightings",
  "node_prefix_candidates",
  "neighbor_snapshots",
  "neighbor_entries",
  "neighbor_snapshot_scopes",
  "neighbor_entry_scopes",
  "packet_paths",
  "packet_path_hops",
  "traces",
  "trace_hops",
  "messages",
  "telemetry",
  "region_scopes",
] as const;

// Raw MQTT packets, unparsed JSON, broker state, and operational queues remain private.
const PRIVATE_SCHEMA_DDL = `
CREATE SCHEMA IF NOT EXISTS meshcore_private;
CREATE TABLE IF NOT EXISTS meshcore_private.application_metadata (singleton integer PRIMARY KEY CHECK (singleton = 1), schema_id text NOT NULL, schema_version integer NOT NULL, schema_hash text NOT NULL, database_created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS meshcore_private.retained_packets (topic text PRIMARY KEY, packet bytea NOT NULL, stored_at_ms bigint NOT NULL, expires_at_ms bigint);
CREATE INDEX IF NOT EXISTS retained_packets_expiration ON meshcore_private.retained_packets(expires_at_ms);
CREATE TABLE IF NOT EXISTS meshcore_private.mqtt_subscriptions (client_id text NOT NULL, topic text NOT NULL, qos integer NOT NULL CHECK (qos BETWEEN 0 AND 2), rh integer, rap integer, nl integer, subscription_identifier integer, PRIMARY KEY (client_id, topic));
CREATE INDEX IF NOT EXISTS mqtt_subscriptions_topic ON meshcore_private.mqtt_subscriptions(topic);
CREATE TABLE IF NOT EXISTS meshcore_private.mqtt_outgoing (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, client_id text NOT NULL, packet bytea NOT NULL, broker_id text, broker_counter bigint, message_id integer, created_at_ms bigint NOT NULL);
CREATE INDEX IF NOT EXISTS mqtt_outgoing_client_order ON meshcore_private.mqtt_outgoing(client_id, id);
CREATE INDEX IF NOT EXISTS mqtt_outgoing_packet ON meshcore_private.mqtt_outgoing(client_id, broker_id, broker_counter);
CREATE INDEX IF NOT EXISTS mqtt_outgoing_message ON meshcore_private.mqtt_outgoing(client_id, message_id);
CREATE TABLE IF NOT EXISTS meshcore_private.mqtt_incoming (client_id text NOT NULL, message_id integer NOT NULL, packet bytea NOT NULL, created_at_ms bigint NOT NULL, PRIMARY KEY (client_id, message_id));
CREATE TABLE IF NOT EXISTS meshcore_private.mqtt_wills (client_id text PRIMARY KEY, broker_id text NOT NULL, packet bytea NOT NULL, created_at_ms bigint NOT NULL);
CREATE INDEX IF NOT EXISTS mqtt_wills_broker ON meshcore_private.mqtt_wills(broker_id);
CREATE TABLE IF NOT EXISTS meshcore_private.target_retained_clears (topic text PRIMARY KEY, expires_at_ms bigint NOT NULL);
CREATE INDEX IF NOT EXISTS target_retained_clears_expiration ON meshcore_private.target_retained_clears(expires_at_ms, topic);
CREATE TABLE IF NOT EXISTS meshcore_private.observer_profiles (public_key text PRIMARY KEY CHECK (length(public_key) = 64), node_name text, node_name_expires_at_ms bigint, latest_status_at_ms bigint, status_expires_at_ms bigint);
CREATE TABLE IF NOT EXISTS meshcore_private.observer_state (public_key text PRIMARY KEY CHECK (length(public_key) = 64), label text NOT NULL, broker text NOT NULL, iata text CHECK (iata IS NULL OR iata ~ '^[A-Z]{3}$'), active boolean NOT NULL, last_connected_at_ms bigint NOT NULL, last_seen_at_ms bigint NOT NULL, message_count bigint NOT NULL, messages_json text NOT NULL, neighbors_json text, neighbors_expires_at_ms bigint, updated_at_ms bigint NOT NULL);
CREATE INDEX IF NOT EXISTS observer_state_last_seen ON meshcore_private.observer_state(last_seen_at_ms DESC, public_key);
CREATE TABLE IF NOT EXISTS meshcore_private.trust_state (public_key text PRIMARY KEY CHECK (length(public_key) = 64), state_json text NOT NULL, status text NOT NULL, muted_until_ms bigint, updated_at_ms bigint NOT NULL, expires_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.denied_publish_events (id text PRIMARY KEY, public_key text NOT NULL, label text, broker text NOT NULL, reason text NOT NULL, topic text NOT NULL, iata text CHECK (iata IS NULL OR iata ~ '^[A-Z]{3}$'), denied_until_text text, created_at_ms bigint NOT NULL, expires_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.observer_rejection_events (id text PRIMARY KEY, public_key text NOT NULL CHECK (length(public_key) = 64), stage text NOT NULL CHECK (stage IN ('authentication', 'publish')), reason text NOT NULL, created_at_ms bigint NOT NULL, expires_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.heard_node_adverts (node_public_key text PRIMARY KEY CHECK (length(node_public_key) = 64), advert_timestamp bigint NOT NULL, advert_type text NOT NULL, node_name text, latitude double precision, longitude double precision, raw_packet bytea NOT NULL, advert_received_at_ms bigint NOT NULL, last_heard_at_ms bigint NOT NULL, expires_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.heard_node_iata (node_public_key text NOT NULL CHECK (length(node_public_key) = 64), iata text NOT NULL CHECK (iata ~ '^[A-Z]{3}$'), observer_public_key text NOT NULL CHECK (length(observer_public_key) = 64), last_heard_at_ms bigint NOT NULL, expires_at_ms bigint NOT NULL, PRIMARY KEY (node_public_key, iata));
CREATE TABLE IF NOT EXISTS meshcore_private.meshcore_io_ingress (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, digest text NOT NULL UNIQUE, topic text NOT NULL, payload bytea NOT NULL, received_at_ms bigint NOT NULL, expires_at_ms bigint NOT NULL, processing boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS meshcore_private.meshcore_io_ingress_dedup (digest text PRIMARY KEY, expires_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.meshcore_io_observer_radio (observer_id text PRIMARY KEY, state_json text NOT NULL, updated_at_ms bigint NOT NULL, expires_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.meshcore_io_jobs (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, request_id text NOT NULL UNIQUE, deduplication_key text NOT NULL, node_public_key text NOT NULL, job_json text NOT NULL, status text NOT NULL CHECK (status IN ('pending', 'processing', 'retry', 'completed', 'dropped')), created_at_ms bigint NOT NULL, next_attempt_at_ms bigint NOT NULL, attempt_count integer NOT NULL DEFAULT 0, processing_started_at_ms bigint, completed_at_ms bigint, last_error text);
CREATE UNIQUE INDEX IF NOT EXISTS meshcore_io_jobs_active_node ON meshcore_private.meshcore_io_jobs(node_public_key) WHERE status IN ('pending', 'processing', 'retry');
CREATE UNIQUE INDEX IF NOT EXISTS meshcore_io_jobs_active_dedup ON meshcore_private.meshcore_io_jobs(deduplication_key) WHERE status IN ('pending', 'processing', 'retry');
CREATE INDEX IF NOT EXISTS meshcore_io_jobs_claim ON meshcore_private.meshcore_io_jobs(status, next_attempt_at_ms, id);
CREATE TABLE IF NOT EXISTS meshcore_private.meshcore_io_node_state (node_public_key text PRIMARY KEY, cooldown_until_ms bigint, accepted_advert_timestamp bigint, accepted_expires_at_ms bigint);
CREATE TABLE IF NOT EXISTS meshcore_private.meshcore_io_history (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, at_ms bigint NOT NULL, status text NOT NULL CHECK (status IN ('uploaded', 'dropped')), request_id text NOT NULL, node_name text NOT NULL, node_public_key text NOT NULL, advert_type text NOT NULL, observer_name text, worker_instance_id text NOT NULL, detail text);
CREATE TABLE IF NOT EXISTS meshcore_private.meshcore_io_map (node_public_key text PRIMARY KEY, advert_json text NOT NULL, at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.meshcore_io_stats (singleton integer PRIMARY KEY CHECK (singleton = 1), enqueued bigint NOT NULL DEFAULT 0, uploaded bigint NOT NULL DEFAULT 0, dropped bigint NOT NULL DEFAULT 0, invalid bigint NOT NULL DEFAULT 0, retries bigint NOT NULL DEFAULT 0, last_error text, last_error_at_ms bigint);
CREATE TABLE IF NOT EXISTS meshcore_private.observers (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, public_key text NOT NULL UNIQUE CHECK (length(public_key) = 64), first_seen_at_ms bigint NOT NULL, last_seen_at_ms bigint NOT NULL, latest_iata text CHECK (latest_iata IS NULL OR latest_iata ~ '^[A-Z]{3}$'), latest_iata_event_id bigint, created_at_ms bigint NOT NULL, updated_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.mqtt_events (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, topic text NOT NULL, iata text CHECK (iata IS NULL OR iata ~ '^[A-Z]{3}$'), observer_id bigint REFERENCES meshcore_private.observers(id) ON DELETE SET NULL, subtopic text, subtopic_root text, payload_blob bytea NOT NULL, payload_text text, payload_sha256 text NOT NULL, qos integer NOT NULL CHECK (qos BETWEEN 0 AND 2), retain boolean NOT NULL, dup boolean NOT NULL, received_at_ms bigint NOT NULL, payload_format text NOT NULL, parse_status text NOT NULL, processing_status text NOT NULL, processing_started_at_ms bigint, processing_attempts integer NOT NULL DEFAULT 0, parser_name text NOT NULL, parser_version text NOT NULL, collector_instance_id text NOT NULL, created_at_ms bigint NOT NULL, updated_at_ms bigint NOT NULL);
CREATE INDEX IF NOT EXISTS mqtt_events_received ON meshcore_private.mqtt_events(received_at_ms, id);
CREATE TABLE IF NOT EXISTS meshcore_private.observer_iata_history (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, observer_id bigint NOT NULL REFERENCES meshcore_private.observers(id) ON DELETE CASCADE, iata text NOT NULL CHECK (iata ~ '^[A-Z]{3}$'), first_seen_at_ms bigint NOT NULL, last_seen_at_ms bigint NOT NULL, observation_count integer NOT NULL, UNIQUE(observer_id, iata));
CREATE TABLE IF NOT EXISTS meshcore_private.observer_status_events (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, mqtt_event_id bigint NOT NULL UNIQUE REFERENCES meshcore_private.mqtt_events(id) ON DELETE CASCADE, observer_id bigint NOT NULL REFERENCES meshcore_private.observers(id) ON DELETE CASCADE, iata text NOT NULL CHECK (iata ~ '^[A-Z]{3}$'), reported_at_ms bigint, received_at_ms bigint NOT NULL, origin text, model text, firmware_version text, raw_json text NOT NULL, created_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.observer_metrics (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, observer_id bigint NOT NULL REFERENCES meshcore_private.observers(id) ON DELETE CASCADE, mqtt_event_id bigint NOT NULL REFERENCES meshcore_private.mqtt_events(id) ON DELETE CASCADE, received_at_ms bigint NOT NULL, reported_at_ms bigint, metric_name text NOT NULL, numeric_value double precision, text_value text, boolean_value boolean, unit text, CHECK ((numeric_value IS NOT NULL)::int + (text_value IS NOT NULL)::int + (boolean_value IS NOT NULL)::int = 1), UNIQUE(mqtt_event_id, metric_name));
CREATE TABLE IF NOT EXISTS meshcore_private.observer_radio_history (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, observer_id bigint NOT NULL REFERENCES meshcore_private.observers(id) ON DELETE CASCADE, mqtt_event_id bigint NOT NULL UNIQUE REFERENCES meshcore_private.mqtt_events(id) ON DELETE CASCADE, frequency_mhz double precision, bandwidth_khz double precision, spreading_factor integer, coding_rate integer, tx_power_dbm double precision, received_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.neighbor_snapshots (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, mqtt_event_id bigint NOT NULL UNIQUE REFERENCES meshcore_private.mqtt_events(id) ON DELETE CASCADE, observer_id bigint NOT NULL REFERENCES meshcore_private.observers(id) ON DELETE CASCADE, iata text NOT NULL CHECK (iata ~ '^[A-Z]{3}$'), reported_at_ms bigint, received_at_ms bigint NOT NULL, mqtt_retained boolean NOT NULL, suspected_replay boolean NOT NULL DEFAULT false, replay_of_snapshot_id bigint REFERENCES meshcore_private.neighbor_snapshots(id) ON DELETE SET NULL, self_scopes_json text NOT NULL, self_scopes_named_json text NOT NULL, self_default_scope text, reported_total_neighbors integer CHECK (reported_total_neighbors >= 0), reported_queried_neighbors integer CHECK (reported_queried_neighbors >= 0), reported_truncated boolean, entry_count integer NOT NULL, raw_json text NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.neighbor_entries (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, snapshot_id bigint NOT NULL REFERENCES meshcore_private.neighbor_snapshots(id) ON DELETE CASCADE, neighbor_public_key text NOT NULL CHECK (length(neighbor_public_key) = 64), snr double precision, rssi double precision, heard_secs_ago integer, calculated_last_heard_at_ms bigint, status text NOT NULL, scopes_json text NOT NULL, scopes_named_json text NOT NULL, UNIQUE(snapshot_id, neighbor_public_key));
CREATE INDEX IF NOT EXISTS neighbor_entries_snapshot ON meshcore_private.neighbor_entries(snapshot_id);
CREATE TABLE IF NOT EXISTS meshcore_private.neighbor_snapshot_scopes (snapshot_id bigint NOT NULL REFERENCES meshcore_private.neighbor_snapshots(id) ON DELETE CASCADE, scope text NOT NULL CHECK (length(scope) BETWEEN 1 AND 100), PRIMARY KEY(snapshot_id, scope));
CREATE INDEX IF NOT EXISTS neighbor_snapshot_scopes_scope ON meshcore_private.neighbor_snapshot_scopes(scope, snapshot_id);
CREATE TABLE IF NOT EXISTS meshcore_private.neighbor_entry_scopes (entry_id bigint NOT NULL REFERENCES meshcore_private.neighbor_entries(id) ON DELETE CASCADE, scope text NOT NULL CHECK (length(scope) BETWEEN 1 AND 100), PRIMARY KEY(entry_id, scope));
CREATE INDEX IF NOT EXISTS neighbor_entry_scopes_scope ON meshcore_private.neighbor_entry_scopes(scope, entry_id);
CREATE TABLE IF NOT EXISTS meshcore_private.logical_packets (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, logical_packet_id text NOT NULL UNIQUE CHECK (length(logical_packet_id) = 67), packet_type text, payload_type text, first_observed_at_ms bigint NOT NULL, last_observed_at_ms bigint NOT NULL, created_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.packets (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, packet_sha256 text NOT NULL UNIQUE, logical_packet_id bigint REFERENCES meshcore_private.logical_packets(id) ON DELETE SET NULL, raw_packet_blob bytea NOT NULL, raw_packet_hex text NOT NULL, packet_length integer NOT NULL, packet_type text, packet_type_code integer, payload_type text, payload_type_code integer, route_type text, decode_status text NOT NULL, decode_error text, decoder_name text, decoder_version text, decoded_at_ms bigint, decoded_json text, first_seen_at_ms bigint NOT NULL, last_seen_at_ms bigint NOT NULL, created_at_ms bigint NOT NULL, updated_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.packet_observations (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, packet_id bigint NOT NULL REFERENCES meshcore_private.packets(id) ON DELETE CASCADE, mqtt_event_id bigint NOT NULL UNIQUE REFERENCES meshcore_private.mqtt_events(id) ON DELETE CASCADE, observer_id bigint NOT NULL REFERENCES meshcore_private.observers(id) ON DELETE CASCADE, iata text NOT NULL CHECK (iata ~ '^[A-Z]{3}$'), received_at_ms bigint NOT NULL, reported_at_ms bigint, rssi double precision, snr double precision, score double precision, direction text, suspected_mqtt_duplicate boolean NOT NULL DEFAULT false, suspected_rf_retransmission boolean NOT NULL DEFAULT false, created_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.nodes (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, public_key text NOT NULL UNIQUE CHECK (length(public_key) = 64), owner_public_key text CHECK (length(owner_public_key) = 64), first_seen_at_ms bigint NOT NULL, last_seen_at_ms bigint NOT NULL, latest_name text, latest_role text, latest_latitude double precision, latest_longitude double precision, latest_advert_timestamp bigint, created_at_ms bigint NOT NULL, updated_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.node_adverts (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, packet_id bigint NOT NULL UNIQUE REFERENCES meshcore_private.packets(id) ON DELETE CASCADE, node_id bigint NOT NULL REFERENCES meshcore_private.nodes(id) ON DELETE CASCADE, node_public_key text NOT NULL CHECK (length(node_public_key) = 64), owner_public_key text CHECK (length(owner_public_key) = 64), advert_timestamp bigint, first_observed_at_ms bigint NOT NULL, name text, role text, latitude double precision, longitude double precision, flags integer, capabilities_json text, signature_valid boolean, verified boolean NOT NULL, verification_error text, decoded_json text NOT NULL, created_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.node_sightings (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, node_id bigint NOT NULL REFERENCES meshcore_private.nodes(id) ON DELETE CASCADE, observer_id bigint NOT NULL REFERENCES meshcore_private.observers(id) ON DELETE CASCADE, packet_id bigint NOT NULL REFERENCES meshcore_private.packets(id) ON DELETE CASCADE, packet_observation_id bigint NOT NULL REFERENCES meshcore_private.packet_observations(id) ON DELETE CASCADE, iata text NOT NULL CHECK (iata ~ '^[A-Z]{3}$'), sighting_type text NOT NULL, received_at_ms bigint NOT NULL, UNIQUE(node_id, packet_observation_id, sighting_type));
CREATE TABLE IF NOT EXISTS meshcore_private.node_prefix_candidates (prefix_hex text NOT NULL, prefix_length_bytes integer NOT NULL CHECK (prefix_length_bytes BETWEEN 1 AND 3), node_id bigint NOT NULL REFERENCES meshcore_private.nodes(id) ON DELETE CASCADE, first_seen_at_ms bigint NOT NULL, last_seen_at_ms bigint NOT NULL, evidence_count integer NOT NULL, confidence double precision NOT NULL, PRIMARY KEY(prefix_hex, prefix_length_bytes, node_id));
CREATE TABLE IF NOT EXISTS meshcore_private.packet_paths (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, packet_observation_id bigint NOT NULL UNIQUE REFERENCES meshcore_private.packet_observations(id) ON DELETE CASCADE, raw_path_blob bytea NOT NULL, hop_count integer NOT NULL, received_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.packet_path_hops (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, path_id bigint NOT NULL REFERENCES meshcore_private.packet_paths(id) ON DELETE CASCADE, hop_index integer NOT NULL, prefix_hex text NOT NULL, prefix_length_bytes integer NOT NULL CHECK (prefix_length_bytes BETWEEN 1 AND 3), resolved_node_id bigint REFERENCES meshcore_private.nodes(id) ON DELETE SET NULL, resolution_status text NOT NULL, resolution_confidence double precision, UNIQUE(path_id, hop_index));
CREATE TABLE IF NOT EXISTS meshcore_private.trace_events (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, packet_id bigint NOT NULL REFERENCES meshcore_private.packets(id) ON DELETE CASCADE, packet_observation_id bigint NOT NULL UNIQUE REFERENCES meshcore_private.packet_observations(id) ON DELETE CASCADE, source_node_id bigint REFERENCES meshcore_private.nodes(id) ON DELETE SET NULL, tag text, reported_at_ms bigint, received_at_ms bigint NOT NULL, decoded_json text NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.trace_hops (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, trace_event_id bigint NOT NULL REFERENCES meshcore_private.trace_events(id) ON DELETE CASCADE, hop_index integer NOT NULL, prefix_hex text NOT NULL, prefix_length_bytes integer NOT NULL CHECK (prefix_length_bytes BETWEEN 1 AND 3), snr double precision, resolved_node_id bigint REFERENCES meshcore_private.nodes(id) ON DELETE SET NULL, resolution_confidence double precision, UNIQUE(trace_event_id, hop_index));
CREATE TABLE IF NOT EXISTS meshcore_private.messages (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, packet_id bigint NOT NULL REFERENCES meshcore_private.packets(id) ON DELETE CASCADE, packet_observation_id bigint NOT NULL UNIQUE REFERENCES meshcore_private.packet_observations(id) ON DELETE CASCADE, message_type text NOT NULL, channel text, channel_index integer, channel_name text, sender_prefix text, sender_node_id bigint REFERENCES meshcore_private.nodes(id) ON DELETE SET NULL, destination_prefix text, destination_node_id bigint REFERENCES meshcore_private.nodes(id) ON DELETE SET NULL, encrypted boolean NOT NULL, text text, decrypted_sender text, decrypted_flags integer, payload_blob bytea NOT NULL, signature text, signature_valid boolean, reported_at_ms bigint, received_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.telemetry_events (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, packet_id bigint NOT NULL REFERENCES meshcore_private.packets(id) ON DELETE CASCADE, packet_observation_id bigint NOT NULL UNIQUE REFERENCES meshcore_private.packet_observations(id) ON DELETE CASCADE, node_id bigint REFERENCES meshcore_private.nodes(id) ON DELETE SET NULL, reported_at_ms bigint, received_at_ms bigint NOT NULL, decoded_json text NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_private.telemetry_values (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, telemetry_event_id bigint NOT NULL REFERENCES meshcore_private.telemetry_events(id) ON DELETE CASCADE, metric_name text NOT NULL, numeric_value double precision, text_value text, boolean_value boolean, unit text, channel integer, metadata_json text, CHECK ((numeric_value IS NOT NULL)::int + (text_value IS NOT NULL)::int + (boolean_value IS NOT NULL)::int = 1));
CREATE TABLE IF NOT EXISTS meshcore_private.processing_errors (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, mqtt_event_id bigint NOT NULL REFERENCES meshcore_private.mqtt_events(id) ON DELETE CASCADE, packet_id bigint REFERENCES meshcore_private.packets(id) ON DELETE SET NULL, stage text NOT NULL, error_code text NOT NULL, error_message text NOT NULL, processor_name text NOT NULL, processor_version text NOT NULL, received_at_ms bigint NOT NULL, created_at_ms bigint NOT NULL, UNIQUE(mqtt_event_id, stage, error_code, processor_version));
`;

// This is a typed publication surface. MeshCore packet bytes are intentionally public;
// MQTT envelopes and generic decoded/status JSON remain in the private schema.
const PUBLIC_SCHEMA_DDL = `
CREATE SCHEMA IF NOT EXISTS meshcore_public;
CREATE TABLE IF NOT EXISTS meshcore_public.schema_metadata (singleton integer PRIMARY KEY CHECK (singleton = 1), schema_id text NOT NULL, schema_version integer NOT NULL, schema_hash text NOT NULL, database_created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS meshcore_public.region_scopes (region text PRIMARY KEY CHECK (length(region) BETWEEN 1 AND 100), name text NOT NULL, first_seen_at_ms bigint, last_seen_at_ms bigint, manually_added boolean NOT NULL DEFAULT false, observation_count bigint NOT NULL DEFAULT 0 CHECK (observation_count >= 0));
CREATE TABLE IF NOT EXISTS meshcore_public.nodes (private_id bigint NOT NULL UNIQUE, public_key text PRIMARY KEY CHECK (length(public_key) = 64), owner_public_key text CHECK (length(owner_public_key) = 64), first_seen_at_ms bigint NOT NULL, last_seen_at_ms bigint NOT NULL, latest_name text, latest_role text, latest_latitude double precision, latest_longitude double precision, location public.geography(Point, 4326), latest_advert_timestamp bigint, created_at_ms bigint NOT NULL, updated_at_ms bigint NOT NULL);
CREATE INDEX IF NOT EXISTS public_nodes_last_seen ON meshcore_public.nodes(last_seen_at_ms DESC, public_key);
CREATE INDEX IF NOT EXISTS public_nodes_location ON meshcore_public.nodes USING gist(location);
CREATE TABLE IF NOT EXISTS meshcore_public.observers (private_id bigint NOT NULL UNIQUE, public_key text PRIMARY KEY CHECK (length(public_key) = 64), first_seen_at_ms bigint NOT NULL, last_seen_at_ms bigint NOT NULL, iata text CHECK (iata IS NULL OR iata ~ '^[A-Z]{3}$'), label text, active boolean NOT NULL, updated_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_public.observer_status (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, observer_public_key text NOT NULL REFERENCES meshcore_public.observers(public_key) ON DELETE CASCADE, iata text NOT NULL CHECK (iata ~ '^[A-Z]{3}$'), reported_at_ms bigint, received_at_ms bigint NOT NULL, origin text, model text, firmware_version text);
CREATE INDEX IF NOT EXISTS public_observer_status_observer_received ON meshcore_public.observer_status(observer_public_key, received_at_ms DESC, id DESC);
CREATE TABLE IF NOT EXISTS meshcore_public.observer_metrics (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, observer_public_key text NOT NULL REFERENCES meshcore_public.observers(public_key) ON DELETE CASCADE, received_at_ms bigint NOT NULL, reported_at_ms bigint, metric_name text NOT NULL, numeric_value double precision, text_value text, boolean_value boolean, unit text, CHECK ((numeric_value IS NOT NULL)::int + (text_value IS NOT NULL)::int + (boolean_value IS NOT NULL)::int = 1));
CREATE INDEX IF NOT EXISTS public_observer_metrics_observer_metric_received ON meshcore_public.observer_metrics(observer_public_key, metric_name, received_at_ms DESC, id DESC);
CREATE TABLE IF NOT EXISTS meshcore_public.packets (private_id bigint NOT NULL UNIQUE, packet_sha256 text PRIMARY KEY, raw_packet_blob bytea NOT NULL, logical_packet_id text, packet_type text, payload_type text, route_type text, decode_status text NOT NULL, first_seen_at_ms bigint NOT NULL, last_seen_at_ms bigint NOT NULL);
CREATE INDEX IF NOT EXISTS public_packets_last_seen ON meshcore_public.packets(last_seen_at_ms DESC, packet_sha256);
CREATE TABLE IF NOT EXISTS meshcore_public.packet_observations (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, packet_sha256 text NOT NULL REFERENCES meshcore_public.packets(packet_sha256) ON DELETE CASCADE, observer_public_key text NOT NULL REFERENCES meshcore_public.observers(public_key) ON DELETE CASCADE, iata text NOT NULL CHECK (iata ~ '^[A-Z]{3}$'), received_at_ms bigint NOT NULL, reported_at_ms bigint, rssi double precision, snr double precision, score double precision, direction text, suspected_mqtt_duplicate boolean NOT NULL DEFAULT false, suspected_rf_retransmission boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS public_packet_observations_received ON meshcore_public.packet_observations(received_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS public_packet_observations_observer_received ON meshcore_public.packet_observations(observer_public_key, received_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS public_packet_observations_packet_received ON meshcore_public.packet_observations(packet_sha256, received_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS public_packet_observations_iata_received ON meshcore_public.packet_observations(iata, received_at_ms DESC, id DESC);
CREATE TABLE IF NOT EXISTS meshcore_public.node_adverts (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, node_public_key text NOT NULL REFERENCES meshcore_public.nodes(public_key) ON DELETE CASCADE, packet_sha256 text REFERENCES meshcore_public.packets(packet_sha256) ON DELETE SET NULL, advert_timestamp bigint, first_observed_at_ms bigint NOT NULL, name text, role text, latitude double precision, longitude double precision, location public.geography(Point, 4326), flags integer, signature_valid boolean, verified boolean NOT NULL, verification_error text);
CREATE INDEX IF NOT EXISTS public_node_adverts_node_observed ON meshcore_public.node_adverts(node_public_key, first_observed_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS public_node_adverts_location ON meshcore_public.node_adverts USING gist(location);
CREATE TABLE IF NOT EXISTS meshcore_public.node_sightings (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, node_public_key text NOT NULL REFERENCES meshcore_public.nodes(public_key) ON DELETE CASCADE, observer_public_key text NOT NULL REFERENCES meshcore_public.observers(public_key) ON DELETE CASCADE, packet_observation_id bigint NOT NULL REFERENCES meshcore_public.packet_observations(id) ON DELETE CASCADE, iata text NOT NULL CHECK (iata ~ '^[A-Z]{3}$'), sighting_type text NOT NULL, received_at_ms bigint NOT NULL);
CREATE INDEX IF NOT EXISTS public_node_sightings_node_received ON meshcore_public.node_sightings(node_public_key, received_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS public_node_sightings_observer_received ON meshcore_public.node_sightings(observer_public_key, received_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS public_node_sightings_iata_received ON meshcore_public.node_sightings(iata, received_at_ms DESC, id DESC);
CREATE TABLE IF NOT EXISTS meshcore_public.node_prefix_candidates (prefix_hex text NOT NULL, prefix_length_bytes integer NOT NULL CHECK (prefix_length_bytes BETWEEN 1 AND 3), node_public_key text NOT NULL REFERENCES meshcore_public.nodes(public_key) ON DELETE CASCADE, first_seen_at_ms bigint NOT NULL, last_seen_at_ms bigint NOT NULL, evidence_count integer NOT NULL, confidence double precision NOT NULL, PRIMARY KEY(prefix_hex, prefix_length_bytes, node_public_key));
CREATE INDEX IF NOT EXISTS public_node_prefix_candidates_node ON meshcore_public.node_prefix_candidates(node_public_key);
CREATE TABLE IF NOT EXISTS meshcore_public.neighbor_snapshots (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, observer_public_key text NOT NULL REFERENCES meshcore_public.observers(public_key) ON DELETE CASCADE, iata text NOT NULL CHECK (iata ~ '^[A-Z]{3}$'), reported_at_ms bigint, received_at_ms bigint NOT NULL, mqtt_retained boolean NOT NULL, self_scopes_json text NOT NULL, self_scopes_named_json text NOT NULL, self_default_scope text, reported_total_neighbors integer CHECK (reported_total_neighbors >= 0), reported_queried_neighbors integer CHECK (reported_queried_neighbors >= 0), reported_truncated boolean, entry_count integer NOT NULL);
CREATE INDEX IF NOT EXISTS public_neighbor_snapshots_observer_received ON meshcore_public.neighbor_snapshots(observer_public_key, received_at_ms DESC, id DESC);
CREATE TABLE IF NOT EXISTS meshcore_public.neighbor_entries (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, snapshot_id bigint NOT NULL REFERENCES meshcore_public.neighbor_snapshots(id) ON DELETE CASCADE, neighbor_public_key text NOT NULL CHECK (length(neighbor_public_key) = 64), snr double precision, rssi double precision, heard_secs_ago integer, calculated_last_heard_at_ms bigint, status text NOT NULL, scopes_json text NOT NULL, scopes_named_json text NOT NULL);
CREATE INDEX IF NOT EXISTS public_neighbor_entries_snapshot ON meshcore_public.neighbor_entries(snapshot_id);
CREATE INDEX IF NOT EXISTS public_neighbor_entries_neighbor ON meshcore_public.neighbor_entries(neighbor_public_key, snapshot_id);
CREATE TABLE IF NOT EXISTS meshcore_public.neighbor_snapshot_scopes (snapshot_id bigint NOT NULL REFERENCES meshcore_public.neighbor_snapshots(id) ON DELETE CASCADE, scope text NOT NULL CHECK (length(scope) BETWEEN 1 AND 100), PRIMARY KEY(snapshot_id, scope));
CREATE INDEX IF NOT EXISTS public_neighbor_snapshot_scopes_scope ON meshcore_public.neighbor_snapshot_scopes(scope, snapshot_id);
CREATE TABLE IF NOT EXISTS meshcore_public.neighbor_entry_scopes (entry_id bigint NOT NULL REFERENCES meshcore_public.neighbor_entries(id) ON DELETE CASCADE, scope text NOT NULL CHECK (length(scope) BETWEEN 1 AND 100), PRIMARY KEY(entry_id, scope));
CREATE INDEX IF NOT EXISTS public_neighbor_entry_scopes_scope ON meshcore_public.neighbor_entry_scopes(scope, entry_id);
CREATE TABLE IF NOT EXISTS meshcore_public.packet_paths (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, packet_observation_id bigint NOT NULL UNIQUE REFERENCES meshcore_public.packet_observations(id) ON DELETE CASCADE, hop_count integer NOT NULL, received_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_public.packet_path_hops (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, path_id bigint NOT NULL REFERENCES meshcore_public.packet_paths(id) ON DELETE CASCADE, hop_index integer NOT NULL, prefix_hex text NOT NULL, prefix_length_bytes integer NOT NULL CHECK (prefix_length_bytes BETWEEN 1 AND 3), resolved_node_public_key text REFERENCES meshcore_public.nodes(public_key) ON DELETE SET NULL, resolution_status text NOT NULL, resolution_confidence double precision);
CREATE TABLE IF NOT EXISTS meshcore_public.traces (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, packet_sha256 text NOT NULL REFERENCES meshcore_public.packets(packet_sha256) ON DELETE CASCADE, packet_observation_id bigint NOT NULL UNIQUE REFERENCES meshcore_public.packet_observations(id) ON DELETE CASCADE, source_node_public_key text REFERENCES meshcore_public.nodes(public_key) ON DELETE SET NULL, tag text, reported_at_ms bigint, received_at_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meshcore_public.trace_hops (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, trace_id bigint NOT NULL REFERENCES meshcore_public.traces(id) ON DELETE CASCADE, hop_index integer NOT NULL, prefix_hex text NOT NULL, prefix_length_bytes integer NOT NULL CHECK (prefix_length_bytes BETWEEN 1 AND 3), snr double precision, resolved_node_public_key text REFERENCES meshcore_public.nodes(public_key) ON DELETE SET NULL, resolution_confidence double precision);
CREATE TABLE IF NOT EXISTS meshcore_public.messages (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, packet_sha256 text NOT NULL REFERENCES meshcore_public.packets(packet_sha256) ON DELETE CASCADE, packet_observation_id bigint NOT NULL UNIQUE REFERENCES meshcore_public.packet_observations(id) ON DELETE CASCADE, message_type text NOT NULL, channel text, channel_index integer, channel_name text, sender_public_key text REFERENCES meshcore_public.nodes(public_key) ON DELETE SET NULL, destination_public_key text REFERENCES meshcore_public.nodes(public_key) ON DELETE SET NULL, encrypted boolean NOT NULL, text text, signature_valid boolean, reported_at_ms bigint, received_at_ms bigint NOT NULL);
CREATE INDEX IF NOT EXISTS public_messages_packet_received ON meshcore_public.messages(packet_sha256, received_at_ms DESC, id DESC);
CREATE TABLE IF NOT EXISTS meshcore_public.telemetry (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, private_id bigint NOT NULL UNIQUE, packet_sha256 text NOT NULL REFERENCES meshcore_public.packets(packet_sha256) ON DELETE CASCADE, packet_observation_id bigint NOT NULL REFERENCES meshcore_public.packet_observations(id) ON DELETE CASCADE, node_public_key text REFERENCES meshcore_public.nodes(public_key) ON DELETE SET NULL, reported_at_ms bigint, received_at_ms bigint NOT NULL, metric_name text NOT NULL, numeric_value double precision, text_value text, boolean_value boolean, unit text, channel integer, CHECK ((numeric_value IS NOT NULL)::int + (text_value IS NOT NULL)::int + (boolean_value IS NOT NULL)::int = 1));
CREATE INDEX IF NOT EXISTS public_telemetry_node_metric_received ON meshcore_public.telemetry(node_public_key, metric_name, received_at_ms DESC, id DESC);
`;

// Projection is deliberately static: every source table has an explicit function and
// every relationship is resolved through the public row's private provenance key.
const PUBLIC_PROJECTION_DDL = `
CREATE OR REPLACE FUNCTION meshcore_private.project_observer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.observers(private_id, public_key, first_seen_at_ms, last_seen_at_ms, iata, label, active, updated_at_ms)
  SELECT NEW.id, NEW.public_key, NEW.first_seen_at_ms, NEW.last_seen_at_ms, NEW.latest_iata, s.label, COALESCE(s.active, false), NEW.updated_at_ms FROM meshcore_private.observer_state s WHERE s.public_key = NEW.public_key
  UNION ALL SELECT NEW.id, NEW.public_key, NEW.first_seen_at_ms, NEW.last_seen_at_ms, NEW.latest_iata, NULL, false, NEW.updated_at_ms WHERE NOT EXISTS (SELECT 1 FROM meshcore_private.observer_state WHERE public_key = NEW.public_key)
  ON CONFLICT (private_id) DO UPDATE SET public_key = EXCLUDED.public_key, first_seen_at_ms = EXCLUDED.first_seen_at_ms, last_seen_at_ms = EXCLUDED.last_seen_at_ms, iata = EXCLUDED.iata, label = EXCLUDED.label, active = EXCLUDED.active, updated_at_ms = EXCLUDED.updated_at_ms;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_observer_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE meshcore_public.observers SET label = NEW.label, active = NEW.active, iata = COALESCE(NEW.iata, iata), updated_at_ms = GREATEST(updated_at_ms, NEW.updated_at_ms) WHERE public_key = NEW.public_key;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_observer_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.observer_status(private_id, observer_public_key, iata, reported_at_ms, received_at_ms, origin, model, firmware_version)
  SELECT NEW.id, o.public_key, NEW.iata, NEW.reported_at_ms, NEW.received_at_ms, NEW.origin, NEW.model, NEW.firmware_version FROM meshcore_public.observers o WHERE o.private_id = NEW.observer_id
  ON CONFLICT (private_id) DO UPDATE SET observer_public_key = EXCLUDED.observer_public_key, iata = EXCLUDED.iata, reported_at_ms = EXCLUDED.reported_at_ms, received_at_ms = EXCLUDED.received_at_ms, origin = EXCLUDED.origin, model = EXCLUDED.model, firmware_version = EXCLUDED.firmware_version;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_observer_metric() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.observer_metrics(private_id, observer_public_key, received_at_ms, reported_at_ms, metric_name, numeric_value, text_value, boolean_value, unit)
  SELECT NEW.id, o.public_key, NEW.received_at_ms, NEW.reported_at_ms, NEW.metric_name, NEW.numeric_value, NEW.text_value, NEW.boolean_value, NEW.unit FROM meshcore_public.observers o WHERE o.private_id = NEW.observer_id
  ON CONFLICT (private_id) DO UPDATE SET observer_public_key = EXCLUDED.observer_public_key, received_at_ms = EXCLUDED.received_at_ms, reported_at_ms = EXCLUDED.reported_at_ms, metric_name = EXCLUDED.metric_name, numeric_value = EXCLUDED.numeric_value, text_value = EXCLUDED.text_value, boolean_value = EXCLUDED.boolean_value, unit = EXCLUDED.unit;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_packet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.packets(private_id, packet_sha256, raw_packet_blob, logical_packet_id, packet_type, payload_type, route_type, decode_status, first_seen_at_ms, last_seen_at_ms)
  SELECT NEW.id, NEW.packet_sha256, NEW.raw_packet_blob, l.logical_packet_id, NEW.packet_type, NEW.payload_type, NEW.route_type, NEW.decode_status, NEW.first_seen_at_ms, NEW.last_seen_at_ms FROM meshcore_private.logical_packets l WHERE l.id = NEW.logical_packet_id
  UNION ALL SELECT NEW.id, NEW.packet_sha256, NEW.raw_packet_blob, NULL, NEW.packet_type, NEW.payload_type, NEW.route_type, NEW.decode_status, NEW.first_seen_at_ms, NEW.last_seen_at_ms WHERE NEW.logical_packet_id IS NULL
  ON CONFLICT (private_id) DO UPDATE SET packet_sha256 = EXCLUDED.packet_sha256, raw_packet_blob = EXCLUDED.raw_packet_blob, logical_packet_id = EXCLUDED.logical_packet_id, packet_type = EXCLUDED.packet_type, payload_type = EXCLUDED.payload_type, route_type = EXCLUDED.route_type, decode_status = EXCLUDED.decode_status, first_seen_at_ms = EXCLUDED.first_seen_at_ms, last_seen_at_ms = EXCLUDED.last_seen_at_ms;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_packet_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.packet_observations(private_id, packet_sha256, observer_public_key, iata, received_at_ms, reported_at_ms, rssi, snr, score, direction, suspected_mqtt_duplicate, suspected_rf_retransmission)
  SELECT NEW.id, p.packet_sha256, o.public_key, NEW.iata, NEW.received_at_ms, NEW.reported_at_ms, NEW.rssi, NEW.snr, NEW.score, NEW.direction, NEW.suspected_mqtt_duplicate, NEW.suspected_rf_retransmission FROM meshcore_public.packets p JOIN meshcore_public.observers o ON true WHERE p.private_id = NEW.packet_id AND o.private_id = NEW.observer_id
  ON CONFLICT (private_id) DO UPDATE SET packet_sha256 = EXCLUDED.packet_sha256, observer_public_key = EXCLUDED.observer_public_key, iata = EXCLUDED.iata, received_at_ms = EXCLUDED.received_at_ms, reported_at_ms = EXCLUDED.reported_at_ms, rssi = EXCLUDED.rssi, snr = EXCLUDED.snr, score = EXCLUDED.score, direction = EXCLUDED.direction, suspected_mqtt_duplicate = EXCLUDED.suspected_mqtt_duplicate, suspected_rf_retransmission = EXCLUDED.suspected_rf_retransmission;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_node() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.nodes(private_id, public_key, owner_public_key, first_seen_at_ms, last_seen_at_ms, latest_name, latest_role, latest_latitude, latest_longitude, location, latest_advert_timestamp, created_at_ms, updated_at_ms)
  VALUES (NEW.id, NEW.public_key, NEW.owner_public_key, NEW.first_seen_at_ms, NEW.last_seen_at_ms, NEW.latest_name, NEW.latest_role, NEW.latest_latitude, NEW.latest_longitude, CASE WHEN NEW.latest_latitude IS NULL OR NEW.latest_longitude IS NULL THEN NULL ELSE public.ST_SetSRID(public.ST_MakePoint(NEW.latest_longitude, NEW.latest_latitude), 4326)::public.geography END, NEW.latest_advert_timestamp, NEW.created_at_ms, NEW.updated_at_ms)
  ON CONFLICT (private_id) DO UPDATE SET public_key = EXCLUDED.public_key, owner_public_key = EXCLUDED.owner_public_key, first_seen_at_ms = EXCLUDED.first_seen_at_ms, last_seen_at_ms = EXCLUDED.last_seen_at_ms, latest_name = EXCLUDED.latest_name, latest_role = EXCLUDED.latest_role, latest_latitude = EXCLUDED.latest_latitude, latest_longitude = EXCLUDED.latest_longitude, location = EXCLUDED.location, latest_advert_timestamp = EXCLUDED.latest_advert_timestamp, updated_at_ms = EXCLUDED.updated_at_ms;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_node_advert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.node_adverts(private_id, node_public_key, packet_sha256, advert_timestamp, first_observed_at_ms, name, role, latitude, longitude, location, flags, signature_valid, verified, verification_error)
  SELECT NEW.id, n.public_key, p.packet_sha256, NEW.advert_timestamp, NEW.first_observed_at_ms, NEW.name, NEW.role, NEW.latitude, NEW.longitude, CASE WHEN NEW.latitude IS NULL OR NEW.longitude IS NULL THEN NULL ELSE public.ST_SetSRID(public.ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::public.geography END, NEW.flags, NEW.signature_valid, NEW.verified, NEW.verification_error FROM meshcore_public.nodes n JOIN meshcore_public.packets p ON true WHERE n.private_id = NEW.node_id AND p.private_id = NEW.packet_id
  ON CONFLICT (private_id) DO UPDATE SET node_public_key = EXCLUDED.node_public_key, packet_sha256 = EXCLUDED.packet_sha256, advert_timestamp = EXCLUDED.advert_timestamp, first_observed_at_ms = EXCLUDED.first_observed_at_ms, name = EXCLUDED.name, role = EXCLUDED.role, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, location = EXCLUDED.location, flags = EXCLUDED.flags, signature_valid = EXCLUDED.signature_valid, verified = EXCLUDED.verified, verification_error = EXCLUDED.verification_error;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_node_sighting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.node_sightings(private_id, node_public_key, observer_public_key, packet_observation_id, iata, sighting_type, received_at_ms)
  SELECT NEW.id, n.public_key, o.public_key, po.id, NEW.iata, NEW.sighting_type, NEW.received_at_ms FROM meshcore_public.nodes n JOIN meshcore_public.observers o ON true JOIN meshcore_public.packet_observations po ON true WHERE n.private_id = NEW.node_id AND o.private_id = NEW.observer_id AND po.private_id = NEW.packet_observation_id
  ON CONFLICT (private_id) DO UPDATE SET node_public_key = EXCLUDED.node_public_key, observer_public_key = EXCLUDED.observer_public_key, packet_observation_id = EXCLUDED.packet_observation_id, iata = EXCLUDED.iata, sighting_type = EXCLUDED.sighting_type, received_at_ms = EXCLUDED.received_at_ms;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_node_prefix_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.node_prefix_candidates(prefix_hex, prefix_length_bytes, node_public_key, first_seen_at_ms, last_seen_at_ms, evidence_count, confidence)
  SELECT NEW.prefix_hex, NEW.prefix_length_bytes, n.public_key, NEW.first_seen_at_ms, NEW.last_seen_at_ms, NEW.evidence_count, NEW.confidence FROM meshcore_public.nodes n WHERE n.private_id = NEW.node_id
  ON CONFLICT (prefix_hex, prefix_length_bytes, node_public_key) DO UPDATE SET first_seen_at_ms = EXCLUDED.first_seen_at_ms, last_seen_at_ms = EXCLUDED.last_seen_at_ms, evidence_count = EXCLUDED.evidence_count, confidence = EXCLUDED.confidence;
  RETURN NEW;
END $$;
`;

const PUBLIC_PROJECTION_TRIGGERS_DDL = `
CREATE OR REPLACE FUNCTION meshcore_private.project_neighbor_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.neighbor_snapshots(private_id, observer_public_key, iata, reported_at_ms, received_at_ms, mqtt_retained, self_scopes_json, self_scopes_named_json, self_default_scope, reported_total_neighbors, reported_queried_neighbors, reported_truncated, entry_count)
  SELECT NEW.id, o.public_key, NEW.iata, NEW.reported_at_ms, NEW.received_at_ms, NEW.mqtt_retained, NEW.self_scopes_json, NEW.self_scopes_named_json, NEW.self_default_scope, NEW.reported_total_neighbors, NEW.reported_queried_neighbors, NEW.reported_truncated, NEW.entry_count FROM meshcore_public.observers o WHERE o.private_id = NEW.observer_id
  ON CONFLICT (private_id) DO UPDATE SET observer_public_key = EXCLUDED.observer_public_key, iata = EXCLUDED.iata, reported_at_ms = EXCLUDED.reported_at_ms, received_at_ms = EXCLUDED.received_at_ms, mqtt_retained = EXCLUDED.mqtt_retained, self_scopes_json = EXCLUDED.self_scopes_json, self_scopes_named_json = EXCLUDED.self_scopes_named_json, self_default_scope = EXCLUDED.self_default_scope, reported_total_neighbors = EXCLUDED.reported_total_neighbors, reported_queried_neighbors = EXCLUDED.reported_queried_neighbors, reported_truncated = EXCLUDED.reported_truncated, entry_count = EXCLUDED.entry_count;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_neighbor_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.neighbor_entries(private_id, snapshot_id, neighbor_public_key, snr, rssi, heard_secs_ago, calculated_last_heard_at_ms, status, scopes_json, scopes_named_json)
  SELECT NEW.id, s.id, NEW.neighbor_public_key, NEW.snr, NEW.rssi, NEW.heard_secs_ago, NEW.calculated_last_heard_at_ms, NEW.status, NEW.scopes_json, NEW.scopes_named_json FROM meshcore_public.neighbor_snapshots s WHERE s.private_id = NEW.snapshot_id
  ON CONFLICT (private_id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id, neighbor_public_key = EXCLUDED.neighbor_public_key, snr = EXCLUDED.snr, rssi = EXCLUDED.rssi, heard_secs_ago = EXCLUDED.heard_secs_ago, calculated_last_heard_at_ms = EXCLUDED.calculated_last_heard_at_ms, status = EXCLUDED.status, scopes_json = EXCLUDED.scopes_json, scopes_named_json = EXCLUDED.scopes_named_json;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_neighbor_snapshot_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.neighbor_snapshot_scopes(snapshot_id, scope)
  SELECT s.id, NEW.scope FROM meshcore_public.neighbor_snapshots s WHERE s.private_id = NEW.snapshot_id
  ON CONFLICT (snapshot_id, scope) DO NOTHING;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_neighbor_entry_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.neighbor_entry_scopes(entry_id, scope)
  SELECT e.id, NEW.scope FROM meshcore_public.neighbor_entries e WHERE e.private_id = NEW.entry_id
  ON CONFLICT (entry_id, scope) DO NOTHING;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_packet_path() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.packet_paths(private_id, packet_observation_id, hop_count, received_at_ms)
  SELECT NEW.id, po.id, NEW.hop_count, NEW.received_at_ms FROM meshcore_public.packet_observations po WHERE po.private_id = NEW.packet_observation_id
  ON CONFLICT (private_id) DO UPDATE SET packet_observation_id = EXCLUDED.packet_observation_id, hop_count = EXCLUDED.hop_count, received_at_ms = EXCLUDED.received_at_ms;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_packet_path_hop() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.packet_path_hops(private_id, path_id, hop_index, prefix_hex, prefix_length_bytes, resolved_node_public_key, resolution_status, resolution_confidence)
  SELECT NEW.id, p.id, NEW.hop_index, NEW.prefix_hex, NEW.prefix_length_bytes, n.public_key, NEW.resolution_status, NEW.resolution_confidence FROM meshcore_public.packet_paths p LEFT JOIN meshcore_public.nodes n ON n.private_id = NEW.resolved_node_id WHERE p.private_id = NEW.path_id
  ON CONFLICT (private_id) DO UPDATE SET path_id = EXCLUDED.path_id, hop_index = EXCLUDED.hop_index, prefix_hex = EXCLUDED.prefix_hex, prefix_length_bytes = EXCLUDED.prefix_length_bytes, resolved_node_public_key = EXCLUDED.resolved_node_public_key, resolution_status = EXCLUDED.resolution_status, resolution_confidence = EXCLUDED.resolution_confidence;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_trace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.traces(private_id, packet_sha256, packet_observation_id, source_node_public_key, tag, reported_at_ms, received_at_ms)
  SELECT NEW.id, p.packet_sha256, po.id, n.public_key, NEW.tag, NEW.reported_at_ms, NEW.received_at_ms FROM meshcore_public.packets p JOIN meshcore_public.packet_observations po ON true LEFT JOIN meshcore_public.nodes n ON n.private_id = NEW.source_node_id WHERE p.private_id = NEW.packet_id AND po.private_id = NEW.packet_observation_id
  ON CONFLICT (private_id) DO UPDATE SET packet_sha256 = EXCLUDED.packet_sha256, packet_observation_id = EXCLUDED.packet_observation_id, source_node_public_key = EXCLUDED.source_node_public_key, tag = EXCLUDED.tag, reported_at_ms = EXCLUDED.reported_at_ms, received_at_ms = EXCLUDED.received_at_ms;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_trace_hop() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.trace_hops(private_id, trace_id, hop_index, prefix_hex, prefix_length_bytes, snr, resolved_node_public_key, resolution_confidence)
  SELECT NEW.id, t.id, NEW.hop_index, NEW.prefix_hex, NEW.prefix_length_bytes, NEW.snr, n.public_key, NEW.resolution_confidence FROM meshcore_public.traces t LEFT JOIN meshcore_public.nodes n ON n.private_id = NEW.resolved_node_id WHERE t.private_id = NEW.trace_event_id
  ON CONFLICT (private_id) DO UPDATE SET trace_id = EXCLUDED.trace_id, hop_index = EXCLUDED.hop_index, prefix_hex = EXCLUDED.prefix_hex, prefix_length_bytes = EXCLUDED.prefix_length_bytes, snr = EXCLUDED.snr, resolved_node_public_key = EXCLUDED.resolved_node_public_key, resolution_confidence = EXCLUDED.resolution_confidence;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.messages(private_id, packet_sha256, packet_observation_id, message_type, channel, channel_index, channel_name, sender_public_key, destination_public_key, encrypted, text, signature_valid, reported_at_ms, received_at_ms)
  SELECT NEW.id, p.packet_sha256, po.id, NEW.message_type, NEW.channel, NEW.channel_index, NEW.channel_name, sender.public_key, destination.public_key, NEW.encrypted, NEW.text, NEW.signature_valid, NEW.reported_at_ms, NEW.received_at_ms FROM meshcore_public.packets p JOIN meshcore_public.packet_observations po ON true LEFT JOIN meshcore_public.nodes sender ON sender.private_id = NEW.sender_node_id LEFT JOIN meshcore_public.nodes destination ON destination.private_id = NEW.destination_node_id WHERE p.private_id = NEW.packet_id AND po.private_id = NEW.packet_observation_id
  ON CONFLICT (private_id) DO UPDATE SET packet_sha256 = EXCLUDED.packet_sha256, packet_observation_id = EXCLUDED.packet_observation_id, message_type = EXCLUDED.message_type, channel = EXCLUDED.channel, channel_index = EXCLUDED.channel_index, channel_name = EXCLUDED.channel_name, sender_public_key = EXCLUDED.sender_public_key, destination_public_key = EXCLUDED.destination_public_key, encrypted = EXCLUDED.encrypted, text = EXCLUDED.text, signature_valid = EXCLUDED.signature_valid, reported_at_ms = EXCLUDED.reported_at_ms, received_at_ms = EXCLUDED.received_at_ms;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_telemetry_value() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO meshcore_public.telemetry(private_id, packet_sha256, packet_observation_id, node_public_key, reported_at_ms, received_at_ms, metric_name, numeric_value, text_value, boolean_value, unit, channel)
  SELECT NEW.id, p.packet_sha256, po.id, n.public_key, e.reported_at_ms, e.received_at_ms, NEW.metric_name, NEW.numeric_value, NEW.text_value, NEW.boolean_value, NEW.unit, NEW.channel FROM meshcore_private.telemetry_events e JOIN meshcore_public.packets p ON p.private_id = e.packet_id JOIN meshcore_public.packet_observations po ON po.private_id = e.packet_observation_id LEFT JOIN meshcore_public.nodes n ON n.private_id = e.node_id WHERE e.id = NEW.telemetry_event_id
  ON CONFLICT (private_id) DO UPDATE SET packet_sha256 = EXCLUDED.packet_sha256, packet_observation_id = EXCLUDED.packet_observation_id, node_public_key = EXCLUDED.node_public_key, reported_at_ms = EXCLUDED.reported_at_ms, received_at_ms = EXCLUDED.received_at_ms, metric_name = EXCLUDED.metric_name, numeric_value = EXCLUDED.numeric_value, text_value = EXCLUDED.text_value, boolean_value = EXCLUDED.boolean_value, unit = EXCLUDED.unit, channel = EXCLUDED.channel;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION meshcore_private.project_telemetry_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE meshcore_public.telemetry public_value SET packet_sha256 = p.packet_sha256, packet_observation_id = po.id, node_public_key = n.public_key, reported_at_ms = NEW.reported_at_ms, received_at_ms = NEW.received_at_ms FROM meshcore_private.telemetry_values private_value JOIN meshcore_public.packets p ON p.private_id = NEW.packet_id JOIN meshcore_public.packet_observations po ON po.private_id = NEW.packet_observation_id LEFT JOIN meshcore_public.nodes n ON n.private_id = NEW.node_id WHERE private_value.telemetry_event_id = NEW.id AND public_value.private_id = private_value.id;
  RETURN NEW;
END $$;
-- Each direct projection has a stable private provenance key. Public foreign keys
-- cascade dependent projections when their parent source is removed.
CREATE OR REPLACE FUNCTION meshcore_private.delete_public_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'observers' THEN
    DELETE FROM meshcore_public.observers WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'observer_state' THEN
    NULL;
  ELSIF TG_TABLE_NAME = 'observer_status_events' THEN
    DELETE FROM meshcore_public.observer_status WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'observer_metrics' THEN
    DELETE FROM meshcore_public.observer_metrics WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'packets' THEN
    DELETE FROM meshcore_public.packets WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'packet_observations' THEN
    DELETE FROM meshcore_public.packet_observations WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'nodes' THEN
    DELETE FROM meshcore_public.nodes WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'node_adverts' THEN
    DELETE FROM meshcore_public.node_adverts WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'node_sightings' THEN
    DELETE FROM meshcore_public.node_sightings WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'node_prefix_candidates' THEN
    DELETE FROM meshcore_public.node_prefix_candidates public_candidate USING meshcore_public.nodes public_node WHERE public_node.private_id = OLD.node_id AND public_candidate.node_public_key = public_node.public_key AND public_candidate.prefix_hex = OLD.prefix_hex AND public_candidate.prefix_length_bytes = OLD.prefix_length_bytes;
  ELSIF TG_TABLE_NAME = 'neighbor_snapshots' THEN
    DELETE FROM meshcore_public.neighbor_snapshots WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'neighbor_entries' THEN
    DELETE FROM meshcore_public.neighbor_entries WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'neighbor_snapshot_scopes' THEN
    DELETE FROM meshcore_public.neighbor_snapshot_scopes public_scope USING meshcore_public.neighbor_snapshots public_snapshot WHERE public_snapshot.private_id = OLD.snapshot_id AND public_scope.snapshot_id = public_snapshot.id AND public_scope.scope = OLD.scope;
  ELSIF TG_TABLE_NAME = 'neighbor_entry_scopes' THEN
    DELETE FROM meshcore_public.neighbor_entry_scopes public_scope USING meshcore_public.neighbor_entries public_entry WHERE public_entry.private_id = OLD.entry_id AND public_scope.entry_id = public_entry.id AND public_scope.scope = OLD.scope;
  ELSIF TG_TABLE_NAME = 'packet_paths' THEN
    DELETE FROM meshcore_public.packet_paths WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'packet_path_hops' THEN
    DELETE FROM meshcore_public.packet_path_hops WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'trace_events' THEN
    DELETE FROM meshcore_public.traces WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'trace_hops' THEN
    DELETE FROM meshcore_public.trace_hops WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'messages' THEN
    DELETE FROM meshcore_public.messages WHERE private_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'telemetry_events' THEN
    NULL;
  ELSIF TG_TABLE_NAME = 'telemetry_values' THEN
    DELETE FROM meshcore_public.telemetry WHERE private_id = OLD.id;
  ELSE
    RAISE EXCEPTION 'unexpected projection source table: %', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS project_observer_trigger ON meshcore_private.observers;
DROP TRIGGER IF EXISTS project_observer_state_trigger ON meshcore_private.observer_state;
DROP TRIGGER IF EXISTS project_observer_status_trigger ON meshcore_private.observer_status_events;
DROP TRIGGER IF EXISTS project_observer_metric_trigger ON meshcore_private.observer_metrics;
DROP TRIGGER IF EXISTS project_packet_trigger ON meshcore_private.packets;
DROP TRIGGER IF EXISTS project_packet_observation_trigger ON meshcore_private.packet_observations;
DROP TRIGGER IF EXISTS project_node_trigger ON meshcore_private.nodes;
DROP TRIGGER IF EXISTS project_node_advert_trigger ON meshcore_private.node_adverts;
DROP TRIGGER IF EXISTS project_node_sighting_trigger ON meshcore_private.node_sightings;
DROP TRIGGER IF EXISTS project_neighbor_snapshot_trigger ON meshcore_private.neighbor_snapshots;
DROP TRIGGER IF EXISTS project_neighbor_entry_trigger ON meshcore_private.neighbor_entries;
DROP TRIGGER IF EXISTS project_neighbor_snapshot_scope_trigger ON meshcore_private.neighbor_snapshot_scopes;
DROP TRIGGER IF EXISTS project_neighbor_entry_scope_trigger ON meshcore_private.neighbor_entry_scopes;
DROP TRIGGER IF EXISTS project_packet_path_trigger ON meshcore_private.packet_paths;
DROP TRIGGER IF EXISTS project_packet_path_hop_trigger ON meshcore_private.packet_path_hops;
DROP TRIGGER IF EXISTS project_trace_trigger ON meshcore_private.trace_events;
DROP TRIGGER IF EXISTS project_trace_hop_trigger ON meshcore_private.trace_hops;
DROP TRIGGER IF EXISTS project_message_trigger ON meshcore_private.messages;
DROP TRIGGER IF EXISTS project_telemetry_event_trigger ON meshcore_private.telemetry_events;
DROP TRIGGER IF EXISTS project_telemetry_value_trigger ON meshcore_private.telemetry_values;
DROP TRIGGER IF EXISTS delete_public_projection_observer_trigger ON meshcore_private.observers;
DROP TRIGGER IF EXISTS delete_public_projection_observer_state_trigger ON meshcore_private.observer_state;
DROP TRIGGER IF EXISTS delete_public_projection_observer_status_trigger ON meshcore_private.observer_status_events;
DROP TRIGGER IF EXISTS delete_public_projection_observer_metric_trigger ON meshcore_private.observer_metrics;
DROP TRIGGER IF EXISTS delete_public_projection_packet_trigger ON meshcore_private.packets;
DROP TRIGGER IF EXISTS delete_public_projection_packet_observation_trigger ON meshcore_private.packet_observations;
DROP TRIGGER IF EXISTS delete_public_projection_node_trigger ON meshcore_private.nodes;
DROP TRIGGER IF EXISTS delete_public_projection_node_advert_trigger ON meshcore_private.node_adverts;
DROP TRIGGER IF EXISTS delete_public_projection_node_sighting_trigger ON meshcore_private.node_sightings;
DROP TRIGGER IF EXISTS project_node_prefix_candidate_trigger ON meshcore_private.node_prefix_candidates;
DROP TRIGGER IF EXISTS delete_public_projection_node_prefix_candidate_trigger ON meshcore_private.node_prefix_candidates;
DROP TRIGGER IF EXISTS delete_public_projection_neighbor_snapshot_trigger ON meshcore_private.neighbor_snapshots;
DROP TRIGGER IF EXISTS delete_public_projection_neighbor_entry_trigger ON meshcore_private.neighbor_entries;
DROP TRIGGER IF EXISTS delete_public_projection_neighbor_snapshot_scope_trigger ON meshcore_private.neighbor_snapshot_scopes;
DROP TRIGGER IF EXISTS delete_public_projection_neighbor_entry_scope_trigger ON meshcore_private.neighbor_entry_scopes;
DROP TRIGGER IF EXISTS delete_public_projection_packet_path_trigger ON meshcore_private.packet_paths;
DROP TRIGGER IF EXISTS delete_public_projection_packet_path_hop_trigger ON meshcore_private.packet_path_hops;
DROP TRIGGER IF EXISTS delete_public_projection_trace_trigger ON meshcore_private.trace_events;
DROP TRIGGER IF EXISTS delete_public_projection_trace_hop_trigger ON meshcore_private.trace_hops;
DROP TRIGGER IF EXISTS delete_public_projection_message_trigger ON meshcore_private.messages;
DROP TRIGGER IF EXISTS delete_public_projection_telemetry_event_trigger ON meshcore_private.telemetry_events;
DROP TRIGGER IF EXISTS delete_public_projection_telemetry_value_trigger ON meshcore_private.telemetry_values;
CREATE TRIGGER project_observer_trigger AFTER INSERT OR UPDATE ON meshcore_private.observers FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_observer();
CREATE TRIGGER project_observer_state_trigger AFTER INSERT OR UPDATE ON meshcore_private.observer_state FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_observer_state();
CREATE TRIGGER project_observer_status_trigger AFTER INSERT OR UPDATE ON meshcore_private.observer_status_events FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_observer_status();
CREATE TRIGGER project_observer_metric_trigger AFTER INSERT OR UPDATE ON meshcore_private.observer_metrics FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_observer_metric();
CREATE TRIGGER project_packet_trigger AFTER INSERT OR UPDATE ON meshcore_private.packets FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_packet();
CREATE TRIGGER project_packet_observation_trigger AFTER INSERT OR UPDATE ON meshcore_private.packet_observations FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_packet_observation();
CREATE TRIGGER project_node_trigger AFTER INSERT OR UPDATE ON meshcore_private.nodes FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_node();
CREATE TRIGGER project_node_advert_trigger AFTER INSERT OR UPDATE ON meshcore_private.node_adverts FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_node_advert();
CREATE TRIGGER project_node_sighting_trigger AFTER INSERT OR UPDATE ON meshcore_private.node_sightings FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_node_sighting();
CREATE TRIGGER project_node_prefix_candidate_trigger AFTER INSERT OR UPDATE ON meshcore_private.node_prefix_candidates FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_node_prefix_candidate();
CREATE TRIGGER project_neighbor_snapshot_trigger AFTER INSERT OR UPDATE ON meshcore_private.neighbor_snapshots FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_neighbor_snapshot();
CREATE TRIGGER project_neighbor_entry_trigger AFTER INSERT OR UPDATE ON meshcore_private.neighbor_entries FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_neighbor_entry();
CREATE TRIGGER project_neighbor_snapshot_scope_trigger AFTER INSERT OR UPDATE ON meshcore_private.neighbor_snapshot_scopes FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_neighbor_snapshot_scope();
CREATE TRIGGER project_neighbor_entry_scope_trigger AFTER INSERT OR UPDATE ON meshcore_private.neighbor_entry_scopes FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_neighbor_entry_scope();
CREATE TRIGGER project_packet_path_trigger AFTER INSERT OR UPDATE ON meshcore_private.packet_paths FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_packet_path();
CREATE TRIGGER project_packet_path_hop_trigger AFTER INSERT OR UPDATE ON meshcore_private.packet_path_hops FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_packet_path_hop();
CREATE TRIGGER project_trace_trigger AFTER INSERT OR UPDATE ON meshcore_private.trace_events FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_trace();
CREATE TRIGGER project_trace_hop_trigger AFTER INSERT OR UPDATE ON meshcore_private.trace_hops FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_trace_hop();
CREATE TRIGGER project_message_trigger AFTER INSERT OR UPDATE ON meshcore_private.messages FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_message();
CREATE TRIGGER project_telemetry_event_trigger AFTER INSERT OR UPDATE ON meshcore_private.telemetry_events FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_telemetry_event();
CREATE TRIGGER project_telemetry_value_trigger AFTER INSERT OR UPDATE ON meshcore_private.telemetry_values FOR EACH ROW EXECUTE FUNCTION meshcore_private.project_telemetry_value();
CREATE TRIGGER delete_public_projection_observer_trigger AFTER DELETE ON meshcore_private.observers FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_observer_state_trigger AFTER DELETE ON meshcore_private.observer_state FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_observer_status_trigger AFTER DELETE ON meshcore_private.observer_status_events FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_observer_metric_trigger AFTER DELETE ON meshcore_private.observer_metrics FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_packet_trigger AFTER DELETE ON meshcore_private.packets FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_packet_observation_trigger AFTER DELETE ON meshcore_private.packet_observations FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_node_trigger AFTER DELETE ON meshcore_private.nodes FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_node_advert_trigger AFTER DELETE ON meshcore_private.node_adverts FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_node_sighting_trigger AFTER DELETE ON meshcore_private.node_sightings FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_node_prefix_candidate_trigger AFTER DELETE ON meshcore_private.node_prefix_candidates FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_neighbor_snapshot_trigger AFTER DELETE ON meshcore_private.neighbor_snapshots FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_neighbor_entry_trigger AFTER DELETE ON meshcore_private.neighbor_entries FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_neighbor_snapshot_scope_trigger AFTER DELETE ON meshcore_private.neighbor_snapshot_scopes FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_neighbor_entry_scope_trigger AFTER DELETE ON meshcore_private.neighbor_entry_scopes FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_packet_path_trigger AFTER DELETE ON meshcore_private.packet_paths FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_packet_path_hop_trigger AFTER DELETE ON meshcore_private.packet_path_hops FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_trace_trigger AFTER DELETE ON meshcore_private.trace_events FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_trace_hop_trigger AFTER DELETE ON meshcore_private.trace_hops FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_message_trigger AFTER DELETE ON meshcore_private.messages FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_telemetry_event_trigger AFTER DELETE ON meshcore_private.telemetry_events FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
CREATE TRIGGER delete_public_projection_telemetry_value_trigger AFTER DELETE ON meshcore_private.telemetry_values FOR EACH ROW EXECUTE FUNCTION meshcore_private.delete_public_projection();
`;

/**
 * Version 10 adds timeline indexes that the heavy public REST queries
 * (global telemetry keyset paging, time-bounded message listing, observer
 * default sort / active cutoff) plan against. Fresh bootstraps create them
 * inline; existing databases get them through the explicit CONCURRENTLY
 * migration (scripts/migrate-schema-v9-to-v10.ts).
 */
const V10_PUBLIC_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS public_telemetry_received ON meshcore_public.telemetry (received_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS public_messages_received ON meshcore_public.messages (received_at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS public_observers_last_seen ON meshcore_public.observers (last_seen_at_ms DESC, public_key);
`;

export class IncompatibleDatabaseError extends Error {
  readonly actualSchemaVersion?: number;
  readonly expectedSchemaVersions: readonly number[];
  readonly fingerprintMismatch: boolean;
  readonly reason: DatabaseRecoveryReason;

  constructor(
    detail: string,
    options: {
      actualSchemaVersion?: number;
      expectedSchemaVersions?: readonly number[];
      fingerprintMismatch?: boolean;
      reason?: DatabaseRecoveryReason;
    } = {},
  ) {
    super(`PostgreSQL-databasen är inte kompatibel: ${detail}`);
    this.name = "IncompatibleDatabaseError";
    this.actualSchemaVersion = options.actualSchemaVersion;
    this.expectedSchemaVersions = options.expectedSchemaVersions ?? [];
    this.fingerprintMismatch = options.fingerprintMismatch ?? false;
    this.reason = options.reason ?? "unknown_schema";
  }
}

export interface ApplicationTransaction {
  /** Executes DML/DDL; results travel through get/all/changes instead. */
  run(sql: string, ...parameters: unknown[]): Promise<void>;
  /** Row-count of a `RETURNING`-style statement (0 when nothing matched). */
  changes(sql: string, ...parameters: unknown[]): Promise<number>;
  get<T = DatabaseRow>(
    sql: string,
    ...parameters: unknown[]
  ): Promise<T | undefined>;
  all<T = DatabaseRow>(sql: string, ...parameters: unknown[]): Promise<T[]>;
}

export type Transaction = ApplicationTransaction;

export interface TestDatabaseOptions {
  connectionString: string;
  schema: string;
  poolMax?: number;
}

export interface DatabaseGenerationMetadata {
  schemaVersion: number;
  createdAt: Date;
}

function databaseApi(connection: SqlExecutor): ApplicationTransaction {
  return {
    async run(sql, ...parameters) {
      await execute(sql, connection, parameters);
    },
    async changes(sql, ...parameters) {
      const rows = await execute(sql, connection, parameters);
      return rows.length;
    },
    async get<T>(sql: string, ...parameters: unknown[]) {
      const rows = await execute(sql, connection, parameters);
      return rows[0] as T | undefined;
    },
    async all<T>(sql: string, ...parameters: unknown[]) {
      return (await execute(sql, connection, parameters)) as T[];
    },
  };
}

export class ApplicationDatabase implements ApplicationTransaction {
  private readonly pendingOperations = new Set<Promise<unknown>>();
  private closing = false;

  private constructor(
    private readonly sql: SQL,
    readonly schema: string,
  ) {}

  static async connect(
    options: TestDatabaseOptions,
  ): Promise<ApplicationDatabase> {
    if (options.schema !== "meshcore_private") {
      throw new Error("Testdatabasen måste använda schemat meshcore_private");
    }
    const sql = sqlInstance({
      connectionString: options.connectionString,
      max: options.poolMax ?? 4,
      connectionTimeoutMillis: QUERY_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
    });
    return ApplicationDatabase.initializePool(sql, "meshcore_private");
  }

  static async openPool(
    sql: SQL,
    schema = "meshcore_private",
  ): Promise<ApplicationDatabase> {
    const database = new ApplicationDatabase(sql, schema);
    try {
      await database.validateCurrentSchema();
      await database.seedRegionScopes();
      await database.probe();
      return database;
    } catch (error) {
      sql.close({ timeout: 1 }).catch(() => undefined);
      throw error;
    }
  }

  private static async initializePool(
    sql: SQL,
    schema: string,
  ): Promise<ApplicationDatabase> {
    const database = new ApplicationDatabase(sql, schema);
    try {
      await database.initialize();
      return database;
    } catch (error) {
      sql.close({ timeout: 1 }).catch(() => undefined);
      throw error;
    }
  }

  /** The underlying Bun.SQL pool for explicit session-scoped operations. */
  get session(): SQL {
    return this.sql;
  }

  private get api(): ApplicationTransaction {
    return databaseApi(this.sql);
  }

  async run(sql: string, ...parameters: unknown[]): Promise<void> {
    return this.execute(() => this.api.run(sql, ...parameters));
  }
  async changes(sql: string, ...parameters: unknown[]): Promise<number> {
    return this.execute(() => this.api.changes(sql, ...parameters));
  }
  async get<T = DatabaseRow>(
    sql: string,
    ...parameters: unknown[]
  ): Promise<T | undefined> {
    return this.execute(() => this.api.get<T>(sql, ...parameters));
  }
  async all<T = DatabaseRow>(
    sql: string,
    ...parameters: unknown[]
  ): Promise<T[]> {
    return this.execute(() => this.api.all<T>(sql, ...parameters));
  }

  transaction<Arguments extends unknown[], Result>(
    operation: (
      transaction: Transaction,
      ...args: Arguments
    ) => Promise<Result>,
  ): (...args: Arguments) => Promise<Result> {
    return (...args) =>
      this.execute(async () =>
        this.sql.begin(async (tx) => operation(databaseApi(tx), ...args)),
      );
  }

  async probe(): Promise<void> {
    const row = await this.get<{ ok: number }>("SELECT 1 AS ok");
    if (Number(row?.ok) !== 1)
      throw new Error("Databasens hälsokontroll returnerade inget svar");
  }
  async getGenerationMetadata(): Promise<DatabaseGenerationMetadata> {
    const row = await this.get<{
      schema_version: number;
      database_created_at: Date;
    }>(
      "SELECT schema_version, database_created_at FROM meshcore_private.application_metadata WHERE singleton = 1",
    );
    if (!(row?.database_created_at instanceof Date))
      throw new IncompatibleDatabaseError(
        "database_created_at saknas eller är ogiltig",
        { reason: "unknown_schema" },
      );
    return {
      schemaVersion: Number(row.schema_version),
      createdAt: row.database_created_at,
    };
  }
  async drain(): Promise<void> {
    while (this.pendingOperations.size)
      await Promise.allSettled([...this.pendingOperations]);
  }
  async close(): Promise<void> {
    this.closing = true;
    await this.drain();
    await this.sql.close().catch(() => undefined);
  }

  private async initialize(): Promise<void> {
    const client = await reserveSession(this.sql);
    try {
      await assumeOwnerRoleIfMember(client);
      await client.unsafe("BEGIN");
      await client.unsafe(PRIVATE_SCHEMA_DDL);
      await client.unsafe(PUBLIC_SCHEMA_DDL);
      await client.unsafe(PUBLIC_PROJECTION_DDL);
      await client.unsafe(PUBLIC_PROJECTION_TRIGGERS_DDL);
      await client.unsafe(
        "INSERT INTO meshcore_private.meshcore_io_stats(singleton) VALUES (1) ON CONFLICT (singleton) DO NOTHING",
      );
      await seedRegionScopeRegistry(client);
      await client.unsafe(V10_PUBLIC_INDEX_DDL);
      const fingerprint = await computeV11Fingerprint(client);
      await client.unsafe(
        "INSERT INTO meshcore_private.application_metadata(singleton, schema_id, schema_version, schema_hash) VALUES (1, $1, $2, $3) ON CONFLICT (singleton) DO NOTHING",
        [SCHEMA_ID, CURRENT_SCHEMA_VERSION, fingerprint],
      );
      await client.unsafe(
        "INSERT INTO meshcore_public.schema_metadata(singleton, schema_id, schema_version, schema_hash) VALUES (1, $1, $2, $3) ON CONFLICT (singleton) DO NOTHING",
        [SCHEMA_ID, CURRENT_SCHEMA_VERSION, fingerprint],
      );
      await client.unsafe("COMMIT");
    } catch (error) {
      await client.unsafe("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await releaseSession(client, SCHEMA_SEARCH_PATH);
    }
    await this.validateCurrentSchema();
    await this.probe();
  }

  private async seedRegionScopes(): Promise<void> {
    const client = await reserveSession(this.sql);
    try {
      await seedRegionScopeRegistry(client);
    } finally {
      await releaseSession(client);
    }
  }

  private async validateCurrentSchema(): Promise<void> {
    const schemas = await this.all<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1::text[])",
      ["meshcore_private", "meshcore_public"],
    );
    if (schemas.length !== 2)
      throw new IncompatibleDatabaseError(
        "privata eller publika schemat saknas",
        { reason: "missing_schema_objects" },
      );
    const marker = await this.get<{
      schema_id: string;
      schema_version: number;
      schema_hash: string;
    }>(
      "SELECT schema_id, schema_version, schema_hash FROM meshcore_private.application_metadata WHERE singleton = 1",
    );
    if (marker?.schema_id !== SCHEMA_ID)
      throw new IncompatibleDatabaseError(
        `schema-id är ${marker?.schema_id ?? "saknas"} men måste vara ${SCHEMA_ID}`,
        {
          actualSchemaVersion: marker
            ? Number(marker.schema_version)
            : undefined,
          reason: "unknown_schema",
        },
      );
    const actualVersion = Number(marker.schema_version);
    // Only the current contract opens directly; compatible v10 gets one
    // bounded migration attempt from the production recovery path.
    if (!ACCEPTED_SCHEMA_VERSIONS.includes(actualVersion))
      throw new IncompatibleDatabaseError(
        `schema-version ${actualVersion} stöds inte; förväntas ${ACCEPTED_SCHEMA_VERSIONS.join(
          " eller ",
        )}. Kör scripts/migrate-schema-v9-to-v10.ts för att migrera en v9-databas.`,
        {
          actualSchemaVersion: actualVersion,
          expectedSchemaVersions: ACCEPTED_SCHEMA_VERSIONS,
          reason:
            actualVersion > CURRENT_SCHEMA_VERSION
              ? "future_schema_version"
              : "unsupported_schema_version",
        },
      );
    await this.requireTables("meshcore_private", PRIVATE_TABLES);
    await this.requireTables("meshcore_public", PUBLIC_TABLES);
    const client = await reserveSession(this.sql);
    try {
      const privateGenerationRows = await client.unsafe(
        "SELECT database_created_at FROM meshcore_private.application_metadata WHERE singleton = 1",
      );
      const fingerprint =
        actualVersion === 10
          ? await computeV10Fingerprint(client)
          : await computeV11Fingerprint(client);
      if (marker.schema_hash === SCHEMA_HASH_PENDING) {
        // Fresh-bootstrap self-heal is only valid for the current version.
        if (actualVersion !== CURRENT_SCHEMA_VERSION)
          throw new IncompatibleDatabaseError(
            `pending-fingeravtryck är endast giltigt för version ${CURRENT_SCHEMA_VERSION}`,
            {
              actualSchemaVersion: actualVersion,
              expectedSchemaVersions: ACCEPTED_SCHEMA_VERSIONS,
            },
          );
        await client.unsafe(
          `UPDATE meshcore_private.application_metadata SET schema_hash = $1 WHERE singleton = 1`,
          [fingerprint],
        );
        await client.unsafe(
          `UPDATE meshcore_public.schema_metadata SET schema_hash = $1 WHERE singleton = 1`,
          [fingerprint],
        );
        return;
      }
      if (marker.schema_hash !== fingerprint)
        throw new IncompatibleDatabaseError(
          "schema-fingeravtrycket stämmer inte med det publika kontraktet",
          {
            actualSchemaVersion: actualVersion,
            expectedSchemaVersions: ACCEPTED_SCHEMA_VERSIONS,
            fingerprintMismatch: true,
            reason: "fingerprint_mismatch",
          },
        );
      type MarkerRow = {
        schema_id: string;
        schema_version: string;
        schema_hash: string;
        database_created_at: Date | null;
      };
      const publicMarker = (
        await client.unsafe(
          "SELECT schema_id, schema_version, schema_hash, database_created_at FROM meshcore_public.schema_metadata WHERE singleton = 1",
        )
      )[0] as MarkerRow | undefined;
      const privateCreatedAt =
        privateGenerationRows[0] !== undefined
          ? (privateGenerationRows[0].database_created_at as Date | null)
          : null;
      const publicCreatedAt = publicMarker?.database_created_at ?? null;
      if (
        publicMarker === undefined ||
        publicMarker.schema_hash !== fingerprint ||
        publicMarker.schema_id !== SCHEMA_ID ||
        Number(publicMarker.schema_version) !== actualVersion ||
        !(privateCreatedAt instanceof Date) ||
        !(publicCreatedAt instanceof Date) ||
        publicCreatedAt.getTime() !== privateCreatedAt.getTime()
      )
        throw new IncompatibleDatabaseError(
          "den publika schema-markören stämmer inte",
          {
            actualSchemaVersion: actualVersion,
            expectedSchemaVersions: ACCEPTED_SCHEMA_VERSIONS,
            fingerprintMismatch: true,
            reason: "fingerprint_mismatch",
          },
        );
    } finally {
      client.release();
    }
  }

  private async requireTables(
    schema: string,
    expected: readonly string[],
  ): Promise<void> {
    const rows = await this.all<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])",
      schema,
      expected,
    );
    const actual = new Set(rows.map((row) => row.table_name));
    const missing = expected.filter((table) => !actual.has(table));
    if (missing.length)
      throw new IncompatibleDatabaseError(
        `${schema} saknar tabeller: ${missing.join(", ")}`,
        { reason: "missing_schema_objects" },
      );
  }

  private execute<Result>(operation: () => Promise<Result>): Promise<Result> {
    if (this.closing)
      return Promise.reject(new Error("Databasen håller på att stängas"));
    const promise = operation();
    this.pendingOperations.add(promise);
    void promise.then(
      () => this.pendingOperations.delete(promise),
      () => this.pendingOperations.delete(promise),
    );
    return promise;
  }
}

async function seedRegionScopeRegistry(client: SqlExecutor): Promise<void> {
  const entries = regionScopeRegistryEntries();
  const placeholders: string[] = [];
  const values: unknown[] = [];
  entries.forEach((entry, index) => {
    placeholders.push(`($${index * 2 + 1}, $${index * 2 + 2}, TRUE)`);
    values.push(entry.region, entry.name);
  });
  await execute(
    `INSERT INTO meshcore_public.region_scopes(region, name, manually_added)
     VALUES ${placeholders.join(", ")}
     ON CONFLICT(region) DO UPDATE SET name = EXCLUDED.name, manually_added = TRUE`,
    client,
    values,
  );
}

/**
 * Session-scoped reserved connection with promise-returning unsafe()
 * (matches runtime behavior; Bun's type-level shape differs).
 */
export type BrokerSession = {
  unsafe(text: string, parameters?: readonly unknown[]): Promise<SqlRows>;
  release(): void;
};

export async function reserveSession(sql: SQL): Promise<BrokerSession> {
  // Runtime unsafe() resolves a promise even though Bun's type-level shape
  // differs; the broker session contract captures runtime behavior.
  return sql.reserve();
}

/** Parameterized execution for explicit admin/migration sessions. */
export async function execSql(
  executor: SqlExecutor,
  text: string,
  parameters: readonly unknown[] = [],
): Promise<SqlRows> {
  return execute(text, executor, parameters);
}

/**
 * Adopts the broker owner role for provisioning/migration sessions when
 * membership is available, mirroring production where DDL runs as the owning
 * role rather than the connecting user.
 */
export async function assumeOwnerRoleIfMember(
  client: SqlExecutor,
): Promise<void> {
  const allowed = (
    (await execute(
      "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meshcore_owner' AND pg_has_role(current_user, oid, 'MEMBER')) AS allowed",
      client,
    )) as Array<{ allowed: boolean }>
  )[0]?.allowed;
  if (allowed) await execute("SET ROLE meshcore_owner", client);
}

/**
 * Releases a reserved session after restoring the broker search_path with an
 * explicit SET: `RESET search_path` goes to the PostgreSQL default instead of
 * the connection's startup value, which would silently poison pool reuse.
 */
async function releaseSession(
  client: BrokerSession,
  restorePath?: string,
): Promise<void> {
  try {
    if (restorePath) await client.unsafe("SET search_path = " + restorePath);
  } catch {
    // the session is about to be released regardless
  } finally {
    client.release();
  }
}

/**
 * Canonical SHA-256 fingerprint of the public database contract.
 *
 * The serialization below is part of the schema contract: the REST API
 * computes the identical fingerprint from `meshcore_public` at readiness
 * time and refuses readiness on mismatch. Keep both implementations in sync
 * (restful-api/src/repository.ts).
 *
 * Constraint/index definitions are search-path dependent (schema qualifiers
 * are omitted for relations visible through the current search_path), so the
 * computation pins `search_path = pg_catalog` for exact cross-context
 * determinism.
 */
/**
 * Legacy v9 fingerprint: schema id + version 9, tables/views, columns,
 * constraints AND ordinary indexes. Kept exclusively so the explicit
 * v9 -> v10 migration can validate a real v9 database before changing it,
 * and so a v9 backup/restore can be understood during the bridge window.
 *
 * Final readiness never uses this format.
 */
export async function computeLegacyV9Fingerprint(
  client: SqlExecutor,
): Promise<string> {
  return computePublicSchemaFingerprintFormat(client, {
    header: `schema|${SCHEMA_ID}|9`,
    includeIndexes: true,
  });
}

/**
 * Fingerprint format v2 for schema version 10.
 *
 * Includes the semantic public contract only:
 *   schema id, version, format identifier, relation names/types, columns
 *   (position/name/type/nullability/default) and constraints.
 *
 * Deliberately excludes ordinary PostgreSQL indexes: performance indexes
 * must be addable/removable/rebuildable by a DBA without failing REST
 * readiness or bumping the schema version. Semantic uniqueness that REST
 * relies on is expressed as PRIMARY KEY / UNIQUE constraints and therefore
 * still covered through pg_constraint.
 */
export async function computeV10Fingerprint(
  client: SqlExecutor,
): Promise<string> {
  return computePublicSchemaFingerprintFormat(client, {
    header: `schema|${SCHEMA_ID}|10|${FINGERPRINT_FORMAT_V2}`,
    includeIndexes: false,
  });
}

/** Version 11 adds database generation metadata to the public contract. */
export async function computeV11Fingerprint(
  client: SqlExecutor,
): Promise<string> {
  return computePublicSchemaFingerprintFormat(client, {
    header: `schema|${SCHEMA_ID}|${CURRENT_SCHEMA_VERSION}|${FINGERPRINT_FORMAT_V2}`,
    includeIndexes: false,
  });
}

/** Formats an age from persisted PostgreSQL creation metadata at read time. */
export function formatDatabaseAge(
  createdAt: Date | string,
  nowMs = Date.now(),
): string {
  const createdAtMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdAtMs))
    throw new Error("database_created_at must be a valid timestamp");
  const seconds = Math.max(0, Math.floor((nowMs - createdAtMs) / 1_000));
  const unit = (value: number, singular: string): string =>
    `${value} ${singular}${value === 1 ? "" : "s"}`;
  if (seconds < 60) return unit(seconds, "second");
  if (seconds < 3_600) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder
      ? `${unit(minutes, "minute")} ${unit(remainder, "second")}`
      : unit(minutes, "minute");
  }
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    return minutes
      ? `${unit(hours, "hour")} ${unit(minutes, "minute")}`
      : unit(hours, "hour");
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return hours
    ? `${unit(days, "day")} ${unit(hours, "hour")}`
    : unit(days, "day");
}

async function computePublicSchemaFingerprintFormat(
  client: SqlExecutor,
  options: { header: string; includeIndexes: boolean },
): Promise<string> {
  await execute("SET search_path = pg_catalog", client);
  try {
    const tables = (await execute(
      `SELECT table_name AS rel, table_type AS kind
       FROM information_schema.tables
       WHERE table_schema = 'meshcore_public'
       ORDER BY table_name`,
      client,
    )) as Array<{ rel: string; kind: string }>;
    const columns = (await execute(
      `SELECT table_name AS rel, ordinal_position AS position,
        column_name AS col, data_type AS type, is_nullable AS nullable,
        COALESCE(column_default, '') AS default_expr
       FROM information_schema.columns
       WHERE table_schema = 'meshcore_public'
       ORDER BY table_name, ordinal_position`,
      client,
    )) as Array<{
      rel: string;
      position: number;
      col: string;
      type: string;
      nullable: string;
      default_expr: string;
    }>;
    const constraints = (await execute(
      `SELECT cls.relname AS rel, con.conname AS name,
        pg_catalog.pg_get_constraintdef(con.oid) AS def
       FROM pg_catalog.pg_constraint con
       JOIN pg_catalog.pg_class cls ON cls.oid = con.conrelid
       JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
       WHERE ns.nspname = 'meshcore_public'
       ORDER BY cls.relname, con.conname`,
      client,
    )) as Array<{ rel: string; name: string; def: string }>;
    const lines = [
      options.header,
      ...tables.map((row) => `table|${row.rel}|${row.kind}`),
      ...columns.map(
        (row) =>
          `column|${row.rel}|${row.position}|${row.col}|${row.type}|${row.nullable}|${row.default_expr}`,
      ),
      ...constraints.map(
        (row) => `constraint|${row.rel}|${row.name}|${row.def}`,
      ),
    ];
    if (options.includeIndexes) {
      // v9 behavior: ordinary indexes were part of the contract hash.
      const indexes = (await execute(
        `SELECT indexname AS name, indexdef AS def
         FROM pg_catalog.pg_indexes
         WHERE schemaname = 'meshcore_public'
         ORDER BY indexname`,
        client,
      )) as Array<{ name: string; def: string }>;
      lines.push(...indexes.map((row) => `index|${row.name}|${row.def}`));
    }
    return createHash("sha256").update(lines.join("\n")).digest("hex");
  } finally {
    // Restore explicitly: RESET would leave the default "$user", public.
    await execute("SET search_path = " + SCHEMA_SEARCH_PATH, client).catch(
      () => undefined,
    );
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} måste vara satt`);
  return value;
}
function integerEnvironment(
  name: string,
  minimum: number,
  maximum: number,
): number {
  const value = Number(requiredEnvironment(name));
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${name} måste vara ett heltal mellan ${minimum} och ${maximum}`,
    );
  return value;
}
function optionalIntegerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${name} måste vara ett heltal mellan ${minimum} och ${maximum}`,
    );
  return value;
}
async function productionOptions(): Promise<DatabaseOptions> {
  const password =
    process.env.DATABASE_PASSWORD?.trim() ||
    (
      await readFile(requiredEnvironment("DATABASE_PASSWORD_FILE"), "utf8")
    ).replace(/\r?\n$/, "");
  if (!password) throw new Error("DATABASE_PASSWORD_FILE är tom");
  const ssl = requiredEnvironment("DATABASE_SSL");
  if (ssl !== "true" && ssl !== "false")
    throw new Error("DATABASE_SSL måste vara true eller false");
  return {
    host: requiredEnvironment("DATABASE_HOST"),
    port: integerEnvironment("DATABASE_PORT", 1, 65_535),
    database: requiredEnvironment("DATABASE_NAME"),
    user: requiredEnvironment("DATABASE_USER"),
    password,
    max: integerEnvironment("DATABASE_POOL_MAX", 1, 100),
    connectionTimeoutMillis: QUERY_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    ssl: ssl === "true" ? { rejectUnauthorized: true } : false,
  };
}

/**
 * PostgreSQL server-side error code (e.g. "28P01", "57014", "3D000").
 * Bun.SQL carries it on `errno`; a numeric-looking `code` is accepted too
 * for compatibility with errors we synthesize ourselves.
 */
function postgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { errno?: unknown; code?: unknown };
  const candidates: unknown[] = [candidate.errno, candidate.code];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isInteger(value))
      return String(value);
    if (typeof value === "string") {
      if (/^\d{5}$/.test(value)) return value;
    }
  }
  return typeof candidates[1] === "string" ? candidates[1] : undefined;
}

function isInfrastructureError(error: unknown): boolean {
  const code = postgresCode(error);
  if (
    code?.startsWith("08") ||
    code?.startsWith("28") ||
    code?.startsWith("53") ||
    code?.startsWith("58") ||
    code === "42501"
  )
    return true;
  // Connection-level failure classification covers both classic errno-style
  // system codes and the Bun.SQL public connection-failure code observed in
  // the compatibility gate (ERR_POSTGRES_CONNECTION_REFUSED).
  return [
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "ETIMEDOUT",
    "ERR_POSTGRES_CONNECTION_REFUSED",
  ].includes(code ?? "");
}

function isMigrationTimeout(error: unknown): boolean {
  return postgresCode(error) === "57014";
}

export async function reprovisionApplicationSchemas(
  options: DatabaseOptions,
): Promise<void> {
  const provision = sqlInstance(options);
  try {
    const client = await reserveSession(provision);
    try {
      await client.unsafe("BEGIN");
      await client.unsafe("SET LOCAL ROLE meshcore_owner");
      await client.unsafe("DROP SCHEMA IF EXISTS meshcore_public CASCADE");
      await client.unsafe("DROP SCHEMA IF EXISTS meshcore_private CASCADE");
      await client.unsafe(PRIVATE_SCHEMA_DDL);
      await client.unsafe(PUBLIC_SCHEMA_DDL);
      await client.unsafe(PUBLIC_PROJECTION_DDL);
      await client.unsafe(PUBLIC_PROJECTION_TRIGGERS_DDL);
      await client.unsafe(V10_PUBLIC_INDEX_DDL);
      await client.unsafe(
        "INSERT INTO meshcore_private.meshcore_io_stats(singleton) VALUES (1) ON CONFLICT (singleton) DO NOTHING",
      );
      await seedRegionScopeRegistry(client);
      const fingerprint = await computeV11Fingerprint(client);
      const generationRow = (
        await client.unsafe("SELECT CURRENT_TIMESTAMP AS created_at")
      )[0] as { created_at: Date } | undefined;
      if (!generationRow)
        throw new Error("CURRENT_TIMESTAMP returnerade ingen rad");
      const createdAt = generationRow.created_at;
      await client.unsafe(
        "INSERT INTO meshcore_private.application_metadata(singleton, schema_id, schema_version, schema_hash, database_created_at) VALUES (1, $1, $2, $3, $4)",
        [SCHEMA_ID, CURRENT_SCHEMA_VERSION, fingerprint, createdAt],
      );
      await client.unsafe(
        "INSERT INTO meshcore_public.schema_metadata(singleton, schema_id, schema_version, schema_hash, database_created_at) VALUES (1, $1, $2, $3, $4)",
        [SCHEMA_ID, CURRENT_SCHEMA_VERSION, fingerprint, createdAt],
      );
      await client.unsafe(
        "GRANT USAGE ON SCHEMA meshcore_private, meshcore_public TO meshcore_broker; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA meshcore_private, meshcore_public TO meshcore_broker; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA meshcore_private, meshcore_public TO meshcore_broker; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA meshcore_private, meshcore_public TO meshcore_broker; GRANT USAGE ON SCHEMA meshcore_public TO meshcore_reader, meshcore_http; GRANT SELECT ON ALL TABLES IN SCHEMA meshcore_public TO meshcore_reader, meshcore_http",
      );
      await client.unsafe("COMMIT");
    } catch (error) {
      await client.unsafe("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await releaseSession(client);
    }
  } finally {
    await provision.close({ timeout: 1 }).catch(() => undefined);
  }
}

async function resetProductionDatabase(
  options: DatabaseOptions,
): Promise<void> {
  if (options.database !== MESHCORE_DATABASE)
    throw new IncompatibleDatabaseError(
      "automatisk återställning tillåts endast för databasen meshcore",
    );
  await reprovisionApplicationSchemas(options);
}

export async function openDatabaseWithRecovery(
  options: DatabaseOptions,
  timeoutMs = DEFAULT_MIGRATION_TIMEOUT_MS,
  dependencies: {
    openCurrent?: (options: DatabaseOptions) => Promise<ApplicationDatabase>;
    migrate?: (
      options: DatabaseOptions,
      timeoutMs: number,
    ) => Promise<{
      fromVersion: number;
      toVersion: number;
      chain: number[];
    }>;
    reset?: (options: DatabaseOptions) => Promise<void>;
  } = {},
): Promise<ApplicationDatabase> {
  const openCurrent =
    dependencies.openCurrent ??
    ((config) => ApplicationDatabase.openPool(sqlInstance(config)));
  const migrate =
    dependencies.migrate ??
    (async (config, migrationTimeoutMs) => {
      const { migrateSchemaToCurrent } = await import("./schema-migration.js");
      return migrateSchemaToCurrent({
        databaseConfig: config,
        timeoutMs: migrationTimeoutMs,
      });
    });
  const reset = dependencies.reset ?? resetProductionDatabase;
  let incompatibility: IncompatibleDatabaseError;
  try {
    return await openCurrent(options);
  } catch (error) {
    if (isInfrastructureError(error)) throw error;
    if (error instanceof IncompatibleDatabaseError) incompatibility = error;
    else if (postgresCode(error) === "3D000")
      incompatibility = new IncompatibleDatabaseError("databasen saknas", {
        reason: "unknown_schema",
      });
    else throw error;
  }

  let resetReason = incompatibility.reason;
  const detectedVersion = incompatibility.actualSchemaVersion;
  if (detectedVersion === 9 || detectedVersion === 10) {
    const startedAt = Date.now();
    try {
      const result = await migrate(options, timeoutMs);
      recoveryLog.info({
        database_recovery_action: "migration_succeeded",
        attempted_from: result.fromVersion,
        target_schema_version: result.toVersion,
        migration_chain: result.chain,
        migration_duration_ms: Date.now() - startedAt,
      });
      try {
        return await openCurrent(options);
      } catch (error) {
        if (isInfrastructureError(error)) throw error;
        resetReason = "post_migration_validation_failed";
      }
    } catch (error) {
      if (isInfrastructureError(error)) throw error;
      resetReason = isMigrationTimeout(error)
        ? "migration_timeout"
        : "migration_failed";
      recoveryLog.warn({
        database_recovery_action: "migration_failed",
        database_recovery_reason: resetReason,
        detected_schema_version: detectedVersion,
        target_schema_version: CURRENT_SCHEMA_VERSION,
        migration_duration_ms: Date.now() - startedAt,
        error,
      });
    }
  }

  recoveryLog.warn({
    database_recovery_action: "reset",
    database_recovery_reason: resetReason,
    detected_schema_version: detectedVersion,
    target_schema_version: CURRENT_SCHEMA_VERSION,
  });
  await reset(options);
  databaseResetCount += 1;
  const database = await openCurrent(options);
  const generation = await database.getGenerationMetadata();
  recoveryLog.info({
    database_recovery_action: "reset",
    database_recovery_reason: resetReason,
    target_schema_version: generation.schemaVersion,
    database_created_at: generation.createdAt.toISOString(),
  });
  return database;
}

/** Opens production storage, recovering only a confirmed reachable schema incompatibility. */
export async function openProductionDatabase(): Promise<ApplicationDatabase> {
  const options = await productionOptions();
  const timeoutMs = optionalIntegerEnvironment(
    "DATABASE_MIGRATION_TIMEOUT_MS",
    DEFAULT_MIGRATION_TIMEOUT_MS,
    MIN_MIGRATION_TIMEOUT_MS,
    MAX_MIGRATION_TIMEOUT_MS,
  );
  return openDatabaseWithRecovery(options, timeoutMs);
}
export async function initializeDatabase(): Promise<ApplicationDatabase> {
  return openProductionDatabase();
}
export function getDatabaseResetCount(): number {
  return databaseResetCount;
}
export async function openExistingProductionDatabase(): Promise<ApplicationDatabase> {
  return openProductionDatabase();
}
/** Opens an explicit PostgreSQL test database and creates its clean schemas. */
export async function openTestDatabase(
  options: TestDatabaseOptions,
): Promise<ApplicationDatabase> {
  return ApplicationDatabase.connect(options);
}
