import assert from 'node:assert/strict';
import { test } from 'node:test';

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
  const previousEnv = { ...process.env };
  const previousExit = process.exit;
  const previousError = console.error;
  const errors = [];

  process.env = { ...previousEnv, ...BASE_ENV, ...overrides };
  process.exit = ((code) => {
    throw new Error(`process.exit:${code}`);
  });
  console.error = (...args) => {
    errors.push(args.join(' '));
  };

  try {
    return fn(errors);
  } finally {
    process.env = previousEnv;
    process.exit = previousExit;
    console.error = previousError;
  }
}

test('rejects invalid MQTT port before startup', () => {
  withEnv({ MQTT_WS_PORT: 'abc' }, (errors) => {
    assert.throws(() => loadMqttConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), /MQTT_WS_PORT/);
    assert.match(errors.join('\n'), /heltal/);
  });
});

test('allows MQTT port 0 for ephemeral test binds', () => {
  withEnv({ MQTT_WS_PORT: '0' }, () => {
    const config = loadMqttConfig();
    assert.equal(config.wsPort, 0);
  });
});

test('rejects MQTT ports above the TCP port range', () => {
  withEnv({ MQTT_WS_PORT: '65536' }, (errors) => {
    assert.throws(() => loadMqttConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), /MQTT_WS_PORT/);
    assert.match(errors.join('\n'), /högst 65535/);
  });
});

test('allows explicit empty auth audience to disable audience validation', () => {
  withEnv({ AUTH_EXPECTED_AUDIENCE: '' }, () => {
    const config = loadMqttConfig();
    assert.equal(config.expectedAudience, '');
  });
});

test('rejects missing auth audience before startup', () => {
  withEnv({ AUTH_EXPECTED_AUDIENCE: undefined }, (errors) => {
    assert.throws(() => loadMqttConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), /AUTH_EXPECTED_AUDIENCE/);
    assert.match(errors.join('\n'), /saknas/);
  });
});

test('rejects whitespace-only auth audience before startup', () => {
  withEnv({ AUTH_EXPECTED_AUDIENCE: '   ' }, (errors) => {
    assert.throws(() => loadMqttConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), /AUTH_EXPECTED_AUDIENCE/);
    assert.match(errors.join('\n'), /mellanslag/);
  });
});

test('rejects invalid abuse refill rate before startup', () => {
  withEnv({ ABUSE_BUCKET_REFILL_RATE: 'foo' }, (errors) => {
    assert.throws(() => loadAbuseConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), /ABUSE_BUCKET_REFILL_RATE/);
    assert.match(errors.join('\n'), /giltigt tal/);
  });
});

test('rejects non-positive abuse refill rate before startup', () => {
  withEnv({ ABUSE_BUCKET_REFILL_RATE: '0' }, (errors) => {
    assert.throws(() => loadAbuseConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), /ABUSE_BUCKET_REFILL_RATE/);
    assert.match(errors.join('\n'), /större än 0/);
  });
});

test('rejects invalid abuse enforcement bool before startup', () => {
  withEnv({ ABUSE_ENFORCEMENT_ENABLED: 'yes' }, (errors) => {
    assert.throws(() => loadAbuseConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), /ABUSE_ENFORCEMENT_ENABLED/);
    assert.match(errors.join('\n'), /true/);
  });
});

test('rejects non-positive default subscriber max connections', () => {
  withEnv({ SUBSCRIBER_MAX_CONNECTIONS_DEFAULT: '0' }, (errors) => {
    assert.throws(() => loadSubscriberConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), /SUBSCRIBER_MAX_CONNECTIONS_DEFAULT/);
    assert.match(errors.join('\n'), /minst 1/);
  });
});

test('rejects negative default subscriber max connections', () => {
  withEnv({ SUBSCRIBER_MAX_CONNECTIONS_DEFAULT: '-1' }, (errors) => {
    assert.throws(() => loadSubscriberConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), /SUBSCRIBER_MAX_CONNECTIONS_DEFAULT/);
    assert.match(errors.join('\n'), /minst 1/);
  });
});

test('rejects fractional values for integer configuration', () => {
  withEnv({ MQTT_JSON_PUBLISH_MAX_BYTES: '12.5' }, (errors) => {
    assert.throws(() => loadMqttConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), /MQTT_JSON_PUBLISH_MAX_BYTES/);
    assert.match(errors.join('\n'), /heltal/);
  });
});

test('rejects invalid node name cache ttl before startup', () => {
  withEnv({ BROKER_NODE_NAME_CACHE_TTL_MS: '0' }, (errors) => {
    assert.throws(() => loadMqttConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), /BROKER_NODE_NAME_CACHE_TTL_MS/);
    assert.match(errors.join('\n'), /större än 0/);
  });
});

test('requires broker kv url before startup', () => {
  withEnv({ BROKER_KV_URL: undefined }, (errors) => {
    assert.throws(() => loadMqttConfig(), /process\.exit:1/);
    assert.match(errors.join('\n'), /BROKER_KV_URL/);
    assert.match(errors.join('\n'), /saknas/);
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
