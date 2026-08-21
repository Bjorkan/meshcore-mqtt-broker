import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import type { PublishPacket } from "aedes";
import { configBool, configInt, configString } from "./config.js";
import type { ApplicationDatabase } from "./database.js";
import { resolveBrokerInstanceId } from "./instance-id.js";
import { getModuleLogger } from "./logger.js";
import { NEIGHBOR_RETENTION_MS } from "./neighbors.js";

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
  database?: ApplicationDatabase;
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

export const TARGET_BRIDGE_ALLOWED_SUBTOPICS = new Set([
  "status",
  "packets",
  "raw",
  "neighbors",
]);

function meshcoreSubtopic(topic: string): string | undefined {
  const parts = topic.split("/");
  if (parts[0] !== "meshcore" || parts.length < 4) {
    return undefined;
  }
  return parts.slice(3).join("/").toLowerCase();
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

  const subtopic = meshcoreSubtopic(packet.topic);
  if (!subtopic || !TARGET_BRIDGE_ALLOWED_SUBTOPICS.has(subtopic)) {
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
  if (!dependencies.database) {
    throw new Error("Target forwarding requires the application database");
  }
  const database: ApplicationDatabase = dependencies.database;
  const retainedOperations = new Map<string, Promise<void>>();
  const forwardOperations = new Set<Promise<void>>();
  let clearRunning = false;
  let clearScanPromise: Promise<void> | null = null;
  let stopping = false;

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

  function publishTarget(
    topic: string,
    payload: Buffer,
    retain: boolean,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("target publish timed out"));
      }, 5_000);
      target.publish(topic, payload, { qos: 0, retain }, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    });
  }

  function enqueueRetainedOperation(
    topic: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const prior = retainedOperations.get(topic) ?? Promise.resolve();
    const current = prior
      .catch(() => undefined)
      .then(operation)
      .catch((error) => {
        log.error(
          `target retained operation failed for ${topic}:`,
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        if (retainedOperations.get(topic) === current) {
          retainedOperations.delete(topic);
        }
      });
    retainedOperations.set(topic, current);
    forwardOperations.add(current);
    void current.then(
      () => forwardOperations.delete(current),
      () => forwardOperations.delete(current),
    );
    return current;
  }

  async function clearExpiredRetained(): Promise<void> {
    if (stopping || clearRunning || !targetReady || !target.connected) return;
    clearRunning = true;
    try {
      const rows = await database.all<{ topic: string }>(
        `SELECT topic FROM target_retained_clears
         WHERE expires_at_ms <= $1 ORDER BY expires_at_ms ASC, topic ASC LIMIT 500`,
        Date.now(),
      );
      if (stopping) return;
      await Promise.all(
        rows.map((row) =>
          enqueueRetainedOperation(row.topic, async () => {
            const due = await database.get<{ found: number }>(
              `SELECT 1 AS found FROM target_retained_clears
               WHERE topic = $1 AND expires_at_ms <= $2 LIMIT 1`,
              row.topic,
              Date.now(),
            );
            if (stopping || !due || !targetReady || !target.connected) return;
            await publishTarget(row.topic, Buffer.alloc(0), true);
            await database.run(
              `DELETE FROM target_retained_clears
              WHERE topic = $1 AND expires_at_ms <= $2`,
              row.topic,
              Date.now(),
            );
          }),
        ),
      );
    } finally {
      clearRunning = false;
    }
  }

  function runRetainedClearScan(): void {
    if (clearScanPromise || stopping) return;
    const operation = clearExpiredRetained()
      .catch((error) => {
        log.error("could not process retained target expirations:", error);
      })
      .finally(() => {
        if (clearScanPromise === operation) clearScanPromise = null;
      });
    clearScanPromise = operation;
  }

  const retainedClearInterval = setInterval(() => {
    runRetainedClearScan();
  }, 30_000);
  retainedClearInterval.unref();

  target.on("connect", () => {
    targetReady = true;
    log.info("connected to target broker");
    runRetainedClearScan();
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
    if (stopping || !shouldForwardToTarget(packet, client)) {
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

    const isRetained = meshcoreSubtopic(packet.topic) === "neighbors";

    const publish = async () => {
      try {
        if (isRetained) {
          await database.run(
            `INSERT INTO target_retained_clears(topic, expires_at_ms)
              VALUES ($1, $2)
              ON CONFLICT(topic) DO UPDATE SET expires_at_ms = excluded.expires_at_ms`,
            packet.topic,
            Date.now() + NEIGHBOR_RETENTION_MS,
          );
        }
        await publishTarget(
          packet.topic,
          Buffer.isBuffer(packet.payload)
            ? packet.payload
            : Buffer.from(packet.payload),
          isRetained,
        );
        successfulMessages++;
        log.info(
          `forwarded ${packet.topic} (${packet.payload.length} bytes, retain: ${isRetained ? "yes" : "no"}${!isRetained && packet.retain ? ", source-retain dropped" : ""}, successful since start: ${successfulMessages})`,
        );
      } catch (error) {
        droppedMessages++;
        log.error(
          `could not forward ${packet.topic} (dropped since start: ${droppedMessages}):`,
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    if (isRetained) {
      void enqueueRetainedOperation(packet.topic, publish);
    } else {
      const operation = publish();
      forwardOperations.add(operation);
      void operation.then(
        () => forwardOperations.delete(operation),
        () => forwardOperations.delete(operation),
      );
    }
  }

  async function stop(): Promise<void> {
    stopping = true;
    clearInterval(retainedClearInterval);
    await clearScanPromise;
    while (forwardOperations.size > 0) {
      await Promise.allSettled([...forwardOperations]);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      target.end(true, {}, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  return {
    target,
    isTargetReady: () => targetReady,
    getDroppedMessageCount: () => droppedMessages,
    getSuccessfulMessageCount: () => successfulMessages,
    getStatus: () => ({
      enabled: true,
      connected: targetReady && target.connected,
      targetUrl: redactTargetUrl(config.targetUrl),
      targetHost: targetHost(config.targetUrl),
      clientId: config.clientId,
      droppedMessages,
      successfulMessages,
    }),
    forwardPublish,
    stop,
  };
}
