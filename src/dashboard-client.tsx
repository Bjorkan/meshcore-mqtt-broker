import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  formatDeniedUntilLabel as deniedUntilLabel,
  formatRegionDisplay,
  formatRegionOptionLabel,
} from "./dashboard-helpers.js";

const MDI = {
  accountGroup:
    "M12 5.5A3.5 3.5 0 0 1 15.5 9A3.5 3.5 0 0 1 12 12.5A3.5 3.5 0 0 1 8.5 9A3.5 3.5 0 0 1 12 5.5M5 8C6.11 8 7 8.89 7 10S6.11 12 5 12 3 11.11 3 10 3.89 8 5 8M19 8C20.11 8 21 8.89 21 10S20.11 12 19 12 17 11.11 17 10 17.89 8 19 8M12 14C14.33 14 19 15.17 19 17.5V20H5V17.5C5 15.17 9.67 14 12 14M5 13C6.16 13 8.05 13.3 9.4 13.9C7.83 14.68 7 15.76 7 17.5V18H1V15.5C1 13.84 3.67 13 5 13M19 13C20.33 13 23 13.84 23 15.5V18H17V17.5C17 15.76 16.17 14.68 14.6 13.9C15.95 13.3 17.84 13 19 13Z",
  close:
    "M18.3 5.71L16.89 4.29L12 9.17L7.11 4.29L5.7 5.71L10.59 10.6L5.7 15.49L7.11 16.9L12 12.01L16.89 16.9L18.3 15.49L13.41 10.6L18.3 5.71Z",
  homeOutline: "M10 20V14H14V20H19V12H22L12 3L2 12H5V20H10Z",
  menu: "M3 6H21V8H3V6M3 11H21V13H3V11M3 16H21V18H3V16Z",
  magnify:
    "M9.5 3A6.5 6.5 0 0 1 16 9.5C16 11.11 15.41 12.59 14.44 13.73L20.71 20L19 21.71L12.73 15.44C11.59 16.41 10.11 17 8.5 17A6.5 6.5 0 0 1 2 10.5A6.5 6.5 0 0 1 8.5 4M8.5 6A4.5 4.5 0 0 0 4 10.5A4.5 4.5 0 0 0 8.5 15A4.5 4.5 0 0 0 13 10.5A4.5 4.5 0 0 0 8.5 6Z",
  pulse:
    "M16 6L13.5 14.5L10.5 9L8.5 13H2V11H7.26L10.5 4.5L13.3 10L15.5 2L18.5 11H22V13H17L16 6Z",
  server:
    "M4 1H20A2 2 0 0 1 22 3V7A2 2 0 0 1 20 9H4A2 2 0 0 1 2 7V3A2 2 0 0 1 4 1M4 3V7H20V3H4M4 11H20A2 2 0 0 1 22 13V17A2 2 0 0 1 20 19H4A2 2 0 0 1 2 17V13A2 2 0 0 1 4 11M4 13V17H20V13H4M6 4.5A1.5 1.5 0 1 1 6 7.5A1.5 1.5 0 0 1 6 4.5M6 14.5A1.5 1.5 0 1 1 6 17.5A1.5 1.5 0 0 1 6 14.5Z",
  shieldOutline:
    "M12 1L3 5V11C3 16.55 6.84 21.74 12 23C17.16 21.74 21 16.55 21 11V5L12 1M12 3.18L19 6.3V11.22C19 15.77 16.04 20 12 21C7.96 20 5 15.77 5 11.22V6.3L12 3.18Z",
};

interface BrokerMetrics {
  instanceId: string;
  startedAt: number;
  connectedClients: number;
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
  ready: boolean;
  status: "healthy" | "stale";
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
    status: "muted" | "would_mute" | "denied";
    reason: string;
    blockCount: number;
    mutedUntil?: number;
    broker: string;
    deniedUntilText?: string;
  };
}

interface BanSummary {
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
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
  error?: string;
}

type View = "overview" | "brokers" | "observers" | "bans";

const views: View[] = ["overview", "brokers", "observers", "bans"];
const numberFormat = new Intl.NumberFormat("sv-SE");
const timeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const headerTimeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  hour: "2-digit",
  minute: "2-digit",
});
const headerDateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const shortTimeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  hour: "2-digit",
  minute: "2-digit",
});
const colors = ["#0c8f67", "#0ea5a5", "#2563eb", "#f97316"];

function Icon({ path }: { path: string }) {
  return (
    <svg
      className="mdi"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={path} />
    </svg>
  );
}

function Brand() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#1f7a3d" />
      <g
        transform="translate(2 2) scale(0.8333333333)"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
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

function parseHash(): {
  view: View;
  query: string;
  region: string;
  observer: string;
  ban: string;
} {
  const hash = window.location.hash.replace("#", "");
  const [viewPart, ...rest] = hash.split("?");
  const view = views.includes(viewPart as View)
    ? (viewPart as View)
    : "overview";
  const params = new URLSearchParams(rest.join("?"));
  return {
    view,
    query: params.get("q") || "",
    region: params.get("region") || "",
    observer: params.get("o") || "",
    ban: params.get("b") || "",
  };
}

function replaceHash(
  view: View,
  query: string,
  region: string,
  observer: string,
  ban: string,
): void {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (region) params.set("region", region);
  if (observer) params.set("o", observer);
  if (ban) params.set("b", ban);
  const qs = params.toString();
  const hash = `#${view}${qs ? "?" + qs : ""}`;
  history.replaceState(null, "", hash);
}

function age(ms: number): string {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1000) return "nu";
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

function optionalStockholmShortTime(timestamp: number | undefined): string {
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? stockholmShortTime(timestamp)
    : "-";
}

function optionalStockholmTime(timestamp: number | undefined): string {
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? stockholmTime(timestamp)
    : "-";
}

function shortKey(publicKey: string): string {
  return publicKey.length > 18
    ? `${publicKey.slice(0, 10)}...${publicKey.slice(-6)}`
    : publicKey;
}

