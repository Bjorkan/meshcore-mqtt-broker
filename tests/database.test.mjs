import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "@jest/globals";
import {
  ApplicationDatabase,
  CURRENT_SCHEMA_VERSION,
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
  assert.ok(tables.some((row) => row.name === "heard_node_adverts"));
  assert.ok(tables.some((row) => row.name === "heard_node_regions"));
  assert.ok(tables.some((row) => row.name === "meshcore_io_jobs"));
  assert.ok(tables.some((row) => row.name === "mqtt_events"));
  assert.ok(tables.some((row) => row.name === "packet_observations"));
  assert.ok(tables.some((row) => row.name === "telemetry_values"));
  const metadata = await reopened.get(
    "SELECT schema_version FROM application_metadata WHERE singleton = 1",
  );
  assert.equal(Number(metadata.schema_version), CURRENT_SCHEMA_VERSION);
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

test("incompatible schema marker is deleted and recreated on initialized open", async () => {
  const fixture = await temporaryDatabase("incompatible-");
  fixtures.push(fixture);
  await fixture.database.run(
    "INSERT INTO observer_profiles(public_key, node_name) VALUES (?, ?)",
    "A".repeat(64),
    "must be deleted",
  );
  await fixture.database.run(
    "UPDATE application_metadata SET schema_id = 'manually-modified' WHERE singleton = 1",
  );
  await fixture.database.close();
  await writeFile(`${fixture.file}-journal`, "stale sidecar");
  await assert.rejects(
    ApplicationDatabase.openExisting(fixture.file),
    /inte kompatibel.*brokerstart.*ny tom databas/i,
  );
  await access(fixture.file);

  const reopened = await ApplicationDatabase.open(fixture.file);
  await reopened.probe();
  const rows = await reopened.all(
    "SELECT public_key FROM observer_profiles ORDER BY public_key",
  );
  assert.equal(rows.length, 0);
  await assert.rejects(access(`${fixture.file}-journal`));
  await reopened.close();
});

test("marked partial schema is replaced rather than repaired", async () => {
  const fixture = await temporaryDatabase("partial-schema-");
  fixtures.push(fixture);
  await fixture.database.run("DROP TABLE mqtt_wills");
  await fixture.database.close();
  const reopened = await ApplicationDatabase.open(fixture.file);
  const tables = await reopened.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mqtt_wills'",
  );
  assert.equal(tables.length, 1);
  await reopened.close();
});

test("schema with altered constraints is replaced", async () => {
  const fixture = await temporaryDatabase("altered-schema-");
  fixtures.push(fixture);
  await fixture.database.run("DROP INDEX mqtt_subscriptions_topic");
  await fixture.database.close();
  const reopened = await ApplicationDatabase.open(fixture.file);
  const indexes = await reopened.all(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'mqtt_subscriptions_topic'",
  );
  assert.equal(indexes.length, 1);
  await reopened.close();
});

test("wrong schema version and missing history columns trigger recreation", async () => {
  const wrongVersion = await temporaryDatabase("wrong-version-");
  fixtures.push(wrongVersion);
  await wrongVersion.database.run(
    "UPDATE application_metadata SET schema_version = 999 WHERE singleton = 1",
  );
  await wrongVersion.database.close();
  let reopened = await ApplicationDatabase.open(wrongVersion.file);
  assert.equal(
    Number(
      (
        await reopened.get(
          "SELECT schema_version FROM application_metadata WHERE singleton = 1",
        )
      ).schema_version,
    ),
    CURRENT_SCHEMA_VERSION,
  );
  await reopened.close();

  const missingColumn = await temporaryDatabase("missing-column-");
  fixtures.push(missingColumn);
  await missingColumn.database.run("DROP TABLE telemetry_values");
  await missingColumn.database.run(
    "CREATE TABLE telemetry_values(id INTEGER PRIMARY KEY)",
  );
  await missingColumn.database.close();
  reopened = await ApplicationDatabase.open(missingColumn.file);
  const columns = await reopened.all("PRAGMA table_info(telemetry_values)");
  assert.ok(columns.some((column) => column.name === "metric_name"));
  await reopened.close();
});
