#!/usr/bin/env bun
// Explicit v9 -> v10 schema migration. The ONLY supported way to migrate an
// existing production database. Never runs automatically at broker startup.
//
// Usage:
//   DATABASE_URL=postgres://... bun scripts/migrate-schema-v9-to-v10.ts            # execute
//   DATABASE_URL=postgres://... bun scripts/migrate-schema-v9-to-v10.ts --verify   # read-only check
//   DATABASE_URL=postgres://... bun scripts/migrate-schema-v9-to-v10.ts --emit-sql # print manual SQL
//
// DATABASE_URL must connect as a role that owns meshcore_public (typically
// the deployment superuser or meshcore_owner). Credentials are never logged.

import { emitMigrationSql, migrateSchemaV9ToV10, verifySchemaV10 } from "../src/schema-migration.js";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL must be set to an admin/owner PostgreSQL connection string.");
  process.exit(2);
}

const mode = process.argv[2] ?? "--execute";

try {
  if (mode === "--emit-sql") {
    console.log(await emitMigrationSql(url));
  } else if (mode === "--verify") {
    const result = await verifySchemaV10(url);
    console.log("v10 verification OK; indexes:", JSON.stringify(result.indexesValid));
  } else if (mode === "--execute") {
    const result = await migrateSchemaV9ToV10({ adminUrl: url });
    console.log(`status: ${result.status}`);
    for (const table of Object.keys(result.countsBefore)) {
      const before = result.countsBefore[table];
      const after = result.countsAfter[table];
      console.log(`${table}: ${before} -> ${after}${before !== after ? "  (CHANGED!)" : ""}`);
    }
    console.log("indexes:", JSON.stringify(result.indexesValid));
    if (result.status === "migrated")
      console.log("schema migration to v10 complete. Run ANALYZE on the public tables next.");
  } else {
    console.error("Unknown mode. Use --execute, --verify or --emit-sql.");
    process.exit(2);
  }
} catch (error) {
  console.error(
    `[migration failed] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
