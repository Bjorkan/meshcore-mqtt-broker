import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const MDI = {
  accountGroup: 'M12 5.5A3.5 3.5 0 0 1 15.5 9A3.5 3.5 0 0 1 12 12.5A3.5 3.5 0 0 1 8.5 9A3.5 3.5 0 0 1 12 5.5M5 8C6.11 8 7 8.89 7 10S6.11 12 5 12 3 11.11 3 10 3.89 8 5 8M19 8C20.11 8 21 8.89 21 10S20.11 12 19 12 17 11.11 17 10 17.89 8 19 8M12 14C14.33 14 19 15.17 19 17.5V20H5V17.5C5 15.17 9.67 14 12 14M5 13C6.16 13 8.05 13.3 9.4 13.9C7.83 14.68 7 15.76 7 17.5V18H1V15.5C1 13.84 3.67 13 5 13M19 13C20.33 13 23 13.84 23 15.5V18H17V17.5C17 15.76 16.17 14.68 14.6 13.9C15.95 13.3 17.84 13 19 13Z',
  close: 'M18.3 5.71L16.89 4.29L12 9.17L7.11 4.29L5.7 5.71L10.59 10.6L5.7 15.49L7.11 16.9L12 12.01L16.89 16.9L18.3 15.49L13.41 10.6L18.3 5.71Z',
  homeOutline: 'M10 20V14H14V20H19V12H22L12 3L2 12H5V20H10Z',
  menu: 'M3 6H21V8H3V6M3 11H21V13H3V11M3 16H21V18H3V16Z',
  magnify: 'M9.5 3A6.5 6.5 0 0 1 16 9.5C16 11.11 15.41 12.59 14.44 13.73L20.71 20L19 21.71L12.73 15.44C11.59 16.41 10.11 17 8.5 17A6.5 6.5 0 0 1 2 10.5A6.5 6.5 0 0 1 8.5 4M8.5 6A4.5 4.5 0 0 0 4 10.5A4.5 4.5 0 0 0 8.5 15A4.5 4.5 0 0 0 13 10.5A4.5 4.5 0 0 0 8.5 6Z',
  pulse: 'M16 6L13.5 14.5L10.5 9L8.5 13H2V11H7.26L10.5 4.5L13.3 10L15.5 2L18.5 11H22V13H17L16 6Z',
  server: 'M4 1H20A2 2 0 0 1 22 3V7A2 2 0 0 1 20 9H4A2 2 0 0 1 2 7V3A2 2 0 0 1 4 1M4 3V7H20V3H4M4 11H20A2 2 0 0 1 22 13V17A2 2 0 0 1 20 19H4A2 2 0 0 1 2 17V13A2 2 0 0 1 4 11M4 13V17H20V13H4M6 4.5A1.5 1.5 0 1 1 6 7.5A1.5 1.5 0 0 1 6 4.5M6 14.5A1.5 1.5 0 1 1 6 17.5A1.5 1.5 0 0 1 6 14.5Z',
  shieldOutline: 'M12 1L3 5V11C3 16.55 6.84 21.74 12 23C17.16 21.74 21 16.55 21 11V5L12 1M12 3.18L19 6.3V11.22C19 15.77 16.04 20 12 21C7.96 20 5 15.77 5 11.22V6.3L12 3.18Z',
};

interface BrokerMetrics {
  instanceId: string;
  connectedClients: number;
  publisherClients: number;
  messagesPerSecond: number;
  messagesLastMinute: number;
  ready: boolean;
  status: 'healthy' | 'stale';
  lastUpdateAgeMs: number;
}

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
    status: 'muted' | 'would_mute';
    reason: string;
    blockCount: number;
    mutedUntil?: number;
    broker: string;
  };
}

