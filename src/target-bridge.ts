import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import type { PublishPacket } from "aedes";
import { configBool, configInt, configString } from "./config.js";
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
  retainedCapacity?: number;
  publishTimeoutMs?: number;
  maxPendingForwards?: number;
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

export function loadTargetBridgeConfig(
  overrides: { clientId?: string } = {},
): TargetBridgeConfig {
  const targetUrl = envString(configString(["target_mqtt", "url"]));
  // clientId is injected by startBrokerServer (one identity per process).
  // Tests may pass it directly; otherwise a caller-provided default keeps
  // the bridge bootable standalone.

  // Timeout bounds are only validated when forwarding is actually enabled,
  // so a typo in an unused section cannot crash-loop the broker.
  // reconnect_period_ms allows 0 (mqtt.js: no auto-reconnect, stays offline
  // and drops are counted) — documented, not a storm risk. Clamp tiny
  // non-zero values up to 1 s to avoid hot reconnect loops.
  const enabled = targetUrl !== "";
  const reconnectPeriodMs = enabled
    ? Math.max(
        0,
        configInt(["target_mqtt", "reconnect_period_ms"], 5000, {
          min: 0,
          max: 300_000,
        }),
      )
    : 5000;
  const effectiveReconnectPeriodMs =
    enabled && reconnectPeriodMs > 0 && reconnectPeriodMs < 1_000
      ? 1_000
      : reconnectPeriodMs;
  const connectTimeoutMs = enabled
    ? configInt(["target_mqtt", "connect_timeout_ms"], 30000, {
        min: 1_000,
        max: 300_000,
      })
    : 30000;

  return {
    enabled,
    targetUrl,
    targetUser: envString(configString(["target_mqtt", "username"])),
    targetPass: envString(configString(["target_mqtt", "password"])),
    clientId: overrides.clientId ?? "meshcore-mqtt-broker",
    reconnectPeriodMs: effectiveReconnectPeriodMs,
    connectTimeoutMs,
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
  "neighbors",
]);

function meshcoreSubtopic(topic: string): string | undefined {
  const parts = topic.split("/");
  if (parts[0] !== "meshcore" || parts.length < 4) {
    return undefined;
  }
  return parts.slice(3).join("/").toLowerCase();
}

/**
 * At-most-once forwarding to the optional target broker. There is no
 * buffering or retry: publishes while the target is offline are dropped and
 * counted (see getStatus, surfaced on GET /status). Retained `neighbors`
 * clears are tracked in memory only and reset on restart; after a restart
 * the external target may keep the last forwarded retained value until the
 * next successful forward refreshes its deadline.
 */
