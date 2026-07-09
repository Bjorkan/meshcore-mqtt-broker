import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jest, test } from "@jest/globals";

import {
  configBool,
  loadAbuseConfig,
  loadMqttConfig,
  loadSubscriberConfig,
  resetConfigCacheForTests,
  setConfigDocumentForTests,
} from "../dist/config.js";

function baseConfig(overrides = {}) {
  return {
    mqtt: {
      ws_port: 8883,
      host: "127.0.0.1",
      json_publish_max_bytes: 8192,
      ws_max_payload_bytes: 65536,
      ...overrides.mqtt,
    },
    dashboard: {
      port: 8080,
      ...overrides.dashboard,
    },
    auth: {
      expected_audience: "meshcore-test-audience",
      ...overrides.auth,
    },
    broker: {
      kv_url: "redis://valkey:6379",
      kv_namespace: "meshcore-mqtt-broker",
      runtime_id_file: overrides.broker?.runtime_id_file,
      name: overrides.broker?.name,
      node_name_cache_ttl_ms: 86400000,
      ...overrides.broker,
    },
    subscribers: {
      default_max_connections: 2,
      users: [
        {
          username: "viewer",
          password: "viewer-pass",
          role: 2,
          max_connections: 1,
        },
        {
          username: "admin",
          password: "admin-pass",
          role: 1,
          max_connections: 10,
        },
      ],
      ...overrides.subscribers,
    },
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
      ...overrides.abuse,
    },
    allowed_regions: {
      JKG: { friendly_name: "Jönköping" },
      ...overrides.allowed_regions,
    },
  };
}

function deletePath(object, path) {
  const parent = path
    .slice(0, -1)
    .reduce((current, part) => current?.[part], object);
  if (parent && typeof parent === "object") {
    delete parent[path[path.length - 1]];
  }
}