interface BanSummary {
  node: string;
  broker: string;
  reason: string;
  blockCount: number;
  mutedUntil?: number;
  status: 'muted' | 'would_mute';
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
  brokers: BrokerMetrics[];
  observers: DashboardObserver[];
  recentPublishes: ObserverMessage[];
  bans: BanSummary[];
  error?: string;
}

type View = 'overview' | 'brokers' | 'observers' | 'bans';

const views: View[] = ['overview', 'brokers', 'observers', 'bans'];
const numberFormat = new Intl.NumberFormat('sv-SE');
const timeFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const headerTimeFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  hour: '2-digit',
  minute: '2-digit',
});
const headerDateFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const shortTimeFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  hour: '2-digit',
  minute: '2-digit',
});
const colors = ['#0c8f67', '#0ea5a5', '#2563eb', '#f97316'];

function Icon({ path }: { path: string }) {
  return <svg className="mdi" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d={path} /></svg>;
}

function Brand() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#1f7a3d" />
      <g transform="translate(2 2) scale(0.8333333333)" fill="none" stroke="#FFFFFF" strokeWidth="2.35" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9" />
        <path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5" />
        <circle cx="12" cy="9" r="2" />
        <path d="M16.2 4.8c2 2 2.26 5.11.8 7.47" />
        <path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1" />
        <path d="M9.5 18h5" />
        <path d="m8 22 4-11 4 11" />
      </g>
    </svg>
  );
}

function hashView(): View {
  const value = window.location.hash.replace('#', '').split('/')[0] as View;
  return views.includes(value) ? value : 'overview';
}

