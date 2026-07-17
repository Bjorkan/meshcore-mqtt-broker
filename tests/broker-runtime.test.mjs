import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, jest, test } from "@jest/globals";
import { WebSocket } from "ws";
import Redis from "ioredis";

import { createAuthToken, Utils } from "@michaelhart/meshcore-decoder";
import {
  BROKER_HEARTBEAT_MESSAGE,
  BROKER_HEARTBEAT_TOPIC,
  DEFAULT_NODE_NAME_CACHE_TTL_MS,
  startBrokerServer,
} from "../dist/server.js";
import {
  DOCKER_HEALTH_PASSWORD_LENGTH,
  DOCKER_HEALTH_USERNAME,
} from "../dist/docker-health-user.js";
import {
  encodeMqttConnectPacket,
  encodeMqttPublishPacket,
  encodeMqttSubscribePacket,
  parseFirstMqttPacket,
  readMqttPublish,
} from "../dist/healthcheck.js";
import {
  resetConfigCacheForTests,
  setConfigDocumentForTests,
} from "../dist/config.js";
import { TRUST_STATE_TTL_MS } from "../dist/orchestration.js";

import {
  createSwedishCountiesLookup,
  createUnavailableLookup,
} from "../dist/swedish-counties.js";
import { logger } from "../dist/logger.js";

const TEST_COUNTIES_LOOKUP = [
  {
    name: "Stockholms län",
    primary_iata: "STO",
    county_code: "se01",
    iata_codes: ["STO", "ARN", "BMA"],
  },
  {
    name: "Skåne län",
    primary_iata: "MMX",
    county_code: "se12",
    iata_codes: ["MMX", "AGH", "KID"],
  },
  {
    name: "Västra Götalands län",
    primary_iata: "GOT",
    county_code: "se14",
    iata_codes: ["GOT", "GSE", "THN"],
  },
];

const PRIVATE_KEY =
  "18469d6140447f77de13cd8d761e605431f52269fbff43b0925752ed9e6745435dc6a86d2568af8b70d3365db3f88234760c8ecc645ce469829bc45b65f1d5d5";
const PUBLIC_KEY =
  "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";
const OTHER_PUBLIC_KEY =
  "7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400";
const AUDIENCE = "meshcore-test-audience";
const originalEnv = { ...process.env };
let currentTestConfig = null;

const runtimes = [];

afterEach(async () => {
  while (runtimes.length > 0) {
    await runtimes.pop().stop();
  }

  process.env = { ...originalEnv };
  currentTestConfig = null;
  resetConfigCacheForTests();
});

function baseBrokerConfig(tmpDir, overrides = {}) {
  const namespace =
    overrides.BROKER_KV_NAMESPACE ||
    `meshcore-broker-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const config = {
    mqtt: {
      ws_port:
        overrides.MQTT_WS_PORT === undefined
          ? 0
          : Number(overrides.MQTT_WS_PORT),
      host: overrides.MQTT_HOST || "127.0.0.1",
      json_publish_max_bytes:
        overrides.MQTT_JSON_PUBLISH_MAX_BYTES === undefined
          ? 8192
          : Number(overrides.MQTT_JSON_PUBLISH_MAX_BYTES),
      ws_max_payload_bytes:
        overrides.MQTT_WS_MAX_PAYLOAD_BYTES === undefined
          ? 65536
          : Number(overrides.MQTT_WS_MAX_PAYLOAD_BYTES),
    },
    dashboard: {
      port:
        overrides.DASHBOARD_PORT === undefined
          ? 0
          : Number(overrides.DASHBOARD_PORT),
    },
    auth: {
      expected_audience: overrides.AUTH_EXPECTED_AUDIENCE ?? AUDIENCE,
    },
    broker: {
      kv_url:
        overrides.BROKER_KV_URL ||
        process.env.TEST_BROKER_KV_URL ||
        "redis://127.0.0.1:6379",
      kv_namespace: namespace,
      name: overrides.BROKER_NAME || "TestBroker",
      runtime_id_file:
        overrides.BROKER_RUNTIME_ID_FILE ||
        path.join(tmpDir, "broker-runtime-id"),
      node_name_cache_ttl_ms:
        overrides.BROKER_NODE_NAME_CACHE_TTL_MS === undefined
          ? DEFAULT_NODE_NAME_CACHE_TTL_MS
          : Number(overrides.BROKER_NODE_NAME_CACHE_TTL_MS),
    },
    subscribers: {
      default_max_connections:
        overrides.SUBSCRIBER_MAX_CONNECTIONS_DEFAULT === undefined
          ? 2
          : Number(overrides.SUBSCRIBER_MAX_CONNECTIONS_DEFAULT),
      users: [
        {
          username: "viewer",
          password: "viewer-pass",
          role: 2,
          max_connections: 1,
        },
        {
          username: "limited",
          password: "limited-pass",
          role: 3,
          max_connections: 2,
        },
        {
          username: "admin",
          password: "admin-pass",
          role: 1,
          max_connections: 5,
        },
      ],
    },
    healthcheck: {},
    abuse: {
      enforcement_enabled:
        overrides.ABUSE_ENFORCEMENT_ENABLED === undefined
          ? false
          : overrides.ABUSE_ENFORCEMENT_ENABLED === true ||
            overrides.ABUSE_ENFORCEMENT_ENABLED === "true",
      duplicate_window_size:
        overrides.ABUSE_DUPLICATE_WINDOW_SIZE === undefined
          ? 100
          : Number(overrides.ABUSE_DUPLICATE_WINDOW_SIZE),
      duplicate_window_ms:
        overrides.ABUSE_DUPLICATE_WINDOW_MS === undefined
          ? 300000
          : Number(overrides.ABUSE_DUPLICATE_WINDOW_MS),
      duplicate_threshold:
        overrides.ABUSE_DUPLICATE_THRESHOLD === undefined
          ? 10
          : Number(overrides.ABUSE_DUPLICATE_THRESHOLD),
      max_duplicates_per_packet:
        overrides.ABUSE_MAX_DUPLICATES_PER_PACKET === undefined
          ? 5
          : Number(overrides.ABUSE_MAX_DUPLICATES_PER_PACKET),
      duplicate_rate_threshold:
        overrides.ABUSE_DUPLICATE_RATE_THRESHOLD === undefined
          ? 0.3
          : Number(overrides.ABUSE_DUPLICATE_RATE_THRESHOLD),
      duplicate_rate_window_ms:
        overrides.ABUSE_DUPLICATE_RATE_WINDOW_MS === undefined
          ? 300000
          : Number(overrides.ABUSE_DUPLICATE_RATE_WINDOW_MS),
      bucket_capacity:
        overrides.ABUSE_BUCKET_CAPACITY === undefined
          ? 20
          : Number(overrides.ABUSE_BUCKET_CAPACITY),
      bucket_refill_rate:
        overrides.ABUSE_BUCKET_REFILL_RATE === undefined
          ? 3
          : Number(overrides.ABUSE_BUCKET_REFILL_RATE),
      max_packet_size:
        overrides.ABUSE_MAX_PACKET_SIZE === undefined
          ? 255
          : Number(overrides.ABUSE_MAX_PACKET_SIZE),
      max_topics_per_day:
        overrides.ABUSE_MAX_TOPICS_PER_DAY === undefined
          ? 3
          : Number(overrides.ABUSE_MAX_TOPICS_PER_DAY),
      anomaly_threshold:
        overrides.ABUSE_ANOMALY_THRESHOLD === undefined
          ? 10
          : Number(overrides.ABUSE_ANOMALY_THRESHOLD),
      max_iata_changes_24h:
        overrides.ABUSE_MAX_IATA_CHANGES_24H === undefined
          ? 3
          : Number(overrides.ABUSE_MAX_IATA_CHANGES_24H),
      topic_history_size:
        overrides.ABUSE_TOPIC_HISTORY_SIZE === undefined
          ? 50
          : Number(overrides.ABUSE_TOPIC_HISTORY_SIZE),
      topic_history_window_ms:
        overrides.ABUSE_TOPIC_HISTORY_WINDOW_MS === undefined
          ? 86400000
          : Number(overrides.ABUSE_TOPIC_HISTORY_WINDOW_MS),
    },
    allowed_regions: {
      STO: { friendly_name: "Stockholm" },
      GOT: { friendly_name: "Göteborg" },
      GSE: { friendly_name: "Göteborg Säve" },
    },
  };

  if (overrides.ALLOWED_REGIONS) {
    config.allowed_regions = {};
    for (const region of String(overrides.ALLOWED_REGIONS)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)) {
      config.allowed_regions[region.toUpperCase()] = {
        friendly_name: region.toUpperCase(),
      };
    }
  }

  if (overrides.SUBSCRIBER_1) {
    config.subscribers.users = [
      parseSubscriberTestConfig(overrides.SUBSCRIBER_1, "viewer"),
    ];
  }
  if (overrides.SUBSCRIBER_2) {
    config.subscribers.users[1] = parseSubscriberTestConfig(
      overrides.SUBSCRIBER_2,
      "limited",
    );
  }
  if (overrides.SUBSCRIBER_3) {
    config.subscribers.users[2] = parseSubscriberTestConfig(
      overrides.SUBSCRIBER_3,
      "admin",
    );
  }

  return config;
}

function parseSubscriberTestConfig(value, fallbackUsername) {
  const [
    username = fallbackUsername,
    password = "pass",
    role = "3",
    maxConnections,
  ] = String(value).split(":");
  return {
    username,
    password,
    role: Number(role),
    ...(maxConnections && maxConnections.toUpperCase() !== "D"
      ? { max_connections: Number(maxConnections) }
      : {}),
  };
}

// All broker instances started by tests MUST inject a Swedish county lookup.
// The default is createUnavailableLookup() which never makes remote requests.
// Tests that need a specific lookup should pass it as the second argument.
// No broker-runtime test should ever fetch from Codeberg or use globalThis.fetch.
async function startTestBroker(env = {}, lookup) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "meshcore-broker-test-"));
  const config = baseBrokerConfig(tmpDir, env);
  currentTestConfig = config;
  setConfigDocumentForTests(config);
  const testCredentialsFile = path.join(
    tmpDir,
    "docker_health_credentials.json",
  );

  const runtime = await startBrokerServer(testCredentialsFile, {
    swedishCountiesLookup: lookup ?? createUnavailableLookup(),
  });
  runtimes.push(runtime);
  return runtime;
}

async function expectConfigExit(action, messagePattern) {
  const errors = [];
  const exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit:${code}`);
  });
  const errorSpy = jest
    .spyOn(console, "error")
    .mockImplementation((...args) => {
      errors.push(args.join(" "));
    });

  try {
    let thrown;
    try {
      await action();
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, "expected configuration validation to fail");
    const output = [thrown.message, ...errors].join("\n");
    assert.match(output, messagePattern);
  } finally {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

async function currentBrokerInstanceId() {
  return (
    await readFile(currentTestConfig.broker.runtime_id_file, "utf8")
  ).trim();
}

async function createFixtureLookup() {
  return createSwedishCountiesLookup({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ swedish_counties: TEST_COUNTIES_LOOKUP });
      },
    }),
  });
}

