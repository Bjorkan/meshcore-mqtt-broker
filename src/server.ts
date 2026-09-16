import { Aedes, type PublishPacket } from "aedes";
import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { WebSocketServer } from "ws";
import { Duplex } from "stream";
import { pathToFileURL } from "url";
import { verifyAuthToken } from "@michaelhart/meshcore-decoder";
import { AbuseDetector } from "./abuse-detector.js";
import {
  configString,
  loadMqttConfig,
  loadAbuseConfig,
  loadSubscriberConfig,
  loadMeshcoreIoConfig,
} from "./config.js";
import { logger, getModuleLogger, setBrokerLogContext } from "./logger.js";
import {
  BROKER_HEARTBEAT_INTERVAL_MS,
  BROKER_HEARTBEAT_MESSAGE,
  BROKER_HEARTBEAT_TOPIC,
} from "./heartbeat.js";
import {
  createDockerHealthCredentials,
  DOCKER_HEALTH_MAX_CONNECTIONS,
  DOCKER_HEALTH_USERNAME,
} from "./docker-health-user.js";
import { HEALTHCHECK_LOOPBACK_TOPIC } from "./healthcheck-loopback.js";
import type { MeshAedesClient } from "./aedes-types.js";
import {
  startTargetBridge,
  type TargetBridgeRuntime,
} from "./target-bridge.js";
import { IataRegistry } from "./iata-registry.js";
import {
  quarantineOrphanedWill,
  quarantineStaleStatus,
} from "./orphaned-will.js";
import { createMeshcoreIoRuntime } from "./meshcore-io-runtime.js";
import {
  jsonPublishLimitForSubtopic,
  NEIGHBOR_RETENTION_MS,
  stripNeighborSnrForLimitedSubscriber,
} from "./neighbors.js";

export {
  BROKER_HEARTBEAT_INTERVAL_MS,
  BROKER_HEARTBEAT_MESSAGE,
  BROKER_HEARTBEAT_TOPIC,
} from "./heartbeat.js";

function isRetainedSubtopic(topic: string): boolean {
  const parts = topic.split("/");
  return (
    parts.length === 4 &&
    parts[0] === "meshcore" &&
    parts[3].toLowerCase() === "neighbors"
  );
}

const SERIAL_RESPONSE_MAX_BYTES = 4096;
const SERIAL_COMMAND_MAX_BYTES = 4096;
const HEALTHCHECK_TOPIC = configString(
  ["healthcheck", "mqtt_topic"],
  HEALTHCHECK_LOOPBACK_TOPIC,
);
const HEALTHCHECK_MAX_PAYLOAD_BYTES = 512;
const SHUTDOWN_STEP_TIMEOUT_MS = 5_000;
export const DEFAULT_NODE_NAME_CACHE_TTL_MS = 300_000;

/**
 * Machine-readable observer-facing error codes. Every connection or publish
 * denial carries one `code` (stable for firmware string matching) plus a
 * human-readable `message`.
 *
 * - Auth denials surface as CONNACK returnCode 5 ("not authorized", the only
 *   MQTT 3.1.1 code that fits) with `[CODE] detail` in the error.
 * - Publish denials surface as the authorizePublish error (`[CODE] detail`,
 *   visible on QoS 1 as connection close) AND as a JSON publish to the
 *   observer's own `meshcore/<IATA>/<OWN_KEY>/error` topic on the same
 *   connection before any close — the only channel a QoS 0 observer is
 *   guaranteed to see. Observers should SUBSCRIBE that topic at connect.
 */
export const OBSERVER_ERROR_CODES = {
  AUTH_INVALID_USERNAME_FORMAT: "AUTH_INVALID_USERNAME_FORMAT",
  AUTH_INVALID_PUBLIC_KEY: "AUTH_INVALID_PUBLIC_KEY",
  AUTH_MISSING_TOKEN: "AUTH_MISSING_TOKEN",
  AUTH_INVALID_TOKEN: "AUTH_INVALID_TOKEN",
  AUTH_INVALID_PASSWORD: "AUTH_INVALID_PASSWORD",
  AUTH_WRONG_AUDIENCE: "AUTH_WRONG_AUDIENCE",
  AUTH_STALE_TOKEN: "AUTH_STALE_TOKEN",
  AUTH_SHUTTING_DOWN: "AUTH_SHUTTING_DOWN",
  AUTH_INTERNAL_ERROR: "AUTH_INTERNAL_ERROR",
  SUBSCRIBER_CONNECTION_LIMIT: "SUBSCRIBER_CONNECTION_LIMIT",
  PUBLISH_NOT_MESHCORE_TOPIC: "PUBLISH_NOT_MESHCORE_TOPIC",
  PUBLISH_BAD_TOPIC_SHAPE: "PUBLISH_BAD_TOPIC_SHAPE",
  PUBLISH_PLACEHOLDER_IATA: "PUBLISH_PLACEHOLDER_IATA",
  PUBLISH_TEST_INGRESS_DISABLED: "PUBLISH_TEST_INGRESS_DISABLED",
  PUBLISH_INVALID_IATA_FORMAT: "PUBLISH_INVALID_IATA_FORMAT",
  PUBLISH_SECONDARY_IATA: "PUBLISH_SECONDARY_IATA",
  PUBLISH_UNKNOWN_IATA: "PUBLISH_UNKNOWN_IATA",
  PUBLISH_KEY_MISMATCH: "PUBLISH_KEY_MISMATCH",
  PUBLISH_STALE_CONNECTION: "PUBLISH_STALE_CONNECTION",
  PUBLISH_STALE_STATUS: "PUBLISH_STALE_STATUS",
  PUBLISH_RESERVED_SUBTOPIC: "PUBLISH_RESERVED_SUBTOPIC",
  PUBLISH_SERIAL_RESPONSE_INVALID: "PUBLISH_SERIAL_RESPONSE_INVALID",
  PUBLISH_PAYLOAD_TOO_LARGE: "PUBLISH_PAYLOAD_TOO_LARGE",
  PUBLISH_INVALID_JSON: "PUBLISH_INVALID_JSON",
  PUBLISH_ORIGIN_MISSING: "PUBLISH_ORIGIN_MISSING",
  PUBLISH_ORIGIN_MISMATCH: "PUBLISH_ORIGIN_MISMATCH",
  PUBLISH_UNKNOWN_CLIENT: "PUBLISH_UNKNOWN_CLIENT",
  PUBLISH_INTERNAL_ERROR: "PUBLISH_INTERNAL_ERROR",
} as const;

export type ObserverErrorCode =
  (typeof OBSERVER_ERROR_CODES)[keyof typeof OBSERVER_ERROR_CODES];

export function observerError(code: ObserverErrorCode, message: string): Error {
  const error = new Error(`[${code}] ${message}`);
  (error as unknown as Record<string, unknown>).code = code;
  return error;
}

export function observerErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

export interface BrokerServerOptions {
  iataRegistry?: IataRegistry;
}

export interface BrokerServerRuntime {
  aedes: Aedes;
  abuseDetector: AbuseDetector;
  httpServer: HttpServer;
  wsServer: WebSocketServer;
  port: number;
  publishHeartbeat: () => void;
  stop: () => Promise<void>;
  healthcheckCredentials: { username: string; password: string };
}

