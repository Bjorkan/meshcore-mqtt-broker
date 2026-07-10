import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  accountMultiple:
    "M13.07 10.41A5 5 0 0 0 13.07 4.59A3.97 3.97 0 0 1 15 5A4 4 0 0 1 15 10A3.97 3.97 0 0 1 13.07 10.41M5.5 6.5A3 3 0 1 1 6.5 9.5A3 3 0 0 1 5.5 6.5M18.5 6.5A3 3 0 1 1 19.5 9.5A3 3 0 0 1 18.5 6.5M12 12A4 4 0 0 0 8 16H16A4 4 0 0 0 12 12M4.5 12A2.5 2.5 0 0 0 2 14.5V15H7.17A5.9 5.9 0 0 1 7 13A5.9 5.9 0 0 1 7.16 12ZM19.5 12A2.5 2.5 0 0 1 22 14.5V15H16.83A5.9 5.9 0 0 0 17 13A5.9 5.9 0 0 0 16.84 12Z",
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

interface SubscriberBrokerSummary {
  brokerId: string;
  connectionCount: number;
  lastSeenAt: number;
}

interface SubscriberConnectionEntry {
  username: string;
  connectionCount: number;
  lastSeenAt: number;
  brokers: SubscriberBrokerSummary[];
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
  subscribers: SubscriberConnectionEntry[];
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
  error?: string;
}

type View = "overview" | "brokers" | "observers" | "bans" | "subscribers";

const views: View[] = [
  "overview",
  "brokers",
  "observers",
  "bans",
  "subscribers",
];
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
      aria-hidden="true"
      className="mdi"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function Brand() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect fill="#1f7a3d" height="24" rx="5" width="24" />
      <g
        fill="none"
        stroke="#FFFFFF"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.35"
        transform="translate(2 2) scale(0.8333333333)"
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

function stockholmEventTime(timestamp: number): string {
  const eventDate = new Date(timestamp);
  const today = new Date();
  if (headerDateFormat.format(eventDate) === headerDateFormat.format(today)) {
    return stockholmShortTime(timestamp);
  }
  const parts = Object.fromEntries(
    headerDateFormat
      .formatToParts(eventDate)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const datePart = `${parts.day}-${parts.month}-${parts.year}`;
  return `${datePart} ${stockholmShortTime(timestamp)}`;
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

function ModalShell({
  titleId,
  title,
  subtitle,
  children,
  onClose,
  size = "md",
}: {
  titleId: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "wide";
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  const describedById = subtitle ? `${titleId}-desc` : undefined;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        aria-describedby={describedById}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`modal ${size}`}
        role="dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id={titleId}>
              {title}
            </h2>
            {subtitle ? (
              <div className="panel-subtitle" id={describedById}>
                {subtitle}
              </div>
            ) : null}
          </div>
          <button
            ref={closeRef}
            aria-label="Stäng"
            className="icon-button"
            type="button"
            onClick={onClose}
          >
            <Icon path={MDI.close} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

type SortDir = "asc" | "desc";

function sortData<T>(
  data: T[],
  sortField: string | null,
  sortDir: SortDir,
  getters: Record<string, (item: T) => string | number>,
): T[] {
  if (!sortField || !getters[sortField]) {
    return data;
  }
  const getter = getters[sortField];
  const collator = new Intl.Collator("sv-SE", {
    numeric: true,
    sensitivity: "base",
  });

  return [...data]
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const va = getter(a.item);
      const vb = getter(b.item);
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") {
        cmp = va - vb || 0;
      } else if (va === null || va === undefined) {
        cmp = 1;
      } else if (vb === null || vb === undefined) {
        cmp = -1;
      } else {
        cmp = collator.compare(String(va), String(vb));
      }
      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      return a.idx - b.idx;
    })
    .map((e) => e.item);
}

