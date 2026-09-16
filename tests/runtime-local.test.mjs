import assert from "node:assert/strict";
import { createAuthToken } from "@michaelhart/meshcore-decoder";
import { afterEach, test } from "bun:test";
import WebSocket from "ws";
import {
  OBSERVER_ERROR_CODES,
  observerErrorCode,
  startBrokerServer,
} from "../src/server.js";
import { readDockerHealthCredentials } from "../src/docker-health-user.js";
import { runMqttLoopbackHealthcheck } from "../src/healthcheck.js";
import {
  resetConfigCacheForTests,
  setConfigDocumentForTests,
} from "../src/config.js";

const PRIVATE_KEY =
  "18469d6140447f77de13cd8d761e605431f52269fbff43b0925752ed9e6745435dc6a86d2568af8b70d3365db3f88234760c8ecc645ce469829bc45b65f1d5d5";
const PUBLIC_KEY =
  "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";
const AUDIENCE = "runtime-test";
const runtimes = [];

afterEach(async () => {
  while (runtimes.length) await runtimes.pop().stop();
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
      max_duplicates_per_packet: 5,
      duplicate_rate_threshold: 0.3,
      duplicate_rate_window_ms: 300000,
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
  setConfigDocumentForTests(testConfig(overrides));
  const broker = await startBrokerServer(undefined);
  runtimes.push(broker);
  return broker;
}

function client(id) {
  return {
    id,
    conn: { destroyed: false, transportClosed: false },
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
      (error, accepted) => {
        if (error) {
          error.accepted = accepted;
          reject(error);
        } else {
          resolve(accepted);
        }
      },
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

async function token(payloadOverrides = {}) {
  return createAuthToken(
    {
      publicKey: PUBLIC_KEY,
      aud: AUDIENCE,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payloadOverrides,
    },
    PRIVATE_KEY,
    PUBLIC_KEY,
  );
}

async function publisher(aedes, id) {
  const value = client(id);
  assert.equal(
    await authenticate(aedes, value, `v1_${PUBLIC_KEY}`, await token()),
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

test("tokens older than the configured max age are rejected with a code", async () => {
  const value = client("stale-token");
  setConfigDocumentForTests({
    ...testConfig(),
    auth: { expected_audience: AUDIENCE, token_max_age_seconds: 3600 },
  });
  const stale = await startBrokerServer(undefined);
  runtimes.push(stale);
  const old = await token({
    iat: Math.floor(Date.now() / 1000) - 7200,
  });
  const error = await authenticate(
    stale.aedes,
    value,
    `v1_${PUBLIC_KEY}`,
    old,
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(error.returnCode, 5);
  assert.equal(observerErrorCode(error), OBSERVER_ERROR_CODES.AUTH_STALE_TOKEN);
  assert.match(String(error.message), /\[AUTH_STALE_TOKEN\]/);
});

test("wrong audience is rejected with AUTH_WRONG_AUDIENCE", async () => {
  const broker = await runtime();
  const value = client("wrong-aud");
  const bad = await token({ aud: "somewhere-else" });
  const error = await authenticate(
    broker.aedes,
    value,
    `v1_${PUBLIC_KEY}`,
    bad,
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(error.returnCode, 5);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.AUTH_WRONG_AUDIENCE,
  );
});

test("invalid username format is rejected with a code", async () => {
  const broker = await runtime();
  const value = client("bad-username");
  const error = await authenticate(
    broker.aedes,
    value,
    "not-a-publisher",
    "secret",
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.AUTH_INVALID_USERNAME_FORMAT,
  );
});

test("missing token is rejected with AUTH_MISSING_TOKEN", async () => {
  const broker = await runtime();
  const value = client("missing-token");
  const error = await authenticate(
    broker.aedes,
    value,
    `v1_${PUBLIC_KEY}`,
    "",
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.AUTH_MISSING_TOKEN,
  );
});

test("subscriber over the connection limit gets SUBSCRIBER_CONNECTION_LIMIT", async () => {
  const broker = await runtime();
  const first = client("viewer-one");
  const second = client("viewer-two");
  assert.equal(
    await authenticate(broker.aedes, first, "viewer", "secret"),
    true,
  );
  const error = await authenticate(
    broker.aedes,
    second,
    "viewer",
    "secret",
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.SUBSCRIBER_CONNECTION_LIMIT,
  );
  broker.aedes.emit("clientDisconnect", first);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    await authenticate(broker.aedes, second, "viewer", "secret"),
    true,
  );
});

test("newest observer connection replaces the old owner and stale publish is coded", async () => {
  const broker = await runtime();
  const first = await publisher(broker.aedes, "first");
  const second = await publisher(broker.aedes, "second");
  assert.equal(first.closed, true);
  broker.aedes.emit("clientDisconnect", first);
  await authorize(broker.aedes, second, publishPacket("packets", { value: 1 }));
  const error = await authorize(
    broker.aedes,
    first,
    publishPacket("packets", { value: 2 }),
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_STALE_CONNECTION,
  );
});

test("accepted publishes forward to meshcore-io and target without persistence", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "forward-path");
  const value = publishPacket("packets", { value: 1 }, false);
  await authorize(broker.aedes, observer, value);
  broker.aedes.emit("publish", value, observer);
  broker.aedes.emit("publish", value, observer);
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

test("deprecated raw subtopic is denied with PUBLISH_RESERVED_SUBTOPIC", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "raw-discard");
  const error = await authorize(
    broker.aedes,
    observer,
    publishPacket("raw", { raw: "00" }),
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
  );
});

test("malformed IATA publish is denied with PUBLISH_INVALID_IATA_FORMAT", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "bad-iata");
  const value = publishPacket("packets", { value: 1 });
  value.topic = `meshcore/sto/${PUBLIC_KEY}/packets`;
  const error = await authorize(broker.aedes, observer, value).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_INVALID_IATA_FORMAT,
  );
  assert.match(String(error.message), /uppercase/);
});

