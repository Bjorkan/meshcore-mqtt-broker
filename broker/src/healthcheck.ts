import { randomUUID } from 'crypto';
import WebSocket, { type RawData } from 'ws';
import { pathToFileURL } from 'url';
import { Redis } from 'ioredis';
import { readDockerHealthCredentials, resolveDockerHealthCredentialsFile } from './docker-health-user.js';
import { HEALTHCHECK_LOOPBACK_PAYLOAD_PREFIX, HEALTHCHECK_LOOPBACK_TOPIC } from './healthcheck-loopback.js';
import { resolveBrokerInstanceId } from './instance-id.js';

const DEFAULT_HEALTHCHECK_TIMEOUT_MS = 10_000;
const DEFAULT_HEALTHCHECK_PORT = '8883';
const DEFAULT_KEEPALIVE_SECONDS = 60;
const DEFAULT_KV_NAMESPACE = 'meshcore-mqtt-broker';
const DEFAULT_VALKEY_READY_MAX_AGE_MS = 120_000;
const MQTT_PACKET_CONNECT = 1;
const MQTT_PACKET_CONNACK = 2;
const MQTT_PACKET_PUBLISH = 3;
const MQTT_PACKET_SUBACK = 9;
const MQTT_SUBSCRIBE_PACKET_IDENTIFIER = 1;
const MQTT_PACKET_PINGREQ = Buffer.from([0xc0, 0x00]);

export interface MqttCredentials {
  username: string;
  password: string;
}

export interface MqttLoopbackHealthcheckOptions extends MqttCredentials {
  url: string;
  topic: string;
  payload: string;
  timeoutMs: number;
  keepAliveSeconds: number;
  clientId: string;
}

export interface ValkeyReadinessHealthcheckOptions {
  kvUrl: string;
  namespace: string;
  instanceId: string;
  timeoutMs: number;
  maxAgeMs: number;
}

interface ParsedMqttPacket {
  type: number;
  flags: number;
  body: Buffer;
}

function encodeUtf8String(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > 65_535) {
    throw new Error('MQTT string is too long');
  }

  const length = Buffer.allocUnsafe(2);
  length.writeUInt16BE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

function encodeRemainingLength(length: number): Buffer {
  if (!Number.isInteger(length) || length < 0 || length > 268_435_455) {
    throw new Error(`Invalid MQTT remaining length: ${length}`);
  }

  const bytes: number[] = [];
  let value = length;
  do {
    let encodedByte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) {
      encodedByte |= 128;
    }
    bytes.push(encodedByte);
  } while (value > 0);

  return Buffer.from(bytes);
}

export function encodeMqttConnectPacket(credentials: MqttCredentials, clientId: string, keepAliveSeconds = DEFAULT_KEEPALIVE_SECONDS): Buffer {
  if (!Number.isSafeInteger(keepAliveSeconds) || keepAliveSeconds < 0 || keepAliveSeconds > 65_535) {
    throw new Error(`Invalid MQTT keepalive seconds: ${keepAliveSeconds}`);
  }
  const variableHeader = Buffer.concat([
    encodeUtf8String('MQTT'),
    Buffer.from([
      4, // MQTT 3.1.1
      0xc2, // username + password + clean session
      keepAliveSeconds >> 8,
      keepAliveSeconds & 0xff,
    ]),
  ]);

  const payload = Buffer.concat([
    encodeUtf8String(clientId),
    encodeUtf8String(credentials.username),
    encodeUtf8String(credentials.password),
  ]);

  const remainingLength = variableHeader.length + payload.length;
  return Buffer.concat([Buffer.from([0x10]), encodeRemainingLength(remainingLength), variableHeader, payload]);
}

export function encodeMqttPublishPacket(topic: string, payload: string | Buffer): Buffer {
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const body = Buffer.concat([encodeUtf8String(topic), payloadBuffer]);
  return Buffer.concat([Buffer.from([0x30]), encodeRemainingLength(body.length), body]);
}

