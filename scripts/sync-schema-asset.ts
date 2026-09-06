#!/usr/bin/env bun
/**
 * Renders postgres/initdb/02-meshcore-schema.sql.inc from the canonical DDL
 * constants in src/database.ts so the runtime schema and the static
 * clean-install asset cannot drift. Run after any schema change and commit
 * the regenerated asset together with the source change.
 *
 * The asset wraps the same statements the broker executes at startup
 * (PRIVATE_SCHEMA_DDL, PUBLIC_SCHEMA_DDL, projection DDL, V10 index DDL),
 * framed by the static header comment and the trailing metadata/marker
 * statements that only make sense for a fresh initdb install.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PRIVATE_SCHEMA_DDL,
  PUBLIC_PROJECTION_DDL,
  PUBLIC_PROJECTION_TRIGGERS_DDL,
  PUBLIC_SCHEMA_DDL,
  V10_PUBLIC_INDEX_DDL,
} from "../src/database.js";

const HEADER =
  "/* Static broker schema. Bootstrap runs this as meshcore_owner. */";
const TRAILER = `INSERT INTO meshcore_private.application_metadata(singleton, schema_id, schema_version, schema_hash) VALUES (1, 'meshcore-mqtt-broker-postgres-v1', 12, 'pending') ON CONFLICT (singleton) DO NOTHING;
INSERT INTO meshcore_public.schema_metadata(singleton, schema_id, schema_version, schema_hash, database_created_at) SELECT 1, 'meshcore-mqtt-broker-postgres-v1', 12, 'pending', database_created_at FROM meshcore_private.application_metadata WHERE singleton = 1 ON CONFLICT (singleton) DO NOTHING;
INSERT INTO meshcore_private.meshcore_io_stats(singleton) VALUES (1) ON CONFLICT (singleton) DO NOTHING;`;

const asset = [
  HEADER,
  PRIVATE_SCHEMA_DDL.trim(),
  PUBLIC_SCHEMA_DDL.trim(),
  PUBLIC_PROJECTION_DDL.trim(),
  PUBLIC_PROJECTION_TRIGGERS_DDL.trim(),
  V10_PUBLIC_INDEX_DDL.trim(),
  TRAILER,
]
  .join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .concat("\n");

const target = path.join(
  import.meta.dirname,
  "..",
  "postgres",
  "initdb",
  "02-meshcore-schema.sql.inc",
);
await writeFile(target, asset);
console.log(`wrote ${target}`);