test("placeholder XXX publish is denied with PUBLISH_PLACEHOLDER_IATA and closes", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "placeholder-iata");
  const value = publishPacket("packets", { value: 1 }, false, "XXX");
  const error = await authorize(broker.aedes, observer, value).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_PLACEHOLDER_IATA,
  );
  assert.equal(observer.closed, true);
});

test("secondary IATA is denied with PUBLISH_SECONDARY_IATA correction", async () => {
  const broker = await runtime({
    allowlist_enabled: true,
    allowed_iata: {
      MMX: {
        friendly_name: "Southern IATA area",
        secondary_iata: "AGH, KID",
      },
    },
  });
  const observer = await publisher(broker.aedes, "secondary-iata");
  await authorize(
    broker.aedes,
    observer,
    publishPacket("packets", { value: 1 }, false, "MMX"),
  );
  const error = await authorize(
    broker.aedes,
    observer,
    publishPacket("packets", { value: 2 }, false, "AGH"),
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_SECONDARY_IATA,
  );
  assert.match(String(error.message), /Use primary IATA MMX for AGH/);
});

test("unknown IATA is denied with PUBLISH_UNKNOWN_IATA", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "unknown-iata");
  const error = await authorize(
    broker.aedes,
    observer,
    publishPacket("packets", { value: 1 }, false, "ABC"),
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_UNKNOWN_IATA,
  );
});

test("test MQTT ingress is denied by default with a code", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "test-ingress-denied");
  const error = await authorize(
    broker.aedes,
    observer,
    publishPacket("packets", { value: 1 }, false, "test"),
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_TEST_INGRESS_DISABLED,
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

test("public key mismatch is denied with PUBLISH_KEY_MISMATCH and closes", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "key-mismatch");
  const value = publishPacket("packets", { value: 1 });
  value.topic = `meshcore/STO/${"0".repeat(64)}/packets`;
  const error = await authorize(broker.aedes, observer, value).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_KEY_MISMATCH,
  );
  assert.equal(observer.closed, true);
});

test("origin_id mismatch is denied with PUBLISH_ORIGIN_MISMATCH", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "origin-mismatch");
  const value = publishPacket("packets", { value: 1 });
  value.payload = Buffer.from(JSON.stringify({ origin_id: "0".repeat(64) }));
  const error = await authorize(broker.aedes, observer, value).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_ORIGIN_MISMATCH,
  );
});

test("missing origin_id is denied with PUBLISH_ORIGIN_MISSING", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "origin-missing");
  const value = publishPacket("packets", { value: 1 });
  value.payload = Buffer.from(JSON.stringify({ value: 1 }));
  const error = await authorize(broker.aedes, observer, value).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_ORIGIN_MISSING,
  );
});

test("observers can subscribe to their own error topic", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "error-sub");
  await new Promise((resolve, reject) => {
    broker.aedes.authorizeSubscribe(
      observer,
      { topic: `meshcore/STO/${PUBLIC_KEY}/error`, qos: 0 },
      (error) => (error ? reject(error) : resolve(undefined)),
    );
  });
});

test("observers cannot publish to the broker-owned error topic", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "error-pub");
  const error = await authorize(
    broker.aedes,
    observer,
    publishPacket("error", { value: 1 }),
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
  );
});

test("denial codes are also pushed to the observer error topic", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "error-notify");
  const delivered = [];
  const originalPublish = broker.aedes.publish.bind(broker.aedes);
  broker.aedes.publish = (packet, callback) => {
    if (String(packet.topic).endsWith("/error")) {
      delivered.push(packet);
    }
    return originalPublish(packet, callback);
  };
  try {
    const value = publishPacket("packets", { value: 1 });
    value.topic = `meshcore/sto/${PUBLIC_KEY}/packets`;
    await authorize(broker.aedes, observer, value).then(
      () => undefined,
      (failure) => failure,
    );
    assert.equal(delivered.length, 1);
    assert.match(delivered[0].topic, /\/error$/);
    const body = JSON.parse(delivered[0].payload.toString("utf8"));
    assert.equal(body.code, OBSERVER_ERROR_CODES.PUBLISH_INVALID_IATA_FORMAT);
    assert.equal(typeof body.message, "string");
  } finally {
    broker.aedes.publish = originalPublish;
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

test("GET /status reports stateless operation", async () => {
  const broker = await runtime();
  const response = await fetch(`http://127.0.0.1:${broker.port}/status`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type"), /^application\/json/);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.storage, "stateless");

  const missing = await fetch(`http://127.0.0.1:${broker.port}/anything-else`);
  assert.equal(missing.status, 404);
  const wrongMethod = await fetch(`http://127.0.0.1:${broker.port}/status`, {
    method: "POST",
  });
  assert.equal(wrongMethod.status, 405);
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

test("stale observer status timestamps are quarantined in-process", async () => {
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
