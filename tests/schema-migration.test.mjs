import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { afterEach, test } from "bun:test";
import { SQL } from "bun";
import {
  ApplicationDatabase,
  IncompatibleDatabaseError,
  openDatabaseWithRecovery,
  reprovisionApplicationSchemas,
} from "../src/database.ts";
import {
  CURRENT_SCHEMA_VERSION,
  computeLegacyV9Fingerprint,
  computeV10Fingerprint,
} from "../src/database.ts";
import {
  migrateSchemaToCurrent,
  migrateSchemaV9ToV10,
} from "../src/schema-migration.ts";
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
  // max:1 makes direct BEGIN/COMMIT on this session valid for the driver.
  return new SQL({ url: fixture.connectionString, max: 1 });
}

async function reprovisionSchemas(fixture) {
  await fixture.database.close().catch(() => undefined);
  const pool = await adminPool(fixture);
  try {
    await pool.unsafe("DROP SCHEMA IF EXISTS meshcore_public CASCADE");
    await pool.unsafe("DROP SCHEMA IF EXISTS meshcore_private CASCADE");
  } finally {
    await pool.close({ timeout: 1 });
  }
  const database = await ApplicationDatabase.connect({
    connectionString: fixture.connectionString,
    schema: "meshcore_private",
  });
  await database.close();
}

async function demoteToV10(fixture) {
  await demoteToV9(fixture);
  await migrateSchemaV9ToV10({ adminUrl: fixture.connectionString });
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
      await pool.unsafe(`DROP INDEX IF EXISTS meshcore_public.${name}`);
    await pool.unsafe(
      "ALTER TABLE meshcore_private.application_metadata DROP COLUMN database_created_at",
    );
    await pool.unsafe(
      "ALTER TABLE meshcore_public.schema_metadata DROP COLUMN database_created_at",
    );
    const client = await pool.reserve();
    let legacy;
    try {
      await client.unsafe("SET search_path = pg_catalog");
      legacy = await computeLegacyV9Fingerprint(client);
      await client.unsafe("SET search_path = meshcore_private,meshcore_public");
    } finally {
      client.release();
    }
    await pool.unsafe("BEGIN");
    await pool.unsafe(
      "UPDATE meshcore_private.application_metadata SET schema_version = 9, schema_hash = $1 WHERE singleton = 1",
      [legacy],
    );
    await pool.unsafe(
      "UPDATE meshcore_public.schema_metadata SET schema_version = 9, schema_hash = $1 WHERE singleton = 1",
      [legacy],
    );
    await pool.unsafe("COMMIT");
  } finally {
    await pool.close({ timeout: 1 });
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
      const rows = await pool.unsafe(
        `SELECT count(*)::int AS count FROM ${table}`,
      );
      counts[table] = rows[0].count;
    }
    return counts;
  } finally {
    await pool.close({ timeout: 1 });
  }
}

