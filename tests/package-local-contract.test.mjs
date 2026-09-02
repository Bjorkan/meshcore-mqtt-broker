import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "bun:test";
import {
  REQUIRED_OPERATIONAL_INDEXES,
  TIMESCALE_HYPERTABLES,
  PUBLIC_OBSERVER_METRICS_VIEW_SQL,
} from "../src/database.js";

const root = process.cwd();
const text = (file) => readFile(path.join(root, file), "utf8");
const normalizeSql = (sql) => sql.replace(/\s+/g, " ").trim();

test("static bootstrap contains every canonical required operational index", async () => {
  const bootstrap = normalizeSql(
    await text("postgres/initdb/02-meshcore-schema.sql.inc"),
  );
  for (const index of REQUIRED_OPERATIONAL_INDEXES) {
    assert.ok(
      bootstrap.includes(normalizeSql(index.bootstrapSql)),
      `static bootstrap is missing ${index.schema}.${index.name}`,
    );
  }
});

test("static bootstrap contains every canonical Timescale hypertable", async () => {
  const bootstrap = normalizeSql(
    await text("postgres/initdb/02-meshcore-schema.sql.inc"),
  );
  for (const table of TIMESCALE_HYPERTABLES) {
    assert.ok(
      bootstrap.includes(normalizeSql(table.bootstrapSql)),
      `static bootstrap is missing ${table.schema}.${table.table}`,
    );
  }
});

test("static bootstrap decouples normalized history from the raw MQTT journal", async () => {
  const bootstrap = normalizeSql(
    await text("postgres/initdb/02-meshcore-schema.sql.inc"),
  );
  assert.match(
    bootstrap,
    /CREATE TABLE IF NOT EXISTS meshcore_private\.mqtt_event_provenance/,
  );
  assert.doesNotMatch(bootstrap, /CREATE TRIGGER[^;]*mqtt_event_provenance/i);
  assert.match(
    bootstrap,
    /packet_observations[^;]*REFERENCES meshcore_private\.mqtt_event_provenance\(event_id\) ON DELETE RESTRICT/i,
  );
  assert.doesNotMatch(
    bootstrap,
    /packet_observations[^;]*REFERENCES meshcore_private\.mqtt_events\(id\) ON DELETE CASCADE/i,
  );
});

test("static public observer metrics uses the canonical direct view", async () => {
  const bootstrap = normalizeSql(
    await text("postgres/initdb/02-meshcore-schema.sql.inc"),
  );
  assert.ok(bootstrap.includes(normalizeSql(PUBLIC_OBSERVER_METRICS_VIEW_SQL)));
  assert.doesNotMatch(
    bootstrap,
    /CREATE TABLE IF NOT EXISTS meshcore_public\.observer_metrics/i,
  );
  assert.doesNotMatch(
    bootstrap,
    /CREATE TRIGGER project_observer_metric_trigger/i,
  );
});

test("runtime dependencies use PostgreSQL via Bun.SQL and contain no Redis adapters", async () => {
  const pkg = JSON.parse(await text("package.json"));
  assert.equal(pkg.dependencies.pg, undefined);
  assert.equal(pkg.dependencies["@tursodatabase/database"], undefined);
  for (const dependency of [
    "ioredis",
    "aedes-persistence-redis",
    "mqemitter-redis",
  ]) {
    assert.equal(pkg.dependencies[dependency], undefined);
  }
});

test("compose has exactly one service, one shared port, and the fixed bind destination", async () => {
  const compose = await text("compose.yaml.example");
  assert.match(compose, /^services:\n {2}meshcore-mqtt-broker:/);
  assert.doesNotMatch(compose, /depends_on|valkey|redis|environment:/i);
  assert.match(compose, /"443:8883"/);
  assert.doesNotMatch(compose, /"8080:8080"/);
  assert.match(
    compose,
    /\.\/data\/meshcore-mqtt-broker:\/data\/meshcore-mqtt-broker/,
  );
});

test("entrypoint validates and narrowly prepares the fixed data directory", async () => {
  const entrypoint = await text("docker-entrypoint.sh");
  assert.match(entrypoint, /DATA_DIR=\/data\/meshcore-mqtt-broker/);
  assert.match(entrypoint, /mkdir -p -m 0750/);
  assert.match(entrypoint, /chown bun:bun "\$DATA_DIR"/);
  assert.doesNotMatch(entrypoint, /chown\s+-R|chmod\s+-R|777/);
  assert.match(entrypoint, /test -r .*test -w/);
  assert.match(
    entrypoint,
    /exec setpriv --reuid=bun --regid=bun --init-groups "\$@"/,
  );
  assert.doesNotMatch(entrypoint, /exec su /);
});

test("healthcheck and published image run with the intended platforms and user", async () => {
  const dockerfile = await text("Dockerfile");
  const workflow = await text(".github/workflows/build-image-broker.yml");
  assert.match(
    dockerfile,
    /HEALTHCHECK .*\["setpriv", "--reuid=bun", "--regid=bun"/,
  );
  assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(dockerfile, /^EXPOSE 8883$/m);
  assert.doesNotMatch(dockerfile, /^EXPOSE .*8080/m);
});

test("example config does not ship enabled accounts with known passwords", async () => {
  const config = await text("config.yaml");
  assert.match(config, /^ {2}users: \[\]$/m);
  assert.doesNotMatch(
    config,
    /^\s+password: (?:admin-password-here|limited-password|your-secure-password-here)$/m,
  );
});

test("container config discovery preserves the absolute Docker config path", async () => {
  const configSource = await text("src/config.ts");
  assert.match(
    configSource,
    /DEFAULT_CONFIG_PATHS\.map\(\(path\) => resolve\(process\.cwd\(\), path\)\)/,
  );
  assert.match(
    configSource,
    /"\/run\/configs\/meshcore-mqtt-broker-config\.yaml"/,
  );
});

test("test database setup is explicitly PostgreSQL-only", async () => {
  const helper = await text("tests/test-database.mjs");
  assert.match(helper, /POSTGRES_TEST_URL/);
  assert.match(helper, /DROP SCHEMA IF EXISTS meshcore_private CASCADE/);
  assert.match(helper, /DROP SCHEMA IF EXISTS meshcore_public CASCADE/);
  assert.doesNotMatch(
    helper,
    /DATABASE_HOST|DATABASE_PASSWORD_FILE|sqlite|turso/i,
  );
});
