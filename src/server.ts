import { Aedes, type PublishPacket } from "aedes";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { Duplex } from "stream";
import { pathToFileURL } from "url";
import { verifyAuthToken } from "@michaelhart/meshcore-decoder";
import { RateLimiter } from "./rate-limiter.js";
import { getClientIP } from "./ip-utils.js";
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
  resolveDockerHealthCredentialsFile,
} from "./docker-health-user.js";
import { HEALTHCHECK_LOOPBACK_TOPIC } from "./healthcheck-loopback.js";
import { createOrchestrationRuntime } from "./orchestration.js";
import { createDashboardServer, DashboardState } from "./dashboard.js";
import type { MeshAedesClient } from "./aedes-types.js";
import {
  startTargetBridge,
  type TargetBridgeRuntime,
} from "./target-bridge.js";
import {
  createSwedishCountiesLookup,
  type SwedishCountiesLookup,
} from "./swedish-counties.js";
import { quarantineOrphanedWill } from "./orphaned-will.js";
import { createMeshcoreIoRuntime } from "./meshcore-io-runtime.js";

export {
  BROKER_HEARTBEAT_INTERVAL_MS,
  BROKER_HEARTBEAT_MESSAGE,
  BROKER_HEARTBEAT_TOPIC,
} from "./heartbeat.js";

const SERIAL_RESPONSE_MAX_BYTES = 4096;
const SERIAL_COMMAND_MAX_BYTES = 4096;
const HEALTHCHECK_TOPIC = configString(
  ["healthcheck", "mqtt_topic"],
  HEALTHCHECK_LOOPBACK_TOPIC,
);
const HEALTHCHECK_MAX_PAYLOAD_BYTES = 512;
const SHUTDOWN_STEP_TIMEOUT_MS = 5_000;
export const DEFAULT_NODE_NAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface BrokerServerOptions {
  swedishCountiesLookup?: SwedishCountiesLookup;
}

export interface BrokerServerRuntime {
  aedes: Aedes;
  abuseDetector: AbuseDetector;
  httpServer: ReturnType<typeof createServer>;
  dashboardServer: ReturnType<typeof createServer>;
  wsServer: WebSocketServer;
  port: number;
  dashboardPort: number;
  publishHeartbeat: () => void;
  stop: () => Promise<void>;
  healthcheckCredentialsFile: string;
}

