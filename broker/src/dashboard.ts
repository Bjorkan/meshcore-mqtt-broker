import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync } from 'fs';
import type { AddressInfo } from 'net';
import type { PublishPacket } from 'aedes';
import type { ClusterStateStore, DashboardInstanceMetrics, InstanceObserverEntry, PublicBanSummary } from './orchestration.js';

const DASHBOARD_METRICS_WINDOW_MS = 60_000;
const MAX_OBSERVERS = 200;
const MAX_OBSERVER_MESSAGES = 50;
const MAX_RECENT_PUBLISHES = 50;

let dashboardClientCache: Buffer | null = null;
let dashboardClientLoadError: string | null = null;
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 24 24" role="img" aria-label="Meshat radio tower favicon"><rect width="24" height="24" rx="5" fill="#1f7a3d"/><g transform="translate(2 2) scale(0.8333333333)" fill="none" stroke="#FFFFFF" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/><circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/></g></svg>`;

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
  abuse?: {
    status: 'muted' | 'would_mute' | 'denied';
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
  abuse?: {
    status: 'muted' | 'would_mute' | 'denied';
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
  messagesPerSecond: number;
  messagesLastMinute: number;
  targetBridge?: DashboardInstanceMetrics['targetBridge'];
  ready: boolean;
  status: 'healthy' | 'stale';
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
  };
  brokers: PublicBrokerMetrics[];
  observers: DashboardObserver[];
  recentPublishes: ObserverMessage[];
  bans: PublicBanSummary[];
  countyNames?: Record<string, string>;
  error?: string;
}