function SortHeader({
  field,
  label,
  sortField,
  sortDir,
  onToggle,
}: {
  field: string;
  label: string;
  sortField: string | null;
  sortDir: SortDir;
  onToggle: (field: string) => void;
}) {
  const active = sortField === field;
  return (
    <th
      aria-sort={
        active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        className="sort-button"
        type="button"
        onClick={() => onToggle(field)}
      >
        {label}
        <span className="sort-arrow">
          {active ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
        </span>
      </button>
    </th>
  );
}

function useTableSort(
  defaultField: string | null = null,
  defaultDir: SortDir = "asc",
) {
  const [sortField, setSortField] = useState<string | null>(defaultField);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  function toggle(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  return { sortField, sortDir, toggle };
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

function observerFromLookupResult(
  result: ObserverStatusKnown | ObserverStatusBlockedData,
): DashboardObserver {
  const o = result.observer;
  const abuse = isBlockedResult(result)
    ? {
        status: "muted" as const,
        reason: result.block.reason,
        blockCount: 1,
        mutedUntil: result.block.mutedUntil,
        broker: result.block.brokerId || "",
        deniedUntilText: result.block.deniedUntilText,
      }
    : undefined;
  return {
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
  };
}

function ObserverLookupResultView({
  result,
  countyLookup,
  onOpenObserver,
}: {
  result: ObserverLookupResult;
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
  onOpenObserver?: (observer: DashboardObserver) => void;
}) {
  if (isKnownResult(result)) {
    const o = result.observer;
    return (
      <div className="lookup-result known">
        <div className="lookup-result-header">
          <Pill tone="green">Hittades</Pill>
          {onOpenObserver ? (
            <button
              className="lookup-detail-button"
              type="button"
              onClick={() => onOpenObserver(observerFromLookupResult(result))}
            >
              Öppna detaljer
            </button>
          ) : null}
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
                <RegionDisplay countyLookup={countyLookup} region={o.region} />
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
          {onOpenObserver ? (
            <button
              className="lookup-detail-button"
              type="button"
              onClick={() => onOpenObserver(observerFromLookupResult(result))}
            >
              Öppna detaljer
            </button>
          ) : null}
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
                <RegionDisplay countyLookup={countyLookup} region={b.region} />
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
    let pillTone: "green" | "orange" | "red" | "gray" | undefined;
    let label: string;
    if (result.status === "unknown") {
      pillTone = "gray";
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
      className="overview-lookup"
      subtitle="Klistra in din public key för att se om din observer är känd, aktiv eller nekad."
      title="Kolla upp din observer"
    >
      <div className="lookup-form">
        <input
          autoComplete="off"
          className="lookup-input"
          disabled={loading}
          inputMode="text"
          placeholder="Public key"
          spellCheck={false}
          value={input}
          onChange={(event) => handleInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void lookup();
          }}
        />
        <button
          className="lookup-button"
          disabled={loading || !input.trim()}
          type="button"
          onClick={() => void lookup()}
        >
          {loading ? "Söker..." : "Kolla upp"}
        </button>
      </div>
      {result ? (
        <ObserverLookupResultView
          countyLookup={countyLookup}
          result={result}
          onOpenObserver={
            isKnownResult(result) || isBlockedResult(result)
              ? onOpenObserver
              : undefined
          }
        />
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
  const { sortField, sortDir, toggle } = useTableSort("instanceId");
  if (brokers.length === 0) return <Empty>Inga broker-mätvärden ännu.</Empty>;
  const brokerGetters: Record<string, (b: BrokerMetrics) => string | number> = {
    instanceId: (b) => b.instanceId,
    startedAt: (b) => b.startedAt,
    clients: (b) => b.publisherClients ?? b.connectedClients ?? 0,
    messagesLastMinute: (b) => b.messagesLastMinute,
    uplink: (b) => (b.targetBridge?.connected ? 1 : 0),
    lastUpdateAgeMs: (b) => b.lastUpdateAgeMs,
  };
  const sortedBrokers = sortData(brokers, sortField, sortDir, brokerGetters);
  return (
    <table className="broker-table">
      <thead>
        <tr>
          <SortHeader
            field="instanceId"
            label="Broker"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="startedAt"
            label="Startad"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="clients"
            label="Observers"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="messagesLastMinute"
            label="Pub/min"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="uplink"
            label="Uplink"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="lastUpdateAgeMs"
            label="Uppdaterad"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
        </tr>
      </thead>
      <tbody>
        {sortedBrokers.map((broker) => {
          const statusTone = brokerStatusTone(broker);
          return (
            <tr
              key={broker.instanceId}
              className="click-row"
              role="button"
              tabIndex={0}
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
          <div key={broker.instanceId} className="legend-row">
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
          placeholder="Sök observer eller region"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <select
        aria-label="Filtrera observers på region"
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
  const { sortField, sortDir, toggle } = useTableSort("label");
  const getters: Record<string, (o: DashboardObserver) => string | number> = {
    label: (o) => o.label || o.publicKey,
    broker: (o) => o.broker,
    region: (o) => o.region || "",
    lastConnectedAt: (o) => o.lastConnectedAt,
    lastSeenAt: (o) => o.lastSeenAt,
    blocked: (o) => (o.abuse ? 1 : 0),
  };

  const visibleObservers = useMemo(() => {
    const filtered = activeOnly
      ? observers.filter((observer) => observer.active)
      : observers;
    return sortData(filtered, sortField, sortDir, getters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <SortHeader
            field="label"
            label="Observer"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="broker"
            label="Ansvarig broker"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="region"
            label="Region"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="lastConnectedAt"
            label="Senast ansluten"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="lastSeenAt"
            label="Senast meddelande"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="blocked"
            label="Nekad"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
        </tr>
      </thead>
      <tbody>
        {visibleObservers.map((observer) => {
          const statusTone = observerStatusTone(observer);
          return (
            <tr
              key={observer.publicKey}
              className="click-row"
              role="button"
              tabIndex={0}
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
                    countyLookup={countyLookup}
                    region={observer.region}
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
    <ModalShell
      size="wide"
      subtitle={observer.publicKey}
      title={
        <>
          {statusTone ? (
            <span
              className={`status-dot ${statusTone}`}
              title={observerStatusText(statusTone)}
            />
          ) : null}
          {observer.label || shortKey(observer.publicKey)}
        </>
      }
      titleId="observer-dialog-title"
      onClose={onClose}
    >
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
                  countyLookup={countyLookup}
                  region={observer.region}
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
                ? stockholmEventTime(observer.lastSeenAt)
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
          countyLookup={countyLookup}
          messages={observer.messages}
        />
      </section>
    </ModalShell>
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
  const { sortField, sortDir, toggle } = useTableSort("lastSeenAt", "desc");
  const claimedGetters: Record<
    string,
    (o: DashboardObserver) => string | number
  > = {
    label: (o) => o.label || o.publicKey,
    region: (o) => o.region || "",
    lastSeenAt: (o) => o.lastSeenAt,
    messageCount: (o) => o.messageCount,
  };
  const claimedObservers = sortData(
    observers.filter(
      (observer) => observer.broker === broker.instanceId && observer.active,
    ),
    sortField,
    sortDir,
    claimedGetters,
  );
  const bridge = broker.targetBridge;

  return (
    <ModalShell
      size="lg"
      subtitle={brokerStatusText(broker)}
      title={
        <>
          <span
            className={`status-dot ${statusTone}`}
            title={brokerStatusText(broker)}
          />
          {broker.instanceId}
        </>
      }
      titleId="broker-dialog-title"
      onClose={onClose}
    >
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
            <strong>{numberFormat.format(bridge?.droppedMessages || 0)}</strong>
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
                <SortHeader
                  field="label"
                  label="Observer"
                  sortDir={sortDir}
                  sortField={sortField}
                  onToggle={toggle}
                />
                <SortHeader
                  field="region"
                  label="Region"
                  sortDir={sortDir}
                  sortField={sortField}
                  onToggle={toggle}
                />
                <SortHeader
                  field="lastSeenAt"
                  label="Senast meddelande"
                  sortDir={sortDir}
                  sortField={sortField}
                  onToggle={toggle}
                />
                <SortHeader
                  field="messageCount"
                  label="Meddelanden"
                  sortDir={sortDir}
                  sortField={sortField}
                  onToggle={toggle}
                />
              </tr>
            </thead>
            <tbody>
              {claimedObservers.map((observer) => (
                <tr
                  key={observer.publicKey}
                  className="click-row"
                  role="button"
                  tabIndex={0}
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
                        countyLookup={countyLookup}
                        region={observer.region}
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
    </ModalShell>
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
  const { sortField, sortDir, toggle } = useTableSort("receivedAt", "desc");
  if (messages.length === 0)
    return <Empty>Inga meddelanden registrerade ännu.</Empty>;
  const msgGetters: Record<string, (m: ObserverMessage) => string | number> = {
    receivedAt: (m) => m.receivedAt,
    broker: (m) => m.broker,
    region: (m) => m.region || "",
    subtopic: (m) => m.subtopic || "",
    bytes: (m) => m.bytes,
    topic: (m) => m.topic,
  };
  const sortedMsgs = sortData(messages, sortField, sortDir, msgGetters);
  return (
    <table>
      <thead>
        <tr>
          <SortHeader
            field="receivedAt"
            label="Tid"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="broker"
            label="Ansvarig broker"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="region"
            label="Region"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="subtopic"
            label="Subtopic"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="bytes"
            label="Bytes"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="topic"
            label="Topic"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
        </tr>
      </thead>
      <tbody>
        {sortedMsgs.map((message, index) => (
          <tr key={`${message.receivedAt}-${index}`}>
            <td data-label="Tid">{stockholmShortTime(message.receivedAt)}</td>
            <td data-label="Ansvarig broker">{message.broker}</td>
            <td data-label="Region">
              {message.region ? (
                <RegionDisplay
                  countyLookup={countyLookup}
                  region={message.region}
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
      <div aria-live="polite" className="publish-feed">
        {visiblePublishes.map((publish) => {
          const key = publishKey(publish);
          return (
            <div
              key={key}
              className={`publish-row ${newKeys.has(key) ? "new" : ""}`}
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
                    countyLookup={countyLookup}
                    region={publish.region}
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
    <ModalShell
      size="sm"
      subtitle={ban.node}
      title={
        <>
          <span className="status-dot warn" />
          {ban.label || shortKey(ban.node)}
        </>
      }
      titleId="ban-dialog-title"
      onClose={onClose}
    >
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
                  countyLookup={countyLookup}
                  region={ban.region}
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
    </ModalShell>
  );
}

function BanTable({
  bans,
  onSelect,
}: {
  bans: BanSummary[];
  onSelect: (ban: BanSummary) => void;
}) {
  const { sortField, sortDir, toggle } = useTableSort(null);
  if (bans.length === 0) return <Empty>Inga nekade händelser.</Empty>;
  const banGetters: Record<string, (b: BanSummary) => string | number> = {
    node: (b) => b.label || b.node,
    broker: (b) => b.broker,
    reason: (b) => b.reason,
    deniedUntil: (b) => b.mutedUntil || 0,
    status: (b) => b.status,
  };
  const sortedBans = sortData(bans, sortField, sortDir, banGetters);
  return (
    <table>
      <thead>
        <tr>
          <SortHeader
            field="node"
            label="Nod / nyckel"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="broker"
            label="Beslutat av"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="reason"
            label="Orsak"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="deniedUntil"
            label="Nekad till"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="status"
            label="Status"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
        </tr>
      </thead>
      <tbody>
        {sortedBans.map((ban, index) => (
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
function SubscriberTable({
  subscribers,
  snapshotError,
  onSelect,
}: {
  subscribers: SubscriberConnectionEntry[];
  snapshotError?: string;
  onSelect: (sub: SubscriberConnectionEntry) => void;
}) {
  const { sortField, sortDir, toggle } = useTableSort("username");
  const getters: Record<
    string,
    (s: SubscriberConnectionEntry) => string | number
  > = {
    username: (s) => s.username,
    brokersStr: (s) =>
      s.brokers.map((b) => `${b.brokerId} (${b.connectionCount})`).join(", "),
    connectionCount: (s) => s.connectionCount,
    lastSeenAt: (s) => (s.lastSeenAt > 0 ? s.lastSeenAt : 0),
  };

  if (snapshotError) {
    return <Empty>Kunde inte ladda prenumerantdata från Valkey.</Empty>;
  }
  if (subscribers.length === 0)
    return <Empty>Inga aktiva prenumeranter.</Empty>;

  const sorted = sortData(subscribers, sortField, sortDir, getters);
  return (
    <table>
      <thead>
        <tr>
          <SortHeader
            field="username"
            label="Användarnamn"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="brokersStr"
            label="Brokeranslutningar"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="connectionCount"
            label="Anslutningar"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="lastSeenAt"
            label="Senast aktiv"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
        </tr>
      </thead>
      <tbody>
        {sorted.map((sub) => (
          <tr
            key={sub.username}
            className="click-row"
            role="button"
            tabIndex={0}
            onClick={() => onSelect(sub)}
            onKeyDown={(e) => {
              if (e.key === " ") {
                e.preventDefault();
              }
              if (e.key === "Enter" || e.key === " ") {
                onSelect(sub);
              }
            }}
          >
            <td data-label="Användare">
              <span className="cell-value">{sub.username}</span>
            </td>
            <td data-label="Brokers">
              <div className="broker-chip-list">
                {sub.brokers.map((b) => (
                  <span key={b.brokerId} className="broker-chip">
                    {b.brokerId} ({numberFormat.format(b.connectionCount)})
                  </span>
                ))}
              </div>
            </td>
            <td data-label="Antal">
              {numberFormat.format(sub.connectionCount)}
            </td>
            <td data-label="Senast">
              {sub.lastSeenAt > 0 ? stockholmShortTime(sub.lastSeenAt) : "-"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SubscriberModal({
  sub,
  onClose,
}: {
  sub: SubscriberConnectionEntry;
  onClose: () => void;
}) {
  return (
    <ModalShell
      size="sm"
      subtitle="Aktiva prenumerantanslutningar"
      title={sub.username}
      titleId="subscriber-dialog-title"
      onClose={onClose}
    >
      <section>
        <div className="detail-grid">
          <div>
            <span>Totalt aktiva anslutningar</span>
            <strong>{numberFormat.format(sub.connectionCount)}</strong>
          </div>
          <div>
            <span>Senast aktiv</span>
            <strong>
              {sub.lastSeenAt > 0 ? stockholmTime(sub.lastSeenAt) : "-"}
            </strong>
          </div>
          {sub.brokers.map((b) => (
            <div key={b.brokerId}>
              <span>{b.brokerId}</span>
              <strong>
                {b.connectionCount} anslutning
                {b.connectionCount !== 1 ? "ar" : ""}
                {" — "}
                {stockholmShortTime(b.lastSeenAt)}
              </strong>
            </div>
          ))}
        </div>
      </section>
    </ModalShell>
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
  const [refreshError, setRefreshError] = useState<string | null>(null);
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
  const [selectedSubscriber, _setSelectedSubscriber] =
    useState<SubscriberConnectionEntry | null>(null);
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

  function setSelectedSubscriber(sub: SubscriberConnectionEntry | null) {
    _setSelectedSubscriber(sub);
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
    let refreshTimer: number | undefined;
    let requestController: AbortController | undefined;

    async function refresh() {
      const controller = new AbortController();
      requestController = controller;

      try {
        const response = await fetch("/api/dashboard", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Dashboard API svarade med HTTP ${response.status}`);
        }

        const data = (await response.json()) as DashboardSnapshot;
        if (!active) {
          return;
        }

        if (data.error) {
          setRefreshError(
            "Dashboarddata kunde inte läsas från Valkey. Kontrollera klusteranslutningen.",
          );
          setSnapshot((current) => current ?? data);
          return;
        }

        setSnapshot(data);
        setRefreshError(null);
      } catch (error) {
        if (!active || (error as { name?: string })?.name === "AbortError") {
          return;
        }
        console.error("[DASHBOARD] Kunde inte uppdatera data:", error);
        setRefreshError(
          "Dashboardens API kunde inte nås. Visar senast hämtade data om de finns.",
        );
      } finally {
        if (requestController === controller) {
          requestController = undefined;
        }
        if (active) {
          refreshTimer = window.setTimeout(() => {
            void refresh();
          }, 5000);
        }
      }
    }

    void refresh();
    return () => {
      active = false;
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
      requestController?.abort();
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
    if (!selectedObserver) {
      const key = selectedObserverKey.current;
      if (key && snapshot?.observers) {
        const match = snapshot.observers.find((o) => o.publicKey === key);
        if (match) {
          setSelectedObserver(match);
          return;
        }
      }
      selectedObserverKey.current = null;
      return;
    }
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
  const apiObservers = snapshot?.observers ?? [];
  const observers = apiObservers;
  const recentPublishes = useMemo(() => {
    const apiPublishes = snapshot?.recentPublishes ?? [];
    if (apiPublishes.length > 0) return apiPublishes;
    return observers
      .flatMap((observer) => observer.messages)
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, 50);
  }, [observers, snapshot]);
  const allBans = useMemo(() => {
    return snapshot?.bans ?? [];
  }, [snapshot]);
  const overviewBans = useMemo(() => {
    return [...allBans]
      .sort(
        (a, b) =>
          (b.lastUpdatedAt || b.mutedUntil || 0) -
          (a.lastUpdatedAt || a.mutedUntil || 0),
      )
      .slice(0, 10);
  }, [allBans]);

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
    { view: "subscribers", label: "Prenumeranter", icon: MDI.accountMultiple },
  ];
  const isLoading = snapshot === null && refreshError === null;
  const showingStaleData =
    refreshError !== null && snapshot?.error === undefined;

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
            subtitle="Brokerinstanser som nyligen har rapporterat status."
            title="Brokrar"
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
          subtitle="Sök efter en observer och se anslutning, senaste meddelanden och nekade händelser."
          title="Observers"
        >
          <ObserverSearch
            countyLookup={snapshot?.countyLookup}
            query={query}
            regions={observerRegions}
            selectedRegion={regionFilter}
            setQuery={setQuery}
            setSelectedRegion={setRegionFilter}
          />
          <ObserverTable
            countyLookup={snapshot?.countyLookup}
            observers={filteredObservers}
            onSelect={setSelectedObserver}
          />
        </Panel>
      );
    }
    if (view === "bans") {
      return (
        <Panel
          subtitle="Publishförsök som nekats samt observers som varnas i skuggläge."
          title="Nekade"
        >
          <BanTable bans={allBans} onSelect={setSelectedBan} />
        </Panel>
      );
    }
    if (view === "subscribers") {
      return (
        <Panel
          subtitle="Aktiva prenumerantanslutningar mot brokers i klustret."
          title="Prenumeranter"
        >
          <SubscriberTable
            snapshotError={snapshot?.error}
            subscribers={snapshot?.subscribers ?? []}
            onSelect={setSelectedSubscriber}
          />
        </Panel>
      );
    }
    return (
      <>
        <ObserverLookup
          countyLookup={snapshot?.countyLookup}
          onOpenObserver={setSelectedObserver}
        />
        <section className="cards">
          <MetricCard
            icon={MDI.accountGroup}
            id="clients"
            label="Anslutna observers"
            note="Aktiva just nu"
            value={numberFormat.format(summary.connectedObservers)}
          />
          <MetricCard
            icon={MDI.server}
            id="brokers"
            label="Aktiva brokrar"
            note={`${numberFormat.format(summary.totalBrokers)} har rapporterat nyligen`}
            value={numberFormat.format(summary.activeBrokers)}
          />
          <MetricCard
            icon={MDI.pulse}
            id="mps"
            label="Publishes / minut"
            note="Mottagna senaste minuten"
            value={numberFormat.format(summary.publishesLastMinute)}
          />
          <MetricCard
            icon={MDI.shieldOutline}
            id="bans"
            label="Nekade"
            note="Nekade eller varnade"
            value={numberFormat.format(allBans.length)}
          />
        </section>
        <section className="grid">
          <Panel
            subtitle="Status för brokerinstanserna bakom lastbalanseraren."
            title="Brokerstatus"
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
          <Panel className="span-2" title="Nekade">
            <BanTable bans={overviewBans} onSelect={setSelectedBan} />
            {allBans.length > overviewBans.length ? (
              <div className="panel-actions">
                <button
                  className="panel-action-button"
                  type="button"
                  onClick={() => setView("bans")}
                >
                  Visa fler på Nekade
                </button>
              </div>
            ) : null}
          </Panel>
          <Panel
            className="span-2"
            subtitle="De 50 senaste observermeddelandena som dashboarden kan visa."
            title="Senaste publiseringar"
          >
            <PublishFeed
              countyLookup={snapshot?.countyLookup}
              publishes={recentPublishes}
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
    overviewBans,
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
            aria-expanded={navOpen}
            aria-label={navOpen ? "Stäng meny" : "Öppna meny"}
            className="menu-button"
            type="button"
            onClick={() => setNavOpen((open) => !open)}
          >
            <Icon path={navOpen ? MDI.close : MDI.menu} />
          </button>
        </div>
        <nav className={`nav ${navOpen ? "open" : ""}`}>
          {navItems.map((item) => (
            <a
              key={item.view}
              className={`nav-item ${view === item.view ? "active" : ""}`}
              data-nav={item.view}
              href={`#${item.view}`}
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
        {isLoading ? (
          <div className="dashboard-notice loading" role="status">
            <strong>Hämtar dashboarddata</strong>
            <span>Väntar på den första klustersnapshoten.</span>
          </div>
        ) : null}
        {refreshError ? (
          <div className="dashboard-notice error" role="alert">
            <strong>Data kunde inte uppdateras</strong>
            <span>
              {refreshError}
              {showingStaleData ? " Senast lyckade snapshot visas." : ""}
            </span>
          </div>
        ) : null}
        {page}
        {selectedBroker ? (
          <BrokerModal
            broker={selectedBroker}
            countyLookup={snapshot?.countyLookup}
            observers={apiObservers}
            onClose={() => setSelectedBroker(null)}
            onOpenObserver={openObserverFromBroker}
          />
        ) : null}
        {selectedObserver ? (
          <ObserverModal
            countyLookup={snapshot?.countyLookup}
            observer={selectedObserver}
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
        {selectedSubscriber ? (
          <SubscriberModal
            sub={selectedSubscriber}
            onClose={() => setSelectedSubscriber(null)}
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
