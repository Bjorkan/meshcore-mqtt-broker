import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from '@jest/globals';

import {
  loadTargetBridgeConfig,
  shouldForwardToTarget,
  startTargetBridge,
} from '../dist/target-bridge.js';

const PUBLIC_KEY = '4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E';
const OTHER_PUBLIC_KEY = '7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400';

function packet(topic, payload = '{}', retain = false) {
  return {
    cmd: 'publish',
    topic,
    payload: Buffer.from(payload),
    qos: 0,
    dup: false,
    retain,
  };
}

function publisherClient(overrides = {}) {
  return {
    clientType: 'publisher',
    publicKey: PUBLIC_KEY,
    observerClaimed: true,
    ...overrides,
  };
}

function fakeMqttClient() {
  const client = new EventEmitter();
  client.connected = false;
  client.publishes = [];
  client.publish = (topic, payload, options, callback) => {
    client.publishes.push({ topic, payload, options });
    callback?.(null);
  };
  client.end = (_force, _options, callback) => callback?.();
  return client;
}

test('target bridge client id follows HOSTNAME', () => {
  const config = loadTargetBridgeConfig({
    HOSTNAME: 'broker-host-7',
    TARGET_MQTT_URL: 'mqtts://mqtt.example.com:8883',
    TARGET_MQTT_USERNAME: 'uplink',
    TARGET_MQTT_PASSWORD: 'secret',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.clientId, 'broker-host-7');
  assert.equal(config.targetUrl, 'mqtts://mqtt.example.com:8883');
  assert.equal(config.targetUser, 'uplink');
  assert.equal(config.targetPass, 'secret');
});

test('target bridge is disabled when TARGET_MQTT_URL is empty', () => {
  const config = loadTargetBridgeConfig({
    HOSTNAME: 'broker-host-7',
    TARGET_MQTT_URL: '',
  });

  assert.equal(config.enabled, false);
});

test('only forwards publishes from claimed publisher observers on their own meshcore topic', () => {
  assert.equal(
    shouldForwardToTarget(
      packet(`meshcore/test/${PUBLIC_KEY}/status`),
      publisherClient()
    ),
    true
  );

  assert.equal(
    shouldForwardToTarget(
      packet(`meshcore/test/${OTHER_PUBLIC_KEY}/status`),
      publisherClient()
    ),
    false
  );

  assert.equal(
    shouldForwardToTarget(
      packet(`meshcore/test/${PUBLIC_KEY}/status`),
      publisherClient({ observerClaimed: false })
    ),
    false
  );

  assert.equal(
    shouldForwardToTarget(
      packet(`meshcore/test/${PUBLIC_KEY}/status`),
      { clientType: 'subscriber', publicKey: PUBLIC_KEY, observerClaimed: true }
    ),
    false
  );
});

test('never forwards broker-owned internal or serial command topics', () => {
  assert.equal(
    shouldForwardToTarget(
      packet(`meshcore/test/${PUBLIC_KEY}/internal`),
      publisherClient()
    ),
    false
  );

  assert.equal(
    shouldForwardToTarget(
      packet(`meshcore/test/${PUBLIC_KEY}/serial/commands`),
      publisherClient()
    ),
    false
  );
});

test('forwards claimed observer messages to target without retain', async () => {
  const target = fakeMqttClient();
  const runtime = startTargetBridge(
    {
      enabled: true,
      targetUrl: 'mqtts://mqtt.example.com:8883',
      targetUser: '',
      targetPass: '',
      clientId: 'broker-host-7',
      reconnectPeriodMs: 5000,
      connectTimeoutMs: 30000,
      rejectUnauthorized: true,
    },
    {
      connect: () => target,
    }
  );

  target.connected = true;
  target.emit('connect');
  runtime.forwardPublish(
    packet(`meshcore/test/${PUBLIC_KEY}/status`, '{"ok":true}', true),
    publisherClient()
  );

  assert.equal(target.publishes.length, 1);
  assert.equal(target.publishes[0].topic, `meshcore/test/${PUBLIC_KEY}/status`);
  assert.equal(target.publishes[0].payload.toString(), '{"ok":true}');
  assert.equal(target.publishes[0].options.retain, false);
  assert.equal(target.publishes[0].options.qos, 0);

  await runtime.stop();
});

test('tracks dropped claimed observer messages while target is offline', async () => {
  const target = fakeMqttClient();
  const runtime = startTargetBridge(
    {
      ...loadTargetBridgeConfig({
        HOSTNAME: 'broker-host-7',
        TARGET_MQTT_URL: 'mqtts://mqtt.example.com:8883',
      }),
    },
    {
      connect: () => target,
    }
  );

  runtime.forwardPublish(
    packet(`meshcore/test/${PUBLIC_KEY}/status`, '{"ok":true}'),
    publisherClient()
  );

  assert.equal(runtime.getDroppedMessageCount(), 1);
  assert.equal(target.publishes.length, 0);

  await runtime.stop();
});