export interface DashboardStateOptions {
  instanceId: string;
  namespace: string;
  targetBridgeStatus?: () => DashboardInstanceMetrics['targetBridge'];
  swedishCountiesLookup?: {
    getAllCountyNames(): Record<string, string>;
    isAvailable(): boolean;
  };
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function maskIdentifier(value: string | undefined): string {
  if (!value) {
    return 'unknown';
  }

  const normalized = value.trim();
  if (normalized.length <= 12) {
    return normalized;
  }

  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function publicClientLabel(client: any): string {
  if (client?.clientType === 'publisher') {
    return client.nodeName || client.publicKey || maskIdentifier(client.id);
  }

  if (client?.clientType === 'subscriber') {
    return client.username === 'docker_health' ? 'docker health' : 'subscriber';
  }

  return maskIdentifier(client?.id);
}

function isPublisherClient(client: any): boolean {
  return client?.clientType === 'publisher' && typeof client?.publicKey === 'string';
}

function parseObserverTopic(topic: string): { publicKey: string; region: string; subtopic: string } | undefined {
  const parts = topic.split('/');
  if (parts.length < 4 || parts[0] !== 'meshcore') {
    return undefined;
  }

  const publicKey = parts[2].toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(publicKey)) {
    return undefined;
  }

  return {
    publicKey,
    region: parts[1].toUpperCase(),
    subtopic: parts.slice(3).join('/'),
  };
}

function isPublicDashboardTopic(topic: { subtopic: string } | undefined): topic is { publicKey: string; region: string; subtopic: string } {
  if (!topic) {
    return false;
  }

  const subtopicRoot = topic.subtopic.split('/')[0].toLowerCase();
  return subtopicRoot !== 'internal' && subtopicRoot !== 'serial';
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

function publicObserver(observer: TrackedObserver, ban?: PublicBanSummary): DashboardObserver {
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
    abuse: ban ? {
      status: ban.status,
      reason: ban.reason,
      blockCount: ban.blockCount,
      mutedUntil: ban.mutedUntil,
      broker: ban.broker,
      deniedUntilText: ban.deniedUntilText,
    } : undefined,
  };
}

function withFriendlyName(observer: DashboardObserver, friendlyNames: Map<string, string>): DashboardObserver {
  const friendlyName = friendlyNames.get(observer.publicKey);
  if (!friendlyName) {
    return observer;
  }

  return {
    ...observer,
    label: friendlyName,
    messages: observer.messages.map((message) => ({
      ...message,
      observer: message.publicKey === observer.publicKey ? friendlyName : message.observer,
    })),
  };
}

function messageWithFriendlyName(message: ObserverMessage, friendlyNames: Map<string, string>): ObserverMessage {
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

function publicBrokerMetrics(entry: DashboardInstanceMetrics, generatedAt: number, readyInstances: Set<string>): PublicBrokerMetrics {
  const age = generatedAt - entry.lastUpdatedAt;
  const ready = readyInstances.has(entry.instanceId);
  const status = ready && age < 120_000 ? 'healthy' as const : 'stale' as const;
  return {
    instanceId: entry.instanceId,
    startedAt: entry.startedAt,
    connectedClients: entry.connectedClients,
    publisherClients: entry.publisherClients,
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
  private targetBridgeStatus?: () => DashboardInstanceMetrics['targetBridge'];
  private swedishCountiesLookup?: DashboardStateOptions['swedishCountiesLookup'];
  private startedAt = now();
  private clients = new Map<string, TrackedObserver>();
  private observers = new Map<string, TrackedObserver>();
  private publishTimestamps: number[] = [];
  private recentPublishes: ObserverMessage[] = [];

  constructor(options: DashboardStateOptions) {
    this.instanceId = options.instanceId;
    this.namespace = options.namespace;
    this.targetBridgeStatus = options.targetBridgeStatus;
    this.swedishCountiesLookup = options.swedishCountiesLookup;
  }

  recordClientConnected(client: any): void {
    if (!isPublisherClient(client)) {
      return;
    }

    const connectedAt = typeof client?.connectedAt === 'number' ? client.connectedAt : now();
    const publicKey = client.publicKey.toUpperCase();
    const existingObserver = this.observers.get(publicKey);
    const entry: TrackedObserver = {
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
    };

    this.clients.set(client?.id || entry.clientId, entry);
    this.upsertObserver(entry);
  }

  recordClientAuthenticated(client: any): void {
    if (!isPublisherClient(client)) {
      return;
    }

    const key = client?.id;
    if (!key) {
      return;
    }

    const existing = this.clients.get(key);
    const publicKey = client.publicKey.toUpperCase();
    const existingObserver = this.observers.get(publicKey);
    const parsedRegion = typeof client?.lastRegion === 'string' ? client.lastRegion : undefined;
    const connectedAt = existing?.connectedAt || client.connectedAt || now();
    const entry: TrackedObserver = {
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
    };

    this.clients.set(key, entry);
    this.upsertObserver(entry);
  }

  recordClientRegion(client: any, region: string): void {
    const key = client?.id;
    if (!key) {
      return;
    }

    const existing = this.clients.get(key);
    if (existing) {
      existing.region = region;
      this.upsertObserver(existing);
    }
  }

  recordClientDisconnected(client: any): void {
    if (client?.id) {
      const existing = this.clients.get(client.id);
      if (existing) {
        existing.active = false;
        this.upsertObserver(existing);
      }
      this.clients.delete(client.id);
    }
  }

  recordPublish(packet: PublishPacket, client: any): void {
    const timestamp = now();
    if (!isPublisherClient(client)) {
      return;
    }

    const topic = parseObserverTopic(packet.topic);
    if (!isPublicDashboardTopic(topic)) {
      return;
    }

    const publicKey = topic?.publicKey || client.publicKey.toUpperCase();
    const existing = this.observers.get(publicKey) || this.clients.get(client.id);
    if (!existing) {
      return;
    }

    const message: ObserverMessage = {
      topic: packet.topic,
      broker: this.instanceId,
      region: topic?.region || existing.region,
      observer: existing.label || maskIdentifier(publicKey),
      publicKey,
      subtopic: topic?.subtopic,
      bytes: packet.payload.length,
      receivedAt: timestamp,
    };

    this.publishTimestamps.push(timestamp);
    this.recentPublishes = [message, ...this.recentPublishes].slice(0, MAX_RECENT_PUBLISHES);

    const updatedLabel = publicClientLabel(client);
    const updated: TrackedObserver = {
      ...existing,
      label: updatedLabel,
      broker: this.instanceId,
      region: topic?.region || existing.region,
      active: this.clients.has(client.id),
      lastSeenAt: timestamp,
      messageCount: existing.messageCount + 1,
      messages: [message, ...existing.messages].slice(0, MAX_OBSERVER_MESSAGES),
    };

    this.clients.set(client.id, updated);
    this.upsertObserver(updated);
  }

  private upsertObserver(observer: TrackedObserver): void {
    this.observers.set(observer.publicKey, observer);

    if (this.observers.size > MAX_OBSERVERS) {
      const entries = Array.from(this.observers.entries());
      const oldest = entries
        .sort((a, b) => {
          // Prefer evicting inactive observers first, then by oldest lastSeenAt
          if (a[1].active !== b[1].active) return a[1].active ? 1 : -1;
          return a[1].lastSeenAt - b[1].lastSeenAt;
        })[0];
      if (oldest) {
        this.observers.delete(oldest[0]);
      }
    }
  }

  private observerList(bans: PublicBanSummary[] = []): DashboardObserver[] {
    const bansByNode = new Map(bans.map((ban) => [ban.node.toUpperCase(), ban]));
    return Array.from(this.observers.values())
      .filter((observer) => observer.active)
      .map((observer) => publicObserver(observer, bansByNode.get(observer.publicKey)))
      .sort((a, b) => Number(b.active) - Number(a.active) || b.lastSeenAt - a.lastSeenAt);
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
    return Array.from(this.observers.values()).filter((observer) => observer.active).map((observer) => ({
      label: observer.label,
      publicKey: observer.publicKey,
      broker: observer.broker,
      region: observer.region,
      active: observer.active,
      lastConnectedAt: observer.lastConnectedAt,
      lastSeenAt: observer.lastSeenAt,
      messageCount: observer.messageCount,
      messages: observer.messages.map(publicMessage),
    }));
  }

  getLocalMetrics(activeBans: number): DashboardInstanceMetrics {
    const timestamp = now();
    this.prunePublishTimestamps(timestamp);

    const activeObservers = this.localActiveObservers();
    const messagesLastMinute = this.publishTimestamps.length;
    return {
      instanceId: this.instanceId,
      connectedClients: activeObservers.length,
      subscriberClients: 0,
      publisherClients: activeObservers.length,
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

  async getSnapshot(clusterStateStore: ClusterStateStore, activeBans: number): Promise<DashboardSnapshot> {
    const generatedAt = now();
    const localMetrics = this.getLocalMetrics(activeBans);

    try {
      await clusterStateStore.setInstanceMetrics(localMetrics);
      await clusterStateStore.setInstanceObservers(this.getObserverEntries());
      const [readiness, metrics, bans, deniedPublishes, remoteObserverEntries] = await Promise.all([
        clusterStateStore.listInstanceReadiness(),
        clusterStateStore.listInstanceMetrics(),
        clusterStateStore.listPublicBans(),
        clusterStateStore.listDeniedPublishes(),
        clusterStateStore.listInstanceObservers(),
      ]);
      const denialEvents = [...bans, ...deniedPublishes]
        .sort((a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0))
        .slice(0, 50);
      const readyInstances = new Set(readiness.filter((entry) => entry.status === 'ready').map((entry) => entry.instanceId));
      const brokers = metrics
        .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
        .map((entry) => publicBrokerMetrics(entry, generatedAt, readyInstances));
      const healthyBrokerIds = new Set(brokers.filter((broker) => broker.status === 'healthy').map((broker) => broker.instanceId));

      const bansByNode = new Map(bans.map((ban) => [ban.node.toUpperCase(), ban]));
      const observerCandidates = remoteObserverEntries.filter((entry) => entry.active && healthyBrokerIds.has(entry.broker));
      const observerClaimOwners = await clusterStateStore.getObserverClaims(observerCandidates.map((entry) => entry.publicKey));
      const visibleObserverCandidates = observerCandidates.filter((entry) => observerClaimOwners.get(entry.publicKey) === entry.broker);
      const observerMessages = visibleObserverCandidates.flatMap((entry) => entry.messages.map(publicMessage));
      const claimedObserverKeys = [
        ...visibleObserverCandidates.map((entry) => entry.publicKey),
        ...denialEvents.map((ban) => ban.node),
        ...observerMessages.map((message) => message.publicKey).filter((publicKey): publicKey is string => typeof publicKey === 'string'),
      ];
      const friendlyNames = await clusterStateStore.getObserverNodeNames(claimedObserverKeys);
      const observers = visibleObserverCandidates.map((entry) => {
        const ban = bansByNode.get(entry.publicKey);
        return withFriendlyName({
          label: entry.label,
          publicKey: entry.publicKey,
          broker: entry.broker,
          region: entry.region,
          active: entry.active,
          lastConnectedAt: entry.lastConnectedAt,
          lastSeenAt: entry.lastSeenAt,
          messageCount: entry.messageCount,
          messages: entry.messages,
          abuse: ban ? {
            status: ban.status,
            reason: ban.reason,
            blockCount: ban.blockCount,
            mutedUntil: ban.mutedUntil,
            broker: ban.broker,
            deniedUntilText: ban.deniedUntilText,
          } : undefined,
        }, friendlyNames);
      })
        .sort((a, b) => Number(b.active) - Number(a.active) || b.lastSeenAt - a.lastSeenAt);
      const recentPublishes = observerMessages
        .map((message) => messageWithFriendlyName(message, friendlyNames))
        .sort((a, b) => b.receivedAt - a.receivedAt)
        .slice(0, MAX_RECENT_PUBLISHES);
      const healthyBrokers = brokers.filter((broker) => broker.status === 'healthy');
      const observerLabels = new Map(observers.map((o) => [o.publicKey, o.label]));
      const bansWithLabels = denialEvents.map((ban) => ({
        ...ban,
        label: friendlyNames.get(ban.node.toUpperCase()) || observerLabels.get(ban.node) || ban.label,
      }));

      const countyNames = this.swedishCountiesLookup?.isAvailable()
        ? this.swedishCountiesLookup.getAllCountyNames()
        : undefined;

      return {
        generatedAt,
        respondingBroker: this.instanceId,
        namespace: this.namespace,
        summary: {
          connectedClients: healthyBrokers.reduce((total, broker) => total + broker.connectedClients, 0),
          connectedObservers: healthyBrokers.reduce((total, broker) => total + broker.publisherClients, 0),
          activeBrokers: healthyBrokers.length,
          totalBrokers: brokers.length,
          messagesPerSecond: Math.round(healthyBrokers.reduce((total, broker) => total + broker.messagesPerSecond, 0) * 100) / 100,
          publishesLastMinute: healthyBrokers.reduce((total, broker) => total + (broker.messagesLastMinute || 0), 0),
          activeBans: denialEvents.length,
        },
        brokers,
        observers,
        recentPublishes,
        bans: bansWithLabels,
        countyNames,
      };
    } catch (error) {
      console.error('Failed to build dashboard snapshot', error);
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
        },
        brokers: [],
        observers: [],
        recentPublishes: [],
        bans: [],
        error: 'Unable to load dashboard snapshot from Valkey.',
      };
    }
  }

  private prunePublishTimestamps(timestamp = now()): void {
    const cutoff = timestamp - DASHBOARD_METRICS_WINDOW_MS;
    this.publishTimestamps = this.publishTimestamps.filter((entry) => entry >= cutoff);
  }
}

function sendJson(res: ServerResponse, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(html);
}

function sendFavicon(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'public, max-age=86400',
  });
  res.end(FAVICON_SVG);
}

function sendDashboardClient(res: ServerResponse): void {
  if (dashboardClientCache === null && dashboardClientLoadError === null) {
    const clientUrls = [
      new URL('./public/dashboard-client.js', import.meta.url),
      new URL('../dist/public/dashboard-client.js', import.meta.url),
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
        dashboardClientLoadError = errors.join('; ');
      }
    }
  }

