import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, expect, mock, spyOn, test } from "bun:test";

import {
  resetConfigCacheForTests,
  setConfigDocumentForTests,
} from "../src/config.js";
import {
  loadTargetBridgeConfig,
  redactTargetUrl,
  shouldForwardToTarget,
  startTargetBridge,
} from "../src/target-bridge.js";

const PUBLIC_KEY =
  "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";
const OTHER_PUBLIC_KEY =
  "7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400";

function packet(topic, payload = "{}", retain = false) {
  return {
    cmd: "publish",
    topic,
    payload: Buffer.from(payload),
    qos: 0,
    dup: false,
    retain,
  };
}

function publisherClient(overrides = {}) {
  return {
    clientType: "publisher",
    publicKey: PUBLIC_KEY,
    ...overrides,
  };
}

function fakeMqttClient() {
  const client = new EventEmitter();
  client.connected = false;
  client.publish = mock((topic, payload, options, callback) => {
    callback?.(null);
  });
  client.end = mock((_force, _options, callback) => callback?.());
  return client;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => resetConfigCacheForTests());

function configWithBrokerName(name, target = {}) {
  return {
    broker: {
      name,
    },
    target_mqtt: {
      url: "",
      username: "",
      password: "",
      ...target,
    },
  };
}

test("target bridge client id is injected by the broker process", () => {
  // Single identity per process: startBrokerServer injects clientId =
  // brokerIdentity. Standalone loadTargetBridgeConfig falls back to a
  // static default; broker name is only a display prefix for the identity.
  setConfigDocumentForTests(
    configWithBrokerName("Uplink", {
      url: "mqtts://mqtt.example.com:8883",
      username: "uplink",
      password: "secret",
    }),
  );

  try {
    const config = loadTargetBridgeConfig({ clientId: "Uplink-ABCD" });
    assert.equal(config.enabled, true);
    assert.equal(config.clientId, "Uplink-ABCD");
    assert.equal(config.targetUrl, "mqtts://mqtt.example.com:8883");
    assert.equal(config.targetUser, "uplink");
    assert.equal(config.targetPass, "secret");
    const fallback = loadTargetBridgeConfig();
    assert.equal(fallback.clientId, "meshcore-mqtt-broker");
  } finally {
    resetConfigCacheForTests();
  }
});

test("target bridge is disabled when target_mqtt.url is empty", () => {
  setConfigDocumentForTests({ target_mqtt: { url: "" } });
  const config = loadTargetBridgeConfig();

  assert.equal(config.enabled, false);
  resetConfigCacheForTests();
});

test("target bridge redacts credentials embedded in its URL", () => {
  const redacted = redactTargetUrl(
    "mqtts://uplink:super-secret@mqtt.example.com:8883/path",
  );

  assert.equal(redacted, "mqtts://***:***@mqtt.example.com:8883/path");
  assert.ok(!redacted.includes("uplink"));
  assert.ok(!redacted.includes("super-secret"));
});

test.each([
  [
    "publisher on own status topic",
    `meshcore/test/${PUBLIC_KEY}/status`,
    publisherClient(),
    true,
  ],
  [
    "publisher on another public key topic",
    `meshcore/test/${OTHER_PUBLIC_KEY}/status`,
    publisherClient(),
    false,
  ],
  [
    "subscriber client on publisher topic",
    `meshcore/test/${PUBLIC_KEY}/status`,
    { clientType: "subscriber", publicKey: PUBLIC_KEY },
    false,
  ],
  [
    "broker-owned internal topic",
    `meshcore/test/${PUBLIC_KEY}/internal`,
    publisherClient(),
    false,
  ],
  [
    "broker-owned serial command topic",
    `meshcore/test/${PUBLIC_KEY}/serial/commands`,
    publisherClient(),
    false,
  ],
  [
    "broker-owned serial response topic",
    `meshcore/test/${PUBLIC_KEY}/serial/responses`,
    publisherClient(),
    false,
  ],
  [
    "unsupported public topic",
    `meshcore/test/${PUBLIC_KEY}/internalized`,
    publisherClient(),
    false,
  ],
])("target bridge forwarding policy: %s", (_name, topic, client, expected) => {
  assert.equal(shouldForwardToTarget(packet(topic), client), expected);
});

