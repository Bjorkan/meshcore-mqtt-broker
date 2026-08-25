import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createAuthToken } from "@michaelhart/meshcore-decoder";
import { afterEach, test } from "bun:test";
import WebSocket from "ws";
import { startBrokerServer } from "../src/server.js";
import { readDockerHealthCredentials } from "../src/docker-health-user.js";
import { runMqttLoopbackHealthcheck } from "../src/healthcheck.js";
import {
  resetConfigCacheForTests,
  setConfigDocumentForTests,
} from "../src/config.js";
import { temporaryDatabase } from "./test-database.mjs";

const PRIVATE_KEY =
  "18469d6140447f77de13cd8d761e605431f52269fbff43b0925752ed9e6745435dc6a86d2568af8b70d3365db3f88234760c8ecc645ce469829bc45b65f1d5d5";
const PUBLIC_KEY =
  "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";
const AUDIENCE = "runtime-test";
const fixtures = [];
const runtimes = [];

afterEach(async () => {
  while (runtimes.length) await runtimes.pop().stop();
  while (fixtures.length) await fixtures.pop().cleanup();
  resetConfigCacheForTests();
});

function testConfig(overrides = {}) {
  return {
    mqtt: {
      ws_port: 0,
      host: "127.0.0.1",
      json_publish_max_bytes: 8192,
      ws_max_payload_bytes: 65536,
    },
    broker: { name: "LocalTest", node_name_cache_ttl_ms: 60000 },
    auth: { expected_audience: AUDIENCE },
    subscribers: {
      default_max_connections: 1,
      users: [{ username: "viewer", password: "secret", role: 2 }],
    },
    meshcore_io: { enabled: false },
    target_mqtt: { url: "" },
    abuse: {
      enforcement_enabled: false,
      duplicate_window_size: 100,
      duplicate_window_ms: 300000,
      duplicate_threshold: 10,
      bucket_capacity: 20,
      bucket_refill_rate: 3,
      max_packet_size: 255,
      max_topics_per_day: 3,
      anomaly_threshold: 10,
      max_iata_changes_24h: 3,
      topic_history_size: 50,
      topic_history_window_ms: 86400000,
    },
    iata: {
      allowlist_enabled: overrides.allowlist_enabled ?? true,
      allow_test_ingress: overrides.allow_test_ingress ?? false,
    },
    allowed_iata: overrides.allowed_iata ?? {
      STO: { friendly_name: "Stockholm" },
    },
  };
}

async function runtime(overrides = {}) {
  const fixture = await temporaryDatabase("runtime-");
  fixtures.push(fixture);
  setConfigDocumentForTests(testConfig(overrides));
  const broker = await startBrokerServer(undefined, {
    database: fixture.database,
  });
  runtimes.push(broker);
  return broker;
}

function client(id) {
  return {
    id,
    conn: { destroyed: false, transportClosed: false, clientIP: "127.0.0.1" },
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

function authenticate(aedes, value, username, password) {
  return new Promise((resolve, reject) => {
    aedes.authenticate(
      value,
      username,
      Buffer.from(password),
      (error, accepted) => (error ? reject(error) : resolve(accepted)),
    );
  });
}

function authorize(aedes, value, packet) {
  return new Promise((resolve, reject) => {
    aedes.authorizePublish(value, packet, (error) =>
      error ? reject(error) : resolve(packet),
    );
  });
}

async function publisher(aedes, id) {
  const value = client(id);
  const token = await createAuthToken(
    {
      publicKey: PUBLIC_KEY,
      aud: AUDIENCE,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    PRIVATE_KEY,
    PUBLIC_KEY,
  );
  assert.equal(
    await authenticate(aedes, value, `v1_${PUBLIC_KEY}`, token),
    true,
  );
  return value;
}

function publishPacket(subtopic, body, retain = true, iata = "STO") {
  return {
    cmd: "publish",
    topic: `meshcore/${iata}/${PUBLIC_KEY}/${subtopic}`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, ...body })),
    qos: 0,
    retain,
    dup: false,
  };
}

test("newest local observer connection replaces the old owner and stale disconnect is harmless", async () => {
  const broker = await runtime();
  const first = await publisher(broker.aedes, "first");
  const second = await publisher(broker.aedes, "second");
  assert.equal(first.closed, true);
  broker.aedes.emit("clientDisconnect", first);
  await authorize(broker.aedes, second, publishPacket("packets", { value: 1 }));
  await assert.rejects(
    authorize(broker.aedes, first, publishPacket("packets", { value: 2 })),
    /does not own observer claim/i,
  );
});

