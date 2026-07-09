import { createRequire } from "module";
import { randomUUID } from "crypto";
import { Redis, type RedisOptions } from "ioredis";
import type { AedesOptions } from "aedes";

const require = createRequire(import.meta.url);
const aedesPersistenceRedis = require("aedes-persistence-redis") as (
  options: Record<string, unknown>,
) => unknown;
const mqemitterRedis = require("mqemitter-redis") as {
  MQEmitterRedisPrefix: new (
    prefix: string,
    options: Record<string, unknown>,
  ) => unknown;
};

export interface OrchestrationConfig {
  kvUrl: string;
  namespace: string;
  instanceId: string;
  backgroundRefresh?: boolean;
}

interface RegisteredConnection {
  key: string;
  member: string;
  connectionId: string;
}

interface ValkeyWriteMetadata {
  lastUpdatedByInstance: string;
  lastUpdatedAt: number;
}

interface ErrorEventSource {
  on(event: "error", listener: (error: Error) => void): unknown;
}

const CONNECTION_TTL_MS = 90_000;
const CONNECTION_REFRESH_MS = 30_000;
const VALKEY_CONNECT_TIMEOUT_MS = 5_000;
const TRUST_STATE_LOCK_TTL_MS = 5_000;
const TRUST_STATE_LOCK_WAIT_MS = 2_000;
const INSTANCE_READINESS_TTL_MS = 90_000;
// Must exceed the 120s stale threshold in publicBrokerMetrics() so metrics keys
// can still be classified as stale before expiring (rather than just disappearing).
const INSTANCE_METRICS_TTL_MS = 150_000;
export const TRUST_STATE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const AEDES_PACKET_TTL_SECONDS = 24 * 60 * 60;
const DENIED_PUBLISH_TTL_MS = 24 * 60 * 60 * 1000;

export class DuplicateBrokerInstanceIdError extends Error {
  constructor(instanceId: string) {
    super(`Broker instance ID ${instanceId} is already registered in Valkey`);
    this.name = "DuplicateBrokerInstanceIdError";
  }
}

export interface InstanceObserverMessage {
  topic: string;
  broker: string;
  region?: string;
  observer?: string;
  publicKey?: string;
  subtopic?: string;
  bytes: number;
  receivedAt: number;
}

export interface InstanceObserverEntry {
  label: string;
  publicKey: string;
  broker: string;
  region?: string;
  active: boolean;
  lastConnectedAt: number;
  lastSeenAt: number;
  messageCount: number;
  messages: InstanceObserverMessage[];
}

export interface DashboardInstanceMetrics {
  instanceId: string;
  connectedClients: number;
  subscriberClients: number;
  publisherClients: number;
  messagesPerSecond: number;
  messagesLastMinute: number;
  targetBridge?: {
    enabled: boolean;
    connected: boolean;
    targetUrl?: string;
    targetHost?: string;
    clientId?: string;
    droppedMessages: number;
    successfulMessages: number;
  };
  activeBans: number;
  localReady: boolean;
  startedAt: number;
  lastUpdatedAt: number;
  lastUpdatedByInstance: string;
}

export interface ClusterInstanceReadiness {
  instanceId: string;
  status: string;
  namespace?: string;
  lastUpdatedAt?: number;
  lastUpdatedByInstance?: string;
}

export interface PublicBanSummary {
  node: string;
  label?: string;
  broker: string;
  reason: string;
  blockCount: number;
  mutedUntil?: number;
  status: "muted" | "would_mute" | "denied";
  lastUpdatedAt?: number;
  topic?: string;
  region?: string;
  deniedUntilText?: string;
}

export interface DeniedPublishInput {
  node: string;
  label?: string;
  reason: string;
  topic: string;
  region?: string;
  deniedUntilText?: string;
}

export interface SubscriberBrokerSummary {
  brokerId: string;
  connectionCount: number;
  lastSeenAt: number;
}

export interface SubscriberConnectionEntry {
  username: string;
  connectionCount: number;
  lastSeenAt: number;
  brokers: SubscriberBrokerSummary[];
}

function redactKvUrl(kvUrl: string): string {
  try {
    const parsed = new URL(kvUrl);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return kvUrl.replace(/(:\/\/[^:\s]+:)[^@\s]+@/, "$1***@");
  }
}

function valkeyRedisOptions(): RedisOptions {
  return {
    enableAutoPipelining: true,
    connectTimeout: VALKEY_CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      return Math.min(times * 250, 5_000);
    },
  };
}

function valkeyAdapterOptions(
  kvUrl: string,
): RedisOptions & { connectionString: string } {
  return {
    ...valkeyRedisOptions(),
    connectionString: kvUrl,
  };
}

function valkeyPersistenceConnection(kvUrl: string, namespace: string): Redis {
  return new Redis(kvUrl, {
    ...valkeyRedisOptions(),
    keyPrefix: `${namespace}:aedes:`,
  });
}

function isErrorEventSource(value: unknown): value is ErrorEventSource {
  return typeof (value as ErrorEventSource | undefined)?.on === "function";
}

