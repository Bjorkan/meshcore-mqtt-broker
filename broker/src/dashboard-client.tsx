import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

const MDI = {
  accountGroup: 'M12 5.5A3.5 3.5 0 0 1 15.5 9A3.5 3.5 0 0 1 12 12.5A3.5 3.5 0 0 1 8.5 9A3.5 3.5 0 0 1 12 5.5M5 8C6.11 8 7 8.89 7 10S6.11 12 5 12 3 11.11 3 10 3.89 8 5 8M19 8C20.11 8 21 8.89 21 10S20.11 12 19 12 17 11.11 17 10 17.89 8 19 8M12 14C14.33 14 19 15.17 19 17.5V20H5V17.5C5 15.17 9.67 14 12 14M5 13C6.16 13 8.05 13.3 9.4 13.9C7.83 14.68 7 15.76 7 17.5V18H1V15.5C1 13.84 3.67 13 5 13M19 13C20.33 13 23 13.84 23 15.5V18H17V17.5C17 15.76 16.17 14.68 14.6 13.9C15.95 13.3 17.84 13 19 13Z',
  eyeOutline: 'M12 9A3 3 0 0 1 15 12A3 3 0 0 1 12 15A3 3 0 0 1 9 12A3 3 0 0 1 12 9M12 4.5C17 4.5 21.27 7.61 23 12C21.27 16.39 17 19.5 12 19.5C7 19.5 2.73 16.39 1 12C2.73 7.61 7 4.5 12 4.5M3.18 12C4.83 15.36 8.24 17.5 12 17.5C15.76 17.5 19.17 15.36 20.82 12C19.17 8.64 15.76 6.5 12 6.5C8.24 6.5 4.83 8.64 3.18 12Z',
  formatListBulleted: 'M7 5H21V7H7V5M7 11H21V13H7V11M7 17H21V19H7V17M3 5H5V7H3V5M3 11H5V13H3V11M3 17H5V19H3V17Z',
  homeOutline: 'M10 20V14H14V20H19V12H22L12 3L2 12H5V20H10Z',
  lockOutline: 'M12 17A2 2 0 0 0 14 15A2 2 0 0 0 12 13A2 2 0 0 0 10 15A2 2 0 0 0 12 17M18 8A2 2 0 0 1 20 10V20A2 2 0 0 1 18 22H6A2 2 0 0 1 4 20V10A2 2 0 0 1 6 8H7V6A5 5 0 0 1 12 1A5 5 0 0 1 17 6V8H18M12 3A3 3 0 0 0 9 6V8H15V6A3 3 0 0 0 12 3Z',
  pulse: 'M16 6L13.5 14.5L10.5 9L8.5 13H2V11H7.26L10.5 4.5L13.3 10L15.5 2L18.5 11H22V13H17L16 6Z',
  server: 'M4 1H20A2 2 0 0 1 22 3V7A2 2 0 0 1 20 9H4A2 2 0 0 1 2 7V3A2 2 0 0 1 4 1M4 3V7H20V3H4M4 11H20A2 2 0 0 1 22 13V17A2 2 0 0 1 20 19H4A2 2 0 0 1 2 17V13A2 2 0 0 1 4 11M4 13V17H20V13H4M6 4.5A1.5 1.5 0 1 1 6 7.5A1.5 1.5 0 0 1 6 4.5M6 14.5A1.5 1.5 0 1 1 6 17.5A1.5 1.5 0 0 1 6 14.5Z',
  shieldOutline: 'M12 1L3 5V11C3 16.55 6.84 21.74 12 23C17.16 21.74 21 16.55 21 11V5L12 1M12 3.18L19 6.3V11.22C19 15.77 16.04 20 12 21C7.96 20 5 15.77 5 11.22V6.3L12 3.18Z',
};

interface BrokerMetrics {
  instanceId: string;
  connectedClients: number;
  messagesPerSecond: number;
  ready: boolean;
  status: 'healthy' | 'stale';
  lastUpdateAgeMs: number;
}

interface RecentConnection {
  label: string;
  broker: string;
  region?: string;
  type: string;
  connectedAt: number;
}