export function encodeMqttSubscribePacket(topic: string, packetIdentifier = MQTT_SUBSCRIBE_PACKET_IDENTIFIER): Buffer {
  if (!Number.isInteger(packetIdentifier) || packetIdentifier <= 0 || packetIdentifier > 65_535) {
    throw new Error(`Invalid MQTT packet identifier: ${packetIdentifier}`);
  }

  const variableHeader = Buffer.allocUnsafe(2);
  variableHeader.writeUInt16BE(packetIdentifier, 0);

  const payload = Buffer.concat([
    encodeUtf8String(topic),
    Buffer.from([0]), // QoS 0
  ]);

  const remainingLength = variableHeader.length + payload.length;
  return Buffer.concat([Buffer.from([0x82]), encodeRemainingLength(remainingLength), variableHeader, payload]);
}

export function encodeMqttPingReqPacket(): Buffer {
  return MQTT_PACKET_PINGREQ;
}

export function parseFirstMqttPacket(buffer: Buffer): { packet: ParsedMqttPacket; bytesRead: number } | null {
  if (buffer.length < 2) {
    return null;
  }

  let multiplier = 1;
  let remainingLength = 0;
  let offset = 1;

  for (let i = 0; i < 4; i++) {
    if (offset >= buffer.length) {
      return null;
    }

    const byte = buffer[offset++];
    remainingLength += (byte & 127) * multiplier;

    if ((byte & 128) === 0) {
      if (buffer.length < offset + remainingLength) {
        return null;
      }

      return {
        packet: {
          type: buffer[0] >> 4,
          flags: buffer[0] & 0x0f,
          body: buffer.subarray(offset, offset + remainingLength),
        },
        bytesRead: offset + remainingLength,
      };
    }

    multiplier *= 128;
  }

  throw new Error('Malformed MQTT remaining length');
}

export function readMqttPublish(packet: ParsedMqttPacket): { topic: string; payload: Buffer } | null {
  if (packet.type !== MQTT_PACKET_PUBLISH || packet.body.length < 2) {
    return null;
  }

  const topicLength = packet.body.readUInt16BE(0);
  const topicStart = 2;
  const topicEnd = topicStart + topicLength;
  if (packet.body.length < topicEnd) {
    return null;
  }

  const qos = (packet.flags >> 1) & 0x03;
  const payloadStart = topicEnd + (qos > 0 ? 2 : 0);
  if (packet.body.length < payloadStart) {
    return null;
  }

  return {
    topic: packet.body.subarray(topicStart, topicEnd).toString('utf8'),
    payload: packet.body.subarray(payloadStart),
  };
}

export function readHealthcheckCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): MqttCredentials | null {
  const credentialsFile = resolveDockerHealthCredentialsFile(env);
  try {
    const credentials = readDockerHealthCredentials(credentialsFile);
    return { username: credentials.username, password: credentials.password };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read Docker healthcheck credentials from ${credentialsFile}: ${message}`);
  }
}

function readTimeoutMs(env: NodeJS.ProcessEnv): number {
  const rawValue = env.HEALTHCHECK_MQTT_TIMEOUT_MS?.trim();
  if (!rawValue) {
    return DEFAULT_HEALTHCHECK_TIMEOUT_MS;
  }

  const timeoutMs = Number(rawValue);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`HEALTHCHECK_MQTT_TIMEOUT_MS must be a positive integer, got "${rawValue}"`);
  }

  return timeoutMs;
}

function readKeepAliveSeconds(env: NodeJS.ProcessEnv): number {
  const rawValue = env.HEALTHCHECK_MQTT_KEEPALIVE_SECONDS?.trim();
  if (!rawValue) {
    return DEFAULT_KEEPALIVE_SECONDS;
  }

  const keepAliveSeconds = Number(rawValue);
  if (!Number.isSafeInteger(keepAliveSeconds) || keepAliveSeconds < 0 || keepAliveSeconds > 65_535) {
    throw new Error(`HEALTHCHECK_MQTT_KEEPALIVE_SECONDS must be an integer between 0 and 65535, got "${rawValue}"`);
  }

  return keepAliveSeconds;
}

function readPositiveOptionalInt(env: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
  const rawValue = env[name]?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${rawValue}"`);
  }

  return value;
}

function normalizeNamespace(namespace: string): string {
  return namespace
    .trim()
    .replace(/[^A-Za-z0-9:_-]/g, '-')
    .replace(/:+$/g, '') || DEFAULT_KV_NAMESPACE;
}

