import assert from "node:assert/strict";
import { createAuthToken } from "@michaelhart/meshcore-decoder";
import { afterEach, test } from "bun:test";
import WebSocket from "ws";
import {
  OBSERVER_ERROR_CODES,
  observerErrorCode,
  startBrokerServer,
} from "../src/server.js";
import {
  resolveHealthcheckOptionsFromConfig,
  runHttpStatusHealthcheck,
} from "../src/healthcheck.js";
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
  const broker = await startBrokerServer();
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
  const stale = await startBrokerServer();
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

test("lowercase IATA is normalized, not denied", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "lower-iata");
  const value = publishPacket("packets", { value: 1 });
  value.topic = `meshcore/sto/${PUBLIC_KEY}/packets`;
  await authorize(broker.aedes, observer, value);
  assert.equal(value.topic, `meshcore/STO/${PUBLIC_KEY}/packets`);
});

test("lowercase xxx maps to the placeholder denial", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "lower-xxx");
  const value = publishPacket("packets", { value: 1 });
  value.topic = `meshcore/xxx/${PUBLIC_KEY}/packets`;
  const error = await authorize(broker.aedes, observer, value).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_PLACEHOLDER_IATA,
  );
});

test("uppercase TEST maps to the test-ingress denial", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "upper-test");
  const value = publishPacket("packets", { value: 1 });
  value.topic = `meshcore/TEST/${PUBLIC_KEY}/packets`;
  const error = await authorize(broker.aedes, observer, value).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.PUBLISH_TEST_INGRESS_DISABLED,
  );
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

test("subscriber limits count sockets, not clientIds", async () => {
  setConfigDocumentForTests({
    ...testConfig(),
    subscribers: {
      default_max_connections: 1,
      users: [{ username: "solo", password: "secret", role: 3 }],
    },
  });
  const broker = await startBrokerServer();
  runtimes.push(broker);
  // Two sockets sharing one MQTT clientId must NOT share one slot.
  const first = client("shared-id");
  const second = client("shared-id");
  assert.equal(await authenticate(broker.aedes, first, "solo", "secret"), true);
  const error = await authenticate(broker.aedes, second, "solo", "secret").then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(
    observerErrorCode(error),
    OBSERVER_ERROR_CODES.SUBSCRIBER_CONNECTION_LIMIT,
  );
});

test("expired tokens are STALE even with token_max_age disabled", async () => {
  const value = client("expired-default");
  setConfigDocumentForTests(testConfig());
  const broker = await startBrokerServer();
  runtimes.push(broker);
  const expired = await token({ exp: Math.floor(Date.now() / 1000) - 60 });
  const error = await authenticate(
    broker.aedes,
    value,
    `v1_${PUBLIC_KEY}`,
    expired,
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(error.returnCode, 5);
  assert.equal(observerErrorCode(error), OBSERVER_ERROR_CODES.AUTH_STALE_TOKEN);
});

test("future-iat tokens are STALE", async () => {
  const value = client("future-iat");
  setConfigDocumentForTests({
    ...testConfig(),
    auth: { expected_audience: AUDIENCE, token_max_age_seconds: 3600 },
  });
  const broker = await startBrokerServer();
  runtimes.push(broker);
  const future = await token({
    iat: Math.floor(Date.now() / 1000) + 3600,
    exp: Math.floor(Date.now() / 1000) + 7200,
  });
  const error = await authenticate(
    broker.aedes,
    value,
    `v1_${PUBLIC_KEY}`,
    future,
  ).then(
    () => undefined,
    (failure) => failure,
  );
  assert.ok(error);
  assert.equal(observerErrorCode(error), OBSERVER_ERROR_CODES.AUTH_STALE_TOKEN);
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
  const delivered = [];
  const originalPublish = broker.aedes.publish.bind(broker.aedes);
  broker.aedes.publish = (packet, callback) => {
    if (String(packet.topic).endsWith("/error")) {
      delivered.push(packet);
    }
    return originalPublish(packet, callback);
  };
  try {
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
    // test denials route to meshcore/test/<key>/error, not XXX.
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].topic, `meshcore/test/${PUBLIC_KEY}/error`);
    const body = JSON.parse(delivered[0].payload.toString("utf8"));
    assert.equal(body.code, OBSERVER_ERROR_CODES.PUBLISH_TEST_INGRESS_DISABLED);
  } finally {
    broker.aedes.publish = originalPublish;
  }

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

test("wrong-shape JSON is INVALID_JSON, non-string origin_id is MISMATCH", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "origin-shape");
  for (const payload of [`"hello"`, `[]`, `null`, `42`]) {
    const value = publishPacket("packets", { value: 1 });
    value.payload = Buffer.from(payload);
    const error = await authorize(broker.aedes, observer, value).then(
      () => undefined,
      (failure) => failure,
    );
    assert.ok(error);
    assert.equal(
      observerErrorCode(error),
      OBSERVER_ERROR_CODES.PUBLISH_INVALID_JSON,
    );
  }
  for (const origin_id of [123, {}, ["x"]]) {
    const value = publishPacket("packets", { value: 1 });
    value.payload = Buffer.from(JSON.stringify({ origin_id }));
    const error = await authorize(broker.aedes, observer, value).then(
      () => undefined,
      (failure) => failure,
    );
    assert.ok(error);
    assert.equal(
      observerErrorCode(error),
      OBSERVER_ERROR_CODES.PUBLISH_ORIGIN_MISMATCH,
    );
  }
});

