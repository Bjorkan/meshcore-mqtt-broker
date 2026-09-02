import { SQL } from "bun";
import assert from "node:assert/strict";
import { afterEach, test } from "bun:test";
import {
  CURRENT_SCHEMA_VERSION,
  formatDatabaseAge,
  openTestDatabase,
} from "../src/database.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

test("test factory initializes the broker's private and public PostgreSQL schemas", async () => {
  const fixture = await temporaryDatabase("schema-");
  fixtures.push(fixture);
  await fixture.database.probe();
  const tables = await fixture.database.all(
    "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('meshcore_private', 'meshcore_public') ORDER BY table_schema, table_name",
  );
  assert.ok(tables.some((row) => row.table_name === "retained_packets"));
  assert.ok(tables.some((row) => row.table_name === "heard_node_adverts"));
  assert.ok(tables.some((row) => row.table_name === "heard_node_iata"));
  assert.ok(tables.some((row) => row.table_name === "observer_iata_history"));
  assert.ok(!tables.some((row) => row.table_name === "heard_node_regions"));
  assert.ok(
    !tables.some((row) => row.table_name === "observer_region_history"),
  );
  assert.ok(tables.some((row) => row.table_name === "meshcore_io_jobs"));
  assert.ok(tables.some((row) => row.table_name === "mqtt_events"));
  assert.ok(tables.some((row) => row.table_name === "mqtt_event_provenance"));
  assert.ok(
    tables.some(
      (row) =>
        row.table_schema === "meshcore_public" && row.table_name === "packets",
    ),
  );
  const metadata = await fixture.database.get(
    "SELECT schema_version FROM application_metadata WHERE singleton = $1",
    1,
  );
  assert.equal(Number(metadata.schema_version), CURRENT_SCHEMA_VERSION);
  const publicMetadata = await fixture.database.get(
    "SELECT schema_version FROM meshcore_public.schema_metadata WHERE singleton = $1",
    1,
  );
  assert.equal(Number(publicMetadata.schema_version), CURRENT_SCHEMA_VERSION);
  const registry = await fixture.database.all(
    "SELECT region, name, manually_added, first_seen_at_ms, last_seen_at_ms, observation_count FROM meshcore_public.region_scopes ORDER BY region",
  );
  assert.equal(registry.length, 1 + 21 + 290);
  assert.ok(registry.every((row) => row.manually_added === true));
  assert.ok(registry.every((row) => row.name !== null));
  assert.ok(registry.every((row) => row.first_seen_at_ms === null));
  assert.ok(registry.every((row) => row.last_seen_at_ms === null));
  assert.ok(registry.every((row) => Number(row.observation_count) === 0));
  assert.deepEqual(registry[0], {
    region: "se",
    name: "Sverige",
    manually_added: true,
    first_seen_at_ms: null,
    last_seen_at_ms: null,
    observation_count: "0",
  });
  assert.deepEqual(
    registry.find((row) => row.region === "se13"),
    {
      region: "se13",
      name: "Hallands län",
      manually_added: true,
      first_seen_at_ms: null,
      last_seen_at_ms: null,
      observation_count: "0",
    },
  );
});

test("test factory requires explicit PostgreSQL test options", async () => {
  await assert.rejects(
    openTestDatabase({
      connectionString: process.env.POSTGRES_TEST_URL,
      schema: "not_meshcore_private",
    }),
    /meshcore_private/,
  );
});

test("queries bind PostgreSQL values rather than interpolating SQL", async () => {
  const fixture = await temporaryDatabase("prepared-");
  fixtures.push(fixture);
  const key = "A".repeat(64);
  await fixture.database.run(
    "INSERT INTO observer_profiles(public_key, node_name, node_name_expires_at_ms) VALUES ($1, $2, $3)",
    key,
    "name'); DROP TABLE observer_profiles; --",
    Date.now() + 1000,
  );
  const row = await fixture.database.get(
    "SELECT node_name FROM observer_profiles WHERE public_key = $1",
    key,
  );
  assert.equal(row.node_name, "name'); DROP TABLE observer_profiles; --");
});