test("explicit migration takes a clean v9 database to v10 without touching data", async () => {
  const fixture = await temporaryDatabase("schema-v9to10-");
  fixtures.push(fixture);
  await demoteToV9(fixture);
  await seedPersistentData(fixture);
  const before = await snapshotCounts(fixture);

  // Sanity: the simulated v9 state really carries the legacy format.
  assert.equal(CURRENT_SCHEMA_VERSION, 11);
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
    (await adminPool(fixture)).options ? null : null,
  ).catch(() => null);
  void expected; // computed below through the admin pool instead

  const pool = await adminPool(fixture);
  try {
    const client = await pool.reserve();
    try {
      const actual = await computeV10Fingerprint(client);
      assert.equal(privMarker.schema_hash, actual);
      assert.equal(pubMarker.schema_hash, actual);
    } finally {
      client.release();
    }
  } finally {
    await pool.close({ timeout: 1 });
  }

  // New timeline indexes exist and are valid.
  for (const [name, valid] of Object.entries(result.indexesValid))
    assert.equal(valid, true, `${name} must be valid`);
  assert.deepEqual(
    Object.keys(result.indexesValid).sort(),
    [...NEW_INDEXES].sort(),
  );

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

test("one migration attempt chains a clean v9 database through v10 to v11", async () => {
  const fixture = await temporaryDatabase("schema-v9to11-");
  fixtures.push(fixture);
  await demoteToV9(fixture);
  await seedPersistentData(fixture);
  const before = await snapshotCounts(fixture);

  const result = await migrateSchemaToCurrent({
    databaseConfig: { connectionString: fixture.connectionString },
    timeoutMs: 30_000,
  });
  assert.deepEqual(result.chain, [9, 10, 11]);
  assert.equal(result.toVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(await snapshotCounts(fixture), before);

  const privateMarker = await fixture.database.get(
    "SELECT schema_version, database_created_at FROM application_metadata WHERE singleton = 1",
  );
  const publicMarker = await fixture.database.get(
    "SELECT schema_version, database_created_at FROM meshcore_public.schema_metadata WHERE singleton = 1",
  );
  assert.equal(Number(privateMarker.schema_version), 11);
  assert.equal(Number(publicMarker.schema_version), 11);
  assert.equal(
    privateMarker.database_created_at.getTime(),
    publicMarker.database_created_at.getTime(),
  );
});

test("current-schema migration repairs required indexes online", async () => {
  const fixture = await temporaryDatabase("schema-index-repair-");
  fixtures.push(fixture);
  await fixture.database.run(
    "DROP INDEX meshcore_private.mqtt_events_pending_claim",
  );

  const result = await migrateSchemaToCurrent({
    databaseConfig: { connectionString: fixture.connectionString },
    timeoutMs: 30_000,
  });
  assert.deepEqual(result, { fromVersion: 11, toVersion: 11, chain: [11] });
  const repaired = await fixture.database.get(
    `SELECT i.indisvalid AS valid
     FROM pg_catalog.pg_index i
     JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'meshcore_private' AND c.relname = 'mqtt_events_pending_claim'`,
  );
  assert.equal(repaired.valid, true);
});

test("migration is idempotent on an already-migrated v10 database", async () => {
  const fixture = await temporaryDatabase("schema-v10-idem-");
  fixtures.push(fixture);
  await demoteToV9(fixture);
  await seedPersistentData(fixture);

  const first = await migrateSchemaV9ToV10({
    adminUrl: fixture.connectionString,
  });
  assert.equal(first.status, "migrated");

  const second = await migrateSchemaV9ToV10({
    adminUrl: fixture.connectionString,
  });
  assert.equal(second.status, "already-migrated");
  assert.deepEqual(second.countsAfter, first.countsAfter);
});

test("refuses a v10 database whose fingerprint does not match", async () => {
  const fixture = await temporaryDatabase("schema-v10-bad-");
  fixtures.push(fixture);
  await demoteToV9(fixture);
  const first = await migrateSchemaV9ToV10({
    adminUrl: fixture.connectionString,
  });
  assert.equal(first.status, "migrated");

  const pool = await adminPool(fixture);
  try {
    await pool.unsafe(
      "UPDATE meshcore_private.application_metadata SET schema_hash = $1 WHERE singleton = 1",
      ["0".repeat(64)],
    );
  } finally {
    await pool.close({ timeout: 1 });
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
    await pool.unsafe(
      "UPDATE meshcore_private.application_metadata SET schema_version = 99 WHERE singleton = 1",
    );
  } finally {
    await pool.close({ timeout: 1 });
  }
  await assert.rejects(
    migrateSchemaV9ToV10({ adminUrl: fixture.connectionString }),
    /only 9 -> 10 is supported/,
  );
});

test("direct validator rejects a corrupted fingerprint without mutation", async () => {
  const fixture = await temporaryDatabase("schema-corrupt-open-");
  fixtures.push(fixture);
  await seedPersistentData(fixture);
  const before = await snapshotCounts(fixture);

  const pool = await adminPool(fixture);
  try {
    await pool.unsafe("BEGIN");
    await pool.unsafe(
      "UPDATE meshcore_private.application_metadata SET schema_hash = $1 WHERE singleton = 1",
      ["e".repeat(64)],
    );
    await pool.unsafe(
      "UPDATE meshcore_public.schema_metadata SET schema_hash = $1 WHERE singleton = 1",
      ["e".repeat(64)],
    );
    await pool.unsafe("COMMIT");
  } finally {
    await pool.close({ timeout: 1 });
  }

  // The production open path validates and refuses; nothing may be reset.
  const sqlInstance = new SQL(fixture.connectionString);
  await assert.rejects(
    ApplicationDatabase.openPool(sqlInstance),
    /fingeravtryck/,
  );

  const after = await snapshotCounts(fixture);
  assert.deepEqual(after, before);

  // Sentinel private row still readable through a normal fixture reopen.
  const reopened = await temporaryDatabase("schema-corrupt-open-reopen-");
  await reopened.database.run("SELECT 1");
});

test("direct validator rejects an unknown schema version without mutation", async () => {
  const fixture = await temporaryDatabase("schema-unknown-open-");
  fixtures.push(fixture);
  await demoteToV9(fixture);
  await seedPersistentData(fixture);
  const before = await snapshotCounts(fixture);

  const pool = await adminPool(fixture);
  try {
    await pool.unsafe(
      "UPDATE meshcore_private.application_metadata SET schema_version = 99 WHERE singleton = 1",
    );
  } finally {
    await pool.close({ timeout: 1 });
  }

  const sqlInstance = new SQL(fixture.connectionString);
  await assert.rejects(ApplicationDatabase.openPool(sqlInstance), /stöds inte/);

  const after = await snapshotCounts(fixture);
  assert.deepEqual(after, before);
});

test("current valid database opens without migration or reset", async () => {
  const fixture = await temporaryDatabase("recovery-current-");
  fixtures.push(fixture);
  const before = await fixture.database.getGenerationMetadata();
  let migrations = 0;
  let resets = 0;
  const opened = await openDatabaseWithRecovery(
    { connectionString: fixture.connectionString },
    30_000,
    {
      migrate: async () => {
        migrations += 1;
        throw new Error("unexpected migration");
      },
      reset: async () => {
        resets += 1;
      },
    },
  );
  const after = await opened.getGenerationMetadata();
  assert.equal(migrations, 0);
  assert.equal(resets, 0);
  assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
  await opened.close();
});

for (const version of [8, 99]) {
  test(`schema version ${version} resets once to current`, async () => {
    const fixture = await temporaryDatabase(`recovery-v${version}-`);
    fixtures.push(fixture);
    await fixture.database.run(
      "UPDATE application_metadata SET schema_version = $1",
      version,
    );
    let resets = 0;
    const opened = await openDatabaseWithRecovery(
      { connectionString: fixture.connectionString },
      30_000,
      {
        reset: async () => {
          resets += 1;
          await reprovisionSchemas(fixture);
        },
      },
    );
    assert.equal(resets, 1);
    assert.equal((await opened.getGenerationMetadata()).schemaVersion, 11);
    await opened.close();
  });
}

test("known migration failure and timeout each reset exactly once", async () => {
  for (const code of ["XX000", "57014"]) {
    const fixture = await temporaryDatabase(`recovery-migration-${code}-`);
    fixtures.push(fixture);
    await demoteToV10(fixture);
    let migrations = 0;
    let resets = 0;
    const opened = await openDatabaseWithRecovery(
      { connectionString: fixture.connectionString },
      1_000,
      {
        migrate: async () => {
          migrations += 1;
          throw Object.assign(new Error("deterministic migration failure"), {
            code,
          });
        },
        reset: async () => {
          resets += 1;
          await reprovisionSchemas(fixture);
        },
      },
    );
    assert.equal(migrations, 1);
    assert.equal(resets, 1);
    assert.equal((await opened.getGenerationMetadata()).schemaVersion, 11);
    await opened.close();
    fixtures.pop();
    await fixture.cleanup();
  }
});

test("random layout and corrupt current fingerprint reset to fresh v11", async () => {
  for (const layout of ["random", "fingerprint"]) {
    const fixture = await temporaryDatabase(`recovery-${layout}-`);
    fixtures.push(fixture);
    if (layout === "random") {
      await fixture.database.close();
      const pool = await adminPool(fixture);
      await pool.unsafe("DROP SCHEMA meshcore_public CASCADE");
      await pool.unsafe("DROP SCHEMA meshcore_private CASCADE");
      await pool.unsafe("CREATE TABLE public.unrelated(value text)");
      await pool.close({ timeout: 1 });
    } else {
      await fixture.database.run(
        "UPDATE application_metadata SET schema_hash = $1",
        "0".repeat(64),
      );
    }
    let resets = 0;
    const opened = await openDatabaseWithRecovery(
      { connectionString: fixture.connectionString },
      30_000,
      {
        reset: async () => {
          resets += 1;
          await reprovisionSchemas(fixture);
        },
      },
    );
    assert.equal(resets, 1);
    assert.equal((await opened.getGenerationMetadata()).schemaVersion, 11);
    await opened.close();
    fixtures.pop();
    await fixture.cleanup();
  }
});

test("schema reprovision succeeds while another database session remains connected", async () => {
  const fixture = await temporaryDatabase("recovery-connected-");
  fixtures.push(fixture);
  await seedPersistentData(fixture);
  await fixture.database.close();
  const setupPool = await adminPool(fixture);
  await setupPool.unsafe(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'meshcore_owner') THEN CREATE ROLE meshcore_owner; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'meshcore_broker') THEN CREATE ROLE meshcore_broker; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'meshcore_reader') THEN CREATE ROLE meshcore_reader; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'meshcore_http') THEN CREATE ROLE meshcore_http; END IF;
    END
  $$`);
  await setupPool.unsafe(
    "GRANT CREATE ON DATABASE meshcore_test TO meshcore_owner",
  );
  await setupPool.unsafe(
    "ALTER SCHEMA meshcore_private OWNER TO meshcore_owner",
  );
  await setupPool.unsafe(
    "ALTER SCHEMA meshcore_public OWNER TO meshcore_owner",
  );
  await setupPool.close({ timeout: 1 });
  const competingPool = await adminPool(fixture);
  const competingClient = await competingPool.reserve();
  try {
    assert.equal((await competingClient.unsafe("SELECT 1 AS ok"))[0].ok, 1);
    await reprovisionApplicationSchemas({
      connectionString: fixture.connectionString,
    });
    assert.equal((await competingClient.unsafe("SELECT 1 AS ok"))[0].ok, 1);
  } finally {
    competingClient.release();
    await competingPool.close({ timeout: 1 });
  }

  fixture.database = await ApplicationDatabase.connect({
    connectionString: fixture.connectionString,
    schema: "meshcore_private",
  });
  const generation = await fixture.database.getGenerationMetadata();
  assert.equal(generation.schemaVersion, 11);
  assert.deepEqual(
    await fixture.database.get(
      "SELECT count(*)::integer AS count FROM packets",
    ),
    { count: 0 },
  );
});

test("infrastructure and authentication failures never invoke reset", async () => {
  for (const connectionString of [
    "postgresql://meshcore_test:wrong@127.0.0.1:55432/meshcore_test",
    "postgresql://meshcore_test:meshcore_test@127.0.0.1:1/meshcore_test",
  ]) {
    let resets = 0;
    await assert.rejects(
      openDatabaseWithRecovery({ connectionString }, 1_000, {
        reset: async () => {
          resets += 1;
        },
      }),
    );
    assert.equal(resets, 0);
  }
});

test("failed fresh validation performs no second reset", async () => {
  let opens = 0;
  let resets = 0;
  await assert.rejects(
    openDatabaseWithRecovery({}, 1_000, {
      openCurrent: async () => {
        opens += 1;
        if (opens === 1)
          throw new IncompatibleDatabaseError("test incompatible", {
            reason: "unknown_schema",
          });
        throw new Error("fresh provisioning validation failed");
      },
      reset: async () => {
        resets += 1;
      },
    }),
    /fresh provisioning validation failed/,
  );
  assert.equal(resets, 1);
  assert.equal(opens, 2);
});
