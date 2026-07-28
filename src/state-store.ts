import { randomUUID } from "node:crypto";
import type { ApplicationDatabase } from "./database.js";
import {
  isObserverNeighborsSnapshot,
  NEIGHBOR_RETENTION_MS,
  type ObserverNeighborsSnapshot,
} from "./neighbors.js";

export const TRUST_STATE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const DENIED_EVENT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_SUBSCRIPTIONS = 128;
const MAX_SUBSCRIPTION_LENGTH = 512;

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
  neighbors?: ObserverNeighborsSnapshot;
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

export interface PublicBanSummary {
  eventId?: string;
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
  subscriptions: string[];
  subscriptionsTruncated: boolean;
}

export interface SubscriberConnectionDetail {
  clientId: string;
  brokerId: string;
  lastSeenAt: number;
  subscriptions: string[];
  subscriptionsTruncated: boolean;
}

export interface SubscriberConnectionEntry {
  username: string;
  connectionCount: number;
  lastSeenAt: number;
  brokers: SubscriberBrokerSummary[];
  subscriptions: string[];
  subscriptionsTruncated: boolean;
  connections: SubscriberConnectionDetail[];
}

interface LocalSubscriberConnection {
  username: string;
  clientId: string;
  connectionId: string;
  connectedAt: number;
  registered: boolean;
  subscriptions: Set<string>;
  subscriptionsTruncated: boolean;
}

interface ObserverStateRow {
  public_key: string;
  label: string;
  broker: string;
  region: string | null;
  active: number;
  last_connected_at_ms: number;
  last_seen_at_ms: number;
  message_count: number;
  messages_json: string;
  neighbors_json: string | null;
  neighbors_expires_at_ms: number | null;
}

interface TrustStateRow {
  public_key: string;
  state_json: string;
  status: string;
  muted_until_ms: number | null;
  updated_at_ms: number;
}

interface DeniedEventRow {
  id: string;
  public_key: string;
  label: string | null;
  broker: string;
  reason: string;
  topic: string;
  region: string | null;
  denied_until_text: string | null;
  created_at_ms: number;
}

export function normalizePublicKey(publicKey: string): string {
  return publicKey.trim().toUpperCase();
}

export function validatePublicKey(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length > 128) return null;
  const normalized = trimmed.toUpperCase();
  return /^[0-9A-F]{64}$/.test(normalized) ? normalized : null;
}

function formatPublicMuteReason(reason: string | undefined): string {
  if (!reason) return "Okänd orsak";
  if (reason.startsWith("anomaly_threshold_exceeded")) return "Avvikelsegräns";
  if (reason.startsWith("iata_changes_exceeded")) return "Regionbyten";
  const labels: Record<string, string> = {
    rate_limit_exceeded: "Hastighetsgräns",
    "anomaly:packet_size": "Avvikande paketstorlek",
    "anomaly:excessive_packet_copies": "För många paketkopior",
    "anomaly:high_duplicate_rate": "Hög dubblettandel",
    iata_changes_exceeded: "Regionbyten",
    wrong_audience: "Ogiltig audience",
  };
  return labels[reason] ?? reason;
}

function parseObserver(
  row: ObserverStateRow,
  now: number,
): InstanceObserverEntry | undefined {
  try {
    const messages = JSON.parse(row.messages_json) as unknown;
    const neighbors = row.neighbors_json
      ? (JSON.parse(row.neighbors_json) as unknown)
      : undefined;
    if (!Array.isArray(messages)) return undefined;
    return {
      label: row.label,
      publicKey: row.public_key,
      broker: row.broker,
      region: row.region ?? undefined,
      active: row.active === 1,
      lastConnectedAt: Number(row.last_connected_at_ms),
      lastSeenAt: Number(row.last_seen_at_ms),
      messageCount: Number(row.message_count),
      messages: messages as InstanceObserverMessage[],
      neighbors:
        neighbors &&
        row.neighbors_expires_at_ms !== null &&
        Number(row.neighbors_expires_at_ms) > now &&
        isObserverNeighborsSnapshot(neighbors)
          ? neighbors
          : undefined,
    };
  } catch {
    return undefined;
  }
}