test("transactions commit parameterized writes", async () => {
  const fixture = await temporaryDatabase("transaction-");
  fixtures.push(fixture);
  await fixture.database.transaction(async (tx) => {
    await tx.run(
      "INSERT INTO observer_profiles(public_key, node_name) VALUES ($1, $2)",
      "B".repeat(64),
      "transaction",
    );
  })();
  const row = await fixture.database.get(
    "SELECT node_name FROM observer_profiles WHERE public_key = $1",
    "B".repeat(64),
  );
  assert.equal(row.node_name, "transaction");
});

test("schema objects survive a PostgreSQL connection restart", async () => {
  const fixture = await temporaryDatabase("restart-");
  fixtures.push(fixture);
  await fixture.database.run(
    "INSERT INTO observer_profiles(public_key, node_name) VALUES ($1, $2)",
    "C".repeat(64),
    "durable",
  );
  const before = await fixture.database.getGenerationMetadata();
  await fixture.reopen();
  const after = await fixture.database.getGenerationMetadata();
  assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
  const row = await fixture.database.get(
    "SELECT node_name FROM observer_profiles WHERE public_key = $1",
    "C".repeat(64),
  );
  assert.equal(row.node_name, "durable");
});

test("ordinary performance indexes do not change semantic compatibility", async () => {
  const fixture = await temporaryDatabase("extra-index-");
  fixtures.push(fixture);
  const before = await fixture.database.getGenerationMetadata();
  await fixture.database.run(
    "CREATE INDEX irrelevant_runtime_test_index ON meshcore_public.nodes(latest_name)",
  );
  await fixture.reopen();
  const after = await fixture.database.getGenerationMetadata();
  assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
});

test("schema carries required PostgreSQL indexes", async () => {
  const fixture = await temporaryDatabase("index-schema-");
  fixtures.push(fixture);
  const indexes = await fixture.database.all(
    "SELECT schemaname, indexname FROM pg_indexes WHERE schemaname IN ('meshcore_private', 'meshcore_public')",
  );
  const names = new Set(
    indexes.map((row) => `${row.schemaname}.${row.indexname}`),
  );
  for (const expected of [
    "meshcore_private.mqtt_subscriptions_topic",
    "meshcore_private.mqtt_outgoing_client_order",
    "meshcore_private.retained_packets_expiration",
    "meshcore_private.mqtt_events_received",
    "meshcore_private.mqtt_events_pending_claim",
    "meshcore_private.mqtt_event_provenance_received",
    "meshcore_private.mqtt_event_provenance_observer_iata_received",
    "meshcore_private.mqtt_event_provenance_normalized_retention",
    "meshcore_private.observer_metrics_observer_metric_received",
    "meshcore_private.meshcore_io_jobs_claim",
    "meshcore_public.public_packet_observations_received",
    "meshcore_public.public_packet_observations_iata_received",
    "meshcore_public.public_node_sightings_node_received",
    "meshcore_public.public_node_sightings_iata_received",
    "meshcore_public.public_neighbor_entry_scopes_scope",
    "meshcore_public.public_nodes_location",
  ]) {
    assert.ok(names.has(expected), `missing index ${expected}`);
  }
});

test("observer metrics use weekly Timescale chunks", async () => {
  const fixture = await temporaryDatabase("timescale-schema-");
  fixtures.push(fixture);
  const hypertable = await fixture.database.get(
    `SELECT hypertable_schema, hypertable_name, num_dimensions
     FROM timescaledb_information.hypertables
     WHERE hypertable_schema = 'meshcore_private'
       AND hypertable_name = 'observer_metrics'`,
  );
  assert.deepEqual(hypertable, {
    hypertable_schema: "meshcore_private",
    hypertable_name: "observer_metrics",
    num_dimensions: 1,
  });
  const dimension = await fixture.database.get(
    `SELECT column_name, integer_interval
     FROM timescaledb_information.dimensions
     WHERE hypertable_schema = 'meshcore_private'
       AND hypertable_name = 'observer_metrics'`,
  );
  assert.equal(dimension.column_name, "received_at_ms");
  assert.equal(Number(dimension.integer_interval), 604_800_000);
});

