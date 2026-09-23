import assert from "node:assert/strict";
import { afterEach, spyOn, test } from "bun:test";
import {
  loadMeshcoreIoConfig,
  loadMqttConfig,
  loadSubscriberConfig,
  resetConfigCacheForTests,
  setConfigDocumentForTests,
} from "../src/config.js";

function config(overrides = {}) {
  return {
    mqtt: {
      ws_port: 0,
      host: "127.0.0.1",
      json_publish_max_bytes: 8192,
      ws_max_payload_bytes: 65536,
      ...overrides.mqtt,
    },
    broker: { name: "Test" },
    auth: { expected_audience: "audience" },
    subscribers: {
      default_max_connections: 2,
      users: [{ username: "viewer", password: "secret", role: 2 }],
    },
    meshcore_io: { enabled: false, ...overrides.meshcore_io },
    iata: {
      allowlist_enabled: overrides.allowlist_enabled ?? true,
      allow_test_ingress: overrides.allow_test_ingress ?? false,
    },
    allowed_iata: Object.hasOwn(overrides, "allowed_iata")
      ? overrides.allowed_iata
      : { STO: { friendly_name: "Stockholm" } },
  };
}

function configFailure(document, pattern) {
  setConfigDocumentForTests(document);
  const exit = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    assert.throws(() => loadMqttConfig(), /process\.exit/);
    assert.match(error.mock.calls.flat().join("\n"), pattern);
  } finally {
    exit.mockRestore();
    error.mockRestore();
  }
}

afterEach(() => resetConfigCacheForTests());

test("loads broker settings without external storage configuration", () => {
  setConfigDocumentForTests(config());
  const mqtt = loadMqttConfig();
  assert.equal(mqtt.wsPort, 0);
  assert.equal(mqtt.host, "127.0.0.1");
  assert.equal("dashboardPort" in mqtt, false);
  assert.equal(mqtt.iata.allowlistEnabled, true);
  assert.equal(mqtt.iata.allowTestIngress, false);
  assert.deepEqual(mqtt.iata.allowedPrimaryIata, ["STO"]);
  assert.equal(mqtt.authTokenMaxAgeSeconds, 0);
  assert.equal("databasePath" in mqtt, false);
});

test("ws_max_payload_bytes above the 32-bit limit is rejected", () => {
  configFailure(
    config({ mqtt: { ws_max_payload_bytes: 2_147_483_648 } }),
    /ws_max_payload_bytes.*at most 2147483647/i,
  );
});

test("ws_max_payload_bytes at the 32-bit limit is accepted", () => {
  setConfigDocumentForTests(
    config({ mqtt: { ws_max_payload_bytes: 2_147_483_647 } }),
  );
  assert.equal(loadMqttConfig().wsMaxPayloadBytes, 2_147_483_647);
});

test("preserves legacy IATA_whitelist and allowed_regions configuration", () => {
  const legacyConfig = config();
  delete legacyConfig.iata;
  delete legacyConfig.allowed_iata;
  legacyConfig.IATA_whitelist = true;
  legacyConfig.allowed_regions = {
    STO: { friendly_name: "Stockholm", secondary_region: "ARN" },
  };
  setConfigDocumentForTests(legacyConfig);
  const iata = loadMqttConfig().iata;
  assert.equal(iata.allowlistEnabled, true);
  assert.deepEqual(iata.allowedPrimaryIata, ["STO"]);
  assert.equal(iata.secondaryEntries.ARN.primaryIata, "STO");
});

test("canonical allowed_iata takes precedence over a stale legacy false flag", () => {
  const document = config({ allowlist_enabled: true });
  delete document.iata;
  document.IATA_whitelist = false;
  setConfigDocumentForTests(document);
  const iata = loadMqttConfig().iata;
  assert.equal(iata.allowlistEnabled, true);
  assert.deepEqual(iata.allowedPrimaryIata, ["STO"]);
});

test("IATA allowlist rejects malformed configured entries", () => {
  configFailure(
    config({ allowed_iata: { invalid: 42 } }),
    /allowed_iata\.invalid.*three letters/i,
  );
});

test("IATA allowlist cannot be disabled", () => {
  configFailure(
    config({ allowlist_enabled: false }),
    /allowlist_enabled must be true/i,
  );
});

test("supports list-form IATA with normalization when enabled", () => {
  setConfigDocumentForTests(
    config({ allowlist_enabled: true, allowed_iata: ["sto", " MMX "] }),
  );
  const iata = loadMqttConfig().iata;
  assert.deepEqual(iata.allowedPrimaryIata, ["STO", "MMX"]);
  assert.equal(iata.primaryEntries.STO.friendlyName, undefined);
});