function attachValkeyErrorLogger(
  source: string,
  kvUrl: string,
  eventSource: unknown,
): void {
  if (!isErrorEventSource(eventSource)) {
    return;
  }

  eventSource.on("error", (error: Error) => {
    console.error(
      `[VALKEY] ${source}-fel mot ${redactKvUrl(kvUrl)}:`,
      error.message,
    );
  });
}

function normalizeNamespace(namespace: string): string {
  return (
    namespace
      .trim()
      .replace(/[^A-Za-z0-9:_-]/g, "-")
      .replace(/:+$/g, "") || "meshcore-mqtt-broker"
  );
}

function keyPart(value: string): string {
  return encodeURIComponent(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addWriteMetadata(
  stateJson: string,
  metadata: ValkeyWriteMetadata,
): string {
  const parsed = JSON.parse(stateJson) as Record<string, unknown>;
  return JSON.stringify({
    ...parsed,
    ...metadata,
  });
}

export function normalizePublicKey(publicKey: string): string {
  return publicKey.trim().toUpperCase();
}

export function validatePublicKey(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length > 128) {
    return null;
  }
  const uppered = trimmed.toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(uppered)) {
    return null;
  }
  return uppered;
}

function formatPublicMuteReason(reason: string | undefined): string {
  if (!reason) {
    return "Okänd orsak";
  }

  if (reason.startsWith("anomaly_threshold_exceeded")) {
    return "Avvikelsegräns";
  }
  if (reason.startsWith("iata_changes_exceeded")) {
    return "Regionbyten";
  }

  switch (reason) {
    case "rate_limit_exceeded":
      return "Hastighetsgräns";
    case "anomaly:packet_size":
      return "Avvikande paketstorlek";
    case "anomaly:excessive_packet_copies":
      return "För många paketkopior";
    case "anomaly:high_duplicate_rate":
      return "Hög dubblettandel";
    case "iata_changes_exceeded":
      return "Regionbyten";
    case "wrong_audience":
      return "Ogiltig audience";
    default:
      return reason;
  }
}

export class ClusterStateStore {
  private redis: Redis;
  private namespace: string;
  private instanceId: string;
  private brokerRuntimeToken: string;
  private kvUrl: string;
  private refreshTimer?: NodeJS.Timeout;
  private registeredConnections = new Map<string, RegisteredConnection>();

  constructor(config: OrchestrationConfig) {
    this.namespace = normalizeNamespace(config.namespace);
    this.instanceId = config.instanceId;
    this.brokerRuntimeToken = randomUUID();
    this.kvUrl = config.kvUrl;
    this.redis = new Redis(config.kvUrl, valkeyRedisOptions());

    this.redis.on("error", (error: Error) => {
      console.error(
        `[VALKEY] Anslutningsfel mot ${redactKvUrl(this.kvUrl)}:`,
        error.message,
      );
    });

    if (config.backgroundRefresh !== false) {
      this.refreshTimer = setInterval(() => {
        this.refreshRegisteredConnections().catch((error) => {
          if (error instanceof DuplicateBrokerInstanceIdError) {
            console.error(
              `[ORKESTRERING] ${error.message}. Avslutar så orchestratorn kan starta en ny broker med nytt ID.`,
            );
            process.exit(1);
          }
          console.error(
            "[ORKESTRERING] Kunde inte förnya klusteranslutningar:",
            error,
          );
        });
      }, CONNECTION_REFRESH_MS);
    }
  }

  async ready(): Promise<void> {
    console.log(
      `[VALKEY] PING startar mot ${redactKvUrl(this.kvUrl)} (namespace: ${this.namespace}, instans: ${this.instanceId})`,
    );
    await this.redis.ping();
    await this.writeInstanceReadiness();
    console.log(`[VALKEY] PING OK mot ${redactKvUrl(this.kvUrl)}`);
  }

  private key(suffix: string): string {
    return `${this.namespace}:${suffix}`;
  }

  private subscriberConnectionsKey(username: string): string {
    return this.key(`subscribers:${keyPart(username)}:connections`);
  }

  private instanceReadinessKey(): string {
    return this.key(`instances:${keyPart(this.instanceId)}:ready`);
  }

  private instanceMetricsKey(instanceId = this.instanceId): string {
    return this.key(`instances:${keyPart(instanceId)}:metrics`);
  }

  private instanceObserversKey(instanceId = this.instanceId): string {
    return this.key(`instances:${keyPart(instanceId)}:observers`);
  }

  private observerClaimKey(publicKey: string): string {
    return this.key(`observers:${keyPart(publicKey)}:claim`);
  }

  private observerNodeNameKey(publicKey: string): string {
    return this.key(`observers:${keyPart(publicKey)}:node-name`);
  }

  private observerStatusTimestampKey(publicKey: string): string {
    return this.key(`observers:${keyPart(publicKey)}:status-timestamp`);
  }

  private trustStateKey(publicKey: string): string {
    return this.key(`abuse:trust:${publicKey.toUpperCase()}`);
  }

  private trustStateLockKey(publicKey: string): string {
    return this.key(`locks:abuse:trust:${publicKey.toUpperCase()}`);
  }

  private bansIndexKey(): string {
    return this.key("abuse:bans:index");
  }