test("public observer metrics is a direct view without row projection triggers", async () => {
  const fixture = await temporaryDatabase("metric-view-");
  fixtures.push(fixture);
  const key = "D".repeat(64);
  const now = 1_800_000_000_000;
  await fixture.database.run(
    `INSERT INTO observers(public_key, first_seen_at_ms, last_seen_at_ms, created_at_ms, updated_at_ms)
     VALUES ($1,$2,$2,$2,$2)`,
    key,
    now,
  );
  const observer = await fixture.database.get(
    "SELECT id FROM observers WHERE public_key = $1",
    key,
  );
  await fixture.database.run(
    `INSERT INTO mqtt_event_provenance(event_id, topic, iata, observer_public_key, payload_sha256,
       payload_size_bytes, qos, retain, dup, received_at_ms, parser_name, parser_version, collector_instance_id, created_at_ms)
     VALUES (123,$1,'STO',$2,$3,2,0,false,false,$4,'test','1','test',$4)`,
    `meshcore/STO/${key}/status`,
    key,
    "f".repeat(64),
    now,
  );
  const metric = await fixture.database.get(
    `INSERT INTO observer_metrics(observer_id, mqtt_event_id, received_at_ms, metric_name, numeric_value)
     VALUES ($1,123,$2,'battery',4.1) RETURNING id`,
    observer.id,
    now,
  );
  const row = await fixture.database.get(
    "SELECT id, private_id, observer_public_key, metric_name, numeric_value FROM meshcore_public.observer_metrics",
  );
  assert.equal(Number(row.id), Number(metric.id));
  assert.equal(Number(row.private_id), Number(metric.id));
  assert.equal(row.observer_public_key, key);
  assert.equal(row.metric_name, "battery");
  assert.equal(Number(row.numeric_value), 4.1);
  const relation = await fixture.database.get(
    `SELECT table_type FROM information_schema.tables
     WHERE table_schema='meshcore_public' AND table_name='observer_metrics'`,
  );
  assert.equal(relation.table_type, "VIEW");
  const triggers = await fixture.database.all(
    `SELECT trigger_name FROM information_schema.triggers
     WHERE event_object_schema='meshcore_private' AND event_object_table='observer_metrics'`,
  );
  assert.equal(triggers.length, 0);
});

test("normalized event foreign keys target compact provenance instead of the raw journal", async () => {
  const fixture = await temporaryDatabase("provenance-fk-");
  fixtures.push(fixture);
  const rows = await fixture.database.all(
    `SELECT format('%I.%I', child_namespace.nspname, child.relname) AS child,
            format('%I.%I', parent_namespace.nspname, parent.relname) AS parent,
            constraint_row.confdeltype
     FROM pg_constraint constraint_row
     JOIN pg_class child ON child.oid = constraint_row.conrelid
     JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
     JOIN pg_class parent ON parent.oid = constraint_row.confrelid
     JOIN pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace
     WHERE contype='f' AND conname LIKE '%mqtt_event_id_fkey'
     ORDER BY child`,
  );
  const expected = new Set([
    "meshcore_private.observer_status_events",
    "meshcore_private.observer_metrics",
    "meshcore_private.observer_radio_history",
    "meshcore_private.neighbor_snapshots",
    "meshcore_private.packet_observations",
    "meshcore_private.processing_errors",
  ]);
  for (const row of rows) {
    if (!expected.has(row.child)) continue;
    assert.equal(row.parent, "meshcore_private.mqtt_event_provenance");
    assert.equal(row.confdeltype, "r");
    expected.delete(row.child);
  }
  assert.deepEqual([...expected], []);
});

