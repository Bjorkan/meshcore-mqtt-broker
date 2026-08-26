import pg from "pg";
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_ID,
  computeLegacyV9Fingerprint,
  computeV10Fingerprint,
  computeV11Fingerprint,
} from "./database.js";

/**
 * Explicit, idempotent, fail-closed migration from schema version 9 to
 * version 10.
 *
 * v10 is additive only:
 *   - three performance indexes built with CREATE INDEX CONCURRENTLY so
 *     ordinary broker writes are not blocked by a full-table index build
 *   - metadata markers move to version 10 with fingerprint format v2
 *     (ordinary indexes excluded from the semantic public contract)
 *
 * The migration NEVER drops tables, truncates data or deletes rows. It
 * refuses to run unless the stored legacy v9 fingerprint matches exactly;
 * a corrupt v9 fingerprint stops the migration instead of being "fixed".
 */

const MIGRATION_LOCK_KEY = 867_530_910; // hashtext-equivalent constant, documented
export const MIGRATION_SOURCE_VERSIONS = [9, 10] as const;
export const MIGRATION_REGISTRY = new Map<number, number>([
  [9, 10],
  [10, 11],
]);
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
] as const;

export const V10_INDEX_STATEMENTS = [
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS public_telemetry_received ON meshcore_public.telemetry (received_at_ms DESC, id DESC)",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS public_messages_received ON meshcore_public.messages (received_at_ms DESC, id DESC)",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS public_observers_last_seen ON meshcore_public.observers (last_seen_at_ms DESC, public_key)",
] as const;

export type MigrationResult = {
  status: "migrated" | "already-migrated";
  countsBefore: Record<string, string>;
  countsAfter: Record<string, string>;
  indexesValid: Record<string, boolean>;
};

type Markers = {
  privateMarker: {
    schema_id: string;
    schema_version: string;
    schema_hash: string;
  };
  publicMarker: {
    schema_id: string;
    schema_version: string;
    schema_hash: string;
  };
};

async function readMarkers(client: pg.PoolClient): Promise<Markers> {
  const priv = await client.query<{
    schema_id: string;
    schema_version: string;
    schema_hash: string;
  }>(
    "SELECT schema_id, schema_version::text AS schema_version, schema_hash FROM meshcore_private.application_metadata WHERE singleton = 1",
  );
  const pub = await client.query<{
    schema_id: string;
    schema_version: string;
    schema_hash: string;
  }>(
    "SELECT schema_id, schema_version::text AS schema_version, schema_hash FROM meshcore_public.schema_metadata WHERE singleton = 1",
  );
  return {
    privateMarker: priv.rows[0],
    publicMarker: pub.rows[0],
  };
}