function fakeClient(id) {
  return {
    id,
    conn: {
      clientIP: "127.0.0.1",
      authenticated: false,
    },
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

function authenticate(aedes, client, username, password) {
  return new Promise((resolve, reject) => {
    aedes.authenticate(
      client,
      username,
      Buffer.from(password),
      (err, authenticated) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(authenticated);
      },
    );
  });
}

function authorizePublish(aedes, client, packet) {
  return new Promise((resolve, reject) => {
    aedes.authorizePublish(client, packet, (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(packet);
    });
  });
}

function authorizeSubscribe(aedes, client, topic) {
  return new Promise((resolve, reject) => {
    aedes.authorizeSubscribe(client, { topic, qos: 0 }, (err, subscription) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(subscription);
    });
  });
}

function onceEvent(emitter, eventName) {
  return new Promise((resolve) => {
    emitter.once(eventName, (...args) => resolve(args));
  });
}

function collectObjectKeys(value, keys = new Set()) {
  if (!value || typeof value !== "object") {
    return keys;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjectKeys(item, keys);
    }
    return keys;
  }

  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectObjectKeys(child, keys);
  }
  return keys;
}

function connectMqttClient({
  port,
  username,
  password,
  clientId,
  keepAliveSeconds = 60,
}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  let packetBuffer = Buffer.alloc(0);
  const publishQueue = [];
  const publishWaiters = [];
  const packetWaiters = [];
  let connected = false;

  function close() {
    ws.close();
  }

  function nextPacket(predicate, timeoutMs = 5_000) {
    const queuedIndex = publishQueue.findIndex(predicate);
    if (queuedIndex >= 0) {
      const [queued] = publishQueue.splice(queuedIndex, 1);
      return Promise.resolve(queued);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = publishWaiters.findIndex(
          (waiter) => waiter.resolve === resolve,
        );
        if (waiterIndex >= 0) {
          publishWaiters.splice(waiterIndex, 1);
        }
        reject(new Error(`Timed out waiting for MQTT publish on ${clientId}`));
      }, timeoutMs);

      publishWaiters.push({
        predicate,
        resolve(packet) {
          clearTimeout(timer);
          resolve(packet);
        },
      });
    });
  }

  function nextRawPacket(predicate, timeoutMs = 5_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = packetWaiters.findIndex(
          (waiter) => waiter.resolve === resolve,
        );
        if (waiterIndex >= 0) {
          packetWaiters.splice(waiterIndex, 1);
        }
        reject(new Error(`Timed out waiting for MQTT packet on ${clientId}`));
      }, timeoutMs);

      packetWaiters.push({
        predicate,
        resolve(packet) {
          clearTimeout(timer);
          resolve(packet);
        },
      });
    });
  }

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out connecting MQTT client ${clientId}`));
      ws.close();
    }, 5_000);

    ws.once("open", () => {
      ws.send(
        encodeMqttConnectPacket(
          { username, password },
          clientId,
          keepAliveSeconds,
        ),
      );
    });

    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    ws.on("message", (data) => {
      packetBuffer = Buffer.concat([packetBuffer, Buffer.from(data)]);

      while (true) {
        const parsed = parseFirstMqttPacket(packetBuffer);
        if (!parsed) {
          return;
        }

        packetBuffer = packetBuffer.subarray(parsed.bytesRead);
        const { packet } = parsed;

        if (!connected && packet.type === 2) {
          if (packet.body.length < 2 || packet.body[1] !== 0) {
            clearTimeout(timer);
            reject(
              new Error(
                `MQTT authentication failed for ${clientId} with CONNACK code ${packet.body[1] ?? "unknown"}`,
              ),
            );
            return;
          }
          connected = true;
          clearTimeout(timer);
          resolve({
            ws,
            close,
            subscribe(topic) {
              const suback = nextRawPacket((next) => next.type === 9);
              ws.send(encodeMqttSubscribePacket(topic));
              return suback;
            },
            publish(topic, payload) {
              ws.send(encodeMqttPublishPacket(topic, payload));
            },
            nextPacket,
          });
          continue;
        }

        const rawWaiterIndex = packetWaiters.findIndex((waiter) =>
          waiter.predicate(packet),
        );
        if (rawWaiterIndex >= 0) {
          const [waiter] = packetWaiters.splice(rawWaiterIndex, 1);
          waiter.resolve(packet);
        }

        const publish = readMqttPublish(packet);
        if (!publish) {
          continue;
        }

        const waiterIndex = publishWaiters.findIndex((waiter) =>
          waiter.predicate(publish),
        );
        if (waiterIndex >= 0) {
          const [waiter] = publishWaiters.splice(waiterIndex, 1);
          waiter.resolve(publish);
        } else {
          publishQueue.push(publish);
        }
      }
    });
  });

  return ready;
}

async function publisherClient(aedes, id = "publisher") {
  const client = fakeClient(id);
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
    await authenticate(aedes, client, `v1_${PUBLIC_KEY}`, token),
    true,
  );
  return client;
}

async function generatedPublisherClient(aedes, id) {
  const keyPair = await generateMeshCoreKeyPair();
  const client = fakeClient(id);
  const token = await createAuthToken(
    {
      publicKey: keyPair.publicKey,
      aud: AUDIENCE,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    keyPair.privateKey,
    keyPair.publicKey,
  );

  assert.equal(
    await authenticate(aedes, client, `v1_${keyPair.publicKey}`, token),
    true,
  );
  return { client, ...keyPair };
}

async function generateMeshCoreKeyPair() {
  const seed = randomBytes(32);
  const privateKeyBytes = Buffer.from(
    createHash("sha512").update(seed).digest(),
  );
  privateKeyBytes[0] &= 248;
  privateKeyBytes[31] &= 63;
  privateKeyBytes[31] |= 64;

  const privateKey = privateKeyBytes.toString("hex").toUpperCase();
  const publicKey = (await Utils.derivePublicKey(privateKey)).toUpperCase();

  assert.equal(privateKey.length, 128);
  assert.equal(publicKey.length, 64);

  return { privateKey, publicKey };
}

function valkeyClient() {
  return new Redis(process.env.TEST_BROKER_KV_URL || "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 1,
  });
}

async function waitForValue(read, predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await read();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);

  assert.ok(
    predicate(value),
    `Timed out waiting for expected value, last value: ${String(value)}`,
  );
  return value;
}

test("authenticates subscribers and enforces subscriber connection limits", async () => {
  const { aedes } = await startTestBroker();
  const firstViewer = fakeClient("viewer-1");
  const secondViewer = fakeClient("viewer-2");

  assert.equal(
    await authenticate(aedes, firstViewer, "viewer", "viewer-pass"),
    true,
  );
  assert.equal(firstViewer.clientType, "subscriber");
  assert.equal(firstViewer.username, "viewer");
  assert.equal(firstViewer.role, 2);

  assert.equal(
    await authenticate(aedes, secondViewer, "viewer", "viewer-pass"),
    false,
  );
  assert.equal(
    await authenticate(aedes, fakeClient("bad-viewer"), "viewer", "wrong"),
    false,
  );
});

test("stores subscriber connection metadata in Valkey members", async () => {
  const { aedes } = await startTestBroker();
  const viewer = fakeClient("viewer-metadata");

  assert.equal(
    await authenticate(aedes, viewer, "viewer", "viewer-pass"),
    true,
  );

  const redis = valkeyClient();
  try {
    const key = `${currentTestConfig.broker.kv_namespace}:subscribers:viewer:connections`;
    const members = await redis.zrange(key, 0, -1);
    assert.equal(members.length, 1);

    const member = JSON.parse(members[0]);
    assert.equal(member.clientId, "viewer-metadata");
    assert.equal(member.lastUpdatedByInstance, await currentBrokerInstanceId());

    const ttlMs = await redis.pttl(key);
    assert.ok(ttlMs > 0);
    assert.ok(ttlMs <= 90_000);
  } finally {
    await redis.quit();
  }
});

test("creates docker_health subscriber with a generated runtime password at startup", async () => {
  const { aedes, healthcheckCredentialsFile } = await startTestBroker();
  const credentials = JSON.parse(
    await readFile(healthcheckCredentialsFile, "utf8"),
  );

  assert.equal(credentials.username, DOCKER_HEALTH_USERNAME);
  assert.equal(credentials.password.length, DOCKER_HEALTH_PASSWORD_LENGTH);

  const healthClient = fakeClient("docker-health-runtime");
  assert.equal(
    await authenticate(
      aedes,
      healthClient,
      DOCKER_HEALTH_USERNAME,
      credentials.password,
    ),
    true,
  );
  assert.equal(healthClient.clientType, "subscriber");
  assert.equal(healthClient.username, DOCKER_HEALTH_USERNAME);
  assert.equal(healthClient.role, 3);

  assert.equal(
    await authenticate(
      aedes,
      fakeClient("docker-health-wrong"),
      DOCKER_HEALTH_USERNAME,
      "wrong-password",
    ),
    false,
  );
  assert.deepEqual(
    await authorizeSubscribe(aedes, healthClient, BROKER_HEARTBEAT_TOPIC),
    { topic: BROKER_HEARTBEAT_TOPIC, qos: 0 },
  );
});

test("fails fast when subscriber role override is invalid", async () => {
  await expectConfigExit(
    () =>
      startTestBroker({
        SUBSCRIBER_2: "limited:limited-pass:9:2",
      }),
    /subscribers\.users\.limited\.role/,
  );
});

test("fails fast when subscriber maxConnections override is invalid", async () => {
  await expectConfigExit(
    () =>
      startTestBroker({
        SUBSCRIBER_2: "limited:limited-pass:3:abc",
      }),
    /subscribers\.users\[1\]\.max_connections|subscribers\.users\.limited\.max_connections/,
  );
});

test("allows level 2 subscribe-only users to subscribe to meshcore wildcard", async () => {
  const { aedes } = await startTestBroker();
  const viewer = fakeClient("viewer-wildcard");

  assert.equal(
    await authenticate(aedes, viewer, "viewer", "viewer-pass"),
    true,
  );
  assert.equal(viewer.clientType, "subscriber");
  assert.equal(viewer.role, 2);

  const subscription = await authorizeSubscribe(aedes, viewer, "meshcore/#");
  assert.deepEqual(subscription, { topic: "meshcore/#", qos: 0 });
});

test("delivers live meshcore wildcard publishes across broker replicas through Valkey", async () => {
  const tmpDir = await mkdtemp(
    path.join(os.tmpdir(), "meshcore-broker-cluster-test-"),
  );
  const namespace = `meshcore-broker-cluster-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const sharedOverrides = {
    BROKER_KV_NAMESPACE: namespace,
    SUBSCRIBER_MAX_CONNECTIONS_DEFAULT: "5",
    SUBSCRIBER_1: "viewer:viewer-pass:2:5",
  };

  currentTestConfig = baseBrokerConfig(tmpDir, {
    ...sharedOverrides,
    BROKER_NAME: "ClusterBrokerA",
    BROKER_RUNTIME_ID_FILE: path.join(tmpDir, "broker-a-id"),
  });
  setConfigDocumentForTests(currentTestConfig);
  const brokerAcredentials = path.join(tmpDir, "broker-a-health.json");
  const brokerA = await startBrokerServer(brokerAcredentials, {
    swedishCountiesLookup: createUnavailableLookup(),
  });
  runtimes.push(brokerA);

  currentTestConfig = baseBrokerConfig(tmpDir, {
    ...sharedOverrides,
    BROKER_NAME: "ClusterBrokerB",
    BROKER_RUNTIME_ID_FILE: path.join(tmpDir, "broker-b-id"),
  });
  setConfigDocumentForTests(currentTestConfig);
  const brokerBcredentials = path.join(tmpDir, "broker-b-health.json");
  const brokerB = await startBrokerServer(brokerBcredentials, {
    swedishCountiesLookup: createUnavailableLookup(),
  });
  runtimes.push(brokerB);

  const subscriber = await connectMqttClient({
    port: brokerA.port,
    username: "viewer",
    password: "viewer-pass",
    clientId: "cluster-subscriber",
  });
  const publisherToken = await createAuthToken(
    {
      publicKey: PUBLIC_KEY,
      aud: AUDIENCE,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    PRIVATE_KEY,
    PUBLIC_KEY,
  );
  const publisher = await connectMqttClient({
    port: brokerB.port,
    username: `v1_${PUBLIC_KEY}`,
    password: publisherToken,
    clientId: "cluster-publisher",
  });

  try {
    await subscriber.subscribe("meshcore/#");

    const topic = `meshcore/test/${PUBLIC_KEY}/packets`;
    const payload = JSON.stringify({
      origin_id: PUBLIC_KEY,
      raw: randomBytes(8).toString("hex"),
    });
    publisher.publish(topic, payload);

    const received = await subscriber.nextPacket(
      (packet) =>
        packet.topic === topic && packet.payload.toString("utf8") === payload,
    );
    assert.equal(received.topic, topic);
    assert.equal(received.payload.toString("utf8"), payload);
  } finally {
    subscriber.close();
    publisher.close();
  }
});

