#!/usr/bin/env bun
import { optimizeTimescaleLayout } from "../src/schema-migration.js";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required");
const rawTimeout =
  process.env.DATABASE_TIMESCALE_OPTIMIZATION_TIMEOUT_MS ??
  process.env.DATABASE_MIGRATION_TIMEOUT_MS ??
  "300000";
const timeoutMs = Number(rawTimeout);
if (
  !Number.isSafeInteger(timeoutMs) ||
  timeoutMs < 1_000 ||
  timeoutMs > 3_600_000
)
  throw new Error(
    "DATABASE_TIMESCALE_OPTIMIZATION_TIMEOUT_MS must be an integer from 1000 to 3600000",
  );

const result = await optimizeTimescaleLayout({
  databaseConfig: { connectionString },
  timeoutMs,
});
console.log(JSON.stringify(result, null, 2));
