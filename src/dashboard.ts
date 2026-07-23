import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFileSync } from "fs";
import type { AddressInfo } from "net";
import type { PublishPacket } from "aedes";
import type {
  ClusterStateStore,
  DashboardInstanceMetrics,
  InstanceObserverEntry,
  PublicBanSummary,
  SubscriberConnectionEntry,
} from "./orchestration.js";
import { normalizePublicKey, validatePublicKey } from "./orchestration.js";
import type { MeshAedesClient } from "./aedes-types.js";
import { getModuleLogger } from "./logger.js";
import type { MeshcoreIoDashboardSnapshot } from "./meshcore-io-types.js";
import {
  parseNeighborsSnapshot,
  type ObserverNeighborsSnapshot,
} from "./neighbors.js";

const log = getModuleLogger("Dashboard");

const DASHBOARD_METRICS_WINDOW_MS = 60_000;
const MAX_RETAINED_INACTIVE_OBSERVERS = 200;
const MAX_OBSERVER_MESSAGES = 50;
const MAX_RECENT_PUBLISHES = 50;
const MAX_PROTECTION_EVENTS = 50;

let dashboardClientCache: Buffer | null = null;
let dashboardClientLoadError: string | null = null;
let dashboardClientCssCache: Buffer | null = null;
let dashboardClientCssLoadError: string | null = null;
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 24 24" role="img" aria-label="Meshat radio tower favicon"><rect width="24" height="24" rx="5" fill="#087a55"/><g transform="translate(2 2) scale(0.8333333333)" fill="none" stroke="#FFFFFF" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/><circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/></g></svg>`;

interface ObserverMessage {
  topic: string;
  broker: string;
  region?: string;
  observer?: string;
  publicKey?: string;
  subtopic?: string;
  bytes: number;
  receivedAt: number;
}

interface TrackedObserver {
  connection: MeshAedesClient;
  clientId: string;
  label: string;
  publicKey: string;
  broker: string;
  region?: string;
  active: boolean;
  connectedAt: number;
  lastConnectedAt: number;
  lastSeenAt: number;
  messageCount: number;
  messages: ObserverMessage[];
  neighbors?: ObserverNeighborsSnapshot;
  abuse?: {
    status: "muted" | "would_mute" | "denied";
    reason: string;
    blockCount: number;
    mutedUntil?: number;
    broker: string;
    deniedUntilText?: string;
  };
}

interface DashboardObserver {
  label: string;
  publicKey: string;
  broker: string;
  region?: string;
  active: boolean;
  lastConnectedAt: number;
  lastSeenAt: number;
  messageCount: number;
  messages: ObserverMessage[];
  neighbors?: ObserverNeighborsSnapshot;
  abuse?: {
    status: "muted" | "would_mute" | "denied";
    reason: string;
    blockCount: number;
    mutedUntil?: number;
    broker: string;
    deniedUntilText?: string;
  };
}

interface PublicBrokerMetrics {
  instanceId: string;
  startedAt: number;
  connectedClients: number;
  publisherClients: number;
  claimedObservers: number;
  messagesPerSecond: number;
  messagesLastMinute: number;
  targetBridge?: DashboardInstanceMetrics["targetBridge"];
  ready: boolean;
  status: "healthy" | "stale";
  lastUpdateAgeMs: number;
}

interface DashboardSnapshot {
  generatedAt: number;
  respondingBroker: string;
  namespace: string;
  summary: {
    connectedClients: number;
    connectedObservers: number;
    activeBrokers: number;
    totalBrokers: number;
    messagesPerSecond: number;
    publishesLastMinute: number;
    activeBans: number;
    protectionEventsShown: number;
    protectionEventsTruncated: boolean;
  };
  brokers: PublicBrokerMetrics[];
  observers: DashboardObserver[];
  recentPublishes: ObserverMessage[];
  bans: PublicBanSummary[];
  subscribers: SubscriberConnectionEntry[];
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
  meshcoreIo?: MeshcoreIoDashboardSnapshot;
  error?: string;
}

export interface DashboardStateOptions {
  instanceId: string;
  namespace: string;
  targetBridgeStatus?: () => DashboardInstanceMetrics["targetBridge"];
  swedishCountiesLookup?: {
    getAllCountyLookup(): Record<
      string,
      { countyName: string; primaryIata: string; isPrimary: boolean }
    >;
    isAvailable(): boolean;
  };
  meshcoreIoStatus?: () => Promise<MeshcoreIoDashboardSnapshot>;
}

export interface DashboardServerOptions extends DashboardStateOptions {
  host: string;
  port: number;
  clusterStateStore: ClusterStateStore;
  state: DashboardState;
  activeBans: () => number;
}

function now(): number {
  return Date.now();
}

