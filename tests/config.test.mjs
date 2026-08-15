import assert from "node:assert/strict";
import { afterEach, jest, test } from "@jest/globals";
import {
  loadAbuseConfig,
  loadMeshcoreIoConfig,
  loadMqttConfig,
  loadStorageConfig,
  loadMcpConfig,
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
    IATA_whitelist: overrides.IATA_whitelist ?? false,
    allowed_regions: Object.hasOwn(overrides, "allowed_regions")
      ? overrides.allowed_regions
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
  assert.equal(mqtt.regions.whitelistEnabled, false);
  assert.deepEqual(mqtt.regions.allowedPrimaryRegions, []);
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

test("public MCP V2 defaults are anonymous, bounded, and canonical", () => {
  setConfigDocumentForTests(config());
  assert.deepEqual(loadMcpConfig(), {
    enabled: true,
    path: "/mcp/v2",
    defaultLimit: 50,
    maxLimit: 250,
  });

  setConfigDocumentForTests({
    ...config(),
    mcp: {
      enabled: false,
      path: "/mcp/v2",
      default_limit: 25,
      max_limit: 100,
    },
  });
  assert.deepEqual(loadMcpConfig(), {
    enabled: false,
    path: "/mcp/v2",
    defaultLimit: 25,
    maxLimit: 100,
  });
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

test("ignores the removed dashboard port in older configuration files", () => {
  const document = config();
  document.dashboard = { port: "obsolete" };
  setConfigDocumentForTests(document);
  assert.equal(loadMqttConfig().wsPort, 0);
});

test("uses neutral branding defaults", () => {
  setConfigDocumentForTests(config());
  assert.deepEqual(loadMqttConfig().branding, {
    operatorName: "MeshCore MQTT",
    dashboardTitle: "MeshCore MQTT Broker",
    dashboardSubtitle: "Operations dashboard",
    websiteUrl: undefined,
  });
});

test("loads a complete branding override", () => {
  setConfigDocumentForTests(
    config({
      branding: {
        operator_name: "Community Mesh",
        dashboard_title: "Community Broker",
        dashboard_subtitle: "Network operations",
        website_url: "https://example.org/mesh",
      },
    }),
  );
  assert.deepEqual(loadMqttConfig().branding, {
    operatorName: "Community Mesh",
    dashboardTitle: "Community Broker",
    dashboardSubtitle: "Network operations",
    websiteUrl: "https://example.org/mesh",
  });
});

test("rejects unsafe branding values", () => {
  configFailure(
    config({ branding: { website_url: "javascript:alert(1)" } }),
    /branding\.website_url.*http/i,
  );
  resetConfigCacheForTests();
  configFailure(
    config({ branding: { website_url: "https://user:password@example.org" } }),
    /branding\.website_url.*credentials/i,
  );
  resetConfigCacheForTests();
  configFailure(
    config({ branding: { operator_name: "x".repeat(81) } }),
    /branding\.operator_name.*80/i,
  );
  resetConfigCacheForTests();
  configFailure(
    config({ branding: { dashboard_subtitle: "bad\u0000text" } }),
    /control characters/i,
  );
});

test("preserves existing allowed_regions enforcement when the new flag is absent", () => {
  const legacyConfig = config();
  delete legacyConfig.IATA_whitelist;
  setConfigDocumentForTests(legacyConfig);
  const regions = loadMqttConfig().regions;
  assert.equal(regions.whitelistEnabled, true);
  assert.deepEqual(regions.allowedPrimaryRegions, ["STO"]);
});

test("IATA whitelist defaults to false and ignores inactive malformed regions", () => {
  setConfigDocumentForTests(config({ allowed_regions: { invalid: 42 } }));
  const regions = loadMqttConfig().regions;
  assert.equal(regions.whitelistEnabled, false);
  assert.deepEqual(regions.primaryEntries, {});
});

test("explicit false whitelist ignores obsolete region structures", () => {
  setConfigDocumentForTests(
    config({ IATA_whitelist: false, allowed_regions: [null, { old: true }] }),
  );
  assert.deepEqual(loadMqttConfig().regions.allowedPrimaryRegions, []);
});

test("supports list-form regions with normalization when enabled", () => {
  setConfigDocumentForTests(
    config({ IATA_whitelist: true, allowed_regions: ["sto", " MMX "] }),
  );
  const regions = loadMqttConfig().regions;
  assert.deepEqual(regions.allowedPrimaryRegions, ["STO", "MMX"]);
  assert.equal(regions.primaryEntries.STO.friendlyName, undefined);
});

test("supports object-form friendly names and comma-separated secondaries", () => {
  setConfigDocumentForTests(
    config({
      IATA_whitelist: true,
      allowed_regions: {
        mmx: {
          friendly_name: "Southern region",
          secondary_region: " agh, KID ",
        },
        STO: { friendly_name: "Capital region" },
      },
    }),
  );
  const regions = loadMqttConfig().regions;
  assert.deepEqual(regions.allowedPrimaryRegions, ["MMX", "STO"]);
  assert.deepEqual(regions.primaryEntries.MMX.secondaryRegions, ["AGH", "KID"]);
  assert.deepEqual(regions.secondaryEntries.AGH, {
    code: "AGH",
    primaryRegion: "MMX",
  });
});

test("supports legacy object keys with null values", () => {
  setConfigDocumentForTests(
    config({
      IATA_whitelist: true,
      allowed_regions: { STO: null, MMX: null },
    }),
  );
  assert.deepEqual(loadMqttConfig().regions.allowedPrimaryRegions, [
    "STO",
    "MMX",
  ]);
});

test("strict whitelist validation rejects invalid and duplicate relationships", () => {
  const cases = [
    [{ BAD_CODE: {} }, /allowed_regions\.BAD_CODE.*three letters/i],
    [
      { MMX: { secondary_region: "AGH, bad1" } },
      /allowed_regions\.MMX\.secondary_region.*bad1.*three letters/i,
    ],
    [{ sto: {}, STO: {} }, /duplicates primary region "STO"/i],
    [
      { MMX: { secondary_region: "AGH, agh" } },
      /secondary_region.*duplicate item "AGH"/i,
    ],
    [
      { MMX: { secondary_region: "AGH" }, STO: { secondary_region: "AGH" } },
      /item "AGH".*already assigned.*MMX/i,
    ],
    [
      { MMX: { secondary_region: "AGH" }, AGH: {} },
      /item "AGH".*top-level allowed region/i,
    ],
    [{}, /allowed_regions.*must not be empty/i],
    [
      { MMX: { secondary_region: "AGH," } },
      /secondary_region.*empty secondary-region item/i,
    ],
  ];
  for (const [allowed_regions, pattern] of cases) {
    configFailure(config({ IATA_whitelist: true, allowed_regions }), pattern);
    resetConfigCacheForTests();
  }
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