function age(ms: number): string {
  if (!Number.isFinite(ms)) return '-';
  if (ms < 1000) return 'nu';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s sedan`;
  return `${Math.round(seconds / 60)}m sedan`;
}

function stockholmTime(timestamp: number): string {
  return `${timeFormat.format(new Date(timestamp))} Europe/Stockholm`;
}

function stockholmShortTime(timestamp: number): string {
  return shortTimeFormat.format(new Date(timestamp));
}

function shortKey(publicKey: string): string {
  return publicKey.length > 18 ? `${publicKey.slice(0, 10)}...${publicKey.slice(-6)}` : publicKey;
}

function demoObserver(timestamp: number, broker: string): DashboardObserver {
  const publicKey = 'DEMO000000000000000000000000000000000000000000000000000000000001';
  return {
    label: 'Demo observer',
    publicKey,
    broker,
    region: 'GOT',
    active: true,
    lastConnectedAt: timestamp - 18 * 60_000,
    lastSeenAt: timestamp - 75_000,
    messageCount: 128,
    messages: [
      {
        topic: `meshcore/GOT/${publicKey}/packets`,
        broker,
        region: 'GOT',
        observer: 'Demo observer',
        publicKey,
        subtopic: 'packets',
        bytes: 214,
        receivedAt: timestamp - 75_000,
      },
      {
        topic: `meshcore/GOT/${publicKey}/status`,
        broker,
        region: 'GOT',
        observer: 'Demo observer',
        publicKey,
        subtopic: 'status',
        bytes: 172,
        receivedAt: timestamp - 4 * 60_000,
      },
      {
        topic: `meshcore/GOT/${publicKey}/telemetry`,
        broker,
        region: 'GOT',
        observer: 'Demo observer',
        publicKey,
        subtopic: 'telemetry',
        bytes: 96,
        receivedAt: timestamp - 9 * 60_000,
      },
    ],
  };
}

function Pill({ children, tone = 'green' }: { children: React.ReactNode; tone?: 'green' | 'orange' | 'red' | 'gray' }) {
  return <span className={`pill ${tone === 'green' ? '' : tone}`}>{children}</span>;
}

function brokerStatusTone(broker: BrokerMetrics): 'green' | 'yellow' | 'red' {
  if (broker.status === 'healthy' && broker.ready) {
    return 'green';
  }

  if (broker.lastUpdateAgeMs < 120_000) {
    return 'yellow';
  }

  return 'red';
}

function brokerStatusText(broker: BrokerMetrics): string {
  const tone = brokerStatusTone(broker);
  if (tone === 'green') return 'Frisk';
  if (tone === 'yellow') return broker.ready ? 'Svarar inte stabilt' : 'Startar';
  return 'Offline';
}

function observerStatusTone(observer: DashboardObserver): 'green' | 'yellow' | undefined {
  if (!observer.active) {
    return undefined;
  }

  if (observer.messageCount === 0) {
    return 'yellow';
  }

  return Date.now() - observer.lastSeenAt < 120_000 ? 'green' : 'yellow';
}

function observerStatusText(tone: 'green' | 'yellow' | undefined): string {
  if (tone === 'green') return 'Online';
  if (tone === 'yellow') return 'Ansluten, väntar på färsk trafik';
  return 'Offline';
}

function MetricCard({ id, label, value, note, icon }: { id: string; label: string; value: string; note: string; icon: string }) {
  return (
    <div className="card" id={id}>
      <div className="icon"><Icon path={icon} /></div>
      <div>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        <div className="metric-note">{note}</div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

function BrokerTable({ brokers }: { brokers: BrokerMetrics[] }) {
  if (brokers.length === 0) return <Empty>Inga broker-mätvärden ännu.</Empty>;
  return (
    <table className="broker-table">
      <thead><tr><th>Broker</th><th>Observers</th><th>Publishes/min</th><th>Senast uppdaterad</th></tr></thead>
      <tbody>
        {brokers.map((broker) => {
          const statusTone = brokerStatusTone(broker);
          return (
          <tr key={broker.instanceId}>
            <td data-label="Broker"><span className="cell-value"><span className={`status-dot ${statusTone}`} title={brokerStatusText(broker)} />{broker.instanceId}</span></td>
            <td data-label="Observers">{numberFormat.format(broker.status === 'healthy' ? broker.publisherClients ?? broker.connectedClients : 0)}</td>
            <td data-label="Publishes/min">{numberFormat.format(broker.status === 'healthy' ? broker.messagesLastMinute || 0 : 0)}</td>
            <td data-label="Uppdaterad">{age(broker.lastUpdateAgeMs)}</td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BrokerLegend({ brokers, total }: { brokers: BrokerMetrics[]; total: number }) {
  if (brokers.length === 0) return <Empty>Inga broker-mätvärden ännu.</Empty>;
  return (
    <div className="legend">
      {brokers.map((broker, index) => {
        const observers = broker.status === 'healthy' ? broker.publisherClients ?? broker.connectedClients : 0;
        const pct = total > 0 ? Math.round((observers / total) * 1000) / 10 : 0;
        return (
          <div className="legend-row" key={broker.instanceId}>
            <span className="legend-color" style={{ background: colors[index % colors.length] }} />
            <span>{broker.instanceId}</span>
            <strong>{numberFormat.format(observers)} ({numberFormat.format(pct)}%)</strong>
          </div>
        );
      })}
    </div>
  );
}

function Donut({ brokers, total }: { brokers: BrokerMetrics[]; total: number }) {
  let start = 0;
  const segments = brokers.map((broker, index) => {
    const observers = broker.status === 'healthy' ? broker.publisherClients ?? broker.connectedClients : 0;
    const share = total > 0 ? (observers / total) * 100 : 100 / Math.max(brokers.length, 1);
    const end = start + share;
    const segment = `${colors[index % colors.length]} ${start}% ${end}%`;
    start = end;
    return segment;
  });
  return (
    <div className="donut" style={{ background: segments.length ? `conic-gradient(${segments.join(',')})` : 'conic-gradient(#dce5df 0 100%)' }}>
      <div className="donut-inner"><div><span>{numberFormat.format(total)}</span><span>Observers</span></div></div>
    </div>
  );
}

function ObserverSearch({ query, setQuery }: { query: string; setQuery: (value: string) => void }) {
  return (
    <label className="search">
      <Icon path={MDI.magnify} />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sök observer, public key eller region" />
    </label>
  );
}

function ObserverTable({ observers, onSelect, activeOnly = false }: { observers: DashboardObserver[]; onSelect: (observer: DashboardObserver) => void; activeOnly?: boolean }) {
  const visibleObservers = activeOnly ? observers.filter((observer) => observer.active) : observers;
  if (visibleObservers.length === 0) return <Empty>{activeOnly ? 'Inga aktiva observers just nu.' : 'Inga observers matchar sökningen.'}</Empty>;
  return (
    <table>
      <thead><tr><th>Observer</th><th>Ansvarig broker</th><th>Region</th><th>Senast ansluten</th><th>Senast meddelande</th><th>Blockerad</th></tr></thead>
      <tbody>
        {visibleObservers.map((observer) => {
          const statusTone = observerStatusTone(observer);
          return (
          <tr
            className="click-row"
            key={observer.publicKey}
            tabIndex={0}
            role="button"
            onClick={() => onSelect(observer)}
            onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); } if (e.key === 'Enter' || e.key === ' ') { onSelect(observer); } }}
          >
            <td data-label="Observer"><span className="cell-value">{statusTone ? <span className={`status-dot ${statusTone}`} title={observerStatusText(statusTone)} /> : null}{observer.label || shortKey(observer.publicKey)}</span></td>
            <td data-label="Ansvarig broker">{observer.broker}</td>
            <td data-label="Region">{observer.region || '-'}</td>
            <td data-label="Senast ansluten">{stockholmShortTime(observer.lastConnectedAt)}</td>
            <td data-label="Senast meddelande">{observer.messageCount > 0 ? stockholmShortTime(observer.lastSeenAt) : '-'}</td>
            <td data-label="Blockerad">{observer.abuse ? <Pill tone="red">Ja</Pill> : <Pill>Nej</Pill>}</td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ObserverModal({ observer, onClose }: { observer: DashboardObserver; onClose: () => void }) {
  const statusTone = observerStatusTone(observer);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="observer-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="observer-dialog-title">
              {statusTone ? <span className={`status-dot ${statusTone}`} title={observerStatusText(statusTone)} /> : null}
              {observer.label || shortKey(observer.publicKey)}
            </h2>
            <div className="panel-subtitle">{observer.publicKey}</div>
          </div>
          <button className="icon-button" type="button" aria-label="Stäng" onClick={onClose}><Icon path={MDI.close} /></button>
        </div>
        <section>
          <div className="detail-grid">
            <div><span>Ansvarig broker</span><strong>{observer.broker}</strong></div>
            <div><span>Region</span><strong>{observer.region || '-'}</strong></div>
            <div><span>Senast ansluten</span><strong>{stockholmTime(observer.lastConnectedAt)}</strong></div>
            <div><span>Senast meddelande</span><strong>{observer.messageCount > 0 ? stockholmTime(observer.lastSeenAt) : '-'}</strong></div>
            <div><span>Meddelanden</span><strong>{numberFormat.format(observer.messageCount)}</strong></div>
          </div>
        </section>
        <section>
          <h3>Blockering</h3>
          {observer.abuse ? (
            <div className="detail-grid compact">
              <div><span>Blockerad</span><strong>Ja</strong></div>
              <div><span>Anledning</span><strong>{observer.abuse.reason}</strong></div>
              <div><span>Blockeringar</span><strong>{numberFormat.format(observer.abuse.blockCount)}</strong></div>
              <div><span>Rapporterad av</span><strong>{observer.abuse.broker}</strong></div>
              <div><span>Blockerad till</span><strong>{observer.abuse.mutedUntil ? stockholmTime(observer.abuse.mutedUntil) : '-'}</strong></div>
            </div>
          ) : <Empty>Observern är inte blockerad.</Empty>}
        </section>
        <section>
          <h3>Senaste 50 meddelanden</h3>
          <MessageTable messages={observer.messages} />
        </section>
      </div>
    </div>
  );
}

function MessageTable({ messages }: { messages: ObserverMessage[] }) {
  if (messages.length === 0) return <Empty>Inga meddelanden registrerade ännu.</Empty>;
  return (
    <table>
      <thead><tr><th>Tid</th><th>Ansvarig broker</th><th>Region</th><th>Subtopic</th><th>Bytes</th><th>Topic</th></tr></thead>
      <tbody>
        {messages.map((message, index) => (
          <tr key={`${message.receivedAt}-${index}`}>
            <td data-label="Tid">{stockholmShortTime(message.receivedAt)}</td>
            <td data-label="Ansvarig broker">{message.broker}</td>
            <td data-label="Region">{message.region || '-'}</td>
            <td data-label="Subtopic">{message.subtopic || '-'}</td>
            <td data-label="Bytes">{numberFormat.format(message.bytes)}</td>
            <td data-label="Topic">{message.topic}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function publishKey(publish: ObserverMessage): string {
  return `${publish.receivedAt}:${publish.topic}:${publish.broker}`;
}

function PublishFeed({ publishes }: { publishes: ObserverMessage[] }) {
  const previousKeys = useRef<Set<string> | null>(null);
  const visiblePublishes = publishes.slice(0, 50);
  const currentKeys = useMemo(() => new Set(visiblePublishes.map(publishKey)), [visiblePublishes]);
  const newKeys = useMemo(() => {
    if (!previousKeys.current) return new Set<string>();
    return new Set(visiblePublishes.map(publishKey).filter((key) => !previousKeys.current!.has(key)));
  }, [visiblePublishes]);

  useEffect(() => {
    previousKeys.current = currentKeys;
  }, [currentKeys]);

  if (publishes.length === 0) return <Empty>Inga publiseringar registrerade ännu.</Empty>;
  return (
    <div className="publish-feed-wrap">
      <div className="publish-feed-head">
        <span>Tid</span>
        <span>Observer</span>
        <span>IATA</span>
        <span>Subtopic</span>
        <span>Storlek</span>
        <span>Ansvarig broker</span>
      </div>
      <div className="publish-feed" aria-live="polite">
        {visiblePublishes.map((publish) => {
          const key = publishKey(publish);
          return (
        <div className={`publish-row ${newKeys.has(key) ? 'new' : ''}`} key={key}>
          <span className="publish-time">{stockholmShortTime(publish.receivedAt)}</span>
          <span className="publish-main">
            <strong>{publish.observer || shortKey(publish.publicKey || '') || 'Observer'}</strong>
            <span>{publish.topic}</span>
          </span>
          <span className="publish-pill">{publish.region || '-'}</span>
          <span className="publish-pill">{publish.subtopic || '-'}</span>
          <span className="publish-pill">{numberFormat.format(publish.bytes)} B</span>
          <span className="publish-pill">{publish.broker}</span>
        </div>
          );
        })}
      </div>
    </div>
  );
}

function BanTable({ bans }: { bans: BanSummary[] }) {
  if (bans.length === 0) return <Empty>Inga aktiva blockeringar.</Empty>;
  return (
    <table>
      <thead><tr><th>Nod / nyckel</th><th>Broker</th><th>Orsak</th><th>Antal blockeringar</th><th>Blockerad till</th><th>Status</th></tr></thead>
      <tbody>
        {bans.map((ban, index) => (
          <tr key={`${ban.node}-${index}`}>
            <td data-label="Nod / nyckel"><span className="cell-value"><span className="status-dot warn" />{shortKey(ban.node)}</span></td>
            <td data-label="Broker">{ban.broker}</td>
            <td data-label="Orsak">{ban.reason}</td>
            <td data-label="Antal">{ban.blockCount}</td>
            <td data-label="Blockerad till">{ban.mutedUntil ? stockholmTime(ban.mutedUntil) : '-'}</td>
            <td data-label="Status"><Pill tone={ban.status === 'muted' ? 'red' : 'orange'}>{ban.status === 'muted' ? 'Blockerad' : 'Skulle blockeras'}</Pill></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Panel({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`panel ${className}`}>
      <h2>{title}</h2>
      {subtitle ? <div className="panel-subtitle">{subtitle}</div> : null}
      {children}
    </div>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [view, setView] = useState<View>(hashView);
  const [query, setQuery] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [selectedObserver, setSelectedObserver] = useState<DashboardObserver | null>(null);
  const [demoTimestamp] = useState(() => Date.now());

  useEffect(() => {
    const onHashChange = () => setView(hashView());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const response = await fetch('/api/dashboard', { cache: 'no-store' });
      const data = await response.json() as DashboardSnapshot;
      if (active) setSnapshot(data);
    }
    refresh().catch(console.error);
    const interval = window.setInterval(() => refresh().catch(console.error), 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selectedObserver) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedObserver(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedObserver]);

  const generatedAt = snapshot?.generatedAt ?? Date.now();
  const date = new Date(generatedAt);
  const respondingBroker = snapshot?.respondingBroker ?? window.__DASHBOARD_CONFIG__?.instanceId ?? 'broker';
  const namespace = snapshot?.namespace ?? window.__DASHBOARD_CONFIG__?.namespace ?? '-';
  const summary = snapshot?.summary ?? { connectedClients: 0, connectedObservers: 0, activeBrokers: 0, totalBrokers: 0, messagesPerSecond: 0, publishesLastMinute: 0, activeBans: 0 };
  const brokers = snapshot?.brokers ?? [];
  const observers = useMemo(() => {
    const apiObservers = snapshot?.observers ?? [];
    return apiObservers.length > 0 ? apiObservers : [demoObserver(demoTimestamp, respondingBroker)];
  }, [demoTimestamp, respondingBroker, snapshot]);
  const recentPublishes = useMemo(() => {
    const apiPublishes = snapshot?.recentPublishes ?? [];
    if (apiPublishes.length > 0) return apiPublishes;
    return observers.flatMap((observer) => observer.messages).sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 50);
  }, [observers, snapshot]);
  const balanceText = `${summary.activeBrokers} aktiva brokrar.`;
  const normalizedQuery = query.trim().toUpperCase();
  const filteredObservers = useMemo(() => {
    if (!normalizedQuery) return observers;
    return observers.filter((observer) => (
      observer.publicKey.includes(normalizedQuery) ||
      observer.label.toUpperCase().includes(normalizedQuery) ||
      (observer.region || '').toUpperCase().includes(normalizedQuery)
    ));
  }, [normalizedQuery, observers]);

  useEffect(() => {
    if (selectedObserver && !observers.some((observer) => observer.publicKey === selectedObserver.publicKey)) {
      setSelectedObserver(null);
    }
  }, [observers, selectedObserver]);
  const navItems: Array<{ view: View; label: string; icon: string }> = [
    { view: 'overview', label: 'Översikt', icon: MDI.homeOutline },
    { view: 'brokers', label: 'Brokrar', icon: MDI.server },
    { view: 'observers', label: 'Observers', icon: MDI.accountGroup },
    { view: 'bans', label: 'Blockeringar', icon: MDI.shieldOutline },
  ];
  const page = useMemo(() => {
    if (view === 'brokers') {
      return (
        <div className="page-grid two">
          <Panel title="Brokrar" subtitle="Brokerinstanser som nyligen har rapporterat status."><BrokerTable brokers={brokers} /></Panel>
          <Panel title="Observers per broker"><BrokerLegend brokers={brokers} total={summary.connectedObservers} /><div className="panel-subtitle after">{balanceText}</div></Panel>
        </div>
      );
    }
    if (view === 'observers') {
      return (
          <Panel title="Observers" subtitle="Sök efter en observer och se anslutning, senaste meddelanden och blockeringar.">
            <ObserverSearch query={query} setQuery={setQuery} />
            <ObserverTable observers={filteredObservers} onSelect={setSelectedObserver} />
        </Panel>
      );
    }
    if (view === 'bans') {
      return <Panel title="Blockeringar" subtitle="Observers som är blockerade eller skulle ha blockerats i skuggläge."><BanTable bans={snapshot?.bans ?? []} /></Panel>;
    }
    return (
      <>
        <section className="cards">
          <MetricCard id="clients" label="Anslutna observers" value={numberFormat.format(summary.connectedObservers)} note="Aktiva just nu" icon={MDI.accountGroup} />
          <MetricCard id="brokers" label="Aktiva brokrar" value={numberFormat.format(summary.activeBrokers)} note={`${numberFormat.format(summary.totalBrokers)} har rapporterat nyligen`} icon={MDI.server} />
          <MetricCard id="mps" label="Publishes / minut" value={numberFormat.format(summary.publishesLastMinute)} note="Mottagna senaste minuten" icon={MDI.pulse} />
          <MetricCard id="bans" label="Blockeringar" value={numberFormat.format(summary.activeBans)} note="Aktiva eller i skuggläge" icon={MDI.shieldOutline} />
        </section>
        <section className="grid">
          <Panel title="Brokerstatus" subtitle="Status för brokerinstanserna bakom lastbalanseraren."><BrokerTable brokers={brokers} /></Panel>
          <Panel title="Observers per broker">
            <div className="chart-row">
              <Donut brokers={brokers} total={summary.connectedObservers} />
              <BrokerLegend brokers={brokers} total={summary.connectedObservers} />
            </div>
            <div className="panel-subtitle after">{balanceText}</div>
          </Panel>
          <Panel title="Blockeringar" className="span-2"><BanTable bans={snapshot?.bans ?? []} /></Panel>
          <Panel title="Senaste publiseringar" subtitle="De 50 senaste observermeddelandena som dashboarden kan visa." className="span-2"><PublishFeed publishes={recentPublishes} /></Panel>
        </section>
      </>
    );
  }, [balanceText, brokers, filteredObservers, observers, query, recentPublishes, snapshot, summary, view]);

  return (
    <div className="shell">
      <aside>
        <div className="sidebar-top">
          <div className="brand"><Brand /><span>Meshat.se</span></div>
          <button className="menu-button" type="button" aria-label={navOpen ? 'Stäng meny' : 'Öppna meny'} aria-expanded={navOpen} onClick={() => setNavOpen((open) => !open)}>
            <Icon path={navOpen ? MDI.close : MDI.menu} />
          </button>
        </div>
        <nav className={`nav ${navOpen ? 'open' : ''}`}>
          {navItems.map((item) => (
            <a className={`nav-item ${view === item.view ? 'active' : ''}`} href={`#${item.view}`} data-nav={item.view} key={item.view} onClick={() => setNavOpen(false)}>
              <Icon path={item.icon} /><span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="privacy">
          <strong>Webbförfrågan svarades av:</strong>
          <span>{respondingBroker}</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <h1>MeshCore MQTT Brokers</h1>
            <div className="subtitle">Namespace <span>{namespace}</span></div>
          </div>
          <div className="top-actions">
            <div className="timebox"><span>{headerTimeFormat.format(date)}</span><small>{headerDateFormat.format(date)} Europe/Stockholm</small></div>
          </div>
        </header>
        {page}
        {selectedObserver ? <ObserverModal observer={selectedObserver} onClose={() => setSelectedObserver(null)} /> : null}
      </main>
    </div>
  );
}

declare global {
  interface Window {
    __DASHBOARD_CONFIG__?: {
      instanceId: string;
      namespace: string;
    };
  }
}

createRoot(document.getElementById('root')!).render(<App />);
