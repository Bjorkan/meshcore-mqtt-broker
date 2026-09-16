import assert from "node:assert/strict";
import { afterEach, spyOn, test } from "bun:test";
import {
  encodeMqttConnectPacket,
  encodeMqttPublishPacket,
  encodeMqttSubscribePacket,
  parseFirstMqttPacket,
  readHealthcheckCredentialsFromConfig,
  readMqttPublish,
  resolveHealthcheckOptionsFromConfig,
} from "../src/healthcheck.js";
import {
  resetConfigCacheForTests,
  setConfigDocumentForTests,
} from "../src/config.js";
import {
  createDockerHealthCredentials,
  getDockerHealthCredentials,
  setDockerHealthCredentialsForTests,
} from "../src/docker-health-user.js";

afterEach(() => {
  setDockerHealthCredentialsForTests(null);
  resetConfigCacheForTests();
});

function baseConfig(overrides = {}) {
  return {
    mqtt: { ws_port: 0, host: "127.0.0.1" },
    broker: { name: "Test" },
    auth: { expected_audience: "audience" },
    subscribers: { default_max_connections: 2, users: [] },
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
    iata: { allowlist_enabled: true },
    allowed_iata: { STO: {} },
    ...overrides,
  };
}

test("healthcheck packet codec retains real MQTT loopback behavior", () => {
  assert.equal(
    encodeMqttConnectPacket({ username: "u", password: "p" }, "c")[0],
    0x10,
  );
  assert.equal(encodeMqttSubscribePacket("healthcheck/docker_health")[0], 0x82);
  const encoded = encodeMqttPublishPacket("healthcheck/docker_health", "ok");
  const parsed = parseFirstMqttPacket(encoded);
  assert.equal(readMqttPublish(parsed.packet).payload.toString(), "ok");
});

test("healthcheck credentials are in-memory per process, no files", () => {
  setConfigDocumentForTests(baseConfig());
  assert.equal(readHealthcheckCredentialsFromConfig(), null);
  createDockerHealthCredentials();
  const creds = readHealthcheckCredentialsFromConfig();
  assert.equal(creds.username, "docker_health");
  assert.equal(typeof creds.password, "string");
  assert.equal(creds.password.length, 32);
  assert.ok(getDockerHealthCredentials());
});

test("healthcheck falls back to configured subscriber credentials", () => {
  setConfigDocumentForTests(
    baseConfig({
      healthcheck: { mqtt_username: "viewer", mqtt_password: "secret" },
    }),
  );
  const creds = readHealthcheckCredentialsFromConfig();
  assert.deepEqual(creds, { username: "viewer", password: "secret" });
  const options = resolveHealthcheckOptionsFromConfig();
  assert.equal(options.username, "viewer");
  assert.equal(options.password, "secret");
});

test("healthcheck rejects custom topics outside healthcheck/", () => {
  createDockerHealthCredentials();
  setConfigDocumentForTests(
    baseConfig({ healthcheck: { mqtt_topic: "meshcore/STO/x/status" } }),
  );
  assert.throws(
    () => resolveHealthcheckOptionsFromConfig(),
    /must stay under healthcheck\//,
  );
});

test("healthcheck rejects oversized payloads and tiny timeouts", () => {
  createDockerHealthCredentials();
  setConfigDocumentForTests(
    baseConfig({ healthcheck: { mqtt_payload: "x".repeat(513) } }),
  );
  assert.throws(
    () => resolveHealthcheckOptionsFromConfig(),
    /512-byte loopback limit/,
  );

  resetConfigCacheForTests();
  createDockerHealthCredentials();
  setConfigDocumentForTests(
    baseConfig({ healthcheck: { mqtt_timeout_ms: 1 } }),
  );
  const exit = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    assert.throws(() => resolveHealthcheckOptionsFromConfig(), /process\.exit/);
  } finally {
    exit.mockRestore();
  }
});