function keyPart(value: string): string {
  return encodeURIComponent(value);
}

export function resolveHealthcheckOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): MqttLoopbackHealthcheckOptions {
  const credentials = readHealthcheckCredentialsFromEnv(env);
  if (!credentials) {
    throw new Error('No Docker healthcheck credentials found. Start the broker so the docker_health runtime user is created.');
  }

  const port = env.HEALTHCHECK_MQTT_PORT?.trim() || env.MQTT_WS_PORT?.trim() || DEFAULT_HEALTHCHECK_PORT;
  const url = env.HEALTHCHECK_MQTT_URL?.trim() || `ws://127.0.0.1:${port}`;
  const timeoutMs = readTimeoutMs(env);
  const keepAliveSeconds = readKeepAliveSeconds(env);
  const clientId = env.HEALTHCHECK_MQTT_CLIENT_ID?.trim() || `docker-healthcheck-${process.pid}`;

  return {
    ...credentials,
    url,
    timeoutMs,
    keepAliveSeconds,
    clientId,
    topic: env.HEALTHCHECK_MQTT_TOPIC?.trim() || HEALTHCHECK_LOOPBACK_TOPIC,
    payload: env.HEALTHCHECK_MQTT_PAYLOAD ?? `${HEALTHCHECK_LOOPBACK_PAYLOAD_PREFIX}${process.pid}:${Date.now()}:${randomUUID()}`,
  };
}

export function resolveValkeyReadinessOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): ValkeyReadinessHealthcheckOptions {
  const kvUrl = env.BROKER_KV_URL?.trim();
  if (!kvUrl) {
    throw new Error('BROKER_KV_URL is required for Docker healthcheck Valkey readiness validation');
  }

  const instanceId = resolveBrokerInstanceId({ env });

  return {
    kvUrl,
    instanceId,
    namespace: normalizeNamespace(env.BROKER_KV_NAMESPACE || DEFAULT_KV_NAMESPACE),
    timeoutMs: readPositiveOptionalInt(env, 'HEALTHCHECK_VALKEY_TIMEOUT_MS', readTimeoutMs(env)),
    maxAgeMs: readPositiveOptionalInt(env, 'HEALTHCHECK_VALKEY_READY_MAX_AGE_MS', DEFAULT_VALKEY_READY_MAX_AGE_MS),
  };
}

function websocketDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  const view = data as unknown as ArrayBufferView;
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