interface TopicSummary {
  topic: string;
  broker: string;
  count: number;
  lastSeenAt: number;
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
    activeBrokers: number;
    totalBrokers: number;
    messagesPerSecond: number;
    activeBans: number;
  };
  brokers: BrokerMetrics[];
  recentConnections: RecentConnection[];
  topics: TopicSummary[];
  bans: BanSummary[];
  error?: string;
}

type View = 'overview' | 'brokers' | 'clients' | 'topics' | 'bans' | 'health';

const views: View[] = ['overview', 'brokers', 'clients', 'topics', 'bans', 'health'];
const numberFormat = new Intl.NumberFormat('sv-SE');
const colors = ['#0c8f67', '#0ea5a5', '#2563eb', '#f97316'];

function Icon({ path }: { path: string }) {
  return <svg className="mdi" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d={path} /></svg>;
}

function Brand() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#16b486" d="M3 5.8 6.8 3l5.2 4 5.2-4L21 5.8V19h-4.2V10.4L12 14.1 7.2 10.4V19H3z" /></svg>;
}

function hashView(): View {
  const value = window.location.hash.replace('#', '') as View;
  return views.includes(value) ? value : 'overview';
}

function age(ms: number): string {
  if (!Number.isFinite(ms)) return '-';
  if (ms < 1000) return 'nu';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s sedan`;
  return `${Math.round(seconds / 60)}m sedan`;
}

function utcTime(timestamp: number): string {
  return `${new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

function Pill({ children, tone = 'green' }: { children: React.ReactNode; tone?: 'green' | 'orange' | 'red' }) {
  return <span className={`pill ${tone === 'green' ? '' : tone}`}>{children}</span>;
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
    <table>
      <thead><tr><th>Broker</th><th>Status</th><th>Redo</th><th>Klienter</th><th>Msg/s</th><th>Senast uppdaterad</th></tr></thead>
      <tbody>
        {brokers.map((broker) => (
          <tr key={broker.instanceId}>
            <td><span className={`status-dot ${broker.status === 'healthy' ? '' : 'stale'}`} />{broker.instanceId}</td>
            <td><Pill tone={broker.status === 'healthy' ? 'green' : 'orange'}>{broker.status === 'healthy' ? 'Frisk' : 'Gammal data'}</Pill></td>
            <td>{broker.ready ? 'Ja' : 'Nej'}</td>
            <td>{numberFormat.format(broker.connectedClients)}</td>
            <td>{numberFormat.format(broker.messagesPerSecond)}</td>
            <td>{age(broker.lastUpdateAgeMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BrokerLegend({ brokers, total }: { brokers: BrokerMetrics[]; total: number }) {
  if (brokers.length === 0) return <Empty>Inga broker-mätvärden ännu.</Empty>;
  return (
    <div className="legend">
      {brokers.map((broker, index) => {
        const pct = total > 0 ? Math.round((broker.connectedClients / total) * 1000) / 10 : 0;
        return (
          <div className="legend-row" key={broker.instanceId}>
            <span className="legend-color" style={{ background: colors[index % colors.length] }} />
            <span>{broker.instanceId}</span>
            <strong>{numberFormat.format(broker.connectedClients)} ({numberFormat.format(pct)}%)</strong>
          </div>
        );
      })}
    </div>
  );
}

function Donut({ brokers, total }: { brokers: BrokerMetrics[]; total: number }) {
  let start = 0;
  const segments = brokers.map((broker, index) => {
    const share = total > 0 ? (broker.connectedClients / total) * 100 : 100 / Math.max(brokers.length, 1);
    const end = start + share;
    const segment = `${colors[index % colors.length]} ${start}% ${end}%`;
    start = end;
    return segment;
  });
  return (
    <div className="donut" style={{ background: segments.length ? `conic-gradient(${segments.join(',')})` : 'conic-gradient(#dce5df 0 100%)' }}>
      <div className="donut-inner"><div><span>{numberFormat.format(total)}</span><span>Totalt</span></div></div>
    </div>
  );
}

function ConnectionTable({ connections }: { connections: RecentConnection[] }) {
  if (connections.length === 0) return <Empty>Inga senaste anslutningar på denna broker.</Empty>;
  return (
    <table>
      <thead><tr><th>Klient / nod</th><th>Broker</th><th>Region</th><th>Typ</th><th>Ansluten sedan</th><th>Status</th></tr></thead>
      <tbody>
        {connections.map((client, index) => (
          <tr key={`${client.label}-${client.connectedAt}-${index}`}>
            <td><span className="status-dot" />{client.label}</td>
            <td>{client.broker}</td>
            <td>{client.region || '-'}</td>
            <td>{client.type}</td>
            <td>{utcTime(client.connectedAt)}</td>
            <td><Pill>Ansluten</Pill></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BanTable({ bans }: { bans: BanSummary[] }) {
  if (bans.length === 0) return <Empty>Inga aktiva bans.</Empty>;
  return (
    <table>
      <thead><tr><th>Nod / nyckel</th><th>Broker</th><th>Orsak</th><th>Antal blockar</th><th>Mutad till</th><th>Status</th></tr></thead>
      <tbody>
        {bans.map((ban, index) => (
          <tr key={`${ban.node}-${index}`}>
            <td><span className="status-dot warn" />{ban.node}</td>
            <td>{ban.broker}</td>
            <td>{ban.reason}</td>
            <td>{ban.blockCount}</td>
            <td>{ban.mutedUntil ? utcTime(ban.mutedUntil) : '-'}</td>
            <td><Pill tone={ban.status === 'muted' ? 'red' : 'orange'}>{ban.status === 'muted' ? 'Mutad' : 'Skulle muta'}</Pill></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TopicTable({ topics }: { topics: TopicSummary[] }) {
  if (topics.length === 0) return <Empty>Ingen publik topic-aktivitet på denna broker ännu.</Empty>;
  return (
    <table>
      <thead><tr><th>Topic</th><th>Broker</th><th>Publiceringar</th><th>Senast sedd</th></tr></thead>
      <tbody>
        {topics.map((topic) => (
          <tr key={`${topic.topic}-${topic.broker}`}>
            <td>{topic.topic}</td>
            <td>{topic.broker}</td>
            <td>{topic.count}</td>
            <td>{utcTime(topic.lastSeenAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Notice({ icon, children }: { icon: string; children: React.ReactNode }) {
  return <div className="notice"><Icon path={icon} />{children}</div>;
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

  const generatedAt = snapshot?.generatedAt ?? Date.now();
  const date = new Date(generatedAt);
  const respondingBroker = snapshot?.respondingBroker ?? window.__DASHBOARD_CONFIG__?.instanceId ?? 'broker';
  const namespace = snapshot?.namespace ?? window.__DASHBOARD_CONFIG__?.namespace ?? '-';
  const summary = snapshot?.summary ?? { connectedClients: 0, activeBrokers: 0, totalBrokers: 0, messagesPerSecond: 0, activeBans: 0 };
  const brokers = snapshot?.brokers ?? [];
  const balanceText = `${summary.activeBrokers} friska repliker rapporterar.`;
  const navItems: Array<{ view: View; label: string; icon: string }> = [
    { view: 'overview', label: 'Översikt', icon: MDI.homeOutline },
    { view: 'brokers', label: 'Brokrar', icon: MDI.server },
    { view: 'clients', label: 'Klienter', icon: MDI.accountGroup },
    { view: 'topics', label: 'Topics', icon: MDI.formatListBulleted },
    { view: 'bans', label: 'Bans', icon: MDI.shieldOutline },
    { view: 'health', label: 'Hälsa', icon: MDI.pulse },
  ];
  const page = useMemo(() => {
    if (view === 'brokers') {
      return (
        <div className="page-grid two">
          <Panel title="Brokrar" subtitle="Alla instanser som nyligen rapporterat mätvärden till Valkey."><BrokerTable brokers={brokers} /></Panel>
          <Panel title="Klientfördelning"><BrokerLegend brokers={brokers} total={summary.connectedClients} /><div className="panel-subtitle after">{balanceText}</div></Panel>
        </div>
      );
    }
    if (view === 'clients') {
      return <Panel title="Klienter" subtitle="Senaste publika anslutningar som denna broker har sett."><ConnectionTable connections={snapshot?.recentConnections ?? []} /></Panel>;
    }
    if (view === 'topics') {
      return <Panel title="Publika topics" subtitle="Endast publika topics visas. Interna topics och serial-flöden filtreras bort."><TopicTable topics={snapshot?.topics ?? []} /><Notice icon={MDI.lockOutline}>IP-adresser, secrets och intern broker-data visas inte här.</Notice></Panel>;
    }
    if (view === 'bans') {
      return <Panel title="Bans" subtitle="Aktiva och publikt säkra abuse-blockeringar från klustret."><BanTable bans={snapshot?.bans ?? []} /></Panel>;
    }
    if (view === 'health') {
      return (
        <div className="page-grid">
          <Panel title="Hälsa" subtitle="Redo-status, Valkey-rapportering och senaste uppdatering per broker."><BrokerTable brokers={brokers} /></Panel>
          <Notice icon={MDI.pulse}>Dashboarden svarar från <strong>{respondingBroker}</strong> och läser klustertillstånd från Valkey.</Notice>
        </div>
      );
    }
    return (
      <>
        <section className="cards">
          <MetricCard id="clients" label="Anslutna klienter" value={numberFormat.format(summary.connectedClients)} note="Totalt i klustret" icon={MDI.accountGroup} />
          <MetricCard id="brokers" label="Aktiva brokrar" value={`${summary.activeBrokers} / ${summary.totalBrokers}`} note={summary.activeBrokers === summary.totalBrokers ? 'Alla brokrar är friska' : 'En replik behöver kollas'} icon={MDI.server} />
          <MetricCard id="mps" label="Meddelanden / sek" value={numberFormat.format(summary.messagesPerSecond)} note="Senaste 60 sekunderna" icon={MDI.pulse} />
          <MetricCard id="bans" label="Aktiva bans" value={numberFormat.format(summary.activeBans)} note="Mutade eller skulle muta" icon={MDI.shieldOutline} />
        </section>
        <section className="grid">
          <Panel title="Brokerstatus" subtitle="Tillstånd delas och orkestreras mellan Valkey-repliker."><BrokerTable brokers={brokers} /></Panel>
          <Panel title="Klienter per broker">
            <div className="chart-row">
              <Donut brokers={brokers} total={summary.connectedClients} />
              <BrokerLegend brokers={brokers} total={summary.connectedClients} />
            </div>
            <div className="panel-subtitle after">{balanceText}</div>
          </Panel>
          <Panel title="Senaste anslutningar"><ConnectionTable connections={snapshot?.recentConnections ?? []} /></Panel>
          <Panel title="Bans"><BanTable bans={snapshot?.bans ?? []} /></Panel>
          <Panel title="Publika topics" className="span-2">
            <TopicTable topics={snapshot?.topics ?? []} />
            <Notice icon={MDI.lockOutline}>IP-adresser, secrets, interna topics och PII är dolda. MeshCore public keys visas eftersom de är publika identiteter.</Notice>
          </Panel>
        </section>
      </>
    );
  }, [balanceText, brokers, namespace, respondingBroker, snapshot, summary, view]);

  return (
    <div className="shell">
      <aside>
        <div className="brand"><Brand /><span>meshat.se</span></div>
        <div className="broker-badge"><span>Svarade</span><strong>{respondingBroker}</strong></div>
        <nav className="nav">
          {navItems.map((item) => (
            <a className={`nav-item ${view === item.view ? 'active' : ''}`} href={`#${item.view}`} data-nav={item.view} key={item.view}>
              <Icon path={item.icon} /><span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="privacy">
          <strong>Publik / read only</strong>
          <span>IP-adresser, secrets, interna topics och PII visas inte här.</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <div className="eyebrow">Svarade: <span>{respondingBroker}</span></div>
            <h1>MeshCore MQTT Brokers</h1>
            <div className="subtitle">Publik read-only driftöversikt · namespace <span>{namespace}</span></div>
          </div>
          <div className="top-actions">
            <div className="readonly"><Icon path={MDI.eyeOutline} /> PUBLIK / READ ONLY</div>
            <div className="timebox"><span>{date.toISOString().slice(11, 16)} UTC</span><small>{date.toISOString().slice(0, 10)}</small></div>
          </div>
        </header>
        {page}
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