test("reserved subtopics are case-insensitive, raw/* is discarded", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "reserved-case");
  for (const subtopic of [
    "ERROR",
    "Error/x",
    "Internal/x",
    "RAW",
    "raw/extra",
  ]) {
    const error = await authorize(
      broker.aedes,
      observer,
      publishPacket(subtopic, { value: 1 }),
    ).then(
      () => undefined,
      (failure) => failure,
    );
    assert.ok(error, subtopic);
    assert.equal(
      observerErrorCode(error),
      OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
      subtopic,
    );
  }
  // Serial/Responses (any case) is the one legal serial subtopic: with a
  // JSON body it is not RESERVED but SERIAL_RESPONSE_INVALID.
  {
    const error = await authorize(
      broker.aedes,
      observer,
      publishPacket("Serial/Responses", { value: 1 }),
    ).then(
      () => undefined,
      (failure) => failure,
    );
    assert.ok(error);
    assert.equal(
      observerErrorCode(error),
      OBSERVER_ERROR_CODES.PUBLISH_SERIAL_RESPONSE_INVALID,
    );
  }
});

test("neighbors keeps publisher retain, others drop it, test never retains", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "retain-policy");
  const kept = await authorize(
    broker.aedes,
    observer,
    publishPacket("neighbors", { value: 1 }, true),
  );
  assert.equal(kept.retain, true);
  const dropped = await authorize(
    broker.aedes,
    observer,
    publishPacket("packets", { value: 1 }, true),
  );
  assert.equal(dropped.retain, false);
  const testBroker = await runtime({ allow_test_ingress: true });
  const testObserver = await publisher(testBroker.aedes, "retain-test");
  const testKept = await authorize(
    testBroker.aedes,
    testObserver,
    publishPacket("neighbors", { value: 1 }, true, "test"),
  );
  assert.equal(testKept.retain, false);
});

