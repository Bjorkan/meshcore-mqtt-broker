import { constants } from "node:fs";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  connect,
  type Database,
  type Transaction,
} from "@tursodatabase/database";
import { getModuleLogger } from "./logger.js";

export const DATABASE_DIRECTORY = "/data/meshcore-mqtt-broker";
export const DATABASE_FILE = `${DATABASE_DIRECTORY}/meshcore-mqtt-broker.db`;
export const CURRENT_SCHEMA_VERSION = 2;

const SCHEMA_ID = "meshcore-mqtt-broker-history-v1";
const QUERY_TIMEOUT_MS = 5_000;
const log = getModuleLogger("Database");
let databaseResetCount = 0;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS application_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  schema_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cursor_signing_secret (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  secret TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS meshcore_io_ingress_expiration
  ON meshcore_io_ingress(expires_at_ms);
CREATE INDEX IF NOT EXISTS meshcore_io_ingress_processing
  ON meshcore_io_ingress(processing, expires_at_ms, id);

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

CREATE TABLE IF NOT EXISTS observers (
  id INTEGER PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE CHECK (length(public_key) = 64),
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  latest_region TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS observers_last_seen
  ON observers(last_seen_at_ms, id);

CREATE TABLE IF NOT EXISTS mqtt_events (
  id INTEGER PRIMARY KEY,
  topic TEXT NOT NULL,
  region TEXT,
  observer_id INTEGER REFERENCES observers(id) ON DELETE SET NULL,
  subtopic TEXT,
  subtopic_root TEXT,
  payload_blob BLOB NOT NULL,
  payload_text TEXT,
  payload_sha256 TEXT NOT NULL,
  qos INTEGER NOT NULL CHECK (qos BETWEEN 0 AND 2),
  retain INTEGER NOT NULL CHECK (retain IN (0, 1)),
  dup INTEGER NOT NULL CHECK (dup IN (0, 1)),
  received_at_ms INTEGER NOT NULL,
  payload_format TEXT NOT NULL,
  parse_status TEXT NOT NULL,
  processing_status TEXT NOT NULL,
  processing_started_at_ms INTEGER,
  processing_attempts INTEGER NOT NULL DEFAULT 0,
  parser_name TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  collector_instance_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mqtt_events_received
  ON mqtt_events(received_at_ms, id);
CREATE INDEX IF NOT EXISTS mqtt_events_observer_received
  ON mqtt_events(observer_id, received_at_ms, id);
CREATE INDEX IF NOT EXISTS mqtt_events_subtopic_received
  ON mqtt_events(subtopic_root, received_at_ms, id);
CREATE INDEX IF NOT EXISTS mqtt_events_processing
  ON mqtt_events(processing_status, processing_started_at_ms, id);
CREATE INDEX IF NOT EXISTS mqtt_events_parser_version
  ON mqtt_events(parser_version, received_at_ms, id);
CREATE INDEX IF NOT EXISTS mqtt_events_replay_match
  ON mqtt_events(topic, payload_sha256, retain, id);
CREATE INDEX IF NOT EXISTS mqtt_events_region_received
  ON mqtt_events(region, received_at_ms, id);

CREATE TABLE IF NOT EXISTS observer_region_history (
  id INTEGER PRIMARY KEY,
  observer_id INTEGER NOT NULL REFERENCES observers(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  observation_count INTEGER NOT NULL,
  UNIQUE(observer_id, region)
);
CREATE INDEX IF NOT EXISTS observer_region_history_region
  ON observer_region_history(region, last_seen_at_ms, observer_id);

CREATE TABLE IF NOT EXISTS observer_status_events (
  id INTEGER PRIMARY KEY,
  mqtt_event_id INTEGER NOT NULL UNIQUE REFERENCES mqtt_events(id) ON DELETE CASCADE,
  observer_id INTEGER NOT NULL REFERENCES observers(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  reported_at_ms INTEGER,
  received_at_ms INTEGER NOT NULL,
  origin TEXT,
  model TEXT,
  firmware_version TEXT,
  raw_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS observer_status_events_observer_received
  ON observer_status_events(observer_id, received_at_ms, id);
CREATE INDEX IF NOT EXISTS observer_status_events_received
  ON observer_status_events(received_at_ms, id);

CREATE TABLE IF NOT EXISTS observer_metrics (
  id INTEGER PRIMARY KEY,
  observer_id INTEGER NOT NULL REFERENCES observers(id) ON DELETE CASCADE,
  mqtt_event_id INTEGER NOT NULL REFERENCES mqtt_events(id) ON DELETE CASCADE,
  received_at_ms INTEGER NOT NULL,
  reported_at_ms INTEGER,
  metric_name TEXT NOT NULL,
  numeric_value REAL,
  text_value TEXT,
  boolean_value INTEGER CHECK (boolean_value IN (0, 1)),
  unit TEXT,
  CHECK (
    (numeric_value IS NOT NULL) +
    (text_value IS NOT NULL) +
    (boolean_value IS NOT NULL) = 1
  ),
  UNIQUE(mqtt_event_id, metric_name)
);
CREATE INDEX IF NOT EXISTS observer_metrics_observer_received
  ON observer_metrics(observer_id, received_at_ms, id);

CREATE TABLE IF NOT EXISTS observer_radio_history (
  id INTEGER PRIMARY KEY,
  observer_id INTEGER NOT NULL REFERENCES observers(id) ON DELETE CASCADE,
  mqtt_event_id INTEGER NOT NULL UNIQUE REFERENCES mqtt_events(id) ON DELETE CASCADE,
  frequency_mhz REAL,
  bandwidth_khz REAL,
  spreading_factor INTEGER,
  coding_rate INTEGER,
  tx_power_dbm REAL,
  received_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS observer_radio_history_observer_received
  ON observer_radio_history(observer_id, received_at_ms, id);

CREATE TABLE IF NOT EXISTS neighbor_snapshots (
  id INTEGER PRIMARY KEY,
  mqtt_event_id INTEGER NOT NULL UNIQUE REFERENCES mqtt_events(id) ON DELETE CASCADE,
  observer_id INTEGER NOT NULL REFERENCES observers(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  reported_at_ms INTEGER,
  received_at_ms INTEGER NOT NULL,
  mqtt_retained INTEGER NOT NULL CHECK (mqtt_retained IN (0, 1)),
  suspected_replay INTEGER NOT NULL DEFAULT 0 CHECK (suspected_replay IN (0, 1)),
  replay_of_snapshot_id INTEGER REFERENCES neighbor_snapshots(id) ON DELETE SET NULL,
  self_scopes_json TEXT NOT NULL,
  entry_count INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS neighbor_snapshots_observer_received
  ON neighbor_snapshots(observer_id, received_at_ms, id);
CREATE INDEX IF NOT EXISTS neighbor_snapshots_replay_match
  ON neighbor_snapshots(observer_id, reported_at_ms, mqtt_retained, id);
CREATE INDEX IF NOT EXISTS neighbor_snapshots_replay
  ON neighbor_snapshots(replay_of_snapshot_id, id);

CREATE TABLE IF NOT EXISTS neighbor_entries (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES neighbor_snapshots(id) ON DELETE CASCADE,
  neighbor_public_key TEXT NOT NULL CHECK (length(neighbor_public_key) = 64),
  snr REAL,
  rssi REAL,
  heard_secs_ago INTEGER,
  calculated_last_heard_at_ms INTEGER,
  status TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  UNIQUE(snapshot_id, neighbor_public_key)
);
CREATE INDEX IF NOT EXISTS neighbor_entries_public_key
  ON neighbor_entries(neighbor_public_key, snapshot_id);

CREATE TABLE IF NOT EXISTS packets (
  id INTEGER PRIMARY KEY,
  packet_sha256 TEXT NOT NULL UNIQUE,
  logical_packet_id INTEGER REFERENCES logical_packets(id) ON DELETE SET NULL,
  raw_packet_blob BLOB NOT NULL,
  raw_packet_hex TEXT NOT NULL,
  packet_length INTEGER NOT NULL,
  packet_type TEXT,
  packet_type_code INTEGER,
  payload_type TEXT,
  payload_type_code INTEGER,
  route_type TEXT,
  decode_status TEXT NOT NULL,
  decode_error TEXT,
  decoder_name TEXT,
  decoder_version TEXT,
  decoded_at_ms INTEGER,
  decoded_json TEXT,
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS packets_first_seen
  ON packets(first_seen_at_ms, id);
CREATE INDEX IF NOT EXISTS packets_type_first_seen
  ON packets(packet_type, first_seen_at_ms, id);
CREATE INDEX IF NOT EXISTS packets_decode_status
  ON packets(decode_status, decoder_version, id);
CREATE INDEX IF NOT EXISTS packets_logical
  ON packets(logical_packet_id, id);

CREATE TABLE IF NOT EXISTS logical_packets (
  id INTEGER PRIMARY KEY,
  logical_packet_id TEXT NOT NULL UNIQUE CHECK (length(logical_packet_id) = 67),
  packet_type TEXT,
  payload_type TEXT,
  first_observed_at_ms INTEGER NOT NULL,
  last_observed_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS logical_packets_type_observed
  ON logical_packets(packet_type, first_observed_at_ms, id);

CREATE TABLE IF NOT EXISTS packet_observations (
  id INTEGER PRIMARY KEY,
  packet_id INTEGER NOT NULL REFERENCES packets(id) ON DELETE CASCADE,
  mqtt_event_id INTEGER NOT NULL UNIQUE REFERENCES mqtt_events(id) ON DELETE CASCADE,
  observer_id INTEGER NOT NULL REFERENCES observers(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  reported_at_ms INTEGER,
  rssi REAL,
  snr REAL,
  score REAL,
  direction TEXT,
  suspected_mqtt_duplicate INTEGER NOT NULL DEFAULT 0 CHECK (suspected_mqtt_duplicate IN (0, 1)),
  suspected_rf_retransmission INTEGER NOT NULL DEFAULT 0 CHECK (suspected_rf_retransmission IN (0, 1)),
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS packet_observations_packet_received
  ON packet_observations(packet_id, received_at_ms, id);
CREATE INDEX IF NOT EXISTS packet_observations_observer_received
  ON packet_observations(observer_id, received_at_ms, id);
CREATE INDEX IF NOT EXISTS packet_observations_received
  ON packet_observations(received_at_ms, id);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE CHECK (length(public_key) = 64),
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  latest_name TEXT,
  latest_role TEXT,
  latest_latitude REAL,
  latest_longitude REAL,
  latest_advert_timestamp INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS nodes_last_seen
  ON nodes(last_seen_at_ms, id);

CREATE TABLE IF NOT EXISTS node_adverts (
  id INTEGER PRIMARY KEY,
  packet_id INTEGER NOT NULL UNIQUE REFERENCES packets(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  node_public_key TEXT NOT NULL CHECK (length(node_public_key) = 64),
  advert_timestamp INTEGER,
  first_observed_at_ms INTEGER NOT NULL,
  name TEXT,
  role TEXT,
  latitude REAL,
  longitude REAL,
  flags INTEGER,
  capabilities_json TEXT,
  signature_valid INTEGER CHECK (signature_valid IN (0, 1)),
  verified INTEGER NOT NULL CHECK (verified IN (0, 1)),
  verification_error TEXT,
  decoded_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS node_adverts_node_observed
  ON node_adverts(node_id, first_observed_at_ms, id);
CREATE INDEX IF NOT EXISTS node_adverts_observed
  ON node_adverts(first_observed_at_ms, id);

CREATE TABLE IF NOT EXISTS node_sightings (
  id INTEGER PRIMARY KEY,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  observer_id INTEGER NOT NULL REFERENCES observers(id) ON DELETE CASCADE,
  packet_id INTEGER NOT NULL REFERENCES packets(id) ON DELETE CASCADE,
  packet_observation_id INTEGER NOT NULL REFERENCES packet_observations(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  sighting_type TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  UNIQUE(node_id, packet_observation_id, sighting_type)
);
CREATE INDEX IF NOT EXISTS node_sightings_node_received
  ON node_sightings(node_id, received_at_ms, id);
CREATE INDEX IF NOT EXISTS node_sightings_observer_received
  ON node_sightings(observer_id, received_at_ms, id);
CREATE INDEX IF NOT EXISTS node_sightings_received
  ON node_sightings(received_at_ms, id);
CREATE INDEX IF NOT EXISTS node_sightings_region_received
  ON node_sightings(region, received_at_ms, id);
CREATE INDEX IF NOT EXISTS node_sightings_packet_observation
  ON node_sightings(packet_observation_id, id);
CREATE INDEX IF NOT EXISTS node_sightings_packet
  ON node_sightings(packet_id, id);

CREATE TABLE IF NOT EXISTS node_prefix_candidates (
  prefix_hex TEXT NOT NULL,
  prefix_length_bytes INTEGER NOT NULL CHECK (prefix_length_bytes BETWEEN 1 AND 3),
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  evidence_count INTEGER NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY(prefix_hex, prefix_length_bytes, node_id)
);
CREATE INDEX IF NOT EXISTS node_prefix_candidates_node
  ON node_prefix_candidates(node_id, prefix_length_bytes);

CREATE TABLE IF NOT EXISTS packet_paths (
  id INTEGER PRIMARY KEY,
  packet_observation_id INTEGER NOT NULL UNIQUE REFERENCES packet_observations(id) ON DELETE CASCADE,
  raw_path_blob BLOB NOT NULL,
  hop_count INTEGER NOT NULL,
  received_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS packet_path_hops (
  id INTEGER PRIMARY KEY,
  path_id INTEGER NOT NULL REFERENCES packet_paths(id) ON DELETE CASCADE,
  hop_index INTEGER NOT NULL,
  prefix_hex TEXT NOT NULL,
  prefix_length_bytes INTEGER NOT NULL CHECK (prefix_length_bytes BETWEEN 1 AND 3),
  resolved_node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  resolution_status TEXT NOT NULL,
  resolution_confidence REAL,
  UNIQUE(path_id, hop_index)
);

CREATE TABLE IF NOT EXISTS trace_events (
  id INTEGER PRIMARY KEY,
  packet_id INTEGER NOT NULL REFERENCES packets(id) ON DELETE CASCADE,
  packet_observation_id INTEGER NOT NULL UNIQUE REFERENCES packet_observations(id) ON DELETE CASCADE,
  source_node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  tag TEXT,
  reported_at_ms INTEGER,
  received_at_ms INTEGER NOT NULL,
  decoded_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trace_events_received
  ON trace_events(received_at_ms, id);
CREATE INDEX IF NOT EXISTS trace_events_packet
  ON trace_events(packet_id, id);
CREATE INDEX IF NOT EXISTS trace_events_source
  ON trace_events(source_node_id, id);

CREATE TABLE IF NOT EXISTS trace_hops (
  id INTEGER PRIMARY KEY,
  trace_event_id INTEGER NOT NULL REFERENCES trace_events(id) ON DELETE CASCADE,
  hop_index INTEGER NOT NULL,
  prefix_hex TEXT NOT NULL,
  prefix_length_bytes INTEGER NOT NULL CHECK (prefix_length_bytes BETWEEN 1 AND 3),
  snr REAL,
  resolved_node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  resolution_confidence REAL,
  UNIQUE(trace_event_id, hop_index)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  packet_id INTEGER NOT NULL REFERENCES packets(id) ON DELETE CASCADE,
  packet_observation_id INTEGER NOT NULL UNIQUE REFERENCES packet_observations(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL,
  channel TEXT,
  channel_index INTEGER,
  channel_name TEXT,
  sender_prefix TEXT,
  sender_node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  destination_prefix TEXT,
  destination_node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  encrypted INTEGER NOT NULL CHECK (encrypted IN (0, 1)),
  text TEXT,
  decrypted_sender TEXT,
  decrypted_flags INTEGER,
  payload_blob BLOB NOT NULL,
  signature TEXT,
  signature_valid INTEGER CHECK (signature_valid IN (0, 1)),
  reported_at_ms INTEGER,
  received_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_received
  ON messages(received_at_ms, id);
CREATE INDEX IF NOT EXISTS messages_packet
  ON messages(packet_id, id);
CREATE INDEX IF NOT EXISTS messages_sender
  ON messages(sender_node_id, id);
CREATE INDEX IF NOT EXISTS messages_destination
  ON messages(destination_node_id, id);

CREATE TABLE IF NOT EXISTS telemetry_events (
  id INTEGER PRIMARY KEY,
  packet_id INTEGER NOT NULL REFERENCES packets(id) ON DELETE CASCADE,
  packet_observation_id INTEGER NOT NULL UNIQUE REFERENCES packet_observations(id) ON DELETE CASCADE,
  node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  reported_at_ms INTEGER,
  received_at_ms INTEGER NOT NULL,
  decoded_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS telemetry_events_node_received
  ON telemetry_events(node_id, received_at_ms, id);
CREATE INDEX IF NOT EXISTS telemetry_events_packet
  ON telemetry_events(packet_id, id);
CREATE INDEX IF NOT EXISTS telemetry_events_received
  ON telemetry_events(received_at_ms, id);

CREATE TABLE IF NOT EXISTS telemetry_values (
  id INTEGER PRIMARY KEY,
  telemetry_event_id INTEGER NOT NULL REFERENCES telemetry_events(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  numeric_value REAL,
  text_value TEXT,
  boolean_value INTEGER CHECK (boolean_value IN (0, 1)),
  unit TEXT,
  channel INTEGER,
  metadata_json TEXT,
  CHECK (
    (numeric_value IS NOT NULL) +
    (text_value IS NOT NULL) +
    (boolean_value IS NOT NULL) = 1
  )
);
CREATE INDEX IF NOT EXISTS telemetry_values_event
  ON telemetry_values(telemetry_event_id, id);

CREATE TABLE IF NOT EXISTS processing_errors (
  id INTEGER PRIMARY KEY,
  mqtt_event_id INTEGER NOT NULL REFERENCES mqtt_events(id) ON DELETE CASCADE,
  packet_id INTEGER REFERENCES packets(id) ON DELETE SET NULL,
  stage TEXT NOT NULL,
  error_code TEXT NOT NULL,
  error_message TEXT NOT NULL,
  processor_name TEXT NOT NULL,
  processor_version TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  UNIQUE(mqtt_event_id, stage, error_code, processor_version)
);
CREATE INDEX IF NOT EXISTS processing_errors_received
  ON processing_errors(received_at_ms, id);
CREATE INDEX IF NOT EXISTS processing_errors_event
  ON processing_errors(mqtt_event_id, id);
CREATE INDEX IF NOT EXISTS processing_errors_packet
  ON processing_errors(packet_id, id);
`;

const REQUIRED_TABLES = [
  "application_metadata",
  "cursor_signing_secret",
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
  "observers",
  "mqtt_events",
  "observer_region_history",
  "observer_status_events",
  "observer_metrics",
  "observer_radio_history",
  "neighbor_snapshots",
  "neighbor_entries",
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
  "logical_packets",
] as const;

const REQUIRED_COLUMNS: Record<(typeof REQUIRED_TABLES)[number], string[]> = {
  application_metadata: [
    "singleton",
    "schema_id",
    "schema_version",
    "schema_hash",
  ],
  cursor_signing_secret: ["id", "secret"],
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
  observers: [
    "id",
    "public_key",
    "first_seen_at_ms",
    "last_seen_at_ms",
    "latest_region",
    "created_at_ms",
    "updated_at_ms",
  ],
  mqtt_events: [
    "id",
    "topic",
    "region",
    "observer_id",
    "subtopic",
    "subtopic_root",
    "payload_blob",
    "payload_text",
    "payload_sha256",
    "qos",
    "retain",
    "dup",
    "received_at_ms",
    "payload_format",
    "parse_status",
    "processing_status",
    "processing_started_at_ms",
    "processing_attempts",
    "parser_name",
    "parser_version",
    "collector_instance_id",
    "created_at_ms",
    "updated_at_ms",
  ],
  observer_region_history: [
    "id",
    "observer_id",
    "region",
    "first_seen_at_ms",
    "last_seen_at_ms",
    "observation_count",
  ],
  observer_status_events: [
    "id",
    "mqtt_event_id",
    "observer_id",
    "region",
    "reported_at_ms",
    "received_at_ms",
    "origin",
    "model",
    "firmware_version",
    "raw_json",
    "created_at_ms",
  ],
  observer_metrics: [
    "id",
    "observer_id",
    "mqtt_event_id",
    "received_at_ms",
    "reported_at_ms",
    "metric_name",
    "numeric_value",
    "text_value",
    "boolean_value",
    "unit",
  ],
  observer_radio_history: [
    "id",
    "observer_id",
    "mqtt_event_id",
    "frequency_mhz",
    "bandwidth_khz",
    "spreading_factor",
    "coding_rate",
    "tx_power_dbm",
    "received_at_ms",
  ],
  neighbor_snapshots: [
    "id",
    "mqtt_event_id",
    "observer_id",
    "region",
    "reported_at_ms",
    "received_at_ms",
    "mqtt_retained",
    "suspected_replay",
    "replay_of_snapshot_id",
    "self_scopes_json",
    "entry_count",
    "raw_json",
  ],
  neighbor_entries: [
    "id",
    "snapshot_id",
    "neighbor_public_key",
    "snr",
    "rssi",
    "heard_secs_ago",
    "calculated_last_heard_at_ms",
    "status",
    "scopes_json",
  ],
  packets: [
    "id",
    "packet_sha256",
    "logical_packet_id",
    "raw_packet_blob",
    "raw_packet_hex",
    "packet_length",
    "packet_type",
    "packet_type_code",
    "payload_type",
    "payload_type_code",
    "route_type",
    "decode_status",
    "decode_error",
    "decoder_name",
    "decoder_version",
    "decoded_at_ms",
    "decoded_json",
    "first_seen_at_ms",
    "last_seen_at_ms",
    "created_at_ms",
    "updated_at_ms",
  ],
  packet_observations: [
    "id",
    "packet_id",
    "mqtt_event_id",
    "observer_id",
    "region",
    "received_at_ms",
    "reported_at_ms",
    "rssi",
    "snr",
    "score",
    "direction",
    "suspected_mqtt_duplicate",
    "suspected_rf_retransmission",
    "created_at_ms",
  ],
  nodes: [
    "id",
    "public_key",
    "first_seen_at_ms",
    "last_seen_at_ms",
    "latest_name",
    "latest_role",
    "latest_latitude",
    "latest_longitude",
    "latest_advert_timestamp",
    "created_at_ms",
    "updated_at_ms",
  ],
  node_adverts: [
    "id",
    "packet_id",
    "node_id",
    "node_public_key",
    "advert_timestamp",
    "first_observed_at_ms",
    "name",
    "role",
    "latitude",
    "longitude",
    "flags",
    "capabilities_json",
    "signature_valid",
    "verified",
    "verification_error",
    "decoded_json",
    "created_at_ms",
  ],
  node_sightings: [
    "id",
    "node_id",
    "observer_id",
    "packet_id",
    "packet_observation_id",
    "region",
    "sighting_type",
    "received_at_ms",
  ],
  node_prefix_candidates: [
    "prefix_hex",
    "prefix_length_bytes",
    "node_id",
    "first_seen_at_ms",
    "last_seen_at_ms",
    "evidence_count",
    "confidence",
  ],
  packet_paths: [
    "id",
    "packet_observation_id",
    "raw_path_blob",
    "hop_count",
    "received_at_ms",
  ],
  packet_path_hops: [
    "id",
    "path_id",
    "hop_index",
    "prefix_hex",
    "prefix_length_bytes",
    "resolved_node_id",
    "resolution_status",
    "resolution_confidence",
  ],
  trace_events: [
    "id",
    "packet_id",
    "packet_observation_id",
    "source_node_id",
    "tag",
    "reported_at_ms",
    "received_at_ms",
    "decoded_json",
  ],
  trace_hops: [
    "id",
    "trace_event_id",
    "hop_index",
    "prefix_hex",
    "prefix_length_bytes",
    "snr",
    "resolved_node_id",
    "resolution_confidence",
  ],
  messages: [
    "id",
    "packet_id",
    "packet_observation_id",
    "message_type",
    "channel",
    "channel_index",
    "channel_name",
    "sender_prefix",
    "sender_node_id",
    "destination_prefix",
    "destination_node_id",
    "encrypted",
    "text",
    "decrypted_sender",
    "decrypted_flags",
    "payload_blob",
    "signature",
    "signature_valid",
    "reported_at_ms",
    "received_at_ms",
  ],
  telemetry_events: [
    "id",
    "packet_id",
    "packet_observation_id",
    "node_id",
    "reported_at_ms",
    "received_at_ms",
    "decoded_json",
  ],
  telemetry_values: [
    "id",
    "telemetry_event_id",
    "metric_name",
    "numeric_value",
    "text_value",
    "boolean_value",
    "unit",
    "channel",
    "metadata_json",
  ],
  processing_errors: [
    "id",
    "mqtt_event_id",
    "packet_id",
    "stage",
    "error_code",
    "error_message",
    "processor_name",
    "processor_version",
    "received_at_ms",
    "created_at_ms",
  ],
  logical_packets: [
    "id",
    "logical_packet_id",
    "packet_type",
    "payload_type",
    "first_observed_at_ms",
    "last_observed_at_ms",
    "created_at_ms",
  ],
};

export class IncompatibleDatabaseError extends Error {
  constructor(detail: string) {
    super(
      `Databasen är inte kompatibel med denna installation (${detail}). Vid brokerstart tas den bort och ersätts med en ny tom databas.`,
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
    try {
      return await ApplicationDatabase.connect(file, true);
    } catch (error) {
      if (!(error instanceof IncompatibleDatabaseError)) throw error;
      log.warn(`${error.message} Raderar ${file} och skapar aktuellt schema.`);
      await resetDatabase(file);
      databaseResetCount += 1;
      return ApplicationDatabase.connect(file, true);
    }
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
      await connection.exec("PRAGMA foreign_keys = ON");
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
      await this.createCurrentSchema();
    }

    await this.validateCurrentSchema();
    await this.probe();
  }

  private async createCurrentSchema(): Promise<void> {
    await this.connection.exec(SCHEMA);
    const schemaHash = await this.schemaFingerprint();
    await this.connection.run(
      `INSERT INTO application_metadata(
         singleton, schema_id, schema_version, schema_hash
       ) VALUES (1, ?, ?, ?)`,
      SCHEMA_ID,
      CURRENT_SCHEMA_VERSION,
      schemaHash,
    );
    await this.connection.run(
      "INSERT INTO meshcore_io_stats(singleton) VALUES (1)",
    );
  }

  private async validateSchemaMarker(): Promise<void> {
    try {
      const metadata = (await this.connection.get(
        `SELECT schema_id, schema_version, schema_hash FROM application_metadata
         WHERE singleton = 1`,
      )) as
        | {
            schema_id?: string;
            schema_version?: number;
            schema_hash?: string;
          }
        | undefined;
      if (metadata?.schema_id !== SCHEMA_ID) {
        throw new IncompatibleDatabaseError("okänt schema-id");
      }
      if (Number(metadata.schema_version) !== CURRENT_SCHEMA_VERSION) {
        throw new IncompatibleDatabaseError("fel schema-version");
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

    const foreignKeys = (await this.connection.get("PRAGMA foreign_keys")) as
      { foreign_keys?: number } | undefined;
    if (Number(foreignKeys?.foreign_keys) !== 1) {
      throw new IncompatibleDatabaseError("foreign keys är inte aktiverade");
    }

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

    const violations = (await this.connection.all(
      "PRAGMA foreign_key_check",
    )) as unknown[];
    if (violations.length > 0) {
      throw new IncompatibleDatabaseError(
        `foreign key-kontrollen hittade ${violations.length} fel`,
      );
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

async function resetDatabase(file: string): Promise<void> {
  for (const suffix of ["-wal", "-shm", "-tshm", "-journal", ""]) {
    await rm(`${file}${suffix}`, { force: true });
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

export async function initializeDatabase(): Promise<ApplicationDatabase> {
  return openProductionDatabase();
}

export function getDatabaseResetCount(): number {
  return databaseResetCount;
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