test("replacement authentication waits for in-flight publish authorization", async () => {
  const broker = await runtime();
  const database = fixtures[fixtures.length - 1].database;
  const first = await publisher(broker.aedes, "first-in-flight");
  const originalGet = database.get.bind(database);
  let releaseLookup;
  let lookupStarted;
  const lookupGate = new Promise((resolve) => {
    releaseLookup = resolve;
  });
  const enteredLookup = new Promise((resolve) => {
    lookupStarted = resolve;
  });
  let delayed = false;
  database.get = async (sql, ...parameters) => {
    if (!delayed && sql.includes("FROM trust_state")) {
      delayed = true;
      lookupStarted();
      await lookupGate;
    }
    return originalGet(sql, ...parameters);
  };

  const inFlightPacket = publishPacket("packets", { value: 1 });
  const inFlight = authorize(broker.aedes, first, inFlightPacket);
  await enteredLookup;
  const replacement = publisher(broker.aedes, "second-in-flight");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(first.closed, false);
  releaseLookup();
  await inFlight;
  broker.aedes.emit("publish", inFlightPacket, first);
  const second = await replacement;
  assert.equal(first.closed, true);
  await authorize(broker.aedes, second, publishPacket("packets", { value: 2 }));
});

test("publisher compatibility keeps arbitrary public subtopics and strips retain except neighbors", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "publisher");
  const extension = publishPacket("vendor/extension", { value: true });
  await authorize(broker.aedes, observer, extension);
  assert.equal(extension.retain, false);
  const nestedNeighbors = publishPacket("vendor/neighbors", { value: true });
  await authorize(broker.aedes, observer, nestedNeighbors);
  assert.equal(nestedNeighbors.retain, false);
  const neighbors = publishPacket("neighbors", { neighbors: [] });
  await authorize(broker.aedes, observer, neighbors);
  assert.equal(neighbors.retain, true);
  const status = publishPacket("status", { timestamp: Date.now() });
  await authorize(broker.aedes, observer, status);
  assert.equal(status.retain, false);
});

test("always discards the deprecated raw subtopic before storage or delivery", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "raw-discard");
  await assert.rejects(
    authorize(broker.aedes, observer, publishPacket("raw", { raw: "00" })),
    /raw MQTT subtopic is not supported/i,
  );
});

test("malformed IATA publishes are recorded as denied events without abuse state", async () => {
  const broker = await runtime();
  const database = fixtures[fixtures.length - 1].database;
  const observer = await publisher(broker.aedes, "bad-iata");
  const value = publishPacket("packets", { value: 1 });
  value.topic = `meshcore/sto/${PUBLIC_KEY}/packets`;
  await assert.rejects(authorize(broker.aedes, observer, value), /uppercase/i);
  let denied;
  for (let attempt = 0; attempt < 20 && !denied; attempt += 1) {
    denied = await database.get(
      "SELECT reason, iata FROM denied_publish_events WHERE public_key = $1 LIMIT 1",
      PUBLIC_KEY,
    );
    if (!denied) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(denied.reason, "Invalid IATA format");
  assert.equal(denied.iata, null);
  assert.equal(
    await database.get(
      "SELECT 1 AS found FROM trust_state WHERE public_key = $1 LIMIT 1",
      PUBLIC_KEY,
    ),
    undefined,
  );
});

test("enabled allowlist accepts primary IATA and rejects secondary IATA with correction", async () => {
  const broker = await runtime({
    allowlist_enabled: true,
    allowed_iata: {
      MMX: {
        friendly_name: "Southern IATA area",
        secondary_iata: "AGH, KID",
      },
    },
  });
  const database = fixtures[fixtures.length - 1].database;
  const observer = await publisher(broker.aedes, "secondary-iata");
  await authorize(
    broker.aedes,
    observer,
    publishPacket("packets", { value: 1 }, false, "MMX"),
  );
  await assert.rejects(
    authorize(
      broker.aedes,
      observer,
      publishPacket("packets", { value: 2 }, false, "AGH"),
    ),
    /not allowed/i,
  );
  let denied;
  for (let attempt = 0; attempt < 20 && !denied; attempt += 1) {
    denied = await database.get(
      "SELECT denied_until_text FROM denied_publish_events WHERE public_key = $1 AND iata = $2 LIMIT 1",
      PUBLIC_KEY,
      "AGH",
    );
    if (!denied) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(denied.denied_until_text, "Use primary IATA MMX for AGH");
});

test("enabled allowlist rejects unknown IATA before MQTT history ingest", async () => {
  const broker = await runtime();
  const database = fixtures[fixtures.length - 1].database;
  const observer = await publisher(broker.aedes, "unknown-iata");
  await assert.rejects(
    authorize(
      broker.aedes,
      observer,
      publishPacket("packets", { value: 1 }, false, "ABC"),
    ),
    /not allowed/i,
  );
  assert.equal(
    Number(
      (await database.get("SELECT COUNT(*) AS count FROM mqtt_events")).count,
    ),
    0,
  );
});

test("test MQTT ingress is denied by default and requires the compatibility flag", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "test-ingress-denied");
  await assert.rejects(
    authorize(
      broker.aedes,
      observer,
      publishPacket("packets", { value: 1 }, false, "test"),
    ),
    /test MQTT ingress is disabled/i,
  );

  const compatibleBroker = await runtime({ allow_test_ingress: true });
  const compatibleObserver = await publisher(
    compatibleBroker.aedes,
    "test-ingress-enabled",
  );
  await authorize(
    compatibleBroker.aedes,
    compatibleObserver,
    publishPacket("packets", { value: 2 }, false, "test"),
  );
});

