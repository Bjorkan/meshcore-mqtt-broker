import { randomUUID } from "node:crypto";
import type { ApplicationDatabase } from "./database.js";
import {
  isObserverNeighborsSnapshot,
  NEIGHBOR_RETENTION_MS,
  type ObserverNeighborsSnapshot,
} from "./neighbors.js";

export const TRUST_STATE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
export const NODE_ADVERT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const REJECTION_EVENT_TTL_MS = 24 * 60 * 60 * 1_000;
const DENIAL_CLEANUP_MIN_INTERVAL_MS = 30_000;
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

export interface HeardNodeAdvertInput {
  publicKey: string;
  advertTimestamp: number;
  advertType: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  region: string;
  observerPublicKey: string;
  rawPacket: Buffer;
  heardAt: number;
}

export interface HeardNodeAdvert {
  publicKey: string;
  advertTimestamp: number;
  advertType: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  rawPacketHex: string;
  advertHeardAt: number;
  heardAt: number;
  expiresAt: number;
  regions: string[];
  regionHearings: HeardNodeRegionHearing[];
}

export interface HeardNodeRegionHearing {
  region: string;
  observerPublicKey: string;
  heardAt: number;
  expiresAt: number;
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
  active: boolean;
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
  public_key: string;
  label: string | null;
  broker: string;
  reason: string;
  topic: string;
  region: string | null;
  denied_until_text: string | null;
  created_at_ms: number;
}

interface HeardNodeAdvertRegionRow {
  node_public_key: string;
  advert_timestamp: number;
  advert_type: string;
  node_name: string | null;
  latitude: number | null;
  longitude: number | null;
  raw_packet: Uint8Array;
  advert_received_at_ms: number;
  last_heard_at_ms: number;
  node_expires_at_ms: number;
  region: string;
  observer_public_key: string;
  region_last_heard_at_ms: number;
  region_expires_at_ms: number;
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
      active: row.active,
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

function parseHeardNodeAdvertRows(
  rows: HeardNodeAdvertRegionRow[],
): HeardNodeAdvert[] {
  const nodes = new Map<string, HeardNodeAdvert>();
  for (const row of rows) {
    let node = nodes.get(row.node_public_key);
    if (!node) {
      node = {
        publicKey: row.node_public_key,
        advertTimestamp: Number(row.advert_timestamp),
        advertType: row.advert_type,
        name: row.node_name ?? undefined,
        latitude: row.latitude === null ? undefined : Number(row.latitude),
        longitude: row.longitude === null ? undefined : Number(row.longitude),
        rawPacketHex: Buffer.from(row.raw_packet).toString("hex"),
        advertHeardAt: Number(row.advert_received_at_ms),
        heardAt: Number(row.last_heard_at_ms),
        expiresAt: Number(row.node_expires_at_ms),
        regions: [],
        regionHearings: [],
      };
      nodes.set(row.node_public_key, node);
    }
    node.regions.push(row.region);
    node.regionHearings.push({
      region: row.region,
      observerPublicKey: row.observer_public_key,
      heardAt: Number(row.region_last_heard_at_ms),
      expiresAt: Number(row.region_expires_at_ms),
    });
  }
  return [...nodes.values()];
}

export class BrokerStateStore {
  private readonly subscriberConnections = new Map<
    string,
    LocalSubscriberConnection
  >();
  private readonly trustOperations = new Map<string, Promise<void>>();

  constructor(
    readonly database: ApplicationDatabase,
    readonly instanceId: string,
  ) {}

