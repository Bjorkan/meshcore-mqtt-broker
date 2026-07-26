export interface BrokerMetrics {
  instanceId: string;
  startedAt: number;
  connectedClients: number;
  publisherClients: number;
  claimedObservers: number;
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
  ready: boolean;
  status: "healthy" | "stale";
  lastUpdateAgeMs: number;
}

export interface ObserverMessage {
  topic: string;
  broker: string;
  region?: string;
  observer?: string;
  publicKey?: string;
  subtopic?: string;
  bytes: number;
  receivedAt: number;
}

export interface DashboardObserver {
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

export interface BanSummary {
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

export interface MeshcoreIoWorkerStatus {
  instanceId: string;
  configuredWorkers: number;
  activeUploads: number;
  uploadsSucceeded: number;
  uploadsFailed: number;
  lastUploadAt?: number;
  lastError?: string;
  updatedAt: number;
}

export interface MeshcoreIoHistoryEntry {
  at: number;
  status: "uploaded" | "dropped";
  requestId: string;
  nodeName: string;
  nodePublicKey: string;
  advertType: string;
  observerName?: string;
  workerInstanceId: string;
  detail?: string;
}

export interface MeshcoreIoMapAdvert {
  at: number;
  requestId: string;
  nodeName: string;
  nodePublicKey: string;
  advertType: string;
  observerName?: string;
  workerInstanceId: string;
  latitude: number;
  longitude: number;
}

export interface MeshcoreIoDashboardSnapshot {
  enabled: boolean;
  processor: {
    instanceId?: string;
    status: "disabled" | "healthy";
  };
  queue: {
    ingressPending: number;
    queued: number;
    claimed: number;
    active: number;
    claimedNotActive: number;
    total: number;
    maxQueuedUploads: number;
  };
  totals: {
    enqueued: number;
    uploaded: number;
    dropped: number;
    invalid: number;
    retries: number;
  };
  workers: MeshcoreIoWorkerStatus[];
  history: MeshcoreIoHistoryEntry[];
  map?: {
    advertsLast7Days: MeshcoreIoMapAdvert[];
  };
  lastError?: string;
}

export interface DashboardSnapshot {
  generatedAt: number;
  respondingBroker: string;
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
    protectionEventsTotal: number;
  };
  brokers: BrokerMetrics[];
  observers: DashboardObserver[];
  recentPublishes: ObserverMessage[];
  bans: BanSummary[];
  subscribers: SubscriberConnectionEntry[];
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
  meshcoreIo?: MeshcoreIoDashboardSnapshot;
  error?: string;
}

export interface CountyLookupEntry {
  countyName: string;
  primaryIata: string;
  isPrimary: boolean;
}

import type { ObserverNeighborsSnapshot } from "../../src/neighbors.js";

export type View =
  "overview" | "observers" | "meshcoreio" | "bans" | "subscribers";

export type SortDir = "asc" | "desc";

export type DenialStatus = BanSummary["status"];