test("an older broker cannot steal an observer claim back after a newer authentication", async () => {
  const tmpDir = await mkdtemp(
    path.join(os.tmpdir(), "meshcore-broker-claim-handoff-test-"),
  );
  const namespace = `meshcore-broker-claim-handoff-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sharedOverrides = { BROKER_KV_NAMESPACE: namespace };

  currentTestConfig = baseBrokerConfig(tmpDir, {
    ...sharedOverrides,
    BROKER_NAME: "ClaimBrokerA",
    BROKER_RUNTIME_ID_FILE: path.join(tmpDir, "claim-broker-a-id"),
  });
  setConfigDocumentForTests(currentTestConfig);
  const brokerA = await startBrokerServer(
    path.join(tmpDir, "claim-broker-a-health.json"),
    { swedishCountiesLookup: createUnavailableLookup() },
  );
  runtimes.push(brokerA);

  currentTestConfig = baseBrokerConfig(tmpDir, {
    ...sharedOverrides,
    BROKER_NAME: "ClaimBrokerB",
    BROKER_RUNTIME_ID_FILE: path.join(tmpDir, "claim-broker-b-id"),
  });
  setConfigDocumentForTests(currentTestConfig);
  const brokerB = await startBrokerServer(
    path.join(tmpDir, "claim-broker-b-health.json"),
    { swedishCountiesLookup: createUnavailableLookup() },
  );
  runtimes.push(brokerB);

  const olderClient = await publisherClient(brokerA.aedes, "claim-owner-older");
  const newerClient = await publisherClient(brokerB.aedes, "claim-owner-newer");

  await assert.rejects(
    authorizePublish(brokerA.aedes, olderClient, {
      topic: `meshcore/test/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "AA" }),
      ),
      retain: false,
    }),
    /does not own observer claim/,
  );
  assert.equal(olderClient.closed, true);
  assert.equal(olderClient.observerClaimed, false);

  await authorizePublish(brokerB.aedes, newerClient, {
    topic: `meshcore/test/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: "BB" })),
    retain: false,
  });
  assert.equal(newerClient.closed, false);
  assert.equal(newerClient.observerClaimed, true);
});

test("allows subscribe-only users to subscribe to broker heartbeat", async () => {
  const { aedes } = await startTestBroker();
  const viewer = fakeClient("viewer-heartbeat");
  const limited = fakeClient("limited-heartbeat");

  assert.equal(
    await authenticate(aedes, viewer, "viewer", "viewer-pass"),
    true,
  );
  assert.equal(
    await authenticate(aedes, limited, "limited", "limited-pass"),
    true,
  );

  assert.deepEqual(
    await authorizeSubscribe(aedes, viewer, BROKER_HEARTBEAT_TOPIC),
    { topic: BROKER_HEARTBEAT_TOPIC, qos: 0 },
  );
  assert.deepEqual(
    await authorizeSubscribe(aedes, limited, BROKER_HEARTBEAT_TOPIC),
    { topic: BROKER_HEARTBEAT_TOPIC, qos: 0 },
  );
});

test("keeps non-admin subscribe-time restrictions to public topics and heartbeat", async () => {
  const { aedes } = await startTestBroker();
  const viewer = fakeClient("viewer-public-topic");
  const limited = fakeClient("limited-public-topic");

  assert.equal(
    await authenticate(aedes, viewer, "viewer", "viewer-pass"),
    true,
  );
  assert.equal(
    await authenticate(aedes, limited, "limited", "limited-pass"),
    true,
  );

  assert.deepEqual(
    await authorizeSubscribe(
      aedes,
      viewer,
      `meshcore/test/${PUBLIC_KEY}/status`,
    ),
    { topic: `meshcore/test/${PUBLIC_KEY}/status`, qos: 0 },
  );
  assert.deepEqual(
    await authorizeSubscribe(
      aedes,
      limited,
      `meshcore/test/${PUBLIC_KEY}/packets`,
    ),
    { topic: `meshcore/test/${PUBLIC_KEY}/packets`, qos: 0 },
  );

  assert.deepEqual(
    await authorizeSubscribe(
      aedes,
      viewer,
      `meshcore/test/${PUBLIC_KEY}/internalized`,
    ),
    { topic: `meshcore/test/${PUBLIC_KEY}/internalized`, qos: 0 },
  );

  for (const topic of [
    `meshcore/test/${PUBLIC_KEY}/internal`,
    `meshcore/test/${PUBLIC_KEY}/serial/commands`,
    "$SYS/#",
  ]) {
    await assert.rejects(
      authorizeSubscribe(aedes, viewer, topic),
      /public meshcore topics and heartbeat/,
    );
    await assert.rejects(
      authorizeSubscribe(aedes, limited, topic),
      /public meshcore topics and heartbeat/,
    );
  }
});

test("publishes broker heartbeat payload for uptime checks", async () => {
  const runtime = await startTestBroker();
  const publications = [];
  const originalPublish = runtime.aedes.publish.bind(runtime.aedes);
  runtime.aedes.publish = (packet, callback) => {
    publications.push(packet);
    callback?.();
  };

  try {
    runtime.publishHeartbeat();
  } finally {
    runtime.aedes.publish = originalPublish;
  }

  assert.equal(publications.length, 1);
  assert.equal(publications[0].topic, BROKER_HEARTBEAT_TOPIC);
  assert.equal(publications[0].payload.toString(), BROKER_HEARTBEAT_MESSAGE);
  assert.equal(publications[0].retain, false);
});

test("authenticates signed publishers and authorizes matching meshcore publishes", async () => {
  const { aedes } = await startTestBroker();
  const client = await publisherClient(aedes);
  const internalPublishes = [];
  const originalPublish = aedes.publish.bind(aedes);
  aedes.publish = (packet, callback) => {
    internalPublishes.push(packet);
    callback?.();
  };

  try {
    const packet = {
      topic: `meshcore/TEST/${PUBLIC_KEY.toLowerCase()}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: "00" }),
      ),
      retain: false,
    };

    await authorizePublish(aedes, client, packet);

    assert.equal(packet.topic, `meshcore/test/${PUBLIC_KEY}/packets`);
    assert.equal(internalPublishes.length, 1);
    assert.equal(
      internalPublishes[0].topic,
      `meshcore/test/${PUBLIC_KEY}/internal`,
    );
    assert.equal(internalPublishes[0].retain, false);

    await assert.rejects(
      authorizePublish(aedes, client, {
        topic: `meshcore/test/${PUBLIC_KEY}/packets`,
        payload: Buffer.from(JSON.stringify({ raw: "00" })),
        retain: false,
      }),
      /origin_id/,
    );

    const mismatchPacket = {
      topic: `meshcore/test/${OTHER_PUBLIC_KEY}/packets`,
      payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY })),
      retain: false,
    };

    await assert.rejects(
      authorizePublish(aedes, client, mismatchPacket),
      /Public key/,
    );
    assert.equal(client.closed, true);
  } finally {
    aedes.publish = originalPublish;
  }
});

test("stores trust-state write metadata in Valkey", async () => {
  const { aedes } = await startTestBroker();
  const client = await publisherClient(aedes, "publisher-valkey-metadata");
  const beforeWrite = Date.now();

  await authorizePublish(aedes, client, {
    cmd: "publish",
    topic: `meshcore/test/${PUBLIC_KEY}/status`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: PUBLIC_KEY,
        timestamp: new Date().toISOString(),
        origin: "SE-STO-META",
      }),
    ),
    qos: 0,
    retain: false,
    dup: false,
  });

  const redis = valkeyClient();
  try {
    const key = `${currentTestConfig.broker.kv_namespace}:abuse:trust:${PUBLIC_KEY}`;
    const rawState = await redis.get(key);
    assert.ok(rawState);

    const state = JSON.parse(rawState);
    assert.equal(state.lastUpdatedByInstance, await currentBrokerInstanceId());
    assert.equal(typeof state.lastUpdatedAt, "number");
    assert.ok(state.lastUpdatedAt >= beforeWrite);
    assert.equal(state.publicKey, PUBLIC_KEY);

    const ttlMs = await redis.pttl(key);
    assert.ok(ttlMs > 0);
    assert.ok(ttlMs <= TRUST_STATE_TTL_MS);
  } finally {
    await redis.quit();
  }
});

