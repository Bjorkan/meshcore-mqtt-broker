import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';

import {
  BROKER_HEARTBEAT_MESSAGE,
  BROKER_HEARTBEAT_TOPIC,
} from '../dist/heartbeat.js';
import {
  createDockerHealthCredentials,
  DOCKER_HEALTH_PASSWORD_LENGTH,
  DOCKER_HEALTH_USERNAME,
  generateDockerHealthPassword,
} from '../dist/docker-health-user.js';
import {
  encodeMqttConnectPacket,
  encodeMqttPingReqPacket,
  encodeMqttSubscribePacket,
  parseFirstMqttPacket,
  readHealthcheckCredentialsFromEnv,
  resolveHealthcheckOptionsFromEnv,
  runMqttHeartbeatHealthcheck,
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

    assert.deepEqual(
      readHealthcheckCredentialsFromEnv({ HEALTHCHECK_MQTT_CREDENTIALS_FILE: credentialsFile }),
      { username: DOCKER_HEALTH_USERNAME, password: created.password }
    );
  });
});

test('resolves heartbeat healthcheck options from generated runtime credentials', () => {
  withTempCredentialsFile((credentialsFile) => {
    const created = createDockerHealthCredentials(credentialsFile);
    const options = resolveHealthcheckOptionsFromEnv({
      HEALTHCHECK_MQTT_CREDENTIALS_FILE: credentialsFile,
      MQTT_WS_PORT: '18883',
      HEALTHCHECK_MQTT_TIMEOUT_MS: '1234',
      HEALTHCHECK_MQTT_KEEPALIVE_SECONDS: '60',
    });

    assert.equal(options.url, 'ws://127.0.0.1:18883');
    assert.equal(options.username, DOCKER_HEALTH_USERNAME);
    assert.equal(options.password, created.password);
    assert.equal(options.topic, BROKER_HEARTBEAT_TOPIC);
    assert.equal(options.payload, BROKER_HEARTBEAT_MESSAGE);
    assert.equal(options.timeoutMs, 1234);
    assert.equal(options.keepAliveSeconds, 60);
  });
});

test('fails when the runtime docker_health credentials file is missing', () => {
  withTempCredentialsFile((credentialsFile) => {
    assert.throws(
      () => readHealthcheckCredentialsFromEnv({ HEALTHCHECK_MQTT_CREDENTIALS_FILE: credentialsFile }),
      /Could not read Docker healthcheck credentials/
    );
  });
});

test('encodes MQTT connect and subscribe packets', () => {
  const connect = encodeMqttConnectPacket({ username: DOCKER_HEALTH_USERNAME, password: 'secret' }, 'test-client', 60);
  const parsedConnect = parseFirstMqttPacket(connect);

  assert.equal(parsedConnect.packet.type, 1);
  assert.equal(parsedConnect.packet.body.includes(Buffer.from('MQTT')), true);
  assert.equal(parsedConnect.packet.body.includes(Buffer.from(DOCKER_HEALTH_USERNAME)), true);
  assert.equal(parsedConnect.packet.body.subarray(8, 10).readUInt16BE(0), 60);

  const subscribe = encodeMqttSubscribePacket(BROKER_HEARTBEAT_TOPIC);
  const parsedSubscribe = parseFirstMqttPacket(subscribe);

  assert.equal(parsedSubscribe.packet.type, 8);
  assert.equal(parsedSubscribe.packet.flags, 2);
  assert.equal(parsedSubscribe.packet.body.includes(Buffer.from(BROKER_HEARTBEAT_TOPIC)), true);

  const pingReq = encodeMqttPingReqPacket();
  const parsedPingReq = parseFirstMqttPacket(pingReq);
  assert.equal(parsedPingReq.packet.type, 12);
  assert.equal(parsedPingReq.packet.body.length, 0);
});

test('healthcheck succeeds only after reading broker heartbeat over MQTT/WebSocket', async () => {
  const wsServer = new WebSocketServer({ port: 0 });
  await once(wsServer, 'listening');

  wsServer.on('connection', (ws) => {
    let messageCount = 0;
    ws.on('message', () => {
      messageCount += 1;
      if (messageCount === 1) {
        ws.send(Buffer.from([0x20, 0x02, 0x00, 0x00])); // CONNACK success
      }
      if (messageCount === 2) {
        ws.send(Buffer.from([0x90, 0x03, 0x00, 0x01, 0x00])); // SUBACK packet id 1, QoS 0
        ws.send(publishPacket(BROKER_HEARTBEAT_TOPIC, BROKER_HEARTBEAT_MESSAGE));
      }
    });
  });

  try {
    const address = wsServer.address();
    assert.equal(typeof address, 'object');

    await runMqttHeartbeatHealthcheck({
      url: `ws://127.0.0.1:${address.port}`,
      username: DOCKER_HEALTH_USERNAME,
      password: 'secret',
      clientId: 'test-healthcheck',
      topic: BROKER_HEARTBEAT_TOPIC,
      payload: BROKER_HEARTBEAT_MESSAGE,
      timeoutMs: 1000,
      keepAliveSeconds: 60,
    });
  } finally {
    wsServer.close();
  }
});

test('healthcheck keeps the MQTT session alive while waiting for the next heartbeat', async () => {
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
        setTimeout(() => {
          ws.send(publishPacket(BROKER_HEARTBEAT_TOPIC, BROKER_HEARTBEAT_MESSAGE));
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

    await runMqttHeartbeatHealthcheck({
      url: `ws://127.0.0.1:${address.port}`,
      username: DOCKER_HEALTH_USERNAME,
      password: 'secret',
      clientId: 'test-healthcheck-ping',
      topic: BROKER_HEARTBEAT_TOPIC,
      payload: BROKER_HEARTBEAT_MESSAGE,
      timeoutMs: 3000,
      keepAliveSeconds: 2,
    });

    assert.equal(sawPingReq, true);
  } finally {
    wsServer.close();
  }
});
