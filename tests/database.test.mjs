import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "@jest/globals";
import {
  ApplicationDatabase,
  DATABASE_DIRECTORY,
  DATABASE_FILE,
  openTestDatabase,
} from "../dist/database.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

test("production database path is fixed and has no config or environment override", async () => {
  assert.equal(DATABASE_DIRECTORY, "/data/meshcore-mqtt-broker");
  assert.equal(
    DATABASE_FILE,
    "/data/meshcore-mqtt-broker/meshcore-mqtt-broker.db",
  );
  const source = await readFile(
    path.join(process.cwd(), "src/database.ts"),
    "utf8",
  );
  const config = await readFile(
    path.join(process.cwd(), "src/config.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /process\.env|configString|configInt/);
  assert.doesNotMatch(
    config,
    /database.*path|database_file|database_directory/i,
  );
});

test("test factory creates directories and initializes a clean schema repeatedly", async () => {
  const fixture = await temporaryDatabase("schema-");
  fixtures.push(fixture);
  await access(fixture.file);
  await fixture.database.close();
  const reopened = await ApplicationDatabase.open(fixture.file);
  fixture.database = reopened;
  await reopened.probe();
  const tables = await reopened.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  );
  assert.ok(tables.some((row) => row.name === "retained_packets"));
  assert.ok(tables.some((row) => row.name === "meshcore_io_jobs"));
});

test("prepared statements bind values rather than interpolating SQL", async () => {
  const fixture = await temporaryDatabase("prepared-");
  fixtures.push(fixture);
  const statement = await fixture.database.prepare(
    "INSERT INTO observer_profiles(public_key, node_name, node_name_expires_at_ms) VALUES (?, ?, ?)",
  );
  const key = "A".repeat(64);
  await statement.run(
    key,
    "name'); DROP TABLE observer_profiles; --",
    Date.now() + 1000,
  );
  statement.close();
  const row = await fixture.database.get(
    "SELECT node_name FROM observer_profiles WHERE public_key = ?",
    key,
  );
  assert.equal(row.node_name, "name'); DROP TABLE observer_profiles; --");
});

test("transactionAsync rolls back all writes when its callback fails", async () => {
  const fixture = await temporaryDatabase("rollback-");
  fixtures.push(fixture);
  const transaction = fixture.database.transaction(async (tx) => {
    await tx.run(
      "INSERT INTO observer_profiles(public_key, node_name) VALUES (?, ?)",
      "B".repeat(64),
      "rollback",
    );
    throw new Error("expected rollback");
  });
  await assert.rejects(transaction.immediate(), /expected rollback/);
  const row = await fixture.database.get(
    "SELECT COUNT(*) AS count FROM observer_profiles",
  );
  assert.equal(Number(row.count), 0);
});

test("opening a directory as the database fails without memory or tmp fallback", async () => {
  const fixture = await temporaryDatabase("bad-path-");
  fixtures.push(fixture);
  await assert.rejects(openTestDatabase(fixture.directory));
});

test("incompatible schema marker fails with clean-directory instructions", async () => {
  const fixture = await temporaryDatabase("incompatible-");
  fixtures.push(fixture);
  await fixture.database.run(
    "UPDATE application_metadata SET schema_id = 'manually-modified' WHERE singleton = 1",
  );
  await fixture.database.close();
  await assert.rejects(
    ApplicationDatabase.open(fixture.file),
    /inte kompatibel.*tom datakatalog/i,
  );
});

test("marked partial schema is rejected instead of repaired", async () => {
  const fixture = await temporaryDatabase("partial-schema-");
  fixtures.push(fixture);
  await fixture.database.run("DROP TABLE mqtt_wills");
  await fixture.database.close();
  await assert.rejects(
    ApplicationDatabase.open(fixture.file),
    /inte kompatibel.*struktur.*tom datakatalog/i,
  );
});

test("marked schema with altered constraints is rejected", async () => {
  const fixture = await temporaryDatabase("altered-schema-");
  fixtures.push(fixture);
  await fixture.database.run("DROP INDEX mqtt_subscriptions_topic");
  await fixture.database.close();
  await assert.rejects(
    ApplicationDatabase.open(fixture.file),
    /inte kompatibel.*struktur.*tom datakatalog/i,
  );
});
