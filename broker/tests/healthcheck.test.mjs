import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from '@jest/globals';
import { WebSocketServer } from 'ws';
import Redis from 'ioredis';

import { resetConfigCacheForTests, setConfigDocumentForTests } from '../dist/config.js';
import {
  HEALTHCHECK_LOOPBACK_PAYLOAD_PREFIX,
  HEALTHCHECK_LOOPBACK_TOPIC,
} from '../dist/healthcheck-loopback.js';
import {
  createDockerHealthCredentials,
  DOCKER_HEALTH_PASSWORD_LENGTH,
  DOCKER_HEALTH_USERNAME,
  generateDockerHealthPassword,
  readDockerHealthCredentials,
  resolveDockerHealthCredentialsFile,
} from '../dist/docker-health-user.js';
import {
  encodeMqttConnectPacket,
  encodeMqttPingReqPacket,
  encodeMqttPublishPacket,
  encodeMqttSubscribePacket,
  parseFirstMqttPacket,
  readMqttPublish,
  readHealthcheckCredentialsFromConfig,
  resolveHealthcheckOptionsFromConfig,
  resolveValkeyReadinessOptionsFromConfig,
  runMqttLoopbackHealthcheck,
  runValkeyReadinessHealthcheck,
} from '../dist/healthcheck.js';

function encodeUtf8String(value) {
  const payload = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(2);
  length.writeUInt16BE(payload.length, 0);
  return Buffer.concat([length, payload]);
}

function encodeRemainingLength(length) {
  const bytes = [];
  let value = length;
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) {
      byte |= 128;
    }
    bytes.push(byte);
  } while (value > 0);
  return Buffer.from(bytes);
}

function publishPacket(topic, payload) {
  const body = Buffer.concat([encodeUtf8String(topic), Buffer.from(payload, 'utf8')]);
  return Buffer.concat([Buffer.from([0x30]), encodeRemainingLength(body.length), body]);
}

