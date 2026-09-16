import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "bun:test";

const root = process.cwd();
const text = (file) => readFile(path.join(root, file), "utf8");

test("stateless broker has no database, persistence, or IP-blocking code", async () => {
  const server = await text("src/server.ts");
  for (const token of [
    "Postgres",
    "postgres",
    "ApplicationDatabase",
    "state-store",
    "mqtt-history",
    "mqttHistory",
    "stateStore",
    "RateLimiter",
    "rate-limiter",
    "getClientIP",
    "clientIP",
    "DATABASE_",
    "POSTGRES_",
    "meshcore_private",
    "meshcore_public",
  ]) {
    assert.ok(
      !server.includes(token),
      `src/server.ts must not reference ${token}`,
    );
  }
  const detector = await text("src/abuse-detector.ts");
  assert.doesNotMatch(detector, /recordFailure|isBlocked|recentIP/i);
  assert.match(detector, /observe-only/);
});

test("observer error codes are stable and documented", async () => {
  const server = await text("src/server.ts");
  assert.match(server, /OBSERVER_ERROR_CODES/);
  assert.match(server, /AUTH_WRONG_AUDIENCE/);
  assert.match(server, /PUBLISH_UNKNOWN_IATA/);
  assert.match(server, /meshcore\/\$\{iata\}\/\$\{publicKey\}\/error/);
});

test("runtime dependencies contain no database or Redis adapters", async () => {
  const pkg = JSON.parse(await text("package.json"));
  for (const dependency of [
    "pg",
    "ioredis",
    "aedes-persistence-redis",
    "mqemitter-redis",
    "@tursodatabase/database",
  ]) {
    assert.equal(pkg.dependencies[dependency], undefined);
  }
  assert.equal(pkg.dependencies["@msgpack/msgpack"], undefined);
  assert.equal(pkg.dependencies.ini, undefined);
});

test("compose has exactly one service, one config mount, and no database", async () => {
  const compose = await text("compose.yaml.example");
  assert.match(compose, /^services:\n {2}meshcore-mqtt-broker:/);
  assert.doesNotMatch(
    compose,
    /depends_on|valkey|redis|postgres|DATABASE_|environment:/i,
  );
  assert.match(compose, /"443:8883"/);
  assert.doesNotMatch(compose, /"8080:8080"/);
  // The config file is the ONLY mount, strictly read-only. No volumes, no
  // /data, nothing persisted.
  assert.match(
    compose,
    /\.\/config\.yaml:\/run\/configs\/meshcore-mqtt-broker-config\.yaml:ro/,
  );
  assert.doesNotMatch(compose, /\/data\//);
});

test("entrypoint only drops privileges, prepares no data directory", async () => {
  const entrypoint = await text("docker-entrypoint.sh");
  assert.doesNotMatch(entrypoint, /DATA_DIR=\/data\/meshcore-mqtt-broker/);
  assert.doesNotMatch(entrypoint, /mkdir|chown|chmod/);
  assert.doesNotMatch(entrypoint, /\/data\//);
  assert.match(
    entrypoint,
    /exec setpriv --reuid=bun --regid=bun --init-groups "\$@"/,
  );
  assert.doesNotMatch(entrypoint, /exec su /);
});

test("broker writes no files at runtime: no volume, no persistence code", async () => {
  for (const file of [
    "src/docker-health-user.ts",
    "src/instance-id.ts",
    "src/config.ts",
    "src/server.ts",
    "src/cli.ts",
    "src/target-bridge.ts",
    "src/healthcheck.ts",
  ]) {
    const source = await text(file);
    assert.doesNotMatch(
      source,
      /writeFileSync|mkdirSync|renameSync|chmodSync|appendFile|createWriteStream/,
      `${file} must not write files`,
    );
  }
  const dockerHealth = await text("src/docker-health-user.ts");
  assert.doesNotMatch(dockerHealth, /readFileSync/);
  const instanceId = await text("src/instance-id.ts");
  assert.doesNotMatch(instanceId, /readFileSync|existsSync/);
  assert.doesNotMatch(instanceId, /\/data\//);
  assert.doesNotMatch(dockerHealth, /\/data\//);
  const compose = await text("compose.yaml.example");
  assert.doesNotMatch(compose, /\/data\//);
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
  assert.doesNotMatch(config, /DATABASE_PASSWORD/);
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

test("no postgres helpers, scripts, or database files remain", async () => {
  for (const file of [
    "compose.test.yaml",
    "compose.postgres.yaml.example",
    "src/database.ts",
    "src/state-store.ts",
    "src/mqtt-history.ts",
    "src/aedes-persistence-postgres.ts",
    "src/rate-limiter.ts",
    "src/ip-utils.ts",
    "src/stored-packet-codec.ts",
    "src/node-adverts.ts",
    "src/channel-key-registry.ts",
    "src/meshcore-packet-decoder.ts",
    "src/logical-packet-identity.ts",
    "src/metric-units.ts",
    "src/mqtt-history-repositories.ts",
    "src/mqtt-history-topic.ts",
    "src/region-scope-aggregate.ts",
    "src/schema-migration.ts",
    "tests/test-database.mjs",
    "tests/fixtures/mqtt-history.json",
    "tests/aedes-persistence-postgres.test.mjs",
    "tests/channel-key-registry.test.mjs",
    "tests/database.test.mjs",
    "tests/ip-utils.test.mjs",
    "tests/logical-packet-identity.test.mjs",
    "tests/metric-units.test.mjs",
    "tests/mqtt-history-topic.test.mjs",
    "tests/mqtt-history.test.mjs",
    "tests/nodes.test.mjs",
    "tests/rate-limiter.test.mjs",
    "tests/schema-migration.test.mjs",
    "tests/state-store.test.mjs",
    "tests/stored-packet-backfill.test.mjs",
    "tests/stored-packet-codec.test.mjs",
    "scripts/benchmark-history-queue.ts",
    "scripts/benchmark-observer-metrics.ts",
    "scripts/benchmark-projection-write-amplification.ts",
    "scripts/benchmark-retention-layout.ts",
    "scripts/capture-db-performance.ts",
    "scripts/migrate-schema.ts",
    "scripts/migrate-stored-packets.mjs",
    "scripts/optimize-timescale.ts",
    "scripts/sync-schema-asset.ts",
    "scripts/test-db-down.mjs",
    "scripts/test-db-up.mjs",
    "scripts/test-with-postgres.mjs",
  ]) {
    await assert.rejects(
      readFile(path.join(root, file), "utf8"),
      /ENOENT/,
      `${file} should be removed`,
    );
  }
  for (const file of ["DATABASE.md", "INGEST.md"]) {
    await assert.rejects(
      readFile(path.join(root, file), "utf8"),
      /ENOENT/,
      `${file} should be removed`,
    );
  }
});