test("serves a public read-only dashboard with responding broker and public keys", async () => {
  const runtime = await startTestBroker({ BROKER_NAME: "DashboardBroker" });
  const dashboardInstanceId = await currentBrokerInstanceId();
  const publisher = await publisherClient(runtime.aedes, "publisher-dashboard");

  runtime.aedes.emit(
    "publish",
    {
      cmd: "publish",
      topic: "healthcheck/docker_health",
      payload: Buffer.from("docker-health-loopback:test"),
      qos: 0,
      retain: false,
      dup: false,
    },
    {
      id: "docker-health-runtime",
      clientType: "subscriber",
      username: DOCKER_HEALTH_USERNAME,
    },
  );

  runtime.aedes.emit(
    "publish",
    {
      cmd: "publish",
      topic: `meshcore/GOT/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "00" }),
      ),
      qos: 0,
      retain: false,
      dup: false,
    },
    publisher,
  );

  runtime.aedes.emit(
    "publish",
    {
      cmd: "publish",
      topic: `meshcore/GOT/${PUBLIC_KEY}/internal`,
      payload: Buffer.from(
        JSON.stringify({
          origin_id: PUBLIC_KEY,
          secret: "dashboard-internal-secret",
        }),
      ),
      qos: 0,
      retain: false,
      dup: false,
    },
    publisher,
  );

  runtime.aedes.emit(
    "publish",
    {
      cmd: "publish",
      topic: `meshcore/GOT/${PUBLIC_KEY}/serial/responses`,
      payload: Buffer.from("aaa.bbb.ccc"),
      qos: 0,
      retain: false,
      dup: false,
    },
    publisher,
  );

  const redis = valkeyClient();
  try {
    const legacyBanUpdatedAt = Date.now();
    const sharedNameUpdatedAt = Date.now();
    await redis
      .pipeline()
      .set(
        `${currentTestConfig.broker.kv_namespace}:observers:${PUBLIC_KEY}:node-name`,
        JSON.stringify({
          publicKey: PUBLIC_KEY,
          name: "SE-GOT-DASHBOARD",
          lastUpdatedByInstance: "name-broker",
          lastUpdatedAt: sharedNameUpdatedAt,
        }),
        "PX",
        DEFAULT_NODE_NAME_CACHE_TTL_MS,
      )
      .set(
        `${currentTestConfig.broker.kv_namespace}:abuse:trust:${PUBLIC_KEY}`,
        JSON.stringify({
          publicKey: PUBLIC_KEY,
          status: "muted",
          muteReason: "anomaly_threshold_exceeded (10 anomalies)",
          abuseBlockCount: 2,
          mutedUntil: legacyBanUpdatedAt + 60_000,
          lastUpdatedByInstance: "legacy-broker",
          lastUpdatedAt: legacyBanUpdatedAt,
        }),
        "PX",
        TRUST_STATE_TTL_MS,
      )
      .zadd(
        `${currentTestConfig.broker.kv_namespace}:abuse:bans:index`,
        legacyBanUpdatedAt,
        PUBLIC_KEY,
      )
      .exec();
  } finally {
    await redis.quit();
  }

  const htmlResponse = await fetch(
    `http://127.0.0.1:${runtime.dashboardPort}/`,
  );
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /id="root"/);
  assert.match(html, /window\.__DASHBOARD_CONFIG__/);
  assert.match(html, /\/dashboard-client\.js/);

  const clientResponse = await fetch(
    `http://127.0.0.1:${runtime.dashboardPort}/dashboard-client.js`,
  );
  assert.equal(clientResponse.status, 200);
  assert.match(clientResponse.headers.get("content-type") ?? "", /javascript/);
  const clientJs = await clientResponse.text();
  assert.match(clientJs, /\/api\/dashboard/);
  assert.ok(clientJs.length > 0);

  const apiResponse = await fetch(
    `http://127.0.0.1:${runtime.dashboardPort}/api/dashboard`,
  );
  assert.equal(apiResponse.status, 200);
  const dashboard = await apiResponse.json();

  assert.equal(dashboard.respondingBroker, dashboardInstanceId);
  assert.equal(dashboard.namespace, currentTestConfig.broker.kv_namespace);
  const dashboardBroker = dashboard.brokers.find(
    (broker) => broker.instanceId === dashboardInstanceId,
  );
  assert.ok(dashboardBroker);
  assert.equal(typeof dashboardBroker.startedAt, "number");
  assert.ok(dashboardBroker.startedAt <= dashboard.generatedAt);
  assert.ok(
    dashboard.observers.some(
      (observer) => observer.publicKey === PUBLIC_KEY && observer.active,
    ),
  );
  assert.equal(dashboard.summary.connectedObservers, 1);
  assert.equal(dashboard.summary.publishesLastMinute, 1);
  assert.equal(dashboard.recentPublishes.length, 1);
  assert.equal(
    dashboard.recentPublishes[0].topic,
    `meshcore/GOT/${PUBLIC_KEY}/packets`,
  );
  assert.equal(dashboard.recentPublishes[0].observer, "SE-GOT-DASHBOARD");
  assert.equal(
    dashboard.bans.find((ban) => ban.node === PUBLIC_KEY)?.reason,
    "Avvikelsegräns",
  );
  assert.equal(
    dashboard.bans.find((ban) => ban.node === PUBLIC_KEY)?.label,
    "SE-GOT-DASHBOARD",
  );
  assert.equal(
    dashboard.observers.find((observer) => observer.publicKey === PUBLIC_KEY)
      ?.abuse?.reason,
    "Avvikelsegräns",
  );
  assert.equal(
    dashboard.observers.find((observer) => observer.publicKey === PUBLIC_KEY)
      ?.label,
    "SE-GOT-DASHBOARD",
  );
  assert.equal(dashboard.observers[0].clientId, undefined);
  assert.equal(dashboard.topics, undefined);
  assert.equal(dashboard.recentConnections, undefined);
  assert.ok(
    dashboard.observers.every((observer) => observer.label !== "docker health"),
  );

  const serialized = JSON.stringify(dashboard);
  const dashboardKeys = collectObjectKeys(dashboard);
  assert.match(serialized, new RegExp(PUBLIC_KEY));
  assert.doesNotMatch(serialized, /127\.0\.0\.1/);
  assert.doesNotMatch(serialized, new RegExp(PRIVATE_KEY));
  for (const key of [
    "clientId",
    "clientIP",
    "username",
    "password",
    "tokenPayload",
    "payload",
    "conn",
  ]) {
    assert.equal(
      dashboardKeys.has(key),
      false,
      `${key} must not be exposed by dashboard API`,
    );
  }
  assert.doesNotMatch(
    serialized,
    /docker-health-loopback|docker-health-runtime|dashboard-internal-secret/,
  );
  assert.doesNotMatch(serialized, /\/internal|\/serial\//);

  runtime.aedes.emit("clientDisconnect", publisher);
  const disconnectedResponse = await fetch(
    `http://127.0.0.1:${runtime.dashboardPort}/api/dashboard`,
  );
  assert.equal(disconnectedResponse.status, 200);
  const disconnectedDashboard = await disconnectedResponse.json();
  assert.equal(disconnectedDashboard.summary.connectedObservers, 0);
  const disconnectedObserver = disconnectedDashboard.observers.find(
    (observer) => observer.publicKey === PUBLIC_KEY,
  );
  assert.equal(disconnectedObserver, undefined);
});

test("authorizes regions from config allowed_regions and override", async () => {
  const runtime = await startTestBroker({ ALLOWED_REGIONS: "STO,XYZ" });
  const { aedes } = runtime;
  const client = await publisherClient(aedes, "publisher-regions");

  const yamlRegionPacket = {
    topic: `meshcore/STO/${PUBLIC_KEY.toLowerCase()}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: "00" }),
    ),
    retain: false,
  };

  await authorizePublish(aedes, client, yamlRegionPacket);
  assert.equal(yamlRegionPacket.topic, `meshcore/STO/${PUBLIC_KEY}/packets`);

  const envRegionPacket = {
    topic: `meshcore/XYZ/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: "01" })),
    retain: false,
  };

  await authorizePublish(aedes, client, envRegionPacket);
  assert.equal(envRegionPacket.topic, `meshcore/XYZ/${PUBLIC_KEY}/packets`);

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/ZZZ/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "02" }),
      ),
      retain: false,
    }),
    /not allowed/,
  );

  const deniedEvent = await waitForValue(
    async () => {
      const response = await fetch(
        `http://127.0.0.1:${runtime.dashboardPort}/api/dashboard`,
      );
      assert.equal(response.status, 200);
      const dashboard = await response.json();
      return dashboard.bans.find(
        (ban) => ban.status === "denied" && ban.region === "ZZZ",
      );
    },
    (ban) => ban !== undefined,
  );
  assert.equal(deniedEvent.reason, "Region ZZZ is not allowed");
  assert.equal(deniedEvent.blockCount, 0);
});

test("primary IATA enforcement denies secondary IATA in allowed_regions when lookup is available", async () => {
  const lookup = await createFixtureLookup();
  const runtime = await startTestBroker(
    { ALLOWED_REGIONS: "AGH,MMX,GOT" },
    lookup,
  );
  const { aedes } = runtime;
  const client = await publisherClient(aedes, "publisher-primary-iata");

  const primaryPacket = {
    topic: `meshcore/MMX/${PUBLIC_KEY.toLowerCase()}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: "00" }),
    ),
    retain: false,
  };
  await authorizePublish(aedes, client, primaryPacket);
  assert.equal(primaryPacket.topic, `meshcore/MMX/${PUBLIC_KEY}/packets`);

  const secondaryPacket = {
    topic: `meshcore/AGH/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: "01" })),
    retain: false,
  };
  await assert.rejects(
    authorizePublish(aedes, client, secondaryPacket),
    /not allowed/,
  );

  const deniedEvent = await waitForValue(
    async () => {
      const response = await fetch(
        `http://127.0.0.1:${runtime.dashboardPort}/api/dashboard`,
      );
      assert.equal(response.status, 200);
      const dashboard = await response.json();
      return dashboard.bans.find(
        (ban) => ban.status === "denied" && ban.region === "AGH",
      );
    },
    (ban) => ban !== undefined,
  );
  assert.equal(deniedEvent.reason, "Wrong IATA code");
  assert.equal(
    deniedEvent.deniedUntilText,
    "Until observer switches to correct IATA MMX for Skåne län",
  );
});