function withTempCredentialsFile(callback) {
  const dir = mkdtempSync(join(tmpdir(), 'meshcore-healthcheck-test-'));
  const file = join(dir, 'docker_health_credentials.json');
  try {
    return callback(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function setHealthcheckConfig(overrides = {}) {
  setConfigDocumentForTests({
    mqtt: {
      ws_port: 18883,
      ...(overrides.mqtt || {}),
    },
    broker: {
      kv_url: 'redis://valkey:6379',
      kv_namespace: 'meshcore-prod',
      ...(overrides.broker || {}),
    },
    healthcheck: {
      mqtt_timeout_ms: 1234,
      mqtt_keepalive_seconds: 60,
      valkey_timeout_ms: 1234,
      valkey_ready_max_age_ms: 4567,
      ...(overrides.healthcheck || {}),
    },
  });
}

async function closeWebSocketServer(wsServer) {
  await new Promise((resolve, reject) => {
    wsServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test('generates 32 character runtime docker_health passwords', () => {
  const passwordA = generateDockerHealthPassword();
  const passwordB = generateDockerHealthPassword();

  assert.equal(passwordA.length, DOCKER_HEALTH_PASSWORD_LENGTH);
  assert.equal(passwordB.length, DOCKER_HEALTH_PASSWORD_LENGTH);
  assert.match(passwordA, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(passwordA, passwordB);
});

test('creates and reads docker_health credentials from a runtime file', () => {
  withTempCredentialsFile((credentialsFile) => {
    const created = createDockerHealthCredentials(credentialsFile, new Date('2026-06-24T10:00:00.000Z'));

    assert.equal(created.username, DOCKER_HEALTH_USERNAME);
    assert.equal(created.password.length, DOCKER_HEALTH_PASSWORD_LENGTH);
    assert.equal(created.createdAt, '2026-06-24T10:00:00.000Z');
    assert.equal(statSync(credentialsFile).mode & 0o777, 0o600);

    const read = readDockerHealthCredentials(credentialsFile);
    assert.deepEqual(
      { username: read.username, password: read.password },
      { username: DOCKER_HEALTH_USERNAME, password: created.password }
    );
  });
});

test('resolves loopback healthcheck options from generated runtime credentials', () => {
  const defaultFile = resolveDockerHealthCredentialsFile();
  const defaultDir = dirname(defaultFile);
  mkdirSync(defaultDir, { recursive: true });
  try {
    const created = createDockerHealthCredentials(defaultFile);
    setHealthcheckConfig();
    const options = resolveHealthcheckOptionsFromConfig();

    assert.equal(options.url, 'ws://127.0.0.1:18883');
    assert.equal(options.username, DOCKER_HEALTH_USERNAME);
    assert.equal(options.password, created.password);
    assert.equal(options.topic, HEALTHCHECK_LOOPBACK_TOPIC);
    assert.equal(options.payload.startsWith(HEALTHCHECK_LOOPBACK_PAYLOAD_PREFIX), true);
    assert.equal(options.timeoutMs, 1234);
    assert.equal(options.keepAliveSeconds, 60);
  } finally {
    resetConfigCacheForTests();
    try { rmSync(defaultDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('resolves Valkey readiness healthcheck options from config', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'meshcore-healthcheck-id-test-'));
  const runtimeIdFile = join(tempDir, 'broker-id');
  writeFileSync(runtimeIdFile, 'broker-a\n');

  setHealthcheckConfig({
    broker: {
      kv_url: 'redis://valkey:6379',
      kv_namespace: 'meshcore-prod',
      runtime_id_file: runtimeIdFile,
    },
  });
  const options = resolveValkeyReadinessOptionsFromConfig();

  try {
    assert.equal(options.kvUrl, 'redis://valkey:6379');
    assert.equal(options.namespace, 'meshcore-prod');
    assert.equal(options.instanceId, 'broker-a');
    assert.equal(options.timeoutMs, 1234);
    assert.equal(options.maxAgeMs, 4567);
  } finally {
    resetConfigCacheForTests();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Valkey readiness healthcheck requires this broker instance to be freshly registered', async () => {
  const kvUrl = process.env.TEST_BROKER_KV_URL || 'redis://127.0.0.1:6379';
  const namespace = `meshcore-healthcheck-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const instanceId = 'healthcheck-instance-a';
  const key = `${namespace}:instances:${encodeURIComponent(instanceId)}:ready`;
  const redis = new Redis(kvUrl, { maxRetriesPerRequest: 1 });

  try {
    await redis.set(key, JSON.stringify({
      status: 'ready',
      lastUpdatedByInstance: instanceId,
      lastUpdatedAt: 1_000,
      namespace,
    }), 'PX', 60_000);

    await runValkeyReadinessHealthcheck({
      kvUrl,
      namespace,
      instanceId,
      timeoutMs: 1000,
      maxAgeMs: 5_000,
    }, 2_000);

    await assert.rejects(
      runValkeyReadinessHealthcheck({
        kvUrl,
        namespace,
        instanceId: 'healthcheck-instance-b',
        timeoutMs: 1000,
        maxAgeMs: 5_000,
      }, 2_000),
      /readiness key is missing/
    );

    await assert.rejects(
      runValkeyReadinessHealthcheck({
        kvUrl,
        namespace,
        instanceId,
        timeoutMs: 1000,
        maxAgeMs: 500,
      }, 2_000),
      /readiness is stale/
    );
  } finally {
    await redis.del(key);
    await redis.quit();
  }
});

test('fails when the runtime docker_health credentials file is missing', () => {
  assert.throws(
    () => readHealthcheckCredentialsFromConfig(),
    /Could not read Docker healthcheck credentials/
  );
});

test('encodes MQTT connect and subscribe packets', () => {
  const connect = encodeMqttConnectPacket({ username: DOCKER_HEALTH_USERNAME, password: 'secret' }, 'test-client', 60);
  const parsedConnect = parseFirstMqttPacket(connect);

  assert.equal(parsedConnect.packet.type, 1);
  assert.equal(parsedConnect.packet.body.includes(Buffer.from('MQTT')), true);
  assert.equal(parsedConnect.packet.body.includes(Buffer.from(DOCKER_HEALTH_USERNAME)), true);
  assert.equal(parsedConnect.packet.body.subarray(8, 10).readUInt16BE(0), 60);

  const subscribe = encodeMqttSubscribePacket(HEALTHCHECK_LOOPBACK_TOPIC);
  const parsedSubscribe = parseFirstMqttPacket(subscribe);

  assert.equal(parsedSubscribe.packet.type, 8);
  assert.equal(parsedSubscribe.packet.flags, 2);
  assert.equal(parsedSubscribe.packet.body.includes(Buffer.from(HEALTHCHECK_LOOPBACK_TOPIC)), true);

  const pingReq = encodeMqttPingReqPacket();
  const parsedPingReq = parseFirstMqttPacket(pingReq);
  assert.equal(parsedPingReq.packet.type, 12);
  assert.equal(parsedPingReq.packet.body.length, 0);

  const publish = encodeMqttPublishPacket(HEALTHCHECK_LOOPBACK_TOPIC, 'loopback-payload');
  const parsedPublish = parseFirstMqttPacket(publish);
  assert.equal(parsedPublish.packet.type, 3);
  const decodedPublish = readMqttPublish(parsedPublish.packet);
  assert.equal(decodedPublish.topic, HEALTHCHECK_LOOPBACK_TOPIC);
  assert.equal(decodedPublish.payload.toString('utf8'), 'loopback-payload');
});

test('healthcheck succeeds only after publishing and receiving its own loopback payload over MQTT/WebSocket', async () => {
  const wsServer = new WebSocketServer({ port: 0 });
  await once(wsServer, 'listening');

  let publishedPayload = null;

  wsServer.on('connection', (ws) => {
    ws.on('message', (data) => {
      const parsed = parseFirstMqttPacket(Buffer.from(data));
      if (!parsed) {
        return;
      }

      if (parsed.packet.type === 1) {
        ws.send(Buffer.from([0x20, 0x02, 0x00, 0x00])); // CONNACK success
        return;
      }

      if (parsed.packet.type === 8) {
        ws.send(Buffer.from([0x90, 0x03, 0x00, 0x01, 0x00])); // SUBACK packet id 1, QoS 0
        return;
      }

      if (parsed.packet.type === 3) {
        const publish = readMqttPublish(parsed.packet);
        publishedPayload = publish.payload.toString('utf8');
        ws.send(publishPacket(publish.topic, publishedPayload));
      }
    });
  });

  try {
    const address = wsServer.address();
    assert.equal(typeof address, 'object');

    await runMqttLoopbackHealthcheck({
      url: `ws://127.0.0.1:${address.port}`,
      username: DOCKER_HEALTH_USERNAME,
      password: 'secret',
      clientId: 'test-healthcheck',
      topic: HEALTHCHECK_LOOPBACK_TOPIC,
      payload: 'loopback-test-payload',
      timeoutMs: 1000,
      keepAliveSeconds: 60,
    });

    assert.equal(publishedPayload, 'loopback-test-payload');
  } finally {
    await closeWebSocketServer(wsServer);
  }
});

test('healthcheck keeps the MQTT session alive while waiting for the loopback payload', async () => {
  const wsServer = new WebSocketServer({ port: 0 });
  await once(wsServer, 'listening');

  let sawPingReq = false;

  wsServer.on('connection', (ws) => {
    ws.on('message', (data) => {
      const parsed = parseFirstMqttPacket(Buffer.from(data));
      if (!parsed) {
        return;
      }

      if (parsed.packet.type === 1) {
        ws.send(Buffer.from([0x20, 0x02, 0x00, 0x00])); // CONNACK success
        return;
      }

      if (parsed.packet.type === 8) {
        ws.send(Buffer.from([0x90, 0x03, 0x00, 0x01, 0x00])); // SUBACK packet id 1, QoS 0
        return;
      }

      if (parsed.packet.type === 3) {
        const publish = readMqttPublish(parsed.packet);
        setTimeout(() => {
          ws.send(publishPacket(publish.topic, publish.payload.toString('utf8')));
        }, 1200);
        return;
      }

      if (parsed.packet.type === 12) {
        sawPingReq = true;
        ws.send(Buffer.from([0xd0, 0x00])); // PINGRESP
      }
    });
  });

  try {
    const address = wsServer.address();
    assert.equal(typeof address, 'object');

    await runMqttLoopbackHealthcheck({
      url: `ws://127.0.0.1:${address.port}`,
      username: DOCKER_HEALTH_USERNAME,
      password: 'secret',
      clientId: 'test-healthcheck-ping',
      topic: HEALTHCHECK_LOOPBACK_TOPIC,
      payload: 'delayed-loopback-payload',
      timeoutMs: 3000,
      keepAliveSeconds: 2,
    });

    assert.equal(sawPingReq, true);
  } finally {
    await closeWebSocketServer(wsServer);
  }
});