export class BrokerStateStore {
  private readonly subscriberConnections = new Map<
    string,
    LocalSubscriberConnection
  >();
  private readonly trustOperations = new Map<string, Promise<void>>();
  private metrics?: DashboardInstanceMetrics;

  constructor(
    readonly database: ApplicationDatabase,
    readonly instanceId: string,
  ) {}

  async ready(): Promise<void> {
    await this.database.probe();
    await this.database.run(
      "UPDATE observer_state SET active = 0 WHERE active = 1",
    );
    await this.cleanupExpired();
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
    await Promise.resolve();
    const pendingSameClient = [...this.subscriberConnections.values()].some(
      (connection) =>
        connection.username === username &&
        connection.clientId === clientId &&
        !connection.registered,
    );
    if (pendingSameClient) {
      return {
        allowed: false,
        activeConnections: [...this.subscriberConnections.values()].filter(
          (connection) => connection.username === username,
        ).length,
        connectionId: randomUUID(),
      };
    }
    const activeConnections = [...this.subscriberConnections.values()].filter(
      (connection) =>
        connection.username === username &&
        !(connection.clientId === clientId && connection.registered),
    ).length;
    const connectionId = randomUUID();
    if (activeConnections >= maxConnections) {
      return { allowed: false, activeConnections, connectionId };
    }
    this.subscriberConnections.set(connectionId, {
      username,
      clientId,
      connectionId,
      connectedAt: Date.now(),
      registered: false,
      subscriptions: new Set(),
      subscriptionsTruncated: false,
    });
    return {
      allowed: true,
      activeConnections: activeConnections + 1,
      connectionId,
    };
  }

  activateSubscriberConnection(
    username: string,
    clientId: string,
    connectionId: string,
  ): boolean {
    const connection = this.subscriberConnections.get(connectionId);
    if (
      !connection ||
      connection.username !== username ||
      connection.clientId !== clientId
    ) {
      return false;
    }
    for (const [id, candidate] of this.subscriberConnections) {
      if (
        id !== connectionId &&
        candidate.username === username &&
        candidate.clientId === clientId
      ) {
        this.subscriberConnections.delete(id);
      }
    }
    connection.registered = true;
    return true;
  }

  async updateSubscriberSubscriptions(
    username: string,
    clientId: string,
    connectionId: string,
    topics: Iterable<string>,
    operation: "add" | "remove",
  ): Promise<void> {
    await Promise.resolve();
    const connection = this.subscriberConnections.get(connectionId);
    if (
      !connection ||
      connection.username !== username ||
      connection.clientId !== clientId
    ) {
      return;
    }
    for (const topic of topics) {
      const normalized = topic.trim();
      if (!normalized || normalized.length > MAX_SUBSCRIPTION_LENGTH) continue;
      if (operation === "remove") {
        connection.subscriptions.delete(normalized);
      } else if (connection.subscriptions.size < MAX_SUBSCRIPTIONS) {
        connection.subscriptions.add(normalized);
      } else {
        connection.subscriptionsTruncated = true;
      }
    }
  }

  async releaseSubscriberConnection(
    username: string,
    clientId: string,
    connectionId?: string,
  ): Promise<void> {
    await Promise.resolve();
    if (!connectionId) return;
    const connection = this.subscriberConnections.get(connectionId);
    if (connection?.username === username && connection.clientId === clientId) {
      this.subscriberConnections.delete(connectionId);
    }
  }

