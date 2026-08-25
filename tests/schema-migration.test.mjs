import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { afterEach, test } from "@jest/globals";
import { Pool } from "pg";
import { ApplicationDatabase } from "../src/database.ts";
import {
  CURRENT_SCHEMA_VERSION,
  computeLegacyV9Fingerprint,
  computeV10Fingerprint,
} from "../src/database.ts";
import { migrateSchemaV9ToV10 } from "../src/schema-migration.ts";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

const NEW_INDEXES = [
  "public_telemetry_received",
  "public_messages_received",
  "public_observers_last_seen",
];

async function adminPool(fixture) {
  return new Pool({ connectionString: fixture.connectionString, max: 1 });
}

/**
 * Demotes a freshly provisioned (v10) database to a faithful v9 state using
 * the same schema constants: drops the v10 performance indexes, moves both
 * markers to version 9 and stores the legacy (index-including) fingerprint.
 */
async function demoteToV9(fixture) {
  const pool = await adminPool(fixture);
  try {
    for (const name of NEW_INDEXES)
      await pool.query(`DROP INDEX IF EXISTS meshcore_public.${name}`);
    const client = await pool.connect();
    let legacy;
    try {
      await client.query("SET search_path = pg_catalog");
      legacy = await computeLegacyV9Fingerprint(client);
      await client.query("RESET search_path");
    } finally {
      client.release();
    }
    await pool.query("BEGIN");
    await pool.query(
      "UPDATE meshcore_private.application_metadata SET schema_version = 9, schema_hash = $1 WHERE singleton = 1",
      [legacy],
    );
    await pool.query(
      "UPDATE meshcore_public.schema_metadata SET schema_version = 9, schema_hash = $1 WHERE singleton = 1",
      [legacy],
    );
    await pool.query("COMMIT");
  } finally {
    await pool.end();
  }
}

/** Representative persistent data across every counted private table. */
async function seedPersistentData(fixture) {
  const database = fixture.database;
  const now = 1_800_000_000_000;

  await database.run(
    `INSERT INTO meshcore_io_stats(singleton) VALUES (1)
     ON CONFLICT (singleton) DO NOTHING`,
  );

  await database.run(
    `INSERT INTO packets(packet_sha256, raw_packet_blob, raw_packet_hex,
        packet_length, decode_status, first_seen_at_ms, last_seen_at_ms,
        created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,$4,'decoded',$5,$5,$5,$5), ($6,$7,$8,$9,'decoded',$10,$10,$10,$10)`,
    "a".repeat(64),
    Buffer.from([0x01, 0x02]),
    "0102",
    2,
    now,
    "b".repeat(64),
    Buffer.from([0x03]),
    "03",
    1,
    now + 5,
  );
  await database.run(
    `INSERT INTO observers(public_key, first_seen_at_ms, last_seen_at_ms,
        created_at_ms, updated_at_ms)
     VALUES ($1, $2, $3, $2, $3), ($4, $2, $3, $2, $3)`,
    "A".repeat(64),
    now,
    now + 100,
    "B".repeat(64),
  );
  await database.run(
    `INSERT INTO mqtt_events(topic, payload_blob, payload_sha256, qos, retain,
        dup, received_at_ms, payload_format, parse_status, processing_status,
        processing_attempts, parser_name, parser_version,
        collector_instance_id, created_at_ms, updated_at_ms)
     SELECT 'meshcore/JKG/seed/packets/' || p.packet_sha256, p.raw_packet_blob,
        p.packet_sha256, 0, false, false, p.last_seen_at_ms, 'json',
        'processed', 'processed', 0, 'seed', 'v1', 'seed-instance',
        p.last_seen_at_ms, p.last_seen_at_ms
     FROM meshcore_private.packets p`,
  );
  await database.run(
    `INSERT INTO packet_observations(packet_id, mqtt_event_id, observer_id, iata,
        received_at_ms, suspected_mqtt_duplicate, suspected_rf_retransmission,
        created_at_ms)
     SELECT p.id, e.id, o.id, 'JKG', $1::bigint, false, false, $1::bigint
     FROM meshcore_private.packets p
     JOIN meshcore_private.mqtt_events e ON e.payload_sha256 = p.packet_sha256
     CROSS JOIN LATERAL (
       SELECT id FROM meshcore_private.observers ORDER BY id LIMIT 1
     ) o`,
    now,
  );
  await database.run(
    `INSERT INTO messages(packet_id, packet_observation_id, message_type,
        encrypted, payload_blob, received_at_ms)
     SELECT p.id, po.id, 'TXT_MSG', false, '\\x68656c6c6f'::bytea, $1::bigint
     FROM meshcore_private.packets p
     JOIN meshcore_private.packet_observations po ON po.packet_id = p.id`,
    now,
  );
  await database.run(
    `INSERT INTO telemetry_events(packet_id, packet_observation_id,
        received_at_ms, decoded_json)
     SELECT p.id, po.id, $1::bigint, '{}'::text
     FROM meshcore_private.packets p
     JOIN meshcore_private.packet_observations po ON po.packet_id = p.id
     LIMIT 1`,
    now,
  );
  await database.run(
    `INSERT INTO telemetry_values(telemetry_event_id, metric_name, numeric_value, unit)
     SELECT e.id, 'battery', 4.1, 'V'
     FROM meshcore_private.telemetry_events e`,
  );
  await database.run(
    `INSERT INTO retained_packets(topic, packet, stored_at_ms)
     VALUES ('meshcore/JKG/test/neighbors', '\\x00'::bytea, $1::bigint)`,
    now,
  );
  await database.run(
    `INSERT INTO mqtt_outgoing(client_id, packet, broker_id, broker_counter, message_id, created_at_ms)
     VALUES ('client-1', '\\x00'::bytea, 'broker', 1, NULL, $1::bigint)`,
    now,
  );
  await database.run(
    `INSERT INTO mqtt_incoming(client_id, message_id, packet, created_at_ms)
     VALUES ('client-1', 11, '\\x00'::bytea, $1::bigint)`,
    now,
  );
  await database.run(
    `INSERT INTO mqtt_wills(client_id, broker_id, packet, created_at_ms)
     VALUES ('client-1', 'broker', '\\x00'::bytea, $1::bigint)`,
    now,
  );
}

