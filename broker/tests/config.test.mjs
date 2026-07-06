import assert from 'node:assert/strict';
import { jest, test } from '@jest/globals';

import { loadAbuseConfig, loadMqttConfig, loadSubscriberConfig } from '../dist/config.js';

const BASE_ENV = {
  MQTT_WS_PORT: '8883',
  MQTT_HOST: '127.0.0.1',
  BROKER_KV_URL: 'redis://valkey:6379',
  AUTH_EXPECTED_AUDIENCE: 'meshcore-test-audience',
  SUBSCRIBER_MAX_CONNECTIONS_DEFAULT: '2',
  ABUSE_ENFORCEMENT_ENABLED: 'false',
  ABUSE_DUPLICATE_WINDOW_SIZE: '100',
  ABUSE_DUPLICATE_WINDOW_MS: '300000',
  ABUSE_DUPLICATE_THRESHOLD: '10',
  ABUSE_MAX_DUPLICATES_PER_PACKET: '5',
  ABUSE_DUPLICATE_RATE_THRESHOLD: '0.3',
  ABUSE_DUPLICATE_RATE_WINDOW_MS: '300000',
  ABUSE_BUCKET_CAPACITY: '20',
  ABUSE_BUCKET_REFILL_RATE: '3',
  ABUSE_MAX_PACKET_SIZE: '255',
  ABUSE_MAX_TOPICS_PER_DAY: '3',
  ABUSE_ANOMALY_THRESHOLD: '10',
  ABUSE_MAX_IATA_CHANGES_24H: '3',
  ABUSE_TOPIC_HISTORY_SIZE: '50',
  ABUSE_TOPIC_HISTORY_WINDOW_MS: '86400000',
};

function withEnv(overrides, fn) {
  const errors = [];
  const envMock = jest.replaceProperty(process, 'env', { ...BASE_ENV, ...overrides });
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit:${code}`);
  });
  const errorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args.join(' '));
  });

  try {
    return fn(errors);
  } finally {
    envMock.restore();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

test('allows MQTT port 0 for ephemeral test binds', () => {
  withEnv({ MQTT_WS_PORT: '0' }, () => {
    const config = loadMqttConfig();
    assert.equal(config.wsPort, 0);
  });
});

test('allows explicit empty auth audience to disable audience validation', () => {
  withEnv({ AUTH_EXPECTED_AUDIENCE: '' }, () => {
    const config = loadMqttConfig();
    assert.equal(config.expectedAudience, '');
  });
});

test.each([
  ['MQTT_WS_PORT rejects non-numeric values', loadMqttConfig, { MQTT_WS_PORT: 'abc' }, /MQTT_WS_PORT/, /heltal/],
  ['MQTT_WS_PORT rejects ports above the TCP range', loadMqttConfig, { MQTT_WS_PORT: '65536' }, /MQTT_WS_PORT/, /högst 65535/],
  ['AUTH_EXPECTED_AUDIENCE is required', loadMqttConfig, { AUTH_EXPECTED_AUDIENCE: undefined }, /AUTH_EXPECTED_AUDIENCE/, /saknas/],
  ['AUTH_EXPECTED_AUDIENCE rejects whitespace-only values', loadMqttConfig, { AUTH_EXPECTED_AUDIENCE: '   ' }, /AUTH_EXPECTED_AUDIENCE/, /mellanslag/],
  ['ABUSE_BUCKET_REFILL_RATE rejects non-numeric values', loadAbuseConfig, { ABUSE_BUCKET_REFILL_RATE: 'foo' }, /ABUSE_BUCKET_REFILL_RATE/, /giltigt tal/],
  ['ABUSE_BUCKET_REFILL_RATE rejects non-positive values', loadAbuseConfig, { ABUSE_BUCKET_REFILL_RATE: '0' }, /ABUSE_BUCKET_REFILL_RATE/, /större än 0/],
  ['ABUSE_ENFORCEMENT_ENABLED rejects non-boolean values', loadAbuseConfig, { ABUSE_ENFORCEMENT_ENABLED: 'yes' }, /ABUSE_ENFORCEMENT_ENABLED/, /true/],
  ['SUBSCRIBER_MAX_CONNECTIONS_DEFAULT rejects zero', loadSubscriberConfig, { SUBSCRIBER_MAX_CONNECTIONS_DEFAULT: '0' }, /SUBSCRIBER_MAX_CONNECTIONS_DEFAULT/, /minst 1/],
  ['SUBSCRIBER_MAX_CONNECTIONS_DEFAULT rejects negative values', loadSubscriberConfig, { SUBSCRIBER_MAX_CONNECTIONS_DEFAULT: '-1' }, /SUBSCRIBER_MAX_CONNECTIONS_DEFAULT/, /minst 1/],
  ['MQTT_JSON_PUBLISH_MAX_BYTES rejects fractional values', loadMqttConfig, { MQTT_JSON_PUBLISH_MAX_BYTES: '12.5' }, /MQTT_JSON_PUBLISH_MAX_BYTES/, /heltal/],
  ['BROKER_NODE_NAME_CACHE_TTL_MS rejects non-positive values', loadMqttConfig, { BROKER_NODE_NAME_CACHE_TTL_MS: '0' }, /BROKER_NODE_NAME_CACHE_TTL_MS/, /större än 0/],
  ['BROKER_KV_URL is required', loadMqttConfig, { BROKER_KV_URL: undefined }, /BROKER_KV_URL/, /saknas/],
])('%s before startup', (_name, loadConfig, overrides, envPattern, messagePattern) => {
  withEnv(overrides, (errors) => {
    assert.throws(() => loadConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), envPattern);
    assert.match(errors.join('\n'), messagePattern);
  });
});

test('loads mandatory Valkey orchestration configuration', () => {
  withEnv({}, () => {
    const config = loadMqttConfig();
    assert.equal(config.kvUrl, 'redis://valkey:6379');
    assert.equal(config.kvNamespace, 'meshcore-mqtt-broker');
    assert.ok(config.instanceId.length > 0);
  });
});

test('loads explicit Valkey orchestration namespace and instance id', () => {
  withEnv({
    BROKER_KV_URL: 'redis://valkey:6379',
    BROKER_KV_NAMESPACE: 'test-namespace',
    BROKER_INSTANCE_ID: 'broker-a',
  }, () => {
    const config = loadMqttConfig();
    assert.equal(config.kvUrl, 'redis://valkey:6379');
    assert.equal(config.kvNamespace, 'test-namespace');
    assert.equal(config.instanceId, 'broker-a');
  });
});