async function tableCounts(
  client: pg.PoolClient,
): Promise<Record<string, string>> {
  const counts: Record<string, string> = {};
  for (const table of COUNTED_TABLES) {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table}`,
    );
    counts[table] = result.rows[0].count;
  }
  return counts;
}

async function newIndexValidity(
  client: pg.PoolClient,
): Promise<Record<string, boolean>> {
  const result = await client.query<{ name: string; valid: boolean }>(
    `SELECT idx.relname AS name, i.indisvalid AS valid
     FROM pg_catalog.pg_index i
     JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
     JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid
     JOIN pg_catalog.pg_namespace ns ON ns.oid = tbl.relnamespace
     WHERE ns.nspname = 'meshcore_public'
       AND idx.relname = ANY($1::text[])`,
    [
      [
        "public_telemetry_received",
        "public_messages_received",
        "public_observers_last_seen",
      ],
    ],
  );
  const out: Record<string, boolean> = {};
  for (const name of [
    "public_telemetry_received",
    "public_messages_received",
    "public_observers_last_seen",
  ])
    out[name] = result.rows.find((row) => row.name === name)?.valid === true;
  return out;
}

function fail(message: string): never {
  throw new Error(`[schema-migration v10] ${message}`);
}

async function assumeOwnerRole(client: pg.PoolClient): Promise<void> {
  const result = await client.query<{ allowed: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meshcore_owner' AND pg_has_role(current_user, oid, 'MEMBER')) AS allowed",
  );
  if (result.rows[0]?.allowed) await client.query("SET ROLE meshcore_owner");
}

async function applyDeadline(
  client: pg.PoolClient,
  deadlineMs: number,
): Promise<void> {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0)
    throw Object.assign(new Error("schema migration deadline exceeded"), {
      code: "57014",
    });
  await client.query("SELECT set_config('statement_timeout', $1, false)", [
    String(remainingMs),
  ]);
}

async function migrateV10ToV11(
  client: pg.PoolClient,
  deadlineMs: number,
): Promise<void> {
  await applyDeadline(client, deadlineMs);
  const before = await readMarkers(client);
  if (
    Number(before.privateMarker.schema_version) !== 10 ||
    Number(before.publicMarker.schema_version) !== 10
  )
    fail("v10 -> v11 requires matching v10 markers");
  const v10 = await computeV10Fingerprint(client);
  if (
    before.privateMarker.schema_hash !== v10 ||
    before.publicMarker.schema_hash !== v10
  )
    fail("v10 fingerprint does not match before v11 migration");

  await client.query("BEGIN");
  try {
    await client.query(
      "ALTER TABLE meshcore_private.application_metadata ADD COLUMN database_created_at timestamptz",
    );
    await applyDeadline(client, deadlineMs);
    await client.query(
      "ALTER TABLE meshcore_public.schema_metadata ADD COLUMN database_created_at timestamptz",
    );
    const created = await client.query<{ created_at: Date }>(
      "SELECT CURRENT_TIMESTAMP AS created_at",
    );
    const createdAt = created.rows[0].created_at;
    await client.query(
      "UPDATE meshcore_private.application_metadata SET database_created_at = $1",
      [createdAt],
    );
    await client.query(
      "UPDATE meshcore_public.schema_metadata SET database_created_at = $1",
      [createdAt],
    );
    await client.query(
      "ALTER TABLE meshcore_private.application_metadata ALTER COLUMN database_created_at SET DEFAULT now(), ALTER COLUMN database_created_at SET NOT NULL",
    );
    await client.query(
      "ALTER TABLE meshcore_public.schema_metadata ALTER COLUMN database_created_at SET DEFAULT now(), ALTER COLUMN database_created_at SET NOT NULL",
    );
    const v11 = await computeV11Fingerprint(client);
    await client.query(
      "UPDATE meshcore_private.application_metadata SET schema_version = $1, schema_hash = $2 WHERE singleton = 1",
      [CURRENT_SCHEMA_VERSION, v11],
    );
    await client.query(
      "UPDATE meshcore_public.schema_metadata SET schema_version = $1, schema_hash = $2 WHERE singleton = 1",
      [CURRENT_SCHEMA_VERSION, v11],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** Runs the complete known migration chain once under one overall deadline. */
export async function migrateSchemaToCurrent(options: {
  poolConfig: pg.PoolConfig;
  timeoutMs: number;
}): Promise<{ fromVersion: number; toVersion: number; chain: number[] }> {
  const pool = new pg.Pool({
    ...options.poolConfig,
    max: 2,
    query_timeout: options.timeoutMs,
  });
  try {
    const lockClient = await pool.connect();
    const workClient = await pool.connect();
    try {
      const deadlineMs = Date.now() + options.timeoutMs;
      await applyDeadline(lockClient, deadlineMs);
      await applyDeadline(workClient, deadlineMs);
      await lockClient.query("SELECT pg_advisory_lock($1)", [
        MIGRATION_LOCK_KEY,
      ]);
      await assumeOwnerRole(lockClient);
      await assumeOwnerRole(workClient);
      const initial = await readMarkers(workClient);
      const fromVersion = Number(initial.privateMarker.schema_version);
      let version = fromVersion;
      const chain = [version];

      if (version === 9) {
        const v9 = await computeLegacyV9Fingerprint(workClient);
        if (
          initial.privateMarker.schema_id !== SCHEMA_ID ||
          initial.publicMarker.schema_id !== SCHEMA_ID ||
          initial.privateMarker.schema_hash !== v9 ||
          initial.publicMarker.schema_hash !== v9
        )
          fail("v9 fingerprint does not match before migration");
        for (const statement of V10_INDEX_STATEMENTS) {
          await applyDeadline(lockClient, deadlineMs);
          await lockClient.query(statement);
        }
        await applyDeadline(workClient, deadlineMs);
        const v10 = await computeV10Fingerprint(workClient);
        await workClient.query("BEGIN");
        try {
          await workClient.query(
            "UPDATE meshcore_private.application_metadata SET schema_version = 10, schema_hash = $1 WHERE singleton = 1",
            [v10],
          );
          await workClient.query(
            "UPDATE meshcore_public.schema_metadata SET schema_version = 10, schema_hash = $1 WHERE singleton = 1",
            [v10],
          );
          await workClient.query("COMMIT");
        } catch (error) {
          await workClient.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
        version = 10;
        chain.push(version);
      }
      if (version === 10) {
        await migrateV10ToV11(workClient, deadlineMs);
        version = CURRENT_SCHEMA_VERSION;
        chain.push(version);
      }
      if (version !== CURRENT_SCHEMA_VERSION)
        fail(`unsupported source schema version ${version}`);
      return { fromVersion, toVersion: version, chain };
    } finally {
      await lockClient
        .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
        .catch(() => undefined);
      workClient.release();
      lockClient.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * Emits the exact SQL an operator can apply manually with superuser psql
 * (metadata hash included). Read-only against the target database.
 */
export async function emitMigrationSql(adminUrl: string): Promise<string> {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const markers = await readMarkers(client);
      if (
        markers.privateMarker.schema_id !== SCHEMA_ID ||
        Number(markers.privateMarker.schema_version) !== 9
      )
        return `-- No-op: expected schema v9 for ${SCHEMA_ID}, found v${markers.privateMarker.schema_version}`;
      const actualV9 = await computeLegacyV9Fingerprint(client);
      if (actualV9 !== markers.privateMarker.schema_hash)
        return `-- REFUSING: stored v9 fingerprint does not match recomputation\\nstored:     ${markers.privateMarker.schema_hash}\\nrecomputed: ${actualV9}`;
      const v10 = await computeV10Fingerprint(client);
      return [
        ...V10_INDEX_STATEMENTS.map((statement) => `${statement};`),
        `BEGIN;`,
        `UPDATE meshcore_private.application_metadata SET schema_version = 10, schema_hash = '${v10}' WHERE singleton = 1;`,
        `UPDATE meshcore_public.schema_metadata SET schema_version = 10, schema_hash = '${v10}' WHERE singleton = 1;`,
        `COMMIT;`,
      ].join("\\n");
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/** Read-only verification of a migrated (v10) database. */
export async function verifySchemaV10(
  adminUrl: string,
): Promise<{ ok: true; indexesValid: Record<string, boolean> }> {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const markers = await readMarkers(client);
      if (
        Number(markers.privateMarker.schema_version) !== 10 ||
        Number(markers.publicMarker.schema_version) !== 10
      )
        fail("markers are not at version 10");
      const actual = await computeV10Fingerprint(client);
      if (
        markers.privateMarker.schema_hash !== actual ||
        markers.publicMarker.schema_hash !== actual
      )
        fail("stored v10 fingerprint does not match recomputation");
      const indexesValid = await newIndexValidity(client);
      for (const [name, valid] of Object.entries(indexesValid))
        if (!valid) fail(`index ${name} is missing or invalid`);
      return { ok: true, indexesValid };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/** Executes the additive v9 -> v10 migration. Idempotent and fail-closed. */
export async function migrateSchemaV9ToV10(options: {
  adminUrl: string;
}): Promise<MigrationResult> {
  const pool = new pg.Pool({
    connectionString: options.adminUrl,
    max: 2,
  });
  try {
    // Dedicated session holds the advisory lock for the whole run while the
    // CONCURRENTLY builds run outside any transaction on that same session.
    const lockClient = await pool.connect();
    let workClient: pg.PoolClient;
    try {
      await lockClient.query("SELECT pg_advisory_lock($1)", [
        MIGRATION_LOCK_KEY,
      ]);
      workClient = await pool.connect();
    } catch (error) {
      lockClient.release();
      throw error;
    }
    try {
      const countsBefore = await tableCounts(workClient);
      const markers = await readMarkers(workClient);
      if (!markers.privateMarker || !markers.publicMarker)
        fail("application metadata markers are missing");
      if (
        markers.privateMarker.schema_id !== SCHEMA_ID ||
        markers.publicMarker.schema_id !== SCHEMA_ID
      )
        fail(`schema-id mismatch: expected ${SCHEMA_ID}`);
      const version = Number(markers.privateMarker.schema_version);

      if (version === 10) {
        const actual = await computeV10Fingerprint(workClient);
        if (
          markers.privateMarker.schema_hash !== actual ||
          markers.publicMarker.schema_hash !== actual
        )
          fail(
            "database claims v10 but the stored fingerprint does not match recomputation; refusing to touch it",
          );
        const indexesValid = await newIndexValidity(workClient);
        for (const [name, valid] of Object.entries(indexesValid))
          if (!valid) fail(`index ${name} is missing or invalid`);
        return {
          status: "already-migrated",
          countsBefore,
          countsAfter: countsBefore,
          indexesValid,
        };
      }

      if (version !== 9)
        fail(
          `unsupported source schema version ${version}; only 9 -> 10 is supported`,
        );

      // Validate the REAL v9 contract before changing anything.
      const actualV9 = await computeLegacyV9Fingerprint(workClient);
      if (
        markers.privateMarker.schema_hash !== actualV9 ||
        markers.publicMarker.schema_hash !== actualV9
      )
        fail(
          "stored v9 fingerprint does not match recomputation; the database is not a clean v9 state. Stopping instead of guessing.",
        );

      // Additive phase: concurrent index builds, outside any transaction.
      for (const statement of V10_INDEX_STATEMENTS)
        await lockClient.query(statement);
      const indexesValid = await newIndexValidity(workClient);
      for (const [name, valid] of Object.entries(indexesValid))
        if (!valid) fail(`index ${name} was created but is not valid`);

      // Metadata phase: one short transaction moving both markers to v10.
      const v10 = await computeV10Fingerprint(workClient);
      await workClient.query("BEGIN");
      await workClient.query(
        "UPDATE meshcore_private.application_metadata SET schema_version = 10, schema_hash = $1 WHERE singleton = 1",
        [v10],
      );
      await workClient.query(
        "UPDATE meshcore_public.schema_metadata SET schema_version = 10, schema_hash = $1 WHERE singleton = 1",
        [v10],
      );
      await workClient.query("COMMIT");

      // Verify markers after update.
      const after = await readMarkers(workClient);
      if (
        Number(after.privateMarker.schema_version) !== 10 ||
        Number(after.publicMarker.schema_version) !== 10 ||
        after.privateMarker.schema_hash !== v10 ||
        after.publicMarker.schema_hash !== v10
      )
        fail("marker verification failed after update");

      const countsAfter = await tableCounts(workClient);
      for (const table of COUNTED_TABLES)
        if (countsAfter[table] !== countsBefore[table])
          fail(
            `row count changed for ${table}: ${countsBefore[table]} -> ${countsAfter[table]}`,
          );

      return { status: "migrated", countsBefore, countsAfter, indexesValid };
    } finally {
      workClient.release();
      await lockClient.query("SELECT pg_advisory_unlock($1)", [
        MIGRATION_LOCK_KEY,
      ]);
      lockClient.release();
    }
  } finally {
    await pool.end();
  }
}
