import { Pool } from "pg";
import { openTestDatabase } from "../dist/database.js";

const TEST_SCHEMA_OPTIONS = { schema: "meshcore_private" };

function testConnectionString() {
  const connectionString = process.env.POSTGRES_TEST_URL;
  if (!connectionString)
    throw new Error("POSTGRES_TEST_URL must be set for PostgreSQL tests");
  return connectionString;
}

async function resetSchemas(connectionString) {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    // Test isolation is deliberately limited to the broker's two schemas.
    await pool.query("DROP SCHEMA IF EXISTS meshcore_public CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS meshcore_private CASCADE");
  } finally {
    await pool.end();
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