test("secondary IATA with primary not in allowed_regions shows operator-facing remediation", async () => {
  const lookup = await createFixtureLookup();
  const runtime = await startTestBroker({ ALLOWED_REGIONS: "AGH,GOT" }, lookup);
  const { aedes } = runtime;
  const client = await publisherClient(
    aedes,
    "publisher-secondary-no-primary-allowed",
  );

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/AGH/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "00" }),
      ),
      retain: false,
    }),
    /not allowed/,
  );

  const deniedEvent = await waitForValue(
    async () => {
      const response = await fetch(
        `http://127.0.0.1:${runtime.dashboardPort}/api/dashboard`,
      );
      assert.equal(response.status, 200);
      const dashboard = await response.json();
      return dashboard.bans.find(
        (ban) => ban.status === "denied" && ban.region === "AGH",
      );
    },
    (ban) => ban !== undefined,
  );
  assert.equal(deniedEvent.reason, "Wrong IATA code");
  assert.equal(
    deniedEvent.deniedUntilText,
    "Broker is configured with secondary IATA AGH. Change allowed_regions to primary IATA MMX for Skåne län.",
  );
});

test("primary IATA MMX not in allowed_regions is denied with generic reason", async () => {
  const lookup = await createFixtureLookup();
  const runtime = await startTestBroker({ ALLOWED_REGIONS: "AGH,GOT" }, lookup);
  const { aedes } = runtime;
  const client = await publisherClient(aedes, "publisher-primary-not-allowed");

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/MMX/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "00" }),
      ),
      retain: false,
    }),
    /not allowed/,
  );

  const deniedEvent = await waitForValue(
    async () => {
      const response = await fetch(
        `http://127.0.0.1:${runtime.dashboardPort}/api/dashboard`,
      );
      assert.equal(response.status, 200);
      const dashboard = await response.json();
      return dashboard.bans.find(
        (ban) => ban.status === "denied" && ban.region === "MMX",
      );
    },
    (ban) => ban !== undefined,
  );
  assert.equal(deniedEvent.reason, "Region MMX is not allowed");
});

test("secondary IATA not allowed but primary allowed shows observer-facing remediation", async () => {
  const lookup = await createFixtureLookup();
  const runtime = await startTestBroker({ ALLOWED_REGIONS: "MMX,GOT" }, lookup);
  const { aedes } = runtime;
  const client = await publisherClient(
    aedes,
    "publisher-secondary-not-allowed-primary-is",
  );

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/AGH/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "00" }),
      ),
      retain: false,
    }),
    /not allowed/,
  );

  const deniedEvent = await waitForValue(
    async () => {
      const response = await fetch(
        `http://127.0.0.1:${runtime.dashboardPort}/api/dashboard`,
      );
      assert.equal(response.status, 200);
      const dashboard = await response.json();
      return dashboard.bans.find(
        (ban) => ban.status === "denied" && ban.region === "AGH",
      );
    },
    (ban) => ban !== undefined,
  );
  assert.equal(deniedEvent.reason, "Wrong IATA code");
  assert.equal(deniedEvent.reason, "Wrong IATA code");
  assert.equal(
    deniedEvent.deniedUntilText,
    "Until observer switches to correct IATA MMX for Skåne län",
  );
});

test("secondary IATA with neither code allowlisted shows neutral remediation", async () => {
  const lookup = await createFixtureLookup();
  const runtime = await startTestBroker({ ALLOWED_REGIONS: "GOT" }, lookup);
  const { aedes } = runtime;
  const client = await publisherClient(aedes, "publisher-neither-allowed");

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/AGH/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "00" }),
      ),
      retain: false,
    }),
    /not allowed/,
  );

  const deniedEvent = await waitForValue(
    async () => {
      const response = await fetch(
        `http://127.0.0.1:${runtime.dashboardPort}/api/dashboard`,
      );
      assert.equal(response.status, 200);
      const dashboard = await response.json();
      return dashboard.bans.find(
        (ban) => ban.status === "denied" && ban.region === "AGH",
      );
    },
    (ban) => ban !== undefined,
  );
  assert.equal(deniedEvent.reason, "Wrong IATA code");
  assert.equal(
    deniedEvent.deniedUntilText,
    "Wrong IATA code AGH. Correct primary IATA is MMX for Skåne län, but MMX is not enabled on this broker.",
  );
});

test("ambiguous secondary IATA falls back to allowed_regions logic", async () => {
  const ambiguousLookup = await createSwedishCountiesLookup({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          swedish_counties: [
            {
              name: "County A",
              primary_iata: "AAA",
              county_code: "se01",
              iata_codes: ["AAA", "BBB"],
            },
            {
              name: "County B",
              primary_iata: "CCC",
              county_code: "se02",
              iata_codes: ["BBB", "CCC"],
            },
          ],
        });
      },
    }),
  });
  const runtime = await startTestBroker(
    { ALLOWED_REGIONS: "AAA,CCC,BBB" },
    ambiguousLookup,
  );
  const { aedes } = runtime;
  const client = await publisherClient(aedes, "publisher-ambiguous-allowed");

  await authorizePublish(aedes, client, {
    topic: `meshcore/BBB/${PUBLIC_KEY.toLowerCase()}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: "00" }),
    ),
    retain: false,
  });
});

test("ambiguous secondary IATA not in allowed_regions is denied with generic reason", async () => {
  const ambiguousLookup = await createSwedishCountiesLookup({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          swedish_counties: [
            {
              name: "County A",
              primary_iata: "AAA",
              county_code: "se01",
              iata_codes: ["AAA", "BBB"],
            },
            {
              name: "County B",
              primary_iata: "CCC",
              county_code: "se02",
              iata_codes: ["BBB", "CCC"],
            },
          ],
        });
      },
    }),
  });
  const runtime = await startTestBroker(
    { ALLOWED_REGIONS: "AAA,CCC" },
    ambiguousLookup,
  );
  const { aedes } = runtime;
  const client = await publisherClient(aedes, "publisher-ambiguous-denied");

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/BBB/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "00" }),
      ),
      retain: false,
    }),
    /not allowed/,
  );

  const deniedEvent = await waitForValue(
    async () => {
      const response = await fetch(
        `http://127.0.0.1:${runtime.dashboardPort}/api/dashboard`,
      );
      assert.equal(response.status, 200);
      const dashboard = await response.json();
      return dashboard.bans.find(
        (ban) => ban.status === "denied" && ban.region === "BBB",
      );
    },
    (ban) => ban !== undefined,
  );
  assert.equal(deniedEvent.reason, "Region BBB is not allowed");
  assert.equal(deniedEvent.deniedUntilText, undefined);
});

test("primary IATA enforcement falls back to allowlist when lookup is unavailable", async () => {
  const runtime = await startTestBroker({ ALLOWED_REGIONS: "AGH,MMX,GOT" });
  const { aedes } = runtime;
  const client = await publisherClient(aedes, "publisher-no-lookup");

  const agahPacket = {
    topic: `meshcore/AGH/${PUBLIC_KEY.toLowerCase()}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: "00" }),
    ),
    retain: false,
  };
  await authorizePublish(aedes, client, agahPacket);
  assert.equal(agahPacket.topic, `meshcore/AGH/${PUBLIC_KEY}/packets`);

  const unknownPacket = {
    topic: `meshcore/ZZZ/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: "01" })),
    retain: false,
  };
  await assert.rejects(
    authorizePublish(aedes, client, unknownPacket),
    /not allowed/,
  );
});

test("secondary IATA denied even when primary IATA is not in allowed_regions", async () => {
  const lookup = await createFixtureLookup();
  const runtime = await startTestBroker({ ALLOWED_REGIONS: "AGH" }, lookup);
  const { aedes } = runtime;
  const client = await publisherClient(aedes, "publisher-secondary-no-primary");

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/AGH/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "00" }),
      ),
      retain: false,
    }),
    /not allowed/,
  );

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/MMX/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "01" }),
      ),
      retain: false,
    }),
    /not allowed/,
  );
});

test("primary IATA accepted only when in allowed_regions", async () => {
  const lookup = await createFixtureLookup();
  const runtime = await startTestBroker({ ALLOWED_REGIONS: "MMX" }, lookup);
  const { aedes } = runtime;
  const client = await publisherClient(aedes, "publisher-primary-allowed");

  await authorizePublish(aedes, client, {
    topic: `meshcore/MMX/${PUBLIC_KEY.toLowerCase()}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: "00" }),
    ),
    retain: false,
  });

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/GOT/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "01" }),
      ),
      retain: false,
    }),
    /not allowed/,
  );
});

test("unknown IATA in allowed_regions works when lookup is available", async () => {
  const lookup = await createFixtureLookup();
  const runtime = await startTestBroker({ ALLOWED_REGIONS: "MMX,ZZZ" }, lookup);
  const { aedes } = runtime;
  const client = await publisherClient(aedes, "publisher-unknown-allowed");

  await authorizePublish(aedes, client, {
    topic: `meshcore/ZZZ/${PUBLIC_KEY.toLowerCase()}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: "00" }),
    ),
    retain: false,
  });

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/YYY/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "01" }),
      ),
      retain: false,
    }),
    /not allowed/,
  );
});

