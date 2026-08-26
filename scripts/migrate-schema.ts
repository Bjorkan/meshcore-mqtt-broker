#!/usr/bin/env bun
import { migrateSchemaToCurrent } from "../src/schema-migration.js";

const url = process.env.DATABASE_URL?.trim();
if (!url) throw new Error("DATABASE_URL must be set");
const timeoutMs = Number(process.env.DATABASE_MIGRATION_TIMEOUT_MS ?? "30000");
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000)
  throw new Error(
    "DATABASE_MIGRATION_TIMEOUT_MS must be between 1000 and 300000",
  );

const result = await migrateSchemaToCurrent({
  poolConfig: { connectionString: url },
  timeoutMs,
});
console.log(JSON.stringify(result));