test("forwards only neighbors with retain", async () => {
  const target = fakeMqttClient();
  const runtime = startTargetBridge(
    {
      enabled: true,
      targetUrl: "mqtts://user:secret@mqtt.example.com:8883",
      targetUser: "",
      targetPass: "",
      clientId: "broker-host-7",
      reconnectPeriodMs: 5000,
      connectTimeoutMs: 30000,
      rejectUnauthorized: true,
    },
    {
      connect: () => target,
    },
  );

  target.connected = true;
  target.emit("connect");
  assert.equal(
    runtime.getStatus().targetUrl,
    "mqtts://***:***@mqtt.example.com:8883",
  );

  for (const [subtopic, msg, expectedRetain] of [
    ["status", '{"ok":true}', false],
    ["neighbors", '{"neighbors":[]}', true],
    ["packets", '{"raw":"00"}', false],
  ]) {
    target.publish.mockClear();
    runtime.forwardPublish(
      packet(`meshcore/test/${PUBLIC_KEY}/${subtopic}`, msg, false),
      publisherClient(),
    );
    await settle();

    expect(target.publish).toHaveBeenCalledTimes(1);
    const [_topic, _payload, options] = target.publish.mock.calls[0];
    assert.equal(
      options.retain,
      expectedRetain,
      `${subtopic} retain should be ${expectedRetain}`,
    );
  }

  assert.equal(runtime.getSuccessfulMessageCount(), 3);
  await runtime.stop();
});

function retainedTestRuntime(target, retainedCapacity = 1, dependencies = {}) {
  return startTargetBridge(
    {
      enabled: true,
      targetUrl: "mqtts://mqtt.example.com:8883",
      targetUser: "",
      targetPass: "",
      clientId: "retained-test",
      reconnectPeriodMs: 5000,
      connectTimeoutMs: 30000,
      rejectUnauthorized: true,
    },
    {
      connect: () => target,
      retainedCapacity,
      ...dependencies,
    },
  );
}

function forwardNeighbor(runtime, iata) {
  runtime.forwardPublish(
    packet(`meshcore/${iata}/${PUBLIC_KEY}/neighbors`, '{"neighbors":[]}'),
    publisherClient(),
  );
}

function targetWrites(target) {
  return target.publish.mock.calls.map(([topic, payload, options]) => [
    topic.split("/")[1],
    payload.toString(),
    options.retain,
  ]);
}

test("target clears retained capacity before writing the next topic", async () => {
  const target = fakeMqttClient();
  const runtime = retainedTestRuntime(target);
  target.connected = true;
  target.emit("connect");
  try {
    forwardNeighbor(runtime, "STO");
    forwardNeighbor(runtime, "MMX");
    forwardNeighbor(runtime, "GOT");
    await settle();
    assert.deepEqual(targetWrites(target), [
      ["STO", '{"neighbors":[]}', true],
      ["STO", "", true],
      ["MMX", '{"neighbors":[]}', true],
      ["MMX", "", true],
      ["GOT", '{"neighbors":[]}', true],
    ]);
    assert.equal(runtime.getSuccessfulMessageCount(), 3);
  } finally {
    await runtime.stop();
  }
});

test("failed capacity clear preserves its obligation and prevents new retained writes", async () => {
  const target = fakeMqttClient();
  const runtime = retainedTestRuntime(target);
  target.connected = true;
  target.emit("connect");
  try {
    forwardNeighbor(runtime, "STO");
    await settle();
    target.publish.mockImplementation((_topic, payload, _options, callback) => {
      callback(payload.length === 0 ? new Error("clear failed") : null);
    });
    forwardNeighbor(runtime, "MMX");
    await settle();
    assert.equal(runtime.getDroppedMessageCount(), 1);
    target.publish.mockImplementation(
      (_topic, _payload, _options, callback) => {
        callback(null);
      },
    );
    forwardNeighbor(runtime, "GOT");
    await settle();
    assert.deepEqual(targetWrites(target), [
      ["STO", '{"neighbors":[]}', true],
      ["STO", "", true],
      ["STO", "", true],
      ["GOT", '{"neighbors":[]}', true],
    ]);
  } finally {
    await runtime.stop();
  }
});

