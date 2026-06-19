import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { loadBridgeConfig, startBridge } from '../dist/bridge.js';

test('loads bridge config without map upload settings', () => {
  const config = loadBridgeConfig({});

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
