import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  loadAbuseConfig,
  loadMeshcoreIoConfig,
  loadMqttConfig,
  loadSubscriberConfig,
  resetConfigCacheForTests,
  setConfigDocumentForTests,
} from "../dist/config.js";

function config(overrides = {}) {
  return {
    mqtt: {
      ws_port: 0,
      host: "127.0.0.1",
      json_publish_max_bytes: 8192,
      ws_max_payload_bytes: 65536,
      ...overrides.mqtt,
    },
    dashboard: { port: 0 },
    broker: { name: "Test", node_name_cache_ttl_ms: 60000 },
    auth: { expected_audience: "audience" },
    subscribers: {
      default_max_connections: 2,
      users: [{ username: "viewer", password: "secret", role: 2 }],
    },
    meshcore_io: { enabled: false, ...overrides.meshcore_io },
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
    allowed_regions: { STO: { friendly_name: "Stockholm" } },
  };
}

afterEach(() => resetConfigCacheForTests());

test("loads broker settings without any database path or Valkey configuration", () => {
  setConfigDocumentForTests(config());
  const mqtt = loadMqttConfig();
  assert.equal(mqtt.wsPort, 0);
  assert.equal(mqtt.host, "127.0.0.1");
  assert.deepEqual(mqtt.allowedRegions, ["STO"]);
  assert.equal("kvUrl" in mqtt, false);
  assert.equal("kvNamespace" in mqtt, false);
  assert.equal("databasePath" in mqtt, false);
});

test("loads local MeshCore.io queue settings", () => {
  setConfigDocumentForTests(
    config({
      meshcore_io: {
        enabled: true,
        workers: 3,
        max_queued_uploads: 42,
        attempts: 4,
      },
    }),
  );
  const queue = loadMeshcoreIoConfig();
  assert.equal(queue.enabled, true);
  assert.equal(queue.workers, 3);
  assert.equal(queue.maxQueuedUploads, 42);
  assert.equal(queue.retriesAllowed, 4);
  assert.equal("producerLeaseMs" in queue, false);
  assert.equal("workerClaimTimeoutMs" in queue, false);
});

test("subscriber and abuse configuration remain compatible", () => {
  setConfigDocumentForTests(config());
  assert.equal(loadSubscriberConfig().users[0].username, "viewer");
  assert.equal(loadAbuseConfig().enforcementEnabled, false);
});
