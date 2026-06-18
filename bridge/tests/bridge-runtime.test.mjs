import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { loadBridgeConfig, startBridge } from '../dist/bridge.js';

class FakeMqttClient extends EventEmitter {
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.connected = false;
    this.publications = [];
    this.subscriptions = [];
    this.ended = false;
  }

  subscribe(topic, options, callback) {
    this.subscriptions.push({ topic, options });
    callback?.(null, [{ topic, qos: options?.qos ?? 0 }]);
  }

  publish(topic, payload, options, callback) {
    this.publications.push({
      topic,
      payload: Buffer.from(payload),
      options,
    });
    callback?.(null);
  }

  end(_force, _options, callback) {
    this.ended = true;
    this.connected = false;
    callback?.();
  }

  connectNow() {
    this.connected = true;
    this.emit('connect');
  }

  closeNow() {
    this.connected = false;
    this.emit('close');
  }

  receive(topic, payload, packet = {}) {
    this.emit('message', topic, Buffer.from(payload), {
      retain: false,
      ...packet,
    });
  }
}

function bridgeConfig(overrides = {}) {
  return {
    sourceUrl: 'mqtt://source.local:1883',
    sourceUser: 'source-user',
    sourcePass: 'source-pass',
    targetUrl: 'mqtt://target.local:1883',
    targetUser: 'target-user',
    targetPass: 'target-pass',
    sourceClientId: 'source-client',
    targetClientId: 'target-client',
    topicFilter: 'meshcore/#',
    targetPrefix: '',
    heartbeatEnabled: false,
    heartbeatTopic: 'mshse/Hjartslag-test',
    heartbeatMessage: 'alive',
    heartbeatIntervalMs: 60_000,
    reconnectPeriodMs: 10,
    connectTimeoutMs: 100,
    rejectUnauthorized: true,
    debugEnabled: false,
    mapUploader: {
      enabled: false,
      publicKey: '',
      privateKey: '',
      apiUrl: 'https://map.meshcore.io/api/v1/uploader/node',
      minReuploadIntervalSeconds: 3600,
      requestTimeoutMs: 10000,
      retryCooldownMs: 300000,
      requireCompleteRadioParams: true,
    },
    ...overrides,
  };
}

function startFakeBridge(overrides = {}) {
  const clients = [];
  const runtime = startBridge(bridgeConfig(overrides), {
    connect(url, options) {
      const client = new FakeMqttClient(url, options);
      clients.push(client);
      return client;
    },
  });

  return {
    runtime,
    source: clients[0],
    target: clients[1],
  };
}

test('loads heartbeat configuration from the environment with production defaults', () => {
  const defaults = loadBridgeConfig({});
  assert.equal(defaults.heartbeatEnabled, true);
  assert.equal(defaults.heartbeatTopic, 'mshse/Hjärtslag');
  assert.equal(defaults.heartbeatMessage, 'Hjärtat slår');
  assert.equal(defaults.heartbeatIntervalMs, 30_000);

  const configured = loadBridgeConfig({
    HEARTBEAT_ENABLED: 'false',
    HEARTBEAT_TOPIC: 'mshse/test',
    HEARTBEAT_MESSAGE: 'ok',
    HEARTBEAT_INTERVAL_MS: '5000',
    TARGET_REJECT_UNAUTHORIZED: 'false',
    BRIDGE_DEBUG: 'true',
    MESHCOREIO_MAPUPLOAD: 'true',
    MESHCOREIO_PUBKEY: 'a'.repeat(64),
    MESHCOREIO_PRIVATEKEY: 'b'.repeat(128),
  });

  assert.equal(configured.heartbeatEnabled, false);
  assert.equal(configured.heartbeatTopic, 'mshse/test');
  assert.equal(configured.heartbeatMessage, 'ok');
  assert.equal(configured.heartbeatIntervalMs, 5_000);
  assert.equal(configured.rejectUnauthorized, false);
  assert.equal(configured.debugEnabled, true);
  assert.equal(configured.mapUploader.enabled, true);
  assert.equal(configured.mapUploader.publicKey, 'a'.repeat(64));
  assert.equal(configured.mapUploader.privateKey, 'b'.repeat(128));
  assert.equal(configured.mapUploader.apiUrl, 'https://map.meshcore.io/api/v1/uploader/node');
});

