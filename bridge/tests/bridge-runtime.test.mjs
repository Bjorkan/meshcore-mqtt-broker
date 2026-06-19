import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadBridgeConfig } from '../dist/bridge.js';

test('loads bridge config without map upload settings', () => {
  const config = loadBridgeConfig({});

  assert.equal(config.heartbeatEnabled, true);
  assert.equal(config.heartbeatTopic, 'mshse/Hjärtslag');
  assert.equal(Object.hasOwn(config, 'mapUploader'), false);
});