test("trust state is persisted once per interval instead of on every publish", async () => {
  const broker = await runtime();
  const database = fixtures[fixtures.length - 1].database;
  const observer = await publisher(broker.aedes, "throttled-trust-state");
  const originalRun = database.run.bind(database);
  let trustStateWrites = 0;
  database.run = async (sql, ...parameters) => {
    if (sql.includes("INSERT INTO trust_state")) trustStateWrites += 1;
    return originalRun(sql, ...parameters);
  };
  try {
    for (let index = 0; index < 3; index += 1) {
      await authorize(
        broker.aedes,
        observer,
        publishPacket("status", { timestamp: Date.now() }),
      );
    }
  } finally {
    database.run = originalRun;
  }
  assert.equal(trustStateWrites, 1);
  const row = await database.get(
    "SELECT 1 AS found FROM trust_state WHERE public_key = $1",
    PUBLIC_KEY,
  );
  assert.equal(Number(row.found), 1);
});

test("repeated denials from one key and reason are recorded once per interval", async () => {
  const broker = await runtime();
  const database = fixtures[fixtures.length - 1].database;
  for (let index = 0; index < 3; index += 1) {
    const observer = await publisher(broker.aedes, `denial-throttle-${index}`);
    const value = publishPacket("packets", { value: index });
    value.topic = `meshcore/sto/${PUBLIC_KEY}/packets`;
    await assert.rejects(
      authorize(broker.aedes, observer, value),
      /uppercase/i,
    );
  }
  let row;
  for (let attempt = 0; attempt < 40 && !row; attempt += 1) {
    row = await database.get(
      "SELECT COUNT(*) AS count FROM denied_publish_events WHERE public_key = $1",
      PUBLIC_KEY,
    );
    if (Number(row.count) === 0) {
      row = undefined;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  assert.ok(row);
  assert.equal(Number(row.count), 1);
});

test("WebSocket upgrades remain available on the MQTT port", async () => {
  const broker = await runtime();
  const socket = new WebSocket(`ws://127.0.0.1:${broker.port}`);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.close();
});

test("authenticated MQTT loopback remains available", async () => {
  const broker = await runtime();
  const credentials = readDockerHealthCredentials(
    broker.healthcheckCredentialsFile,
  );

  await runMqttLoopbackHealthcheck({
    url: `ws://127.0.0.1:${broker.port}`,
    username: credentials.username,
    password: credentials.password,
    topic: "healthcheck/docker_health",
    payload: "shared-listener-loopback",
    timeoutMs: 2_000,
    keepAliveSeconds: 0,
    clientId: "shared-listener-runtime-test",
  });
});

test("subscriber limits are in-process and cleanup permits a replacement", async () => {
  const broker = await runtime();
  const first = client("viewer-one");
  const second = client("viewer-two");
  assert.equal(
    await authenticate(broker.aedes, first, "viewer", "secret"),
    true,
  );
  assert.equal(
    await authenticate(broker.aedes, second, "viewer", "secret"),
    false,
  );
  broker.aedes.emit("clientDisconnect", first);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    await authenticate(broker.aedes, second, "viewer", "secret"),
    true,
  );
});

test("failed CONNECT releases a subscriber reservation before registration", async () => {
  const broker = await runtime();
  const failed = client("viewer-failed-connect");
  failed.conn = Object.assign(new EventEmitter(), failed.conn);
  assert.equal(
    await authenticate(broker.aedes, failed, "viewer", "secret"),
    true,
  );
  failed.conn.destroyed = true;
  failed.conn.emit("close");
  await new Promise((resolve) => setImmediate(resolve));

  const replacement = client("viewer-after-failure");
  assert.equal(
    await authenticate(broker.aedes, replacement, "viewer", "secret"),
    true,
  );
  broker.aedes.emit("client", replacement);
});

test("stale observer status timestamps remain rejected through PostgreSQL", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "status-publisher");
  await authorize(
    broker.aedes,
    observer,
    publishPacket("status", { timestamp: "2026-01-02T00:00:00.000Z" }),
  );
  const stale = publishPacket("status", {
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  await authorize(broker.aedes, observer, stale);
  assert.match(stale.topic, /^\$SYS\/.*\/discarded-status$/);
});
