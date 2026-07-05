import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { loadBridgeConfig, startBridge } from '../dist/bridge.js';

test('loads bridge config without map upload settings', () => {
  const config = loadBridgeConfig({});

  assert.equal(config.sourceUrl, 'ws://meshcore-mqtt-broker:8883');
  assert.equal(config.heartbeatEnabled, true);
  assert.equal(config.heartbeatTopic, 'mshse/Hjärtslag');
  assert.equal(Object.hasOwn(config, 'mapUploader'), false);
});

function fakeMqttClient() {
  const client = new EventEmitter();
  client.connected = false;
  client.subscribe = (_topic, _options, callback) => callback?.(null);
  client.publish = (_topic, _payload, _options, callback) => callback?.(null);
  client.end = (_force, _options, callback) => callback?.();
  return client;
}

test('tracks dropped source messages when target broker is offline', async () => {
  const source = fakeMqttClient();
  const target = fakeMqttClient();
  const clients = [source, target];
  const runtime = startBridge(
    {
      ...loadBridgeConfig({}),
      heartbeatEnabled: false,
    },
    {
      connect: () => clients.shift(),
    }
  );

  source.emit('message', 'meshcore/test/node/status', Buffer.from('{}'), { retain: false });
  source.emit('message', 'meshcore/test/node/packets', Buffer.from('{}'), { retain: false });

  assert.equal(runtime.getDroppedMessageCount(), 2);
  await runtime.stop();
});

test('strips surrounding quotes from environment strings', () => {
  const config = loadBridgeConfig({
    TOPIC_FILTER: '"meshcore/#"',
    TARGET_PREFIX: '""',
    BRIDGE_MQTT_URL: ' "ws://custom-broker:8883" ',
  });

  assert.equal(config.topicFilter, 'meshcore/#');
  assert.equal(config.targetPrefix, '');
  assert.equal(config.sourceUrl, 'ws://custom-broker:8883');
});

test('logs every forwarded source message as broker-style publicering entry', async () => {
  const previousNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const source = fakeMqttClient();
    const target = fakeMqttClient();
    const clients = [source, target];
    const runtime = startBridge(
      {
        ...loadBridgeConfig({}),
        heartbeatEnabled: false,
        targetPrefix: 'mshse/',
      },
      {
        connect: () => clients.shift(),
      }
    );

    target.connected = true;
    target.emit('connect');
    source.emit('message', 'meshcore/test/node/status', Buffer.from('{"ok":true}'), { retain: true });

    assert.ok(
      logs.some((line) =>
        /\[PUBLICERING \d{2}:\d{2}\] Överförde meshcore\/test\/node\/status -> mshse\/meshcore\/test\/node\/status \(11 byte, retain: nej, source-retain släppt\)/.test(line)
      ),
      `expected forwarded message log, got:\n${logs.join('\n')}`
    );

    await runtime.stop();
  } finally {
    console.log = originalLog;
    if (previousNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = previousNoColor;
    }
  }
});


test('always drops retain flag when forwarding source messages', async () => {
  const source = fakeMqttClient();
  const target = fakeMqttClient();
  const publishes = [];
  target.publish = (topic, payload, options, callback) => {
    publishes.push({ topic, payload, options });
    callback?.(null);
  };

  const clients = [source, target];
  const runtime = startBridge(
    {
      ...loadBridgeConfig({}),
      heartbeatEnabled: false,
    },
    {
      connect: () => clients.shift(),
    }
  );

  target.connected = true;
  target.emit('connect');
  source.emit('message', 'meshcore/test/node/status', Buffer.from('{}'), { retain: true });

  assert.equal(publishes.length, 1);
  assert.equal(publishes[0].options.retain, false);

  await runtime.stop();
});