  if (dashboardClientCache !== null) {
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(dashboardClientCache);
  } else {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Dashboardklienten saknas. Kör npm run build.');
  }
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

export function renderDashboardHtml(options: DashboardStateOptions): string {
  const escapedBroker = escapeHtml(options.instanceId);
  const escapedNamespace = escapeHtml(options.namespace);
  const config = JSON.stringify({
    instanceId: options.instanceId,
    namespace: options.namespace,
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MeshCore MQTT Brokers</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    :root {
      color-scheme: light;
      --green-900: #064e3b;
      --green-800: #087c57;
      --green-700: #0c8f67;
      --green-100: #e7f8f0;
      --green-50: #f2fbf7;
      --ink: #0f172a;
      --muted: #536176;
      --line: #dce5df;
      --panel: #ffffff;
      --page: #f7faf8;
      --cyan: #0ea5a5;
      --blue: #2563eb;
      --orange: #f97316;
      --red: #dc2626;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--page);
      color: var(--ink);
      min-height: 100vh;
    }
    .shell {
      display: grid;
      grid-template-columns: 270px minmax(0, 1fr);
      min-height: 100vh;
    }
    aside {
      position: sticky;
      top: 0;
      height: 100vh;
      background: rgba(255, 255, 255, .86);
      border-right: 1px solid var(--line);
      padding: 28px 22px;
      display: flex;
      flex-direction: column;
      gap: 28px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 11px;
      color: var(--green-800);
      font-size: 27px;
      font-weight: 760;
      letter-spacing: 0;
    }
    .brand svg { width: 34px; height: 34px; flex: none; }
    .sidebar-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .menu-button {
      display: none;
      width: 42px;
      height: 42px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: #334155;
      place-items: center;
      cursor: pointer;
    }
    .broker-badge {
      margin-top: -18px;
      padding: 10px 12px;
      border-radius: 8px;
      background: #f3fbf7;
      border: 1px solid #d7eee4;
      color: var(--green-900);
      font-size: 12px;
      font-weight: 720;
      overflow-wrap: anywhere;
    }
    .broker-badge span {
      display: block;
      color: var(--muted);
      font-weight: 600;
      margin-bottom: 3px;
    }
    .nav {
      display: grid;
      gap: 8px;
    }
    .mdi {
      width: 22px;
      height: 22px;
      display: block;
      flex: none;
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 13px;
      padding: 14px 16px;
      color: #334155;
      border-radius: 8px;
      font-weight: 620;
      text-decoration: none;
      user-select: none;
    }
    .nav-item.active {
      color: var(--green-800);
      background: linear-gradient(90deg, var(--green-50), #ffffff);
      box-shadow: inset 0 0 0 1px #d8f0e6;
    }
    .privacy {
      margin-top: auto;
      display: grid;
      gap: 10px;
      padding: 18px;
      border: 1px solid #cfe9dd;
      border-radius: 8px;
      background: linear-gradient(180deg, #f6fffb, #edf8f2);
      color: #526172;
      font-size: 13px;
      line-height: 1.55;
    }
    main {
      padding: 28px 30px 24px;
      min-width: 0;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      margin-bottom: 24px;
    }
    .eyebrow {
      color: var(--green-800);
      font-size: 13px;
      font-weight: 760;
      margin-bottom: 6px;
    }
    h1 {
      margin: 0;
      font-size: 30px;
      line-height: 1.08;
      letter-spacing: 0;
    }
    .subtitle {
      margin-top: 8px;
      color: var(--muted);
      font-size: 16px;
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 18px;
      color: #475569;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .readonly {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      min-height: 42px;
      padding: 0 17px;
      background: var(--green-800);
      color: #fff;
      border-radius: 7px;
      font-weight: 760;
      font-size: 14px;
      box-shadow: 0 10px 20px rgba(8, 124, 87, .16);
    }
    .readonly .mdi {
      width: 42px;
      height: 42px;
    }
    .timebox {
      border-left: 1px solid var(--line);
      padding-left: 20px;
      min-width: 150px;
      font-weight: 700;
    }
    .timebox small {
      display: block;
      color: var(--muted);
      font-weight: 500;
      margin-top: 2px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 16px;
    }
    .card, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, .05);
    }
    .card {
      min-height: 148px;
      padding: 24px;
      display: grid;
      grid-template-columns: 70px 1fr;
      align-items: center;
      gap: 18px;
    }
    .icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: var(--green-800);
      background: var(--green-50);
    }
    .icon .mdi { width: 34px; height: 34px; }
    .metric-label {
      font-size: 15px;
      font-weight: 700;
    }
    .metric-value {
      margin-top: 8px;
      font-size: 32px;
      color: var(--green-800);
      font-weight: 800;
      letter-spacing: 0;
    }
    .metric-note {
      margin-top: 12px;
      color: var(--muted);
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(380px, .98fr);
      gap: 16px;
    }
    .panel {
      padding: 18px;
      min-width: 0;
    }
    .panel h2 {
      margin: 0 0 8px;
      font-size: 20px;
      letter-spacing: 0;
    }
    .panel-subtitle {
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 14px;
    }
    .panel-subtitle.after {
      margin-top: 14px;
      margin-bottom: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .broker-table th:first-child,
    .broker-table td:first-child {
      width: 30%;
    }
    .broker-table th:nth-child(2),
    .broker-table td:nth-child(2) {
      width: 14%;
    }
    .broker-table th:nth-child(3),
    .broker-table td:nth-child(3),
    .broker-table th:nth-child(4),
    .broker-table td:nth-child(4) {
      width: 12%;
    }
    .broker-table th:nth-child(5),
    .broker-table td:nth-child(5) {
      width: 18%;
    }
    .broker-table th:nth-child(6),
    .broker-table td:nth-child(6) {
      width: 14%;
    }
    th, td {
      border-top: 1px solid #edf2ef;
      padding: 12px 10px;
      text-align: left;
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    th {
      color: #657184;
      font-size: 12px;
      font-weight: 760;
      background: #fbfdfc;
    }
    .status-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-right: 9px;
      border-radius: 50%;
      background: #22c55e;
    }
    .status-dot.green { background: #22c55e; }
    .status-dot.yellow { background: #facc15; }
    .status-dot.red { background: var(--red); }
    .status-dot.warn { background: var(--orange); }
    .status-dot.stale { background: #94a3b8; }
    .icon-button {
      width: 40px;
      height: 40px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: #334155;
      display: grid;
      place-items: center;
      cursor: pointer;
    }
    .icon-button:hover {
      background: #f7fbf9;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      justify-self: start;
      width: fit-content;
      max-width: 100%;
      min-height: 22px;
      padding: 2px 8px;
      border-radius: 6px;
      font-weight: 720;
      font-size: 12px;
      line-height: 1.2;
      background: #e9f9ef;
      color: var(--green-800);
      border: 1px solid #bde7cc;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .pill.red {
      background: #fff1f2;
      color: var(--red);
      border-color: #fecdd3;
    }
    .pill.orange {
      background: #fff7ed;
      color: #c2410c;
      border-color: #fed7aa;
    }
    .pill.gray {
      background: #f1f5f9;
      color: #475569;
      border-color: #dbe3ec;
    }
    .click-row {
      cursor: pointer;
    }
    .click-row:hover td {
      background: #f7fbf9;
    }
    th.sortable {
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    th.sortable:hover {
      color: #0c8f67;
    }
    .cell-value {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .search {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 13px;
      margin-bottom: 14px;
      background: #fff;
      color: var(--muted);
    }
    .search input {
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      font: inherit;
      color: var(--ink);
      background: transparent;
    }
    .search input::placeholder {
      color: #8b98aa;
    }
    .filter-bar {
      display: flex;
      gap: 10px;
      margin-bottom: 14px;
    }
    .filter-bar .search {
      flex: 1;
      margin-bottom: 0;
    }
    .region-select {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 13px;
      font: inherit;
      color: var(--ink);
      background: #fff;
      cursor: pointer;
      min-height: 44px;
      min-width: 120px;
    }
    .region-select:hover {
      border-color: #0c8f67;
    }
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .detail-grid.compact {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .detail-grid div {
      min-width: 0;
      padding: 12px;
      border: 1px solid #edf2ef;
      border-radius: 8px;
      background: #fbfdfc;
    }
    .detail-grid span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
      margin-bottom: 6px;
    }
    .detail-grid strong {
      display: block;
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 14px;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 50;
      background: rgba(15, 23, 42, .34);
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .modal {
      width: min(1120px, 100%);
      max-height: min(860px, calc(100vh - 48px));
      overflow: auto;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 24px 80px rgba(15, 23, 42, .22);
      padding: 20px;
      display: grid;
      gap: 18px;
    }
    .modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      border-bottom: 1px solid #edf2ef;
      padding-bottom: 14px;
    }
    .modal-header h2 {
      margin: 0 0 6px;
      font-size: 22px;
      letter-spacing: 0;
    }
    .modal-title {
      display: flex;
      align-items: center;
      gap: 0;
      min-width: 0;
    }
    .modal h3 {
      margin: 0 0 10px;
      font-size: 18px;
      letter-spacing: 0;
    }
    .observer-detail {
      display: grid;
      gap: 18px;
      margin-top: 18px;
      padding-top: 18px;
      border-top: 1px solid #edf2ef;
    }
    .observer-detail h3 {
      margin: 0 0 8px;
      font-size: 18px;
      letter-spacing: 0;
    }
    .publish-feed-wrap {
      display: grid;
      gap: 8px;
      border-top: 1px solid #edf2ef;
      padding-top: 10px;
    }
    .publish-feed-head {
      display: grid;
      grid-template-columns: 56px minmax(180px, 1fr) 64px minmax(110px, .55fr) 80px minmax(130px, .55fr);
      gap: 14px;
      padding: 0 12px 2px;
      color: #657184;
      font-size: 12px;
      font-weight: 760;
    }
    .publish-feed {
      display: grid;
      gap: 8px;
      max-height: 470px;
      overflow: auto;
      padding-right: 4px;
    }
    .publish-row {
      display: grid;
      grid-template-columns: 56px minmax(180px, 1fr) 64px minmax(110px, .55fr) 80px minmax(130px, .55fr);
      align-items: center;
      gap: 14px;
      min-height: 56px;
      padding: 10px 12px;
      border: 1px solid #edf2ef;
      border-radius: 8px;
      background: #fbfdfc;
      transition: background .28s ease, border-color .28s ease, transform .28s ease;
    }
    .publish-row.new {
      animation: publish-enter .46s ease-out both;
    }
    .publish-time {
      color: var(--green-800);
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
    .publish-main {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .publish-main strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 14px;
    }
    .publish-main span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--muted);
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }
    .publish-pill {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 5px 7px;
      border-radius: 6px;
      background: #fff;
      border: 1px solid #edf2ef;
      color: #475569;
      font-size: 12px;
    }
    @keyframes publish-enter {
      from {
        opacity: 0;
        transform: translateY(-6px);
        background: #e7f8f0;
      }
      to {
        opacity: 1;
        transform: translateY(0);
        background: #fbfdfc;
      }
    }
    .chart-row {
      display: grid;
      grid-template-columns: 190px 1fr;
      gap: 20px;
      align-items: center;
      min-height: 210px;
    }
    .donut {
      width: 178px;
      aspect-ratio: 1;
      border-radius: 50%;
      background: conic-gradient(var(--green-700) 0 33%, var(--cyan) 33% 66%, var(--blue) 66% 100%);
      display: grid;
      place-items: center;
      margin: auto;
    }
    .donut-inner {
      width: 102px;
      aspect-ratio: 1;
      border-radius: 50%;
      background: #fff;
      display: grid;
      place-items: center;
      text-align: center;
      font-weight: 800;
      font-size: 24px;
    }
    .donut-inner span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      margin-top: 2px;
    }
    .legend {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .legend-row {
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      font-size: 14px;
    }
    .legend-color {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--green-700);
    }
    .legend-color.cyan { background: var(--cyan); }
    .legend-color.blue { background: var(--blue); }
    .notice {
      margin-top: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      border-radius: 8px;
      border: 1px solid #cfe9dd;
      background: #f5fbf8;
      color: #536176;
      font-size: 14px;
    }
    .notice .mdi {
      width: 22px;
      height: 22px;
    }
    .page-grid {
      display: grid;
      gap: 16px;
    }
    .page-grid.two {
      grid-template-columns: minmax(640px, 1.25fr) minmax(340px, .75fr);
    }
    .empty {
      color: var(--muted);
      padding: 22px 10px;
      border-top: 1px solid #edf2ef;
    }
    .span-2 { grid-column: span 2; }
    @media (max-width: 1180px) {
      .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; }
      .page-grid.two { grid-template-columns: 1fr; }
    }
    @media (max-width: 800px) {
      .shell {
        display: block;
        min-height: 100vh;
      }
      aside {
        position: sticky;
        top: 0;
        z-index: 20;
        height: auto;
        padding: 12px 12px 10px;
        gap: 10px;
        border-right: 0;
        border-bottom: 1px solid var(--line);
        background: rgba(255, 255, 255, .96);
        backdrop-filter: blur(10px);
      }
      .brand {
        font-size: 25px;
      }
      .brand svg {
        width: 32px;
        height: 32px;
      }
      .menu-button {
        display: grid;
      }
      .nav {
        display: none;
        gap: 8px;
      }
      .nav.open {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .nav-item {
        min-height: 42px;
        padding: 10px 12px;
        gap: 8px;
        font-size: 14px;
        border: 1px solid transparent;
        background: #fff;
        justify-content: flex-start;
      }
      .nav-item.active {
        box-shadow: none;
        border-color: #cfe9dd;
      }
      .nav-item .mdi {
        width: 19px;
        height: 19px;
      }
      .privacy { display: none; }
      main {
        padding: 14px 10px 20px;
      }
      .topbar {
        display: grid;
        gap: 14px;
        margin-bottom: 16px;
      }
      h1 {
        font-size: 28px;
        line-height: 1.12;
        overflow-wrap: anywhere;
      }
      .subtitle {
        font-size: 14px;
      }
      .top-actions {
        justify-content: flex-start;
      }
      .timebox {
        padding-left: 12px;
        min-width: 0;
      }
      .cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 10px;
      }
      .card {
        grid-template-columns: 38px minmax(0, 1fr);
        gap: 10px;
        padding: 12px;
        min-height: 96px;
      }
      .icon {
        width: 38px;
        height: 38px;
      }
      .icon .mdi {
        width: 22px;
        height: 22px;
      }
      .metric-label {
        font-size: 12px;
      }
      .metric-value {
        font-size: 24px;
        margin-top: 4px;
      }
      .metric-note {
        font-size: 11px;
        margin-top: 6px;
      }
      .grid, .page-grid {
        grid-template-columns: 1fr;
        gap: 10px;
      }
      .span-2 {
        grid-column: 1 / -1;
      }
      .panel {
        padding: 14px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      .panel h2 {
        font-size: 20px;
      }
      .panel-subtitle {
        font-size: 14px;
        line-height: 1.25;
      }
      .chart-row {
        grid-template-columns: 1fr;
        min-height: 0;
      }
      .donut {
        width: 150px;
      }
      .donut-inner {
        width: 86px;
      }
      table {
        min-width: 0;
        table-layout: auto;
      }
      .broker-table {
        min-width: 0;
      }
      th, td {
        font-size: 13px;
        padding: 10px 8px;
      }
      td {
        display: grid;
        grid-template-columns: minmax(92px, .45fr) minmax(0, 1fr);
        gap: 10px;
        align-items: center;
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
        overflow-wrap: anywhere;
      }
      td::before {
        content: attr(data-label);
        color: #657184;
        font-size: 12px;
        font-weight: 760;
      }
      td:first-child {
        border-top: 0;
      }
      .broker-table th:first-child,
      .broker-table td:first-child {
        width: auto;
      }
      .broker-table th:nth-child(2),
      .broker-table td:nth-child(2),
      .broker-table th:nth-child(3),
      .broker-table td:nth-child(3) {
        width: auto;
      }
      .broker-table th:nth-child(4),
      .broker-table td:nth-child(4) {
        width: auto;
      }
      .broker-table th:nth-child(5),
      .broker-table td:nth-child(5) {
        width: auto;
      }
      .broker-table th:nth-child(6),
      .broker-table td:nth-child(6) {
        width: auto;
      }
      thead {
        display: none;
      }
      tbody {
        display: grid;
        gap: 10px;
      }
      tr {
        display: grid;
        gap: 0;
        padding: 8px 0;
        border-top: 1px solid #edf2ef;
      }
      .search {
        min-height: 44px;
        margin-bottom: 12px;
      }
      .search input {
        font-size: 16px;
      }
      .detail-grid, .detail-grid.compact { grid-template-columns: 1fr; }
      .modal-backdrop {
        align-items: start;
        justify-items: stretch;
        padding: 8px;
      }
      .modal {
        width: 100%;
        max-height: calc(100vh - 16px);
        padding: 14px;
        gap: 14px;
      }
      .modal section {
        min-width: 0;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      .modal-header {
        gap: 10px;
      }
      .modal-header h2 {
        font-size: 20px;
      }
      .modal-header .panel-subtitle {
        overflow-wrap: anywhere;
      }
      .publish-feed-head { display: none; }
      .publish-feed {
        max-height: none;
        padding-right: 0;
      }
      .publish-row {
        grid-template-columns: 48px minmax(0, 1fr);
        gap: 8px;
        padding: 10px;
      }
      .publish-pill {
        grid-column: span 1;
        min-width: 0;
      }
    }
    @media (max-width: 430px) {
      .cards {
        grid-template-columns: 1fr;
      }
      h1 {
        font-size: 25px;
      }
      .brand {
        font-size: 24px;
      }
      table { min-width: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .publish-row { animation: none; }
    }
  </style>
</head>
<body>
  <div id="root" data-instance="${escapedBroker}" data-namespace="${escapedNamespace}"></div>
  <script>window.__DASHBOARD_CONFIG__ = ${config};</script>
  <script type="module" src="/dashboard-client.js"></script>
</body>
</html>`;
}

export function createDashboardServer(options: DashboardServerOptions) {
  const html = renderDashboardHtml(options);
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }

    if (url.pathname === '/favicon.svg') {
      sendFavicon(res);
      return;
    }

    if (url.pathname === '/dashboard-client.js') {
      sendDashboardClient(res);
      return;
    }

    if (url.pathname === '/api/dashboard') {
      const snapshot = await options.state.getSnapshot(options.clusterStateStore, options.activeBans());
      sendJson(res, snapshot);
      return;
    }

    if (url.pathname === '/') {
      sendHtml(res, html);
      return;
    }

    notFound(res);
  });

  return {
    server,
    listen: () => new Promise<number>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      try {
        server.listen(options.port, options.host, () => {
          server.removeListener('error', onError);
          const address = server.address() as AddressInfo;
          resolve(address.port);
        });
      } catch (err) {
        server.removeListener('error', onError);
        reject(err);
      }
    }),
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  };
}