function maskIdentifier(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }

  const normalized = value.trim();
  if (normalized.length <= 12) {
    return normalized;
  }

  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function publicClientLabel(client: MeshAedesClient): string {
  if (client?.clientType === "publisher") {
    return client.nodeName || client.publicKey || maskIdentifier(client.id);
  }

  if (client?.clientType === "subscriber") {
    return client.username === "docker_health" ? "docker health" : "subscriber";
  }

  return maskIdentifier(client?.id);
}

function isPublisherClient(client: MeshAedesClient): boolean {
  return (
    client?.clientType === "publisher" && typeof client?.publicKey === "string"
  );
}

function parseObserverTopic(
  topic: string,
): { publicKey: string; region: string; subtopic: string } | undefined {
  const parts = topic.split("/");
  if (parts.length < 4 || parts[0] !== "meshcore") {
    return undefined;
  }

  const publicKey = parts[2].toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(publicKey)) {
    return undefined;
  }

  return {
    publicKey,
    region: parts[1].toUpperCase(),
    subtopic: parts.slice(3).join("/"),
  };
}

function isPublicDashboardTopic(
  topic: { subtopic: string } | undefined,
): topic is { publicKey: string; region: string; subtopic: string } {
  if (!topic) {
    return false;
  }

  const subtopicRoot = topic.subtopic.split("/")[0].toLowerCase();
  return subtopicRoot !== "internal" && subtopicRoot !== "serial";
}

function publicMessage(message: ObserverMessage): ObserverMessage {
  return {
    topic: message.topic,
    broker: message.broker,
    region: message.region,
    observer: message.observer,
    publicKey: message.publicKey,
    subtopic: message.subtopic,
    bytes: message.bytes,
    receivedAt: message.receivedAt,
  };
}

function publicObserver(
  observer: TrackedObserver,
  ban?: PublicBanSummary,
): DashboardObserver {
  return {
    label: observer.label,
    publicKey: observer.publicKey,
    broker: observer.broker,
    region: observer.region,
    active: observer.active,
    lastConnectedAt: observer.lastConnectedAt,
    lastSeenAt: observer.lastSeenAt,
    messageCount: observer.messageCount,
    messages: observer.messages.map(publicMessage),
    neighbors: observer.neighbors,
    abuse: ban
      ? {
          status: ban.status,
          reason: ban.reason,
          blockCount: ban.blockCount,
          mutedUntil: ban.mutedUntil,
          broker: ban.broker,
          deniedUntilText: ban.deniedUntilText,
        }
      : undefined,
  };
}

function healthySubscriberEntries(
  entries: SubscriberConnectionEntry[],
  healthyBrokerIds: Set<string>,
): SubscriberConnectionEntry[] {
  return entries.flatMap((entry) => {
    const connections = entry.connections.filter((connection) =>
      healthyBrokerIds.has(connection.brokerId),
    );
    if (connections.length === 0) {
      return [];
    }

    const brokersById = new Map<
      string,
      SubscriberConnectionEntry["brokers"][number]
    >();
    const subscriptions = new Set<string>();
    let subscriptionsTruncated = false;
    let lastSeenAt = 0;

    for (const connection of connections) {
      const existing = brokersById.get(connection.brokerId);
      if (existing) {
        existing.connectionCount += 1;
        existing.lastSeenAt = Math.max(
          existing.lastSeenAt,
          connection.lastSeenAt,
        );
        existing.subscriptions = Array.from(
          new Set([...existing.subscriptions, ...connection.subscriptions]),
        ).sort((a, b) => a.localeCompare(b));
        existing.subscriptionsTruncated ||= connection.subscriptionsTruncated;
      } else {
        brokersById.set(connection.brokerId, {
          brokerId: connection.brokerId,
          connectionCount: 1,
          lastSeenAt: connection.lastSeenAt,
          subscriptions: [...connection.subscriptions].sort((a, b) =>
            a.localeCompare(b),
          ),
          subscriptionsTruncated: connection.subscriptionsTruncated,
        });
      }

      lastSeenAt = Math.max(lastSeenAt, connection.lastSeenAt);
      subscriptionsTruncated ||= connection.subscriptionsTruncated;
      for (const topic of connection.subscriptions) {
        subscriptions.add(topic);
      }
    }

    return [
      {
        username: entry.username,
        connectionCount: connections.length,
        lastSeenAt,
        brokers: Array.from(brokersById.values()).sort((a, b) =>
          a.brokerId.localeCompare(b.brokerId),
        ),
        subscriptions: Array.from(subscriptions).sort((a, b) =>
          a.localeCompare(b),
        ),
        subscriptionsTruncated,
        connections,
      },
    ];
  });
}