test("normalized IATA columns reject lowercase, test, and malformed values", async () => {
  const fixture = await temporaryDatabase("iata-checks-");
  fixtures.push(fixture);
  await fixture.database.run(`
    DO $$
    BEGIN
      BEGIN
        INSERT INTO observers(public_key, first_seen_at_ms, last_seen_at_ms, latest_iata, created_at_ms, updated_at_ms)
        VALUES (repeat('D', 64), 1, 1, 'sto', 1, 1);
        RAISE EXCEPTION 'lowercase IATA was accepted';
      EXCEPTION WHEN check_violation THEN NULL;
      END;
      BEGIN
        INSERT INTO observers(public_key, first_seen_at_ms, last_seen_at_ms, latest_iata, created_at_ms, updated_at_ms)
        VALUES (repeat('E', 64), 1, 1, 'test', 1, 1);
        RAISE EXCEPTION 'test ingress was accepted as IATA';
      EXCEPTION WHEN check_violation THEN NULL;
      END;
    END $$;
  `);
  await fixture.database.run(
    `INSERT INTO observers(public_key, first_seen_at_ms, last_seen_at_ms, latest_iata, created_at_ms, updated_at_ms)
     VALUES ($1, 1, 1, $2, 1, 1)`,
    "F".repeat(64),
    "STO",
  );
});

test("schema markers store a real computed SHA-256 public contract fingerprint", async () => {
  const fixture = await temporaryDatabase("schema-fingerprint-");
  fixtures.push(fixture);
  const marker = await fixture.database.get(
    "SELECT schema_id, schema_version, schema_hash FROM application_metadata WHERE singleton = 1",
  );
  assert.equal(marker.schema_id, "meshcore-mqtt-broker-postgres-v1");
  assert.equal(Number(marker.schema_version), CURRENT_SCHEMA_VERSION);
  assert.match(marker.schema_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(marker.schema_hash, marker.schema_id);
  const publicMarker = await fixture.database.get(
    "SELECT schema_hash FROM meshcore_public.schema_metadata WHERE singleton = 1",
  );
  assert.equal(publicMarker.schema_hash, marker.schema_hash);
});

test("schema metadata records one PostgreSQL-created database generation time", async () => {
  const fixture = await temporaryDatabase("schema-generation-");
  fixtures.push(fixture);
  const privateMarker = await fixture.database.get(
    "SELECT database_created_at FROM application_metadata WHERE singleton = 1",
  );
  const publicMarker = await fixture.database.get(
    "SELECT database_created_at FROM meshcore_public.schema_metadata WHERE singleton = 1",
  );
  assert.ok(privateMarker.database_created_at instanceof Date);
  assert.ok(publicMarker.database_created_at instanceof Date);
  assert.equal(
    privateMarker.database_created_at.getTime(),
    publicMarker.database_created_at.getTime(),
  );
  const createdAt = privateMarker.database_created_at;
  for (const [seconds, expected] of [
    [1, "1 second"],
    [12, "12 seconds"],
    [60, "1 minute"],
    [300, "5 minutes"],
    [312, "5 minutes 12 seconds"],
    [3_600, "1 hour"],
    [3_840, "1 hour 4 minutes"],
    [8_160, "2 hours 16 minutes"],
    [86_400, "1 day"],
    [90_000, "1 day 1 hour"],
    [277_200, "3 days 5 hours"],
  ]) {
    assert.equal(
      formatDatabaseAge(createdAt, createdAt.getTime() + seconds * 1_000),
      expected,
    );
  }
  assert.equal(
    formatDatabaseAge(createdAt, createdAt.getTime() - 1_000),
    "0 seconds",
  );

  const generation = await fixture.database.getGenerationMetadata();
  assert.equal(generation.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(generation.createdAt.getTime(), createdAt.getTime());
});

test("a corrupted public contract fingerprint refuses the database", async () => {
  const fixture = await temporaryDatabase("schema-mismatch-");
  const sql = new SQL(process.env.POSTGRES_TEST_URL);
  try {
    for (const table of [
      "meshcore_private.application_metadata",
      "meshcore_public.schema_metadata",
    ]) {
      await sql.unsafe(`UPDATE ${table} SET schema_hash = $1`, [
        "0".repeat(64),
      ]);
    }
  } finally {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  }
  await assert.rejects(fixture.reopen(), /fingeravtryck/);
});