export async function runMqttLoopbackHealthcheck(options: MqttLoopbackHealthcheckOptions): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(options.url, 'mqtt', {
      handshakeTimeout: Math.min(options.timeoutMs, 10_000),
    });

    let packetBuffer = Buffer.alloc(0);
    let subscribed = false;
    let published = false;
    let settled = false;
    let pingInterval: NodeJS.Timeout | null = null;

    const timeout = setTimeout(() => {
      fail(new Error(`MQTT loopback payload was not received on ${options.topic} within ${options.timeoutMs} ms`));
    }, options.timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      ws.removeAllListeners();
    }

    function succeed(): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.from([0xe0, 0x00])); // MQTT DISCONNECT
        ws.close();
      }
      resolve();
    }

    function fail(error: Error): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      try {
        ws.terminate();
      } catch {
        // Ignore termination errors during failure handling.
      }
      reject(error);
    }

    function startPingLoop(): void {
      if (options.keepAliveSeconds <= 0 || pingInterval) {
        return;
      }

      const intervalMs = Math.max(1_000, Math.min(30_000, Math.floor((options.keepAliveSeconds * 1_000) / 2)));
      pingInterval = setInterval(() => {
        if (!settled && ws.readyState === WebSocket.OPEN) {
          ws.send(encodeMqttPingReqPacket());
        }
      }, intervalMs);
    }

    function sendSubscribe(): void {
      subscribed = true;
      ws.send(encodeMqttSubscribePacket(options.topic));
    }

    ws.on('open', () => {
      ws.send(encodeMqttConnectPacket(options, options.clientId, options.keepAliveSeconds));
    });

    ws.on('message', (data) => {
      try {
        packetBuffer = Buffer.concat([packetBuffer, websocketDataToBuffer(data)]);

        while (packetBuffer.length > 0) {
          const parsed = parseFirstMqttPacket(packetBuffer);
          if (!parsed) {
            break;
          }

          packetBuffer = packetBuffer.subarray(parsed.bytesRead);
          const { packet } = parsed;

          if (packet.type === MQTT_PACKET_CONNACK) {
            if (packet.body.length < 2 || packet.body[1] !== 0) {
              fail(new Error(`MQTT authentication failed with CONNACK code ${packet.body[1] ?? 'unknown'}`));
              return;
            }
            startPingLoop();
            sendSubscribe();
            continue;
          }

          if (packet.type === MQTT_PACKET_SUBACK) {
            if (packet.body.length < 3 || packet.body[0] !== 0 || packet.body[1] !== MQTT_SUBSCRIBE_PACKET_IDENTIFIER || packet.body[2] === 0x80) {
              fail(new Error('MQTT healthcheck loopback subscription was rejected'));
              return;
            }
            published = true;
            ws.send(encodeMqttPublishPacket(options.topic, options.payload));
            continue;
          }

          const publish = readMqttPublish(packet);
          if (!publish) {
            continue;
          }

          if (publish.topic === options.topic && publish.payload.toString('utf8') === options.payload) {
            succeed();
            return;
          }
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });

    ws.on('error', (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });

    ws.on('close', () => {
      if (!settled) {
        fail(new Error(published ? 'MQTT connection closed before the loopback payload was received' : subscribed ? 'MQTT connection closed before the loopback payload was published' : 'MQTT connection closed before the subscription completed'));
      }
    });
  });
}

export async function runValkeyReadinessHealthcheck(options: ValkeyReadinessHealthcheckOptions, now = Date.now()): Promise<void> {
  const redis = new Redis(options.kvUrl, {
    connectTimeout: options.timeoutMs,
    maxRetriesPerRequest: 1,
    retryStrategy() {
      return null;
    },
  });

  const key = `${options.namespace}:instances:${keyPart(options.instanceId)}:ready`;

  try {
    await redis.ping();
    const rawReadiness = await redis.get(key);
    if (!rawReadiness) {
      throw new Error(`Valkey readiness key is missing: ${key}`);
    }

    let readiness: any;
    try {
      readiness = JSON.parse(rawReadiness);
    } catch {
      throw new Error(`Valkey readiness key is not valid JSON: ${key}`);
    }

    if (readiness.status !== 'ready') {
      throw new Error(`Valkey readiness status is not ready for ${options.instanceId}: ${String(readiness.status)}`);
    }

    if (readiness.lastUpdatedByInstance !== options.instanceId) {
      throw new Error(`Valkey readiness belongs to ${String(readiness.lastUpdatedByInstance)}, expected ${options.instanceId}`);
    }

    if (!Number.isSafeInteger(readiness.lastUpdatedAt)) {
      throw new Error(`Valkey readiness lastUpdatedAt is invalid for ${options.instanceId}`);
    }

    const ageMs = now - readiness.lastUpdatedAt;
    if (ageMs < 0 || ageMs > options.maxAgeMs) {
      throw new Error(`Valkey readiness is stale for ${options.instanceId}: ${ageMs} ms old`);
    }
  } finally {
    redis.disconnect();
  }
}

export const runMqttHeartbeatHealthcheck = runMqttLoopbackHealthcheck;
export type MqttHeartbeatHealthcheckOptions = MqttLoopbackHealthcheckOptions;

function isEntrypoint(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isEntrypoint()) {
  try {
    const options = resolveHealthcheckOptionsFromEnv();
    const valkeyOptions = resolveValkeyReadinessOptionsFromEnv();
    await runMqttLoopbackHealthcheck(options);
    await runValkeyReadinessHealthcheck(valkeyOptions);
    console.log(`[HEALTHCHECK] MQTT loopback publish/subscription succeeded on ${options.topic}`);
    console.log(`[HEALTHCHECK] Valkey readiness succeeded for ${valkeyOptions.instanceId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[HEALTHCHECK] ${message}`);
    process.exit(1);
  }
}