test("capacity eviction uses least recently refreshed retained topic", async () => {
  const target = fakeMqttClient();
  const runtime = retainedTestRuntime(target, 2);
  target.connected = true;
  target.emit("connect");
  try {
    for (const iata of ["STO", "MMX", "STO", "GOT"]) {
      forwardNeighbor(runtime, iata);
    }
    await settle();
    assert.deepEqual(targetWrites(target), [
      ["STO", '{"neighbors":[]}', true],
      ["MMX", '{"neighbors":[]}', true],
      ["STO", '{"neighbors":[]}', true],
      ["MMX", "", true],
      ["GOT", '{"neighbors":[]}', true],
    ]);
  } finally {
    await runtime.stop();
  }
});

test("queued retained forward does not write after disconnect", async () => {
  const target = fakeMqttClient();
  const runtime = retainedTestRuntime(target);
  target.connected = true;
  target.emit("connect");
  try {
    forwardNeighbor(runtime, "STO");
    target.connected = false;
    target.emit("close");
    await settle();
    assert.equal(target.publish.mock.calls.length, 0);
    assert.equal(runtime.getDroppedMessageCount(), 1);
  } finally {
    await runtime.stop();
  }
});

test("target forward queue drops when in-flight forwards exceed the limit", async () => {
  const target = fakeMqttClient();
  target.publish.mockImplementation((_topic, _payload, _options, callback) => {
    callbacks.push(callback);
  });
  const callbacks = [];
  const runtime = retainedTestRuntime(target, 10, {
    maxPendingForwards: 2,
    publishTimeoutMs: 5_000,
  });
  target.connected = true;
  target.emit("connect");
  try {
    for (let i = 0; i < 4; i++) {
      runtime.forwardPublish(
        packet(`meshcore/test/${PUBLIC_KEY}/status`, '{"ok":true}'),
        publisherClient(),
      );
    }
    await settle();
    assert.equal(runtime.getDroppedMessageCount(), 2);
    assert.equal(target.publish.mock.calls.length, 2);
    await settle();
    for (const callback of callbacks) callback(null);
    await settle();
    assert.equal(runtime.getSuccessfulMessageCount(), 2);
  } finally {
    await runtime.stop();
  }
});

test("target publish timeout is bounded and counts as dropped", async () => {
  const target = fakeMqttClient();
  target.publish.mockImplementation(() => {});
  const runtime = retainedTestRuntime(target, 10, {
    publishTimeoutMs: 20,
  });
  target.connected = true;
  target.emit("connect");
  try {
    runtime.forwardPublish(
      packet(`meshcore/test/${PUBLIC_KEY}/status`, '{"ok":true}'),
      publisherClient(),
    );
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(runtime.getDroppedMessageCount(), 1);
    assert.equal(runtime.getSuccessfulMessageCount(), 0);
    target.publish.mockImplementation((_t, _p, _o, callback) => callback(null));
    runtime.forwardPublish(
      packet(`meshcore/test/${PUBLIC_KEY}/status`, '{"ok":true}'),
      publisherClient(),
    );
    await settle();
    assert.equal(runtime.getSuccessfulMessageCount(), 1);
  } finally {
    await runtime.stop();
  }
});