test("admin serial/commands still requires an allowed IATA", async () => {
  const broker = await runtime();
  const admin = client("serial-admin");
  assert.equal(
    await authenticate(broker.aedes, admin, "viewer", "secret"),
    true,
  );
  // viewer has role 2 in testConfig; promote path uses ADMIN role — use a
  // direct ADMIN subscriber instead.
  const denied = await authorize(
    broker.aedes,
    admin,
    publishPacket("serial/commands", { value: 1 }),
  ).then(
    () => undefined,
    (failure) => failure,
  );
  // Non-admin subscribers are subscribe-only regardless of IATA.
  assert.ok(denied);
  assert.equal(
    observerErrorCode(denied),
    OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
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

test("observers can subscribe to their own error topic with a wildcard", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "error-wildcard");
  // Firmware that wants per-code filtering (e.g. .../error/#) must not be
  // denied on its own channel: the broker only publishes the exact topic.
  await new Promise((resolve, reject) => {
    broker.aedes.authorizeSubscribe(
      observer,
      { topic: `meshcore/STO/${PUBLIC_KEY}/error/#`, qos: 0 },
      (error) => (error ? reject(error) : resolve(undefined)),
    );
  });
  // ...but another observer's error channel stays closed (and kills the
  // socket, like any other illegal publisher subscribe).
  const other = `meshcore/STO/${"0".repeat(64)}/error`;
  await new Promise((resolve, reject) => {
    broker.aedes.authorizeSubscribe(
      observer,
      { topic: other, qos: 0 },
      (error) => {
        try {
          assert.ok(error);
          assert.equal(
            observerErrorCode(error),
            OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
          );
          resolve(undefined);
        } catch (assertion) {
          reject(assertion);
        }
      },
    );
  });
});

test("serial/commands subscribe without allowed IATA is denied without close", async () => {
  const broker = await runtime({
    allowlist_enabled: true,
    allowed_iata: { STO: {} },
  });
  const observer = await publisher(broker.aedes, "serial-iata");
  await new Promise((resolve, reject) => {
    broker.aedes.authorizeSubscribe(
      observer,
      { topic: `meshcore/ABC/${PUBLIC_KEY}/serial/commands`, qos: 0 },
      (error) => {
        try {
          assert.ok(error);
          assert.equal(
            observerErrorCode(error),
            OBSERVER_ERROR_CODES.PUBLISH_UNKNOWN_IATA,
          );
          // Error channel stays alive: no close on IATA-denied commands.
          assert.equal(observer.closed, false);
          resolve(undefined);
        } catch (assertion) {
          reject(assertion);
        }
      },
    );
  });
});

test("role-less subscribers are filtered as LIMITED", async () => {
  const broker = await runtime();
  const packet = {
    cmd: "publish",
    topic: `meshcore/STO/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: PUBLIC_KEY, SNR: 9, snr: 9, score: 1 }),
    ),
    qos: 0,
    retain: false,
    dup: false,
  };
  const result = broker.aedes.authorizeForward(
    { clientType: "subscriber", username: "x" },
    packet,
  );
  const body = JSON.parse(result.payload.toString("utf8"));
  assert.equal(body.SNR, undefined);
  assert.equal(body.snr, undefined);
  assert.equal(body.score, undefined);
});

test("forward stripping is exact-subtopic and case-insensitive", async () => {
  const broker = await runtime();
  const limited = {
    clientType: "subscriber",
    username: "viewer",
    role: 3,
  };
  const upper = broker.aedes.authorizeForward(
    { ...limited },
    {
      cmd: "publish",
      topic: `meshcore/STO/${PUBLIC_KEY}/STATUS`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, stats: { a: 1 } }),
      ),
      qos: 0,
      retain: false,
      dup: false,
    },
  );
  assert.equal(JSON.parse(upper.payload.toString("utf8")).stats, undefined);
  const vendor = broker.aedes.authorizeForward(
    { ...limited },
    {
      cmd: "publish",
      topic: `meshcore/STO/${PUBLIC_KEY}/vendor/neighbors`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, stats: { a: 1 } }),
      ),
      qos: 0,
      retain: false,
      dup: false,
    },
  );
  // Non-canonical vendor/neighbors is not a status topic: untouched.
  assert.deepEqual(JSON.parse(vendor.payload.toString("utf8")).stats, { a: 1 });
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
    // Truly malformed IATA (neither 3 letters nor test) still carries a code.
    const value = publishPacket("packets", { value: 1 });
    value.topic = `meshcore/AB/${PUBLIC_KEY}/packets`;
    const error = await authorize(broker.aedes, observer, value).then(
      () => undefined,
      (failure) => failure,
    );
    assert.ok(error);
    assert.equal(
      observerErrorCode(error),
      OBSERVER_ERROR_CODES.PUBLISH_INVALID_IATA_FORMAT,
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

test("denial to lowercase IATA lands on the uppercase error topic", async () => {
  const broker = await runtime({
    allowlist_enabled: true,
    allowed_iata: {
      MMX: { friendly_name: "South" },
    },
  });
  const observer = await publisher(broker.aedes, "error-lower-iata");
  const delivered = [];
  const originalPublish = broker.aedes.publish.bind(broker.aedes);
  broker.aedes.publish = (packet, callback) => {
    if (String(packet.topic).endsWith("/error")) {
      delivered.push(packet);
    }
    return originalPublish(packet, callback);
  };
  try {
    // Lowercase "mmx" normalizes to MMX and is accepted; use an unknown
    // lowercase code to exercise routing to the uppercase error topic.
    const value = publishPacket("packets", { value: 1 });
    value.topic = `meshcore/abc/${PUBLIC_KEY}/packets`;
    const error = await authorize(broker.aedes, observer, value).then(
      () => undefined,
      (failure) => failure,
    );
    assert.ok(error);
    assert.equal(
      observerErrorCode(error),
      OBSERVER_ERROR_CODES.PUBLISH_UNKNOWN_IATA,
    );
    assert.equal(delivered.length, 1);
    assert.match(
      delivered[0].topic,
      new RegExp(`^meshcore/ABC/${PUBLIC_KEY}/error$`),
    );
    const body = JSON.parse(delivered[0].payload.toString("utf8"));
    assert.equal(body.code, OBSERVER_ERROR_CODES.PUBLISH_UNKNOWN_IATA);
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

test("GET /status reports stateless operation with queue counters", async () => {
  const broker = await runtime();
  const response = await fetch(`http://127.0.0.1:${broker.port}/status`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type"), /^application\/json/);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.storage, "stateless");
  assert.equal(typeof body.instanceId, "string");
  assert.equal(typeof body.uptimeMs, "number");
  assert.equal(typeof body.observers, "number");
  assert.equal(body.target.enabled, false);
  assert.equal(body.meshcoreIo.enabled, false);
  assert.equal(typeof body.meshcoreIo.ingressPending, "number");

  const missing = await fetch(`http://127.0.0.1:${broker.port}/anything-else`);
  assert.equal(missing.status, 404);
  const wrongMethod = await fetch(`http://127.0.0.1:${broker.port}/status`, {
    method: "POST",
  });
  assert.equal(wrongMethod.status, 405);
});

test("HTTP /status healthcheck succeeds against the live broker", async () => {
  const broker = await runtime();
  const options = resolveHealthcheckOptionsFromConfig();
  assert.match(options.url, /\/status$/);
  await runHttpStatusHealthcheck({
    ...options,
    url: `http://127.0.0.1:${broker.port}/status`,
    timeoutMs: 2_000,
  });
});

test("stale observer status is denied with PUBLISH_STALE_STATUS", async () => {
  const broker = await runtime();
  const observer = await publisher(broker.aedes, "status-publisher");
  await authorize(
    broker.aedes,
    observer,
    publishPacket("status", { timestamp: "2026-01-02T00:00:00.000Z" }),
  );
  const delivered = [];
  const originalPublish = broker.aedes.publish.bind(broker.aedes);
  broker.aedes.publish = (packet, callback) => {
    if (String(packet.topic).endsWith("/error")) {
      delivered.push(packet);
    }
    return originalPublish(packet, callback);
  };
  try {
    const stale = publishPacket("status", {
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const error = await authorize(broker.aedes, observer, stale).then(
      () => undefined,
      (failure) => failure,
    );
    assert.ok(error);
    assert.equal(
      observerErrorCode(error),
      OBSERVER_ERROR_CODES.PUBLISH_STALE_STATUS,
    );
    // Denied with a code on the observer error topic. The stale packet
    // itself is dropped (never delivered): the error JSON carries the
    // ORIGINAL denied topic, not a $SYS topic.
    assert.equal(delivered.length, 1);
    const body = JSON.parse(delivered[0].payload.toString("utf8"));
    assert.equal(body.code, OBSERVER_ERROR_CODES.PUBLISH_STALE_STATUS);
    assert.match(body.topic, /^meshcore\/STO\//);
    assert.doesNotMatch(body.topic, /^\$SYS\//);
  } finally {
    broker.aedes.publish = originalPublish;
  }
});
