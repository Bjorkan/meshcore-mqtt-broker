#!/usr/bin/env bun
// One-shot, idempotent migration of persisted Aedes packets from the legacy
// Node V8 format to the portable MESHMQTT1+MessagePack format.
//
// Safe to run repeatedly: only rows lacking the magic prefix are rewritten,
// updates are guarded on the exact old bytes, work happens in bounded
// transactional batches, and a final verification pass re-counts leftovers.
// Persistent state is never truncated.
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { SQL } from "bun";
import {
  decodeStoredPacket,
  encodeStoredPacket,
} from "../src/stored-packet-codec.ts";

const MAGIC = Buffer.from("MESHMQTT1", "ascii");
const BATCH_SIZE = 200;
const TABLES = [
  { table: "retained_packets", keys: ["topic"] },
  { table: "mqtt_outgoing", keys: ["id"] },
  { table: "mqtt_incoming", keys: ["client_id", "message_id"] },
  { table: "mqtt_wills", keys: ["client_id"] },
];

function resolveConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const password =
    process.env.DATABASE_PASSWORD?.trim() ||
    (process.env.DATABASE_PASSWORD_FILE
      ? readFileSync(process.env.DATABASE_PASSWORD_FILE, "utf8").trim()
      : "");
  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT ?? "5432";
  const name = process.env.DATABASE_NAME;
  const user = process.env.DATABASE_USER;
  if (!host || !name || !user || !password)
    throw new Error(
      "Set DATABASE_URL or DATABASE_HOST/DATABASE_PORT/DATABASE_NAME/DATABASE_USER and DATABASE_PASSWORD[_FILE]",
    );
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

const isPortableFormat = (bytes) =>
  bytes.length >= MAGIC.length && bytes.subarray(0, MAGIC.length).equals(MAGIC);

async function* scanTable(client, table, keys) {
  const selection = keys
    .map((column, index) => `${column} AS k${index}`)
    .concat("packet")
    .join(", ");
  let lastKeyValues = null;
  for (;;) {
    let comparison;
    let parameters;
    if (lastKeyValues === null) {
      comparison = `${keys[0]} IS NOT NULL`;
      parameters = [];
    } else {
      const left = `(${keys.join(", ")})`;
      const right = `(${keys.map((_, index) => `$${index + 1}`).join(", ")})`;
      comparison = `${left} > ${right}`;
      parameters = lastKeyValues.map((value) =>
        typeof value === "string" ? value : Number(value),
      );
    }
    parameters.push(BATCH_SIZE);
    const rows = await client.unsafe(
      `SELECT ${selection} FROM ${table}
        WHERE ${comparison} ORDER BY ${keys.join(", ")} ASC LIMIT $${parameters.length}`,
      parameters,
    );
    if (rows.length === 0) return;
    for (const row of rows) {
      yield {
        values: keys.map((_, index) => row[`k${index}`]),
        packet: row.packet,
      };
    }
    if (rows.length < BATCH_SIZE) return;
    const lastRow = rows[rows.length - 1];
    lastKeyValues = keys.map((_, index) => lastRow[`k${index}`]);
  }
}

async function classifyTable(client, table, keys) {
  let total = 0;
  let legacy = 0;
  for await (const _row of scanTable(client, table, keys)) {
    total += 1;
    if (!isPortableFormat(_row.packet)) legacy += 1;
  }
  return { total, legacy };
}

let abortReason;

function aborted() {
  return abortReason !== undefined;
}

async function migrateTable(client, table, keys) {
  let migrated = 0;
  let failed = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const prepared = [];
    try {
      for (const item of batch) {
        // Fail-closed: rows from the retired Node V8 era are rejected here,
        // before any bytes change. A skipped historical backfill must be
        // surfaced, never guessed at.
        prepared.push({
          values: item.values,
          packet: item.packet,
          encoded: encodeStoredPacket(decodeStoredPacket(item.packet)),
        });
      }
    } catch (error) {
      failed += batch.length;
      batch = [];
      console.error(
        `  ${table}: refusing to migrate ${failed} row(s), rolled back before any write: ${error.message}`,
      );
      abortReason ??= error.message;
      return;
    }
    await client.unsafe("BEGIN");
    try {
      for (const item of prepared) {
        const guards = item.values.map((_, index) => `$${index + 2}`);
        const updatedRows = await client.unsafe(
          `UPDATE ${table} SET packet = $1
            WHERE (${keys.join(", ")}) = (${guards.join(", ")}) AND packet = $${keys.length + 2}
            RETURNING 1`,
          [item.encoded, ...item.values, item.packet],
        );
        if (updatedRows.length === 1) migrated += 1;
        else failed += 1;
      }
      await client.unsafe("COMMIT");
    } catch (error) {
      await client.unsafe("ROLLBACK");
      failed += prepared.length;
      console.error(`  ${table}: batch failed, rolled back: ${error.message}`);
    } finally {
      batch = [];
    }
  };
  for await (const row of scanTable(client, table, keys)) {
    if (aborted()) break;
    if (isPortableFormat(row.packet)) continue;
    batch.push(row);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return { migrated, failed };
}

async function main() {
  const connectionString = resolveConnectionString();
  const schema = process.env.DATABASE_SCHEMA?.trim();
  const sql = new SQL({
    adapter: "postgres",
    ...(schema
      ? { connection: { search_path: `${schema},meshcore_public` } }
      : {}),
    ...(() => {
      const url = new URL(connectionString);
      return {
        hostname: url.hostname,
        port: Number(url.port || 5432),
        database: decodeURIComponent(url.pathname.slice(1)),
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      };
    })(),
    max: 2,
  });
  const client = await sql.reserve();
  const report = {};
  try {
    for (const { table, keys } of TABLES) {
      const before = await classifyTable(client, table, keys);
      const { migrated, failed } =
        before.legacy > 0
          ? await migrateTable(client, table, keys)
          : { migrated: 0, failed: 0 };
      const after = await classifyTable(client, table, keys);
      report[table] = {
        legacy_before: before.legacy,
        migrated,
        failed,
        total_after: after.total,
        legacy_after: after.legacy,
      };
      console.log(
        `${table}: legacy_before=${before.legacy} migrated=${migrated} ` +
          `failed=${failed} total_after=${after.total} legacy_after=${after.legacy}`,
      );
    }
  } finally {
    client.release();
    await sql.close({ timeout: 5 }).catch(() => undefined);
  }
  const leftoverLegacy = Object.values(report).reduce(
    (sum, entry) => sum + entry.legacy_after,
    0,
  );
  const failures = Object.values(report).reduce(
    (sum, entry) => sum + entry.failed,
    0,
  );
  if (leftoverLegacy > 0 || failures > 0) {
    console.error(
      `migration incomplete: legacy_after=${leftoverLegacy} failed=${failures}`,
    );
    process.exitCode = 1;
  } else {
    console.log("migration complete: all stored packets use MESHMQTT1 format");
  }
}

await main();