  async listSubscriberConnections(): Promise<SubscriberConnectionEntry[]> {
    await Promise.resolve();
    const byUser = new Map<string, LocalSubscriberConnection[]>();
    for (const connection of this.subscriberConnections.values()) {
      if (!connection.registered) continue;
      const values = byUser.get(connection.username) ?? [];
      values.push(connection);
      byUser.set(connection.username, values);
    }
    return [...byUser.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([username, values]) => {
        const topics = new Set(
          values.flatMap((value) => [...value.subscriptions]),
        );
        const connections = values
          .map((value) => ({
            clientId: value.clientId,
            brokerId: this.instanceId,
            lastSeenAt: value.connectedAt,
            subscriptions: [...value.subscriptions].sort(),
            subscriptionsTruncated: value.subscriptionsTruncated,
          }))
          .sort((left, right) => left.clientId.localeCompare(right.clientId));
        const lastSeenAt = Math.max(
          ...values.map((value) => value.connectedAt),
        );
        const subscriptionsTruncated = values.some(
          (value) => value.subscriptionsTruncated,
        );
        return {
          username,
          connectionCount: values.length,
          lastSeenAt,
          brokers: [
            {
              brokerId: this.instanceId,
              connectionCount: values.length,
              lastSeenAt,
              subscriptions: [...topics].sort(),
              subscriptionsTruncated,
            },
          ],
          subscriptions: [...topics].sort(),
          subscriptionsTruncated,
          connections,
        };
      });
  }

  getTrustState(publicKey: string): Promise<string | null> {
    return this.database
      .get<{ state_json: string }>(
        "SELECT state_json FROM trust_state WHERE public_key = ? AND expires_at_ms > ?",
        normalizePublicKey(publicKey),
        Date.now(),
      )
      .then((row) => row?.state_json ?? null);
  }

  async setTrustState(publicKey: string, stateJson: string): Promise<void> {
    const normalized = validatePublicKey(publicKey);
    if (!normalized)
      throw new Error("Ogiltig publik nyckel för skyddstillstånd");
    const parsed = JSON.parse(stateJson) as Record<string, unknown>;
    const now = Date.now();
    const stored = JSON.stringify({
      ...parsed,
      lastUpdatedByInstance: this.instanceId,
      lastUpdatedAt: now,
    });
    await this.database.run(
      `INSERT INTO trust_state(public_key, state_json, status, muted_until_ms, updated_at_ms, expires_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(public_key) DO UPDATE SET
         state_json = excluded.state_json, status = excluded.status,
         muted_until_ms = excluded.muted_until_ms, updated_at_ms = excluded.updated_at_ms,
         expires_at_ms = excluded.expires_at_ms`,
      normalized,
      stored,
      typeof parsed.status === "string" ? parsed.status : "allowed",
      typeof parsed.mutedUntil === "number" ? parsed.mutedUntil : null,
      now,
      now + TRUST_STATE_TTL_MS,
    );
  }

  async withTrustStateLock<Result>(
    publicKey: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const key = normalizePublicKey(publicKey);
    const prior = this.trustOperations.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = prior.then(() => current);
    this.trustOperations.set(key, queued);
    await prior;
    try {
      return await operation();
    } finally {
      release();
      if (this.trustOperations.get(key) === queued) {
        this.trustOperations.delete(key);
      }
    }
  }

  async setBrokerMetrics(metrics: DashboardInstanceMetrics): Promise<void> {
    await Promise.resolve();
    this.metrics = { ...metrics, lastUpdatedAt: Date.now() };
  }

  listBrokerMetrics(): DashboardInstanceMetrics[] {
    return this.metrics ? [this.metrics] : [];
  }

  async setObserverEntries(entries: InstanceObserverEntry[]): Promise<void> {
    const write = this.database.transaction(
      async (transaction, values: InstanceObserverEntry[], now: number) => {
        await transaction.run(
          "UPDATE observer_state SET active = 0, updated_at_ms = ? WHERE active = 1",
          now,
        );
        const statement = await transaction.prepare(
          `INSERT INTO observer_state(
             public_key, label, broker, region, active, last_connected_at_ms,
             last_seen_at_ms, message_count, messages_json, neighbors_json,
             neighbors_expires_at_ms, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(public_key) DO UPDATE SET
             label = excluded.label, broker = excluded.broker, region = excluded.region,
             active = excluded.active, last_connected_at_ms = excluded.last_connected_at_ms,
             last_seen_at_ms = excluded.last_seen_at_ms, message_count = excluded.message_count,
             messages_json = excluded.messages_json, neighbors_json = excluded.neighbors_json,
             neighbors_expires_at_ms = excluded.neighbors_expires_at_ms,
             updated_at_ms = excluded.updated_at_ms`,
        );
        for (const entry of values) {
          await statement.run(
            normalizePublicKey(entry.publicKey),
            entry.label,
            entry.broker,
            entry.region ?? null,
            Number(entry.active),
            entry.lastConnectedAt,
            entry.lastSeenAt,
            entry.messageCount,
            JSON.stringify(entry.messages.slice(0, 50)),
            entry.neighbors ? JSON.stringify(entry.neighbors) : null,
            entry.neighbors
              ? entry.neighbors.receivedAt + NEIGHBOR_RETENTION_MS
              : null,
            now,
          );
        }
      },
    );
    await write.immediate(entries, Date.now());
  }