function healthyMeshcoreIoSnapshot(
  snapshot: MeshcoreIoDashboardSnapshot,
  healthyBrokerIds: Set<string>,
): MeshcoreIoDashboardSnapshot {
  if (!snapshot.enabled) {
    return snapshot;
  }

  const workers = snapshot.workers.filter((worker) =>
    healthyBrokerIds.has(worker.instanceId),
  );
  const reportedActiveUploads = workers.reduce(
    (total, worker) => total + worker.activeUploads,
    0,
  );
  const activeUploads = Math.min(snapshot.queue.claimed, reportedActiveUploads);
  const producerIsHealthy =
    snapshot.producer.instanceId === undefined ||
    healthyBrokerIds.has(snapshot.producer.instanceId);

  return {
    ...snapshot,
    producer: {
      ...snapshot.producer,
      status:
        producerIsHealthy || snapshot.producer.status === "disabled"
          ? snapshot.producer.status
          : "stale",
    },
    queue: {
      ...snapshot.queue,
      active: activeUploads,
      claimedNotActive: snapshot.queue.claimed - activeUploads,
    },
    workers,
  };
}

function withFriendlyName(
  observer: DashboardObserver,
  friendlyNames: Map<string, string>,
): DashboardObserver {
  const friendlyName = friendlyNames.get(observer.publicKey);
  if (!friendlyName) {
    return observer;
  }

  return {
    ...observer,
    label: friendlyName,
    messages: observer.messages.map((message) => ({
      ...message,
      observer:
        message.publicKey === observer.publicKey
          ? friendlyName
          : message.observer,
    })),
  };
}

function messageWithFriendlyName(
  message: ObserverMessage,
  friendlyNames: Map<string, string>,
): ObserverMessage {
  const publicKey = message.publicKey?.toUpperCase();
  const friendlyName = publicKey ? friendlyNames.get(publicKey) : undefined;
  if (!friendlyName) {
    return message;
  }

  return {
    ...message,
    observer: friendlyName,
  };
}

function publicBrokerMetrics(
  entry: DashboardInstanceMetrics,
  generatedAt: number,
  readyInstances: Set<string>,
): PublicBrokerMetrics {
  const age = Math.max(0, generatedAt - entry.lastUpdatedAt);
  const ready = readyInstances.has(entry.instanceId);
  const status =
    ready && age < 120_000 ? ("healthy" as const) : ("stale" as const);
  return {
    instanceId: entry.instanceId,
    startedAt: entry.startedAt,
    connectedClients: entry.connectedClients,
    publisherClients: entry.publisherClients,
    claimedObservers: 0,
    messagesPerSecond: entry.messagesPerSecond,
    messagesLastMinute: entry.messagesLastMinute,
    targetBridge: entry.targetBridge,
    ready,
    status,
    lastUpdateAgeMs: age,
  };
}

export class DashboardState {
  private instanceId: string;
  private namespace: string;
  private targetBridgeStatus?: () => DashboardInstanceMetrics["targetBridge"];
  private swedishCountiesLookup?: DashboardStateOptions["swedishCountiesLookup"];
  private meshcoreIoStatus?: DashboardStateOptions["meshcoreIoStatus"];
  private startedAt = now();
  private clients = new Map<string, TrackedObserver>();
  private subscriberClients = new Map<string, MeshAedesClient>();
  private observers = new Map<string, TrackedObserver>();
  private publishTimestamps: number[] = [];
  private recentPublishes: ObserverMessage[] = [];

  constructor(options: DashboardStateOptions) {
    this.instanceId = options.instanceId;
    this.namespace = options.namespace;
    this.targetBridgeStatus = options.targetBridgeStatus;
    this.swedishCountiesLookup = options.swedishCountiesLookup;
    this.meshcoreIoStatus = options.meshcoreIoStatus;
  }

  recordClientConnected(client: MeshAedesClient): void {
    if (client?.clientType === "subscriber") {
      if (client.id) {
        this.subscriberClients.set(client.id, client);
      }
      return;
    }

    if (!isPublisherClient(client)) {
      return;
    }

    const connectedAt =
      typeof client?.connectedAt === "number" ? client.connectedAt : now();
    const publicKey = client.publicKey!.toUpperCase();
    const existingObserver = this.observers.get(publicKey);
    const entry: TrackedObserver = {
      connection: client,
      clientId: maskIdentifier(client?.id),
      label: publicClientLabel(client),
      publicKey,
      broker: this.instanceId,
      region: existingObserver?.region,
      active: true,
      connectedAt,
      lastConnectedAt: connectedAt,
      lastSeenAt: existingObserver?.lastSeenAt || connectedAt,
      messageCount: existingObserver?.messageCount || 0,
      messages: existingObserver?.messages || [],
      neighbors: existingObserver?.neighbors,
    };

    this.clients.set(client?.id || entry.clientId, entry);
    this.upsertObserver(entry);
  }