  private deniedPublishesIndexKey(): string {
    return this.key("denied:index");
  }

  private deniedPublishKey(id: string): string {
    return this.key(`denied:events:${id}`);
  }

  private instancesIndexKey(): string {
    return this.key("instances:index");
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    let cursor = "0";
    const keys: string[] = [];

    do {
      const [nextCursor, batch] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");

    return keys;
  }

  async resetNamespace(): Promise<number> {
    const keys = await this.scanKeys(this.key("*"));
    if (keys.length === 0) {
      return 0;
    }

    let removed = 0;
    for (let index = 0; index < keys.length; index += 500) {
      const batch = keys.slice(index, index + 500);
      removed += await this.redis.del(...batch);
    }
    return removed;
  }

  private connectionMember(clientId: string, connectionId: string): string {
    return JSON.stringify({
      clientId,
      connectionId,
      lastUpdatedByInstance: this.instanceId,
    });
  }

  private instanceReadinessPayload(now = Date.now()): string {
    return JSON.stringify({
      status: "ready",
      lastUpdatedByInstance: this.instanceId,
      lastUpdatedAt: now,
      namespace: this.namespace,
      brokerRuntimeToken: this.brokerRuntimeToken,
    });
  }

  private async writeInstanceReadiness(now = Date.now()): Promise<void> {
    const key = this.instanceReadinessKey();
    const payload = this.instanceReadinessPayload(now);
    const script = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, parsed = pcall(cjson.decode, current)
  if not ok or parsed['brokerRuntimeToken'] ~= ARGV[4] then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[5])
return 1
`;
    const result = (await this.redis.eval(
      script,
      2,
      key,
      this.instancesIndexKey(),
      payload,
      INSTANCE_READINESS_TTL_MS,
      now,
      this.brokerRuntimeToken,
      keyPart(this.instanceId),
    )) as number;
    if (Number(result) !== 1) {
      throw new DuplicateBrokerInstanceIdError(this.instanceId);
    }
    console.log(
      `[VALKEY] Readiness uppdaterad lastUpdatedByInstance=${this.instanceId} lastUpdatedAt=${now} ttlMs=${INSTANCE_READINESS_TTL_MS} key=${key}`,
    );
  }

  async tryRegisterSubscriberConnection(
    username: string,
    clientId: string,
    maxConnections: number,
  ): Promise<{
    allowed: boolean;
    activeConnections: number;
    connectionId: string;
  }> {
    const key = this.subscriberConnectionsKey(username);
    const connectionId = randomUUID();
    const member = this.connectionMember(clientId, connectionId);
    const now = Date.now();
    const staleBefore = now - CONNECTION_TTL_MS;

    const script = `
      redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
      local members = redis.call('ZRANGE', KEYS[1], 0, -1)
      for _, existing in ipairs(members) do
        local ok, parsed = pcall(cjson.decode, existing)
        if ok and parsed['clientId'] == ARGV[6] and parsed['lastUpdatedByInstance'] == ARGV[7] then
          redis.call('ZREM', KEYS[1], existing)
        end
      end
      local count = redis.call('ZCARD', KEYS[1])
      if count >= tonumber(ARGV[2]) then
        redis.call('PEXPIRE', KEYS[1], ARGV[5])
        return {0, count}
      end
      redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
      redis.call('PEXPIRE', KEYS[1], ARGV[5])
      return {1, count + 1}
    `;

    const result = (await this.redis.eval(
      script,
      1,
      key,
      staleBefore,
      maxConnections,
      now,
      member,
      CONNECTION_TTL_MS,
      clientId,
      this.instanceId,
    )) as [number, number];

    const allowed = Number(result[0]) === 1;
    const activeConnections = Number(result[1]);

    if (allowed) {
      const regKey = JSON.stringify([username, clientId, connectionId]);
      const staleRegPrefix = JSON.stringify([username, clientId]).slice(0, -1);
      for (const existingKey of this.registeredConnections.keys()) {
        if (existingKey.startsWith(`${staleRegPrefix},`)) {
          this.registeredConnections.delete(existingKey);
        }
      }
      this.registeredConnections.set(regKey, { key, member, connectionId });
    }

    console.log(
      `[VALKEY] Skrivning prenumerantanslutning user=${username} client=${clientId} ` +
        `connectionId=${connectionId} lastUpdatedByInstance=${this.instanceId} ` +
        `lastUpdatedAt=${now} resultat=${allowed ? "registrerad" : "nekad"} ` +
        `aktiva=${activeConnections}/${maxConnections} key=${key}`,
    );

    return { allowed, activeConnections, connectionId };
  }

  async releaseSubscriberConnection(
    username: string,
    clientId: string,
    connectionId?: string,
  ): Promise<void> {
    let registrationKey: string | undefined;
    if (connectionId) {
      registrationKey = JSON.stringify([username, clientId, connectionId]);
    } else {
      const prefix = JSON.stringify([username, clientId]).slice(0, -1);
      registrationKey = Array.from(this.registeredConnections.keys()).find(
        (key) => key.startsWith(`${prefix},`),
      );
    }

    const registered = registrationKey
      ? this.registeredConnections.get(registrationKey)
      : undefined;

    if (!registrationKey || !registered) {
      console.warn(
        `[VALKEY] Varning: release av okänd prenumerantanslutning user=${username} client=${clientId} — ingen lokal registration hittad, hoppar över ZREM`,
      );
      return;
    }

    this.registeredConnections.delete(registrationKey);
    const removed = await this.redis.zrem(registered.key, registered.member);
    console.log(
      `[VALKEY] Radering prenumerantanslutning user=${username} client=${clientId} ` +
        `connectionId=${registered.connectionId} lastUpdatedByInstance=${this.instanceId} ` +
        `borttagna=${removed} key=${registered.key}`,
    );
  }

  async listSubscriberConnections(): Promise<SubscriberConnectionEntry[]> {
    const pattern = this.key("subscribers:*:connections");
    const keys = await this.scanKeys(pattern);
    if (keys.length === 0) {
      return [];
    }

    const now = Date.now();
    const staleBefore = now - CONNECTION_TTL_MS;
    const prefix = this.key("subscribers:");
    const suffix = ":connections";

    const pipeline = this.redis.pipeline();
    for (const key of keys) {
      pipeline.zremrangebyscore(key, "-inf", staleBefore);
      pipeline.zrange(key, 0, -1, "WITHSCORES");
    }
    const results = (await pipeline.exec()) || [];

    const byUsername = new Map<
      string,
      Map<string, { count: number; lastSeenAt: number }>
    >();

    for (let i = 0; i < keys.length; i++) {
      const keyIndex = i * 2;
      const cleanupResult = results[keyIndex];
      const rangeResult = results[keyIndex + 1];

      if (
        !cleanupResult ||
        !rangeResult ||
        cleanupResult[0] ||
        rangeResult[0]
      ) {
        continue;
      }

      const members: string[] = (rangeResult[1] as string[]) || [];

      const key = keys[i];
      const encoded = key.slice(prefix.length, key.length - suffix.length);
      let username: string;
      try {
        username = decodeURIComponent(encoded);
      } catch {
        continue;
      }

      if (!byUsername.has(username)) {
        byUsername.set(username, new Map());
      }
      const brokerMap = byUsername.get(username)!;

      for (let j = 0; j < members.length; j += 2) {
        const memberJson = members[j];
        const score = Number(members[j + 1]);

        let brokerId = "unknown";
        try {
          const parsed = JSON.parse(memberJson) as {
            lastUpdatedByInstance?: string;
          };
          brokerId = parsed.lastUpdatedByInstance || "unknown";
        } catch {
          continue;
        }

        const existing = brokerMap.get(brokerId);
        if (existing) {
          existing.count++;
          if (score > existing.lastSeenAt) {
            existing.lastSeenAt = score;
          }
        } else {
          brokerMap.set(brokerId, { count: 1, lastSeenAt: score });
        }
      }
    }

    const entries: SubscriberConnectionEntry[] = [];
    for (const [username, brokerMap] of byUsername) {
      let totalCount = 0;
      let maxLastSeen = 0;
      const brokers: SubscriberBrokerSummary[] = [];

      for (const [brokerId, data] of brokerMap) {
        totalCount += data.count;
        if (data.lastSeenAt > maxLastSeen) {
          maxLastSeen = data.lastSeenAt;
        }
        brokers.push({
          brokerId,
          connectionCount: data.count,
          lastSeenAt: data.lastSeenAt,
        });
      }

      brokers.sort((a, b) => a.brokerId.localeCompare(b.brokerId));

      entries.push({
        username,
        connectionCount: totalCount,
        lastSeenAt: maxLastSeen,
        brokers,
      });
    }

    entries.sort((a, b) => a.username.localeCompare(b.username));
    return entries;
  }

  async getTrustState(publicKey: string): Promise<string | null> {
    const key = this.trustStateKey(publicKey);
    const value = await this.redis.get(key);
    console.log(
      `[VALKEY] Läsning tillitstillstånd publicKey=${publicKey.substring(0, 8)} träff=${value ? "ja" : "nej"} key=${key}`,
    );
    return value;
  }

  async setTrustState(publicKey: string, stateJson: string): Promise<void> {
    const key = this.trustStateKey(publicKey);
    const lastUpdatedAt = Date.now();
    const stateWithMetadata = addWriteMetadata(stateJson, {
      lastUpdatedByInstance: this.instanceId,
      lastUpdatedAt,
    });

    let status: string | undefined;
    try {
      const parsed = JSON.parse(stateWithMetadata) as { status?: string };
      status = parsed.status;
    } catch {
      // proceed without index update if parse fails
    }

    const normalizedKey = normalizePublicKey(publicKey);
    const indexKey = this.bansIndexKey();

    const pipeline = this.redis.pipeline();
    pipeline.set(key, stateWithMetadata, "PX", TRUST_STATE_TTL_MS);
    if (status === "muted" || status === "would_mute") {
      pipeline.zadd(indexKey, lastUpdatedAt, normalizedKey);
    } else {
      pipeline.zrem(indexKey, normalizedKey);
    }
    const results = await pipeline.exec();
    const pipelineErrors = results?.filter(([err]) => err != null) ?? [];
    if (pipelineErrors.length > 0) {
      console.error(
        `[VALKEY] Pipeline-fel vid skrivning tillitstillstånd publicKey=${publicKey.substring(0, 8)}:`,
        pipelineErrors.map(([err]) => err),
      );
    }

    console.log(
      `[VALKEY] Skrivning tillitstillstånd publicKey=${publicKey.substring(0, 8)} ` +
        `lastUpdatedByInstance=${this.instanceId} lastUpdatedAt=${lastUpdatedAt} ttlMs=${TRUST_STATE_TTL_MS} ` +
        `bytes=${Buffer.byteLength(stateWithMetadata)} key=${key}`,
    );
  }

  async setInstanceMetrics(metrics: DashboardInstanceMetrics): Promise<void> {
    const key = this.instanceMetricsKey();
    const now = Date.now();
    await this.writeInstanceReadiness(now);
    const payload = JSON.stringify({
      ...metrics,
      lastUpdatedByInstance: this.instanceId,
      lastUpdatedAt: now,
    });
    const pipeline = this.redis.pipeline();
    pipeline.set(key, payload, "PX", INSTANCE_METRICS_TTL_MS);
    pipeline.zadd(this.instancesIndexKey(), now, keyPart(this.instanceId));
    await pipeline.exec();
  }

  async listInstanceReadiness(): Promise<ClusterInstanceReadiness[]> {
    const encodedIds = await this.redis.zrange(this.instancesIndexKey(), 0, -1);
    if (encodedIds.length === 0) {
      return [];
    }

    const keys = encodedIds.map((id) => this.key(`instances:${id}:ready`));
    const values = await this.redis.mget(keys);

    const staleMembers: string[] = [];
    const results = values.flatMap((value, index) => {
      if (!value) {
        staleMembers.push(encodedIds[index]);
        return [];
      }

      try {
        const parsed = JSON.parse(value) as Partial<ClusterInstanceReadiness>;
        return [
          {
            instanceId:
              parsed.lastUpdatedByInstance ||
              decodeURIComponent(encodedIds[index]),
            status: parsed.status || "unknown",
            namespace:
              typeof parsed.namespace === "string"
                ? parsed.namespace
                : undefined,
            lastUpdatedAt:
              typeof parsed.lastUpdatedAt === "number"
                ? parsed.lastUpdatedAt
                : undefined,
            lastUpdatedByInstance:
              typeof parsed.lastUpdatedByInstance === "string"
                ? parsed.lastUpdatedByInstance
                : undefined,
          },
        ];
      } catch {
        staleMembers.push(encodedIds[index]);
        return [];
      }
    });

    if (staleMembers.length > 0) {
      this.redis
        .zrem(this.instancesIndexKey(), ...staleMembers)
        .catch((error) => {
          console.error("[VALKEY] Kunde inte rensa instances-index:", error);
        });
    }

    return results;
  }

  async listInstanceMetrics(): Promise<DashboardInstanceMetrics[]> {
    const keys = await this.scanKeys(this.key("instances:*:metrics"));
    if (keys.length === 0) {
      return [];
    }

    const values = await this.redis.mget(keys);

    return values.flatMap((value) => {
      if (!value) {
        return [];
      }

      try {
        const parsed = JSON.parse(value) as DashboardInstanceMetrics;
        if (typeof parsed.instanceId !== "string") {
          return [];
        }

        return [parsed];
      } catch {
        return [];
      }
    });
  }

  async setInstanceObservers(entries: InstanceObserverEntry[]): Promise<void> {
    const key = this.instanceObserversKey();
    const now = Date.now();
    const payload = JSON.stringify({
      entries,
      lastUpdatedByInstance: this.instanceId,
      lastUpdatedAt: now,
    });
    await this.redis.set(key, payload, "PX", INSTANCE_METRICS_TTL_MS);
  }

  async listInstanceObservers(): Promise<InstanceObserverEntry[]> {
    const keys = await this.scanKeys(this.key("instances:*:observers"));
    if (keys.length === 0) {
      return [];
    }

    const values = await this.redis.mget(keys);
    const seen = new Map<string, InstanceObserverEntry>();
    for (const value of values) {
      if (!value) {
        continue;
      }

      try {
        const parsed = JSON.parse(value) as {
          entries: InstanceObserverEntry[];
        };
        if (!Array.isArray(parsed.entries)) {
          continue;
        }

        for (const entry of parsed.entries) {
          const existing = seen.get(entry.publicKey);
          if (!existing || entry.lastSeenAt > existing.lastSeenAt) {
            seen.set(entry.publicKey, entry);
          }
        }
      } catch {
        // skip malformed entries
      }
    }

    return Array.from(seen.values());
  }

  async claimObserver(publicKey: string): Promise<string | null> {
    const key = this.observerClaimKey(publicKey);

    const claimScript = `
local old = redis.call('GETSET', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return old
`;
    const oldValue = (await this.redis.eval(
      claimScript,
      1,
      key,
      this.instanceId,
      INSTANCE_METRICS_TTL_MS,
    )) as string | null;

    if (oldValue && oldValue !== this.instanceId) {
      return oldValue;
    }

    return null;
  }

  async renewObserverClaim(publicKey: string): Promise<boolean> {
    const key = this.observerClaimKey(publicKey);

    const renewScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
if raw ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;
    const result = (await this.redis.eval(
      renewScript,
      1,
      key,
      this.instanceId,
      INSTANCE_METRICS_TTL_MS,
    )) as number;
    return result === 1;
  }

  async releaseObserverClaim(publicKey: string): Promise<boolean> {
    const key = this.observerClaimKey(publicKey);

    const releaseScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
if raw ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
return 1
`;
    const result = (await this.redis.eval(
      releaseScript,
      3,
      key,
      this.observerNodeNameKey(publicKey),
      this.observerStatusTimestampKey(publicKey),
      this.instanceId,
    )) as number;
    return result === 1;
  }

  async releaseObserverClaimsForInstance(): Promise<number> {
    const claimKeys = await this.scanKeys(this.key("observers:*:claim"));
    if (claimKeys.length === 0) {
      return 0;
    }

    const releaseScript = `
local released = 0
for i, key in ipairs(KEYS) do
  local raw = redis.call('GET', key)
  if raw == ARGV[1] then
    redis.call('DEL', key)
    local nodeNameKey = string.gsub(key, ':claim$', ':node-name')
    local statusTimestampKey = string.gsub(key, ':claim$', ':status-timestamp')
    redis.call('DEL', nodeNameKey)
    redis.call('DEL', statusTimestampKey)
    released = released + 1
  end
end
return released
`;
    const result = (await this.redis.eval(
      releaseScript,
      claimKeys.length,
      ...claimKeys,
      this.instanceId,
    )) as number;
    return Number(result);
  }

  async acceptObserverStatusTimestamp(
    publicKey: string,
    timestamp: number,
    ttlMs: number,
  ): Promise<boolean> {
    const key = this.observerStatusTimestampKey(publicKey);
    const script = `
local current = redis.call('GET', KEYS[1])
if current and tonumber(ARGV[1]) < tonumber(current) then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1
`;
    const result = (await this.redis.eval(
      script,
      1,
      key,
      timestamp,
      ttlMs,
    )) as number;
    return result === 1;
  }

  async getObserverClaim(publicKey: string): Promise<string | null> {
    const key = this.observerClaimKey(publicKey);
    const raw = await this.redis.get(key);
    return raw || null;
  }

  async getObserverClaims(publicKeys: string[]): Promise<Map<string, string>> {
    const normalizedKeys = Array.from(
      new Set(publicKeys.map((publicKey) => normalizePublicKey(publicKey))),
    );
    if (normalizedKeys.length === 0) {
      return new Map();
    }

    const keys = normalizedKeys.map((publicKey) =>
      this.observerClaimKey(publicKey),
    );
    const values = await this.redis.mget(keys);
    const claims = new Map<string, string>();
    values.forEach((owner, index) => {
      if (owner) {
        claims.set(normalizedKeys[index], owner);
      }
    });
    return claims;
  }

  async setObserverNodeName(
    publicKey: string,
    name: string,
    ttlMs: number,
  ): Promise<void> {
    const key = this.observerNodeNameKey(publicKey);
    const now = Date.now();
    const payload = JSON.stringify({
      publicKey: normalizePublicKey(publicKey),
      name,
      lastUpdatedByInstance: this.instanceId,
      lastUpdatedAt: now,
    });
    await this.redis.set(key, payload, "PX", ttlMs);
  }

  async getObserverNodeName(publicKey: string): Promise<string | undefined> {
    const key = this.observerNodeNameKey(publicKey);
    const raw = await this.redis.get(key);
    if (!raw) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(raw) as { name?: unknown };
      const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
      return name || undefined;
    } catch {
      return undefined;
    }
  }