test("dashboard snapshot contains countyLookup when lookup is available", async () => {
  const lookup = await createFixtureLookup();
  const runtime = await startTestBroker(
    { BROKER_NAME: "CountyTestBroker" },
    lookup,
  );
  const { aedes } = runtime;
  const client = await publisherClient(aedes, "publisher-county");

  await authorizePublish(aedes, client, {
    topic: `meshcore/GOT/${PUBLIC_KEY.toLowerCase()}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: "00" }),
    ),
    retain: false,
  });

  const response = await fetch(
    `http://127.0.0.1:${runtime.dashboardPort}/api/dashboard`,
  );
  assert.equal(response.status, 200);
  const dashboard = await response.json();

  assert.ok(
    dashboard.countyLookup,
    "countyLookup should be present when lookup is available",
  );
  assert.equal(
    dashboard.countyLookup["GOT"].countyName,
    "Västra Götalands län",
  );
  assert.equal(dashboard.countyLookup["GOT"].isPrimary, true);
  assert.equal(
    dashboard.countyLookup["GSE"].countyName,
    "Västra Götalands län",
  );
  assert.equal(dashboard.countyLookup["GSE"].isPrimary, false);
  assert.equal(dashboard.countyLookup["GSE"].primaryIata, "GOT");
  assert.equal(dashboard.countyLookup["STO"].countyName, "Stockholms län");
});

test("dashboard snapshot lacks countyLookup when lookup is unavailable", async () => {
  const runtime = await startTestBroker({ BROKER_NAME: "NoCountyBroker" });
  const { aedes } = runtime;
  const client = await publisherClient(aedes, "publisher-no-county");

  await authorizePublish(aedes, client, {
    topic: `meshcore/GOT/${PUBLIC_KEY.toLowerCase()}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: "00" }),
    ),
    retain: false,
  });

  const response = await fetch(
    `http://127.0.0.1:${runtime.dashboardPort}/api/dashboard`,
  );
  assert.equal(response.status, 200);
  const dashboard = await response.json();

  assert.equal(dashboard.countyLookup, undefined);
});

test("allows publishers to switch between allowed IATAs including GOT under abuse enforcement (lookup unavailable)", async () => {
  const { aedes, abuseDetector } = await startTestBroker({
    ABUSE_ENFORCEMENT_ENABLED: "true",
    ABUSE_MAX_IATA_CHANGES_24H: "1",
  });
  const client = await publisherClient(aedes, "publisher-iata-switch");

  const regions = ["GSE", "GOT", "STO", "GSE", "GOT", "GOT"];
  for (const [index, region] of regions.entries()) {
    const packet = {
      topic: `meshcore/${region}/${PUBLIC_KEY.toLowerCase()}/packets`,
      payload: Buffer.from(
        JSON.stringify({
          origin_id: PUBLIC_KEY.toLowerCase(),
          raw: index.toString(16).padStart(2, "0"),
        }),
      ),
      retain: false,
    };

    await authorizePublish(aedes, client, packet);
    assert.equal(packet.topic, `meshcore/${region}/${PUBLIC_KEY}/packets`);
  }

  const trustState = abuseDetector.getClientStats(PUBLIC_KEY);
  assert.equal(trustState.status, "allowed");
  assert.equal(trustState.muteReason, undefined);
  assert.equal(trustState.currentIata, "GOT");
  assert.ok(trustState.iataHistory.length >= 3);
  assert.ok(trustState.iataChangeCount24h >= 3);
});

test("rejects invalid MeshCore keys and regions outside the allowlist", async () => {
  const { aedes } = await startTestBroker();
  const valid = await generatedPublisherClient(
    aedes,
    "publisher-valid-negative",
  );

  console.log(
    "Startar negativa publiceringstest för ogiltiga MeshCore-nycklar och regionkoder",
  );
  console.log(
    "Försöker autentisera med ogiltig MeshCore-nyckel i användarnamnet: NOT_A_MESHCORE_KEY",
  );
  assert.equal(
    await authenticate(
      aedes,
      fakeClient("bad-short-key"),
      "v1_NOT_A_MESHCORE_KEY",
      "bad-token",
    ),
    false,
  );
  console.log(
    "Autentisering nekades för ogiltig MeshCore-nyckel, fortsätter...",
  );

  const otherKeyPair = await generateMeshCoreKeyPair();
  const wrongPublicKeyToken = await createAuthToken(
    {
      publicKey: otherKeyPair.publicKey,
      aud: AUDIENCE,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    otherKeyPair.privateKey,
    otherKeyPair.publicKey,
  );

  console.log(
    `Försöker autentisera med nyckelprefix ${valid.publicKey.substring(0, 8)} men token signerad för prefix ${otherKeyPair.publicKey.substring(0, 8)}`,
  );
  assert.equal(
    await authenticate(
      aedes,
      fakeClient("bad-mismatched-token"),
      `v1_${valid.publicKey}`,
      wrongPublicKeyToken,
    ),
    false,
  );
  console.log(
    "Autentisering nekades för felaktig tokensignatur, fortsätter...",
  );

  const wrongAudience = "fel-audience";
  const wrongAudienceToken = await createAuthToken(
    {
      publicKey: valid.publicKey,
      aud: wrongAudience,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    valid.privateKey,
    valid.publicKey,
  );

  console.log(
    `Försöker autentisera med giltig MeshCore-nyckel, prefix ${valid.publicKey.substring(0, 8)}, men ogiltig audience: ${wrongAudience}`,
  );
  assert.equal(
    await authenticate(
      aedes,
      fakeClient("bad-audience-token"),
      `v1_${valid.publicKey}`,
      wrongAudienceToken,
    ),
    false,
  );
  console.log("Autentisering nekades för ogiltig audience, fortsätter...");

  const invalidTopicKeyClient = fakeClient("bad-topic-key-client");
  Object.assign(invalidTopicKeyClient, {
    clientType: "publisher",
    publicKey: valid.publicKey,
    tokenPayload: { aud: AUDIENCE },
  });

  console.log(
    `Försöker publicera till STO med ogiltig MeshCore-nyckel i ämnet, giltigt klientprefix ${valid.publicKey.substring(0, 8)}`,
  );
  await assert.rejects(
    authorizePublish(aedes, invalidTopicKeyClient, {
      topic: "meshcore/STO/NOT_A_MESHCORE_KEY/packets",
      payload: Buffer.from(
        JSON.stringify({ origin_id: valid.publicKey, raw: "00" }),
      ),
      retain: false,
    }),
    /Topic/,
  );
  assert.equal(invalidTopicKeyClient.closed, false);
  console.log(
    "Publicering nekades för ogiltig MeshCore-nyckel i ämnet, fortsätter...",
  );

  for (const region of ["CPH", "OSL", "ZZZ"]) {
    console.log(
      `Försöker med ${region}, giltig MeshCore-nyckel, prefix ${valid.publicKey.substring(0, 8)} (saknas i config.yaml allowed_regions)`,
    );
    await assert.rejects(
      authorizePublish(aedes, valid.client, {
        topic: `meshcore/${region}/${valid.publicKey}/packets`,
        payload: Buffer.from(
          JSON.stringify({ origin_id: valid.publicKey, raw: "01" }),
        ),
        retain: false,
      }),
      /not allowed/,
    );
    console.log(
      `Publicering nekades för ${region} som förväntat, fortsätter...`,
    );
  }

  const invalidRegionFormats = [
    { region: "SE1", reason: "innehåller siffra" },
    { region: "ABCD", reason: "har fyra tecken" },
    { region: "sto", reason: "är inte versal" },
    { region: "XXX", reason: "är en platshållare" },
  ];

  for (const { region, reason } of invalidRegionFormats) {
    const invalidRegionClient = fakeClient(`bad-region-${region}`);
    Object.assign(invalidRegionClient, {
      clientType: "publisher",
      publicKey: valid.publicKey,
      tokenPayload: { aud: AUDIENCE },
    });

    console.log(
      `Försöker med ${region}, giltig MeshCore-nyckel, prefix ${valid.publicKey.substring(0, 8)} (ogiltig IATA-kod: ${reason})`,
    );
    await assert.rejects(
      authorizePublish(aedes, invalidRegionClient, {
        topic: `meshcore/${region}/${valid.publicKey}/packets`,
        payload: Buffer.from(
          JSON.stringify({ origin_id: valid.publicKey, raw: "02" }),
        ),
        retain: false,
      }),
      /Topic|Location|XXX/,
    );
    assert.equal(invalidRegionClient.closed, region === "XXX");
    console.log(
      `Publicering nekades för ${region} som förväntat, fortsätter...`,
    );
  }

  console.log("Alla negativa publiceringstest passerade");
});

test("enforces subscriber and publisher publish/subscribe policy edges", async () => {
  const { aedes } = await startTestBroker();
  const viewer = fakeClient("viewer-policy");
  const admin = fakeClient("admin-policy");
  const publisher = await publisherClient(aedes, "publisher-policy");

  assert.equal(
    await authenticate(aedes, viewer, "viewer", "viewer-pass"),
    true,
  );
  assert.equal(await authenticate(aedes, admin, "admin", "admin-pass"), true);

  await assert.rejects(
    authorizePublish(aedes, viewer, {
      topic: `meshcore/test/${PUBLIC_KEY}/packets`,
      payload: Buffer.from("{}"),
      retain: false,
    }),
    /subscribe-only/,
  );

  await authorizePublish(aedes, admin, {
    topic: `meshcore/test/${PUBLIC_KEY}/serial/commands`,
    payload: Buffer.from("command"),
    retain: true,
  });

  await assert.rejects(
    authorizePublish(aedes, publisher, {
      topic: `meshcore/test/${PUBLIC_KEY}/internal`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, forged: true }),
      ),
      retain: false,
    }),
    /broker-owned/,
  );

  await assert.rejects(
    authorizePublish(aedes, publisher, {
      topic: `meshcore/test/${PUBLIC_KEY}/serial/commands`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, command: "bad" }),
      ),
      retain: false,
    }),
    /admin-only/,
  );

  const retainedPacket = {
    topic: `meshcore/test/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: "00" })),
    retain: true,
  };
  await authorizePublish(aedes, publisher, retainedPacket);
  assert.equal(retainedPacket.retain, false);

  await assert.rejects(
    authorizeSubscribe(aedes, publisher, "meshcore/#"),
    /publish-only/,
  );
  assert.equal(publisher.closed, true);
});

test("restricts publisher serial command subscriptions to exact own allowed topic", async () => {
  const { aedes } = await startTestBroker();
  const publisher = await publisherClient(aedes, "publisher-serial-subscribe");

  assert.deepEqual(
    await authorizeSubscribe(
      aedes,
      publisher,
      `meshcore/test/${PUBLIC_KEY}/serial/commands`,
    ),
    { topic: `meshcore/test/${PUBLIC_KEY}/serial/commands`, qos: 0 },
  );

  for (const topic of [
    `meshcore/+/${PUBLIC_KEY}/serial/commands`,
    `meshcore/test/${OTHER_PUBLIC_KEY}/serial/commands`,
    `meshcore/XXX/${PUBLIC_KEY}/serial/commands`,
    `meshcore/test/${PUBLIC_KEY}/serial/commands/extra`,
  ]) {
    const deniedPublisher = await publisherClient(
      aedes,
      `publisher-denied-${topic.length}`,
    );
    await assert.rejects(
      authorizeSubscribe(aedes, deniedPublisher, topic),
      /publish-only/,
    );
    assert.equal(deniedPublisher.closed, true);
  }
});

test("publisher serial/commands subscribe respects primary IATA rule when lookup available", async () => {
  const lookup = await createFixtureLookup();
  const { aedes } = await startTestBroker(
    { ALLOWED_REGIONS: "MMX,ZZZ" },
    lookup,
  );
  const publisher = await publisherClient(aedes, "publisher-serial-primary");

  await assert.deepEqual(
    await authorizeSubscribe(
      aedes,
      publisher,
      `meshcore/test/${PUBLIC_KEY}/serial/commands`,
    ),
    { topic: `meshcore/test/${PUBLIC_KEY}/serial/commands`, qos: 0 },
  );

  await assert.deepEqual(
    await authorizeSubscribe(
      aedes,
      publisher,
      `meshcore/MMX/${PUBLIC_KEY}/serial/commands`,
    ),
    { topic: `meshcore/MMX/${PUBLIC_KEY}/serial/commands`, qos: 0 },
  );

  await assert.deepEqual(
    await authorizeSubscribe(
      aedes,
      publisher,
      `meshcore/ZZZ/${PUBLIC_KEY}/serial/commands`,
    ),
    { topic: `meshcore/ZZZ/${PUBLIC_KEY}/serial/commands`, qos: 0 },
  );

  const deniedPublisher = await publisherClient(
    aedes,
    "publisher-serial-secondary",
  );
  await assert.rejects(
    authorizeSubscribe(
      aedes,
      deniedPublisher,
      `meshcore/AGH/${PUBLIC_KEY}/serial/commands`,
    ),
    /publish-only/,
  );
});

test("publisher publish and serial/commands subscribe use consistent region rules", async () => {
  const lookup = await createFixtureLookup();
  const { aedes } = await startTestBroker(
    { ALLOWED_REGIONS: "MMX,ZZZ,GOT" },
    lookup,
  );
  const publisher = await publisherClient(
    aedes,
    "publisher-consistent-regions",
  );

  await authorizePublish(aedes, publisher, {
    topic: `meshcore/MMX/${PUBLIC_KEY.toLowerCase()}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: "00" }),
    ),
    retain: false,
  });

  await assert.deepEqual(
    await authorizeSubscribe(
      aedes,
      publisher,
      `meshcore/MMX/${PUBLIC_KEY}/serial/commands`,
    ),
    { topic: `meshcore/MMX/${PUBLIC_KEY}/serial/commands`, qos: 0 },
  );

  await authorizePublish(aedes, publisher, {
    topic: `meshcore/ZZZ/${PUBLIC_KEY.toLowerCase()}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: "01" }),
    ),
    retain: false,
  });

  await assert.deepEqual(
    await authorizeSubscribe(
      aedes,
      publisher,
      `meshcore/ZZZ/${PUBLIC_KEY}/serial/commands`,
    ),
    { topic: `meshcore/ZZZ/${PUBLIC_KEY}/serial/commands`, qos: 0 },
  );

  const secondaryPublisher = await publisherClient(
    aedes,
    "publisher-secondary-both",
  );
  await assert.rejects(
    authorizePublish(aedes, secondaryPublisher, {
      topic: `meshcore/AGH/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "02" }),
      ),
      retain: false,
    }),
    /not allowed/,
  );

  await assert.rejects(
    authorizeSubscribe(
      aedes,
      secondaryPublisher,
      `meshcore/AGH/${PUBLIC_KEY}/serial/commands`,
    ),
    /publish-only/,
  );
});

