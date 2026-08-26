import { SQL } from "bun";
import { openTestDatabase } from "../src/database.ts";

const TEST_SCHEMA_OPTIONS = { schema: "meshcore_private" };

function testConnectionString() {
  const connectionString = process.env.POSTGRES_TEST_URL;
  if (!connectionString)
    throw new Error("POSTGRES_TEST_URL must be set for PostgreSQL tests");
  return connectionString;
}

async function resetSchemas(connectionString) {
  const sql = new SQL(connectionString);
  try {
    await sql.unsafe("CREATE EXTENSION IF NOT EXISTS postgis");
    // Test isolation is deliberately limited to the broker's two schemas.
    await sql.unsafe("DROP SCHEMA IF EXISTS meshcore_public CASCADE");
    await sql.unsafe("DROP SCHEMA IF EXISTS meshcore_private CASCADE");
  } finally {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  }
}

export async function temporaryDatabase(_prefix = "database-") {
  const connectionString = testConnectionString();
  await resetSchemas(connectionString);
  const fixture = {
    connectionString,
    database: await openTestDatabase({
      connectionString,
      ...TEST_SCHEMA_OPTIONS,
    }),
    async reopen() {
      await fixture.database.close();
      fixture.database = await openTestDatabase({
        connectionString,
        ...TEST_SCHEMA_OPTIONS,
      });
      return fixture.database;
    },
    async cleanup() {
      await fixture.database.close().catch(() => undefined);
      await resetSchemas(connectionString);
    },
  };
  return fixture;
}