  async ready(): Promise<void> {
    await this.database.probe();
    await this.database.run(
      "UPDATE observer_state SET active = false WHERE active = true",
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
        "SELECT state_json FROM trust_state WHERE public_key = $1 AND expires_at_ms > $2",
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
       VALUES ($1, $2, $3, $4, $5, $6)
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

  async setObserverEntries(entries: InstanceObserverEntry[]): Promise<void> {
    const write = this.database.transaction(
      async (transaction, values: InstanceObserverEntry[], now: number) => {
        await transaction.run(
          "UPDATE observer_state SET active = false, updated_at_ms = $1 WHERE active = true",
          now,
        );
        for (const entry of values) {
          await transaction.run(
            `INSERT INTO observer_state(public_key, label, broker, region, active, last_connected_at_ms, last_seen_at_ms, message_count, messages_json, neighbors_json, neighbors_expires_at_ms, updated_at_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT(public_key) DO UPDATE SET
             label = excluded.label, broker = excluded.broker, region = excluded.region, active = excluded.active,
             last_connected_at_ms = excluded.last_connected_at_ms, last_seen_at_ms = excluded.last_seen_at_ms,
             message_count = excluded.message_count, messages_json = excluded.messages_json,
             neighbors_json = excluded.neighbors_json, neighbors_expires_at_ms = excluded.neighbors_expires_at_ms,
             updated_at_ms = excluded.updated_at_ms`,
            normalizePublicKey(entry.publicKey),
            entry.label,
            entry.broker,
            entry.region ?? null,
            entry.active,
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
    await write(entries, Date.now());
  }

  async listObservers(limit = 1_000): Promise<InstanceObserverEntry[]> {
    const rows = await this.database.all<ObserverStateRow>(
      `SELECT public_key, label, broker, region, active, last_connected_at_ms, last_seen_at_ms, message_count, messages_json, neighbors_json, neighbors_expires_at_ms
       FROM observer_state ORDER BY active DESC, last_seen_at_ms DESC, public_key ASC LIMIT $1`,
      Math.max(1, Math.min(limit, 10_000)),
    );
    return rows.flatMap((row) => {
      const parsed = parseObserver(row, Date.now());
      return parsed ? [parsed] : [];
    });
  }

  async getObserver(
    publicKey: string,
  ): Promise<InstanceObserverEntry | undefined> {
    const row = await this.database.get<ObserverStateRow>(
      `SELECT public_key, label, broker, region, active, last_connected_at_ms, last_seen_at_ms, message_count, messages_json, neighbors_json, neighbors_expires_at_ms
       FROM observer_state WHERE public_key = $1 LIMIT 1`,
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
        const row = await transaction.get<{ latest_status_at_ms: number }>(
          `SELECT latest_status_at_ms FROM observer_profiles
           WHERE public_key = $1 AND status_expires_at_ms > $2`,
          key,
          Date.now(),
        );
        if (row && value < Number(row.latest_status_at_ms)) return false;
        await transaction.run(
          `INSERT INTO observer_profiles(public_key, latest_status_at_ms, status_expires_at_ms)
           VALUES ($1, $2, $3)
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
    return accept(normalized, timestamp, Date.now() + ttlMs);
  }

  async setObserverNodeName(
    publicKey: string,
    name: string,
    ttlMs: number,
  ): Promise<void> {
    await this.database.run(
      `INSERT INTO observer_profiles(public_key, node_name, node_name_expires_at_ms)
       VALUES ($1, $2, $3)
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
        WHERE public_key = $1 AND node_name IS NOT NULL AND node_name_expires_at_ms > $2`,
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
        WHERE public_key = ANY($1::text[])
          AND node_name IS NOT NULL AND node_name_expires_at_ms > $2`,
      unique,
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
       WHERE expires_at_ms > $1 AND status = 'muted'
         AND (muted_until_ms IS NULL OR muted_until_ms > $2)
       ORDER BY updated_at_ms DESC, public_key ASC LIMIT $3`,
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
       WHERE public_key = $1 AND expires_at_ms > $2
         AND status = 'muted'
         AND (muted_until_ms IS NULL OR muted_until_ms > $3)
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
       WHERE expires_at_ms > $1 AND status = 'muted'
          AND (muted_until_ms IS NULL OR muted_until_ms > $2)`,
      now,
      now,
    );
    return Number(row?.count ?? 0);
  }

  async recordDeniedPublish(input: DeniedPublishInput): Promise<void> {
    const now = Date.now();
    const expiresAt = now + REJECTION_EVENT_TTL_MS;
    const publicKey = validatePublicKey(input.node);
    const record = this.database.transaction(
      async (transaction, event: DeniedPublishInput) => {
        await transaction.run(
          `INSERT INTO denied_publish_events(
             id, public_key, label, broker, reason, topic, region,
             denied_until_text, created_at_ms, expires_at_ms
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          randomUUID(),
          event.node || "-",
          event.label ?? null,
          this.instanceId,
          event.reason,
          event.topic,
          event.region ?? null,
          event.deniedUntilText ?? null,
          now,
          expiresAt,
        );
        if (publicKey) {
          await transaction.run(
            `INSERT INTO observer_rejection_events(
               id, public_key, stage, reason, created_at_ms, expires_at_ms
             ) VALUES ($1, $2, 'publish', $3, $4, $5)`,
            randomUUID(),
            publicKey,
            event.reason,
            now,
            expiresAt,
          );
        }
      },
    );
    await record(input);
    await this.cleanupAfterDenial();
  }

  async recordObserverRejection(
    publicKey: string,
    stage: "authentication" | "publish",
    reason: string,
  ): Promise<void> {
    const normalized = validatePublicKey(publicKey);
    if (!normalized) return;
    const now = Date.now();
    await this.database.run(
      `INSERT INTO observer_rejection_events(
         id, public_key, stage, reason, created_at_ms, expires_at_ms
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      randomUUID(),
      normalized,
      stage,
      reason,
      now,
      now + REJECTION_EVENT_TTL_MS,
    );
    await this.cleanupAfterDenial();
  }

  private lastDenialCleanupAtMs = 0;

  private async cleanupAfterDenial(): Promise<void> {
    const now = Date.now();
    if (now - this.lastDenialCleanupAtMs < DENIAL_CLEANUP_MIN_INTERVAL_MS) {
      return;
    }
    this.lastDenialCleanupAtMs = now;
    await this.cleanupExpired(100);
  }

  async recordHeardNodeAdvert(input: HeardNodeAdvertInput): Promise<boolean> {
    const publicKey = validatePublicKey(input.publicKey);
    const observerPublicKey = validatePublicKey(input.observerPublicKey);
    if (!publicKey || !observerPublicKey) {
      throw new Error("Ogiltig publik nyckel i node-advert");
    }
    if (
      !Number.isSafeInteger(input.advertTimestamp) ||
      input.advertTimestamp < 0 ||
      !Number.isSafeInteger(input.heardAt) ||
      input.heardAt < 0 ||
      !/^[A-Z0-9_]{1,32}$/.test(input.advertType) ||
      !Buffer.isBuffer(input.rawPacket) ||
      input.rawPacket.length === 0 ||
      input.rawPacket.length > 512
    ) {
      throw new Error("Ogiltigt innehåll i node-advert");
    }
    const hasLatitude = input.latitude !== undefined;
    const hasLongitude = input.longitude !== undefined;
    if (
      hasLatitude !== hasLongitude ||
      (hasLatitude &&
        (!Number.isFinite(input.latitude) ||
          input.latitude! < -90 ||
          input.latitude! > 90 ||
          !Number.isFinite(input.longitude) ||
          input.longitude! < -180 ||
          input.longitude! > 180))
    ) {
      throw new Error("Ogiltiga koordinater i node-advert");
    }
    const region = input.region.toUpperCase();
    if (!/^(?:[A-Z]{3}|TEST)$/.test(region)) {
      throw new Error("Ogiltig region i node-advert");
    }
    const expiresAt = input.heardAt + NODE_ADVERT_RETENTION_MS;
    const record = this.database.transaction(async (transaction) => {
      const existing = await transaction.get<{
        advert_timestamp: number;
        advert_received_at_ms: number;
      }>(
        `SELECT advert_timestamp, advert_received_at_ms
         FROM heard_node_adverts WHERE node_public_key = $1`,
        publicKey,
      );
      const advertUpdated =
        !existing || input.heardAt > Number(existing.advert_received_at_ms);

      if (!existing) {
        await transaction.run(
          `INSERT INTO heard_node_adverts(
             node_public_key, advert_timestamp, advert_type, node_name,
             latitude, longitude, raw_packet, advert_received_at_ms,
             last_heard_at_ms, expires_at_ms
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          publicKey,
          input.advertTimestamp,
          input.advertType.slice(0, 32),
          input.name?.slice(0, 200) ?? null,
          input.latitude ?? null,
          input.longitude ?? null,
          input.rawPacket,
          input.heardAt,
          input.heardAt,
          expiresAt,
        );
      } else if (advertUpdated) {
        await transaction.run(
          `UPDATE heard_node_adverts SET
             advert_timestamp = $1, advert_type = $2, node_name = $3,
             latitude = $4, longitude = $5, raw_packet = $6,
             advert_received_at_ms = $7,
             last_heard_at_ms = GREATEST(last_heard_at_ms, $8),
             expires_at_ms = GREATEST(expires_at_ms, $9)
           WHERE node_public_key = $10`,
          input.advertTimestamp,
          input.advertType.slice(0, 32),
          input.name?.slice(0, 200) ?? null,
          input.latitude ?? null,
          input.longitude ?? null,
          input.rawPacket,
          input.heardAt,
          input.heardAt,
          expiresAt,
          publicKey,
        );
      } else {
        await transaction.run(
          `UPDATE heard_node_adverts SET
             last_heard_at_ms = GREATEST(last_heard_at_ms, $1),
             expires_at_ms = GREATEST(expires_at_ms, $2)
           WHERE node_public_key = $3`,
          input.heardAt,
          expiresAt,
          publicKey,
        );
      }

      await transaction.run(
        `INSERT INTO heard_node_regions(
           node_public_key, region, observer_public_key, last_heard_at_ms,
           expires_at_ms
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(node_public_key, region) DO UPDATE SET
           observer_public_key = excluded.observer_public_key,
           last_heard_at_ms = excluded.last_heard_at_ms,
           expires_at_ms = excluded.expires_at_ms
         WHERE excluded.last_heard_at_ms > heard_node_regions.last_heard_at_ms`,
        publicKey,
        region,
        observerPublicKey,
        input.heardAt,
        expiresAt,
      );
      return advertUpdated;
    });
    return record();
  }

  async listHeardNodeAdverts(region?: string): Promise<HeardNodeAdvert[]> {
    const normalizedRegion = region?.toUpperCase();
    if (normalizedRegion && !/^(?:[A-Z]{3}|TEST)$/.test(normalizedRegion)) {
      throw new Error("Ogiltigt regionfilter för node-adverts");
    }
    const now = Date.now();
    const rows = await this.database.all<HeardNodeAdvertRegionRow>(
      `WITH selected_nodes AS (
         SELECT node_public_key, advert_timestamp, advert_type, node_name,
                latitude, longitude, raw_packet, advert_received_at_ms,
                last_heard_at_ms, expires_at_ms
         FROM heard_node_adverts AS adverts
         WHERE expires_at_ms > $1
           AND ($2::text IS NULL OR EXISTS (
             SELECT 1 FROM heard_node_regions AS filter_regions
             WHERE filter_regions.node_public_key = adverts.node_public_key
               AND filter_regions.region = $3
               AND filter_regions.expires_at_ms > $4
           ))
         ORDER BY last_heard_at_ms DESC, node_public_key ASC
         LIMIT 10000
       )
       SELECT selected_nodes.node_public_key,
              selected_nodes.advert_timestamp,
              selected_nodes.advert_type,
              selected_nodes.node_name,
              selected_nodes.latitude,
              selected_nodes.longitude,
              selected_nodes.raw_packet,
              selected_nodes.advert_received_at_ms,
              selected_nodes.last_heard_at_ms,
              selected_nodes.expires_at_ms AS node_expires_at_ms,
              regions.region,
              regions.observer_public_key,
              regions.last_heard_at_ms AS region_last_heard_at_ms,
              regions.expires_at_ms AS region_expires_at_ms
       FROM selected_nodes
       INNER JOIN heard_node_regions AS regions
         ON regions.node_public_key = selected_nodes.node_public_key
        AND regions.expires_at_ms > $5
       ORDER BY selected_nodes.last_heard_at_ms DESC,
                selected_nodes.node_public_key ASC,
                regions.region ASC
       LIMIT 100000`,
      now,
      normalizedRegion ?? null,
      normalizedRegion ?? null,
      now,
      now,
    );
    return parseHeardNodeAdvertRows(rows);
  }

  async getHeardNodeAdvert(
    publicKey: string,
  ): Promise<HeardNodeAdvert | undefined> {
    const normalized = validatePublicKey(publicKey);
    if (!normalized) throw new Error("Ogiltig publik nyckel för node-advert");
    const now = Date.now();
    const rows = await this.database.all<HeardNodeAdvertRegionRow>(
      `SELECT adverts.node_public_key,
              adverts.advert_timestamp,
              adverts.advert_type,
              adverts.node_name,
              adverts.latitude,
              adverts.longitude,
              adverts.raw_packet,
              adverts.advert_received_at_ms,
              adverts.last_heard_at_ms,
              adverts.expires_at_ms AS node_expires_at_ms,
              regions.region,
              regions.observer_public_key,
              regions.last_heard_at_ms AS region_last_heard_at_ms,
              regions.expires_at_ms AS region_expires_at_ms
       FROM heard_node_adverts AS adverts
       INNER JOIN heard_node_regions AS regions
         ON regions.node_public_key = adverts.node_public_key
        AND regions.expires_at_ms > $1
       WHERE adverts.node_public_key = $2 AND adverts.expires_at_ms > $3
       ORDER BY regions.region ASC
       LIMIT 10000`,
      now,
      normalized,
      now,
    );
    return parseHeardNodeAdvertRows(rows)[0];
  }

  async listDeniedPublishes(limit = 50): Promise<PublicBanSummary[]> {
    const bounded = limit <= 0 ? 10_000 : Math.min(limit, 10_000);
    const rows = await this.database.all<DeniedEventRow>(
      `SELECT public_key, label, broker, reason, topic, region,
              denied_until_text, created_at_ms
       FROM denied_publish_events WHERE expires_at_ms > $1
       ORDER BY created_at_ms DESC, id DESC LIMIT $2`,
      Date.now(),
      bounded,
    );
    return rows.map((row) => ({
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
      `SELECT public_key, label, broker, reason, topic, region,
              denied_until_text, created_at_ms
       FROM denied_publish_events
       WHERE public_key = $1 AND expires_at_ms > $2
       ORDER BY created_at_ms DESC, id DESC LIMIT 1`,
      normalizePublicKey(publicKey),
      Date.now(),
    );
    return row
      ? {
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
      "DELETE FROM trust_state WHERE public_key = $1",
      normalized,
    );
    return (result.rowCount ?? 0) > 0;
  }

  async clearPublicBans(): Promise<number> {
    const result = await this.database.run(
      "DELETE FROM trust_state WHERE status IN ('muted', 'would_mute')",
    );
    return result.rowCount ?? 0;
  }

  async countBlockedObservers(): Promise<{
    blockedObservers: number;
    protectionEvents: number;
  }> {
    const now = Date.now();
    const row = await this.database.get<{
      blocked_observers: number;
      protection_events: number;
    }>(
      `WITH active_muted AS (
         SELECT public_key FROM trust_state
         WHERE status = 'muted' AND expires_at_ms > $1
           AND (muted_until_ms IS NULL OR muted_until_ms > $2)
       ), active_rejected AS (
          SELECT public_key FROM observer_rejection_events WHERE expires_at_ms > $3
       ), active_denied AS (
          SELECT public_key FROM denied_publish_events WHERE expires_at_ms > $4
       )
       SELECT
         (SELECT COUNT(*) FROM (
            SELECT public_key FROM active_muted
            WHERE public_key ~ '^[0-9A-F]{64}$'
            UNION
            SELECT public_key FROM active_rejected
            WHERE public_key ~ '^[0-9A-F]{64}$'
         )) AS blocked_observers,
         (SELECT COUNT(*) FROM active_muted) +
           (SELECT COUNT(*) FROM active_denied) AS protection_events`,
      now,
      now,
      now,
      now,
    );
    return {
      blockedObservers: Number(row?.blocked_observers ?? 0),
      protectionEvents: Number(row?.protection_events ?? 0),
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
          ["observer_rejection_events", "expires_at_ms"],
          ["heard_node_regions", "expires_at_ms"],
          ["heard_node_adverts", "expires_at_ms"],
          ["meshcore_io_ingress_dedup", "expires_at_ms"],
          ["meshcore_io_observer_radio", "expires_at_ms"],
        ] as const) {
          const result = await transaction.run(
            `DELETE FROM ${table} WHERE ctid IN (
               SELECT ctid FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <= $1
               ORDER BY ${column} ASC LIMIT $2
             )`,
            cutoff,
            bounded,
          );
          removed += result.rowCount ?? 0;
        }
        const expiredIngress = await transaction.run(
          `DELETE FROM meshcore_io_ingress WHERE id IN (
             SELECT id FROM meshcore_io_ingress
             WHERE expires_at_ms <= $1 AND processing = false
             ORDER BY expires_at_ms ASC, id ASC LIMIT $2
           )`,
          cutoff,
          bounded,
        );
        if ((expiredIngress.rowCount ?? 0) > 0) {
          await transaction.run(
            `UPDATE meshcore_io_stats SET dropped = dropped + $1
             WHERE singleton = 1`,
            expiredIngress.rowCount,
          );
          removed += expiredIngress.rowCount ?? 0;
        }
        for (const [table, condition, order] of [
          [
            "observer_profiles",
            `(node_name_expires_at_ms IS NULL OR node_name_expires_at_ms <= $1)
             AND (status_expires_at_ms IS NULL OR status_expires_at_ms <= $2)`,
            "COALESCE(node_name_expires_at_ms, status_expires_at_ms, 0)",
          ],
          [
            "meshcore_io_node_state",
            `(cooldown_until_ms IS NULL OR cooldown_until_ms <= $1)
             AND (accepted_expires_at_ms IS NULL OR accepted_expires_at_ms <= $2)`,
            "COALESCE(accepted_expires_at_ms, cooldown_until_ms, 0)",
          ],
        ] as const) {
          const result = await transaction.run(
            `DELETE FROM ${table} WHERE ctid IN (
               SELECT ctid FROM ${table} WHERE ${condition}
               ORDER BY ${order} ASC LIMIT $3
             )`,
            cutoff,
            cutoff,
            bounded,
          );
          removed += result.rowCount ?? 0;
        }
        const expiredMap = await transaction.run(
          `DELETE FROM meshcore_io_map WHERE ctid IN (
             SELECT ctid FROM meshcore_io_map WHERE at_ms <= $1
             ORDER BY at_ms ASC, node_public_key ASC LIMIT $2
           )`,
          cutoff - 7 * 24 * 60 * 60 * 1_000,
          bounded,
        );
        removed += expiredMap.rowCount ?? 0;
        await transaction.run(
          `UPDATE observer_state SET neighbors_json = NULL, neighbors_expires_at_ms = NULL
           WHERE public_key IN (
             SELECT public_key FROM observer_state
            WHERE neighbors_expires_at_ms IS NOT NULL AND neighbors_expires_at_ms <= $1
            ORDER BY neighbors_expires_at_ms ASC LIMIT $2
           )`,
          cutoff,
          bounded,
        );
        return removed;
      },
    );
    return cleanup(now, Math.max(1, Math.min(limit, 2_000)));
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
      "observer_rejection_events",
      "heard_node_regions",
      "heard_node_adverts",
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
        removed += result.rowCount ?? 0;
      }
      await transaction.run(
        `UPDATE meshcore_io_stats SET enqueued = 0, uploaded = 0,
         dropped = 0, invalid = 0, retries = 0,
         last_error = NULL, last_error_at_ms = NULL WHERE singleton = 1`,
      );
      return removed;
    });
    this.subscriberConnections.clear();
    return reset();
  }

  close(): Promise<void> {
    this.subscriberConnections.clear();
    return Promise.resolve();
  }
}