test('subscribes to the configured source filter and forwards payloads to the prefixed target topic', async () => {
  const { runtime, source, target } = startFakeBridge({
    targetPrefix: 'uplink/',
    topicFilter: 'meshcore/test/#',
  });

  source.connectNow();
  target.connectNow();
  await runtime.sourceSubscribed;
  await runtime.targetConnected;

  source.receive('meshcore/test/node/packets', 'payload-1', { retain: true });

  assert.deepEqual(source.subscriptions, [
    { topic: 'meshcore/test/#', options: { qos: 0 } },
  ]);
  assert.equal(target.publications.length, 1);
  assert.equal(target.publications[0].topic, 'uplink/meshcore/test/node/packets');
  assert.equal(target.publications[0].payload.toString(), 'payload-1');
  assert.equal(target.publications[0].options.retain, true);

  await runtime.stop();
  assert.equal(source.ended, true);
  assert.equal(target.ended, true);
});

test('does not log forwarded bridge publishes unless bridge debug is enabled', async () => {
  const quiet = startFakeBridge();
  const originalDebug = console.debug;
  const debugLines = [];
  console.debug = (...args) => {
    debugLines.push(args.join(' '));
  };

  try {
    quiet.source.connectNow();
    quiet.target.connectNow();
    await quiet.runtime.sourceSubscribed;
    await quiet.runtime.targetConnected;

    quiet.source.receive('meshcore/STO/node/raw', 'payload');

    const verbose = startFakeBridge({ debugEnabled: true });
    verbose.source.connectNow();
    verbose.target.connectNow();
    await verbose.runtime.sourceSubscribed;
    await verbose.runtime.targetConnected;

    verbose.source.receive('meshcore/STO/node/raw', 'payload');
    await verbose.runtime.stop();
  } finally {
    console.debug = originalDebug;
    await quiet.runtime.stop();
  }

  assert.deepEqual(debugLines, ['Forwarded meshcore/STO/node/raw -> meshcore/STO/node/raw']);
});

test('passes source messages to the optional map uploader before forwarding', async () => {
  const seen = [];
  const clients = [];
  const runtime = startBridge(bridgeConfig(), {
    connect(url, options) {
      const client = new FakeMqttClient(url, options);
      clients.push(client);
      return client;
    },
    mapUploader: {
      handleMqttMessage(topic, payload) {
        seen.push({ topic, payload: payload.toString() });
      },
    },
  });

  const [source, target] = clients;
  source.connectNow();
  target.connectNow();
  await runtime.sourceSubscribed;
  await runtime.targetConnected;

  source.receive('meshcore/STO/node/raw', '{"data":"11"}');

  assert.deepEqual(seen, [
    { topic: 'meshcore/STO/node/raw', payload: '{"data":"11"}' },
  ]);
  assert.equal(target.publications.length, 1);

  await runtime.stop();
});

test('forwards source messages even when an injected async map uploader rejects', async () => {
  const clients = [];
  const runtime = startBridge(bridgeConfig(), {
    connect(url, options) {
      const client = new FakeMqttClient(url, options);
      clients.push(client);
      return client;
    },
    mapUploader: {
      async handleMqttMessage() {
        throw new Error('boom');
      },
    },
  });

  const [source, target] = clients;
  source.connectNow();
  target.connectNow();
  await runtime.sourceSubscribed;
  await runtime.targetConnected;

  source.receive('meshcore/STO/node/raw', '{"data":"11"}');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(target.publications.length, 1);
  assert.equal(target.publications[0].payload.toString(), '{"data":"11"}');

  await runtime.stop();
});

test('drops source messages while target is not ready and forwards after reconnect', async () => {
  const { runtime, source, target } = startFakeBridge();

  source.connectNow();
  await runtime.sourceSubscribed;

  source.receive('meshcore/test/node/packets', 'dropped');
  assert.equal(target.publications.length, 0);

  target.connectNow();
  await runtime.targetConnected;

  source.receive('meshcore/test/node/packets', 'forwarded');
  assert.equal(target.publications.length, 1);
  assert.equal(target.publications[0].payload.toString(), 'forwarded');

  target.closeNow();
  assert.equal(runtime.isTargetReady(), false);

  await runtime.stop();
});

test('publishes heartbeat on target connect only when heartbeat is enabled', async () => {
  const enabled = startFakeBridge({
    heartbeatEnabled: true,
    heartbeatTopic: 'mshse/test-heartbeat',
    heartbeatMessage: 'tick',
    heartbeatIntervalMs: 60_000,
  });

  enabled.target.connectNow();
  await enabled.runtime.targetConnected;

  assert.equal(enabled.target.publications.length, 1);
  assert.equal(enabled.target.publications[0].topic, 'mshse/test-heartbeat');
  assert.equal(enabled.target.publications[0].payload.toString(), 'tick');
  assert.equal(enabled.target.publications[0].options.retain, false);
  await enabled.runtime.stop();

  const disabled = startFakeBridge({ heartbeatEnabled: false });
  disabled.target.connectNow();
  await disabled.runtime.targetConnected;
  assert.equal(disabled.target.publications.length, 0);
  await disabled.runtime.stop();
});