  async listObservers(limit = 1_000): Promise<InstanceObserverEntry[]> {
    const now = Date.now();
    const rows = await this.database.all<ObserverStateRow>(
      `SELECT public_key, label, broker, region, active, last_connected_at_ms,
              last_seen_at_ms, message_count, messages_json, neighbors_json,
              neighbors_expires_at_ms
       FROM observer_state ORDER BY active DESC, last_seen_at_ms DESC, public_key ASC LIMIT ?`,
      Math.max(1, Math.min(limit, 10_000)),
    );
    return rows.flatMap((row) => {
      const parsed = parseObserver(row, now);
      return parsed ? [parsed] : [];
    });
  }

  async getObserver(
    publicKey: string,
  ): Promise<InstanceObserverEntry | undefined> {
    const row = await this.database.get<ObserverStateRow>(
      `SELECT public_key, label, broker, region, active, last_connected_at_ms,
              last_seen_at_ms, message_count, messages_json, neighbors_json,
              neighbors_expires_at_ms
       FROM observer_state WHERE public_key = ? LIMIT 1`,
      normalizePublicKey(publicKey),
    );
    return row ? parseObserver(row, Date.now()) : undefined;
  }

  async countObservers(): Promise<number> {
    const row = await this.database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM observer_state",
    );
    return Number(row?.count ?? 0);
  }

  async acceptObserverStatusTimestamp(
    publicKey: string,
    timestamp: number,
    ttlMs: number,
  ): Promise<boolean> {
    const normalized = normalizePublicKey(publicKey);
    const accept = this.database.transaction(
      async (transaction, key: string, value: number, expiresAt: number) => {
        const row = (await transaction.get(
          `SELECT latest_status_at_ms FROM observer_profiles
           WHERE public_key = ? AND status_expires_at_ms > ?`,
          key,
          Date.now(),
        )) as { latest_status_at_ms: number } | undefined;
        if (row && value < Number(row.latest_status_at_ms)) return false;
        await transaction.run(
          `INSERT INTO observer_profiles(public_key, latest_status_at_ms, status_expires_at_ms)
           VALUES (?, ?, ?)
           ON CONFLICT(public_key) DO UPDATE SET
             latest_status_at_ms = excluded.latest_status_at_ms,
             status_expires_at_ms = excluded.status_expires_at_ms`,
          key,
          value,
          expiresAt,
        );
        return true;
      },
    );
    return accept.immediate(normalized, timestamp, Date.now() + ttlMs);
  }

  async setObserverNodeName(
    publicKey: string,
    name: string,
    ttlMs: number,
  ): Promise<void> {
    await this.database.run(
      `INSERT INTO observer_profiles(public_key, node_name, node_name_expires_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(public_key) DO UPDATE SET
         node_name = excluded.node_name,
         node_name_expires_at_ms = excluded.node_name_expires_at_ms`,
      normalizePublicKey(publicKey),
      name,
      Date.now() + ttlMs,
    );
  }

  async getObserverNodeName(publicKey: string): Promise<string | undefined> {
    const row = await this.database.get<{ node_name: string }>(
      `SELECT node_name FROM observer_profiles
       WHERE public_key = ? AND node_name IS NOT NULL AND node_name_expires_at_ms > ?`,
      normalizePublicKey(publicKey),
      Date.now(),
    );
    return row?.node_name || undefined;
  }

  async getObserverNodeNames(
    publicKeys: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const unique = [...new Set(publicKeys.map(normalizePublicKey))].slice(
      0,
      2_000,
    );
    if (unique.length === 0) return result;
    const rows = await this.database.all<{
      public_key: string;
      node_name: string;
    }>(
      `SELECT public_key, node_name FROM observer_profiles
       WHERE public_key IN (${unique.map(() => "?").join(",")})
         AND node_name IS NOT NULL AND node_name_expires_at_ms > ?`,
      ...unique,
      Date.now(),
    );
    for (const row of rows) result.set(row.public_key, row.node_name);
    return result;
  }

  async listPublicBans(limit = 50): Promise<PublicBanSummary[]> {
    const bounded = limit <= 0 ? 10_000 : Math.min(limit, 10_000);
    const rows = await this.database.all<TrustStateRow>(
      `SELECT public_key, state_json, status, muted_until_ms, updated_at_ms
       FROM trust_state
       WHERE expires_at_ms > ? AND status = 'muted'
         AND (muted_until_ms IS NULL OR muted_until_ms > ?)
       ORDER BY updated_at_ms DESC, public_key ASC LIMIT ?`,
      Date.now(),
      Date.now(),
      bounded,
    );
    return rows.flatMap((row) => {
      try {
        const state = JSON.parse(row.state_json) as Record<string, unknown>;
        return [
          {
            node: row.public_key,
            label:
              typeof state.username === "string" &&
              !state.username.startsWith("v1_")
                ? state.username
                : undefined,
            broker:
              typeof state.lastUpdatedByInstance === "string"
                ? state.lastUpdatedByInstance
                : this.instanceId,
            reason: formatPublicMuteReason(
              typeof state.muteReason === "string"
                ? state.muteReason
                : undefined,
            ),
            blockCount:
              typeof state.abuseBlockCount === "number"
                ? state.abuseBlockCount
                : 0,
            mutedUntil: row.muted_until_ms ?? undefined,
            status: row.status as "muted" | "would_mute",
            lastUpdatedAt: Number(row.updated_at_ms),
          },
        ];
      } catch {
        return [];
      }
    });
  }

  async getPublicBan(publicKey: string): Promise<PublicBanSummary | undefined> {
    const now = Date.now();
    const row = await this.database.get<TrustStateRow>(
      `SELECT public_key, state_json, status, muted_until_ms, updated_at_ms
       FROM trust_state
       WHERE public_key = ? AND expires_at_ms > ?
         AND status = 'muted'
         AND (muted_until_ms IS NULL OR muted_until_ms > ?)
       LIMIT 1`,
      normalizePublicKey(publicKey),
      now,
      now,
    );
    if (!row) return undefined;
    try {
      const state = JSON.parse(row.state_json) as Record<string, unknown>;
      return {
        node: row.public_key,
        label:
          typeof state.username === "string" &&
          !state.username.startsWith("v1_")
            ? state.username
            : undefined,
        broker:
          typeof state.lastUpdatedByInstance === "string"
            ? state.lastUpdatedByInstance
            : this.instanceId,
        reason: formatPublicMuteReason(
          typeof state.muteReason === "string" ? state.muteReason : undefined,
        ),
        blockCount:
          typeof state.abuseBlockCount === "number" ? state.abuseBlockCount : 0,
        mutedUntil: row.muted_until_ms ?? undefined,
        status: row.status as "muted" | "would_mute",
        lastUpdatedAt: Number(row.updated_at_ms),
      };
    } catch {
      return undefined;
    }
  }

  async countPublicBans(): Promise<number> {
    const now = Date.now();
    const row = await this.database.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM trust_state
       WHERE expires_at_ms > ? AND status = 'muted'
         AND (muted_until_ms IS NULL OR muted_until_ms > ?)`,
      now,
    );
    return Number(row?.count ?? 0);
  }

  async recordDeniedPublish(input: DeniedPublishInput): Promise<void> {
    const now = Date.now();
    await this.database.run(
      `INSERT INTO denied_publish_events(
         id, public_key, label, broker, reason, topic, region,
         denied_until_text, created_at_ms, expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      input.node || "-",
      input.label ?? null,
      this.instanceId,
      input.reason,
      input.topic,
      input.region ?? null,
      input.deniedUntilText ?? null,
      now,
      now + DENIED_EVENT_TTL_MS,
    );
    await this.cleanupExpired(100);
  }

  async listDeniedPublishes(limit = 50): Promise<PublicBanSummary[]> {
    const bounded = limit <= 0 ? 10_000 : Math.min(limit, 10_000);
    const rows = await this.database.all<DeniedEventRow>(
      `SELECT id, public_key, label, broker, reason, topic, region,
               denied_until_text, created_at_ms
       FROM denied_publish_events WHERE expires_at_ms > ?
       ORDER BY created_at_ms DESC, id DESC LIMIT ?`,
      Date.now(),
      bounded,
    );
    return rows.map((row) => ({
      eventId: row.id,
      node: row.public_key,
      label: row.label ?? undefined,
      broker: row.broker,
      reason: row.reason,
      blockCount: 0,
      status: "denied",
      lastUpdatedAt: Number(row.created_at_ms),
      topic: row.topic,
      region: row.region ?? undefined,
      deniedUntilText: row.denied_until_text ?? undefined,
    }));
  }

  async getLatestDeniedPublish(
    publicKey: string,
  ): Promise<PublicBanSummary | undefined> {
    const row = await this.database.get<DeniedEventRow>(
      `SELECT id, public_key, label, broker, reason, topic, region,
               denied_until_text, created_at_ms
       FROM denied_publish_events
       WHERE public_key = ? AND expires_at_ms > ?
       ORDER BY created_at_ms DESC, id DESC LIMIT 1`,
      normalizePublicKey(publicKey),
      Date.now(),
    );
    return row
      ? {
          eventId: row.id,
          node: row.public_key,
          label: row.label ?? undefined,
          broker: row.broker,
          reason: row.reason,
          blockCount: 0,
          status: "denied",
          lastUpdatedAt: Number(row.created_at_ms),
          topic: row.topic,
          region: row.region ?? undefined,
          deniedUntilText: row.denied_until_text ?? undefined,
        }
      : undefined;
  }

  async removePublicBan(publicKey: string): Promise<boolean> {
    const normalized = validatePublicKey(publicKey);
    if (!normalized) return false;
    const result = await this.database.run(
      "DELETE FROM trust_state WHERE public_key = ?",
      normalized,
    );
    return result.changes > 0;
  }

  async clearPublicBans(): Promise<number> {
    const result = await this.database.run(
      "DELETE FROM trust_state WHERE status IN ('muted', 'would_mute')",
    );
    return result.changes;
  }

  async countBlockedObservers(): Promise<{
    mutedBans: number;
    deniedPublishes: number;
  }> {
    const now = Date.now();
    const [muted, denied] = await Promise.all([
      this.database.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM trust_state
         WHERE status = 'muted' AND expires_at_ms > ?
           AND (muted_until_ms IS NULL OR muted_until_ms > ?)`,
        now,
        now,
      ),
      this.database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM denied_publish_events WHERE expires_at_ms > ?",
        now,
      ),
    ]);
    return {
      mutedBans: Number(muted?.count ?? 0),
      deniedPublishes: Number(denied?.count ?? 0),
    };
  }

  async cleanupExpired(limit = 500): Promise<number> {
    const now = Date.now();
    const cleanup = this.database.transaction(
      async (transaction, cutoff: number, bounded: number) => {
        let removed = 0;
        for (const [table, column] of [
          ["retained_packets", "expires_at_ms"],
          ["trust_state", "expires_at_ms"],
          ["denied_publish_events", "expires_at_ms"],
          ["meshcore_io_ingress_dedup", "expires_at_ms"],
          ["meshcore_io_observer_radio", "expires_at_ms"],
        ] as const) {
          const result = await transaction.run(
            `DELETE FROM ${table} WHERE rowid IN (
               SELECT rowid FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <= ?
               ORDER BY ${column} ASC LIMIT ?
             )`,
            cutoff,
            bounded,
          );
          removed += result.changes;
        }
        const expiredIngress = await transaction.run(
          `DELETE FROM meshcore_io_ingress WHERE id IN (
             SELECT id FROM meshcore_io_ingress
             WHERE expires_at_ms <= ? AND processing = 0
             ORDER BY expires_at_ms ASC, id ASC LIMIT ?
           )`,
          cutoff,
          bounded,
        );
        if (expiredIngress.changes > 0) {
          await transaction.run(
            `UPDATE meshcore_io_stats SET dropped = dropped + ?
             WHERE singleton = 1`,
            expiredIngress.changes,
          );
          removed += expiredIngress.changes;
        }
        for (const [table, condition, order] of [
          [
            "observer_profiles",
            `(node_name_expires_at_ms IS NULL OR node_name_expires_at_ms <= ?)
             AND (status_expires_at_ms IS NULL OR status_expires_at_ms <= ?)`,
            "COALESCE(node_name_expires_at_ms, status_expires_at_ms, 0)",
          ],
          [
            "meshcore_io_node_state",
            `(cooldown_until_ms IS NULL OR cooldown_until_ms <= ?)
             AND (accepted_expires_at_ms IS NULL OR accepted_expires_at_ms <= ?)`,
            "COALESCE(accepted_expires_at_ms, cooldown_until_ms, 0)",
          ],
        ] as const) {
          const result = await transaction.run(
            `DELETE FROM ${table} WHERE rowid IN (
               SELECT rowid FROM ${table} WHERE ${condition}
               ORDER BY ${order} ASC LIMIT ?
             )`,
            cutoff,
            cutoff,
            bounded,
          );
          removed += result.changes;
        }
        const expiredMap = await transaction.run(
          `DELETE FROM meshcore_io_map WHERE rowid IN (
             SELECT rowid FROM meshcore_io_map WHERE at_ms <= ?
             ORDER BY at_ms ASC, node_public_key ASC LIMIT ?
           )`,
          cutoff - 7 * 24 * 60 * 60 * 1_000,
          bounded,
        );
        removed += expiredMap.changes;
        await transaction.run(
          `UPDATE observer_state SET neighbors_json = NULL, neighbors_expires_at_ms = NULL
           WHERE public_key IN (
             SELECT public_key FROM observer_state
             WHERE neighbors_expires_at_ms IS NOT NULL AND neighbors_expires_at_ms <= ?
             ORDER BY neighbors_expires_at_ms ASC LIMIT ?
           )`,
          cutoff,
          bounded,
        );
        return removed;
      },
    );
    return cleanup.immediate(now, Math.max(1, Math.min(limit, 2_000)));
  }

  async resetApplicationState(): Promise<number> {
    const tables = [
      "retained_packets",
      "mqtt_subscriptions",
      "mqtt_outgoing",
      "mqtt_incoming",
      "mqtt_wills",
      "target_retained_clears",
      "observer_profiles",
      "observer_state",
      "trust_state",
      "denied_publish_events",
      "meshcore_io_ingress",
      "meshcore_io_ingress_dedup",
      "meshcore_io_observer_radio",
      "meshcore_io_jobs",
      "meshcore_io_node_state",
      "meshcore_io_history",
      "meshcore_io_map",
    ];
    const reset = this.database.transaction(async (transaction) => {
      let removed = 0;
      for (const table of tables) {
        const result = await transaction.run(`DELETE FROM ${table}`);
        removed += result.changes;
      }
      await transaction.run(
        `UPDATE meshcore_io_stats SET enqueued = 0, uploaded = 0,
         dropped = 0, invalid = 0, retries = 0,
         last_error = NULL, last_error_at_ms = NULL WHERE singleton = 1`,
      );
      return removed;
    });
    this.subscriberConnections.clear();
    this.metrics = undefined;
    return reset.immediate();
  }

  close(): Promise<void> {
    this.subscriberConnections.clear();
    this.metrics = undefined;
    return Promise.resolve();
  }
}