export function shouldForwardToTarget(
  packet: PublishPacket,
  client: unknown,
): boolean {
  const sourceClient = client as {
    publicKey?: string;
    clientType?: string;
  } | null;

  if (!sourceClient?.publicKey || sourceClient.clientType !== "publisher") {
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
  const retainedCapacity = dependencies.retainedCapacity ?? 10_000;
  if (!Number.isSafeInteger(retainedCapacity) || retainedCapacity < 1) {
    throw new RangeError("retainedCapacity must be a positive safe integer");
  }
  const publishTimeoutMs = dependencies.publishTimeoutMs ?? 5_000;
  const maxPendingForwards = dependencies.maxPendingForwards ?? 1_000;
  if (
    !Number.isSafeInteger(publishTimeoutMs) ||
    publishTimeoutMs < 1 ||
    !Number.isSafeInteger(maxPendingForwards) ||
    maxPendingForwards < 1
  ) {
    throw new RangeError(
      "publishTimeoutMs and maxPendingForwards must be positive safe integers",
    );
  }
  let retainedOperation: Promise<void> = Promise.resolve();
  const RETAINED_OPERATION_IDLE = retainedOperation;
  const forwardOperations = new Set<Promise<void>>();
  // In-flight forward count: pending nonretained publishes plus at most one
  // queued retained chain. Bounded so an unresponsive target (callbacks that
  // never fire, or one timeout each) cannot grow the queue without limit.
  function pendingForwardCount(): number {
    return (
      forwardOperations.size +
      (retainedOperation === RETAINED_OPERATION_IDLE ? 0 : 1)
    );
  }
  // In-memory clear deadlines for retained neighbor topics. Resets on restart.
  // Bounded: one entry per distinct neighbors topic, capped so a flood of
  // unique observer keys cannot grow memory without limit.
  const retainedClearDeadlines = new Map<string, number>();
  const MAX_RETAINED_CLEAR_ENTRIES = retainedCapacity;
  let clearRunning = false;
  let clearScanPromise: Promise<void> | null = null;
  let stopping = false;
  // Time-based warn throttle for offline drops: count-based (%10) alone
  // floods at 1k publishes/s (100 warns/s). At most one warn per 30 s.
  let lastOfflineWarnAt = 0;
  const OFFLINE_WARN_THROTTLE_MS = 30_000;

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
      if (stopping || !targetReady || !target.connected) {
        reject(new Error("target broker not ready"));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("target publish timed out"));
      }, publishTimeoutMs);
      // unref: an in-flight forward must not keep the event loop (or
      // broker shutdown) alive by itself.
      timer.unref?.();
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
    const current = retainedOperation
      .catch(() => undefined)
      .then(operation)
      .catch((error) => {
        log.error(
          `target retained operation failed for ${topic}:`,
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        if (retainedOperation === current) {
          retainedOperation = Promise.resolve();
        }
      });
    retainedOperation = current;
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
      const now = Date.now();
      const due = [...retainedClearDeadlines.entries()].filter(
        ([, expiresAt]) => expiresAt <= now,
      );
      if (stopping) return;
      await Promise.all(
        due.map(([topic]) =>
          enqueueRetainedOperation(topic, async () => {
            const deadline = retainedClearDeadlines.get(topic);
            if (stopping || !deadline || deadline > Date.now()) return;
            if (!targetReady || !target.connected) return;
            await publishTarget(topic, Buffer.alloc(0), true);
            if (retainedClearDeadlines.get(topic) === deadline) {
              retainedClearDeadlines.delete(topic);
            }
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
      // Time-throttled: at-most-once forwarding means an offline target
      // produces one drop per publish; log at most one warn per 30 s.
      const now = Date.now();
      if (
        droppedMessages === 1 ||
        now - lastOfflineWarnAt >= OFFLINE_WARN_THROTTLE_MS
      ) {
        lastOfflineWarnAt = now;
        log.warn(
          `target broker not ready, dropping ${packet.topic} from ${shortPublicKey(publicKey)}. dropped messages since start: ${droppedMessages}`,
        );
      }
      return;
    }

    if (pendingForwardCount() >= maxPendingForwards) {
      droppedMessages++;
      const now = Date.now();
      if (
        droppedMessages === 1 ||
        now - lastOfflineWarnAt >= OFFLINE_WARN_THROTTLE_MS
      ) {
        lastOfflineWarnAt = now;
        log.warn(
          `target forward queue full, dropping ${packet.topic} from ${shortPublicKey(publicKey)}. dropped messages since start: ${droppedMessages}`,
        );
      }
      return;
    }

    const isRetained = meshcoreSubtopic(packet.topic) === "neighbors";

    const publish = async () => {
      try {
        if (stopping || !targetReady || !target.connected) {
          throw new Error("target broker not ready");
        }
        if (isRetained) {
          if (
            !retainedClearDeadlines.has(packet.topic) &&
            retainedClearDeadlines.size >= MAX_RETAINED_CLEAR_ENTRIES
          ) {
            const oldest = retainedClearDeadlines.keys().next();
            if (!oldest.done) {
              await publishTarget(oldest.value, Buffer.alloc(0), true);
              retainedClearDeadlines.delete(oldest.value);
            }
          }
          if (!retainedClearDeadlines.has(packet.topic)) {
            retainedClearDeadlines.set(
              packet.topic,
              Date.now() + NEIGHBOR_RETENTION_MS,
            );
          }
        }
        await publishTarget(
          packet.topic,
          Buffer.isBuffer(packet.payload)
            ? packet.payload
            : Buffer.from(packet.payload),
          isRetained,
        );
        if (isRetained) {
          retainedClearDeadlines.delete(packet.topic);
          retainedClearDeadlines.set(
            packet.topic,
            Date.now() + NEIGHBOR_RETENTION_MS,
          );
        }
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
    // Bounded wait: a wedged scan must not stall broker shutdown (2 s),
    // and in-flight forwards get at most one SHUTDOWN_STEP each. The race
    // timer is cleared so stop() itself never pins the loop 2 s extra.
    // Pending retained clear deadlines are intentionally in-memory only
    // and reset on restart.
    let raceTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        clearScanPromise ?? Promise.resolve(),
        new Promise((resolve) => {
          raceTimer = setTimeout(resolve, 2_000);
          raceTimer.unref?.();
        }),
      ]);
      const stopDeadline = Date.now() + 5_000;
      while (forwardOperations.size > 0 && Date.now() < stopDeadline) {
        await Promise.race([
          Promise.allSettled([...forwardOperations]),
          new Promise((resolve) => {
            const timer = setTimeout(resolve, 500);
            timer.unref?.();
          }),
        ]);
      }
      if (forwardOperations.size > 0) {
        log.warn(
          `target bridge stop: abandoning ${forwardOperations.size} in-flight forwards after 5 s`,
        );
        forwardOperations.clear();
      }
    } finally {
      if (raceTimer) clearTimeout(raceTimer);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      timer.unref?.();
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