export async function startBrokerServer(
  healthCredentialsFile?: string,
  options?: BrokerServerOptions,
): Promise<BrokerServerRuntime> {
  const mqttConfig = loadMqttConfig();
  const abuseConfig = loadAbuseConfig();
  const subscriberConfig = loadSubscriberConfig();
  const meshcoreIoConfig = loadMeshcoreIoConfig();
  setBrokerLogContext({
    instanceId: mqttConfig.instanceId,
    namespace: mqttConfig.kvNamespace,
  });
  const log = getModuleLogger("Server");

  const WS_PORT = mqttConfig.wsPort;
  const DASHBOARD_PORT = mqttConfig.dashboardPort;
  const HOST = mqttConfig.host;
  const EXPECTED_AUDIENCE = mqttConfig.expectedAudience;
  const ALLOWED_REGION_CODES = mqttConfig.allowedRegions;
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
    region: string;
    publicKey: string;
    subtopic: string;
  }

  const subscriberUsers = new Map<string, string>();
  const subscriberRoles = new Map<string, SubscriberRole>();
  const subscriberMaxConnections = new Map<string, number>();

  const subscriberActiveConnections = new Map<string, Set<string>>();

  async function registerSubscriberConnection(
    username: string,
    clientId: string,
    maxConnections: number,
  ): Promise<{
    allowed: boolean;
    activeConnections: number;
    scope: "local" | "cluster";
    connectionId?: string;
  }> {
    if (username !== DOCKER_HEALTH_USERNAME) {
      const result = await clusterStateStore.tryRegisterSubscriberConnection(
        username,
        clientId,
        maxConnections,
      );
      return {
        ...result,
        scope: "cluster",
      };
    }

    const activeConns =
      subscriberActiveConnections.get(username) || new Set<string>();
    if (activeConns.size >= maxConnections) {
      return {
        allowed: false,
        activeConnections: activeConns.size,
        scope: "local",
      };
    }

    activeConns.add(clientId);
    subscriberActiveConnections.set(username, activeConns);

    return {
      allowed: true,
      activeConnections: activeConns.size,
      scope: "local",
    };
  }

  async function releaseSubscriberConnection(
    username: string,
    clientId: string,
    connectionId?: string,
  ): Promise<number | undefined> {
    if (username !== DOCKER_HEALTH_USERNAME) {
      await clusterStateStore.releaseSubscriberConnection(
        username,
        clientId,
        connectionId,
      );
      return undefined;
    }

    const activeConns = subscriberActiveConnections.get(username);
    if (!activeConns) {
      return undefined;
    }

    activeConns.delete(clientId);
    return activeConns.size;
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

    subscriberActiveConnections.set(username, new Set());

    const roleNames = {
      [SubscriberRole.ADMIN]: "admin",
      [SubscriberRole.FULL_ACCESS]: "full access",
      [SubscriberRole.LIMITED]: "limited",
    };
    log.info(
      `Config: subscriber loaded: ${username} (role: ${roleNames[role]}, max connections: ${maxConn})`,
    );
  }

  const healthcheckCredentialsFilePath =
    healthCredentialsFile ?? resolveDockerHealthCredentialsFile();
  const dockerHealthCredentials = createDockerHealthCredentials(
    healthcheckCredentialsFilePath,
  );
  subscriberUsers.set(DOCKER_HEALTH_USERNAME, dockerHealthCredentials.password);
  subscriberRoles.set(DOCKER_HEALTH_USERNAME, SubscriberRole.LIMITED);
  subscriberMaxConnections.set(
    DOCKER_HEALTH_USERNAME,
    DOCKER_HEALTH_MAX_CONNECTIONS,
  );
  subscriberActiveConnections.set(DOCKER_HEALTH_USERNAME, new Set());
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

  if (ALLOWED_REGION_CODES.length === 0) {
    log.warn(
      "Config: no allowed regions found in config.yaml. publishes to regions will be denied.",
    );
  } else {
    const sources =
      mqttConfig.allowedRegionSources.length > 0
        ? mqttConfig.allowedRegionSources.join(", ")
        : "unknown source";
    log.info(
      `Config: allowed regions loaded (${ALLOWED_REGION_CODES.length}) from ${sources}: ${ALLOWED_REGION_CODES.join(", ")}`,
    );
  }

  const orchestrationRuntime = createOrchestrationRuntime({
    kvUrl: mqttConfig.kvUrl,
    namespace: mqttConfig.kvNamespace,
    instanceId: mqttConfig.instanceId,
  });
  const clusterStateStore = orchestrationRuntime.clusterStateStore;
  const meshcoreIoRuntime = createMeshcoreIoRuntime(meshcoreIoConfig, {
    instanceId: mqttConfig.instanceId,
    kvUrl: mqttConfig.kvUrl,
    namespace: mqttConfig.kvNamespace,
  });

  function recordDeniedPublish(
    client: MeshAedesClient,
    topic: string,
    reason: string,
    region?: string,
    deniedUntilText?: string,
  ): void {
    const publicKey =
      typeof client?.publicKey === "string"
        ? client.publicKey.toUpperCase()
        : "-";
    const label =
      typeof client?.username === "string" && !client.username.startsWith("v1_")
        ? client.username
        : undefined;
    clusterStateStore
      .recordDeniedPublish({
        node: publicKey,
        label,
        reason,
        topic,
        region,
        deniedUntilText,
      })
      .catch((error) => {
        log.error(
          `${getClientLogPrefix(client)} Denied: could not save denied event:`,
          error,
        );
      });
  }

  const aedes = new Aedes(orchestrationRuntime.aedesOptions);
  (
    aedes as unknown as {
      on(event: "error", listener: (error: Error) => void): void;
    }
  ).on("error", (error: Error) => {
    log.error("Aedes: runtime error:", error);
  });

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let nodeNameCleanupTimer: ReturnType<typeof setInterval> | null = null;
  let dashboardMetricsTimer: ReturnType<typeof setInterval> | null = null;
  let dashboardMetricsRunning = false;
  const targetBridge: TargetBridgeRuntime | null = startTargetBridge();

  const rateLimiter = new RateLimiter(60000, 10, 300000);

  const abuseDetector = new AbuseDetector(abuseConfig);
  const swedishCountiesLookup =
    options?.swedishCountiesLookup ?? (await createSwedishCountiesLookup());

  if (swedishCountiesLookup.isAvailable()) {
    for (const region of ALLOWED_REGION_CODES) {
      const correction = swedishCountiesLookup.getCorrectionForIata(region);
      if (correction) {
        const primary = swedishCountiesLookup.getPrimaryIataForIata(region);
        const county = swedishCountiesLookup.getCountyForIata(region);
        log.warn(
          `Config: Region ${region} is a secondary IATA code for ${county}. Use primary IATA ${primary} in allowed_regions.`,
        );
      }
    }
  }

  const dashboardState = new DashboardState({
    instanceId: mqttConfig.instanceId,
    namespace: mqttConfig.kvNamespace,
    targetBridgeStatus: () =>
      targetBridge?.getStatus() ?? {
        enabled: false,
        connected: false,
        droppedMessages: 0,
        successfulMessages: 0,
      },
    swedishCountiesLookup,
    meshcoreIoStatus: () => meshcoreIoRuntime.getDashboardSnapshot(),
  });

  const observerClients = new Map<string, Set<MeshAedesClient>>();
  const lastClaimAttempt = new Map<string, number>();
  const CLAIM_THROTTLE_MS = 5_000;
  let shutdownRequested = false;

  interface CachedNodeName {
    name: string;
    updatedAt: number;
  }

  const nodeNamesByPublicKey = new Map<string, CachedNodeName>();

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

  async function resolveNodeName(
    publicKey: string,
  ): Promise<string | undefined> {
    const localName = getCachedNodeName(publicKey);
    if (localName) {
      return localName;
    }

    const sharedName = await clusterStateStore
      .getObserverNodeName(publicKey)
      .catch((error) => {
        log.error(
          `Valkey: could not read observer name for ${shortPublicKey(publicKey)}:`,
          error,
        );
        return undefined;
      });
    if (sharedName) {
      rememberNodeName(publicKey, sharedName);
    }
    return sharedName;
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
          clusterStateStore
            .setObserverNodeName(
              client.publicKey,
              origin,
              NODE_NAME_CACHE_TTL_MS,
            )
            .catch((error) => {
              log.error(
                `Valkey: could not write observer name for ${shortPublicKey(client.publicKey)}:`,
                error,
              );
            });
        }
      }
    }
  }

  async function acceptStatusTimestampFromValkey(
    publicKey: string,
    message: unknown,
    logPrefix: string,
  ): Promise<boolean> {
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

    const accepted = await clusterStateStore.acceptObserverStatusTimestamp(
      publicKey,
      timestamp,
      NODE_NAME_CACHE_TTL_MS,
    );
    if (!accepted) {
      log.info(
        `${logPrefix} Valkey: rejecting stale status message for ${shortPublicKey(publicKey)} (${new Date(timestamp).toISOString()})`,
      );
    }
    return accepted;
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
    clientIP?: string;
    authenticated?: boolean;
    transportClosed?: boolean;
  }

  type AuthenticationCallback = Parameters<
    NonNullable<Aedes["authenticate"]>
  >[3];

  function getClientStreamMeta(client: MeshAedesClient): WebSocketStreamMeta {
    return client.conn as unknown as WebSocketStreamMeta;
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

  function recordAuthenticationFailure(client: MeshAedesClient): void {
    const clientIP = getClientStreamMeta(client).clientIP;
    if (!clientIP) {
      return;
    }

    const blocked = rateLimiter.recordFailure(clientIP);
    if (blocked) {
      log.info(`RateLimit: IP ${clientIP} has been temporarily blocked`);
    }
  }

  function rejectInvalidAuthentication(
    client: MeshAedesClient,
    callback: AuthenticationCallback,
  ): void {
    recordAuthenticationFailure(client);
    completeAuthentication(client, callback, false);
  }

  function markAuthenticationSucceeded(client: MeshAedesClient): void {
    const streamMeta = getClientStreamMeta(client);
    streamMeta.authenticated = true;
    if (streamMeta.clientIP) {
      rateLimiter.recordSuccess(streamMeta.clientIP);
    }
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

  function countActiveBans(): number {
    return abuseDetector
      .getAllStats()
      .clients.filter(
        (client) => client.status === "muted" || client.status === "would_mute",
      ).length;
  }

  function evaluateAbuseForPublishLocally(
    client: MeshAedesClient,
    packet: PublishPacket,
    normalizedLocation: string,
  ): boolean {
    const publicKey = client.publicKey!;
    const trustState = abuseDetector.getClientStats(publicKey);

    if (!trustState) {
      return false;
    }

    if (abuseDetector.shouldSilencePacket(client)) {
      return false;
    }

    if (!abuseDetector.checkIataChange(trustState, normalizedLocation)) {
      return false;
    }

    if (!abuseDetector.recordPacket(client, packet)) {
      return false;
    }

    return !abuseDetector.shouldSilencePacket(client);
  }

  async function evaluateAbuseForPublish(
    client: MeshAedesClient,
    packet: PublishPacket,
    normalizedLocation: string,
  ): Promise<boolean> {
    const publicKey = client.publicKey!;

    return clusterStateStore.withTrustStateLock(publicKey, async () => {
      const clusteredState = await clusterStateStore.getTrustState(publicKey);
      if (clusteredState) {
        abuseDetector.importClientState(publicKey, clusteredState);
      }

      const allowed = evaluateAbuseForPublishLocally(
        client,
        packet,
        normalizedLocation,
      );
      const exportedState = abuseDetector.exportClientState(publicKey);
      if (exportedState) {
        await clusterStateStore.setTrustState(publicKey, exportedState);
      }

      return allowed;
    });
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

    const region = parts[1];
    const publicKey = parts[2].toUpperCase();
    const subtopic = parts.slice(3).join("/");
    const validRegion =
      region.toLowerCase() === "test" || /^[A-Z]{3}$/.test(region);

    if (!validRegion || !/^[0-9A-F]{64}$/.test(publicKey)) {
      return null;
    }

    return {
      region: region.toLowerCase() === "test" ? "test" : region.toUpperCase(),
      publicKey,
      subtopic,
    };
  }

  function isRegionAllowedForObserver(region: string): boolean {
    if (region.toLowerCase() === "test") return true;

    const normalized = region.toUpperCase();
    if (swedishCountiesLookup.isAvailable()) {
      const correction = swedishCountiesLookup.getCorrectionForIata(normalized);
      if (correction) return false;
    }

    return ALLOWED_REGION_CODES.includes(normalized);
  }

  function getRegionDenialText(
    region: string,
  ): { reason: string; deniedUntilText?: string } | null {
    if (!swedishCountiesLookup.isAvailable()) return null;

    const normalized = region.toUpperCase();
    const correction = swedishCountiesLookup.getCorrectionForIata(normalized);
    if (!correction) return null;

    const primary = swedishCountiesLookup.getPrimaryIataForIata(normalized);
    const county = swedishCountiesLookup.getCountyForIata(normalized);
    if (!primary || !county) return { reason: "Wrong IATA code" };

    const secondaryIsAllowed = ALLOWED_REGION_CODES.includes(normalized);
    const primaryIsAllowed = ALLOWED_REGION_CODES.includes(primary);

    if (secondaryIsAllowed && primaryIsAllowed) {
      return {
        reason: "Wrong IATA code",
        deniedUntilText: `Until observer switches to correct IATA ${primary} for ${county}`,
      };
    }

    if (secondaryIsAllowed && !primaryIsAllowed) {
      return {
        reason: "Wrong IATA code",
        deniedUntilText: `Broker is configured with secondary IATA ${normalized}. Change allowed_regions to primary IATA ${primary} for ${county}.`,
      };
    }

    if (!secondaryIsAllowed && primaryIsAllowed) {
      return {
        reason: "Wrong IATA code",
        deniedUntilText: `Until observer switches to correct IATA ${primary} for ${county}`,
      };
    }

    return {
      reason: "Wrong IATA code",
      deniedUntilText: `Wrong IATA code ${normalized}. Correct primary IATA is ${primary} for ${county}, but ${primary} is not enabled on this broker.`,
    };
  }

  async function claimObserverForClient(
    publicKey: string,
    client: MeshAedesClient,
    logPrefix: string,
  ): Promise<boolean> {
    if (shutdownRequested) {
      client.observerClaimed = false;
      log.info(
        `${logPrefix} Observer claim: denying new claim for ${shortPublicKey(publicKey)} because container is shutting down`,
      );
      return false;
    }

    try {
      const previousOwner = await clusterStateStore.claimObserver(publicKey);
      client.observerClaimed = true;
      lastClaimAttempt.set(publicKey, Date.now());
      if (previousOwner && previousOwner !== mqttConfig.instanceId) {
        log.info(
          `${logPrefix} Observer claim: took over claim for ${shortPublicKey(publicKey)} from ${previousOwner}`,
        );
      }
      return true;
    } catch (error) {
      client.observerClaimed = false;
      log.error(
        `${logPrefix} Observer claim: could not write claim for ${shortPublicKey(publicKey)}:`,
        error,
      );
      return false;
    }
  }

  async function ensureObserverClaimForClient(
    publicKey: string,
    client: MeshAedesClient,
    logPrefix: string,
  ): Promise<boolean> {
    try {
      const renewed = await clusterStateStore.renewObserverClaim(publicKey);
      if (renewed) {
        client.observerClaimed = true;
        return true;
      }
    } catch (error) {
      log.error(
        `${logPrefix} Observer claim: could not renew claim for ${shortPublicKey(publicKey)}:`,
        error,
      );
      return false;
    }

    try {
      const currentOwner =
        await clusterStateStore.claimObserverIfAvailable(publicKey);
      lastClaimAttempt.set(publicKey, Date.now());
      if (currentOwner && currentOwner !== mqttConfig.instanceId) {
        client.observerClaimed = false;
        log.info(
          `${logPrefix} Observer claim: claim for ${shortPublicKey(publicKey)} owned by ${currentOwner}; not reclaiming during publish`,
        );
        return false;
      }

      client.observerClaimed = true;
      log.info(
        `${logPrefix} Observer claim: missing claim for ${shortPublicKey(publicKey)} restored for ${mqttConfig.instanceId}`,
      );
      return true;
    } catch (error) {
      client.observerClaimed = false;
      log.error(
        `${logPrefix} Observer claim: could not restore claim for ${shortPublicKey(publicKey)}:`,
        error,
      );
      return false;
    }
  }

  aedes.authenticate = (
    client: MeshAedesClient,
    username,
    password,
    callback,
  ) => {
    void (async () => {
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
            logEvent(
              "Auth",
              `subscriber ${usernameStr} authentication failed. invalid password.`,
            );
            rejectInvalidAuthentication(client, callback);
            return;
          }

          const maxConn =
            subscriberMaxConnections.get(usernameStr) ||
            subscriberConfig.defaultMaxConnections;
          const registration = await registerSubscriberConnection(
            usernameStr,
            client.id,
            maxConn,
          );

          if (!isClientTransportOpen(client)) {
            if (registration.allowed) {
              await releaseSubscriberConnection(
                usernameStr,
                client.id,
                registration.connectionId,
              ).catch((error) => {
                log.error(
                  `Auth: could not roll back subscriber connection for ${usernameStr} after transport closed:`,
                  error,
                );
              });
            }
            return;
          }

          if (!registration.allowed) {
            logEvent(
              "Auth",
              `subscriber connection limit exceeded for ${usernameStr} (${registration.activeConnections}/${maxConn}, scope: ${registration.scope}). denying.`,
            );
            completeAuthentication(client, callback, false);
            return;
          }

          const role =
            subscriberRoles.get(usernameStr) || SubscriberRole.LIMITED;
          client.clientType = ClientType.SUBSCRIBER;
          client.username = usernameStr;
          client.role = role;
          client.connectionLimitScope = registration.scope;
          client.subscriberConnectionId = registration.connectionId;
          dashboardState.recordClientAuthenticated(client);
          markAuthenticationSucceeded(client);
          logEvent(
            "Auth",
            `subscriber ${describeClient(client)} authenticated (role: ${role}, connections: ${registration.activeConnections}/${maxConn}, scope: ${registration.scope}).`,
          );

          completeAuthentication(client, callback, true);
          return;
        }

        if (!usernameStr.startsWith("v1_")) {
          logEvent(
            "Auth",
            `invalid username format from ${describeClient(client)}: ${usernameStr}. denying.`,
          );
          rejectInvalidAuthentication(client, callback);
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
          rejectInvalidAuthentication(client, callback);
          return;
        }

        if (!passwordStr || passwordStr.length === 0) {
          logEvent(
            "Auth",
            `no password provided from ${describeClient(client)}. denying.`,
          );
          rejectInvalidAuthentication(client, callback);
          return;
        }

        let tokenPayload: Awaited<ReturnType<typeof verifyAuthToken>>;
        try {
          tokenPayload = await verifyAuthToken(passwordStr, publicKey);
        } catch (error) {
          logEvent(
            "Auth",
            `invalid token for unknown client (${shortPublicKey(publicKey)}). denying.`,
          );
          log.debug(`Auth: token verification error for ${publicKey}:`, error);
          rejectInvalidAuthentication(client, callback);
          return;
        }

        if (!tokenPayload) {
          logEvent(
            "Auth",
            `invalid token signature for unknown client (${shortPublicKey(publicKey)}). denying.`,
          );
          log.debug(`Auth: public key: ${publicKey}`);
          rejectInvalidAuthentication(client, callback);
          return;
        }

        if (EXPECTED_AUDIENCE && tokenPayload.aud !== EXPECTED_AUDIENCE) {
          logEvent(
            "Auth",
            `invalid audience for unknown client (${shortPublicKey(publicKey)}): ${tokenPayload.aud} (expected: ${EXPECTED_AUDIENCE}). denying.`,
          );
          rejectInvalidAuthentication(client, callback);
          return;
        }

        if (!isClientTransportOpen(client)) {
          return;
        }

        client.publicKey = publicKey;
        client.nodeName = getCachedNodeName(publicKey);
        client.tokenPayload = tokenPayload;

        const authLogPrefix = `[${client.nodeName || getUsefulClientId(client) || "unknown client"} (${shortPublicKey(publicKey)})]`;
        if (!(await claimObserverForClient(publicKey, client, authLogPrefix))) {
          logEvent(
            "Auth",
            `publisher ${describeClient(client)} denied because observer claim could not be taken.`,
          );
          completeAuthentication(client, callback, false);
          return;
        }

        if (!isClientTransportOpen(client)) {
          client.observerClaimed = false;
          return;
        }

        client.clientType = ClientType.PUBLISHER;

        let clients = observerClients.get(publicKey);
        if (!clients) {
          clients = new Set();
          observerClients.set(publicKey, clients);
        }
        clients.add(client);

        const streamMeta = getClientStreamMeta(client);
        abuseDetector.initializeClient(
          publicKey,
          client.nodeName || `v1_${publicKey}`,
          streamMeta.clientIP,
        );
        dashboardState.recordClientAuthenticated(client);
        markAuthenticationSucceeded(client);
        logEvent(
          "Auth",
          `publisher ${describeClient(client)} authenticated and claimed${tokenPayload.aud ? ` (audience: ${tokenPayload.aud})` : ""}.`,
        );

        completeAuthentication(client, callback, true);

        if (!client.nodeName) {
          void resolveNodeName(publicKey).then((nodeName) => {
            if (!nodeName || !isClientTransportOpen(client)) {
              return;
            }
            client.nodeName = nodeName;
            abuseDetector.rememberClientName(publicKey, nodeName);
            dashboardState.recordClientAuthenticated(client);
          });
        }
      } catch (error) {
        errorEvent(
          "Auth",
          `error during authentication for ${describeClient(client)}:`,
          error,
        );
        completeAuthentication(client, callback, false);
      }
    })();
  };

  aedes.authorizePublish = (client, packet, callback) => {
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

      if (packet.retain) {
        log.debug(
          `${logPrefix} Authorization: dropping MQTT retain flag -> ${packet.topic}`,
        );
        packet.retain = false;
      }

      if (clientType === ClientType.SUBSCRIBER) {
        const role: SubscriberRole = mc.role || SubscriberRole.LIMITED;
        const username = mc.username;

        if (
          username === DOCKER_HEALTH_USERNAME &&
          packet.topic === HEALTHCHECK_TOPIC
        ) {
          if (packet.payload.length > HEALTHCHECK_MAX_PAYLOAD_BYTES) {
            log.info(
              `${logPrefix} Authorization: healthcheck loopback denied (payload too large) -> ${packet.topic}`,
            );
            callback(new Error("Healthcheck loopback payload is too large"));
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
            log.info(
              `${logPrefix} Authorization: serial command denied (payload too large) -> ${packet.topic}`,
            );
            callback(new Error("serial/commands payload is too large"));
            return;
          }

          if (parsed?.subtopic === "serial/commands") {
            log.info(
              `${logPrefix} Authorization: serial admin command approved -> ${packet.topic}`,
            );
            callback(null);
            return;
          }

          log.info(
            `${logPrefix} Authorization: serial command denied (invalid topic format) -> ${packet.topic}`,
          );
          callback(new Error("Invalid serial/commands topic format"));
          return;
        }

        log.info(
          `${logPrefix} Authorization: publish denied (subscriber) -> ${packet.topic}`,
        );
        callback(new Error("Subscriber clients are subscribe-only"));
        return;
      }

      if (clientType === ClientType.PUBLISHER) {
        if (!packet.topic.startsWith("meshcore/")) {
          log.info(
            `${logPrefix} Authorization: publish denied -> ${packet.topic} (not meshcore/*)`,
          );
          callback(
            new Error("Publishers can only publish to meshcore/* topics"),
          );
          return;
        }

        const parsedTopic = parseMeshcoreTopic(packet.topic);
        if (!parsedTopic) {
          log.info(
            `${logPrefix} Authorization: publish denied -> ${packet.topic} (must follow meshcore/IATA/PUBKEY/subtopic format)`,
          );
          callback(
            new Error(
              "Topic must be meshcore/IATA/PUBKEY/subtopic format without empty segments or wildcards",
            ),
          );
          return;
        }

        const locationCode = parsedTopic.region;
        const iataRegex = /^[A-Z]{3}$/;

        if (locationCode === "XXX") {
          log.info(
            `${logPrefix} Authorization: publish denied -> ${packet.topic} (XXX is not valid, configure actual region code)`,
          );
          recordDeniedPublish(
            client,
            packet.topic,
            "Invalid region code: XXX",
            locationCode,
          );
          log.info(
            `${logPrefix} Disconnect: closing client - invalid location code: XXX`,
          );
          log.info(`${logPrefix} Disconnect: full topic: "${packet.topic}"`);
          callback(
            new Error(
              "XXX is a placeholder - please configure your actual IATA location code",
            ),
          );
          client.close();
          return;
        }

        const isTestRegion = locationCode.toLowerCase() === "test";

        if (isTestRegion) {
          log.info(
            `${logPrefix} Authorization: using test region -> ${packet.topic}`,
          );
        } else {
          if (!iataRegex.test(locationCode)) {
            log.info(
              `${logPrefix} Authorization: publish denied -> ${packet.topic} (invalid format)`,
            );
            recordDeniedPublish(
              client,
              packet.topic,
              "Invalid IATA format",
              locationCode,
            );
            log.info(
              `${logPrefix} Disconnect: closing client - invalid location format`,
            );
            log.info(
              `${logPrefix} Disconnect: location code: "${locationCode}" (length: ${locationCode.length})`,
            );
            log.info(
              `${logPrefix} Disconnect: location code hex: ${Buffer.from(locationCode).toString("hex")}`,
            );
            log.info(`${logPrefix} Disconnect: full topic: "${packet.topic}"`);
            callback(
              new Error(
                'Location must be exactly 3 uppercase letters (e.g., SEA, PDX, BOS) or "test"',
              ),
            );
            client.close();
            return;
          }

          const normalizedRegion = locationCode.toUpperCase();
          if (!isRegionAllowedForObserver(normalizedRegion)) {
            const denialInfo = getRegionDenialText(normalizedRegion);
            if (denialInfo) {
              log.info(
                `${logPrefix} Authorization: publish denied -> ${packet.topic} (${normalizedRegion} is a secondary IATA code)`,
              );
              recordDeniedPublish(
                client,
                packet.topic,
                denialInfo.reason,
                normalizedRegion,
                denialInfo.deniedUntilText,
              );
              callback(
                new Error(
                  `Region ${normalizedRegion} is not allowed on this broker`,
                ),
              );
              return;
            }
            const allowedList =
              ALLOWED_REGION_CODES.length > 0
                ? ALLOWED_REGION_CODES.join(", ")
                : "empty list";
            log.info(
              `${logPrefix} Authorization: publish denied -> ${packet.topic} (region ${normalizedRegion} missing from allowed list: ${allowedList})`,
            );
            recordDeniedPublish(
              client,
              packet.topic,
              `Region ${normalizedRegion} is not allowed`,
              normalizedRegion,
            );
            callback(
              new Error(
                `Region ${normalizedRegion} is not allowed on this broker`,
              ),
            );
            return;
          }
        }

        const topicPublicKey = parsedTopic.publicKey;

        if (!/^[0-9A-F]{64}$/i.test(topicPublicKey)) {
          log.info(
            `${logPrefix} Authorization: publish denied -> ${packet.topic} (invalid public key format)`,
          );
          log.info(
            `${logPrefix} Disconnect: closing client - invalid public key format in topic`,
          );
          log.info(
            `${logPrefix} Disconnect: public key in topic: "${topicPublicKey}" (length: ${topicPublicKey.length})`,
          );
          log.info(
            `${logPrefix} Disconnect: public key in topic as hex: ${Buffer.from(topicPublicKey).toString("hex")}`,
          );
          log.info(`${logPrefix} Disconnect: full topic: "${packet.topic}"`);
          callback(new Error("Public key in topic must be 64 hex characters"));
          client.close();
          return;
        }

        const clientPublicKey = mc.publicKey!.toUpperCase();
        if (topicPublicKey !== clientPublicKey) {
          log.info(
            `${logPrefix} Authorization: publish denied -> ${packet.topic} (public key mismatch)`,
          );
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
          callback(
            new Error(
              "Public key in topic must match authenticated public key",
            ),
          );
          client.close();
          return;
        }

        if (
          !(await ensureObserverClaimForClient(
            clientPublicKey,
            client,
            logPrefix,
          ))
        ) {
          log.info(
            `${logPrefix} Authorization: publish denied -> ${packet.topic} (missing observer claim)`,
          );
          callback(
            new Error("Broker does not own observer claim for this public key"),
          );
          client.close();
          return;
        }

        const normalizedLocation = isTestRegion
          ? "test"
          : locationCode.toUpperCase();
        const normalizedTopic = `meshcore/${normalizedLocation}/${clientPublicKey}/${parsedTopic.subtopic}`;
        mc.lastRegion = normalizedLocation;
        dashboardState.recordClientRegion(mc, normalizedLocation);

        if (packet.topic !== normalizedTopic) {
          log.info(
            `${logPrefix} Authorization: normalized topic: ${packet.topic} -> ${normalizedTopic}`,
          );
          packet.topic = normalizedTopic;
        }

        const subtopic = parsedTopic.subtopic;
        const subtopicRoot = subtopic.split("/")[0];

        if (subtopicRoot === "internal") {
          log.info(
            `${logPrefix} Authorization: publish denied -> ${packet.topic} (/internal is broker-owned)`,
          );
          callback(new Error("internal is a broker-owned subtopic"));
          return;
        }

        if (subtopic === "serial/commands") {
          log.info(
            `${logPrefix} Authorization: publish denied -> ${packet.topic} (serial/commands is admin only)`,
          );
          callback(new Error("serial/commands is admin-only"));
          return;
        }

        if (subtopicRoot === "serial" && subtopic !== "serial/responses") {
          log.info(
            `${logPrefix} Authorization: publish denied -> ${packet.topic} (reserved serial subtopic: ${subtopic})`,
          );
          callback(
            new Error(`Publisher serial subtopic is reserved: ${subtopic}`),
          );
          return;
        }

        if (subtopic === "serial/responses") {
          if (packet.payload.length > SERIAL_RESPONSE_MAX_BYTES) {
            log.info(
              `${logPrefix} Authorization: serial response denied -> ${packet.topic} (${packet.payload.length} bytes over ${SERIAL_RESPONSE_MAX_BYTES})`,
            );
            callback(new Error("serial/responses payload is too large"));
            return;
          }

          const payload = packet.payload.toString("utf-8");
          const jwtParts = payload.split(".");
          if (jwtParts.length !== 3) {
            log.info(
              `${logPrefix} Authorization: publish denied -> ${packet.topic} (invalid JWT form)`,
            );
            callback(
              new Error(
                "serial/responses payload must be a JWT-shaped payload",
              ),
            );
            return;
          }
          const base64urlRegex = /^[A-Za-z0-9_-]+$/;
          if (!jwtParts.every((part) => base64urlRegex.test(part))) {
            log.info(
              `${logPrefix} Authorization: publish denied -> ${packet.topic} (invalid JWT form)`,
            );
            callback(
              new Error(
                "serial/responses payload must be a JWT-shaped payload",
              ),
            );
            return;
          }

          let abuseAllowed: boolean;
          try {
            abuseAllowed = await evaluateAbuseForPublish(
              client,
              packet,
              normalizedLocation,
            );
          } catch (error) {
            log.error(
              `${logPrefix} Abuse: could not evaluate serial response against shared state:`,
              error,
            );
            callback(
              new Error("Could not validate publisher against broker state"),
            );
            return;
          }

          if (!abuseAllowed && abuseDetector.isEnforcementEnabled()) {
            log.info(
              `${logPrefix} Abuse: serial response denied by abuse policy -> ${packet.topic}`,
            );
            callback(new Error("Publisher muted by abuse policy"));
            return;
          }
          log.info(
            `${logPrefix} Authorization: publish approved (serial response) -> ${packet.topic}`,
          );
          callback(null);
          return;
        }

        try {
          if (packet.payload.length > JSON_PUBLISH_MAX_BYTES) {
            log.info(
              `${logPrefix} Authorization: publish denied -> ${packet.topic} (${packet.payload.length} bytes over JSON limit ${JSON_PUBLISH_MAX_BYTES})`,
            );
            callback(new Error("MQTT JSON publish payload is too large"));
            return;
          }

          const payload = packet.payload.toString("utf-8");
          const message = JSON.parse(payload) as Record<string, unknown>;
          rememberClientNameFromMessage(client, subtopic, message);

          if (!message.origin_id) {
            log.info(
              `${logPrefix} Authorization: publish denied -> ${packet.topic} (origin_id missing)`,
            );
            callback(new Error("Message must contain origin_id field"));
            return;
          }

          const messageOriginId = (message.origin_id as string).toUpperCase();
          const normalizedClientKey = clientPublicKey.toUpperCase();

          if (messageOriginId !== normalizedClientKey) {
            log.info(
              `${logPrefix} Authorization: publish denied -> ${packet.topic} (origin_id mismatch)`,
            );
            callback(
              new Error("origin_id must match authenticated public key"),
            );
            return;
          }

          if (
            subtopic === "status" &&
            !(await acceptStatusTimestampFromValkey(
              clientPublicKey,
              message,
              logPrefix,
            ))
          ) {
            callback(new Error("Stale status message"));
            return;
          }

          const abuseAllowed = await evaluateAbuseForPublish(
            client,
            packet,
            normalizedLocation,
          );

          if (!abuseAllowed && abuseDetector.isEnforcementEnabled()) {
            log.info(
              `${logPrefix} Abuse: publish denied by abuse policy -> ${packet.topic}`,
            );
            callback(new Error("Publisher muted by abuse policy"));
            return;
          }

          log.info(
            `${logPrefix} Authorization: publish approved -> ${packet.topic}`,
          );

          const tokenPayload = mc.tokenPayload;
          if (tokenPayload) {
            const internalTopic = `meshcore/${normalizedLocation}/${clientPublicKey}/internal`;

            const trustState = abuseDetector.getClientStats(clientPublicKey);
            let trustMetrics: Record<string, unknown> | null = null;

            if (trustState) {
              const clockQuality =
                trustState.clockTracking.erraticJumps.length === 0
                  ? "stable"
                  : trustState.clockTracking.erraticJumps.length < 3
                    ? "syncing"
                    : "erratic";

              trustMetrics = {
                status: trustState.status,
                enforcement_enabled: abuseConfig.enforcementEnabled,
                mutedAt: trustState.mutedAt,
                mutedUntil: trustState.mutedUntil,
                muteReason: trustState.muteReason,
                abuseBlockCount: trustState.abuseBlockCount,
                totalPacketsReceived: trustState.totalPacketsReceived,
                totalPacketsSilenced: trustState.totalPacketsSilenced,
                duplicateCount: trustState.duplicateCount,
                anomalyCount: trustState.anomalyCount,
                anomalies: trustState.anomalies.slice(0, 20).map((a) => ({
                  type: a.type,
                  details: a.details,
                  timestamp: a.timestamp,
                })),
                peakRateObserved:
                  Math.round(trustState.peakRateObserved * 100) / 100,
                tokenBucket: {
                  tokens: Math.round(trustState.tokenBucket.tokens * 10) / 10,
                  capacity: trustState.tokenBucket.capacity,
                },
                iataTracking: {
                  currentIata: trustState.currentIata,
                  iataChangeCount24h: trustState.iataChangeCount24h,
                  iataHistory: trustState.iataHistory.map((h) => h.iata),
                },
                clockTracking: {
                  estimatedOffset: trustState.clockTracking.estimatedOffset
                    ? Math.round(
                        trustState.clockTracking.estimatedOffset / 1000,
                      )
                    : undefined,
                  erraticJumpCount:
                    trustState.clockTracking.erraticJumps.length,
                  lastDeviceTimestamp:
                    trustState.clockTracking.lastDeviceTimestamp,
                  clockQuality,
                },
                recentIPs: trustState.recentIPs.slice(0, 10).map((ip) => ({
                  ip: ip.ip,
                  connectionCount: ip.connectionCount,
                  lastSeen: ip.lastSeen,
                })),
              };
            }

            const internalMessage = {
              origin_id: clientPublicKey,
              timestamp: Date.now(),
              jwt_payload: tokenPayload,
              trust_state: trustMetrics,
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
          log.info(
            `${logPrefix} Authorization: publish denied -> ${packet.topic} (invalid JSON or validation error)`,
          );
          callback(
            new Error("Invalid message format or origin_id validation failed"),
          );
        }
        return;
      }

      log.info(
        `${logPrefix} Authorization: publish denied -> ${packet.topic} (unknown client type)`,
      );
      callback(new Error("Unknown client type"));
    })();
  };

  aedes.authorizeSubscribe = (
    client: MeshAedesClient,
    subscription,
    callback,
  ) => {
    if (!client) {
      callback(new Error("No client"));
      return;
    }

    const logPrefix = getClientLogPrefix(client);
    const clientType = client.clientType;

    if (clientType === ClientType.PUBLISHER) {
      const parsedTopic = parseMeshcoreTopic(subscription.topic);
      if (parsedTopic?.subtopic === "serial/commands") {
        const clientPublicKey = (client.publicKey || "").toUpperCase();
        const isOwnPublicKey =
          parsedTopic.publicKey === clientPublicKey &&
          clientPublicKey.length === 64;

        if (isOwnPublicKey && isRegionAllowedForObserver(parsedTopic.region)) {
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
      callback(new Error("Publisher clients are publish-only"));
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
        (topic.startsWith("meshcore/") &&
          !topic.includes("/internal") &&
          !topic.includes("/serial/"));

      if (
        (!isPublicMeshcoreTopic && !isHeartbeatTopic) ||
        topic.startsWith("$SYS/")
      ) {
        log.info(
          `${logPrefix} Authorization: subscribe denied (only public meshcore topics, heartbeat and internal healthcheck loopback for role ${role}) -> ${subscription.topic}`,
        );
        callback(
          new Error(
            "Subscribers may only subscribe to public meshcore topics and heartbeat",
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
    callback(new Error("Unknown client type"));
  };

  aedes.authorizeForward = (client: MeshAedesClient, packet) => {
    if (!client) {
      return packet;
    }

    const clientType = client.clientType;
    const role = client.role;

    if (clientType === ClientType.SUBSCRIBER && role !== SubscriberRole.ADMIN) {
      if (packet.topic.startsWith("$SYS/")) {
        return null;
      }
    }

    if (clientType === ClientType.SUBSCRIBER && role !== SubscriberRole.ADMIN) {
      if (packet.topic.includes("/internal")) {
        return null;
      }
    }

    if (clientType === ClientType.SUBSCRIBER && role !== SubscriberRole.ADMIN) {
      if (packet.topic.includes("/serial/")) {
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
    }

    return packet;
  };

  aedes.on("client", (client: MeshAedesClient) => {
    client.stream = client.conn;

    const logPrefix = getClientLogPrefix(client);
    log.info(`${logPrefix} Client: connected`);
    log.info(
      `${logPrefix} Client: connection details - conn exists: ${!!client.conn}, client IP: ${(client.conn as unknown as { clientIP?: string }).clientIP}`,
    );

    client.connectedAt = Date.now();
    dashboardState.recordClientConnected(client);

    const stream = client.stream as
      (Duplex & { close?(...args: unknown[]): void }) | undefined;
    if (stream) {
      const originalClose = stream.close?.bind(stream);
      const originalDestroy = stream.destroy?.bind(stream);

      const _stream = stream as unknown as Record<
        string,
        (...args: unknown[]) => void
      >;

      _stream.close = (...args: unknown[]) => {
        log.info(
          `${logPrefix} Stream: close() called (server-initiated close)`,
        );
        if (originalClose) originalClose(...args);
      };

      _stream.destroy = (...args: unknown[]) => {
        const errMsg = args[0] instanceof Error ? args[0].message : undefined;
        log.info(
          `${logPrefix} Stream: destroy() called - error: ${errMsg ?? "none"}`,
        );
        if (originalDestroy)
          originalDestroy(args[0] instanceof Error ? args[0] : undefined);
      };
    }
  });

  aedes.on("clientDisconnect", (client: MeshAedesClient) => {
    const logPrefix = getClientLogPrefix(client);
    const connectedAt = client.connectedAt;
    const duration = connectedAt
      ? Math.round((Date.now() - connectedAt) / 1000)
      : "unknown";

    log.info(`${logPrefix} Client: disconnected (connected for ${duration}s)`);
    dashboardState.recordClientDisconnected(client);
    clusterStateStore
      .setInstanceObservers(dashboardState.getObserverEntries())
      .catch((error) => {
        log.error(
          `${logPrefix} Dashboard: could not update observer list after disconnect:`,
          error,
        );
      });

    if (client) {
      log.info(
        `${logPrefix} Client: disconnect details - client type: ${client.clientType}, public key: ${client.publicKey?.substring(0, 8)}`,
      );

      const clientType = client.clientType;
      const username = client.username;
      if (clientType === ClientType.SUBSCRIBER && username) {
        releaseSubscriberConnection(
          username,
          client.id,
          client.subscriberConnectionId,
        )
          .then((activeConnections) => {
            const maxConn =
              subscriberMaxConnections.get(username) ||
              subscriberConfig.defaultMaxConnections;
            const scope =
              client.connectionLimitScope ||
              (username !== DOCKER_HEALTH_USERNAME ? "cluster" : "local");
            const connectionText =
              activeConnections === undefined
                ? `scope: ${scope}`
                : `connections: ${activeConnections}/${maxConn}, scope: ${scope}`;
            log.info(
              `${logPrefix} Client: subscriber connection removed (${username}, ${connectionText})`,
            );
          })
          .catch((error) => {
            log.error(
              `${logPrefix} Client: could not remove subscriber connection (${username}) from cluster state:`,
              error,
            );
          });
      }

      const publicKey = client.publicKey;
      if (publicKey) {
        const clients = observerClients.get(publicKey);
        if (clients) {
          clients.delete(client);
          if (clients.size === 0) {
            observerClients.delete(publicKey);
            lastClaimAttempt.delete(publicKey);
            clusterStateStore
              .releaseObserverClaim(publicKey)
              .then((released) => {
                if (released) {
                  log.debug(
                    `${logPrefix} Observer claim: released claim for ${shortPublicKey(publicKey)}`,
                  );
                }
              })
              .catch((error) => {
                log.error(
                  `${logPrefix} Observer claim: could not release claim for ${shortPublicKey(publicKey)}:`,
                  error,
                );
              });
          }
        }
      }
    }
  });

  aedes.on("publish", (packet, client: MeshAedesClient | null) => {
    meshcoreIoRuntime.offerPublish(
      packet.topic,
      Buffer.isBuffer(packet.payload)
        ? packet.payload
        : Buffer.from(packet.payload),
    );
    if (client) {
      const pkt = packet;
      dashboardState.recordPublish(pkt, client);
      targetBridge?.forwardPublish(pkt, client);
      const logPrefix = getClientLogPrefix(client);
      const publicKey = client.publicKey;
      if (publicKey) {
        const now = Date.now();
        const last = lastClaimAttempt.get(publicKey);
        if (!last || now - last >= CLAIM_THROTTLE_MS) {
          lastClaimAttempt.set(publicKey, now);
          ensureObserverClaimForClient(publicKey, client, logPrefix).catch(
            () => {},
          );
        }
      }
      log.info(
        `${logPrefix} Publish: ${packet.topic} (${packet.payload.length} bytes)`,
      );
      log.info(
        `${logPrefix} Valkey: cluster publish via Aedes MQ -> ${packet.topic} (${packet.payload.length} bytes)`,
      );
    } else {
      log.info(
        `Publish: internal -> ${packet.topic} (${packet.payload.length} bytes)`,
      );
      log.debug(
        `Valkey: internal cluster publish via Aedes MQ -> ${packet.topic} (${packet.payload.length} bytes)`,
      );
    }
  });

  aedes.on("subscribe", (subscriptions, client: MeshAedesClient) => {
    const logPrefix = getClientLogPrefix(client);
    log.info(
      `${logPrefix} Subscribe: attempting to subscribe to: ${subscriptions.map((s) => s.topic).join(", ")}`,
    );
    log.info(
      `${logPrefix} Valkey: subscription synced via Aedes persistence -> ${subscriptions.map((s) => s.topic).join(", ")}`,
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

  const httpServer = createServer((req, res) => {
    if (
      !req.headers.upgrade ||
      req.headers.upgrade.toLowerCase() !== "websocket"
    ) {
      log.info(
        `HTTP: non-WebSocket request from ${getClientIP(req)}, redirecting to analyzer`,
      );
      res.writeHead(301, { Location: "https://analyzer.letsmesh.net/" });
      res.end();
      return;
    }
  });

  httpServer.on("error", (error) => {
    log.error("MQTT HTTP server error:", error.message);
  });

  const dashboard = createDashboardServer({
    host: HOST,
    port: DASHBOARD_PORT,
    clusterStateStore,
    state: dashboardState,
    instanceId: mqttConfig.instanceId,
    namespace: mqttConfig.kvNamespace,
    activeBans: countActiveBans,
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
      const clientIP = getClientIP(req);

      if (rateLimiter.isBlocked(clientIP)) {
        log.info(
          `RateLimit: rejecting connection from blocked IP: ${clientIP}`,
        );
        ws.terminate();
        return;
      }

      log.info(`WebSocket: new WebSocket connection from ${clientIP}`);

      ws.on("ping", () => {
        log.info(
          `WebSocket: received WebSocket PING from ${clientIP}, automatic PONG sent`,
        );
      });

      ws.on("pong", () => {
        log.info(`WebSocket: received WebSocket PONG from ${clientIP}`);
      });

      ws.on("error", (error) => {
        log.error("WebSocket: error from %s: %s", clientIP, error.message);
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
            `WebSocket: closing ${clientIP}: transport payload ${byteLength} bytes over the limit ${WS_MAX_PAYLOAD_BYTES}`,
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
      streamMeta.clientIP = clientIP;
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
            `${logPrefix} WebSocket: connection closed from ${clientIP} - code: ${code}, reason: ${reason.toString() || "none"}`,
          );
        } else {
          log.info(
            `[${describeClient(clientInfo as MeshAedesClient)}] WebSocket: connection closed (unauthenticated) from ${clientIP} - code: ${code}, reason: ${reason.toString() || "none"}`,
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

  await Promise.all([orchestrationRuntime.ready(), meshcoreIoRuntime.ready]);
  await aedes.listen();
  const boundDashboardPort = await dashboard.listen();

  await new Promise<void>((resolve, reject) => {
    const onListenError = (error: Error) => {
      httpServer.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.removeListener("error", onListenError);
      const address = httpServer.address();
      const boundPort =
        typeof address === "object" && address ? address.port : WS_PORT;
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
        `Read-only dashboard listening on: http://${HOST}:${boundDashboardPort}`,
      );
      log.info(
        `Orchestration: valkey (${mqttConfig.kvNamespace}, ${mqttConfig.instanceId})`,
      );
      log.info("");
      log.info("Authentication modes:");
      log.info(
        `  1. Subscribers (subscribe-only): ${subscriberUsers.size} users configured`,
      );
      log.info(
        "     Usernames:",
        Array.from(subscriberUsers.keys()).join(", "),
      );
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
      resolve();
    };

    httpServer.once("error", onListenError);
    httpServer.once("listening", onListening);
    httpServer.listen(WS_PORT, HOST);
  });

  publishHeartbeat();
  heartbeatTimer = setInterval(publishHeartbeat, BROKER_HEARTBEAT_INTERVAL_MS);
  nodeNameCleanupTimer = setInterval(pruneStaleNodeNames, 60 * 60 * 1000);
  dashboardMetricsTimer = setInterval(() => {
    void (async () => {
      if (dashboardMetricsRunning) return;
      dashboardMetricsRunning = true;

      try {
        const connectedKeys = dashboardState.getConnectedObserverKeys();
        for (const publicKey of connectedKeys) {
          const stillOwned = await clusterStateStore
            .renewObserverClaim(publicKey)
            .catch((error) => {
              log.error(
                `Observer claim: could not check claim for ${shortPublicKey(publicKey)} against Valkey:`,
                error,
              );
              return undefined;
            });
          if (stillOwned === undefined) {
            continue;
          }
          if (!stillOwned) {
            const owner = await clusterStateStore
              .getObserverClaim(publicKey)
              .catch((error) => {
                log.error(
                  `Observer claim: could not read claim owner for ${shortPublicKey(publicKey)} after failed renewal:`,
                  error,
                );
                return undefined;
              });
            if (owner === undefined) {
              continue;
            }
            if (owner === null) {
              const clients = observerClients.get(publicKey);
              const firstClient = clients?.values().next().value;
              const claimed = firstClient
                ? await claimObserverForClient(
                    publicKey,
                    firstClient,
                    getClientLogPrefix(firstClient),
                  )
                : false;
              if (claimed) {
                log.info(
                  `Observer claim: claim for ${shortPublicKey(publicKey)} was missing from Valkey; re-claiming for ${mqttConfig.instanceId}`,
                );
                continue;
              }
            }

            const clients = observerClients.get(publicKey);
            if (clients) {
              for (const c of clients) {
                log.info(
                  `Observer claim: claim for ${shortPublicKey(publicKey)} ${owner ? `owned by ${owner}` : "no longer"}; closing only local observer connection`,
                );
                c.close();
              }
              observerClients.delete(publicKey);
            }
          }
        }

        const localMetrics = dashboardState.getLocalMetrics(countActiveBans());
        const localObserverEntries = dashboardState.getObserverEntries();
        await Promise.all([
          clusterStateStore.setInstanceMetrics(localMetrics),
          clusterStateStore.setInstanceObservers(localObserverEntries),
        ]);
      } catch (error) {
        log.error("Dashboard: could not write instance data:", error);
      } finally {
        dashboardMetricsRunning = false;
      }
    })();
  }, 10_000);
  log.info(
    `Heartbeat: publishing ${BROKER_HEARTBEAT_TOPIC} every ${BROKER_HEARTBEAT_INTERVAL_MS / 1000}s`,
  );

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : WS_PORT;

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

  function closeHttpServer(
    server: ReturnType<typeof createServer>,
    label: string,
  ): Promise<void> {
    return withShutdownTimeout(
      label,
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setImmediate(() => server.closeAllConnections?.());
      }),
    ).then(() => undefined);
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
    return withShutdownTimeout(
      "Aedes closing",
      new Promise<void>((resolve) => {
        broker.close(() => resolve());
      }),
    ).then(() => undefined);
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
      dashboardMetricsRunning = false;
      if (dashboardMetricsTimer) {
        clearInterval(dashboardMetricsTimer);
        dashboardMetricsTimer = null;
      }

      try {
        await closeWebSocketServer(wsServer);
        await Promise.all([
          closeHttpServer(httpServer, "MQTT HTTP server closing"),
          closeHttpServer(dashboard.server, "dashboard server closing"),
        ]);
        await withShutdownTimeout(
          "Meshcore.io integration closing",
          meshcoreIoRuntime.stop(),
        ).catch((error) => {
          log.error(
            "Shutdown: could not cleanly stop Meshcore.io integration:",
            error,
          );
        });
        if (targetBridge) {
          await withShutdownTimeout(
            "target bridge closing",
            targetBridge.stop(),
          ).catch((error) => {
            log.error("Shutdown: could not cleanly stop target bridge:", error);
          });
        }
        await closeAedesBroker(aedes);
        const releasedClaims = await withShutdownTimeout(
          "observer claims released",
          clusterStateStore.releaseObserverClaimsForInstance(),
        );
        observerClients.clear();
        lastClaimAttempt.clear();
        if (releasedClaims !== undefined) {
          log.info(
            `Shutdown: released ${releasedClaims} observer claims for ${mqttConfig.instanceId}`,
          );
        }
      } finally {
        abuseDetector.shutdown();
        await orchestrationRuntime.close().catch((error) => {
          log.error(
            "Shutdown: could not cleanly close orchestration state:",
            error,
          );
        });
        log.info("Shutdown: broker stopped");
      }
    })();

    return stopPromise;
  }

  return {
    aedes,
    abuseDetector,
    httpServer,
    dashboardServer: dashboard.server,
    wsServer,
    port,
    dashboardPort: boundDashboardPort,
    publishHeartbeat,
    stop,
    healthcheckCredentialsFile: healthcheckCredentialsFilePath,
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