  async getObserverNodeNames(
    publicKeys: string[],
  ): Promise<Map<string, string>> {
    const normalizedKeys = Array.from(
      new Set(publicKeys.map((publicKey) => normalizePublicKey(publicKey))),
    );
    if (normalizedKeys.length === 0) {
      return new Map();
    }

    const keys = normalizedKeys.map((publicKey) =>
      this.observerNodeNameKey(publicKey),
    );
    const values = await this.redis.mget(keys);
    const names = new Map<string, string>();
    values.forEach((raw, index) => {
      if (!raw) {
        return;
      }

      try {
        const parsed = JSON.parse(raw) as { name?: unknown };
        const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
        if (name) {
          names.set(normalizedKeys[index], name);
        }
      } catch {
        // skip malformed names
      }
    });
    return names;
  }

  async listPublicBans(limit = 50): Promise<PublicBanSummary[]> {
    const indexKey = this.bansIndexKey();
    const normalizedKeys = await this.redis.zrevrange(
      indexKey,
      0,
      limit > 0 ? limit - 1 : -1,
    );
    if (normalizedKeys.length === 0) {
      return [];
    }

    const trustStateKeys = normalizedKeys.map((pk) => this.trustStateKey(pk));
    const values = await this.redis.mget(trustStateKeys);

    const staleMembers: string[] = [];
    const results = values.flatMap((value, i) => {
      const normalizedKey = normalizedKeys[i];
      if (!value) {
        staleMembers.push(normalizedKey);
        return [];
      }

      try {
        const parsed = JSON.parse(value) as {
          status?: "allowed" | "muted" | "would_mute";
          muteReason?: string;
          abuseBlockCount?: number;
          mutedUntil?: number;
          lastUpdatedAt?: number;
          lastUpdatedByInstance?: string;
          username?: string;
        };

        if (parsed.status !== "muted" && parsed.status !== "would_mute") {
          staleMembers.push(normalizedKey);
          return [];
        }

        const label =
          typeof parsed.username === "string" &&
          !parsed.username.startsWith("v1_")
            ? parsed.username
            : undefined;

        return [
          {
            node: normalizedKey,
            label,
            broker: parsed.lastUpdatedByInstance || "unknown",
            reason: formatPublicMuteReason(parsed.muteReason),
            blockCount:
              typeof parsed.abuseBlockCount === "number"
                ? parsed.abuseBlockCount
                : 0,
            mutedUntil: parsed.mutedUntil,
            status: parsed.status,
            lastUpdatedAt: parsed.lastUpdatedAt,
          },
        ];
      } catch {
        staleMembers.push(normalizedKey);
        return [];
      }
    });

    if (staleMembers.length > 0) {
      this.redis.zrem(indexKey, ...staleMembers).catch((error) => {
        console.error("[VALKEY] Kunde inte rensa bansindex:", error);
      });
    }

    return results;
  }