export async function startBrokerServer(
  options?: BrokerServerOptions,
): Promise<BrokerServerRuntime> {
  const mqttConfig = loadMqttConfig();
  const abuseConfig = loadAbuseConfig();
  const subscriberConfig = loadSubscriberConfig();
  const meshcoreIoConfig = loadMeshcoreIoConfig();
  setBrokerLogContext({
    instanceId: mqttConfig.instanceId,
  });
  const log = getModuleLogger("Server");
  const brokerStartedAtMs = Date.now();

  const WS_PORT = mqttConfig.wsPort;
  const HOST = mqttConfig.host;
  const EXPECTED_AUDIENCE = mqttConfig.expectedAudience;
  const AUTH_TOKEN_MAX_AGE_SECONDS = mqttConfig.authTokenMaxAgeSeconds;
  const ALLOWED_IATA_CODES = mqttConfig.iata.allowedPrimaryIata;
  const JSON_PUBLISH_MAX_BYTES = mqttConfig.jsonPublishMaxBytes;
  const WS_MAX_PAYLOAD_BYTES = mqttConfig.wsMaxPayloadBytes;
  const NODE_NAME_CACHE_TTL_MS = mqttConfig.nodeNameCacheTtlMs;

  enum ClientType {
    SUBSCRIBER = "subscriber",
    PUBLISHER = "publisher",
  }

  enum SubscriberRole {
    ADMIN = 1,
    FULL_ACCESS = 2,
    LIMITED = 3,
  }

  function parseSubscriberRole(value: string, envName: string): SubscriberRole {
    if (!/^\d+$/.test(value)) {
      throw new Error(
        `Invalid config value ${envName}: role must be 1=admin, 2=full_access or 3=limited, got "${value}"`,
      );
    }

    const role: SubscriberRole = Number(value);
    if (
      role !== SubscriberRole.ADMIN &&
      role !== SubscriberRole.FULL_ACCESS &&
      role !== SubscriberRole.LIMITED
    ) {
      throw new Error(
        `Invalid config value ${envName}: role must be 1=admin, 2=full_access or 3=limited, got "${value}"`,
      );
    }

    return role;
  }

  function parseSubscriberMaxConnections(
    value: string,
    envName: string,
  ): number {
    if (!/^\d+$/.test(value)) {
      throw new Error(
        `Invalid config value ${envName}: maxConnections must be an integer > 0, got "${value}"`,
      );
    }

    const maxConnections = Number(value);
    if (!Number.isSafeInteger(maxConnections) || maxConnections <= 0) {
      throw new Error(
        `Invalid config value ${envName}: maxConnections must be an integer > 0, got "${value}"`,
      );
    }

    return maxConnections;
  }

  interface ParsedMeshcoreTopic {
    iata: string;
    publicKey: string;
    subtopic: string;
  }

  const subscriberUsers = new Map<string, string>();
  const subscriberRoles = new Map<string, SubscriberRole>();
  const subscriberMaxConnections = new Map<string, number>();
  const subscriberActiveConnections = new Map<string, Set<string>>();

  function subscriberConnectionCount(username: string): number {
    return subscriberActiveConnections.get(username)?.size ?? 0;
  }

  function registerSubscriberConnection(
    username: string,
    clientId: string,
    maxConnections: number,
  ): {
    allowed: boolean;
    activeConnections: number;
  } {
    const active = subscriberConnectionCount(username);
    if (active >= maxConnections) {
      return { allowed: false, activeConnections: active };
    }
    let connections = subscriberActiveConnections.get(username);
    if (!connections) {
      connections = new Set();
      subscriberActiveConnections.set(username, connections);
    }
    connections.add(clientId);
    return { allowed: true, activeConnections: active + 1 };
  }

  function releaseSubscriberConnection(
    username: string,
    clientId: string,
  ): void {
    const connections = subscriberActiveConnections.get(username);
    if (!connections) return;
    connections.delete(clientId);
    if (connections.size === 0) {
      subscriberActiveConnections.delete(username);
    }
  }

  for (const subscriber of subscriberConfig.users) {
    const username = subscriber.username;
    const password = subscriber.password;
    subscriberUsers.set(username, password);

    const role =
      subscriber.role === undefined
        ? SubscriberRole.LIMITED
        : parseSubscriberRole(
            String(subscriber.role),
            `subscribers.users.${username}.role`,
          );
    subscriberRoles.set(username, role);

    const maxConn =
      subscriber.maxConnections === undefined
        ? subscriberConfig.defaultMaxConnections
        : parseSubscriberMaxConnections(
            String(subscriber.maxConnections),
            `subscribers.users.${username}.max_connections`,
          );
    subscriberMaxConnections.set(username, maxConn);

    const roleNames = {
      [SubscriberRole.ADMIN]: "admin",
      [SubscriberRole.FULL_ACCESS]: "full access",
      [SubscriberRole.LIMITED]: "limited",
    };
    log.info(
      `Config: subscriber loaded: ${username} (role: ${roleNames[role]}, max connections: ${maxConn})`,
    );
  }

  // Fully in-memory: the broker has no volume. A per-process docker_health
  // password is generated at boot and the HEALTHCHECK authenticates with
  // healthcheck.mqtt_username + healthcheck.mqtt_password (a limited
  // subscriber from config.yaml). Tests read the credentials back from the
  // runtime object instead of a file.
  const dockerHealthCredentials = createDockerHealthCredentials();
  subscriberUsers.set(DOCKER_HEALTH_USERNAME, dockerHealthCredentials.password);
  subscriberRoles.set(DOCKER_HEALTH_USERNAME, SubscriberRole.LIMITED);
  subscriberMaxConnections.set(
    DOCKER_HEALTH_USERNAME,
    DOCKER_HEALTH_MAX_CONNECTIONS,
  );
  log.info(
    `Config: Docker healthcheck user created: ${DOCKER_HEALTH_USERNAME} (role: limited, max connections: ${DOCKER_HEALTH_MAX_CONNECTIONS}, password: generated at runtime)`,
  );

  const configuredSubscriberCount = subscriberUsers.size - 1;
  if (configuredSubscriberCount === 0) {
    log.info("Config: no subscribers configured in config.yaml");
  } else {
    log.info(
      `Config: default connection limit per subscriber: ${subscriberConfig.defaultMaxConnections}`,
    );
  }

  if (ALLOWED_IATA_CODES.length === 0) {
    log.warn(
      "Config: no allowed IATA codes found in config.yaml; all IATA ingress publishes will be denied.",
    );
  } else {
    log.info(
      `Config: IATA allowlist enabled with ${ALLOWED_IATA_CODES.length} allowed primary codes: ${ALLOWED_IATA_CODES.join(", ")}`,
    );
  }
  log.info(
    `Config: test MQTT ingress is ${mqttConfig.iata.allowTestIngress ? "enabled" : "disabled"}.`,
  );
  log.info(
    "Config: abuse detection runs observe-only; IP blocking is handled by CrowdSec/Traefik.",
  );

  const meshcoreIoRuntime = createMeshcoreIoRuntime(meshcoreIoConfig, {
    instanceId: mqttConfig.instanceId,
  });

  const deniedLogThrottle = new Map<string, number>();

  function logDeniedEvent(
    client: MeshAedesClient,
    topic: string,
    reason: string,
    iata?: string,
  ): void {
    const publicKey =
      typeof client?.publicKey === "string"
        ? client.publicKey.toUpperCase()
        : "-";
    const dedupeKey = `${publicKey}:${reason}`;
    const now = Date.now();
    const previous = deniedLogThrottle.get(dedupeKey);
    if (previous !== undefined && now - previous < 30_000) {
      return;
    }
    deniedLogThrottle.set(dedupeKey, now);
    log.info(
      `${getClientLogPrefix(client)} Denied: ${reason} -> ${topic}${iata ? ` (IATA ${iata})` : ""}`,
    );
  }

  function logAuthRejection(publicKey: string, reason: string): void {
    const dedupeKey = `${publicKey.toUpperCase()}:authentication:${reason}`;
    const now = Date.now();
    const previous = deniedLogThrottle.get(dedupeKey);
    if (previous !== undefined && now - previous < 30_000) {
      return;
    }
    deniedLogThrottle.set(dedupeKey, now);
    log.info(
      `Auth: rejected observer ${shortPublicKey(publicKey)} (${reason})`,
    );
  }

  const aedes = new Aedes({
    id: `${mqttConfig.instanceId}-${randomUUID()}`,
  });
  (
    aedes as unknown as {
      on(event: "error", listener: (error: Error) => void): void;
    }
  ).on("error", (error: Error) => {
    log.error("Aedes: runtime error:", error);
  });

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let nodeNameCleanupTimer: ReturnType<typeof setInterval> | null = null;
  const targetBridge: TargetBridgeRuntime | null = startTargetBridge();

  const retainedTopicTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const abuseDetector = new AbuseDetector(abuseConfig);
  const iataRegistry =
    options?.iataRegistry ?? new IataRegistry(mqttConfig.iata);

  const observerClients = new Map<string, MeshAedesClient>();
  let shutdownRequested = false;

  function claimObserverClient(
    publicKey: string,
    client: MeshAedesClient,
  ): void {
    const previous = observerClients.get(publicKey);
    observerClients.set(publicKey, client);
    if (previous && previous !== client) {
      log.info(
        `Observer: ersätter äldre lokal anslutning för ${shortPublicKey(publicKey)}`,
      );
      previous.close();
    }
  }

  interface CachedNodeName {
    name: string;
    updatedAt: number;
  }

  const nodeNamesByPublicKey = new Map<string, CachedNodeName>();
  // Latest accepted status timestamp per observer (stale-status guard,
  // process-local since persistence was removed). Swept by the same hourly
  // timer as the node-name cache so neither map grows without bound.
  const latestStatusAtByPublicKey = new Map<string, number>();
  const STATE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
  const MAX_OBSERVED_OBSERVERS = 50_000;
  const MAX_DENIED_LOG_KEYS = 10_000;

  function shortPublicKey(publicKey: string | undefined): string | undefined {
    return publicKey?.substring(0, 6);
  }

  function readClientNameFromStatus(message: unknown): string | undefined {
    if (
      typeof message === "object" &&
      message !== null &&
      "origin" in message
    ) {
      const origin = (message as Record<string, unknown>).origin;
      if (typeof origin === "string" && origin.trim() !== "") {
        return origin.trim();
      }
    }
    return undefined;
  }

  function rememberNodeName(
    publicKey: string,
    name: string,
    now = Date.now(),
  ): void {
    nodeNamesByPublicKey.set(publicKey.toUpperCase(), {
      name,
      updatedAt: now,
    });
  }

  function getCachedNodeName(
    publicKey: string | undefined,
    now = Date.now(),
  ): string | undefined {
    if (!publicKey) {
      return undefined;
    }

    const cacheKey = publicKey.toUpperCase();
    const cached = nodeNamesByPublicKey.get(cacheKey);
    if (!cached) {
      return undefined;
    }

    if (now - cached.updatedAt > NODE_NAME_CACHE_TTL_MS) {
      nodeNamesByPublicKey.delete(cacheKey);
      return undefined;
    }

    return cached.name;
  }

  function pruneStaleNodeNames(now = Date.now()): void {
    for (const [publicKey, cached] of nodeNamesByPublicKey) {
      if (now - cached.updatedAt > NODE_NAME_CACHE_TTL_MS) {
        nodeNamesByPublicKey.delete(publicKey);
      }
    }
  }

  /**
   * Hourly sweep for process-local observer state. The node-name cache is
   * TTL-pruned above; the stale-status guard, the denied-log throttle, and
   * the abuse observations have no natural expiry, so without this they
   * would grow by one entry per distinct observer/key forever.
   */
  function sweepProcessLocalObserverState(now = Date.now()): void {
    pruneStaleNodeNames(now);
    for (const [key, timestamp] of latestStatusAtByPublicKey) {
      if (now - timestamp > NODE_NAME_CACHE_TTL_MS) {
        latestStatusAtByPublicKey.delete(key);
      }
    }
    while (latestStatusAtByPublicKey.size > MAX_OBSERVED_OBSERVERS) {
      const oldest = latestStatusAtByPublicKey.keys().next();
      if (oldest.done) break;
      latestStatusAtByPublicKey.delete(oldest.value);
    }
    while (deniedLogThrottle.size > MAX_DENIED_LOG_KEYS) {
      const oldest = deniedLogThrottle.keys().next();
      if (oldest.done) break;
      deniedLogThrottle.delete(oldest.value);
    }
    abuseDetector.sweepInactiveClients();
  }

  function rememberClientNameFromMessage(
    client: MeshAedesClient,
    subtopic: string,
    message: unknown,
  ): void {
    if (subtopic === "status") {
      const origin = readClientNameFromStatus(message);
      if (origin) {
        client.nodeName = origin;
        if (client.publicKey) {
          rememberNodeName(client.publicKey, origin);
          abuseDetector.rememberClientName(client.publicKey, origin);
        }
      }
    }
  }

  function acceptStatusTimestamp(
    publicKey: string,
    message: unknown,
    logPrefix: string,
  ): boolean {
    if (
      typeof message !== "object" ||
      message === null ||
      !("timestamp" in message)
    ) {
      return true;
    }

    const raw = (message as Record<string, unknown>).timestamp;
    if (!raw) {
      return true;
    }

    const timestamp = new Date(raw as string | number).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return true;
    }

    const key = publicKey.toUpperCase();
    const latest = latestStatusAtByPublicKey.get(key);
    if (latest !== undefined && timestamp < latest) {
      log.info(
        `${logPrefix} Status: rejecting stale status message for ${shortPublicKey(publicKey)} (${new Date(timestamp).toISOString()})`,
      );
      return false;
    }
    latestStatusAtByPublicKey.set(key, timestamp);
    return true;
  }

  function getUsefulClientId(client: MeshAedesClient): string | undefined {
    const id = typeof client?.id === "string" ? client.id.trim() : "";
    if (!id || id.startsWith("aedes_") || id.length > 32) {
      return undefined;
    }

    return id;
  }

  function describeClient(client: MeshAedesClient): string {
    if (!client) {
      return "unknown client";
    }

    const clientType = client.clientType;
    if (clientType === ClientType.PUBLISHER && client.publicKey) {
      const shortKey = shortPublicKey(client.publicKey);
      const nodeName = client.nodeName || getCachedNodeName(client.publicKey);
      return `${nodeName || getUsefulClientId(client) || "unknown client"} (${shortKey})`;
    }

    if (clientType === ClientType.SUBSCRIBER && client.username) {
      return client.username;
    }

    return client.id
      ? `unauthenticated client ${client.id}`
      : "unauthenticated client";
  }

  function getClientLogPrefix(client: MeshAedesClient): string {
    return `[${describeClient(client)}]`;
  }

  function logEvent(category: string, message: string): void {
    log.info(`${category}: ${message}`);
  }

  function errorEvent(
    category: string,
    message: string,
    error?: unknown,
  ): void {
    if (error === undefined) {
      log.error(`${category}: ${message}`);
    } else {
      log.error(`${category}: ${message}`, error);
    }
  }

  interface WebSocketStreamMeta {
    authenticated?: boolean;
    transportClosed?: boolean;
  }

  type AuthenticationCallback = Parameters<
    NonNullable<Aedes["authenticate"]>
  >[3];

  function getClientStreamMeta(client: MeshAedesClient): WebSocketStreamMeta {
    return client.conn as unknown as WebSocketStreamMeta;
  }

  // Grace period to flush a broker-originated error notification before the
  // transport is closed. QoS 0 observers never see a PUBACK, so without this
  // the close below can truncate the error publish on the same connection.
  const ERROR_NOTIFY_FLUSH_MS = 400;

  function publishErrorNotification(
    code: ObserverErrorCode,
    message: string,
    context: { topic?: string; iata?: string },
    publicKey: string,
    iataHint?: string,
  ): Promise<void> {
    const iata =
      context.iata && /^[A-Z]{3}$/.test(context.iata)
        ? context.iata
        : iataHint && /^[A-Z]{3}$/.test(iataHint)
          ? iataHint
          : "XXX";
    const topic = `meshcore/${iata}/${publicKey}/error`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), ERROR_NOTIFY_FLUSH_MS);
      // `.unref?.()` keeps tests and shutdown from hanging on the timer.
      (timer as unknown as { unref?: () => void }).unref?.();
      aedes.publish(
        {
          cmd: "publish" as const,
          topic,
          payload: Buffer.from(
            JSON.stringify({
              code,
              message,
              ...(context.topic ? { topic: context.topic } : {}),
              ...(context.iata ? { iata: context.iata } : {}),
              at: new Date().toISOString(),
            }),
          ),
          qos: 0 as const,
          dup: false,
          retain: false,
        },
        (err) => {
          clearTimeout(timer);
          if (err) {
            log.error(
              `ErrorNotify: could not deliver [${code}] to ${topic}:`,
              err,
            );
          }
          resolve();
        },
      );
    });
  }

  /**
   * Notify the observer client about a denial with a machine-readable code
   * before the transport closes. MQTT 3.1.1 has no server-initiated reason
   * string on CONNACK (only returnCode) and no negative PUBACK, so the only
   * channel that reaches a QoS 0 observer is a broker-originated publish to
   * that observer's own error topic, sent on the same connection before it
   * is closed. Awaiting the publish (bounded by ERROR_NOTIFY_FLUSH_MS) is
   * what makes delivery reliable instead of best-effort.
   *
   * Error topics are broker-owned: observers must SUBSCRIBE
   * meshcore/<IATA>/<OWN_KEY>/error to receive them; the broker never
   * accepts publishes to them. When the denial itself carries no usable
   * IATA (malformed topic, bad key, pre-auth failure), the notification
   * falls back to the XXX topic; observers that fail this early should
   * therefore also subscribe to meshcore/XXX/<OWN_KEY>/error until the
   * first successful publish tells them the working IATA.
   */
  function notifyObserverError(
    client: MeshAedesClient,
    code: ObserverErrorCode,
    message: string,
    context: { topic?: string; iata?: string } = {},
  ): Promise<void> {
    const publicKey = client.publicKey?.toUpperCase();
    if (!publicKey || !/^[0-9A-F]{64}$/.test(publicKey))
      return Promise.resolve();
    // Prefer the IATA the observer actually used, when it is recoverable
    // from the denied topic, so the notification lands where the observer
    // is subscribed even if the IATA itself was rejected.
    const topicIata = extractTopicIata(context.topic);
    const iataHint = context.iata ?? topicIata;
    return publishErrorNotification(
      code,
      message,
      context,
      publicKey,
      iataHint,
    );
  }

  /** Best-effort IATA recovery from a denied topic for error routing. */
  function extractTopicIata(topic: string | undefined): string | undefined {
    if (!topic) return undefined;
    const parts = topic.split("/");
    if (parts[0] !== "meshcore" || parts.length < 3) return undefined;
    const candidate = parts[1].trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(candidate)) return candidate;
    // Lowercase IATA is normalized elsewhere; route its errors to the same
    // uppercase topic the observer subscribes to.
    if (/^[a-z]{3}$/.test(parts[1].trim())) return candidate;
    if (parts[1].trim().toLowerCase() === "test") return "test";
    return undefined;
  }

  function isClientTransportOpen(client: MeshAedesClient): boolean {
    const stream = client.conn as unknown as
      (WebSocketStreamMeta & { destroyed?: boolean }) | undefined;
    return Boolean(
      stream && stream.transportClosed !== true && stream.destroyed !== true,
    );
  }

  function completeAuthentication(
    client: MeshAedesClient,
    callback: AuthenticationCallback,
    authenticated: boolean,
  ): boolean {
    if (!isClientTransportOpen(client)) {
      log.debug(
        `${getClientLogPrefix(client)} Auth: transport closed before authentication result could be delivered`,
      );
      return false;
    }

    callback(null, authenticated);
    return true;
  }

  function rejectInvalidAuthentication(
    client: MeshAedesClient,
    callback: AuthenticationCallback,
    code: ObserverErrorCode,
    message: string,
  ): void {
    // No IP blocking: CrowdSec/Traefik in front of the broker handles that.
    // The code travels in the Error message; Aedes maps it to CONNACK
    // returnCode 5 ("not authorized", MQTT-3.1.1 §3.2.2.3) and closes the
    // connection, so firmware sees CONNACK 5 + "[CODE] detail".
    // AuthenticateError requires returnCode; 5 = NOT_AUTHORIZED fits every
    // credential/policy denial (codes 1-2 are protocol/client-id, 3 is
    // server-unavailable, 4 is bad-username-or-password-for-MQTT-users).
    if (!isClientTransportOpen(client)) {
      log.debug(
        `${getClientLogPrefix(client)} Auth: transport closed before rejection [${code}] could be delivered`,
      );
      return;
    }
    const error = observerError(
      code,
      message || "Authentication failed",
    ) as Error & { returnCode: 5 };
    error.returnCode = 5;
    callback(error, false);
  }

  function markAuthenticationSucceeded(client: MeshAedesClient): void {
    const streamMeta = getClientStreamMeta(client);
    streamMeta.authenticated = true;
  }

  function websocketMessageByteLength(
    data: Buffer | ArrayBuffer | Buffer[],
  ): number {
    if (Buffer.isBuffer(data)) {
      return data.length;
    }

    if (Array.isArray(data)) {
      return data.reduce((total, chunk) => total + chunk.length, 0);
    }

    return data.byteLength;
  }

  function observePublishForAbuse(
    client: MeshAedesClient,
    packet: PublishPacket,
    normalizedIata: string,
  ): void {
    const publicKey = client.publicKey!;
    const trustState = abuseDetector.getClientStats(publicKey);
    if (!trustState) {
      return;
    }
    abuseDetector.checkIataChange(trustState, normalizedIata);
    abuseDetector.recordPacket(client, packet);
  }

  function parseMeshcoreTopic(topic: string): ParsedMeshcoreTopic | null {
    const parts = topic.split("/");

    if (
      parts.some(
        (part) =>
          part.trim() === "" || part.includes("+") || part.includes("#"),
      )
    ) {
      return null;
    }

    if (parts[0] !== "meshcore" || parts.length < 4) {
      return null;
    }

    const rawIata = parts[1].trim();
    const publicKey = parts[2].toUpperCase();
    const subtopic = parts.slice(3).join("/");
    if (!/^[0-9A-F]{64}$/.test(publicKey)) {
      return null;
    }

    // IATA is case-insensitive on the wire ("arn" == "ARN", "xxx" == "XXX",
    // "TEST" == "test"); the registry is case-insensitive too. Normalize
    // here so lowercase observers are routed to the real error topic and
    // get the semantically right denial instead of a format rejection.
    const iata =
      rawIata.toLowerCase() === "test" ? "test" : rawIata.toUpperCase();

    return {
      iata,
      publicKey,
      subtopic,
    };
  }

  function isPrivateMeshcoreTopic(topic: string): boolean {
    const parts = topic.split("/");
    if (parts[0] !== "meshcore" || parts.length < 4) {
      return false;
    }

    const root = parts[3].toLowerCase();
    return root === "internal" || root === "serial";
  }

  /** meshcore/<iata|test>/<observer>/... — test ingress is never uploaded. */
  function isTestIngressTopic(topic: string): boolean {
    const parts = topic.split("/");
    return (
      parts[0] === "meshcore" &&
      parts.length >= 4 &&
      parts[1].toLowerCase() === "test"
    );
  }

  /** meshcore/<IATA>/<64-hex-key>/error — broker-owned denial channel. */
  function isObserverErrorPacket(packet: { topic: string }): boolean {
    const parts = packet.topic.split("/");
    return (
      parts.length === 4 &&
      parts[0] === "meshcore" &&
      parts[3] === "error" &&
      /^[0-9A-Fa-f]{64}$/.test(parts[2])
    );
  }

  function ownsObserverErrorPacket(
    packet: { topic: string },
    client: MeshAedesClient,
  ): boolean {
    const ownerKey =
      client.clientType === ClientType.PUBLISHER
        ? client.publicKey?.toUpperCase()
        : undefined;
    if (!ownerKey) return false;
    if (observerClients.get(ownerKey) === client) {
      return packet.topic.split("/")[2].toUpperCase() === ownerKey;
    }
    // A replaced connection owns nothing except its own error notice.
    return isObserverErrorTopic(packet.topic, client);
  }

  function isIataAllowedForObserver(iata: string): boolean {
    if (iata === "test") return mqttConfig.iata.allowTestIngress;
    return iataRegistry.isAllowedIata(iata);
  }

  function getIataDenialText(
    iata: string,
  ): { reason: string; deniedUntilText?: string } | null {
    const normalized = iata.toUpperCase();
    if (!iataRegistry.isSecondaryIata(normalized)) return null;
    const primary = iataRegistry.getPrimaryIata(normalized);
    return primary
      ? {
          reason: "Wrong IATA code",
          deniedUntilText: `Use primary IATA ${primary} for ${normalized}`,
        }
      : { reason: "Wrong IATA code" };
  }

  function registerObserverClient(
    publicKey: string,
    client: MeshAedesClient,
    logPrefix: string,
  ): boolean {
    if (shutdownRequested) {
      log.info(
        `${logPrefix} Observer: denying new connection for ${shortPublicKey(publicKey)} because broker is shutting down`,
      );
      return false;
    }

    if (shutdownRequested || !isClientTransportOpen(client)) {
      return false;
    }
    claimObserverClient(publicKey, client);
    return true;
  }

  function ownsObserverClient(
    publicKey: string,
    client: MeshAedesClient,
    logPrefix: string,
  ): boolean {
    if (observerClients.get(publicKey) !== client) {
      log.info(
        `${logPrefix} Observer: publicering nekad eftersom en nyare lokal anslutning äger ${shortPublicKey(publicKey)}`,
      );
      return false;
    }
    return true;
  }

  aedes.authenticate = (
    client: MeshAedesClient,
    username,
    password,
    callback,
  ) => {
    void (async () => {
      let observerPublicKey: string | undefined;
      logEvent(
        "Auth",
        `authentication attempt from ${describeClient(client)} - username: ${username}`,
      );

      try {
        const usernameStr = username?.toString() || "";
        const passwordStr = password?.toString() || "";

        if (subscriberUsers.has(usernameStr)) {
          const expectedPassword = subscriberUsers.get(usernameStr);
          if (passwordStr !== expectedPassword) {
            const message = `subscriber ${usernameStr} authentication failed. invalid password.`;
            logEvent("Auth", message);
            rejectInvalidAuthentication(
              client,
              callback,
              OBSERVER_ERROR_CODES.AUTH_INVALID_PASSWORD,
              message,
            );
            return;
          }

          const maxConn =
            subscriberMaxConnections.get(usernameStr) ||
            subscriberConfig.defaultMaxConnections;
          const registration = registerSubscriberConnection(
            usernameStr,
            client.id,
            maxConn,
          );

          if (!isClientTransportOpen(client)) {
            if (registration.allowed) {
              releaseSubscriberConnection(usernameStr, client.id);
            }
            return;
          }

          if (!registration.allowed) {
            const message = `subscriber connection limit exceeded for ${usernameStr} (${registration.activeConnections}/${maxConn}). denying.`;
            logEvent("Auth", message);
            rejectInvalidAuthentication(
              client,
              callback,
              OBSERVER_ERROR_CODES.SUBSCRIBER_CONNECTION_LIMIT,
              message,
            );
            return;
          }

          const role =
            subscriberRoles.get(usernameStr) || SubscriberRole.LIMITED;
          client.clientType = ClientType.SUBSCRIBER;
          client.username = usernameStr;
          client.role = role;
          if (!isClientTransportOpen(client)) {
            releaseSubscriberConnection(usernameStr, client.id);
            completeAuthentication(client, callback, false);
            return;
          }
          markAuthenticationSucceeded(client);
          logEvent(
            "Auth",
            `subscriber ${describeClient(client)} authenticated (role: ${role}, connections: ${registration.activeConnections}/${maxConn}).`,
          );

          completeAuthentication(client, callback, true);
          return;
        }

        if (!usernameStr.startsWith("v1_")) {
          const message = `invalid username format from ${describeClient(client)}: ${usernameStr}. denying.`;
          logEvent("Auth", message);
          rejectInvalidAuthentication(
            client,
            callback,
            OBSERVER_ERROR_CODES.AUTH_INVALID_USERNAME_FORMAT,
            `Username must be v1_<64-hex-public-key>, got "${usernameStr}".`,
          );
          return;
        }

        const publicKey = usernameStr.substring(3).toUpperCase().trim();

        if (!/^[0-9A-F]{64}$/i.test(publicKey)) {
          logEvent(
            "Auth",
            `invalid public key format from ${describeClient(client)}: ${publicKey}. denying.`,
          );
          logEvent(
            "Auth",
            `public key length: ${publicKey.length}, hex dump: ${Buffer.from(publicKey).toString("hex")}.`,
          );
          rejectInvalidAuthentication(
            client,
            callback,
            OBSERVER_ERROR_CODES.AUTH_INVALID_PUBLIC_KEY,
            `Username public key must be 64 hex characters, got length ${publicKey.length}.`,
          );
          return;
        }
        observerPublicKey = publicKey;

        if (!passwordStr || passwordStr.length === 0) {
          const message = `no password provided from ${describeClient(client)}. denying.`;
          logEvent("Auth", message);
          client.publicKey = publicKey;
          void notifyObserverError(
            client,
            OBSERVER_ERROR_CODES.AUTH_MISSING_TOKEN,
            "Missing auth token: password must be a signed JWT for this public key.",
          );
          logAuthRejection(publicKey, "missing_password");
          rejectInvalidAuthentication(
            client,
            callback,
            OBSERVER_ERROR_CODES.AUTH_MISSING_TOKEN,
            "Missing auth token: password must be a signed JWT for this public key.",
          );
          return;
        }

        let tokenPayload: Awaited<ReturnType<typeof verifyAuthToken>>;
        try {
          tokenPayload = await verifyAuthToken(passwordStr, publicKey);
        } catch (error) {
          const message = `invalid token for unknown client (${shortPublicKey(publicKey)}). denying.`;
          logEvent("Auth", message);
          log.debug(`Auth: token verification error for ${publicKey}:`, error);
          client.publicKey = publicKey;
          void notifyObserverError(
            client,
            OBSERVER_ERROR_CODES.AUTH_INVALID_TOKEN,
            "Auth token signature invalid for this public key.",
          );
          logAuthRejection(publicKey, "invalid_token");
          rejectInvalidAuthentication(
            client,
            callback,
            OBSERVER_ERROR_CODES.AUTH_INVALID_TOKEN,
            "Auth token signature invalid for this public key.",
          );
          return;
        }

        if (!tokenPayload) {
          const message = `invalid token signature for unknown client (${shortPublicKey(publicKey)}). denying.`;
          logEvent("Auth", message);
          log.debug(`Auth: public key: ${publicKey}`);
          client.publicKey = publicKey;
          void notifyObserverError(
            client,
            OBSERVER_ERROR_CODES.AUTH_INVALID_TOKEN,
            "Auth token signature invalid for this public key.",
          );
          logAuthRejection(publicKey, "invalid_token");
          rejectInvalidAuthentication(
            client,
            callback,
            OBSERVER_ERROR_CODES.AUTH_INVALID_TOKEN,
            "Auth token signature invalid for this public key.",
          );
          return;
        }

        if (EXPECTED_AUDIENCE && tokenPayload.aud !== EXPECTED_AUDIENCE) {
          const message = `invalid audience for unknown client (${shortPublicKey(publicKey)}): ${tokenPayload.aud} (expected: ${EXPECTED_AUDIENCE}). denying.`;
          logEvent("Auth", message);
          client.publicKey = publicKey;
          void notifyObserverError(
            client,
            OBSERVER_ERROR_CODES.AUTH_WRONG_AUDIENCE,
            `Token audience "${tokenPayload.aud}" does not match broker audience "${EXPECTED_AUDIENCE}". Re-issue the token for the broker audience.`,
          );
          logAuthRejection(publicKey, "wrong_audience");
          rejectInvalidAuthentication(
            client,
            callback,
            OBSERVER_ERROR_CODES.AUTH_WRONG_AUDIENCE,
            `Token audience "${tokenPayload.aud}" does not match broker audience "${EXPECTED_AUDIENCE}".`,
          );
          return;
        }

        if (AUTH_TOKEN_MAX_AGE_SECONDS > 0) {
          const issuedAt =
            typeof tokenPayload.iat === "number" ? tokenPayload.iat : NaN;
          const expiresAt =
            typeof tokenPayload.exp === "number" ? tokenPayload.exp : NaN;
          const nowSeconds = Math.floor(Date.now() / 1000);
          const tooOld =
            !Number.isFinite(issuedAt) ||
            nowSeconds - issuedAt > AUTH_TOKEN_MAX_AGE_SECONDS;
          const expired = Number.isFinite(expiresAt) && nowSeconds > expiresAt;
          if (tooOld || expired) {
            const message = `stale token for unknown client (${shortPublicKey(publicKey)}). denying.`;
            logEvent("Auth", message);
            client.publicKey = publicKey;
            void notifyObserverError(
              client,
              OBSERVER_ERROR_CODES.AUTH_STALE_TOKEN,
              "Auth token is expired or older than the broker max age. Re-issue a fresh token.",
            );
            logAuthRejection(publicKey, "stale_token");
            rejectInvalidAuthentication(
              client,
              callback,
              OBSERVER_ERROR_CODES.AUTH_STALE_TOKEN,
              "Auth token is expired or older than the broker max age.",
            );
            return;
          }
        }

        if (!isClientTransportOpen(client)) {
          return;
        }

        client.publicKey = publicKey;
        client.nodeName = getCachedNodeName(publicKey);
        client.tokenPayload = tokenPayload;

        const authLogPrefix = `[${client.nodeName || getUsefulClientId(client) || "unknown client"} (${shortPublicKey(publicKey)})]`;
        if (!registerObserverClient(publicKey, client, authLogPrefix)) {
          const message = `publisher ${describeClient(client)} denied because broker is shutting down.`;
          logEvent("Auth", message);
          void notifyObserverError(
            client,
            OBSERVER_ERROR_CODES.AUTH_SHUTTING_DOWN,
            "Broker is shutting down; retry after restart.",
          );
          logAuthRejection(publicKey, "observer_claim_unavailable");
          rejectInvalidAuthentication(
            client,
            callback,
            OBSERVER_ERROR_CODES.AUTH_SHUTTING_DOWN,
            "Broker is shutting down; retry after restart.",
          );
          return;
        }

        if (!isClientTransportOpen(client)) {
          if (observerClients.get(publicKey) === client) {
            observerClients.delete(publicKey);
          }
          return;
        }

        client.clientType = ClientType.PUBLISHER;

        abuseDetector.initializeClient(
          publicKey,
          client.nodeName || `v1_${publicKey}`,
        );
        markAuthenticationSucceeded(client);
        logEvent(
          "Auth",
          `publisher ${describeClient(client)} authenticated and claimed${tokenPayload.aud ? ` (audience: ${tokenPayload.aud})` : ""}.`,
        );

        completeAuthentication(client, callback, true);
      } catch (error) {
        errorEvent(
          "Auth",
          `error during authentication for ${describeClient(client)}:`,
          error,
        );
        if (observerPublicKey) {
          logAuthRejection(observerPublicKey, "authentication_error");
          client.publicKey ??= observerPublicKey;
          void notifyObserverError(
            client,
            OBSERVER_ERROR_CODES.AUTH_INTERNAL_ERROR,
            "Internal authentication error; retry, and contact the operator if it persists.",
          );
        }
        rejectInvalidAuthentication(
          client,
          callback,
          OBSERVER_ERROR_CODES.AUTH_INTERNAL_ERROR,
          "Internal authentication error; retry.",
        );
      }
    })();
  };

  /**
   * Deny a publish with a machine-readable code. The error message carries
   * `[CODE] detail` so QoS 1 observers can match on it; the same code is
   * also pushed to the observer's own `meshcore/<IATA>/<KEY>/error` topic
   * on this connection and awaited (bounded) before any close, which is the
   * only channel a QoS 0 observer is guaranteed to see. Error topics are
   * broker-owned: observers must SUBSCRIBE meshcore/<IATA>/<OWN_KEY>/error
   * to receive them; the topic accepts no publishes.
   */
  function denyPublish(
    client: MeshAedesClient,
    callback: (error: Error | null) => void,
    code: ObserverErrorCode,
    message: string,
    context: { topic: string; iata?: string; close?: boolean },
  ): void {
    log.info(
      `${getClientLogPrefix(client)} Authorization: publish denied -> ${context.topic} (${code})`,
    );
    logDeniedEvent(client, context.topic, `${code}: ${message}`, context.iata);
    void notifyObserverError(client, code, message, context).then(() => {
      callback(observerError(code, message));
      if (context.close) {
        client.close();
      }
    });
  }

  aedes.authorizePublish = (client, packet, done) => {
    const callback: typeof done = (error) => {
      done(error);
    };
    void (async () => {
      if (!client) {
        const quarantined = quarantineOrphanedWill(
          packet,
          mqttConfig.instanceId,
        );
        log.warn(
          `Authorization: discarded orphaned Last Will without authenticated client -> ${quarantined.originalTopic}` +
            `${quarantined.clientId ? ` (clientId: ${quarantined.clientId})` : ""}` +
            `${quarantined.brokerId ? ` (origin broker: ${quarantined.brokerId})` : ""}`,
        );
        callback(null);
        return;
      }

      const mc = client as MeshAedesClient;
      const logPrefix = getClientLogPrefix(mc);
      const clientType = mc.clientType;
      const observerPublicKey =
        clientType === ClientType.PUBLISHER
          ? mc.publicKey?.toUpperCase()
          : undefined;
      if (observerPublicKey && observerClients.get(observerPublicKey) !== mc) {
        denyPublish(
          client,
          callback,
          OBSERVER_ERROR_CODES.PUBLISH_STALE_CONNECTION,
          "A newer connection owns this observer public key. Reconnect to take over.",
          { topic: packet.topic, close: true },
        );
        return;
      }

      try {
        if (packet.retain) {
          log.debug(
            `${logPrefix} Authorization: dropping MQTT retain flag -> ${packet.topic}`,
          );
          packet.retain = false;
        }

        if (isRetainedSubtopic(packet.topic)) {
          packet.retain = true;
        }

        if (clientType === ClientType.SUBSCRIBER) {
          const role: SubscriberRole = mc.role || SubscriberRole.LIMITED;
          const username = mc.username;

          if (
            username === DOCKER_HEALTH_USERNAME &&
            packet.topic === HEALTHCHECK_TOPIC
          ) {
            if (packet.payload.length > HEALTHCHECK_MAX_PAYLOAD_BYTES) {
              denyPublish(
                client,
                callback,
                OBSERVER_ERROR_CODES.PUBLISH_PAYLOAD_TOO_LARGE,
                `Healthcheck loopback payload of ${packet.payload.length} bytes exceeds ${HEALTHCHECK_MAX_PAYLOAD_BYTES} bytes.`,
                { topic: packet.topic },
              );
              return;
            }

            log.info(
              `${logPrefix} Authorization: healthcheck loopback approved -> ${packet.topic}`,
            );
            callback(null);
            return;
          }

          if (
            role === SubscriberRole.ADMIN &&
            packet.topic.endsWith("/serial/commands")
          ) {
            const parsed = parseMeshcoreTopic(packet.topic);
            if (packet.payload.length > SERIAL_COMMAND_MAX_BYTES) {
              denyPublish(
                client,
                callback,
                OBSERVER_ERROR_CODES.PUBLISH_PAYLOAD_TOO_LARGE,
                `serial/commands payload of ${packet.payload.length} bytes exceeds ${SERIAL_COMMAND_MAX_BYTES} bytes.`,
                { topic: packet.topic },
              );
              return;
            }

            if (parsed?.subtopic === "serial/commands") {
              log.info(
                `${logPrefix} Authorization: serial admin command approved -> ${packet.topic}`,
              );
              callback(null);
              return;
            }

            denyPublish(
              client,
              callback,
              OBSERVER_ERROR_CODES.PUBLISH_BAD_TOPIC_SHAPE,
              "serial/commands topic must be meshcore/<IATA>/<PUBKEY>/serial/commands.",
              { topic: packet.topic },
            );
            return;
          }

          denyPublish(
            client,
            callback,
            OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
            "Subscriber clients are subscribe-only.",
            { topic: packet.topic },
          );
          return;
        }

        if (clientType === ClientType.PUBLISHER) {
          if (!packet.topic.startsWith("meshcore/")) {
            denyPublish(
              client,
              callback,
              OBSERVER_ERROR_CODES.PUBLISH_NOT_MESHCORE_TOPIC,
              "Publishers can only publish to meshcore/<IATA>/<PUBKEY>/<subtopic>.",
              { topic: packet.topic },
            );
            return;
          }

          const parsedTopic = parseMeshcoreTopic(packet.topic);
          if (!parsedTopic) {
            denyPublish(
              client,
              callback,
              OBSERVER_ERROR_CODES.PUBLISH_BAD_TOPIC_SHAPE,
              "Topic must be meshcore/<IATA>/<64-hex-PUBKEY>/<subtopic> without empty segments or wildcards.",
              { topic: packet.topic },
            );
            return;
          }

          const iataCode = parsedTopic.iata;
          const iataRegex = /^[A-Z]{3}$/;

          if (iataCode === "XXX") {
            log.info(
              `${logPrefix} Disconnect: closing client - invalid location code: XXX`,
            );
            log.info(`${logPrefix} Disconnect: full topic: "${packet.topic}"`);
            denyPublish(
              client,
              callback,
              OBSERVER_ERROR_CODES.PUBLISH_PLACEHOLDER_IATA,
              "XXX is a placeholder - configure the observer's actual three-letter IATA location code in the observer settings.",
              { topic: packet.topic, iata: iataCode, close: true },
            );
            return;
          }

          const isTestIngress = iataCode === "test";

          if (isTestIngress) {
            if (!isIataAllowedForObserver(iataCode)) {
              denyPublish(
                client,
                callback,
                OBSERVER_ERROR_CODES.PUBLISH_TEST_INGRESS_DISABLED,
                "Test MQTT ingress is disabled on this broker.",
                { topic: packet.topic },
              );
              return;
            }
            log.info(`${logPrefix} Authorization: using test MQTT ingress`);
          } else {
            if (!iataRegex.test(iataCode)) {
              log.info(
                `${logPrefix} Disconnect: closing client - invalid location format`,
              );
              log.info(
                `${logPrefix} Disconnect: IATA code: "${iataCode}" (length: ${iataCode.length})`,
              );
              log.info(
                `${logPrefix} Disconnect: IATA code hex: ${Buffer.from(iataCode).toString("hex")}`,
              );
              log.info(
                `${logPrefix} Disconnect: full topic: "${packet.topic}"`,
              );
              denyPublish(
                client,
                callback,
                OBSERVER_ERROR_CODES.PUBLISH_INVALID_IATA_FORMAT,
                `IATA ingress must be exactly three uppercase letters, got "${iataCode}". Set the observer IATA to an allowed code.`,
                { topic: packet.topic, iata: iataCode, close: true },
              );
              return;
            }

            const normalizedIata = iataCode.toUpperCase();
            if (!isIataAllowedForObserver(normalizedIata)) {
              const denialInfo = getIataDenialText(normalizedIata);
              if (denialInfo) {
                denyPublish(
                  client,
                  callback,
                  OBSERVER_ERROR_CODES.PUBLISH_SECONDARY_IATA,
                  denialInfo.deniedUntilText ??
                    `IATA ${normalizedIata} is a secondary code; publish under its primary code.`,
                  { topic: packet.topic, iata: normalizedIata },
                );
                return;
              }
              const allowedList =
                ALLOWED_IATA_CODES.length > 0
                  ? ALLOWED_IATA_CODES.join(", ")
                  : "empty list";
              log.info(
                `${logPrefix} Authorization: publish denied -> ${packet.topic} (IATA ${normalizedIata} missing from allowlist: ${allowedList})`,
              );
              denyPublish(
                client,
                callback,
                OBSERVER_ERROR_CODES.PUBLISH_UNKNOWN_IATA,
                `IATA ${normalizedIata} is not allowed on this broker (allowed: ${allowedList}). Set the observer IATA to a listed code.`,
                { topic: packet.topic, iata: normalizedIata },
              );
              return;
            }
          }

          const topicPublicKey = parsedTopic.publicKey;

          const clientPublicKey = mc.publicKey!.toUpperCase();
          if (topicPublicKey !== clientPublicKey) {
            log.info(
              `${logPrefix} Disconnect: closing client - public key mismatch`,
            );
            log.info(
              `${logPrefix} Disconnect: public key in topic:  "${topicPublicKey}"`,
            );
            log.info(
              `${logPrefix} Disconnect: client public key: "${clientPublicKey}"`,
            );
            log.info(`${logPrefix} Disconnect: full topic: "${packet.topic}"`);
            denyPublish(
              client,
              callback,
              OBSERVER_ERROR_CODES.PUBLISH_KEY_MISMATCH,
              "Public key in topic must match the authenticated public key.",
              { topic: packet.topic, close: true },
            );
            return;
          }

          if (!ownsObserverClient(clientPublicKey, client, logPrefix)) {
            denyPublish(
              client,
              callback,
              OBSERVER_ERROR_CODES.PUBLISH_STALE_CONNECTION,
              "A newer connection owns this observer public key. Reconnect to take over.",
              { topic: packet.topic, close: true },
            );
            return;
          }

          const normalizedIata = isTestIngress
            ? "test"
            : iataCode.toUpperCase();
          const normalizedTopic = `meshcore/${normalizedIata}/${clientPublicKey}/${parsedTopic.subtopic}`;

          if (packet.topic !== normalizedTopic) {
            log.info(
              `${logPrefix} Authorization: normalized topic: ${packet.topic} -> ${normalizedTopic}`,
            );
            packet.topic = normalizedTopic;
          }

          const subtopic = parsedTopic.subtopic;
          const subtopicRoot = subtopic.split("/")[0];

          if (subtopic === "error" || subtopic.startsWith("error/")) {
            denyPublish(
              client,
              callback,
              OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
              "error is a broker-owned subtopic: subscribe to receive denial codes, do not publish.",
              { topic: packet.topic, iata: normalizedIata },
            );
            return;
          }

          if (subtopicRoot === "internal") {
            denyPublish(
              client,
              callback,
              OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
              "internal is a broker-owned subtopic.",
              { topic: packet.topic, iata: normalizedIata },
            );
            return;
          }

          if (subtopic === "serial/commands") {
            denyPublish(
              client,
              callback,
              OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
              "serial/commands is admin-only.",
              { topic: packet.topic, iata: normalizedIata },
            );
            return;
          }

          if (subtopicRoot === "serial" && subtopic !== "serial/responses") {
            denyPublish(
              client,
              callback,
              OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
              `Publisher serial subtopic is reserved: ${subtopic}.`,
              { topic: packet.topic, iata: normalizedIata },
            );
            return;
          }

          if (subtopic === "serial/responses") {
            if (packet.payload.length > SERIAL_RESPONSE_MAX_BYTES) {
              denyPublish(
                client,
                callback,
                OBSERVER_ERROR_CODES.PUBLISH_PAYLOAD_TOO_LARGE,
                `serial/responses payload of ${packet.payload.length} bytes exceeds ${SERIAL_RESPONSE_MAX_BYTES} bytes.`,
                { topic: packet.topic, iata: normalizedIata },
              );
              return;
            }

            const payload = packet.payload.toString("utf-8");
            const jwtParts = payload.split(".");
            if (jwtParts.length !== 3) {
              denyPublish(
                client,
                callback,
                OBSERVER_ERROR_CODES.PUBLISH_SERIAL_RESPONSE_INVALID,
                "serial/responses payload must be a JWT-shaped payload (header.payload.signature).",
                { topic: packet.topic, iata: normalizedIata },
              );
              return;
            }
            const base64urlRegex = /^[A-Za-z0-9_-]+$/;
            if (!jwtParts.every((part) => base64urlRegex.test(part))) {
              denyPublish(
                client,
                callback,
                OBSERVER_ERROR_CODES.PUBLISH_SERIAL_RESPONSE_INVALID,
                "serial/responses payload must be base64url JWT parts.",
                { topic: packet.topic, iata: normalizedIata },
              );
              return;
            }

            observePublishForAbuse(client, packet, normalizedIata);
            log.info(
              `${logPrefix} Authorization: publish approved (serial response) -> ${packet.topic}`,
            );
            callback(null);
            return;
          }

          try {
            if (subtopic === "raw") {
              denyPublish(
                client,
                callback,
                OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
                "The raw MQTT subtopic is not supported; publish raw MeshCore bytes inside /packets JSON.",
                { topic: packet.topic, iata: normalizedIata },
              );
              return;
            }

            const jsonPublishLimit = jsonPublishLimitForSubtopic(
              JSON_PUBLISH_MAX_BYTES,
              subtopic,
            );
            if (packet.payload.length > jsonPublishLimit) {
              denyPublish(
                client,
                callback,
                OBSERVER_ERROR_CODES.PUBLISH_PAYLOAD_TOO_LARGE,
                `JSON publish of ${packet.payload.length} bytes exceeds ${jsonPublishLimit} bytes for ${subtopic}.`,
                { topic: packet.topic, iata: normalizedIata },
              );
              return;
            }

            const payload = packet.payload.toString("utf-8");
            const message = JSON.parse(payload) as Record<string, unknown>;

            if (!message.origin_id) {
              denyPublish(
                client,
                callback,
                OBSERVER_ERROR_CODES.PUBLISH_ORIGIN_MISSING,
                "Message must contain origin_id matching the authenticated public key.",
                { topic: packet.topic, iata: normalizedIata },
              );
              return;
            }

            const messageOriginId = (message.origin_id as string).toUpperCase();
            const normalizedClientKey = clientPublicKey.toUpperCase();

            if (messageOriginId !== normalizedClientKey) {
              denyPublish(
                client,
                callback,
                OBSERVER_ERROR_CODES.PUBLISH_ORIGIN_MISMATCH,
                "origin_id must match the authenticated public key.",
                { topic: packet.topic, iata: normalizedIata },
              );
              return;
            }

            if (
              subtopic === "status" &&
              !acceptStatusTimestamp(clientPublicKey, message, logPrefix)
            ) {
              const rawTimestamp = message.timestamp;
              const quarantined = quarantineStaleStatus(
                packet,
                mqttConfig.instanceId,
                {
                  clientId: client.id,
                  statusTimestamp:
                    typeof rawTimestamp === "string" ||
                    typeof rawTimestamp === "number"
                      ? new Date(rawTimestamp).toISOString()
                      : undefined,
                },
              );
              log.info(
                `${logPrefix} Authorization: discarded stale status message -> ${quarantined.quarantineTopic}`,
              );
              // A stale status is a denial, not a success: tell the observer
              // on its error topic with a code instead of a silent quarantine.
              await notifyObserverError(
                client,
                OBSERVER_ERROR_CODES.PUBLISH_STALE_STATUS,
                "Stale status message discarded: device timestamp is older than the latest accepted status. Check the observer clock.",
                { topic: packet.topic, iata: normalizedIata },
              );
              callback(
                observerError(
                  OBSERVER_ERROR_CODES.PUBLISH_STALE_STATUS,
                  "Stale status message discarded: device timestamp is older than the latest accepted status.",
                ),
              );
              return;
            }

            rememberClientNameFromMessage(client, subtopic, message);

            observePublishForAbuse(client, packet, normalizedIata);

            log.info(
              `${logPrefix} Authorization: publish approved -> ${packet.topic}`,
            );

            const tokenPayload = mc.tokenPayload;
            if (tokenPayload) {
              const internalTopic = `meshcore/${normalizedIata}/${clientPublicKey}/internal`;

              const internalMessage = {
                origin_id: clientPublicKey,
                timestamp: Date.now(),
                jwt_payload: tokenPayload,
              };

              aedes.publish(
                {
                  cmd: "publish" as const,
                  topic: internalTopic,
                  payload: Buffer.from(JSON.stringify(internalMessage)),
                  qos: 0 as const,
                  dup: false,
                  retain: false,
                },
                (err) => {
                  if (err) {
                    log.error(
                      `${logPrefix} Internal: could not publish JWT payload:`,
                      err,
                    );
                  } else {
                    log.info(
                      `${logPrefix} Internal: published JWT payload -> ${internalTopic}`,
                    );
                  }
                },
              );
            }

            callback(null);
          } catch (_error) {
            denyPublish(
              client,
              callback,
              OBSERVER_ERROR_CODES.PUBLISH_INVALID_JSON,
              "Invalid message format or origin_id validation failed: payload must be JSON with matching origin_id.",
              { topic: packet.topic, iata: normalizedIata },
            );
          }
          return;
        }

        denyPublish(
          client,
          callback,
          OBSERVER_ERROR_CODES.PUBLISH_UNKNOWN_CLIENT,
          "Unknown client type: authenticate as v1_<PUBKEY> observer or subscriber first.",
          { topic: packet.topic },
        );
      } catch (error) {
        errorEvent(
          "Authorization",
          `publish authorization failed for ${describeClient(mc)}:`,
          error,
        );
        // Never leak a bare error: always carry a code. Preserve a coded
        // error if the throw site already produced one.
        if (error instanceof Error && observerErrorCode(error)) {
          callback(error);
          return;
        }
        denyPublish(
          client,
          callback,
          OBSERVER_ERROR_CODES.PUBLISH_INTERNAL_ERROR,
          "Internal publish authorization error; retry, and contact the operator if it persists.",
          { topic: packet.topic },
        );
      }
    })();
  };

  aedes.authorizeSubscribe = (
    client: MeshAedesClient,
    subscription,
    callback,
  ) => {
    if (!client) {
      callback(
        observerError(
          OBSERVER_ERROR_CODES.PUBLISH_UNKNOWN_CLIENT,
          "Unknown client: authenticate before subscribing.",
        ),
      );
      return;
    }

    const logPrefix = getClientLogPrefix(client);
    const clientType = client.clientType;

    if (clientType === ClientType.PUBLISHER) {
      const ownerKey = client.publicKey?.toUpperCase();
      if (!ownerKey || observerClients.get(ownerKey) !== client) {
        callback(
          observerError(
            OBSERVER_ERROR_CODES.PUBLISH_STALE_CONNECTION,
            "Publisher is not the active observer connection. Reconnect to take over.",
          ),
        );
        return;
      }
      const parsedTopic = parseMeshcoreTopic(subscription.topic);
      const subtopic = parsedTopic?.subtopic;
      // Observers always receive their own error topic: it is the only
      // channel that carries machine-readable denial codes on QoS 0.
      if (
        subtopic === "error" &&
        parsedTopic &&
        parsedTopic.publicKey === (client.publicKey || "").toUpperCase()
      ) {
        log.info(
          `${logPrefix} Authorization: subscribe approved (own error topic) -> ${subscription.topic}`,
        );
        callback(null, subscription);
        return;
      }
      if (subtopic === "serial/commands") {
        const clientPublicKey = (client.publicKey || "").toUpperCase();
        const isOwnPublicKey =
          parsedTopic &&
          parsedTopic.publicKey === clientPublicKey &&
          clientPublicKey.length === 64;

        if (isOwnPublicKey && isIataAllowedForObserver(parsedTopic.iata)) {
          log.info(
            `${logPrefix} Authorization: subscribe approved (own serial/commands) -> ${subscription.topic}`,
          );
          callback(null, subscription);
          return;
        }
      }
      log.info(
        `${logPrefix} Authorization: subscribe denied (publisher) -> ${subscription.topic}`,
      );
      log.info(
        `${logPrefix} Disconnect: closing client - publishers cannot subscribe`,
      );
      callback(
        observerError(
          OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
          "Publisher clients are publish-only; observers can only subscribe to their own error and serial/commands topics.",
        ),
      );
      client.close();
      return;
    }

    if (clientType === ClientType.SUBSCRIBER) {
      const role: SubscriberRole = client.role || SubscriberRole.LIMITED;
      const topic = subscription.topic;
      const isHeartbeatTopic = topic === BROKER_HEARTBEAT_TOPIC;
      const isHealthcheckLoopbackTopic = topic === HEALTHCHECK_TOPIC;
      const username = client.username;

      if (username === DOCKER_HEALTH_USERNAME && isHealthcheckLoopbackTopic) {
        log.info(
          `${logPrefix} Authorization: healthcheck loopback subscribe approved -> ${subscription.topic}`,
        );
        callback(null, subscription);
        return;
      }

      if (role === SubscriberRole.ADMIN) {
        log.info(
          `${logPrefix} Authorization: subscribe approved -> ${subscription.topic}`,
        );
        callback(null, subscription);
        return;
      }

      const isPublicMeshcoreTopic =
        topic === "meshcore/#" ||
        (topic.startsWith("meshcore/") && !isPrivateMeshcoreTopic(topic));

      if (
        (!isPublicMeshcoreTopic && !isHeartbeatTopic) ||
        topic.startsWith("$SYS/")
      ) {
        log.info(
          `${logPrefix} Authorization: subscribe denied (only public meshcore topics, heartbeat and internal healthcheck loopback for role ${role}) -> ${subscription.topic}`,
        );
        callback(
          observerError(
            OBSERVER_ERROR_CODES.PUBLISH_RESERVED_SUBTOPIC,
            "Subscribers may only subscribe to public meshcore topics and heartbeat.",
          ),
        );
        return;
      }

      log.info(
        `${logPrefix} Authorization: subscribe approved -> ${subscription.topic}`,
      );
      callback(null, subscription);
      return;
    }

    log.info(
      `${logPrefix} Authorization: subscribe denied -> ${subscription.topic} (unknown client type)`,
    );
    callback(
      observerError(
        OBSERVER_ERROR_CODES.PUBLISH_UNKNOWN_CLIENT,
        "Unknown client type: authenticate as v1_<PUBKEY> observer or subscriber first.",
      ),
    );
  };

  function isObserverErrorTopic(
    topic: string,
    client: MeshAedesClient,
  ): boolean {
    const parts = topic.split("/");
    if (parts.length !== 4 || parts[0] !== "meshcore") return false;
    if (parts[3] !== "error") return false;
    const ownerKey = client.publicKey?.toUpperCase();
    return (
      !!ownerKey &&
      parts[2].toUpperCase() === ownerKey &&
      /^[0-9A-F]{64}$/.test(parts[2].toUpperCase())
    );
  }

  aedes.authorizeForward = (client: MeshAedesClient, packet) => {
    if (!client) {
      return packet;
    }

    const clientType = client.clientType;
    const role = client.role;

    if (clientType === ClientType.PUBLISHER) {
      const publicKey = client.publicKey?.toUpperCase();
      if (!publicKey || observerClients.get(publicKey) !== client) {
        // Exception: a replaced (stale) connection must still see its own
        // STALE_CONNECTION notice — otherwise that code is unobservable.
        // Admin subscribers keep full visibility for operations.
        if (!isObserverErrorTopic(packet.topic, client)) return null;
        return packet;
      }
    }

    if (client.role === SubscriberRole.ADMIN) {
      return packet;
    }

    // Observer error notifications are addressed to one observer key and
    // must not leak to every meshcore/# subscriber.
    if (
      clientType === ClientType.SUBSCRIBER &&
      isObserverErrorPacket(packet) &&
      !ownsObserverErrorPacket(packet, client)
    ) {
      return null;
    }

    if (clientType === ClientType.SUBSCRIBER && role !== SubscriberRole.ADMIN) {
      if (packet.topic.startsWith("$SYS/")) {
        return null;
      }
    }

    if (clientType === ClientType.SUBSCRIBER && role !== SubscriberRole.ADMIN) {
      if (isPrivateMeshcoreTopic(packet.topic)) {
        return null;
      }
    }

    if (
      clientType === ClientType.SUBSCRIBER &&
      role === SubscriberRole.LIMITED
    ) {
      if (
        packet.topic.endsWith("/status") &&
        packet.payload &&
        packet.payload.length > 0
      ) {
        try {
          const message = JSON.parse(packet.payload.toString()) as Record<
            string,
            unknown
          >;

          let filtered = false;

          if (message.stats) {
            delete message.stats;
            filtered = true;
          }

          if (message.model !== undefined) {
            delete message.model;
            filtered = true;
          }

          if (message.firmware_version !== undefined) {
            delete message.firmware_version;
            filtered = true;
          }

          if (filtered) {
            return {
              ...packet,
              payload: Buffer.from(JSON.stringify(message)),
            };
          }
        } catch (error) {
          log.debug(
            "Filter: could not parse status message for filtering:",
            error,
          );
        }
      }

      if (
        packet.topic.endsWith("/packets") &&
        packet.payload &&
        packet.payload.length > 0
      ) {
        try {
          const message = JSON.parse(packet.payload.toString()) as Record<
            string,
            unknown
          >;

          let filtered = false;
          if (message.SNR !== undefined) {
            delete message.SNR;
            filtered = true;
          }
          if (message.RSSI !== undefined) {
            delete message.RSSI;
            filtered = true;
          }
          if (message.score !== undefined) {
            delete message.score;
            filtered = true;
          }

          if (filtered) {
            return {
              ...packet,
              payload: Buffer.from(JSON.stringify(message)),
            };
          }
        } catch (error) {
          log.debug(
            "Filter: could not parse packet message for filtering:",
            error,
          );
        }
      }

      if (
        packet.topic.endsWith("/neighbors") &&
        packet.payload &&
        packet.payload.length > 0
      ) {
        try {
          const message = JSON.parse(packet.payload.toString()) as Record<
            string,
            unknown
          >;

          if (stripNeighborSnrForLimitedSubscriber(message)) {
            return {
              ...packet,
              payload: Buffer.from(JSON.stringify(message)),
            };
          }
        } catch (error) {
          log.debug(
            "Filter: could not parse neighbors message for filtering:",
            error,
          );
        }
      }
    }

    return packet;
  };

  aedes.on("client", (client: MeshAedesClient) => {
    const logPrefix = getClientLogPrefix(client);
    log.info(`${logPrefix} Client: connected`);

    client.connectedAt = Date.now();
  });

  aedes.on("clientDisconnect", (client: MeshAedesClient) => {
    const logPrefix = getClientLogPrefix(client);
    const connectedAt = client.connectedAt;
    const duration = connectedAt
      ? Math.round((Date.now() - connectedAt) / 1000)
      : "unknown";

    log.info(`${logPrefix} Client: disconnected (connected for ${duration}s)`);
    if (client) {
      log.info(
        `${logPrefix} Client: disconnect details - client type: ${client.clientType}, public key: ${client.publicKey?.substring(0, 8)}`,
      );

      const clientType = client.clientType;
      const username = client.username;
      if (clientType === ClientType.SUBSCRIBER && username) {
        releaseSubscriberConnection(username, client.id);
        log.info(
          `${logPrefix} Client: subscriber connection removed (${username})`,
        );
      }

      const publicKey = client.publicKey;
      if (publicKey && observerClients.get(publicKey) === client) {
        observerClients.delete(publicKey);
      }
    }
  });

  aedes.on("publish", (packet, client: MeshAedesClient | null) => {
    try {
      const payload = Buffer.isBuffer(packet.payload)
        ? packet.payload
        : Buffer.from(packet.payload);
      // Only the active connection for an observer feeds the upload queue;
      // a replaced (stale) connection must not keep uploading after takeover.
      const publisherKey =
        client?.clientType === ClientType.PUBLISHER
          ? client.publicKey?.toUpperCase()
          : undefined;
      const ownsForUpload =
        !publisherKey || observerClients.get(publisherKey) === client;
      if (ownsForUpload && !isTestIngressTopic(packet.topic)) {
        meshcoreIoRuntime.offerPublish(packet.topic, payload);
      }
      if (client) {
        const logPrefix = getClientLogPrefix(client);
        const publicKey = client.publicKey;
        if (!publicKey || observerClients.get(publicKey) === client) {
          targetBridge?.forwardPublish(packet, client);
        }
        log.info(
          `${logPrefix} Publish: ${packet.topic} (${packet.payload.length} bytes)`,
        );
        log.info(
          `${logPrefix} MQTT: lokal publicering -> ${packet.topic} (${packet.payload.length} bytes)`,
        );

        if (isRetainedSubtopic(packet.topic) && packet.retain) {
          const timer = retainedTopicTimers.get(packet.topic);
          if (timer) {
            clearTimeout(timer);
          }

          retainedTopicTimers.set(
            packet.topic,
            setTimeout(() => {
              retainedTopicTimers.delete(packet.topic);
              aedes.publish(
                {
                  cmd: "publish" as const,
                  topic: packet.topic,
                  payload: Buffer.alloc(0),
                  qos: 0 as const,
                  retain: true,
                  dup: false,
                },
                (err) => {
                  if (err) {
                    log.error(
                      `Neighbor: could not clear retained message for ${packet.topic}: ${err.message}`,
                    );
                  }
                },
              );
            }, NEIGHBOR_RETENTION_MS),
          );
        }
      } else {
        log.info(
          `Publish: internal -> ${packet.topic} (${packet.payload.length} bytes)`,
        );
        log.debug(
          `MQTT: intern lokal publicering -> ${packet.topic} (${packet.payload.length} bytes)`,
        );
      }
    } catch (error) {
      log.error(`Publish: failed to handle ${packet.topic}:`, error);
    }
  });

  aedes.on("subscribe", (subscriptions, client: MeshAedesClient) => {
    const logPrefix = getClientLogPrefix(client);
    const topics = subscriptions.map((subscription) => subscription.topic);
    log.info(
      `${logPrefix} Subscribe: attempting to subscribe to: ${topics.join(", ")}`,
    );
  });

  aedes.on("unsubscribe", (topics, client: MeshAedesClient) => {
    const logPrefix = getClientLogPrefix(client);
    log.info(
      `${logPrefix} Unsubscribe: removing subscriptions: ${topics.join(", ")}`,
    );
  });

  function publishHeartbeat(): void {
    aedes.publish(
      {
        topic: BROKER_HEARTBEAT_TOPIC,
        payload: Buffer.from(BROKER_HEARTBEAT_MESSAGE),
        qos: 0,
        retain: false,
        cmd: "publish",
        dup: false,
      },
      (err?: Error | null) => {
        if (err) {
          log.error("Heartbeat: could not publish heartbeat:", err.message);
        }
      },
    );
  }

  aedes.on("clientError", (client: MeshAedesClient, err) => {
    const logPrefix = getClientLogPrefix(client);
    log.info(`${logPrefix} Error: client error: ${err.message}`);
  });

  aedes.on("connectionError", (client: MeshAedesClient, err) => {
    log.info(
      `[${describeClient(client)}] Error: connection error: ${err.message}`,
    );
  });

  const httpServer = createServer((request, response) => {
    if (request.url === "/status") {
      if (request.method !== "GET") {
        response.statusCode = 405;
        response.setHeader("Allow", "GET");
        response.end();
        return;
      }
      const startedAgoMs = Date.now() - brokerStartedAtMs;
      const targetStatus = targetBridge?.getStatus();
      const meshcoreIoStats = meshcoreIoRuntime.getQueueStats();
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(
        JSON.stringify({
          status: "ok",
          storage: "stateless",
          instanceId: mqttConfig.instanceId,
          uptimeMs: startedAgoMs,
          observers: observerClients.size,
          target: targetStatus
            ? {
                enabled: targetStatus.enabled,
                connected: targetStatus.connected,
                droppedMessages: targetStatus.droppedMessages,
                successfulMessages: targetStatus.successfulMessages,
              }
            : { enabled: false },
          meshcoreIo: {
            enabled: meshcoreIoConfig.enabled,
            ...meshcoreIoStats,
          },
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  httpServer.on("error", (error) => {
    log.error("HTTP server error:", error.message);
  });
  const wsServer = new WebSocketServer({
    server: httpServer,
    maxPayload: WS_MAX_PAYLOAD_BYTES,
  });

  wsServer.on("error", (error) => {
    log.error("WebSocket server error:", error.message);
  });

  wsServer.on("connection", (ws, req) => {
    try {
      const remoteAddress = req.socket.remoteAddress || "unknown";
      log.info(`WebSocket: new WebSocket connection from ${remoteAddress}`);

      ws.on("ping", () => {
        log.info(
          `WebSocket: received WebSocket PING from ${remoteAddress}, automatic PONG sent`,
        );
      });

      ws.on("pong", () => {
        log.info(`WebSocket: received WebSocket PONG from ${remoteAddress}`);
      });

      ws.on("error", (error) => {
        log.error("WebSocket: error from %s: %s", remoteAddress, error.message);
      });

      const stream = new Duplex({
        read() {},
        write(
          chunk: string | Buffer,
          encoding: BufferEncoding,
          callback: (error?: Error | null) => void,
        ) {
          if (ws.readyState === ws.OPEN) {
            if (
              chunk instanceof Buffer &&
              chunk.length >= 2 &&
              chunk[0] === 0xd0
            ) {
              const clientInfo = (stream as unknown as Record<string, unknown>)
                .client as MeshAedesClient | undefined;
              if (clientInfo) {
                const logPrefix = getClientLogPrefix(clientInfo);
                log.info(
                  `${logPrefix} MQTT: sending PINGRESP (PONG) to client`,
                );
              } else {
                log.info(
                  "MQTT: sending PINGRESP (PONG) to unauthenticated client",
                );
              }
            }

            ws.send(chunk, (error) => {
              const streamMeta = stream as unknown as WebSocketStreamMeta;
              const closing =
                streamMeta.transportClosed === true ||
                ws.readyState === ws.CLOSING ||
                ws.readyState === ws.CLOSED;
              if (
                error &&
                !closing &&
                (error as unknown as { code?: string }).code !== "EPIPE"
              ) {
                const clientInfo = (
                  stream as unknown as Record<string, unknown>
                ).client as MeshAedesClient | undefined;
                if (clientInfo) {
                  const logPrefix = getClientLogPrefix(clientInfo);
                  log.error(`${logPrefix} WebSocket: send error:`, error);
                } else {
                  log.error("WebSocket: send error:", error);
                }
              }
              callback(closing ? null : error);
            });
          } else {
            const streamMeta = stream as unknown as WebSocketStreamMeta;
            if (
              streamMeta.transportClosed === true ||
              ws.readyState === ws.CLOSING ||
              ws.readyState === ws.CLOSED
            ) {
              callback(null);
            } else {
              callback(new Error("WebSocket not open"));
            }
          }
        },
        destroy(error, callback) {
          try {
            if (ws.readyState !== ws.CLOSED) {
              ws.terminate();
            }
            callback(error);
          } catch (terminateError) {
            callback(
              terminateError instanceof Error
                ? terminateError
                : new Error(String(terminateError)),
            );
          }
        },
      });

      stream.on("error", (error) => {
        const clientInfo = (stream as unknown as Record<string, unknown>)
          .client as MeshAedesClient | undefined;
        log.error(
          `${getClientLogPrefix(clientInfo as MeshAedesClient)} Stream: transport error:`,
          error,
        );
      });

      ws.on("message", (data) => {
        const byteLength = websocketMessageByteLength(data);
        if (byteLength > WS_MAX_PAYLOAD_BYTES) {
          log.info(
            `WebSocket: closing ${remoteAddress}: transport payload ${byteLength} bytes over the limit ${WS_MAX_PAYLOAD_BYTES}`,
          );
          ws.close(1009, "Payload too large");
          return;
        }

        if (data instanceof Buffer && data.length >= 2 && data[0] === 0xc0) {
          const clientInfo = (stream as unknown as Record<string, unknown>)
            .client as MeshAedesClient | undefined;
          if (clientInfo) {
            const logPrefix = getClientLogPrefix(clientInfo);
            log.info(`${logPrefix} MQTT: received PINGREQ (PING) from client`);
          } else {
            log.info(
              "MQTT: received PINGREQ (PING) from unauthenticated client",
            );
          }
        }
        if (!stream.destroyed) {
          stream.push(data);
        }
      });

      const streamMeta = stream as unknown as WebSocketStreamMeta;
      streamMeta.authenticated = false;
      streamMeta.transportClosed = false;

      ws.on("close", (code, reason) => {
        streamMeta.transportClosed = true;
        const clientInfo = (stream as unknown as Record<string, unknown>)
          .client as MeshAedesClient | undefined;
        const hasValidAuth = clientInfo?.clientType;

        if (hasValidAuth) {
          const logPrefix = getClientLogPrefix(clientInfo);
          log.info(
            `${logPrefix} WebSocket: connection closed from ${remoteAddress} - code: ${code}, reason: ${reason.toString() || "none"}`,
          );
        } else {
          log.info(
            `[${describeClient(clientInfo as MeshAedesClient)}] WebSocket: connection closed (unauthenticated) from ${remoteAddress} - code: ${code}, reason: ${reason.toString() || "none"}`,
          );
        }
        if (!stream.destroyed) {
          stream.push(null);
        }
      });

      stream.on("end", () => {
        const clientInfo = (stream as unknown as Record<string, unknown>)
          .client as MeshAedesClient | undefined;
        if (clientInfo) {
          const logPrefix = getClientLogPrefix(clientInfo);
          log.info(`${logPrefix} Stream: stream ended, closing WebSocket`);
        } else {
          log.info("Stream: stream ended (unauthenticated), closing WebSocket");
        }
        ws.close();
      });

      aedes.handle(stream);
    } catch (error) {
      log.error("WebSocket: error handling connection:", error);
      try {
        ws.terminate();
      } catch (_e) {
        // Ignore errors when terminating
      }
    }
  });

  await meshcoreIoRuntime.ready;
  await aedes.listen();
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(WS_PORT, HOST, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const boundPort = (httpServer.address() as AddressInfo).port;
  log.info(
    "\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557",
  );
  log.info(
    "\u2551         MeshCore MQTT Broker (WebSocket)                   \u2551",
  );
  log.info(
    "\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d",
  );
  log.info(`WebSocket MQTT listening on: ws://${HOST}:${boundPort}`);
  log.info(
    "Lagring: stateless (ingen databas; MQTT-tillstånd endast i minnet)",
  );
  log.info("");
  log.info("Authentication modes:");
  log.info(
    `  1. Subscribers (subscribe-only): ${subscriberUsers.size} users configured`,
  );
  log.info("     Usernames:", Array.from(subscriberUsers.keys()).join(", "));
  log.info("");
  log.info("  2. Publishers (publish only):");
  log.info("     Username: v1_{PUBLIC_KEY}");
  log.info("     Password: JWT token signed with private Ed25519 key");
  log.info("     Validation:");
  log.info("       - origin_id must match authenticated public key");
  if (EXPECTED_AUDIENCE) {
    log.info(`       - Token audience must be: ${EXPECTED_AUDIENCE}`);
  }
  log.info("");
  log.info("Ready to accept connections...");

  publishHeartbeat();
  heartbeatTimer = setInterval(publishHeartbeat, BROKER_HEARTBEAT_INTERVAL_MS);
  nodeNameCleanupTimer = setInterval(
    sweepProcessLocalObserverState,
    STATE_SWEEP_INTERVAL_MS,
  );
  log.info(
    `Heartbeat: publishing ${BROKER_HEARTBEAT_TOPIC} every ${BROKER_HEARTBEAT_INTERVAL_MS / 1000}s`,
  );

  const port = boundPort;

  function withShutdownTimeout<T>(
    label: string,
    operation: Promise<T>,
  ): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        log.warn(`Shutdown: timeout while ${label}, continuing shutdown`);
        resolve(undefined);
      }, SHUTDOWN_STEP_TIMEOUT_MS);
    });

    return Promise.race([operation, timeout]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });
  }

  function closeWebSocketServer(server: WebSocketServer): Promise<void> {
    for (const client of server.clients) {
      client.terminate();
    }

    return withShutdownTimeout(
      "WebSocket server closing",
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    ).then(() => undefined);
  }

  function closeAedesBroker(broker: Aedes): Promise<void> {
    return new Promise<void>((resolve) => {
      broker.close(() => resolve());
    });
  }

  let stopPromise: Promise<void> | null = null;

  function stop(): Promise<void> {
    if (stopPromise) {
      return stopPromise;
    }

    stopPromise = (async () => {
      log.info("Shutdown: shutting down MQTT broker...");
      shutdownRequested = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (nodeNameCleanupTimer) {
        clearInterval(nodeNameCleanupTimer);
        nodeNameCleanupTimer = null;
      }
      for (const timer of retainedTopicTimers.values()) {
        clearTimeout(timer);
      }
      retainedTopicTimers.clear();

      try {
        await closeWebSocketServer(wsServer);
        await withShutdownTimeout(
          "HTTP server closing",
          new Promise<void>((resolve, reject) => {
            httpServer.close((error) => (error ? reject(error) : resolve()));
          }),
        );
        await closeAedesBroker(aedes);
        await meshcoreIoRuntime.stop().catch((error: unknown) => {
          log.error(
            "Shutdown: could not cleanly stop Meshcore.io integration:",
            error,
          );
        });
        if (targetBridge) {
          await targetBridge.stop().catch((error) => {
            log.error("Shutdown: could not cleanly stop target bridge:", error);
          });
        }
        observerClients.clear();
      } finally {
        abuseDetector.shutdown();
        log.info("Shutdown: broker stopped");
      }
    })();

    return stopPromise;
  }

  return {
    aedes,
    abuseDetector,
    httpServer,
    wsServer,
    port,
    publishHeartbeat,
    stop,
    healthcheckCredentials: {
      username: dockerHealthCredentials.username,
      password: dockerHealthCredentials.password,
    },
  };
}

function isEntrypoint(): boolean {
  return (
    Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

let runtime: BrokerServerRuntime | null = null;
let shutdownStarted = false;

async function shutdown(): Promise<void> {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;

  try {
    await runtime?.stop();
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Critical shutdown error: ${message}`);
    process.exit(1);
  }
}

if (isEntrypoint()) {
  try {
    runtime = await startBrokerServer();
    process.on("SIGINT", () => {
      void shutdown();
    });
    process.on("SIGTERM", () => {
      void shutdown();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Critical: ${message}`);
    process.exit(1);
  }
}