test("allows upstream-compatible publisher subtopics and strips retain globally", async () => {
  const { aedes } = await startTestBroker();
  const client = await publisherClient(aedes, "publisher-observer-policy");
  const originalPublish = aedes.publish.bind(aedes);
  aedes.publish = (_packet, callback) => callback?.();

  try {
    for (const subtopic of ["status", "packets", "raw", "debug", "foo/bar"]) {
      const packet = {
        topic: `meshcore/test/${PUBLIC_KEY}/${subtopic}`,
        payload: Buffer.from(
          JSON.stringify({
            origin_id: PUBLIC_KEY,
            timestamp: "2026-01-01T00:00:00.000Z",
          }),
        ),
        retain: true,
      };

      await authorizePublish(aedes, client, packet);
      assert.equal(packet.retain, false);
    }

    await assert.rejects(
      authorizePublish(aedes, client, {
        topic: `meshcore/test/${PUBLIC_KEY}/internal/debug`,
        payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY })),
        retain: false,
      }),
      /broker-owned/,
    );

    await assert.rejects(
      authorizePublish(aedes, client, {
        topic: `meshcore/test/${PUBLIC_KEY}/serial/other`,
        payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY })),
        retain: false,
      }),
      /reserved/,
    );
  } finally {
    aedes.publish = originalPublish;
  }
});

test("rejects oversized JSON publishes before normal JSON validation", async () => {
  const { aedes } = await startTestBroker({
    MQTT_JSON_PUBLISH_MAX_BYTES: "128",
  });
  const client = await publisherClient(aedes, "publisher-json-limit");

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/test/${PUBLIC_KEY}/status`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, note: "x".repeat(200) }),
      ),
      retain: false,
    }),
    /too large/,
  );
});

test("sets and enforces a WebSocket transport payload limit", async () => {
  const { port, wsServer } = await startTestBroker({
    MQTT_WS_MAX_PAYLOAD_BYTES: "16",
  });
  assert.equal(wsServer.options.maxPayload, 16);

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await onceEvent(ws, "open");
  ws.send(Buffer.alloc(17));

  const [code] = await onceEvent(ws, "close");
  assert.equal(code, 1009);
});

test("enforces abuse mute decisions when enforcement is enabled", async () => {
  const { aedes, abuseDetector } = await startTestBroker({
    ABUSE_ENFORCEMENT_ENABLED: "true",
    ABUSE_BUCKET_CAPACITY: "1",
    ABUSE_BUCKET_REFILL_RATE: "0.000001",
  });
  const client = await publisherClient(aedes, "publisher-abuse-enforced");

  await authorizePublish(aedes, client, {
    topic: `meshcore/test/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: "00" })),
    retain: false,
  });

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/test/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "01" }),
      ),
      retain: false,
    }),
    /abuse policy/,
  );

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/test/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: "02" }),
      ),
      retain: false,
    }),
    /abuse policy/,
  );

  const trustState = abuseDetector.getClientStats(PUBLIC_KEY);
  assert.equal(trustState.status, "muted");
  assert.equal(trustState.muteReason, "rate_limit_exceeded");
  assert.ok(trustState.totalPacketsSilenced > 0);
});

test("marks would_mute in abuse shadow mode while still allowing publishes", async () => {
  const { aedes, abuseDetector } = await startTestBroker({
    ABUSE_ENFORCEMENT_ENABLED: "false",
    ABUSE_BUCKET_CAPACITY: "1",
    ABUSE_BUCKET_REFILL_RATE: "0.000001",
  });
  const client = await publisherClient(aedes, "publisher-abuse-shadow");

  await authorizePublish(aedes, client, {
    topic: `meshcore/test/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: "00" })),
    retain: false,
  });

  await authorizePublish(aedes, client, {
    topic: `meshcore/test/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: "01" })),
    retain: false,
  });

  const trustState = abuseDetector.getClientStats(PUBLIC_KEY);
  assert.equal(trustState.status, "would_mute");
  assert.equal(trustState.muteReason, "rate_limit_exceeded");
});

test("applies abuse and size policy to serial response publishes", async () => {
  const { aedes, abuseDetector } = await startTestBroker({
    ABUSE_ENFORCEMENT_ENABLED: "true",
    ABUSE_BUCKET_CAPACITY: "1",
    ABUSE_BUCKET_REFILL_RATE: "0.000001",
  });
  const client = await publisherClient(aedes, "publisher-serial-abuse");

  await authorizePublish(aedes, client, {
    topic: `meshcore/test/${PUBLIC_KEY}/serial/responses`,
    payload: Buffer.from("aaa.bbb.ccc"),
    retain: false,
  });

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/test/${PUBLIC_KEY}/serial/responses`,
      payload: Buffer.from("ddd.eee.fff"),
      retain: false,
    }),
    /abuse policy/,
  );

  const trustState = abuseDetector.getClientStats(PUBLIC_KEY);
  assert.equal(trustState.status, "muted");
  assert.equal(trustState.muteReason, "rate_limit_exceeded");
});

test("rejects oversized and malformed serial response payloads", async () => {
  const { aedes } = await startTestBroker();
  const client = await publisherClient(aedes, "publisher-serial-validation");

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/test/${PUBLIC_KEY}/serial/responses`,
      payload: Buffer.from("not-a-jwt-shaped-payload"),
      retain: false,
    }),
    /JWT-shaped/,
  );

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/test/${PUBLIC_KEY}/serial/responses`,
      payload: Buffer.from(`${"a".repeat(4096)}.b.c`),
      retain: false,
    }),
    /too large/,
  );
});

test("strips retained status publishes before authorization succeeds", async () => {
  const { aedes } = await startTestBroker();
  const client = await publisherClient(aedes);
  const packet = {
    topic: `meshcore/test/${PUBLIC_KEY}/status`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: PUBLIC_KEY,
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ),
    retain: true,
  };

  await authorizePublish(aedes, client, packet);
  assert.equal(packet.retain, false);
});

test("caches publisher node names from status and expires them after ttl", async () => {
  assert.equal(DEFAULT_NODE_NAME_CACHE_TTL_MS, 24 * 60 * 60 * 1000);

  {
    const { aedes } = await startTestBroker();
    const first = await publisherClient(aedes, "publisher-name-source");
    await authorizePublish(aedes, first, {
      topic: `meshcore/test/${PUBLIC_KEY}/status`,
      payload: Buffer.from(
        JSON.stringify({
          origin_id: PUBLIC_KEY,
          origin: "SE-STO-TEST",
          timestamp: "2026-01-01T00:00:00.000Z",
        }),
      ),
      retain: false,
    });

    const second = await publisherClient(aedes, "aedes_generated_client_id");
    assert.equal(second.nodeName, "SE-STO-TEST");
  }

  {
    const { aedes } = await startTestBroker({
      BROKER_NODE_NAME_CACHE_TTL_MS: "1",
    });
    const first = await publisherClient(
      aedes,
      "publisher-expiring-name-source",
    );
    await authorizePublish(aedes, first, {
      topic: `meshcore/test/${PUBLIC_KEY}/status`,
      payload: Buffer.from(
        JSON.stringify({
          origin_id: PUBLIC_KEY,
          origin: "SE-STO-EXPIRED",
          timestamp: "2026-01-01T00:00:00.000Z",
        }),
      ),
      retain: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await publisherClient(aedes, "aedes_generated_client_id");
    assert.equal(second.nodeName, undefined);
  }
});

test("loads publisher friendly names from Valkey after authentication", async () => {
  const { aedes } = await startTestBroker();
  const redis = valkeyClient();
  try {
    await redis.set(
      `${currentTestConfig.broker.kv_namespace}:observers:${PUBLIC_KEY}:node-name`,
      JSON.stringify({
        publicKey: PUBLIC_KEY,
        name: "SE-STO-VALKEY",
        lastUpdatedByInstance: "name-broker",
        lastUpdatedAt: Date.now(),
      }),
      "PX",
      DEFAULT_NODE_NAME_CACHE_TTL_MS,
    );

    const publisher = await publisherClient(
      aedes,
      "publisher-valkey-name-auth",
    );
    await waitForValue(
      () => publisher.nodeName,
      (nodeName) => nodeName === "SE-STO-VALKEY",
    );
  } finally {
    await redis.quit();
  }
});

test("stores observer friendly names in Valkey and clears non-abuse runtime state when unclaimed", async () => {
  const runtime = await startTestBroker({
    ABUSE_ENFORCEMENT_ENABLED: "true",
    ABUSE_BUCKET_CAPACITY: "1",
    ABUSE_BUCKET_REFILL_RATE: "0.000001",
  });
  const publisher = await publisherClient(
    runtime.aedes,
    "publisher-valkey-name-source",
  );

  await authorizePublish(runtime.aedes, publisher, {
    topic: `meshcore/test/${PUBLIC_KEY}/status`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: PUBLIC_KEY,
        origin: "SE-STO-SHARED",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ),
    retain: false,
  });

  const redis = valkeyClient();
  try {
    const namespace = currentTestConfig.broker.kv_namespace;
    const claimKey = `${namespace}:observers:${PUBLIC_KEY}:claim`;
    const nodeNameKey = `${namespace}:observers:${PUBLIC_KEY}:node-name`;
    const brokerInstanceId = await currentBrokerInstanceId();
    const instanceObserversKey = `${namespace}:instances:${brokerInstanceId}:observers`;
    const abuseKey = `${namespace}:abuse:trust:${PUBLIC_KEY}`;

    assert.equal(await redis.get(claimKey), brokerInstanceId);
    const nodeNameRaw = await waitForValue(
      () => redis.get(nodeNameKey),
      (value) => typeof value === "string" && value.includes("SE-STO-SHARED"),
    );
    assert.equal(JSON.parse(nodeNameRaw).name, "SE-STO-SHARED");
    assert.ok(await redis.get(abuseKey));

    await assert.rejects(
      authorizePublish(runtime.aedes, publisher, {
        topic: `meshcore/test/${PUBLIC_KEY}/packets`,
        payload: Buffer.from(
          JSON.stringify({ origin_id: PUBLIC_KEY, raw: "00" }),
        ),
        retain: false,
      }),
      /abuse policy/,
    );
    const bannedTrustState = JSON.parse(await redis.get(abuseKey));
    assert.equal(bannedTrustState.username, "SE-STO-SHARED");

    runtime.aedes.emit("clientDisconnect", publisher);

    await waitForValue(
      () => redis.get(claimKey),
      (value) => value === null,
    );
    assert.equal(await redis.get(nodeNameKey), null);
    await waitForValue(
      async () =>
        JSON.parse((await redis.get(instanceObserversKey)) || '{"entries":[]}')
          .entries,
      (entries) =>
        Array.isArray(entries) &&
        !entries.some((entry) => entry.publicKey === PUBLIC_KEY),
    );
    const retainedAbuseState = JSON.parse(await redis.get(abuseKey));
    assert.equal(retainedAbuseState.username, "SE-STO-SHARED");
    const retainedDashboardResponse = await fetch(
      `http://127.0.0.1:${runtime.dashboardPort}/api/dashboard`,
    );
    assert.equal(retainedDashboardResponse.status, 200);
    const retainedDashboard = await retainedDashboardResponse.json();
    const retainedBan = retainedDashboard.bans.find(
      (ban) => ban.node === PUBLIC_KEY,
    );
    assert.equal(retainedBan?.label, "SE-STO-SHARED");
  } finally {
    await redis.quit();
  }
});

