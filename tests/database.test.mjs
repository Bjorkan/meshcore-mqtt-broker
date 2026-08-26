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