  recordClientAuthenticated(client: MeshAedesClient): void {
    if (client?.clientType === "subscriber") {
      if (client.id) {
        this.subscriberClients.set(client.id, client);
      }
      return;
    }

    if (!isPublisherClient(client)) {
      return;
    }

    const key = client?.id;
    if (!key) {
      return;
    }

    const existing = this.clients.get(key);
    const publicKey = client.publicKey!.toUpperCase();
    const existingObserver = this.observers.get(publicKey);
    const parsedRegion =
      typeof client?.lastRegion === "string" ? client.lastRegion : undefined;
    const connectedAt = existing?.connectedAt || client.connectedAt || now();
    const entry: TrackedObserver = {
      connection: client,
      clientId: maskIdentifier(client.id),
      label: publicClientLabel(client),
      publicKey,
      broker: this.instanceId,
      region: parsedRegion || existingObserver?.region,
      active: true,
      connectedAt,
      lastConnectedAt: connectedAt,
      lastSeenAt: existingObserver?.lastSeenAt || connectedAt,
      messageCount: existingObserver?.messageCount || 0,
      messages: existingObserver?.messages || [],
      neighbors: existingObserver?.neighbors,
    };

    this.clients.set(key, entry);
    this.upsertObserver(entry);
  }

  recordClientRegion(client: MeshAedesClient, region: string): void {
    const key = client?.id;
    if (!key) {
      return;
    }

    const existing = this.clients.get(key);
    if (existing?.connection === client) {
      existing.region = region;
      this.upsertObserver(existing);
    }
  }

  recordClientDisconnected(client: MeshAedesClient): void {
    if (!client?.id) {
      return;
    }

    if (client.clientType === "subscriber") {
      if (this.subscriberClients.get(client.id) === client) {
        this.subscriberClients.delete(client.id);
      }
      return;
    }

    const existing = this.clients.get(client.id);
    if (!existing || existing.connection !== client) {
      return;
    }

    this.clients.delete(client.id);
    const currentObserver = this.observers.get(existing.publicKey) || existing;
    const hasActiveConnection = Array.from(this.clients.values()).some(
      (candidate) =>
        candidate.active && candidate.publicKey === existing.publicKey,
    );
    this.upsertObserver({
      ...currentObserver,
      active: hasActiveConnection,
    });
  }

  recordPublish(packet: PublishPacket, client: MeshAedesClient): void {
    const timestamp = now();
    if (!isPublisherClient(client)) {
      return;
    }

    const currentConnection = this.clients.get(client.id);
    if (!currentConnection || currentConnection.connection !== client) {
      return;
    }

    const topic = parseObserverTopic(packet.topic);
    if (!isPublicDashboardTopic(topic)) {
      return;
    }

    const publicKey = topic?.publicKey || client.publicKey!.toUpperCase();
    const existingObserver = this.observers.get(publicKey);
    const payload = Buffer.isBuffer(packet.payload)
      ? packet.payload
      : Buffer.from(packet.payload);
    const neighbors =
      topic?.subtopic === "neighbors"
        ? parseNeighborsSnapshot(payload, timestamp, publicKey)
        : undefined;

    const message: ObserverMessage = {
      topic: packet.topic,
      broker: this.instanceId,
      region: topic?.region || currentConnection.region,
      observer: currentConnection.label || maskIdentifier(publicKey),
      publicKey,
      subtopic: topic?.subtopic,
      bytes: payload.length,
      receivedAt: timestamp,
    };

    this.publishTimestamps.push(timestamp);
    this.recentPublishes = [message, ...this.recentPublishes].slice(
      0,
      MAX_RECENT_PUBLISHES,
    );

    const updatedLabel = publicClientLabel(client);
    const updated: TrackedObserver = {
      ...currentConnection,
      connection: client,
      label: updatedLabel,
      broker: this.instanceId,
      region: topic?.region || currentConnection.region,
      active: true,
      lastSeenAt: timestamp,
      messageCount: (existingObserver?.messageCount || 0) + 1,
      messages: [message, ...(existingObserver?.messages || [])].slice(
        0,
        MAX_OBSERVER_MESSAGES,
      ),
      neighbors: neighbors || existingObserver?.neighbors,
    };

    this.clients.set(client.id, updated);
    this.upsertObserver(updated);
  }

  private upsertObserver(observer: TrackedObserver): void {
    this.observers.set(observer.publicKey, observer);

    const inactiveObservers = Array.from(this.observers.entries())
      .filter(([, entry]) => !entry.active)
      .sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    const excessInactive =
      inactiveObservers.length - MAX_RETAINED_INACTIVE_OBSERVERS;
    for (let index = 0; index < excessInactive; index += 1) {
      this.observers.delete(inactiveObservers[index][0]);
    }
  }

