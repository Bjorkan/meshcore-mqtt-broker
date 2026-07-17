import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import type { PublishPacket } from "aedes";
import { configBool, configInt, configString } from "./config.js";
import { resolveBrokerInstanceId } from "./instance-id.js";
import { getModuleLogger } from "./logger.js";

const log = getModuleLogger("TargetBridge");

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
  getSuccessfulMessageCount: () => number;
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
  successfulMessages: number;
}

function envString(value: string | undefined, defaultValue = ""): string {
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

function targetHost(targetUrl: string): string | undefined {
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return targetUrl || undefined;
  }
}

export function redactTargetUrl(targetUrl: string): string {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.username) {
      parsed.username = "***";
    }
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return targetUrl.replace(/(:\/\/)[^@\s]+@/, "$1***:***@");
  }
}

export function loadTargetBridgeConfig(): TargetBridgeConfig {
  const targetUrl = envString(configString(["target_mqtt", "url"]));
  const brokerName = configString(["broker", "name"], "Broker");
  const runtimeIdFile = configString(["broker", "runtime_id_file"]);

  return {
    enabled: targetUrl !== "",
    targetUrl,
    targetUser: envString(configString(["target_mqtt", "username"])),
    targetPass: envString(configString(["target_mqtt", "password"])),
    clientId: resolveBrokerInstanceId({ brokerName, runtimeIdFile }),
    reconnectPeriodMs: configInt(["target_mqtt", "reconnect_period_ms"], 5000, {
      min: 0,
      max: 300_000,
    }),
    connectTimeoutMs: configInt(["target_mqtt", "connect_timeout_ms"], 30000, {
      min: 1_000,
      max: 300_000,
    }),
    rejectUnauthorized: configBool(
      ["target_mqtt", "reject_unauthorized"],
      true,
    ),
  };
}

function shortPublicKey(publicKey: string | undefined): string {
  return publicKey?.substring(0, 8) || "okänd";
}

function packetPublicKey(topic: string): string | undefined {
  const parts = topic.split("/");
  if (parts[0] !== "meshcore" || parts.length < 4) {
    return undefined;
  }

  const publicKey = parts[2].toUpperCase();
  return /^[0-9A-F]{64}$/.test(publicKey) ? publicKey : undefined;
}

function isPrivateMeshcoreTopic(topic: string): boolean {
  const parts = topic.split("/");
  if (parts[0] !== "meshcore" || parts.length < 4) {
    return false;
  }

  const root = parts[3].toLowerCase();
  return root === "internal" || root === "serial";
}

export function shouldForwardToTarget(
  packet: PublishPacket,
  client: unknown,
): boolean {
  const sourceClient = client as {
    publicKey?: string;
    observerClaimed?: boolean;
    clientType?: string;
  } | null;

  if (
    !sourceClient?.publicKey ||
    sourceClient.clientType !== "publisher" ||
    sourceClient.observerClaimed !== true
  ) {
    return false;
  }

  if (!packet.topic.startsWith("meshcore/")) {
    return false;
  }

  if (isPrivateMeshcoreTopic(packet.topic)) {
    return false;
  }

  return packetPublicKey(packet.topic) === sourceClient.publicKey.toUpperCase();
}

export function startTargetBridge(
  config: TargetBridgeConfig = loadTargetBridgeConfig(),
  dependencies: TargetBridgeDependencies = {},
): TargetBridgeRuntime | null {
  if (!config.enabled) {
    log.info(
      "target MQTT not configured, set target_mqtt.url in config.yaml to enable forwarding",
    );
    return null;
  }

  let targetReady = false;
  let droppedMessages = 0;
  let successfulMessages = 0;
  const connect = dependencies.connect || mqtt.connect;

  log.info(`target MQTT URL: ${redactTargetUrl(config.targetUrl)}`);
  log.info(`target client ID: ${config.clientId}`);

  const target = connect(config.targetUrl, {
    clean: true,
    reconnectPeriod: config.reconnectPeriodMs,
    connectTimeout: config.connectTimeoutMs,
    username: config.targetUser,
    password: config.targetPass,
    clientId: config.clientId,
    rejectUnauthorized: config.rejectUnauthorized,
  } as IClientOptions);

  target.on("connect", () => {
    targetReady = true;
    log.info("connected to target broker");
  });

  target.on("close", () => {
    targetReady = false;
    log.warn("target broker disconnected");
  });

  target.on("offline", () => {
    targetReady = false;
    log.warn("target broker offline");
  });

  target.on("error", (err) => {
    log.error("target broker error:", err.message);
  });

  function forwardPublish(packet: PublishPacket, client: unknown): void {
    if (!shouldForwardToTarget(packet, client)) {
      return;
    }

    const publicKey = (client as { publicKey?: string }).publicKey;

    if (!targetReady || !target.connected) {
      droppedMessages++;
      log.warn(
        `target broker not ready, dropping ${packet.topic} from ${shortPublicKey(publicKey)}. dropped messages since start: ${droppedMessages}`,
      );
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
          droppedMessages++;
          log.error(
            `could not forward ${packet.topic} (dropped since start: ${droppedMessages}):`,
            err.message,
          );
        } else {
          successfulMessages++;
          log.info(
            `forwarded ${packet.topic} (${packet.payload.length} bytes, retain: no${packet.retain ? ", source-retain dropped" : ""}, successful since start: ${successfulMessages})`,
          );
        }
      },
    );
  }

  async function stop(): Promise<void> {
    await new Promise<void>((resolve) => target.end(true, {}, () => resolve()));
  }

  return {
    target,
    isTargetReady: () => targetReady,
    getDroppedMessageCount: () => droppedMessages,
    getSuccessfulMessageCount: () => successfulMessages,
    getStatus: () => ({
      enabled: true,
      connected: targetReady && target.connected,
      targetUrl: config.targetUrl,
      targetHost: targetHost(config.targetUrl),
      clientId: config.clientId,
      droppedMessages,
      successfulMessages,
    }),
    forwardPublish,
    stop,
  };
}