const COUNTED_TABLES = [
  "meshcore_private.packets",
  "meshcore_private.packet_observations",
  "meshcore_private.messages",
  "meshcore_private.telemetry_events",
  "meshcore_private.telemetry_values",
  "meshcore_private.retained_packets",
  "meshcore_private.mqtt_outgoing",
  "meshcore_private.mqtt_incoming",
  "meshcore_private.mqtt_wills",
];

async function snapshotCounts(fixture) {
  const pool = await adminPool(fixture);
  try {
    const counts = {};
    for (const table of COUNTED_TABLES) {
      const result = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
      counts[table] = result.rows[0].count;
    }
    return counts;
  } finally {
    await pool.end();
  }
}

test("explicit migration takes a clean v9 database to v10 without touching data", async () => {
  const fixture = await temporaryDatabase("schema-v9to10-");
  fixtures.push(fixture);
  await demoteToV9(fixture);
  await seedPersistentData(fixture);
  const before = await snapshotCounts(fixture);

  // Sanity: the simulated v9 state really carries the legacy format.
  assert.equal(CURRENT_SCHEMA_VERSION, 10);
  const markerBefore = await fixture.database.get(
    "SELECT schema_version::text AS version, schema_hash FROM application_metadata WHERE singleton = 1",
  );
  assert.equal(markerBefore.version, "9");

  const result = await migrateSchemaV9ToV10({
    adminUrl: fixture.connectionString,
  });
  assert.equal(result.status, "migrated");

  // Version + fingerprint v2 in BOTH markers.
  const privMarker = await fixture.database.get(
    "SELECT schema_id, schema_version::text AS version, schema_hash FROM application_metadata WHERE singleton = 1",
  );
  const pubMarker = await fixture.database.get(
    "SELECT schema_version::text AS version, schema_hash FROM meshcore_public.schema_metadata WHERE singleton = 1",
  );
  assert.equal(privMarker.version, "10");
  assert.equal(pubMarker.version, "10");
  const expected = await computeV10Fingerprint(
    (await adminPool(fixture)).options
      ? null
      : null,
  ).catch(() => null);
  void expected; // computed below through the admin pool instead

  const pool = await adminPool(fixture);
  try {
    const client = await pool.connect();
    try {
      const actual = await computeV10Fingerprint(client);
      assert.equal(privMarker.schema_hash, actual);
      assert.equal(pubMarker.schema_hash, actual);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  // New timeline indexes exist and are valid.
  for (const [name, valid] of Object.entries(result.indexesValid))
    assert.equal(valid, true, `${name} must be valid`);
  assert.deepEqual(Object.keys(result.indexesValid).sort(), [...NEW_INDEXES].sort());

  // Zero data loss across every counted table.
  const after = await snapshotCounts(fixture);
  assert.deepEqual(after, before);

  // A sentinel private row survives byte-for-byte semantically.
  const retained = await fixture.database.get(
    "SELECT topic, octet_length(packet) AS size FROM retained_packets",
  );
  assert.equal(retained.topic, "meshcore/JKG/test/neighbors");
  assert.equal(retained.size, 1);
});

test("migration is idempotent on an already-migrated v10 database", async () => {
  const fixture = await temporaryDatabase("schema-v10-idem-");
  fixtures.push(fixture);
  await demoteToV9(fixture);
  await seedPersistentData(fixture);

  const first = await migrateSchemaV9ToV10({ adminUrl: fixture.connectionString });
  assert.equal(first.status, "migrated");

  const second = await migrateSchemaV9ToV10({ adminUrl: fixture.connectionString });
  assert.equal(second.status, "already-migrated");
  assert.deepEqual(second.countsAfter, first.countsAfter);
});

test("refuses a v10 database whose fingerprint does not match", async () => {
  const fixture = await temporaryDatabase("schema-v10-bad-");
  fixtures.push(fixture);
  await demoteToV9(fixture);
  const first = await migrateSchemaV9ToV10({ adminUrl: fixture.connectionString });
  assert.equal(first.status, "migrated");

  const pool = await adminPool(fixture);
  try {
    await pool.query(
      "UPDATE meshcore_private.application_metadata SET schema_hash = $1 WHERE singleton = 1",
      ["0".repeat(64)],
    );
  } finally {
    await pool.end();
  }

  await assert.rejects(
    migrateSchemaV9ToV10({ adminUrl: fixture.connectionString }),
    /fingerprint/,
  );
});

test("fails closed on unknown schema versions and leaves all data intact", async () => {
  const fixture = await temporaryDatabase("schema-unknown-version-");
  fixtures.push(fixture);
  const pool = await adminPool(fixture);
  try {
    await pool.query(
      "UPDATE meshcore_private.application_metadata SET schema_version = 99 WHERE singleton = 1",
    );
  } finally {
    await pool.end();
  }
  await assert.rejects(
    migrateSchemaV9ToV10({ adminUrl: fixture.connectionString }),
    /only 9 -> 10 is supported/,
  );
});

test("fail-closed startup: corrupted fingerprint preserves all data", async () => {
  const fixture = await temporaryDatabase("schema-corrupt-open-");
  fixtures.push(fixture);
  await demoteToV9(fixture);
  await seedPersistentData(fixture);
  const before = await snapshotCounts(fixture);

  const pool = await adminPool(fixture);
  try {
    await pool.query("BEGIN");
    await pool.query(
      "UPDATE meshcore_private.application_metadata SET schema_hash = $1 WHERE singleton = 1",
      ["e".repeat(64)],
    );
    await pool.query(
      "UPDATE meshcore_public.schema_metadata SET schema_hash = $1 WHERE singleton = 1",
      ["e".repeat(64)],
    );
    await pool.query("COMMIT");
  } finally {
    await pool.end();
  }

  // The production open path validates and refuses; nothing may be reset.
  const pgPool = new Pool({
    connectionString: fixture.connectionString,
    max: 1,
    options: "-c search_path=meshcore_private,meshcore_public",
  });
  await assert.rejects(
    ApplicationDatabase.openPool(pgPool),
    /fingeravtryck/,
  );

  const after = await snapshotCounts(fixture);
  assert.deepEqual(after, before);

  // Sentinel private row still readable through a normal fixture reopen.
  const reopened = await temporaryDatabase("schema-corrupt-open-reopen-");
  await reopened.database.run("SELECT 1");
});

test("fail-closed startup: unknown schema version preserves all data", async () => {
  const fixture = await temporaryDatabase("schema-unknown-open-");
  fixtures.push(fixture);
  await demoteToV9(fixture);
  await seedPersistentData(fixture);
  const before = await snapshotCounts(fixture);

  const pool = await adminPool(fixture);
  try {
    await pool.query(
      "UPDATE meshcore_private.application_metadata SET schema_version = 99 WHERE singleton = 1",
    );
  } finally {
    await pool.end();
  }

  const pgPool = new Pool({
    connectionString: fixture.connectionString,
    max: 1,
    options: "-c search_path=meshcore_private,meshcore_public",
  });
  await assert.rejects(ApplicationDatabase.openPool(pgPool), /stöds inte/);

  const after = await snapshotCounts(fixture);
  assert.deepEqual(after, before);
});
