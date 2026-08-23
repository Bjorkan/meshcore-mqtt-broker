import assert from "node:assert/strict";
import { afterEach, jest, test } from "@jest/globals";
import {
  loadAbuseConfig,
  loadDecryptionConfig,
  loadMeshcoreIoConfig,
  loadMqttConfig,
  loadStorageConfig,
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
    iata: {
      allowlist_enabled: overrides.allowlist_enabled ?? true,
      allow_test_ingress: overrides.allow_test_ingress ?? false,
    },
    allowed_iata: Object.hasOwn(overrides, "allowed_iata")
      ? overrides.allowed_iata
      : { STO: { friendly_name: "Stockholm" } },
    ...(Object.hasOwn(overrides, "branding")
      ? { branding: overrides.branding }
      : {}),
  };
}

function configFailure(document, pattern) {
  setConfigDocumentForTests(document);
  const exit = jest.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    assert.throws(() => loadMqttConfig(), /process\.exit/);
    assert.match(error.mock.calls.flat().join("\n"), pattern);
  } finally {
    exit.mockRestore();
    error.mockRestore();
  }
}

function storageFailure(document, pattern) {
  setConfigDocumentForTests(document);
  const exit = jest.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    assert.throws(() => loadStorageConfig(), /process\.exit/);
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
  assert.equal("databasePath" in mqtt, false);
});

test("storage configuration has safe defaults and supports explicit retention", () => {
  setConfigDocumentForTests(config());
  assert.deepEqual(loadStorageConfig(), {
    retentionDays: 30,
    cleanupIntervalMinutes: 60,
    cleanupBatchSize: 1000,
    storeInternal: false,
    storeSerial: false,
  });
  resetConfigCacheForTests();
  setConfigDocumentForTests({
    ...config(),
    storage: {
      retention_days: 7,
      cleanup_interval_minutes: 5,
      cleanup_batch_size: 25,
    },
  });
  assert.equal(loadStorageConfig().retentionDays, 7);
  resetConfigCacheForTests();
  setConfigDocumentForTests({
    ...config(),
    storage: { retention_days: 90 },
  });
  assert.equal(loadStorageConfig().retentionDays, 90);
});

test.each([0, -1, "invalid"])(
  "rejects invalid storage retention_days %s",
  (retentionDays) => {
    storageFailure(
      {
        ...config(),
        storage: { retention_days: retentionDays },
      },
      /storage\.retention_days.*(?:at least 1|integer)/i,
    );
  },
);

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

test("subscriber and abuse configuration remain compatible", () => {
  setConfigDocumentForTests(config());
  assert.equal(loadSubscriberConfig().users[0].username, "viewer");
  assert.equal(loadAbuseConfig().enforcementEnabled, false);
});

test("storage cleanup batch size has an upper bound", () => {
  setConfigDocumentForTests({
    storage: {
      retention_days: 30,
      cleanup_interval_minutes: 60,
      cleanup_batch_size: 1_000_000,
    },
  });
  const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  try {
    assert.throws(() => loadStorageConfig(), /process\.exit called/);
  } finally {
    exitSpy.mockRestore();
  }
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
  const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  try {
    assert.throws(() => loadMeshcoreIoConfig(), /process\.exit called/);
  } finally {
    exitSpy.mockRestore();
  }
});

test("decryption configuration has safe defaults and validates channel keys", () => {
  setConfigDocumentForTests(config());
  assert.deepEqual(loadDecryptionConfig(), {
    enabled: false,
    hashtagChannels: [],
    channels: [],
  });

  resetConfigCacheForTests();
  setConfigDocumentForTests({
    ...config(),
    decryption: {
      enabled: true,
      hashtag_channels: [
        "test",
        "#slay",
        "#Stortecken",
        "#slay",
        "#STORtecken",
      ],
      channels: [{ name: "bot", key: "EB50A1BCB3E4E5D7BF69A57C9DADA211" }],
    },
  });
  assert.deepEqual(loadDecryptionConfig(), {
    enabled: true,
    hashtagChannels: ["#test", "#slay", "#stortecken"],
    channels: [{ name: "bot", key: "eb50a1bcb3e4e5d7bf69a57c9dada211" }],
  });
});

test("decryption configuration rejects invalid entries", () => {
  const invalidHex = {
    decryption: {
      enabled: true,
      channels: [{ name: "kanal", key: "not-hex" }],
    },
  };
  setConfigDocumentForTests(invalidHex);
  const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    assert.throws(() => loadDecryptionConfig(), /process\.exit called/);
    assert.match(
      errorSpy.mock.calls.flat().join("\n"),
      /decryption\.channels\[0\]\.key must be exactly 32 hexadecimal characters/,
    );
  } finally {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  }

  resetConfigCacheForTests();
  setConfigDocumentForTests({
    decryption: {
      enabled: true,
      hashtag_channels: "not-a-list",
    },
  });
  const exitSpy2 = jest.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  try {
    assert.throws(() => loadDecryptionConfig(), /process\.exit called/);
  } finally {
    exitSpy2.mockRestore();
  }

  resetConfigCacheForTests();
  setConfigDocumentForTests({
    decryption: {
      enabled: true,
      hashtag_channels: Array.from({ length: 101 }, (_, i) => `#c${i}`),
    },
  });
  const exitSpy3 = jest.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  try {
    assert.throws(() => loadDecryptionConfig(), /process\.exit called/);
  } finally {
    exitSpy3.mockRestore();
  }
});
