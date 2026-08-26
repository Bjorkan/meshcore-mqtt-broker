import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, test } from "bun:test";
import { encodeStoredPacket } from "../src/stored-packet-codec.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

const LEGACY_PUBLISH =
  "/w9vIgNjbWQiB3B1Ymxpc2giBXRvcGljIhttZXNoY29yZS9KS0cvYWFiYi9uZWlnaGJvcnMiB3BheWxvYWRcCgUAobLD/yIDcW9zSQIiBnJldGFpblQiA2R1cEYiCGJyb2tlcklkIghicm9rZXItMSINYnJva2VyQ291bnRlckkOewg=";
const LEGACY_WILL =
  "/w9vIgNjbWQiB3B1Ymxpc2giBXRvcGljIhZtZXNoY29yZS9HT1QvY2NkZC93aWxsIgdwYXlsb2FkXAoDYnllIgNxb3NJACIGcmV0YWluRiIDZHVwRiIIY2xpZW50SWQiCGNsaWVudC05Ighicm9rZXJJZCIIYnJva2VyLTF7CA==";
const LEGACY_PUBREL = "/w9vIgNjbWQiBnB1YnJlbCIJbWVzc2FnZUlkSVR7Ag==";

function runMigration(connectionString) {
  return spawnSync(
    process.execPath.endsWith("bun") ? "bun" : "bun",
    [
      join(
        fileURLToPath(new URL("..", import.meta.url)),
        "scripts",
        "migrate-stored-packets.mjs",
      ),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        DATABASE_SCHEMA: "meshcore_private",
      },
    },
  );
}

async function seedRows(fixture) {
  const database = fixture.database;
  const now = Date.now();
  await database.run(
    `INSERT INTO retained_packets(topic, packet, stored_at_ms, expires_at_ms)
     VALUES ($1, $2, $3, NULL), ($4, $5, $6, $7)`,
    "meshcore/JKG/legacy/neighbors",
    Buffer.from(LEGACY_PUBLISH, "base64"),
    now,
    "meshcore/GOT/current/neighbors",
    encodeStoredPacket({
      cmd: "publish",
      topic: "meshcore/GOT/current/neighbors",
      payload: Buffer.from("current"),
      qos: 1,
      retain: true,
      dup: false,
    }),
    now,
    now + 48 * 60 * 60 * 1000,
  );
  await database.run(
    `INSERT INTO mqtt_outgoing(client_id, packet, broker_id, broker_counter, message_id, created_at_ms)
     VALUES ($1, $2, 'broker-1', 1, NULL, $3), ($4, $5, 'broker-1', 2, 42, $6)`,
    "legacy-client",
    Buffer.from(LEGACY_PUBREL, "base64"),
    now,
    "current-client",
    encodeStoredPacket({ cmd: "pubrel", messageId: 43 }),
    now,
  );
  await database.run(
    `INSERT INTO mqtt_incoming(client_id, message_id, packet, created_at_ms)
     VALUES ($1, 11, $2, $3)`,
    "legacy-client",
    Buffer.from(LEGACY_PUBLISH, "base64"),
    now,
  );
  await database.run(
    `INSERT INTO mqtt_wills(client_id, broker_id, packet, created_at_ms)
     VALUES ($1, 'broker-1', $2, $3)`,
    "will-client",
    Buffer.from(LEGACY_WILL, "base64"),
    now,
  );
  const currentRow = await database.get(
    "SELECT packet FROM retained_packets WHERE topic = $1",
    "meshcore/GOT/current/neighbors",
  );
  return Buffer.from(currentRow.packet);
}

test("backfill refuses retired Node-V8 rows fail-closed and preserves portable rows", async () => {
  const fixture = await temporaryDatabase("packet-backfill-");
  fixtures.push(fixture);
  const currentBytes = await seedRows(fixture);

  const firstRun = runMigration(fixture.connectionString);
  // Non-zero exit: the tool refuses to guess at pre-portable rows.
  assert.notEqual(firstRun.status, 0, firstRun.stdout + firstRun.stderr);
  for (const table of [
    "retained_packets",
    "mqtt_outgoing",
    "mqtt_incoming",
    "mqtt_wills",
  ]) {
    assert.match(firstRun.stdout, new RegExp(`${table}: legacy_before=1`));
    assert.match(firstRun.stderr, /retired Node V8 format/);
    assert.match(firstRun.stderr, /rolled back before any write/);
  }
  assert.doesNotMatch(firstRun.stdout, /migration complete/);

  // Portable (current-format) rows remain byte-exact untouched.
  const untouchedRow = await fixture.database.get(
    "SELECT packet FROM retained_packets WHERE topic = $1",
    "meshcore/GOT/current/neighbors",
  );
  assert.deepEqual(Buffer.from(untouchedRow.packet), currentBytes);

  // Idempotent refusal: a second run reports the identical state.
  const secondRun = runMigration(fixture.connectionString);
  assert.notEqual(secondRun.status, 0, secondRun.stdout + secondRun.stderr);
  for (const table of [
    "retained_packets",
    "mqtt_outgoing",
    "mqtt_incoming",
    "mqtt_wills",
  ]) {
    assert.match(secondRun.stdout, new RegExp(`${table}: legacy_before=1`));
  }
});