test("late target publish callbacks cannot double-count or revive slots", async () => {
  const target = fakeMqttClient();
  const callbacks = [];
  target.publish.mockImplementation((_topic, _payload, _options, callback) => {
    callbacks.push(callback);
  });
  const runtime = retainedTestRuntime(target, 10, { maxPendingForwards: 1 });
  target.connected = true;
  target.emit("connect");
  try {
    runtime.forwardPublish(
      packet(`meshcore/test/${PUBLIC_KEY}/status`, '{"ok":true}'),
      publisherClient(),
    );
    await settle();
    runtime.forwardPublish(
      packet(`meshcore/test/${PUBLIC_KEY}/status`, '{"ok":true}'),
      publisherClient(),
    );
    await settle();
    assert.equal(runtime.getDroppedMessageCount(), 1);
    callbacks[0](null);
    await settle();
    assert.equal(runtime.getSuccessfulMessageCount(), 1);
    callbacks[0](new Error("late failure"));
    await settle();
    assert.equal(runtime.getDroppedMessageCount(), 1);
    assert.equal(runtime.getSuccessfulMessageCount(), 1);
    runtime.forwardPublish(
      packet(`meshcore/test/${PUBLIC_KEY}/status`, '{"ok":true}'),
      publisherClient(),
    );
    await settle();
    callbacks[1](null);
    await settle();
    assert.equal(runtime.getSuccessfulMessageCount(), 2);
  } finally {
    await runtime.stop();
  }
});

test("target bridge stop waits for in-flight forwards and closes cleanly", async () => {
  const target = fakeMqttClient();
  const callbacks = [];
  target.publish.mockImplementation((_topic, _payload, _options, callback) => {
    callbacks.push(callback);
  });
  const runtime = retainedTestRuntime(target, 10);
  target.connected = true;
  target.emit("connect");
  runtime.forwardPublish(
    packet(`meshcore/test/${PUBLIC_KEY}/status`, '{"ok":true}'),
    publisherClient(),
  );
  await settle();
  const stopping = runtime.stop();
  callbacks[0](null);
  await settle();
  await stopping;
  assert.equal(target.end.mock.calls.length, 1);
  assert.equal(runtime.getSuccessfulMessageCount(), 1);
});

test("tracks dropped observer messages while target is offline", async () => {
  const target = fakeMqttClient();
  setConfigDocumentForTests(
    configWithBrokerName("Broker", {
      url: "mqtts://mqtt.example.com:8883",
    }),
  );
  const runtime = startTargetBridge(
    {
      ...loadTargetBridgeConfig(),
    },
    {
      connect: () => target,
    },
  );

  runtime.forwardPublish(
    packet(`meshcore/test/${PUBLIC_KEY}/status`, '{"ok":true}'),
    publisherClient(),
  );

  assert.equal(runtime.getDroppedMessageCount(), 1);
  assert.equal(runtime.getSuccessfulMessageCount(), 0);
  assert.equal(runtime.getStatus().successfulMessages, 0);
  expect(target.publish).not.toHaveBeenCalled();

  await runtime.stop();
  resetConfigCacheForTests();
});

test("tracks target publish callback errors as dropped messages", async () => {
  const target = fakeMqttClient();
  target.publish.mockImplementation((_topic, _payload, _options, callback) => {
    callback?.(new Error("target rejected publish"));
  });
  const runtime = startTargetBridge(
    {
      enabled: true,
      targetUrl: "mqtts://mqtt.example.com:8883",
      targetUser: "",
      targetPass: "",
      clientId: "broker-host-8",
      reconnectPeriodMs: 5000,
      connectTimeoutMs: 30000,
      rejectUnauthorized: true,
    },
    { connect: () => target },
  );
  target.connected = true;
  target.emit("connect");

  runtime.forwardPublish(
    packet(`meshcore/test/${PUBLIC_KEY}/status`, '{"ok":true}'),
    publisherClient(),
  );
  await settle();

  assert.equal(runtime.getDroppedMessageCount(), 1);
  assert.equal(runtime.getSuccessfulMessageCount(), 0);
  await runtime.stop();
});