  async recordDeniedPublish(input: DeniedPublishInput): Promise<void> {
    const now = Date.now();
    const id = `${now}:${randomUUID()}`;
    const key = this.deniedPublishKey(id);
    const payload: PublicBanSummary = {
      node: input.node || "-",
      label: input.label,
      broker: this.instanceId,
      reason: input.reason,
      blockCount: 0,
      status: "denied",
      lastUpdatedAt: now,
      topic: input.topic,
      region: input.region,
      deniedUntilText: input.deniedUntilText,
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(payload), "PX", DENIED_PUBLISH_TTL_MS);
    pipeline.zadd(this.deniedPublishesIndexKey(), now, id);
    pipeline.zremrangebyscore(
      this.deniedPublishesIndexKey(),
      0,
      now - DENIED_PUBLISH_TTL_MS,
    );
    await pipeline.exec();
  }

  async listDeniedPublishes(limit = 50): Promise<PublicBanSummary[]> {
    const indexKey = this.deniedPublishesIndexKey();
    const ids = await this.redis.zrevrange(
      indexKey,
      0,
      limit > 0 ? limit - 1 : -1,
    );
    if (ids.length === 0) {
      return [];
    }

    const keys = ids.map((id) => this.deniedPublishKey(id));
    const values = await this.redis.mget(keys);
    const staleMembers: string[] = [];
    const results = values.flatMap((value, index) => {
      if (!value) {
        staleMembers.push(ids[index]);
        return [];
      }

      try {
        const parsed = JSON.parse(value) as PublicBanSummary;
        if (parsed.status !== "denied") {
          staleMembers.push(ids[index]);
          return [];
        }
        return [parsed];
      } catch {
        staleMembers.push(ids[index]);
        return [];
      }
    });

    if (staleMembers.length > 0) {
      this.redis.zrem(indexKey, ...staleMembers).catch((error) => {
        console.error("[VALKEY] Kunde inte rensa nekad-index:", error);
      });
    }

    return results;
  }