test("filters forwarded data by subscriber role", async () => {
  const { aedes } = await startTestBroker();
  const limited = { clientType: "subscriber", role: 3 };
  const fullAccess = { clientType: "subscriber", role: 2 };
  const admin = { clientType: "subscriber", role: 1 };

  const packet = {
    topic: `meshcore/test/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: PUBLIC_KEY,
        SNR: 12,
        RSSI: -90,
        score: 40,
        visible: true,
      }),
    ),
  };

  const limitedPacket = aedes.authorizeForward(limited, packet);
  assert.deepEqual(JSON.parse(limitedPacket.payload.toString()), {
    origin_id: PUBLIC_KEY,
    visible: true,
  });

  assert.equal(aedes.authorizeForward(fullAccess, packet), packet);

  const internalPacket = {
    topic: `meshcore/test/${PUBLIC_KEY}/internal`,
    payload: Buffer.from("{}"),
  };
  assert.equal(aedes.authorizeForward(fullAccess, internalPacket), null);
  assert.equal(aedes.authorizeForward(admin, internalPacket), internalPacket);

  const publicPrefixPacket = {
    topic: `meshcore/test/${PUBLIC_KEY}/internalized`,
    payload: Buffer.from("{}"),
  };
  assert.equal(
    aedes.authorizeForward(fullAccess, publicPrefixPacket),
    publicPrefixPacket,
  );

  const newerStatus = {
    topic: `meshcore/test/${PUBLIC_KEY}/status`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: PUBLIC_KEY,
        timestamp: "2026-01-02T00:00:00.000Z",
        model: "secret",
        firmware_version: "1.2.3",
        stats: { uptime: 10 },
        visible: true,
      }),
    ),
  };
  const _olderStatus = {
    topic: `meshcore/test/${PUBLIC_KEY}/status`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: PUBLIC_KEY,
        timestamp: "2026-01-01T00:00:00.000Z",
        visible: true,
      }),
    ),
  };

  const forwardedStatus = aedes.authorizeForward(limited, newerStatus);
  assert.deepEqual(JSON.parse(forwardedStatus.payload.toString()), {
    origin_id: PUBLIC_KEY,
    timestamp: "2026-01-02T00:00:00.000Z",
    visible: true,
  });
});

test("blocks stale status messages at publish time using Valkey state", async () => {
  const { aedes } = await startTestBroker();
  const publisher = await publisherClient(aedes, "publisher-stale-status");

  await authorizePublish(aedes, publisher, {
    topic: `meshcore/test/${PUBLIC_KEY}/status`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: PUBLIC_KEY,
        timestamp: "2026-01-02T00:00:00.000Z",
        visible: true,
      }),
    ),
    retain: false,
  });

  const stalePacket = await authorizePublish(aedes, publisher, {
    topic: `meshcore/test/${PUBLIC_KEY}/status`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: PUBLIC_KEY,
        timestamp: "2026-01-01T00:00:00.000Z",
        visible: true,
      }),
    ),
    qos: 1,
    retain: true,
    dup: true,
  });

  assert.match(stalePacket.topic, /^\$SYS\/.+\/discarded-status$/);
  assert.equal(stalePacket.qos, 0);
  assert.equal(stalePacket.retain, false);
  assert.equal(stalePacket.dup, false);
  assert.deepEqual(JSON.parse(stalePacket.payload.toString("utf8")), {
    reason: "stale-status-message",
    originalTopic: `meshcore/test/${PUBLIC_KEY}/status`,
    clientId: "publisher-stale-status",
    statusTimestamp: "2026-01-01T00:00:00.000Z",
  });
});

test("startup warns about secondary IATA in allowed_regions when lookup available", async () => {
  const warnMsgs = [];
  const origWarn = logger.warn;
  logger.warn = (...args) => {
    warnMsgs.push(args.join(" "));
  };
  const lookup = await createFixtureLookup();
  try {
    await startTestBroker({ ALLOWED_REGIONS: "MMX,AGH" }, lookup);
  } finally {
    logger.warn = origWarn;
  }
  assert.ok(
    warnMsgs.some((msg) => msg.includes("secondary IATA")),
    JSON.stringify(warnMsgs),
  );
});

test("startup does not warn about primary IATA in allowed_regions", async () => {
  const warnMsgs = [];
  const origWarn = logger.warn;
  logger.warn = (...args) => {
    warnMsgs.push(args.join(" "));
  };
  const lookup = await createFixtureLookup();
  try {
    await startTestBroker({ ALLOWED_REGIONS: "MMX,STO" }, lookup);
  } finally {
    logger.warn = origWarn;
  }
  const warningCalls = warnMsgs.filter((msg) => msg.includes("secondary IATA"));
  assert.equal(warningCalls.length, 0);
});

test("startup does not warn about unknown allowed region ZZZ", async () => {
  const warnMsgs = [];
  const origWarn = logger.warn;
  logger.warn = (...args) => {
    warnMsgs.push(args.join(" "));
  };
  const lookup = await createFixtureLookup();
  try {
    await startTestBroker({ ALLOWED_REGIONS: "MMX,ZZZ" }, lookup);
  } finally {
    logger.warn = origWarn;
  }
  const warningCalls = warnMsgs.filter((msg) => msg.includes("secondary IATA"));
  assert.equal(warningCalls.length, 0);
});

test("startup does not warn about test region", async () => {
  const warnMsgs = [];
  const origWarn = logger.warn;
  logger.warn = (...args) => {
    warnMsgs.push(args.join(" "));
  };
  const lookup = await createFixtureLookup();
  try {
    await startTestBroker({ ALLOWED_REGIONS: "test,MMX" }, lookup);
  } finally {
    logger.warn = origWarn;
  }
  const warningCalls = warnMsgs.filter((msg) => msg.includes("secondary IATA"));
  assert.equal(warningCalls.length, 0);
});

test("startup does not warn about secondary IATA when lookup unavailable", async () => {
  const warnMsgs = [];
  const origWarn = logger.warn;
  logger.warn = (...args) => {
    warnMsgs.push(args.join(" "));
  };
  try {
    await startTestBroker({ ALLOWED_REGIONS: "AGH,MMX" });
  } finally {
    logger.warn = origWarn;
  }
  const warningCalls = warnMsgs.filter((msg) => msg.includes("secondary IATA"));
  assert.equal(warningCalls.length, 0);
});

test("startup warning for secondary IATA includes county name and primary IATA", async () => {
  const warnMsgs = [];
  const origWarn = logger.warn;
  logger.warn = (...args) => {
    warnMsgs.push(args.join(" "));
  };
  const lookup = await createFixtureLookup();
  try {
    await startTestBroker({ ALLOWED_REGIONS: "AGH,MMX" }, lookup);
  } finally {
    logger.warn = origWarn;
  }
  const warningMsg = warnMsgs.find((msg) => msg.includes("AGH"));
  assert.ok(warningMsg, "should have a warning about AGH");
  assert.ok(warningMsg.includes("Skåne"), "warning should mention county name");
  assert.ok(warningMsg.includes("MMX"), "warning should mention primary IATA");
});

test("does not rate-limit WebSocket disconnects without failed authentication", async () => {
  const { port } = await startTestBroker();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await onceEvent(ws, "open");
    const closed = onceEvent(ws, "close");
    ws.close();
    await closed;
  }

  const client = await connectMqttClient({
    port,
    username: "viewer",
    password: "viewer-pass",
    clientId: "viewer-after-transport-closes",
  });
  client.close();
});

test("does not complete publisher authentication after its transport closes", async () => {
  const { aedes } = await startTestBroker();
  const client = fakeClient("publisher-closed-during-auth");
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

  let callbackCalled = false;
  aedes.authenticate(client, `v1_${PUBLIC_KEY}`, Buffer.from(token), () => {
    callbackCalled = true;
  });
  client.conn.transportClosed = true;

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(callbackCalled, false);
  assert.equal(client.clientType, undefined);
  assert.equal(client.publicKey, undefined);
});
