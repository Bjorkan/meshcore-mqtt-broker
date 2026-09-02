import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_ID,
  assumeOwnerRoleIfMember,
  type BrokerSession,
  computeLegacyV9Fingerprint,
  computeV10Fingerprint,
  computeV11Fingerprint,
  computeV12Fingerprint,
  createSqlInstance,
  type DatabaseOptions,
  execSql,
  REQUIRED_OPERATIONAL_INDEXES,
  reserveSession,
  TIMESCALE_HYPERTABLES,
  PUBLIC_OBSERVER_METRICS_VIEW_SQL,
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
export const MIGRATION_SOURCE_VERSIONS = [9, 10, 11] as const;
export const MIGRATION_REGISTRY = new Map<number, number>([
  [9, 10],
  [10, 11],
  [11, 12],
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

/** Session-scoped reserved Bun.SQL connection used for migration work. */
type MigrationSession = {
  unsafe(
    text: string,
    parameters?: unknown[],
  ): Promise<Record<string, unknown>[]>;
};

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

async function readMarkers(client: MigrationSession): Promise<Markers> {
  const priv = await execSql(
    client,
    "SELECT schema_id, schema_version::text AS schema_version, schema_hash FROM meshcore_private.application_metadata WHERE singleton = 1",
  );
  const pub = await execSql(
    client,
    "SELECT schema_id, schema_version::text AS schema_version, schema_hash FROM meshcore_public.schema_metadata WHERE singleton = 1",
  );
  return {
    privateMarker: priv[0] as unknown as Markers["privateMarker"],
    publicMarker: pub[0] as unknown as Markers["publicMarker"],
  };
}

async function tableCounts(
  client: MigrationSession,
): Promise<Record<string, string>> {
  const counts: Record<string, string> = {};
  for (const table of COUNTED_TABLES) {
    const rows = await execSql(
      client,
      `SELECT count(*)::text AS count FROM ${table}`,
    );
    counts[table] = String((rows[0] as { count: string }).count);
  }
  return counts;
}

async function newIndexValidity(
  client: MigrationSession,
): Promise<Record<string, boolean>> {
  const result = await execSql(
    client,
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
  const validRows = result as unknown as Array<{
    name: string;
    valid: boolean;
  }>;
  const out: Record<string, boolean> = {};
  for (const name of [
    "public_telemetry_received",
    "public_messages_received",
    "public_observers_last_seen",
  ])
    out[name] = validRows.find((row) => row.name === name)?.valid === true;
  return out;
}

function fail(message: string): never {
  throw new Error(`[schema-migration] ${message}`);
}

const assumeOwnerRole = assumeOwnerRoleIfMember;

async function applyDeadline(
  client: MigrationSession,
  deadlineMs: number,
): Promise<void> {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0)
    throw Object.assign(new Error("schema migration deadline exceeded"), {
      code: "57014",
    });
  await execSql(client, "SELECT set_config('statement_timeout', $1, false)", [
    String(remainingMs),
  ]);
}

async function ensureTimescaleLayout(
  client: MigrationSession,
  deadlineMs: number,
): Promise<void> {
  for (const table of TIMESCALE_HYPERTABLES) {
    const existing = await execSql(
      client,
      `SELECT EXISTS (
         SELECT 1 FROM timescaledb_information.hypertables
         WHERE hypertable_schema = $1 AND hypertable_name = $2
       ) AS found`,
      [table.schema, table.table],
    );
    if ((existing[0] as { found?: boolean } | undefined)?.found) {
      const dimensions = (await execSql(
        client,
        `SELECT column_name, integer_interval::text AS integer_interval
         FROM timescaledb_information.dimensions
         WHERE hypertable_schema = $1 AND hypertable_name = $2
         ORDER BY dimension_number`,
        [table.schema, table.table],
      )) as Array<{ column_name: string; integer_interval: string | null }>;
      if (
        dimensions.length !== 1 ||
        dimensions[0]?.column_name !== table.timeColumn ||
        Number(dimensions[0]?.integer_interval) !== table.chunkIntervalMs
      )
        fail(
          `${table.schema}.${table.table} is already a hypertable with an unexpected partition layout`,
        );
      await execSql(
        client,
        `CREATE INDEX IF NOT EXISTS observer_metrics_observer_metric_received
         ON meshcore_private.observer_metrics(observer_id, metric_name, received_at_ms DESC, id DESC)`,
      );
      continue;
    }

    await applyDeadline(client, deadlineMs);
    await execSql(client, "BEGIN");
    try {
      await execSql(
        client,
        `ALTER TABLE meshcore_private.observer_metrics
           DROP CONSTRAINT IF EXISTS observer_metrics_pkey,
           DROP CONSTRAINT IF EXISTS observer_metrics_mqtt_event_id_metric_name_key,
           DROP CONSTRAINT IF EXISTS observer_metrics_mqtt_event_id_metric_name_received_key;
         ALTER TABLE meshcore_private.observer_metrics
           ADD CONSTRAINT observer_metrics_pkey PRIMARY KEY (id, received_at_ms),
           ADD CONSTRAINT observer_metrics_mqtt_event_id_metric_name_received_key
             UNIQUE (mqtt_event_id, metric_name, received_at_ms)`,
      );
      await execSql(client, table.migrationSql);
      await execSql(
        client,
        `CREATE INDEX IF NOT EXISTS observer_metrics_observer_metric_received
         ON meshcore_private.observer_metrics(observer_id, metric_name, received_at_ms DESC, id DESC)`,
      );
      await execSql(client, "COMMIT");
    } catch (error) {
      await execSql(client, "ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
}

async function migrateV10ToV11(
  client: MigrationSession,
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

  await execSql(client, "BEGIN");
  try {
    await execSql(
      client,
      "ALTER TABLE meshcore_private.application_metadata ADD COLUMN database_created_at timestamptz",
    );
    await applyDeadline(client, deadlineMs);
    await execSql(
      client,
      "ALTER TABLE meshcore_public.schema_metadata ADD COLUMN database_created_at timestamptz",
    );
    const created = (await execSql(
      client,
      "SELECT CURRENT_TIMESTAMP AS created_at",
    )) as Array<{ created_at: Date }>;
    const createdAt = created[0].created_at;
    await execSql(
      client,
      "UPDATE meshcore_private.application_metadata SET database_created_at = $1",
      [createdAt],
    );
    await execSql(
      client,
      "UPDATE meshcore_public.schema_metadata SET database_created_at = $1",
      [createdAt],
    );
    await execSql(
      client,
      "ALTER TABLE meshcore_private.application_metadata ALTER COLUMN database_created_at SET DEFAULT now(), ALTER COLUMN database_created_at SET NOT NULL",
    );
    await execSql(
      client,
      "ALTER TABLE meshcore_public.schema_metadata ALTER COLUMN database_created_at SET DEFAULT now(), ALTER COLUMN database_created_at SET NOT NULL",
    );
    const v11 = await computeV11Fingerprint(client);
    await execSql(
      client,
      "UPDATE meshcore_private.application_metadata SET schema_version = $1, schema_hash = $2 WHERE singleton = 1",
      [11, v11],
    );
    await execSql(
      client,
      "UPDATE meshcore_public.schema_metadata SET schema_version = $1, schema_hash = $2 WHERE singleton = 1",
      [11, v11],
    );
    await execSql(client, "COMMIT");
  } catch (error) {
    await execSql(client, "ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function migrateV11ToV12(
  client: MigrationSession,
  deadlineMs: number,
): Promise<void> {
  await applyDeadline(client, deadlineMs);
  const before = await readMarkers(client);
  if (
    Number(before.privateMarker.schema_version) !== 11 ||
    Number(before.publicMarker.schema_version) !== 11
  )
    fail("v11 -> v12 requires matching v11 markers");
  const v11 = await computeV11Fingerprint(client);
  if (
    before.privateMarker.schema_hash !== v11 ||
    before.publicMarker.schema_hash !== v11
  )
    fail("v11 fingerprint does not match before v12 migration");

  await execSql(client, "BEGIN");
  try {
    await execSql(
      client,
      "LOCK TABLE meshcore_private.mqtt_events IN SHARE ROW EXCLUSIVE MODE",
    );
    await execSql(
      client,
      `CREATE TABLE IF NOT EXISTS meshcore_private.mqtt_event_provenance (
         event_id bigint PRIMARY KEY,
         topic text NOT NULL,
         iata text CHECK (iata IS NULL OR iata ~ '^[A-Z]{3}$'),
         observer_public_key text CHECK (observer_public_key IS NULL OR length(observer_public_key) = 64),
         subtopic text,
         subtopic_root text,
         payload_sha256 text NOT NULL,
         payload_size_bytes integer NOT NULL CHECK (payload_size_bytes >= 0),
         qos integer NOT NULL CHECK (qos BETWEEN 0 AND 2),
         retain boolean NOT NULL,
         dup boolean NOT NULL,
         received_at_ms bigint NOT NULL,
         parser_name text NOT NULL,
         parser_version text NOT NULL,
         collector_instance_id text NOT NULL,
         normalized_facts_present boolean NOT NULL DEFAULT false,
         created_at_ms bigint NOT NULL
       )`,
    );
    await execSql(
      client,
      `INSERT INTO meshcore_private.mqtt_event_provenance
         (event_id, topic, iata, observer_public_key, subtopic, subtopic_root, payload_sha256, payload_size_bytes, qos, retain, dup, received_at_ms, parser_name, parser_version, collector_instance_id, created_at_ms)
       SELECT event.id, event.topic, event.iata, observer.public_key, event.subtopic, event.subtopic_root, event.payload_sha256, octet_length(event.payload_blob), event.qos, event.retain, event.dup, event.received_at_ms, event.parser_name, event.parser_version, event.collector_instance_id, event.created_at_ms
       FROM meshcore_private.mqtt_events event
       LEFT JOIN meshcore_private.observers observer ON observer.id = event.observer_id
       ON CONFLICT (event_id) DO NOTHING`,
    );
    await execSql(
      client,
      `CREATE INDEX IF NOT EXISTS mqtt_event_provenance_received
       ON meshcore_private.mqtt_event_provenance(received_at_ms, event_id)`,
    );
    await execSql(
      client,
      `CREATE INDEX IF NOT EXISTS mqtt_event_provenance_observer_iata_received
       ON meshcore_private.mqtt_event_provenance(observer_public_key, iata, received_at_ms, event_id)
       WHERE observer_public_key IS NOT NULL AND iata IS NOT NULL`,
    );

    for (const child of [
      "observer_status_events",
      "observer_metrics",
      "observer_radio_history",
      "neighbor_snapshots",
      "packet_observations",
      "processing_errors",
    ]) {
      await execSql(
        client,
        `ALTER TABLE meshcore_private.${child}
         DROP CONSTRAINT IF EXISTS ${child}_mqtt_event_id_fkey,
         ADD CONSTRAINT ${child}_mqtt_event_id_fkey
           FOREIGN KEY (mqtt_event_id)
           REFERENCES meshcore_private.mqtt_event_provenance(event_id)
           ON DELETE RESTRICT NOT VALID`,
      );
      await execSql(
        client,
        `ALTER TABLE meshcore_private.${child}
         VALIDATE CONSTRAINT ${child}_mqtt_event_id_fkey`,
      );
    }
    await execSql(
      client,
      `UPDATE meshcore_private.mqtt_event_provenance provenance
       SET normalized_facts_present = true
       WHERE EXISTS (SELECT 1 FROM meshcore_private.observer_status_events fact WHERE fact.mqtt_event_id = provenance.event_id) OR
             EXISTS (SELECT 1 FROM meshcore_private.observer_metrics fact WHERE fact.mqtt_event_id = provenance.event_id) OR
             EXISTS (SELECT 1 FROM meshcore_private.observer_radio_history fact WHERE fact.mqtt_event_id = provenance.event_id) OR
             EXISTS (SELECT 1 FROM meshcore_private.neighbor_snapshots fact WHERE fact.mqtt_event_id = provenance.event_id) OR
             EXISTS (SELECT 1 FROM meshcore_private.packet_observations fact WHERE fact.mqtt_event_id = provenance.event_id)`,
    );

    await execSql(
      client,
      `CREATE TABLE IF NOT EXISTS meshcore_private.observer_metric_public_ids (
         private_id bigint PRIMARY KEY,
         public_id bigint NOT NULL UNIQUE
       );
       CREATE TABLE IF NOT EXISTS meshcore_private.observer_metric_public_id_state (
         singleton integer PRIMARY KEY CHECK (singleton = 1),
         legacy_private_max bigint NOT NULL CHECK (legacy_private_max >= 0),
         new_id_offset bigint NOT NULL CHECK (new_id_offset >= 0)
       );
       INSERT INTO meshcore_private.observer_metric_public_id_state(singleton, legacy_private_max, new_id_offset)
       VALUES (1, 0, 0)
       ON CONFLICT (singleton) DO NOTHING`,
    );
    await execSql(
      client,
      `DROP TRIGGER IF EXISTS project_observer_metric_trigger ON meshcore_private.observer_metrics;
       DROP TRIGGER IF EXISTS delete_public_projection_observer_metric_trigger ON meshcore_private.observer_metrics;
       DROP FUNCTION IF EXISTS meshcore_private.project_observer_metric();
       DO $$
       DECLARE
         metric_relation_kind "char";
         legacy_public_max bigint;
         migrated_private_max bigint;
       BEGIN
         SELECT cls.relkind INTO metric_relation_kind
         FROM pg_catalog.pg_class cls
         JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
         WHERE ns.nspname = 'meshcore_public' AND cls.relname = 'observer_metrics';

         IF metric_relation_kind = 'v' THEN
           DROP VIEW meshcore_public.observer_metrics;
         ELSIF metric_relation_kind IS NOT NULL THEN
           SELECT COALESCE(max(id), 0) INTO legacy_public_max
           FROM meshcore_public.observer_metrics;
           SELECT COALESCE(max(id), 0) INTO migrated_private_max
           FROM meshcore_private.observer_metrics;

           -- Preserve only legacy cursor exceptions. In the normal lockstep case
           -- this mapping stays empty, so v12 does not replace one duplicate fact
           -- table with another large cursor table.
           INSERT INTO meshcore_private.observer_metric_public_ids(private_id, public_id)
           SELECT private_id, id
           FROM meshcore_public.observer_metrics
           WHERE id IS DISTINCT FROM private_id
           ON CONFLICT (private_id) DO UPDATE SET public_id = EXCLUDED.public_id;

           -- A private metric that was never projected had no legacy public
           -- cursor. Give those exceptional rows a collision-free ID above the
           -- legacy public range before dropping the old table.
           WITH missing AS (
             SELECT metric.id AS private_id,
                    row_number() OVER (ORDER BY metric.id) AS ordinal
             FROM meshcore_private.observer_metrics metric
             LEFT JOIN meshcore_public.observer_metrics public_metric
               ON public_metric.private_id = metric.id
             WHERE public_metric.private_id IS NULL
           )
           INSERT INTO meshcore_private.observer_metric_public_ids(private_id, public_id)
           SELECT private_id, legacy_public_max + ordinal
           FROM missing
           ON CONFLICT (private_id) DO NOTHING;

           UPDATE meshcore_private.observer_metric_public_id_state
           SET legacy_private_max = migrated_private_max,
               new_id_offset = GREATEST(
                 legacy_public_max,
                 COALESCE((SELECT max(public_id) FROM meshcore_private.observer_metric_public_ids), 0)
               )
           WHERE singleton = 1;

           DROP TABLE meshcore_public.observer_metrics;
         END IF;
       END $$;`,
    );
    await execSql(client, PUBLIC_OBSERVER_METRICS_VIEW_SQL);
    const readRoles = (await execSql(
      client,
      `SELECT rolname FROM pg_catalog.pg_roles
       WHERE rolname = ANY($1::text[])`,
      [["meshcore_broker", "meshcore_reader", "meshcore_http"]],
    )) as Array<{ rolname: string }>;
    for (const { rolname } of readRoles) {
      await execSql(
        client,
        `GRANT SELECT ON meshcore_public.observer_metrics TO ${rolname}`,
      );
    }

    const v12 = await computeV12Fingerprint(client);
    await execSql(
      client,
      "UPDATE meshcore_private.application_metadata SET schema_version = 12, schema_hash = $1 WHERE singleton = 1",
      [v12],
    );
    await execSql(
      client,
      "UPDATE meshcore_public.schema_metadata SET schema_version = 12, schema_hash = $1 WHERE singleton = 1",
      [v12],
    );
    await execSql(client, "COMMIT");
  } catch (error) {
    await execSql(client, "ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** Runs the complete known migration chain once under one overall deadline. */
export async function migrateSchemaToCurrent(options: {
  databaseConfig: DatabaseOptions;
  timeoutMs: number;
}): Promise<{ fromVersion: number; toVersion: number; chain: number[] }> {
  const sql = createSqlInstance(
    {
      ...options.databaseConfig,
      max: 2,
      query_timeout: options.timeoutMs,
      idleTimeoutSeconds: Math.ceil(options.timeoutMs / 1_000) + 30,
    },
    { searchPath: false },
  );
  try {
    const lockClient = await reserveSession(sql);
    let workClient: BrokerSession;
    try {
      workClient = await reserveSession(sql);
    } catch (error) {
      lockClient.release();
      throw error;
    }
    try {
      const deadlineMs = Date.now() + options.timeoutMs;
      await applyDeadline(lockClient, deadlineMs);
      await applyDeadline(workClient, deadlineMs);
      await execSql(lockClient, "SELECT pg_advisory_lock($1)", [
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
          await execSql(lockClient, statement);
        }
        await applyDeadline(workClient, deadlineMs);
        const v10 = await computeV10Fingerprint(workClient);
        await execSql(workClient, "BEGIN");
        try {
          await execSql(
            workClient,
            "UPDATE meshcore_private.application_metadata SET schema_version = 10, schema_hash = $1 WHERE singleton = 1",
            [v10],
          );
          await execSql(
            workClient,
            "UPDATE meshcore_public.schema_metadata SET schema_version = 10, schema_hash = $1 WHERE singleton = 1",
            [v10],
          );
          await execSql(workClient, "COMMIT");
        } catch (error) {
          await execSql(workClient, "ROLLBACK").catch(() => undefined);
          throw error;
        }
        version = 10;
        chain.push(version);
      }
      if (version === 10) {
        await migrateV10ToV11(workClient, deadlineMs);
        version = 11;
        chain.push(version);
      }
      if (version === 11) {
        await migrateV11ToV12(workClient, deadlineMs);
        version = 12;
        chain.push(version);
      }
      if (version !== CURRENT_SCHEMA_VERSION)
        fail(`unsupported source schema version ${version}`);
      const current = await readMarkers(workClient);
      const currentFingerprint = await computeV12Fingerprint(workClient);
      if (
        current.privateMarker.schema_id !== SCHEMA_ID ||
        current.publicMarker.schema_id !== SCHEMA_ID ||
        current.privateMarker.schema_hash !== currentFingerprint ||
        current.publicMarker.schema_hash !== currentFingerprint
      )
        fail("current schema fingerprint does not match before index repair");
      for (const index of REQUIRED_OPERATIONAL_INDEXES) {
        await applyDeadline(lockClient, deadlineMs);
        await execSql(lockClient, index.onlineSql);
      }
      return { fromVersion, toVersion: version, chain };
    } finally {
      await lockClient
        .unsafe("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
        .catch(() => undefined);
      workClient.release();
      lockClient.release();
    }
  } finally {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  }
}

/**
 * Performs optional physical Timescale rewrites after the semantic schema has
 * reached the current version. This is deliberately separate from startup so
 * a large migrate_data operation is never hidden inside broker recovery.
 */
export async function optimizeTimescaleLayout(options: {
  databaseConfig: DatabaseOptions;
  timeoutMs: number;
}): Promise<{ optimized: string[] }> {
  const sql = createSqlInstance(
    {
      ...options.databaseConfig,
      max: 1,
      query_timeout: options.timeoutMs,
      idleTimeoutSeconds: Math.ceil(options.timeoutMs / 1_000) + 30,
    },
    { searchPath: false },
  );
  const client = await reserveSession(sql);
  try {
    const deadlineMs = Date.now() + options.timeoutMs;
    await applyDeadline(client, deadlineMs);
    await execSql(client, "SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await assumeOwnerRole(client);
    const markers = await readMarkers(client);
    if (
      Number(markers.privateMarker.schema_version) !== CURRENT_SCHEMA_VERSION ||
      Number(markers.publicMarker.schema_version) !== CURRENT_SCHEMA_VERSION
    )
      fail(`Timescale optimization requires schema v${CURRENT_SCHEMA_VERSION}`);
    const current = await computeV12Fingerprint(client);
    if (
      markers.privateMarker.schema_hash !== current ||
      markers.publicMarker.schema_hash !== current
    )
      fail(
        "current schema fingerprint does not match before Timescale optimization",
      );

    await ensureTimescaleLayout(client, deadlineMs);
    return {
      optimized: TIMESCALE_HYPERTABLES.map(
        (table) => `${table.schema}.${table.table}`,
      ),
    };
  } finally {
    await client
      .unsafe("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    client.release();
    await sql.close({ timeout: 1 }).catch(() => undefined);
  }
}

/**
 * Emits the exact SQL an operator can apply manually with superuser psql
 * (metadata hash included). Read-only against the target database.
 */
export async function emitMigrationSql(adminUrl: string): Promise<string> {
  const sql = createSqlInstance(
    { connectionString: adminUrl, max: 1 },
    { searchPath: false },
  );
  try {
    const client = await reserveSession(sql);
    try {
      const markers = await readMarkers(client);
      if (
        markers.privateMarker.schema_id !== SCHEMA_ID ||
        Number(markers.privateMarker.schema_version) !== 9
      )
        return `-- No-op: expected schema v9 for ${SCHEMA_ID}, found v${markers.privateMarker.schema_version}`;
      const actualV9 = await computeLegacyV9Fingerprint(client);
      if (actualV9 !== markers.privateMarker.schema_hash)
        return `-- REFUSING: stored v9 fingerprint does not match recomputation\nstored:     ${markers.privateMarker.schema_hash}\nrecomputed: ${actualV9}`;
      const v10 = await computeV10Fingerprint(client);
      return [
        ...V10_INDEX_STATEMENTS.map((statement) => `${statement};`),
        `BEGIN;`,
        `UPDATE meshcore_private.application_metadata SET schema_version = 10, schema_hash = '${v10}' WHERE singleton = 1;`,
        `UPDATE meshcore_public.schema_metadata SET schema_version = 10, schema_hash = '${v10}' WHERE singleton = 1;`,
        `COMMIT;`,
      ].join("\n");
    } finally {
      client.release();
    }
  } finally {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  }
}

/** Read-only verification of a migrated (v10) database. */
export async function verifySchemaV10(
  adminUrl: string,
): Promise<{ ok: true; indexesValid: Record<string, boolean> }> {
  const sql = createSqlInstance(
    { connectionString: adminUrl, max: 1 },
    { searchPath: false },
  );
  try {
    const client = await reserveSession(sql);
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
    await sql.close({ timeout: 1 }).catch(() => undefined);
  }
}

/** Executes the additive v9 -> v10 migration. Idempotent and fail-closed. */
export async function migrateSchemaV9ToV10(options: {
  adminUrl: string;
}): Promise<MigrationResult> {
  // Dedicated session holds the advisory lock for the whole run while the
  // CONCURRENTLY builds run outside any transaction on that same session.
  const sql = createSqlInstance(
    { connectionString: options.adminUrl, max: 2 },
    { searchPath: false },
  );
  const lockClient = await reserveSession(sql);
  let workClient: BrokerSession;
  try {
    await execSql(lockClient, "SELECT pg_advisory_lock($1)", [
      MIGRATION_LOCK_KEY,
    ]);
    workClient = await reserveSession(sql);
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
      await execSql(lockClient, statement);
    const indexesValid = await newIndexValidity(workClient);
    for (const [name, valid] of Object.entries(indexesValid))
      if (!valid) fail(`index ${name} was created but is not valid`);

    // Metadata phase: one short transaction moving both markers to v10.
    const v10 = await computeV10Fingerprint(workClient);
    await execSql(workClient, "BEGIN");
    await execSql(
      workClient,
      "UPDATE meshcore_private.application_metadata SET schema_version = 10, schema_hash = $1 WHERE singleton = 1",
      [v10],
    );
    await execSql(
      workClient,
      "UPDATE meshcore_public.schema_metadata SET schema_version = 10, schema_hash = $1 WHERE singleton = 1",
      [v10],
    );
    await execSql(workClient, "COMMIT");

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
    await lockClient
      .unsafe("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    lockClient.release();
    await sql.close({ timeout: 1 }).catch(() => undefined);
  }
}