  async removePublicBan(publicKey: string): Promise<boolean> {
    const normalizedKey = normalizePublicKey(publicKey);
    const pipeline = this.redis.pipeline();
    pipeline.del(this.trustStateKey(normalizedKey));
    pipeline.zrem(this.bansIndexKey(), normalizedKey);
    const results = await pipeline.exec();
    const deletedTrustState = Number(results?.[0]?.[1] ?? 0);
    const removedIndexEntry = Number(results?.[1]?.[1] ?? 0);
    return deletedTrustState > 0 || removedIndexEntry > 0;
  }

  async clearPublicBans(): Promise<number> {
    const indexKey = this.bansIndexKey();
    const normalizedKeys = await this.redis.zrange(indexKey, 0, -1);
    if (normalizedKeys.length === 0) {
      return 0;
    }

    const pipeline = this.redis.pipeline();
    for (const publicKey of normalizedKeys) {
      pipeline.del(this.trustStateKey(publicKey));
    }
    pipeline.del(indexKey);
    await pipeline.exec();
    return normalizedKeys.length;
  }

  async listObserverClaims(): Promise<Map<string, string>> {
    const prefix = this.key("observers:");
    const suffix = ":claim";
    const claimKeys = await this.scanKeys(`${prefix}*${suffix}`);
    if (claimKeys.length === 0) {
      return new Map();
    }

    const values = await this.redis.mget(claimKeys);
    const claims = new Map<string, string>();
    values.forEach((owner, index) => {
      if (!owner) {
        return;
      }

      const key = claimKeys[index];
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) {
        return;
      }

      const encodedPublicKey = key.slice(prefix.length, -suffix.length);
      claims.set(decodeURIComponent(encodedPublicKey).toUpperCase(), owner);
    });
    return claims;
  }

  async disconnect(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    this.registeredConnections.clear();
    await this.redis.quit();
  }

  async withTrustStateLock<T>(
    publicKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = this.trustStateLockKey(publicKey);
    const token = JSON.stringify({
      token: randomUUID(),
      lastUpdatedByInstance: this.instanceId,
      lastUpdatedAt: Date.now(),
    });
    const deadline = Date.now() + TRUST_STATE_LOCK_WAIT_MS;
    const shortKey = publicKey.substring(0, 8);
    let attempts = 0;

    while (true) {
      attempts++;
      const acquired = await this.redis.set(
        key,
        token,
        "PX",
        TRUST_STATE_LOCK_TTL_MS,
        "NX",
      );
      if (acquired === "OK") {
        console.log(
          `[VALKEY] Lås taget publicKey=${shortKey} försök=${attempts} ttlMs=${TRUST_STATE_LOCK_TTL_MS} key=${key}`,
        );
        break;
      }

      if (Date.now() >= deadline) {
        console.warn(
          `[VALKEY] Lås timeout publicKey=${shortKey} försök=${attempts} väntatMs=${TRUST_STATE_LOCK_WAIT_MS} key=${key}`,
        );
        throw new Error(
          `Timed out waiting for trust-state lock for ${publicKey}`,
        );
      }

      await sleep(25);
    }

    try {
      return await operation();
    } finally {
      const releaseScript = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `;
      const released = await this.redis.eval(releaseScript, 1, key, token);
      console.log(
        `[VALKEY] Lås släppt publicKey=${shortKey} släppt=${Number(released)} key=${key}`,
      );
    }
  }

  private async refreshRegisteredConnections(): Promise<void> {
    const now = Date.now();
    await this.writeInstanceReadiness(now);
    const pipeline = this.redis.pipeline();
    for (const { key, member } of this.registeredConnections.values()) {
      pipeline.zadd(key, now, member);
      pipeline.pexpire(key, CONNECTION_TTL_MS);
    }
    await pipeline.exec();
    console.log(
      `[VALKEY] Förnyade readiness och ${this.registeredConnections.size} prenumerantanslutningar ttlMs=${CONNECTION_TTL_MS}`,
    );
  }

  async close(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    const pipeline = this.redis.pipeline();
    pipeline.del(this.instanceReadinessKey());
    pipeline.del(this.instanceMetricsKey());
    pipeline.del(this.instanceObserversKey());
    pipeline.zrem(this.instancesIndexKey(), keyPart(this.instanceId));
    for (const { key, member } of this.registeredConnections.values()) {
      pipeline.zrem(key, member);
    }
    const cleanupCount = this.registeredConnections.size;
    this.registeredConnections.clear();
    const releasedClaims = await this.releaseObserverClaimsForInstance();
    await pipeline.exec();
    console.log(
      `[VALKEY] Stänger klusterstate, rensade ${cleanupCount} registrerade anslutningar och släppte ${releasedClaims} observer-klaims`,
    );
    await this.redis.quit();
    console.log("[VALKEY] Klusterstate-anslutning stängd");
  }
}

export interface OrchestrationRuntime {
  aedesOptions: AedesOptions;
  clusterStateStore: ClusterStateStore;
  ready: () => Promise<void>;
  close: () => Promise<void>;
}

export function createOrchestrationRuntime(
  config: OrchestrationConfig,
): OrchestrationRuntime {
  const namespace = normalizeNamespace(config.namespace);
  const clusterStateStore = new ClusterStateStore({ ...config, namespace });
  const persistenceConnection = valkeyPersistenceConnection(
    config.kvUrl,
    namespace,
  );
  const mq = new mqemitterRedis.MQEmitterRedisPrefix(`${namespace}:mq:`, {
    ...valkeyAdapterOptions(config.kvUrl),
  });
  const persistence = aedesPersistenceRedis({
    conn: persistenceConnection,
    packetTTL() {
      return AEDES_PACKET_TTL_SECONDS;
    },
  });

  attachValkeyErrorLogger("Aedes MQ-emitter", config.kvUrl, mq);
  attachValkeyErrorLogger(
    "Aedes persistence-anslutning",
    config.kvUrl,
    persistenceConnection,
  );
  attachValkeyErrorLogger("Aedes persistence", config.kvUrl, persistence);

  console.log(
    `[ORKESTRERING] Valkey-läge aktiverat (${redactKvUrl(config.kvUrl)}, namespace: ${namespace}, instance: ${config.instanceId})`,
  );
  console.log(
    `[VALKEY] Aedes använder Valkey för MQ-emitter prefix=${namespace}:mq: och persistence prefix=${namespace}:aedes: packetTtlSeconds=${AEDES_PACKET_TTL_SECONDS}`,
  );

  return {
    aedesOptions: {
      id: config.instanceId,
      mq,
      persistence,
    },
    clusterStateStore,
    ready: async () => {
      await clusterStateStore.ready();
    },
    close: async () => {
      await clusterStateStore.close();
      persistenceConnection.disconnect();
    },
  };
}