  private observerList(bans: PublicBanSummary[] = []): DashboardObserver[] {
    const bansByNode = new Map(
      bans.map((ban) => [ban.node.toUpperCase(), ban]),
    );
    return Array.from(this.observers.values())
      .filter((observer) => observer.active)
      .map((observer) =>
        publicObserver(observer, bansByNode.get(observer.publicKey)),
      )
      .sort(
        (a, b) =>
          Number(b.active) - Number(a.active) || b.lastSeenAt - a.lastSeenAt,
      );
  }

  private localActiveObservers(): TrackedObserver[] {
    return Array.from(this.clients.values()).filter((client) => client.active);
  }

  getConnectedObserverKeys(): string[] {
    const seen = new Set<string>();
    for (const client of this.clients.values()) {
      if (client.active) {
        seen.add(client.publicKey);
      }
    }
    return Array.from(seen);
  }

  getObserverEntries(): InstanceObserverEntry[] {
    return Array.from(this.observers.values())
      .filter((observer) => observer.active)
      .map((observer) => ({
        label: observer.label,
        publicKey: observer.publicKey,
        broker: observer.broker,
        region: observer.region,
        active: observer.active,
        lastConnectedAt: observer.lastConnectedAt,
        lastSeenAt: observer.lastSeenAt,
        messageCount: observer.messageCount,
        messages: observer.messages.map(publicMessage),
        neighbors: observer.neighbors,
      }));
  }

  getLocalMetrics(activeBans: number): DashboardInstanceMetrics {
    const timestamp = now();
    this.prunePublishTimestamps(timestamp);

    const activePublisherConnections = this.localActiveObservers();
    const connectedObserverCount = new Set(
      activePublisherConnections.map((observer) => observer.publicKey),
    ).size;
    const messagesLastMinute = this.publishTimestamps.length;
    return {
      instanceId: this.instanceId,
      connectedClients:
        activePublisherConnections.length + this.subscriberClients.size,
      subscriberClients: this.subscriberClients.size,
      publisherClients: connectedObserverCount,
      messagesPerSecond: Math.round((messagesLastMinute / 60) * 100) / 100,
      messagesLastMinute,
      targetBridge: this.targetBridgeStatus?.(),
      activeBans,
      localReady: true,
      startedAt: this.startedAt,
      lastUpdatedAt: timestamp,
      lastUpdatedByInstance: this.instanceId,
    };
  }