function withConfig(document, fn) {
  const errors = [];
  const tempDir = mkdtempSync(join(tmpdir(), "meshcore-config-id-test-"));
  const exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit:${code}`);
  });
  const errorSpy = jest
    .spyOn(console, "error")
    .mockImplementation((...args) => {
      errors.push(args.join(" "));
    });

  try {
    resetConfigCacheForTests();
    document.broker = {
      ...(document.broker || {}),
      runtime_id_file: join(tempDir, "broker-id"),
    };
    setConfigDocumentForTests(document);
    return fn(errors);
  } finally {
    resetConfigCacheForTests();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

test("allows MQTT port 0 for ephemeral test binds", () => {
  withConfig(baseConfig({ mqtt: { ws_port: 0 } }), () => {
    assert.equal(loadMqttConfig().wsPort, 0);
  });
});

test("loads runtime settings, subscribers, and allowed region metadata from config.yaml shape", () => {
  withConfig(
    baseConfig({
      mqtt: { ws_port: 1884 },
      auth: { expected_audience: "yaml-audience" },
      broker: {
        kv_url: "redis://yaml-valkey:6379",
        kv_namespace: "yaml-namespace",
      },
      subscribers: { default_max_connections: 4 },
    }),
    () => {
      const mqttConfig = loadMqttConfig();
      assert.equal(mqttConfig.wsPort, 1884);
      assert.equal(mqttConfig.host, "127.0.0.1");
      assert.equal(mqttConfig.expectedAudience, "yaml-audience");
      assert.equal(mqttConfig.kvUrl, "redis://yaml-valkey:6379");
      assert.equal(mqttConfig.kvNamespace, "yaml-namespace");
      assert.ok(mqttConfig.allowedRegions.includes("JKG"));
      assert.ok(
        mqttConfig.allowedRegionSources.some((source) =>
          source.startsWith("config.yaml allowed_regions"),
        ),
      );

      const subscriberConfig = loadSubscriberConfig();
      assert.equal(subscriberConfig.defaultMaxConnections, 4);
      assert.deepEqual(
        subscriberConfig.users.map((user) => user.username),
        ["viewer", "admin"],
      );
      assert.equal(loadAbuseConfig().bucketCapacity, 20);
    },
  );
});

test("allows explicit empty auth audience to disable audience validation", () => {
  withConfig(baseConfig({ auth: { expected_audience: "" } }), () => {
    assert.equal(loadMqttConfig().expectedAudience, "");
  });
});

test.each([
  [
    "mqtt.ws_port rejects non-numeric values",
    loadMqttConfig,
    ["mqtt", "ws_port"],
    "abc",
    /mqtt\.ws_port/,
    /heltal/,
  ],
  [
    "mqtt.ws_port rejects ports above the TCP range",
    loadMqttConfig,
    ["mqtt", "ws_port"],
    "65536",
    /mqtt\.ws_port/,
    /högst 65535/,
  ],
  [
    "auth.expected_audience is required",
    loadMqttConfig,
    ["auth", "expected_audience"],
    undefined,
    /auth\.expected_audience/,
    /saknas/,
  ],
  [
    "auth.expected_audience rejects whitespace-only values",
    loadMqttConfig,
    ["auth", "expected_audience"],
    "   ",
    /auth\.expected_audience/,
    /mellanslag/,
  ],
  [
    "abuse.bucket_refill_rate rejects non-numeric values",
    loadAbuseConfig,
    ["abuse", "bucket_refill_rate"],
    "foo",
    /abuse\.bucket_refill_rate/,
    /giltigt tal/,
  ],
  [
    "abuse.bucket_refill_rate rejects non-positive values",
    loadAbuseConfig,
    ["abuse", "bucket_refill_rate"],
    "0",
    /abuse\.bucket_refill_rate/,
    /större än 0/,
  ],
  [
    "abuse.enforcement_enabled rejects non-boolean values",
    loadAbuseConfig,
    ["abuse", "enforcement_enabled"],
    "yes",
    /abuse\.enforcement_enabled/,
    /true/,
  ],
  [
    "subscribers.default_max_connections rejects zero",
    loadSubscriberConfig,
    ["subscribers", "default_max_connections"],
    "0",
    /subscribers\.default_max_connections/,
    /minst 1/,
  ],
  [
    "subscribers.default_max_connections rejects negative values",
    loadSubscriberConfig,
    ["subscribers", "default_max_connections"],
    "-1",
    /subscribers\.default_max_connections/,
    /minst 1/,
  ],
  [
    "mqtt.json_publish_max_bytes rejects fractional values",
    loadMqttConfig,
    ["mqtt", "json_publish_max_bytes"],
    "12.5",
    /mqtt\.json_publish_max_bytes/,
    /heltal/,
  ],
  [
    "broker.node_name_cache_ttl_ms rejects non-positive values",
    loadMqttConfig,
    ["broker", "node_name_cache_ttl_ms"],
    "0",
    /broker\.node_name_cache_ttl_ms/,
    /större än 0/,
  ],
  [
    "broker.kv_url is required",
    loadMqttConfig,
    ["broker", "kv_url"],
    undefined,
    /broker\.kv_url/,
    /saknas/,
  ],
])(
  "%s before startup",
  (_name, loadConfig, path, value, configPattern, messagePattern) => {
    const document = baseConfig();
    if (value === undefined) {
      deletePath(document, path);
    } else {
      path.slice(0, -1).reduce((current, part) => current[part], document)[
        path[path.length - 1]
      ] = value;
    }
    withConfig(document, (errors) => {
      assert.throws(() => loadConfig(), /process\.exit:1/);
      assert.match(errors.join("\n"), configPattern);
      assert.match(errors.join("\n"), messagePattern);
    });
  },
);

test("loads mandatory Valkey orchestration configuration", () => {
  withConfig(baseConfig(), () => {
    const config = loadMqttConfig();
    assert.equal(config.kvUrl, "redis://valkey:6379");
    assert.equal(config.kvNamespace, "meshcore-mqtt-broker");
    assert.ok(config.instanceId.length > 0);
  });
});

test("loads explicit Valkey orchestration namespace", () => {
  withConfig(
    baseConfig({
      broker: {
        kv_url: "redis://valkey:6379",
        kv_namespace: "test-namespace",
      },
    }),
    () => {
      const config = loadMqttConfig();
      assert.equal(config.kvUrl, "redis://valkey:6379");
      assert.equal(config.kvNamespace, "test-namespace");
      assert.match(config.instanceId, /^Broker-[2-9A-HJ-NP-Z]{4}$/);
    },
  );
});

test("uses broker.name as generated broker id prefix", () => {
  withConfig(baseConfig({ broker: { name: "Meshat" } }), () => {
    assert.match(loadMqttConfig().instanceId, /^Meshat-[2-9A-HJ-NP-Z]{4}$/);
  });
});

test("accepts valid boolean values for configBool", () => {
  for (const valid of ["true", "false", "yes", "no", "on", "off", "1", "0"]) {
    withConfig(baseConfig({ proxy: { trust_proxy: valid } }), () => {
      const result = configBool(["proxy", "trust_proxy"], false);
      assert.ok(typeof result === "boolean", `expected boolean for "${valid}"`);
    });
  }
});

test.each([
  ["ture", "ture"],
  ["nope", "nope"],
  ["maybe", "maybe"],
  ["TRUE ", "TRUE "],
  ["truthy", "truthy"],
  ["falsy", "falsy"],
])('configBool rejects invalid boolean value "%s"', (value, _label) => {
  const errors = [];
  const tempDir = mkdtempSync(join(tmpdir(), "meshcore-config-bool-test-"));
  const exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit:${code}`);
  });
  const errorSpy = jest
    .spyOn(console, "error")
    .mockImplementation((...args) => {
      errors.push(args.join(" "));
    });

  try {
    resetConfigCacheForTests();
    setConfigDocumentForTests({
      proxy: { trust_proxy: value },
      target_mqtt: { reject_unauthorized: value },
    });
    assert.throws(
      () => configBool(["proxy", "trust_proxy"], false),
      /process\.exit:1/,
    );
    assert.match(errors.join("\n"), /trust_proxy/);
    assert.match(errors.join("\n"), /true\/false/);
  } finally {
    resetConfigCacheForTests();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("configBool rejects invalid boolean for reject_unauthorized", () => {
  const errors = [];
  const tempDir = mkdtempSync(join(tmpdir(), "meshcore-config-reject-test-"));
  const exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit:${code}`);
  });
  const errorSpy = jest
    .spyOn(console, "error")
    .mockImplementation((...args) => {
      errors.push(args.join(" "));
    });

  try {
    resetConfigCacheForTests();
    setConfigDocumentForTests({
      target_mqtt: { reject_unauthorized: "ture" },
    });
    assert.throws(
      () => configBool(["target_mqtt", "reject_unauthorized"], true),
      /process\.exit:1/,
    );
    assert.match(errors.join("\n"), /reject_unauthorized/);
    assert.match(errors.join("\n"), /ture/);
    assert.doesNotMatch(errors.join("\n"), /resulterade i false/);
  } finally {
    resetConfigCacheForTests();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
