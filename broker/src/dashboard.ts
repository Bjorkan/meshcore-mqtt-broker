import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync } from 'fs';
import type { AddressInfo } from 'net';
import type { PublishPacket } from 'aedes';
import type { ClusterStateStore, DashboardInstanceMetrics, PublicBanSummary } from './orchestration.js';

const DASHBOARD_METRICS_WINDOW_MS = 60_000;
const MAX_RECENT_CONNECTIONS = 20;
const MAX_RECENT_TOPICS = 30;
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 24 24" role="img" aria-label="Meshat radio tower favicon"><rect width="24" height="24" rx="5" fill="#1f7a3d"/><g transform="translate(2 2) scale(0.8333333333)" fill="none" stroke="#FFFFFF" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/><circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/></g></svg>`;

interface DashboardClient {
  clientId: string;
  label: string;
  type: 'subscriber' | 'publisher' | 'unknown';
  broker: string;
  region?: string;
  protocol: string;
  connectedAt: number;
  status: 'connected';
}

interface RecentTopic {
  topic: string;
  broker: string;
  count: number;
  lastSeenAt: number;
}

interface DashboardSnapshot {
  generatedAt: number;
  respondingBroker: string;
  namespace: string;
  summary: {
    connectedClients: number;
    activeBrokers: number;
    totalBrokers: number;
    messagesPerSecond: number;
    activeBans: number;
  };
  brokers: Array<DashboardInstanceMetrics & {
    status: 'healthy' | 'stale';
    ready: boolean;
    lastUpdateAgeMs: number;
  }>;
  recentConnections: DashboardClient[];
  topics: RecentTopic[];
  bans: PublicBanSummary[];
  error?: string;
}