  async getSnapshot(
    clusterStateStore: ClusterStateStore,
    activeBans: number,
  ): Promise<DashboardSnapshot> {
    const generatedAt = now();
    const localMetrics = this.getLocalMetrics(activeBans);
    const activeBanCountPromise =
      typeof clusterStateStore.countActivePublicBans === "function"
        ? clusterStateStore.countActivePublicBans()
        : Promise.resolve<number | undefined>(undefined);

    try {
      await clusterStateStore.setInstanceMetrics(localMetrics);
      await clusterStateStore.setInstanceObservers(this.getObserverEntries());
      const [
        readiness,
        metrics,
        bans,
        deniedPublishes,
        remoteObserverEntries,
        activeBanCount,
      ] = await Promise.all([
        clusterStateStore.listInstanceReadiness(),
        clusterStateStore.listInstanceMetrics(),
        clusterStateStore.listPublicBans(MAX_PROTECTION_EVENTS + 1),
        clusterStateStore.listDeniedPublishes(MAX_PROTECTION_EVENTS + 1),
        clusterStateStore.listInstanceObservers(),
        activeBanCountPromise,
      ]);
      const sortedDenialEvents = [...bans, ...deniedPublishes].sort(
        (a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0),
      );
      const protectionEventsTruncated =
        bans.length > MAX_PROTECTION_EVENTS ||
        deniedPublishes.length > MAX_PROTECTION_EVENTS ||
        sortedDenialEvents.length > MAX_PROTECTION_EVENTS;
      const denialEvents = sortedDenialEvents.slice(0, MAX_PROTECTION_EVENTS);
      const readyInstances = new Set(
        readiness
          .filter((entry) => entry.status === "ready")
          .map((entry) => entry.instanceId),
      );
      const brokerMetrics = metrics
        .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
        .map((entry) =>
          publicBrokerMetrics(entry, generatedAt, readyInstances),
        );
      const healthyBrokerIds = new Set(
        brokerMetrics
          .filter((broker) => broker.status === "healthy")
          .map((broker) => broker.instanceId),
      );

      const bansByNode = new Map(
        bans.map((ban) => [ban.node.toUpperCase(), ban]),
      );
      const observerCandidates = remoteObserverEntries.filter(
        (entry) => entry.active && healthyBrokerIds.has(entry.broker),
      );
      const observerClaimOwners = await clusterStateStore.getObserverClaims(
        observerCandidates.map((entry) => entry.publicKey),
      );
      const visibleObserverCandidates = observerCandidates.filter(
        (entry) => observerClaimOwners.get(entry.publicKey) === entry.broker,
      );
      const observerMessages = observerCandidates.flatMap((entry) =>
        entry.messages.map(publicMessage),
      );
      const claimedObserverKeys = [
        ...visibleObserverCandidates.map((entry) => entry.publicKey),
        ...denialEvents.map((ban) => ban.node),
        ...observerMessages
          .map((message) => message.publicKey)
          .filter(
            (publicKey): publicKey is string => typeof publicKey === "string",
          ),
      ];
      const friendlyNames =
        await clusterStateStore.getObserverNodeNames(claimedObserverKeys);
      const observers = visibleObserverCandidates
        .map((entry) => {
          const ban = bansByNode.get(entry.publicKey);
          return withFriendlyName(
            {
              label: entry.label,
              publicKey: entry.publicKey,
              broker: entry.broker,
              region: entry.region,
              active: entry.active,
              lastConnectedAt: entry.lastConnectedAt,
              lastSeenAt: entry.lastSeenAt,
              messageCount: entry.messageCount,
              messages: entry.messages,
              neighbors: entry.neighbors,
              abuse: ban
                ? {
                    status: ban.status,
                    reason: ban.reason,
                    blockCount: ban.blockCount,
                    mutedUntil: ban.mutedUntil,
                    broker: ban.broker,
                    deniedUntilText: ban.deniedUntilText,
                  }
                : undefined,
            },
            friendlyNames,
          );
        })
        .sort(
          (a, b) =>
            Number(b.active) - Number(a.active) || b.lastSeenAt - a.lastSeenAt,
        );
      const claimedObserversByBroker = new Map<string, number>();
      for (const observer of observers) {
        claimedObserversByBroker.set(
          observer.broker,
          (claimedObserversByBroker.get(observer.broker) || 0) + 1,
        );
      }
      const brokers = brokerMetrics.map((broker) => ({
        ...broker,
        claimedObservers:
          broker.status === "healthy"
            ? claimedObserversByBroker.get(broker.instanceId) || 0
            : 0,
      }));
      const recentPublishes = observerMessages
        .map((message) => messageWithFriendlyName(message, friendlyNames))
        .sort((a, b) => b.receivedAt - a.receivedAt)
        .slice(0, MAX_RECENT_PUBLISHES);
      const healthyBrokers = brokers.filter(
        (broker) => broker.status === "healthy",
      );
      const observerLabels = new Map(
        observers.map((o) => [o.publicKey, o.label]),
      );
      const bansWithLabels = denialEvents.map((ban) => ({
        ...ban,
        label:
          friendlyNames.get(ban.node.toUpperCase()) ||
          observerLabels.get(ban.node) ||
          ban.label,
      }));

      const countyLookup = this.swedishCountiesLookup?.isAvailable()
        ? this.swedishCountiesLookup.getAllCountyLookup()
        : undefined;
      let meshcoreIo: MeshcoreIoDashboardSnapshot | undefined;
      try {
        const rawMeshcoreIo = await this.meshcoreIoStatus?.();
        meshcoreIo = rawMeshcoreIo
          ? healthyMeshcoreIoSnapshot(rawMeshcoreIo, healthyBrokerIds)
          : undefined;
      } catch (error) {
        log.error("Failed to load MeshCore.io dashboard state", error);
      }
      const subscribers = healthySubscriberEntries(
        await clusterStateStore.listSubscriberConnections(),
        healthyBrokerIds,
      );
      const publishesLastMinute = healthyBrokers.reduce(
        (total, broker) => total + broker.messagesLastMinute,
        0,
      );

      return {
        generatedAt,
        respondingBroker: this.instanceId,
        namespace: this.namespace,
        summary: {
          connectedClients: healthyBrokers.reduce(
            (total, broker) => total + broker.connectedClients,
            0,
          ),
          connectedObservers: observers.length,
          activeBrokers: healthyBrokers.length,
          totalBrokers: brokers.length,
          messagesPerSecond: Math.round((publishesLastMinute / 60) * 100) / 100,
          publishesLastMinute,
          activeBans:
            activeBanCount ??
            bans.filter(
              (ban) =>
                ban.status === "muted" &&
                (ban.mutedUntil === undefined || ban.mutedUntil > generatedAt),
            ).length,
          protectionEventsShown: denialEvents.length,
          protectionEventsTruncated,
        },
        brokers,
        observers,
        recentPublishes,
        bans: bansWithLabels,
        subscribers,
        countyLookup,
        meshcoreIo,
      };
    } catch (error) {
      log.error("Failed to build dashboard snapshot", error);
      return {
        generatedAt,
        respondingBroker: this.instanceId,
        namespace: this.namespace,
        summary: {
          connectedClients: 0,
          connectedObservers: 0,
          activeBrokers: 0,
          totalBrokers: 0,
          messagesPerSecond: 0,
          publishesLastMinute: 0,
          activeBans: 0,
          protectionEventsShown: 0,
          protectionEventsTruncated: false,
        },
        brokers: [],
        observers: [],
        recentPublishes: [],
        bans: [],
        subscribers: [],
        error: "Unable to load dashboard snapshot from Valkey.",
      };
    }
  }