function demoObserver(timestamp: number, broker: string): DashboardObserver {
  const publicKey =
    "DEMO000000000000000000000000000000000000000000000000000000000001";
  return {
    label: "Demo observer",
    publicKey,
    broker,
    region: "GOT",
    active: true,
    lastConnectedAt: timestamp - 18 * 60_000,
    lastSeenAt: timestamp - 75_000,
    messageCount: 128,
    messages: [
      {
        topic: `meshcore/GOT/${publicKey}/packets`,
        broker,
        region: "GOT",
        observer: "Demo observer",
        publicKey,
        subtopic: "packets",
        bytes: 214,
        receivedAt: timestamp - 75_000,
      },
      {
        topic: `meshcore/GOT/${publicKey}/status`,
        broker,
        region: "GOT",
        observer: "Demo observer",
        publicKey,
        subtopic: "status",
        bytes: 172,
        receivedAt: timestamp - 4 * 60_000,
      },
      {
        topic: `meshcore/GOT/${publicKey}/telemetry`,
        broker,
        region: "GOT",
        observer: "Demo observer",
        publicKey,
        subtopic: "telemetry",
        bytes: 96,
        receivedAt: timestamp - 9 * 60_000,
      },
    ],
  };
}

function formatPublicMuteReason(reason: string): string {
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

type DenialStatus = BanSummary["status"];

function denialStatusLabel(status: DenialStatus): string {
  if (status === "would_mute") {
    return "Varnas";
  }
  return "Nekad";
}

function denialStatusTone(status: DenialStatus): "red" | "orange" {
  return status === "would_mute" ? "orange" : "red";
}

function demoBan(): BanSummary {
  return {
    node: "DEMO000000000000000000000000000000000000000000000000000000000001",
    label: "Demo observer",
    broker: "demo-broker",
    reason: "anomaly:packet_size",
    blockCount: 7,
    mutedUntil: Date.now() + 4 * 60 * 60 * 1000,
    status: "muted",
  };
}

function Pill({
  children,
  tone = "green",
}: {
  children: React.ReactNode;
  tone?: "green" | "orange" | "red" | "gray";
}) {
  return (
    <span className={`pill ${tone === "green" ? "" : tone}`}>{children}</span>
  );
}

function RegionDisplay({
  region,
  countyLookup,
}: {
  region?: string;
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
}) {
  const formatted = formatRegionDisplay(region, countyLookup);
  if (!formatted) return <span className="cell-value">-</span>;
  if (!formatted.countyName)
    return <span className="cell-value">{formatted.code}</span>;
  return (
    <span className="cell-value">
      <span className="region-name">{formatted.countyName}</span>
      <span className="region-code">{formatted.code}</span>
    </span>
  );
}

function brokerStatusTone(broker: BrokerMetrics): "green" | "yellow" | "red" {
  if (broker.status === "healthy" && broker.ready) {
    return "green";
  }

  if (broker.lastUpdateAgeMs < 120_000) {
    return "yellow";
  }

  return "red";
}

function brokerStatusText(broker: BrokerMetrics): string {
  const tone = brokerStatusTone(broker);
  if (tone === "green") return "Frisk";
  if (tone === "yellow")
    return broker.ready ? "Svarar inte stabilt" : "Startar";
  return "Offline";
}

function uplinkText(broker: BrokerMetrics): string {
  const bridge = broker.targetBridge;
  if (!bridge?.enabled) {
    return "Uplink avstängd";
  }

  const target = bridge.targetHost || bridge.targetUrl || "target broker";
  return bridge.connected
    ? `Ansluten till ${target}`
    : `Inte ansluten till ${target}`;
}

function uplinkShortText(broker: BrokerMetrics): string {
  const bridge = broker.targetBridge;
  return bridge?.enabled && bridge.connected ? "Ja" : "Nej";
}

function uplinkTone(broker: BrokerMetrics): "green" | "orange" | "gray" {
  const bridge = broker.targetBridge;
  if (!bridge?.enabled) {
    return "gray";
  }

  return bridge.connected ? "green" : "orange";
}

function observerStatusTone(observer: DashboardObserver): "green" | undefined {
  if (!observer.active) {
    return undefined;
  }

  return "green";
}

function observerStatusText(tone: "green" | undefined): string {
  if (tone === "green") return "Online";
  return "Offline";
}

function MetricCard({
  id,
  label,
  value,
  note,
  icon,
}: {
  id: string;
  label: string;
  value: string;
  note: string;
  icon: string;
}) {
  return (
    <div className="card" id={id}>
      <div className="icon">
        <Icon path={icon} />
      </div>
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

interface ObserverStatusBlockedData {
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

interface ObserverStatusMessage {
  status: "unknown" | "invalid" | "error";
  message: string;
  publicKey?: string;
}

type ObserverLookupResult =
  ObserverStatusKnown | ObserverStatusBlockedData | ObserverStatusMessage;

function isKnownResult(
  result: ObserverLookupResult,
): result is ObserverStatusKnown {
  return result.status === "known";
}

function isBlockedResult(
  result: ObserverLookupResult,
): result is ObserverStatusBlockedData {
  return result.status === "blocked";
}

function isMessageResult(
  result: ObserverLookupResult,
): result is ObserverStatusMessage {
  return (
    result.status === "unknown" ||
    result.status === "invalid" ||
    result.status === "error"
  );
}

function ObserverLookupResultView({
  result,
  countyLookup,
}: {
  result: ObserverLookupResult;
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
}) {
  if (isKnownResult(result)) {
    const o = result.observer;
    return (
      <div className="lookup-result known">
        <div className="lookup-result-header">
          <Pill tone="green">Hittades</Pill>
        </div>
        <dl className="detail-grid-dl">
          <dt>Observer</dt>
          <dd>{o.name || o.shortKey}</dd>
          {o.name ? (
            <>
              <dt>Public key</dt>
              <dd>{o.shortKey}</dd>
            </>
          ) : null}
          {o.region ? (
            <>
              <dt>Region</dt>
              <dd>
                <RegionDisplay region={o.region} countyLookup={countyLookup} />
              </dd>
            </>
          ) : null}
          {o.brokerId ? (
            <>
              <dt>Broker</dt>
              <dd>{o.brokerId}</dd>
            </>
          ) : null}
          {o.lastSeen ? (
            <>
              <dt>Senast sedd</dt>
              <dd>{stockholmShortTime(o.lastSeen)}</dd>
            </>
          ) : null}
        </dl>
      </div>
    );
  }

  if (isBlockedResult(result)) {
    const o = result.observer;
    const b = result.block;
    return (
      <div className="lookup-result blocked">
        <div className="lookup-result-header">
          <Pill tone="red">Blockerad</Pill>
        </div>
        <dl className="detail-grid-dl">
          <dt>Observer</dt>
          <dd>{o.name || o.shortKey}</dd>
          {o.name ? (
            <>
              <dt>Public key</dt>
              <dd>{o.shortKey}</dd>
            </>
          ) : null}
          <dt>Orsak</dt>
          <dd>{b.reason}</dd>
          {b.deniedUntilText || b.mutedUntil ? (
            <>
              <dt>Nekas till</dt>
              <dd>
                {deniedUntilLabel({
                  status: "muted",
                  deniedUntilText: b.deniedUntilText,
                  mutedUntil: b.mutedUntil,
                })}
              </dd>
            </>
          ) : null}
          {b.region ? (
            <>
              <dt>Region</dt>
              <dd>
                <RegionDisplay region={b.region} countyLookup={countyLookup} />
              </dd>
            </>
          ) : null}
          {b.brokerId ? (
            <>
              <dt>Broker</dt>
              <dd>{b.brokerId}</dd>
            </>
          ) : null}
          {b.lastSeen ? (
            <>
              <dt>Senast sedd</dt>
              <dd>{stockholmShortTime(b.lastSeen)}</dd>
            </>
          ) : null}
        </dl>
      </div>
    );
  }

  if (isMessageResult(result)) {
    let pillTone: "orange" | "red" | undefined;
    let label: string;
    if (result.status === "unknown") {
      pillTone = undefined;
      label = "Okänd";
    } else if (result.status === "invalid") {
      pillTone = "orange";
      label = "Ogiltig";
    } else {
      pillTone = "red";
      label = "Fel";
    }
    return (
      <div className={`lookup-result ${result.status}`}>
        <div className="lookup-result-header">
          <Pill tone={pillTone}>{label}</Pill>
        </div>
        <p className="lookup-message">{result.message}</p>
      </div>
    );
  }

  return null;
}

function ObserverLookup({
  onOpenObserver,
  countyLookup,
}: {
  onOpenObserver: (observer: DashboardObserver) => void;
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ObserverLookupResult | null>(null);

  function handleInput(value: string) {
    setInput(value);
    setResult(null);
  }

  async function lookup() {
    const trimmed = input.trim();
    if (!trimmed) return;

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch(
        `/api/v1/observers/${encodeURIComponent(trimmed)}/status`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as ObserverLookupResult;
      setResult(data);

      if (isKnownResult(data) || isBlockedResult(data)) {
        const o = data.observer;
        const abuse = isBlockedResult(data)
          ? {
              status: "muted" as const,
              reason: data.block.reason,
              blockCount: 1,
              mutedUntil: data.block.mutedUntil,
              broker: data.block.brokerId || "",
              deniedUntilText: data.block.deniedUntilText,
            }
          : undefined;
        onOpenObserver({
          publicKey: o.publicKey,
          label: o.name || o.shortKey || o.publicKey,
          broker: o.brokerId || "",
          region: o.region,
          active: false,
          lastConnectedAt: o.lastSeen || 0,
          lastSeenAt: o.lastSeen || 0,
          messageCount: 0,
          messages: [],
          abuse,
        });
      }
    } catch (error) {
      console.error("[OBSERVER-LOOKUP] API-fel:", error);
      setResult({
        status: "error",
        message:
          "Det gick inte att kolla upp observern just nu. Försök igen senare.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      title="Kolla upp din observer"
      subtitle="Klistra in din public key för att se om din observer är känd, aktiv eller nekad."
    >
      <div className="lookup-form">
        <input
          className="lookup-input"
          value={input}
          onChange={(event) => handleInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void lookup();
          }}
          placeholder="Public key"
          disabled={loading}
        />
        <button
          className="lookup-button"
          type="button"
          onClick={() => void lookup()}
          disabled={loading || !input.trim()}
        >
          {loading ? "Söker..." : "Kolla upp"}
        </button>
      </div>
      {result ? (
        <ObserverLookupResultView result={result} countyLookup={countyLookup} />
      ) : null}
    </Panel>
  );
}

function BrokerTable({
  brokers,
  onSelect,
}: {
  brokers: BrokerMetrics[];
  onSelect: (broker: BrokerMetrics) => void;
}) {
  if (brokers.length === 0) return <Empty>Inga broker-mätvärden ännu.</Empty>;
  return (
    <table className="broker-table">
      <thead>
        <tr>
          <th>Broker</th>
          <th>Startad</th>
          <th>Observers</th>
          <th>Pub/min</th>
          <th>Uplink</th>
          <th>Uppdaterad</th>
        </tr>
      </thead>
      <tbody>
        {brokers.map((broker) => {
          const statusTone = brokerStatusTone(broker);
          return (
            <tr
              className="click-row"
              key={broker.instanceId}
              tabIndex={0}
              role="button"
              onClick={() => onSelect(broker)}
              onKeyDown={(e) => {
                if (e.key === " ") {
                  e.preventDefault();
                }
                if (e.key === "Enter" || e.key === " ") {
                  onSelect(broker);
                }
              }}
            >
              <td data-label="Broker">
                <span className="cell-value">
                  <span
                    className={`status-dot ${statusTone}`}
                    title={brokerStatusText(broker)}
                  />
                  {broker.instanceId}
                </span>
              </td>
              <td data-label="Startad">
                {optionalStockholmShortTime(broker.startedAt)}
              </td>
              <td data-label="Observers">
                {numberFormat.format(
                  broker.status === "healthy"
                    ? (broker.publisherClients ?? broker.connectedClients)
                    : 0,
                )}
              </td>
              <td data-label="Publishes/min">
                {numberFormat.format(
                  broker.status === "healthy"
                    ? broker.messagesLastMinute || 0
                    : 0,
                )}
              </td>
              <td data-label="Uplink">{uplinkShortText(broker)}</td>
              <td data-label="Uppdaterad">{age(broker.lastUpdateAgeMs)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BrokerLegend({
  brokers,
  total,
}: {
  brokers: BrokerMetrics[];
  total: number;
}) {
  if (brokers.length === 0) return <Empty>Inga broker-mätvärden ännu.</Empty>;
  return (
    <div className="legend">
      {brokers.map((broker, index) => {
        const observers =
          broker.status === "healthy"
            ? (broker.publisherClients ?? broker.connectedClients)
            : 0;
        const pct = total > 0 ? Math.round((observers / total) * 1000) / 10 : 0;
        return (
          <div className="legend-row" key={broker.instanceId}>
            <span
              className="legend-color"
              style={{ background: colors[index % colors.length] }}
            />
            <span>{broker.instanceId}</span>
            <strong>
              {numberFormat.format(observers)} ({numberFormat.format(pct)}%)
            </strong>
          </div>
        );
      })}
    </div>
  );
}

function Donut({
  brokers,
  total,
}: {
  brokers: BrokerMetrics[];
  total: number;
}) {
  let start = 0;
  const segments = brokers.map((broker, index) => {
    const observers =
      broker.status === "healthy"
        ? (broker.publisherClients ?? broker.connectedClients)
        : 0;
    const share =
      total > 0 ? (observers / total) * 100 : 100 / Math.max(brokers.length, 1);
    const end = start + share;
    const segment = `${colors[index % colors.length]} ${start}% ${end}%`;
    start = end;
    return segment;
  });
  return (
    <div
      className="donut"
      style={{
        background: segments.length
          ? `conic-gradient(${segments.join(",")})`
          : "conic-gradient(#dce5df 0 100%)",
      }}
    >
      <div className="donut-inner">
        <div>
          <span>{numberFormat.format(total)}</span>
          <span>Observers</span>
        </div>
      </div>
    </div>
  );
}

function ObserverSearch({
  query,
  setQuery,
  regions,
  selectedRegion,
  setSelectedRegion,
  countyLookup,
}: {
  query: string;
  setQuery: (value: string) => void;
  regions: string[];
  selectedRegion: string;
  setSelectedRegion: (value: string) => void;
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
}) {
  return (
    <div className="filter-bar">
      <label className="search">
        <Icon path={MDI.magnify} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Sök observer, public key eller region"
        />
      </label>
      <select
        className="region-select"
        value={selectedRegion}
        onChange={(event) => setSelectedRegion(event.target.value)}
      >
        <option value="">Alla regioner</option>
        {regions.map((region) => (
          <option key={region} value={region}>
            {formatRegionOptionLabel(region, countyLookup)}
          </option>
        ))}
      </select>
    </div>
  );
}

type SortField =
  "label" | "broker" | "region" | "lastConnectedAt" | "lastSeenAt" | "blocked";

function sortArrow(
  field: SortField,
  sortField: SortField | null,
  sortDir: "asc" | "desc",
): string {
  if (sortField !== field) return "";
  return sortDir === "asc" ? " ▲" : " ▼";
}

function sortedObservers(
  observers: DashboardObserver[],
  sortField: SortField | null,
  sortDir: "asc" | "desc",
): DashboardObserver[] {
  if (!sortField) return observers;
  return [...observers].sort((a, b) => {
    let cmp: number;
    switch (sortField) {
      case "label":
        cmp = (a.label || a.publicKey).localeCompare(b.label || b.publicKey);
        break;
      case "broker":
        cmp = a.broker.localeCompare(b.broker);
        break;
      case "region":
        cmp = (a.region || "").localeCompare(b.region || "");
        break;
      case "lastConnectedAt":
        cmp = a.lastConnectedAt - b.lastConnectedAt;
        break;
      case "lastSeenAt":
        cmp = a.lastSeenAt - b.lastSeenAt;
        break;
      case "blocked":
        cmp = Number(!!a.abuse) - Number(!!b.abuse);
        break;
      default:
        cmp = 0;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });
}

function ObserverTable({
  observers,
  onSelect,
  activeOnly = false,
  countyLookup,
}: {
  observers: DashboardObserver[];
  onSelect: (observer: DashboardObserver) => void;
  activeOnly?: boolean;
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
}) {
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const visibleObservers = useMemo(() => {
    const filtered = activeOnly
      ? observers.filter((observer) => observer.active)
      : observers;
    return sortedObservers(filtered, sortField, sortDir);
  }, [observers, activeOnly, sortField, sortDir]);

  if (visibleObservers.length === 0)
    return (
      <Empty>
        {activeOnly
          ? "Inga aktiva observers just nu."
          : "Inga observers matchar sökningen."}
      </Empty>
    );
  return (
    <table>
      <thead>
        <tr>
          <th
            className="sortable"
            onClick={() => toggleSort("label")}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleSort("label");
              }
            }}
          >
            Observer{sortArrow("label", sortField, sortDir)}
          </th>
          <th
            className="sortable"
            onClick={() => toggleSort("broker")}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleSort("broker");
              }
            }}
          >
            Ansvarig broker{sortArrow("broker", sortField, sortDir)}
          </th>
          <th
            className="sortable"
            onClick={() => toggleSort("region")}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleSort("region");
              }
            }}
          >
            Region{sortArrow("region", sortField, sortDir)}
          </th>
          <th
            className="sortable"
            onClick={() => toggleSort("lastConnectedAt")}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleSort("lastConnectedAt");
              }
            }}
          >
            Senast ansluten{sortArrow("lastConnectedAt", sortField, sortDir)}
          </th>
          <th
            className="sortable"
            onClick={() => toggleSort("lastSeenAt")}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleSort("lastSeenAt");
              }
            }}
          >
            Senast meddelande{sortArrow("lastSeenAt", sortField, sortDir)}
          </th>
          <th
            className="sortable"
            onClick={() => toggleSort("blocked")}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleSort("blocked");
              }
            }}
          >
            Nekad{sortArrow("blocked", sortField, sortDir)}
          </th>
        </tr>
      </thead>
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
              onKeyDown={(e) => {
                if (e.key === " ") {
                  e.preventDefault();
                }
                if (e.key === "Enter" || e.key === " ") {
                  onSelect(observer);
                }
              }}
            >
              <td data-label="Observer">
                <span className="cell-value">
                  {statusTone ? (
                    <span
                      className={`status-dot ${statusTone}`}
                      title={observerStatusText(statusTone)}
                    />
                  ) : null}
                  {observer.label || shortKey(observer.publicKey)}
                </span>
              </td>
              <td data-label="Ansvarig broker">{observer.broker}</td>
              <td data-label="Region">
                {observer.region ? (
                  <RegionDisplay
                    region={observer.region}
                    countyLookup={countyLookup}
                  />
                ) : (
                  "-"
                )}
              </td>
              <td data-label="Senast ansluten">
                {stockholmShortTime(observer.lastConnectedAt)}
              </td>
              <td data-label="Senast meddelande">
                {observer.messageCount > 0
                  ? stockholmShortTime(observer.lastSeenAt)
                  : "-"}
              </td>
              <td data-label="Nekad">
                {observer.abuse ? (
                  <Pill tone={denialStatusTone(observer.abuse.status)}>
                    {denialStatusLabel(observer.abuse.status)}
                  </Pill>
                ) : (
                  <Pill>Nej</Pill>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ObserverModal({
  observer,
  countyLookup,
  onClose,
}: {
  observer: DashboardObserver;
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
  onClose: () => void;
}) {
  const statusTone = observerStatusTone(observer);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="observer-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="observer-dialog-title">
              {statusTone ? (
                <span
                  className={`status-dot ${statusTone}`}
                  title={observerStatusText(statusTone)}
                />
              ) : null}
              {observer.label || shortKey(observer.publicKey)}
            </h2>
            <div className="panel-subtitle">{observer.publicKey}</div>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Stäng"
            onClick={onClose}
          >
            <Icon path={MDI.close} />
          </button>
        </div>
        <section>
          <div className="detail-grid">
            <div>
              <span>Ansvarig broker</span>
              <strong>{observer.broker}</strong>
            </div>
            <div>
              <span>Region</span>
              <strong>
                {observer.region ? (
                  <RegionDisplay
                    region={observer.region}
                    countyLookup={countyLookup}
                  />
                ) : (
                  "-"
                )}
              </strong>
            </div>
            <div>
              <span>Senast ansluten</span>
              <strong>{stockholmTime(observer.lastConnectedAt)}</strong>
            </div>
            <div>
              <span>Senast meddelande</span>
              <strong>
                {observer.messageCount > 0
                  ? stockholmTime(observer.lastSeenAt)
                  : "-"}
              </strong>
            </div>
            <div>
              <span>Meddelanden</span>
              <strong>{numberFormat.format(observer.messageCount)}</strong>
            </div>
          </div>
        </section>
        <section>
          <h3>Nekad</h3>
          {observer.abuse ? (
            <div className="detail-grid compact">
              <div>
                <span>Status</span>
                <strong>
                  <Pill tone={denialStatusTone(observer.abuse.status)}>
                    {denialStatusLabel(observer.abuse.status)}
                  </Pill>
                </strong>
              </div>
              <div>
                <span>Anledning</span>
                <strong>{formatPublicMuteReason(observer.abuse.reason)}</strong>
              </div>
              <div>
                <span>Rapporterad av</span>
                <strong>{observer.abuse.broker}</strong>
              </div>
              <div>
                <span>Nekad till</span>
                <strong>{deniedUntilLabel(observer.abuse)}</strong>
              </div>
            </div>
          ) : (
            <Empty>Observern är inte nekad.</Empty>
          )}
        </section>
        <section>
          <h3>Senaste 50 meddelanden</h3>
          <MessageTable
            messages={observer.messages}
            countyLookup={countyLookup}
          />
        </section>
      </div>
    </div>
  );
}

function BrokerModal({
  broker,
  observers,
  countyLookup,
  onClose,
  onOpenObserver,
}: {
  broker: BrokerMetrics;
  observers: DashboardObserver[];
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
  onClose: () => void;
  onOpenObserver: (observer: DashboardObserver) => void;
}) {
  const statusTone = brokerStatusTone(broker);
  const claimedObservers = observers
    .filter(
      (observer) => observer.broker === broker.instanceId && observer.active,
    )
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const bridge = broker.targetBridge;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="broker-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="broker-dialog-title">
              <span
                className={`status-dot ${statusTone}`}
                title={brokerStatusText(broker)}
              />
              {broker.instanceId}
            </h2>
            <div className="panel-subtitle">{brokerStatusText(broker)}</div>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Stäng"
            onClick={onClose}
          >
            <Icon path={MDI.close} />
          </button>
        </div>
        <section>
          <div className="detail-grid">
            <div>
              <span>Startad</span>
              <strong>{optionalStockholmTime(broker.startedAt)}</strong>
            </div>
            <div>
              <span>Publishes / minut</span>
              <strong>
                {numberFormat.format(
                  broker.status === "healthy"
                    ? broker.messagesLastMinute || 0
                    : 0,
                )}
              </strong>
            </div>
            <div>
              <span>Senast uppdaterad</span>
              <strong>{age(broker.lastUpdateAgeMs)}</strong>
            </div>
            <div>
              <span>Claimed observers</span>
              <strong>{numberFormat.format(claimedObservers.length)}</strong>
            </div>
            <div>
              <span>Uplink</span>
              <strong>
                <Pill tone={uplinkTone(broker)}>{uplinkText(broker)}</Pill>
              </strong>
            </div>
            <div>
              <span>Uplink client ID</span>
              <strong>{bridge?.clientId || "-"}</strong>
            </div>
            <div>
              <span>Lyckade uplink-meddelanden</span>
              <strong>
                {numberFormat.format(bridge?.successfulMessages || 0)}
              </strong>
            </div>
            <div>
              <span>Tappade uplink-meddelanden</span>
              <strong>
                {numberFormat.format(bridge?.droppedMessages || 0)}
              </strong>
            </div>
          </div>
        </section>
        <section>
          <h3>Claimed observers</h3>
          {claimedObservers.length === 0 ? (
            <Empty>
              Den här brokern har inga aktiva claimed observers just nu.
            </Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Observer</th>
                  <th>Region</th>
                  <th>Senast meddelande</th>
                  <th>Meddelanden</th>
                </tr>
              </thead>
              <tbody>
                {claimedObservers.map((observer) => (
                  <tr
                    className="click-row"
                    key={observer.publicKey}
                    tabIndex={0}
                    role="button"
                    onClick={() => onOpenObserver(observer)}
                    onKeyDown={(e) => {
                      if (e.key === " ") {
                        e.preventDefault();
                      }
                      if (e.key === "Enter" || e.key === " ") {
                        onOpenObserver(observer);
                      }
                    }}
                  >
                    <td data-label="Observer">
                      <span className="cell-value">
                        <span className="status-dot green" />
                        {observer.label || shortKey(observer.publicKey)}
                      </span>
                    </td>
                    <td className="region-cell" data-label="Region">
                      {observer.region ? (
                        <RegionDisplay
                          region={observer.region}
                          countyLookup={countyLookup}
                        />
                      ) : (
                        "-"
                      )}
                    </td>
                    <td data-label="Senast meddelande">
                      {observer.messageCount > 0
                        ? stockholmShortTime(observer.lastSeenAt)
                        : "-"}
                    </td>
                    <td data-label="Meddelanden">
                      {numberFormat.format(observer.messageCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function MessageTable({
  messages,
  countyLookup,
}: {
  messages: ObserverMessage[];
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
}) {
  if (messages.length === 0)
    return <Empty>Inga meddelanden registrerade ännu.</Empty>;
  return (
    <table>
      <thead>
        <tr>
          <th>Tid</th>
          <th>Ansvarig broker</th>
          <th>Region</th>
          <th>Subtopic</th>
          <th>Bytes</th>
          <th>Topic</th>
        </tr>
      </thead>
      <tbody>
        {messages.map((message, index) => (
          <tr key={`${message.receivedAt}-${index}`}>
            <td data-label="Tid">{stockholmShortTime(message.receivedAt)}</td>
            <td data-label="Ansvarig broker">{message.broker}</td>
            <td data-label="Region">
              {message.region ? (
                <RegionDisplay
                  region={message.region}
                  countyLookup={countyLookup}
                />
              ) : (
                "-"
              )}
            </td>
            <td data-label="Subtopic">{message.subtopic || "-"}</td>
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

function PublishFeed({
  publishes,
  countyLookup,
}: {
  publishes: ObserverMessage[];
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
}) {
  const previousKeys = useRef<Set<string> | null>(null);
  const visiblePublishes = publishes.slice(0, 50);
  const currentKeys = useMemo(
    () => new Set(visiblePublishes.map(publishKey)),
    [visiblePublishes],
  );
  const newKeys = useMemo(() => {
    if (!previousKeys.current) return new Set<string>();
    return new Set(
      visiblePublishes
        .map(publishKey)
        .filter((key) => !previousKeys.current!.has(key)),
    );
  }, [visiblePublishes]);

  useEffect(() => {
    previousKeys.current = currentKeys;
  }, [currentKeys]);

  if (publishes.length === 0)
    return <Empty>Inga publiseringar registrerade ännu.</Empty>;
  return (
    <div className="publish-feed-wrap">
      <div className="publish-feed-head">
        <span>Tid</span>
        <span>Observer</span>
        <span>Region</span>
        <span>Subtopic</span>
        <span>Storlek</span>
        <span>Ansvarig broker</span>
      </div>
      <div className="publish-feed" aria-live="polite">
        {visiblePublishes.map((publish) => {
          const key = publishKey(publish);
          return (
            <div
              className={`publish-row ${newKeys.has(key) ? "new" : ""}`}
              key={key}
            >
              <span className="publish-time">
                {stockholmShortTime(publish.receivedAt)}
              </span>
              <span className="publish-main">
                <strong>
                  {publish.observer ||
                    shortKey(publish.publicKey || "") ||
                    "Observer"}
                </strong>
                <span>{publish.topic}</span>
              </span>
              <span className="publish-region" data-label="Region">
                {publish.region ? (
                  <RegionDisplay
                    region={publish.region}
                    countyLookup={countyLookup}
                  />
                ) : (
                  "-"
                )}
              </span>
              <span className="publish-pill" data-label="Subtopic">
                {publish.subtopic || "-"}
              </span>
              <span className="publish-pill" data-label="Storlek">
                {numberFormat.format(publish.bytes)} B
              </span>
              <span className="publish-pill" data-label="Broker">
                {publish.broker}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BanModal({
  ban,
  countyLookup,
  onClose,
}: {
  ban: BanSummary;
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ban-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="ban-dialog-title">
              <span className="status-dot warn" />
              {ban.label || shortKey(ban.node)}
            </h2>
            <div className="panel-subtitle">{ban.node}</div>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Stäng"
            onClick={onClose}
          >
            <Icon path={MDI.close} />
          </button>
        </div>
        <section>
          <div className="detail-grid">
            <div>
              <span>Beslutat av</span>
              <strong>{ban.broker}</strong>
            </div>
            <div>
              <span>Orsak</span>
              <strong>{formatPublicMuteReason(ban.reason)}</strong>
            </div>
            <div>
              <span>Nekad till</span>
              <strong>{deniedUntilLabel(ban)}</strong>
            </div>
            <div>
              <span>Senast</span>
              <strong>
                {ban.lastUpdatedAt ? stockholmTime(ban.lastUpdatedAt) : "-"}
              </strong>
            </div>
            {ban.region ? (
              <div>
                <span>Region</span>
                <strong>
                  <RegionDisplay
                    region={ban.region}
                    countyLookup={countyLookup}
                  />
                </strong>
              </div>
            ) : null}
            {ban.topic ? (
              <div>
                <span>Topic</span>
                <strong>{ban.topic}</strong>
              </div>
            ) : null}
            <div>
              <span>Status</span>
              <strong>
                <Pill tone={denialStatusTone(ban.status)}>
                  {denialStatusLabel(ban.status)}
                </Pill>
              </strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function BanTable({
  bans,
  onSelect,
}: {
  bans: BanSummary[];
  onSelect: (ban: BanSummary) => void;
}) {
  if (bans.length === 0) return <Empty>Inga nekade händelser.</Empty>;
  return (
    <table>
      <thead>
        <tr>
          <th>Nod / nyckel</th>
          <th>Beslutat av</th>
          <th>Orsak</th>
          <th>Nekad till</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {bans.map((ban, index) => (
          <tr
            key={`${ban.node}-${index}`}
            className="click-row"
            role="button"
            tabIndex={0}
            onClick={() => onSelect(ban)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(ban);
              }
            }}
          >
            <td data-label="Nod / nyckel">
              <span className="cell-value">
                <span className="status-dot warn" />
                {ban.label || shortKey(ban.node)}
              </span>
            </td>
            <td data-label="Beslutat av">{ban.broker}</td>
            <td data-label="Orsak">{formatPublicMuteReason(ban.reason)}</td>
            <td data-label="Nekad till">{deniedUntilLabel(ban)}</td>
            <td data-label="Status">
              <Pill tone={denialStatusTone(ban.status)}>
                {denialStatusLabel(ban.status)}
              </Pill>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Panel({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel ${className}`}>
      <h2>{title}</h2>
      {subtitle ? <div className="panel-subtitle">{subtitle}</div> : null}
      {children}
    </div>
  );
}

function App() {
  const initialHash = useMemo(() => parseHash(), []);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [view, setView] = useState<View>(initialHash.view);
  const [query, setQuery] = useState(initialHash.query);
  const [regionFilter, setRegionFilter] = useState(initialHash.region);
  const [navOpen, setNavOpen] = useState(false);
  const [selectedBroker, _setSelectedBroker] = useState<BrokerMetrics | null>(
    null,
  );
  const [selectedObserver, _setSelectedObserver] =
    useState<DashboardObserver | null>(null);
  const [selectedBan, _setSelectedBan] = useState<BanSummary | null>(null);
  const [demoTimestamp] = useState(() => Date.now());
  const selectedObserverKey = useRef<string | null>(
    initialHash.observer || null,
  );
  const selectedBanKey = useRef<string | null>(initialHash.ban || null);

  function setSelectedBroker(broker: BrokerMetrics | null) {
    _setSelectedBroker(broker);
  }

  function setSelectedObserver(observer: DashboardObserver | null) {
    if (!observer) selectedObserverKey.current = null;
    _setSelectedObserver(observer);
  }

  function setSelectedBan(ban: BanSummary | null) {
    if (!ban) selectedBanKey.current = null;
    _setSelectedBan(ban);
  }

  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseHash();
      setView(parsed.view);
      setQuery(parsed.query);
      setRegionFilter(parsed.region);
      const observerKey = parsed.observer || null;
      const banKey = parsed.ban || null;
      selectedObserverKey.current = observerKey;
      selectedBanKey.current = banKey;
      _setSelectedObserver((current) =>
        current && current.publicKey !== observerKey ? null : current,
      );
      _setSelectedBan((current) =>
        current && current.node !== banKey ? null : current,
      );
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const data = (await response.json()) as DashboardSnapshot;
      if (active) setSnapshot(data);
    }
    refresh().catch(console.error);
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    replaceHash(
      view,
      query,
      regionFilter,
      selectedObserver?.publicKey || "",
      selectedBan?.node || "",
    );
  }, [view, query, regionFilter, selectedObserver, selectedBan]);

  useEffect(() => {
    if (!selectedBroker) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedBroker(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedBroker]);

  useEffect(() => {
    if (!selectedObserver) {
      const key = selectedObserverKey.current;
      if (key && snapshot?.observers) {
        const candidates =
          snapshot.observers.length > 0
            ? snapshot.observers
            : [
                demoObserver(
                  snapshot.generatedAt || Date.now(),
                  snapshot.respondingBroker || "",
                ),
              ];
        const match = candidates.find((o) => o.publicKey === key);
        if (match) {
          setSelectedObserver(match);
          return;
        }
      }
      selectedObserverKey.current = null;
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedObserver(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedObserver, snapshot]);

  const generatedAt = snapshot?.generatedAt ?? Date.now();
  const date = new Date(generatedAt);
  const respondingBroker =
    snapshot?.respondingBroker ??
    window.__DASHBOARD_CONFIG__?.instanceId ??
    "broker";
  const namespace =
    snapshot?.namespace ?? window.__DASHBOARD_CONFIG__?.namespace ?? "-";
  const summary = snapshot?.summary ?? {
    connectedClients: 0,
    connectedObservers: 0,
    activeBrokers: 0,
    totalBrokers: 0,
    messagesPerSecond: 0,
    publishesLastMinute: 0,
    activeBans: 0,
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const brokers = snapshot?.brokers ?? [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const apiObservers = snapshot?.observers ?? [];
  const observers = useMemo(() => {
    return apiObservers.length > 0
      ? apiObservers
      : [demoObserver(demoTimestamp, respondingBroker)];
  }, [apiObservers, demoTimestamp, respondingBroker]);
  const recentPublishes = useMemo(() => {
    const apiPublishes = snapshot?.recentPublishes ?? [];
    if (apiPublishes.length > 0) return apiPublishes;
    return observers
      .flatMap((observer) => observer.messages)
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, 50);
  }, [observers, snapshot]);
  const isDemo =
    snapshot !== null &&
    (snapshot.observers?.length ?? 0) === 0 &&
    (snapshot.bans?.length ?? 0) === 0;
  const allBans = useMemo(() => {
    const apiBans = snapshot?.bans ?? [];
    return apiBans.length > 0 ? apiBans : isDemo ? [demoBan()] : [];
  }, [snapshot, isDemo]);

  useEffect(() => {
    if (!selectedBan) {
      const key = selectedBanKey.current;
      if (key && allBans.length > 0) {
        const match = allBans.find((b) => b.node === key);
        if (match) {
          setSelectedBan(match);
          return;
        }
      }
      selectedBanKey.current = null;
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedBan(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedBan, allBans]);

  const balanceText = `${summary.activeBrokers} aktiva brokrar.`;
  const normalizedQuery = query.trim().toUpperCase();
  const observerRegions = useMemo(() => {
    const regionSet = new Set<string>();
    for (const observer of observers) {
      if (observer.region) regionSet.add(observer.region);
    }
    return Array.from(regionSet).sort();
  }, [observers]);
  const filteredObservers = useMemo(() => {
    let result = observers;
    if (regionFilter) {
      result = result.filter((observer) => observer.region === regionFilter);
    }
    if (normalizedQuery) {
      result = result.filter(
        (observer) =>
          observer.publicKey.includes(normalizedQuery) ||
          observer.label.toUpperCase().includes(normalizedQuery) ||
          (observer.region || "").toUpperCase().includes(normalizedQuery),
      );
    }
    return result;
  }, [normalizedQuery, observers, regionFilter]);

  useEffect(() => {
    if (selectedObserver) {
      const updated = observers.find(
        (observer) => observer.publicKey === selectedObserver.publicKey,
      );
      if (updated) {
        setSelectedObserver(updated);
      }
    }
  }, [observers, selectedObserver]);

  useEffect(() => {
    if (selectedBroker) {
      const updated = brokers.find(
        (broker) => broker.instanceId === selectedBroker.instanceId,
      );
      if (updated) {
        setSelectedBroker(updated);
      }
    }
  }, [brokers, selectedBroker]);

  useEffect(() => {
    if (selectedBan) {
      const updated = allBans.find((b) => b.node === selectedBan.node);
      if (updated) {
        setSelectedBan(updated);
      }
    }
  }, [allBans, selectedBan]);

  const navItems: Array<{ view: View; label: string; icon: string }> = [
    { view: "overview", label: "Översikt", icon: MDI.homeOutline },
    { view: "brokers", label: "Brokrar", icon: MDI.server },
    { view: "observers", label: "Observers", icon: MDI.accountGroup },
    { view: "bans", label: "Nekade", icon: MDI.shieldOutline },
  ];
  function openObserverFromBroker(observer: DashboardObserver): void {
    setSelectedBroker(null);
    setSelectedBan(null);
    setQuery("");
    setRegionFilter("");
    setView("observers");
    selectedObserverKey.current = observer.publicKey;
    setSelectedObserver(observer);
  }

  const page = useMemo(() => {
    if (view === "brokers") {
      return (
        <div className="page-grid two">
          <Panel
            title="Brokrar"
            subtitle="Brokerinstanser som nyligen har rapporterat status."
          >
            <BrokerTable brokers={brokers} onSelect={setSelectedBroker} />
          </Panel>
          <Panel title="Observers per broker">
            <BrokerLegend
              brokers={brokers}
              total={summary.connectedObservers}
            />
            <div className="panel-subtitle after">{balanceText}</div>
          </Panel>
        </div>
      );
    }
    if (view === "observers") {
      return (
        <Panel
          title="Observers"
          subtitle="Sök efter en observer och se anslutning, senaste meddelanden och nekade händelser."
        >
          <ObserverSearch
            query={query}
            setQuery={setQuery}
            regions={observerRegions}
            selectedRegion={regionFilter}
            setSelectedRegion={setRegionFilter}
            countyLookup={snapshot?.countyLookup}
          />
          <ObserverTable
            observers={filteredObservers}
            onSelect={setSelectedObserver}
            countyLookup={snapshot?.countyLookup}
          />
        </Panel>
      );
    }
    if (view === "bans") {
      return (
        <Panel
          title="Nekade"
          subtitle="Publishförsök som nekats samt observers som varnas i skuggläge."
        >
          <BanTable bans={allBans} onSelect={setSelectedBan} />
        </Panel>
      );
    }
    return (
      <>
        <ObserverLookup
          onOpenObserver={setSelectedObserver}
          countyLookup={snapshot?.countyLookup}
        />
        <section className="cards">
          <MetricCard
            id="clients"
            label="Anslutna observers"
            value={numberFormat.format(summary.connectedObservers)}
            note="Aktiva just nu"
            icon={MDI.accountGroup}
          />
          <MetricCard
            id="brokers"
            label="Aktiva brokrar"
            value={numberFormat.format(summary.activeBrokers)}
            note={`${numberFormat.format(summary.totalBrokers)} har rapporterat nyligen`}
            icon={MDI.server}
          />
          <MetricCard
            id="mps"
            label="Publishes / minut"
            value={numberFormat.format(summary.publishesLastMinute)}
            note="Mottagna senaste minuten"
            icon={MDI.pulse}
          />
          <MetricCard
            id="bans"
            label="Nekade"
            value={numberFormat.format(allBans.length)}
            note="Nekade eller varnade"
            icon={MDI.shieldOutline}
          />
        </section>
        <section className="grid">
          <Panel
            title="Brokerstatus"
            subtitle="Status för brokerinstanserna bakom lastbalanseraren."
          >
            <BrokerTable brokers={brokers} onSelect={setSelectedBroker} />
          </Panel>
          <Panel title="Observers per broker">
            <div className="chart-row">
              <Donut brokers={brokers} total={summary.connectedObservers} />
              <BrokerLegend
                brokers={brokers}
                total={summary.connectedObservers}
              />
            </div>
            <div className="panel-subtitle after">{balanceText}</div>
          </Panel>
          <Panel title="Nekade" className="span-2">
            <BanTable bans={allBans} onSelect={setSelectedBan} />
          </Panel>
          <Panel
            title="Senaste publiseringar"
            subtitle="De 50 senaste observermeddelandena som dashboarden kan visa."
            className="span-2"
          >
            <PublishFeed
              publishes={recentPublishes}
              countyLookup={snapshot?.countyLookup}
            />
          </Panel>
        </section>
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    allBans,
    balanceText,
    brokers,
    filteredObservers,
    observers,
    query,
    recentPublishes,
    summary,
    view,
  ]);

  return (
    <div className="shell">
      <aside>
        <div className="sidebar-top">
          <div className="brand">
            <Brand />
            <span>Meshat.se</span>
          </div>
          <button
            className="menu-button"
            type="button"
            aria-label={navOpen ? "Stäng meny" : "Öppna meny"}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <Icon path={navOpen ? MDI.close : MDI.menu} />
          </button>
        </div>
        <nav className={`nav ${navOpen ? "open" : ""}`}>
          {navItems.map((item) => (
            <a
              className={`nav-item ${view === item.view ? "active" : ""}`}
              href={`#${item.view}`}
              data-nav={item.view}
              key={item.view}
              onClick={() => setNavOpen(false)}
            >
              <Icon path={item.icon} />
              <span>{item.label}</span>
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
            <div className="subtitle">
              Namespace <span>{namespace}</span>
            </div>
          </div>
          <div className="top-actions">
            <div className="timebox">
              <span>{headerTimeFormat.format(date)}</span>
              <small>{headerDateFormat.format(date)} Europe/Stockholm</small>
            </div>
          </div>
        </header>
        {page}
        {selectedBroker ? (
          <BrokerModal
            broker={selectedBroker}
            observers={apiObservers}
            countyLookup={snapshot?.countyLookup}
            onClose={() => setSelectedBroker(null)}
            onOpenObserver={openObserverFromBroker}
          />
        ) : null}
        {selectedObserver ? (
          <ObserverModal
            observer={selectedObserver}
            countyLookup={snapshot?.countyLookup}
            onClose={() => setSelectedObserver(null)}
          />
        ) : null}
        {selectedBan ? (
          <BanModal
            ban={selectedBan}
            countyLookup={snapshot?.countyLookup}
            onClose={() => setSelectedBan(null)}
          />
        ) : null}
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

createRoot(document.getElementById("root")!).render(<App />);