export interface DashboardStateOptions {
  instanceId: string;
  namespace: string;
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

function parseMeshcoreTopic(topic: string): { region?: string; subtopic?: string; publicKey?: string } {
  const parts = topic.split('/');
  if (parts[0] !== 'meshcore' || parts.length < 4) {
    return {};
  }

  return {
    region: parts[1],
    publicKey: parts[2],
    subtopic: parts.slice(3).join('/'),
  };
}

function publicTopicLabel(topic: string): string {
  return topic.startsWith('$SYS/') ? '$SYS/... hidden' : topic;
}

function clientType(client: any): DashboardClient['type'] {
  if (client?.clientType === 'publisher') {
    return 'publisher';
  }

  if (client?.clientType === 'subscriber') {
    return 'subscriber';
  }

  return 'unknown';
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

export class DashboardState {
  private instanceId: string;
  private namespace: string;
  private startedAt = now();
  private clients = new Map<string, DashboardClient>();
  private recentConnections: DashboardClient[] = [];
  private publishTimestamps: number[] = [];
  private topics = new Map<string, RecentTopic>();

  constructor(options: DashboardStateOptions) {
    this.instanceId = options.instanceId;
    this.namespace = options.namespace;
  }

  recordClientConnected(client: any): void {
    const connectedAt = typeof client?.connectedAt === 'number' ? client.connectedAt : now();
    const entry: DashboardClient = {
      clientId: maskIdentifier(client?.id),
      label: publicClientLabel(client),
      type: clientType(client),
      broker: this.instanceId,
      region: undefined,
      protocol: 'MQTT over WebSocket',
      connectedAt,
      status: 'connected',
    };

    this.clients.set(client?.id || entry.clientId, entry);
    this.addRecentConnection(entry);
  }

  recordClientAuthenticated(client: any): void {
    const key = client?.id;
    if (!key) {
      return;
    }

    const existing = this.clients.get(key);
    const parsedRegion = typeof client?.lastRegion === 'string' ? client.lastRegion : undefined;
    const entry: DashboardClient = {
      clientId: maskIdentifier(client.id),
      label: publicClientLabel(client),
      type: clientType(client),
      broker: this.instanceId,
      region: parsedRegion,
      protocol: 'MQTT over WebSocket',
      connectedAt: existing?.connectedAt || client.connectedAt || now(),
      status: 'connected',
    };

    this.clients.set(key, entry);
    this.addRecentConnection(entry);
  }

  recordClientRegion(client: any, region: string): void {
    const key = client?.id;
    if (!key) {
      return;
    }

    const existing = this.clients.get(key);
    if (existing) {
      existing.region = region;
    }
  }

  recordClientDisconnected(client: any): void {
    if (client?.id) {
      this.clients.delete(client.id);
    }
  }

  recordPublish(packet: PublishPacket, client: any): void {
    const timestamp = now();
    this.publishTimestamps.push(timestamp);

    if (!client || packet.topic.includes('/internal') || packet.topic.includes('/serial/')) {
      return;
    }

    const label = publicTopicLabel(packet.topic);
    const existing = this.topics.get(label);
    if (existing) {
      existing.count++;
      existing.lastSeenAt = timestamp;
    } else {
      this.topics.set(label, {
        topic: label,
        broker: this.instanceId,
        count: 1,
        lastSeenAt: timestamp,
      });
    }

    if (this.topics.size > MAX_RECENT_TOPICS) {
      const oldest = Array.from(this.topics.entries()).sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)[0];
      if (oldest) {
        this.topics.delete(oldest[0]);
      }
    }
  }

  getLocalMetrics(activeBans: number): DashboardInstanceMetrics {
    const timestamp = now();
    this.prunePublishTimestamps(timestamp);

    const clients = Array.from(this.clients.values());
    const messagesLastMinute = this.publishTimestamps.length;
    return {
      instanceId: this.instanceId,
      connectedClients: clients.length,
      subscriberClients: clients.filter((client) => client.type === 'subscriber').length,
      publisherClients: clients.filter((client) => client.type === 'publisher').length,
      messagesPerSecond: Math.round((messagesLastMinute / 60) * 100) / 100,
      messagesLastMinute,
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
      const [readiness, metrics, bans] = await Promise.all([
        clusterStateStore.listInstanceReadiness(),
        clusterStateStore.listInstanceMetrics(),
        clusterStateStore.listPublicBans(),
      ]);
      const readyInstances = new Set(readiness.filter((entry) => entry.status === 'ready').map((entry) => entry.instanceId));
      const metricsByInstance = new Map(metrics.map((entry) => [entry.instanceId, entry]));
      metricsByInstance.set(localMetrics.instanceId, localMetrics);

      const brokers = Array.from(metricsByInstance.values())
        .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
        .map((entry) => {
          const age = generatedAt - entry.lastUpdatedAt;
          const ready = readyInstances.has(entry.instanceId) || entry.instanceId === this.instanceId;
          return {
            ...entry,
            ready,
            status: ready && age < 120_000 ? 'healthy' as const : 'stale' as const,
            lastUpdateAgeMs: age,
          };
        });

      return {
        generatedAt,
        respondingBroker: this.instanceId,
        namespace: this.namespace,
        summary: {
          connectedClients: brokers.reduce((total, broker) => total + broker.connectedClients, 0),
          activeBrokers: brokers.filter((broker) => broker.status === 'healthy').length,
          totalBrokers: brokers.length,
          messagesPerSecond: Math.round(brokers.reduce((total, broker) => total + broker.messagesPerSecond, 0) * 100) / 100,
          activeBans: bans.length,
        },
        brokers,
        recentConnections: this.recentConnections.slice(0, MAX_RECENT_CONNECTIONS),
        topics: Array.from(this.topics.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
        bans: bans.slice(0, 50),
      };
    } catch (error) {
      console.error('Failed to build dashboard snapshot', error);
      return {
        generatedAt,
        respondingBroker: this.instanceId,
        namespace: this.namespace,
        summary: {
          connectedClients: localMetrics.connectedClients,
          activeBrokers: 1,
          totalBrokers: 1,
          messagesPerSecond: localMetrics.messagesPerSecond,
          activeBans,
        },
        brokers: [{
          ...localMetrics,
          ready: true,
          status: 'healthy',
          lastUpdateAgeMs: 0,
        }],
        recentConnections: this.recentConnections.slice(0, MAX_RECENT_CONNECTIONS),
        topics: Array.from(this.topics.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
        bans: [],
        error: 'Unable to load full dashboard snapshot.',
      };
    }
  }

  private addRecentConnection(entry: DashboardClient): void {
    this.recentConnections = [
      entry,
      ...this.recentConnections.filter((client) => client.clientId !== entry.clientId),
    ].slice(0, MAX_RECENT_CONNECTIONS);
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
  try {
    const body = readFileSync(new URL('./public/dashboard-client.js', import.meta.url));
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Dashboardklienten saknas. Kör npm run build. ${error instanceof Error ? error.message : String(error)}`);
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
    .status-dot.warn { background: var(--orange); }
    .status-dot.stale { background: #94a3b8; }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 25px;
      padding: 0 10px;
      border-radius: 6px;
      font-weight: 720;
      font-size: 12px;
      background: #e9f9ef;
      color: var(--green-800);
      border: 1px solid #bde7cc;
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
      grid-template-columns: minmax(0, 1fr) minmax(360px, .9fr);
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
      .shell { grid-template-columns: 1fr; }
      aside {
        position: static;
        padding: 18px;
      }
      .nav, .privacy { display: none; }
      main { padding: 18px; }
      .topbar { flex-direction: column; }
      .top-actions { justify-content: flex-start; }
      .cards { grid-template-columns: 1fr; }
      .card { grid-template-columns: 58px 1fr; padding: 18px; min-height: 120px; }
      .icon { width: 54px; height: 54px; }
      .metric-value { font-size: 28px; }
      .chart-row { grid-template-columns: 1fr; }
      th, td { font-size: 13px; padding: 10px 8px; }
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
