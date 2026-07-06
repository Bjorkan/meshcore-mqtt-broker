import { hostname } from 'os';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import type { PublishPacket } from 'aedes';

export interface TargetBridgeConfig {
  enabled: boolean;
  targetUrl: string;
  targetUser: string;
  targetPass: string;
  clientId: string;
  reconnectPeriodMs: number;
  connectTimeoutMs: number;
  rejectUnauthorized: boolean;
}

export interface TargetBridgeDependencies {
  connect?: typeof mqtt.connect;
}

export interface TargetBridgeRuntime {
  target: MqttClient;
  isTargetReady: () => boolean;
  getDroppedMessageCount: () => number;
  getStatus: () => TargetBridgeStatus;
  forwardPublish: (packet: PublishPacket, client: unknown) => void;
  stop: () => Promise<void>;
}

export interface TargetBridgeStatus {
  enabled: boolean;
  connected: boolean;
  targetUrl?: string;
  targetHost?: string;
  clientId?: string;
  droppedMessages: number;
}

function envString(value: string | undefined, defaultValue = ''): string {
  if (value === undefined) {
    return defaultValue;
  }

  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function envBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function envInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function brokerHostname(env: NodeJS.ProcessEnv): string {
  return envString(env.HOSTNAME, hostname() || `broker-${process.pid}`);
}

function targetHost(targetUrl: string): string | undefined {
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return targetUrl || undefined;
  }
}

export function loadTargetBridgeConfig(env: NodeJS.ProcessEnv = process.env): TargetBridgeConfig {
  const targetUrl = envString(env.TARGET_MQTT_URL);

  return {
    enabled: targetUrl !== '',
    targetUrl,
    targetUser: envString(env.TARGET_MQTT_USERNAME),
    targetPass: envString(env.TARGET_MQTT_PASSWORD),
    clientId: brokerHostname(env),
    reconnectPeriodMs: envInt(env.MQTT_RECONNECT_PERIOD_MS, 5000),
    connectTimeoutMs: envInt(env.MQTT_CONNECT_TIMEOUT_MS, 30000),
    rejectUnauthorized: envBool(env.TARGET_REJECT_UNAUTHORIZED, true),
  };
}

function shortPublicKey(publicKey: string | undefined): string {
  return publicKey?.substring(0, 8) || 'okänd';
}

function packetPublicKey(topic: string): string | undefined {
  const parts = topic.split('/');
  if (parts[0] !== 'meshcore' || parts.length < 4) {
    return undefined;
  }

  const publicKey = parts[2].toUpperCase();
  return /^[0-9A-F]{64}$/.test(publicKey) ? publicKey : undefined;
}

export function shouldForwardToTarget(packet: PublishPacket, client: unknown): boolean {
  const sourceClient = client as {
    publicKey?: string;
    observerClaimed?: boolean;
    clientType?: string;
  } | null;

  if (!sourceClient?.publicKey || sourceClient.clientType !== 'publisher' || sourceClient.observerClaimed !== true) {
    return false;
  }

  if (!packet.topic.startsWith('meshcore/')) {
    return false;
  }

  if (packet.topic.includes('/internal') || packet.topic.includes('/serial/commands')) {
    return false;
  }

  return packetPublicKey(packet.topic) === sourceClient.publicKey.toUpperCase();
}

export function startTargetBridge(
  config: TargetBridgeConfig = loadTargetBridgeConfig(),
  dependencies: TargetBridgeDependencies = {}
): TargetBridgeRuntime | null {
  if (!config.enabled) {
    console.log('[TARGET-BRIDGE] Target MQTT är inte konfigurerad. Sätt TARGET_MQTT_URL för att aktivera vidarebefordran.');
    return null;
  }

  let targetReady = false;
  let droppedMessages = 0;
  const connect = dependencies.connect || mqtt.connect;

  console.log(`[TARGET-BRIDGE] Target MQTT: ${config.targetUrl}`);
  console.log(`[TARGET-BRIDGE] Target client ID: ${config.clientId}`);

  const target = connect(config.targetUrl, {
    clean: true,
    reconnectPeriod: config.reconnectPeriodMs,
    connectTimeout: config.connectTimeoutMs,
    username: config.targetUser,
    password: config.targetPass,
    clientId: config.clientId,
    rejectUnauthorized: config.rejectUnauthorized,
  } as IClientOptions);

  target.on('connect', () => {
    targetReady = true;
    console.log('[TARGET-BRIDGE] Ansluten till target broker.');
  });

  target.on('close', () => {
    targetReady = false;
    console.warn('[TARGET-BRIDGE] Target broker frånkopplad.');
  });

  target.on('offline', () => {
    targetReady = false;
    console.warn('[TARGET-BRIDGE] Target broker offline.');
  });

  target.on('error', (err) => {
    console.error('[TARGET-BRIDGE] Target broker-fel:', err.message);
  });

  function forwardPublish(packet: PublishPacket, client: unknown): void {
    if (!shouldForwardToTarget(packet, client)) {
      return;
    }

    const publicKey = (client as { publicKey?: string }).publicKey;

    if (!targetReady || !target.connected) {
      droppedMessages++;
      console.warn(`[TARGET-BRIDGE] Target broker är inte redo. Släpper ${packet.topic} från ${shortPublicKey(publicKey)}. Tappade meddelanden sedan start: ${droppedMessages}.`);
      return;
    }

    target.publish(
      packet.topic,
      packet.payload,
      {
        qos: 0,
        retain: false,
      },
      (err) => {
        if (err) {
          console.error(`[TARGET-BRIDGE] Kunde inte vidarebefordra ${packet.topic}:`, err.message);
        } else {
          console.log(`[TARGET-BRIDGE] Vidarebefordrade ${packet.topic} (${packet.payload.length} byte, retain: nej${packet.retain ? ', source-retain släppt' : ''})`);
        }
      }
    );
  }

  async function stop(): Promise<void> {
    await new Promise<void>((resolve) => target.end(true, {}, () => resolve()));
  }

  return {
    target,
    isTargetReady: () => targetReady,
    getDroppedMessageCount: () => droppedMessages,
    getStatus: () => ({
      enabled: true,
      connected: targetReady && target.connected,
      targetUrl: config.targetUrl,
      targetHost: targetHost(config.targetUrl),
      clientId: config.clientId,
      droppedMessages,
    }),
    forwardPublish,
    stop,
  };
}