test("supports object-form friendly names and comma-separated secondaries", () => {
  setConfigDocumentForTests(
    config({
      allowlist_enabled: true,
      allowed_iata: {
        mmx: {
          friendly_name: "Southern IATA area",
          secondary_iata: " agh, KID ",
        },
        STO: { friendly_name: "Capital IATA area" },
      },
    }),
  );
  const iata = loadMqttConfig().iata;
  assert.deepEqual(iata.allowedPrimaryIata, ["MMX", "STO"]);
  assert.deepEqual(iata.primaryEntries.MMX.secondaryIata, ["AGH", "KID"]);
  assert.deepEqual(iata.secondaryEntries.AGH, {
    code: "AGH",
    primaryIata: "MMX",
  });
});

test("supports legacy object keys with null values", () => {
  const document = config();
  delete document.iata;
  delete document.allowed_iata;
  document.IATA_whitelist = true;
  document.allowed_regions = { STO: null, MMX: null };
  setConfigDocumentForTests(document);
  assert.deepEqual(loadMqttConfig().iata.allowedPrimaryIata, ["STO", "MMX"]);
});

test("strict whitelist validation rejects invalid and duplicate relationships", () => {
  const cases = [
    [{ BAD_CODE: {} }, /allowed_iata\.BAD_CODE.*three letters/i],
    [
      { MMX: { secondary_iata: "AGH, bad1" } },
      /allowed_iata\.MMX\.secondary_iata.*bad1.*three letters/i,
    ],
    [{ sto: {}, STO: {} }, /duplicates primary IATA "STO"/i],
    [
      { MMX: { secondary_iata: "AGH, agh" } },
      /secondary_iata.*duplicate item "AGH"/i,
    ],
    [
      { MMX: { secondary_iata: "AGH" }, STO: { secondary_iata: "AGH" } },
      /item "AGH".*already assigned.*MMX/i,
    ],
    [
      { MMX: { secondary_iata: "AGH" }, AGH: {} },
      /item "AGH".*top-level allowed IATA/i,
    ],
    [{}, /allowed_iata.*must not be empty/i],
    [
      { MMX: { secondary_iata: "AGH," } },
      /secondary_iata.*empty secondary-IATA item/i,
    ],
  ];
  for (const [allowed_iata, pattern] of cases) {
    configFailure(config({ allowlist_enabled: true, allowed_iata }), pattern);
    resetConfigCacheForTests();
  }
});

test("test MQTT ingress requires an explicit flag and defaults false", () => {
  setConfigDocumentForTests(config({ allowlist_enabled: true }));
  assert.equal(loadMqttConfig().iata.allowTestIngress, false);
  resetConfigCacheForTests();
  setConfigDocumentForTests(
    config({ allowlist_enabled: true, allow_test_ingress: true }),
  );
  assert.equal(loadMqttConfig().iata.allowTestIngress, true);
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
});

test("loads configured subscriber accounts", () => {
  setConfigDocumentForTests(config());
  assert.equal(loadSubscriberConfig().users[0].username, "viewer");
});

test("meshcore_io api_url rejects credentials in the URL", () => {
  setConfigDocumentForTests({
    meshcore_io: {
      enabled: true,
      api_url: "https://user:secret@example.com/upload",
      workers: 1,
      max_queued_uploads: 10,
      attempts: 3,
    },
  });
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  try {
    assert.throws(() => loadMeshcoreIoConfig(), /process\.exit called/);
  } finally {
    exitSpy.mockRestore();
  }
});

test("removed settings are ignored and cannot affect active configuration", () => {
  const document = config();
  setConfigDocumentForTests(document);
  const activeSettings = () => ({
    mqtt: loadMqttConfig(),
    subscribers: loadSubscriberConfig(),
    meshcoreIo: loadMeshcoreIoConfig(),
  });
  const expected = activeSettings();
  setConfigDocumentForTests({
    ...document,
    storage: { raw_retention_days: -1 },
    decryption: { channels: "invalid" },
    proxy: { trust_proxy: "invalid" },
    broker: {
      ...document.broker,
      runtime_id_file: "/no-longer-used",
      node_name_cache_ttl_ms: -1,
    },
    abuse: {
      enforcement_enabled: "invalid",
      duplicate_threshold: -1,
    },
  });
  assert.deepEqual(activeSettings(), expected);
});

test("rejects v1_-prefixed subscriber names at config load", () => {
  const exit = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    setConfigDocumentForTests({
      subscribers: {
        default_max_connections: 1,
        users: [{ username: "v1_abc", password: "x" }],
      },
    });
    assert.throws(() => loadSubscriberConfig(), /process\.exit/);
    assert.match(error.mock.calls.flat().join("\n"), /v1_/);
  } finally {
    exit.mockRestore();
    error.mockRestore();
    resetConfigCacheForTests();
  }
});

test("docker_health is an ordinary configured subscriber account", () => {
  setConfigDocumentForTests({
    subscribers: {
      default_max_connections: 1,
      users: [{ username: "docker_health", password: "operator-secret" }],
    },
  });
  assert.equal(loadSubscriberConfig().users[0].username, "docker_health");
});