  private prunePublishTimestamps(timestamp = now()): void {
    const cutoff = timestamp - DASHBOARD_METRICS_WINDOW_MS;
    this.publishTimestamps = this.publishTimestamps.filter(
      (entry) => entry >= cutoff,
    );
  }
}

function sendJson(res: ServerResponse, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

function sendFavicon(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "image/svg+xml",
    "cache-control": "public, max-age=86400",
  });
  res.end(FAVICON_SVG);
}

function sendDashboardClient(res: ServerResponse): void {
  if (dashboardClientCache === null && dashboardClientLoadError === null) {
    const clientUrls = [
      new URL("./public/dashboard-client.js", import.meta.url),
      new URL("../dist/public/dashboard-client.js", import.meta.url),
    ];
    const errors: string[] = [];

    try {
      for (const clientUrl of clientUrls) {
        try {
          dashboardClientCache = readFileSync(clientUrl);
          break;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      if (dashboardClientCache === null) {
        dashboardClientLoadError = errors.join("; ");
      }
    }
  }

  if (dashboardClientCache !== null) {
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(dashboardClientCache);
  } else {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Dashboard client is missing. Run npm run build.");
  }
}

function sendDashboardClientStyles(res: ServerResponse): void {
  if (
    dashboardClientCssCache === null &&
    dashboardClientCssLoadError === null
  ) {
    const stylesheetUrls = [
      new URL("./public/dashboard-client.css", import.meta.url),
      new URL("../dist/public/dashboard-client.css", import.meta.url),
    ];
    const errors: string[] = [];

    try {
      for (const stylesheetUrl of stylesheetUrls) {
        try {
          dashboardClientCssCache = readFileSync(stylesheetUrl);
          break;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      if (dashboardClientCssCache === null) {
        dashboardClientCssLoadError = errors.join("; ");
      }
    }
  }

  if (dashboardClientCssCache !== null) {
    res.writeHead(200, {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(dashboardClientCssCache);
  } else {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Dashboard styles are missing. Run npm run build.");
  }
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

export function renderDashboardHtml(options: DashboardStateOptions): string {
  const config = JSON.stringify({
    instanceId: options.instanceId,
    namespace: options.namespace,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MeshCore MQTT Dashboard</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/dashboard-client.css">
</head>
<body>
  <div id="root"></div>
  <script>window.__DASHBOARD_CONFIG__ = ${config};</script>
  <script type="module" src="/dashboard-client.js"></script>
</body>
</html>`;
}

interface ObserverStatusKnown {
  status: "known";
  publicKey: string;
  observer: {
    publicKey: string;
    shortKey: string;
    region?: string;
    name?: string;
    brokerId?: string;
    lastSeen?: number;
  };
}

interface ObserverStatusBlocked {
  status: "blocked";
  publicKey: string;
  observer: {
    publicKey: string;
    shortKey: string;
    region?: string;
    name?: string;
    brokerId?: string;
    lastSeen?: number;
  };
  block: {
    reason: string;
    deniedUntilText?: string;
    mutedUntil?: number;
    region?: string;
    brokerId?: string;
    lastSeen?: number;
  };
}

interface ObserverStatusUnknown {
  status: "unknown";
  publicKey: string;
  message: string;
}

interface ObserverStatusInvalid {
  status: "invalid";
  message: string;
}

interface ObserverStatusError {
  status: "error";
  message: string;
}

type ObserverStatus =
  | ObserverStatusKnown
  | ObserverStatusBlocked
  | ObserverStatusUnknown
  | ObserverStatusInvalid
  | ObserverStatusError;

function shortKey(publicKey: string): string {
  if (publicKey.length <= 18) {
    return publicKey;
  }
  return `${publicKey.slice(0, 10)}...${publicKey.slice(-6)}`;
}

export async function lookupObserverStatus(
  publicKey: string,
  clusterStateStore: ClusterStateStore,
): Promise<ObserverStatus> {
  const normalized = normalizePublicKey(publicKey);
  const short = shortKey(normalized);

  const [bans, deniedPublishes, observerEntries, nodeNames] = await Promise.all(
    [
      clusterStateStore.listPublicBans(200),
      clusterStateStore.listDeniedPublishes(200),
      clusterStateStore.listInstanceObservers(),
      clusterStateStore.getObserverNodeNames([normalized]),
    ],
  );

  const denialEvents = [...bans, ...deniedPublishes];
  const blockMatch = denialEvents.find(
    (event) => event.node.toUpperCase() === normalized,
  );

  if (blockMatch) {
    return {
      status: "blocked",
      publicKey: normalized,
      observer: {
        publicKey: normalized,
        shortKey: short,
        region: blockMatch.region,
        name: nodeNames.get(normalized),
        brokerId: blockMatch.broker,
        lastSeen: blockMatch.lastUpdatedAt,
      },
      block: {
        reason: blockMatch.reason,
        deniedUntilText: blockMatch.deniedUntilText,
        mutedUntil: blockMatch.mutedUntil,
        region: blockMatch.region,
        brokerId: blockMatch.broker,
        lastSeen: blockMatch.lastUpdatedAt,
      },
    };
  }

  const observerEntry = observerEntries
    .filter((entry) => entry.publicKey.toUpperCase() === normalized)
    .reduce<InstanceObserverEntry | undefined>(
      (latest, entry) =>
        !latest || entry.lastSeenAt > latest.lastSeenAt ? entry : latest,
      undefined,
    );

  if (observerEntry) {
    return {
      status: "known",
      publicKey: normalized,
      observer: {
        publicKey: normalized,
        shortKey: short,
        region: observerEntry.region,
        name: nodeNames.get(normalized),
        brokerId: observerEntry.broker,
        lastSeen: observerEntry.lastSeenAt,
      },
    };
  }

  return {
    status: "unknown",
    publicKey: normalized,
    message: "This observer has not been seen by any broker instance.",
  };
}

export function createDashboardServer(options: DashboardServerOptions) {
  const html = renderDashboardHtml(options);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      let url: URL;
      try {
        url = new URL(req.url || "/", "http://localhost");
      } catch {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("Bad Request");
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" });
        res.end();
        return;
      }

      if (url.pathname === "/favicon.svg") {
        sendFavicon(res);
        return;
      }

      if (url.pathname === "/dashboard-client.js") {
        sendDashboardClient(res);
        return;
      }

      if (url.pathname === "/dashboard-client.css") {
        sendDashboardClientStyles(res);
        return;
      }

      if (url.pathname === "/api/dashboard") {
        const snapshot = await options.state.getSnapshot(
          options.clusterStateStore,
          options.activeBans(),
        );
        sendJson(res, snapshot);
        return;
      }

      if (url.pathname.startsWith("/api/v1/observers/")) {
        const pathParts = url.pathname.split("/");
        const publicKeyIndex = pathParts.indexOf("observers") + 1;
        if (
          pathParts.length !== 6 ||
          pathParts[5] !== "status" ||
          publicKeyIndex >= pathParts.length
        ) {
          res.writeHead(400, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(
            JSON.stringify({
              status: "invalid",
              message: "Invalid public key",
            }),
          );
          return;
        }

        let rawPublicKey: string;
        try {
          rawPublicKey = decodeURIComponent(pathParts[publicKeyIndex]);
        } catch {
          res.writeHead(400, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(
            JSON.stringify({
              status: "invalid",
              message: "Invalid public key",
            }),
          );
          return;
        }

        const validKey = validatePublicKey(rawPublicKey);
        if (!validKey) {
          res.writeHead(400, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(
            JSON.stringify({
              status: "invalid",
              message: "Invalid public key",
            }),
          );
          return;
        }

        try {
          const result = await lookupObserverStatus(
            validKey,
            options.clusterStateStore,
          );
          sendJson(res, result);
        } catch (error) {
          log.error(
            "error checking observer:",
            error instanceof Error ? error.message : String(error),
          );
          res.writeHead(500, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(
            JSON.stringify({
              status: "error",
              message: "Observer status could not be checked. Try again later.",
            }),
          );
        }
        return;
      }

      if (url.pathname === "/") {
        sendHtml(res, html);
        return;
      }

      notFound(res);
    })().catch((error) => {
      log.error(
        "dashboard request failed:",
        error instanceof Error ? error.message : String(error),
      );

      if (res.headersSent) {
        res.destroy();
        return;
      }

      res.writeHead(503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(
        JSON.stringify({
          status: "error",
          message: "Dashboard data is temporarily unavailable.",
        }),
      );
    });
  });

  server.on("error", (error) => {
    log.error("dashboard HTTP server error:", error.message);
  });

  return {
    server,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        const onError = (err: Error) => reject(err);
        server.once("error", onError);
        try {
          server.listen(options.port, options.host, () => {
            server.removeListener("error", onError);
            const address = server.address() as AddressInfo;
            resolve(address.port);
          });
        } catch (err) {
          server.removeListener("error", onError);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
