import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { request } from "node:http";
import { createAuthToken } from "@michaelhart/meshcore-decoder";
import { afterEach, test } from "@jest/globals";
import WebSocket from "ws";
import { startBrokerServer } from "../dist/server.js";
import {
  resetConfigCacheForTests,
  setConfigDocumentForTests,
} from "../dist/config.js";
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
    dashboard: { port: 0 },
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
    IATA_whitelist: overrides.IATA_whitelist ?? true,
    allowed_regions: overrides.allowed_regions ?? {
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

function publishPacket(subtopic, body, retain = true, region = "STO") {
  return {
    cmd: "publish",
    topic: `meshcore/${region}/${PUBLIC_KEY}/${subtopic}`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, ...body })),
    qos: 0,
    retain,
    dup: false,
  };
}

function httpResponse(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res));
    });
    req.on("error", reject);
    req.end();
  });
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
      "SELECT reason, region FROM denied_publish_events WHERE public_key = ? LIMIT 1",
      PUBLIC_KEY,
    );
    if (!denied) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(denied.reason, "Invalid IATA format");
  assert.equal(denied.region, "sto");
  assert.equal(
    await database.get(
      "SELECT 1 AS found FROM trust_state WHERE public_key = ? LIMIT 1",
      PUBLIC_KEY,
    ),
    undefined,
  );
});

test("disabled whitelist accepts any valid region and ignores allowed_regions", async () => {
  const broker = await runtime({
    IATA_whitelist: false,
    allowed_regions: { STO: { friendly_name: "Stockholm" } },
  });
  const observer = await publisher(broker.aedes, "open-regions");
  await authorize(
    broker.aedes,
    observer,
    publishPacket("packets", { value: 1 }, false, "ABC"),
  );
});

test("enabled whitelist accepts primaries and rejects a secondary with correction", async () => {
  const broker = await runtime({
    IATA_whitelist: true,
    allowed_regions: {
      MMX: {
        friendly_name: "Southern region",
        secondary_region: "AGH, KID",
      },
    },
  });
  const database = fixtures[fixtures.length - 1].database;
  const observer = await publisher(broker.aedes, "secondary-region");
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
      "SELECT denied_until_text FROM denied_publish_events WHERE public_key = ? AND region = ? LIMIT 1",
      PUBLIC_KEY,
      "AGH",
    );
    if (!denied) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(denied.denied_until_text, "Use primary region MMX for AGH");
});

test("enabled whitelist rejects unknown regions but keeps test behavior", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "unknown-region");
  await assert.rejects(
    authorize(
      broker.aedes,
      observer,
      publishPacket("packets", { value: 1 }, false, "ABC"),
    ),
    /not allowed/i,
  );
  await authorize(
    broker.aedes,
    observer,
    publishPacket("packets", { value: 2 }, false, "test"),
  );
});

test("MQTT-port HTTP fallback is fixed and request-independent", async () => {
  const broker = await runtime();
  for (const [path, headers] of [
    ["/", {}],
    ["/change?target=https://example.org", { host: "attacker.example" }],
  ]) {
    const response = await httpResponse(broker.port, path, headers);
    assert.equal(response.statusCode, 301);
    assert.equal(
      response.headers.location,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  }
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

test("publish followed by immediate disconnect persists latest neighbors", async () => {
  const broker = await runtime();
  const database = fixtures[fixtures.length - 1].database;
  const observer = await publisher(broker.aedes, "quick-neighbors");
  broker.aedes.emit("client", observer);
  const neighbors = publishPacket("neighbors", { neighbors: [] });
  await authorize(broker.aedes, observer, neighbors);
  broker.aedes.emit("publish", neighbors, observer);
  broker.aedes.emit("clientDisconnect", observer);

  let row;
  for (let attempt = 0; attempt < 20 && !row?.neighbors_json; attempt += 1) {
    row = await database.get(
      `SELECT active, neighbors_json FROM observer_state
       WHERE public_key = ? LIMIT 1`,
      PUBLIC_KEY,
    );
    if (!row?.neighbors_json) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  assert.equal(Number(row.active), 0);
  assert.equal(typeof row.neighbors_json, "string");
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

test("stale observer status timestamps remain rejected through Turso", async () => {
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
