import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { expect, jest, test } from '@jest/globals';

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
  client.publish = jest.fn((topic, payload, options, callback) => {
    callback?.(null);
  });
  client.end = jest.fn((_force, _options, callback) => callback?.());
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

test.each([
  ['claimed publisher on own status topic', `meshcore/test/${PUBLIC_KEY}/status`, publisherClient(), true],
  ['claimed publisher on another public key topic', `meshcore/test/${OTHER_PUBLIC_KEY}/status`, publisherClient(), false],
  ['unclaimed publisher on own topic', `meshcore/test/${PUBLIC_KEY}/status`, publisherClient({ observerClaimed: false }), false],
  ['subscriber client on publisher topic', `meshcore/test/${PUBLIC_KEY}/status`, { clientType: 'subscriber', publicKey: PUBLIC_KEY, observerClaimed: true }, false],
  ['broker-owned internal topic', `meshcore/test/${PUBLIC_KEY}/internal`, publisherClient(), false],
  ['broker-owned serial command topic', `meshcore/test/${PUBLIC_KEY}/serial/commands`, publisherClient(), false],
])('target bridge forwarding policy: %s', (_name, topic, client, expected) => {
  assert.equal(shouldForwardToTarget(packet(topic), client), expected);
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

  expect(target.publish).toHaveBeenCalledTimes(1);
  const [topic, payload, options] = target.publish.mock.calls[0];
  assert.equal(topic, `meshcore/test/${PUBLIC_KEY}/status`);
  assert.equal(payload.toString(), '{"ok":true}');
  assert.equal(options.retain, false);
  assert.equal(options.qos, 0);

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
  expect(target.publish).not.toHaveBeenCalled();

  await runtime.stop();
});