test("target bridge rejects invalid reconnect and connect timeouts", () => {
  const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit:${code}`);
  });
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});

  try {
    setConfigDocumentForTests({
      target_mqtt: {
        url: "mqtts://mqtt.example.com:8883",
        reconnect_period_ms: -1,
      },
    });
    assert.throws(() => loadTargetBridgeConfig(), /process\.exit:1/);

    resetConfigCacheForTests();
    setConfigDocumentForTests({
      target_mqtt: {
        url: "mqtts://mqtt.example.com:8883",
        connect_timeout_ms: 0,
      },
    });
    assert.throws(() => loadTargetBridgeConfig(), /process\.exit:1/);
  } finally {
    resetConfigCacheForTests();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  }
});

test("only forwards allowed observer subtopics: status, packets, and neighbors", () => {
  const allowed = ["status", "packets", "neighbors"];
  for (const subtopic of allowed) {
    const topic = `meshcore/test/${PUBLIC_KEY}/${subtopic}`;
    assert.equal(
      shouldForwardToTarget(packet(topic), publisherClient()),
      true,
      `${subtopic} should be forwarded`,
    );
  }

  const blocked = [
    "internal",
    "serial/commands",
    "serial/responses",
    "heartbeat",
    "telemetry",
    "nodes",
    "position",
    "trace",
    "text",
    "detected",
  ];
  for (const subtopic of blocked) {
    const topic = `meshcore/test/${PUBLIC_KEY}/${subtopic}`;
    assert.equal(
      shouldForwardToTarget(packet(topic), publisherClient()),
      false,
      `${subtopic} should not be forwarded`,
    );
  }
});

test.each(["STO", "test"])(
  "target MQTT receives only exact public observer topics on %s ingress",
  async (ingress) => {
    const target = fakeMqttClient();
    const runtime = retainedTestRuntime(target, 100);
    const topic = (subtopic) => `meshcore/${ingress}/${PUBLIC_KEY}/${subtopic}`;
    // Keep these expectations independent of the production allowlist so
    // widening that list fails this regression test.
    const allowed = ["status", "packets", "neighbors"];
    const blocked = [
      "internal",
      "INTERNAL",
      "Internal/token",
      "internal/token/status",
      "internalized",
      "error",
      "error/status",
      "raw",
      "serial/commands",
      "serial/responses",
      "heartbeat",
      "telemetry",
      "nodes",
      "position",
      "trace",
      "text",
      "detected",
      "",
      ...allowed.flatMap((name) => [
        `internal/${name}`,
        `INTERNAL/${name.toUpperCase()}`,
        `vendor/${name}`,
        `${name}/internal`,
        `${name}/extra`,
        `${name}/`,
        `${name}s`,
      ]),
    ].map(topic);
    blocked.push(
      "$SYS/broker/status",
      "internal/status",
      "other/STO/key/status",
    );

    try {
      // Check both online and offline paths: rejected traffic must neither
      // write immediately nor get replayed when the target reconnects.
      for (const connected of [false, true]) {
        target.connected = connected;
        target.emit(connected ? "connect" : "offline");
        for (const retain of [false, true]) {
          for (const deniedTopic of blocked) {
            runtime.forwardPublish(
              packet(deniedTopic, '{"token":"must-stay-local"}', retain),
              publisherClient(),
            );
          }
          for (const name of allowed) {
            for (const client of [
              null,
              undefined,
              {},
              { publicKey: PUBLIC_KEY },
              publisherClient({ publicKey: undefined }),
              publisherClient({ publicKey: OTHER_PUBLIC_KEY }),
              publisherClient({ clientType: "subscriber", role: "ADMIN" }),
            ]) {
              runtime.forwardPublish(packet(topic(name), "{}", retain), client);
            }
          }
        }
        await settle();
        expect(target.publish).not.toHaveBeenCalled();
        assert.equal(runtime.getSuccessfulMessageCount(), 0);
        assert.equal(runtime.getDroppedMessageCount(), 0);
      }

      // Positive controls prove the connected bridge actually works and
      // preserve the existing case-insensitive exact-subtopic contract.
      const forwardedTopics = allowed.flatMap((name) => [
        topic(name),
        topic(name.toUpperCase()),
      ]);
      for (const allowedTopic of forwardedTopics) {
        runtime.forwardPublish(packet(allowedTopic), publisherClient());
      }
      await settle();
      assert.deepEqual(
        target.publish.mock.calls
          .map(([publishedTopic]) => publishedTopic)
          .sort(),
        forwardedTopics.sort(),
      );
      assert.equal(runtime.getSuccessfulMessageCount(), forwardedTopics.length);
    } finally {
      await runtime.stop();
    }
  },
);
