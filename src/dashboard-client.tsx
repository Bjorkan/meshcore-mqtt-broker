import { Logger } from "tslog";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  formatDeniedUntilLabel as deniedUntilLabel,
  formatRegionDisplay,
  formatRegionOptionLabel,
} from "./dashboard-helpers.js";

const log = new Logger({ name: "Dashboard", type: "pretty" });

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
  cloudUpload:
    "M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 6 20H19A5 5 0 0 0 19.35 10.04M14 13V17H10V13H7L12 8L17 13H14Z",
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

interface MeshcoreIoWorkerStatus {
  instanceId: string;
  configuredWorkers: number;
  activeUploads: number;
  uploadsSucceeded: number;
  uploadsFailed: number;
  lastUploadAt?: number;
  lastError?: string;
  updatedAt: number;
}

interface MeshcoreIoHistoryEntry {
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

interface MeshcoreIoDashboardSnapshot {
  enabled: boolean;
  producer: {
    instanceId?: string;
    respondingBrokerIsProducer: boolean;
    leaseRemainingMs: number;
    status: "disabled" | "healthy" | "electing" | "stale";
  };
  queue: {
    ingressPending: number;
    queued: number;
    active: number;
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
  lastError?: string;
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
  meshcoreIo?: MeshcoreIoDashboardSnapshot;
  error?: string;
}

type View =
  "overview" | "brokers" | "observers" | "meshcoreio" | "bans" | "subscribers";

const views: View[] = [
  "overview",
  "brokers",
  "observers",
  "meshcoreio",
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
      <rect
        fill="var(--md-sys-color-primary, #0b6b50)"
        height="24"
        rx="5"
        width="24"
      />
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
    <div
      className={`modal-backdrop ${size}`}
      role="presentation"
      onClick={onClose}
    >
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
          <div className="modal-heading">
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
        <span aria-hidden="true" className="sort-arrow">
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
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

function StatusLabel({
  children,
  tone = "green",
}: {
  children: React.ReactNode;
  tone?: "green" | "orange" | "red" | "gray";
}) {
  return (
    <span className={`status-label ${tone === "green" ? "" : tone}`}>
      {children}
    </span>
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
  if (tone === "green") return "I drift";
  if (tone === "yellow") return broker.ready ? "Instabil" : "Startar";
  return "Offline";
}

function brokerStatusLabelTone(
  broker: BrokerMetrics,
): "green" | "orange" | "red" {
  const tone = brokerStatusTone(broker);
  if (tone === "yellow") return "orange";
  return tone;
}

function uplinkText(broker: BrokerMetrics): string {
  const bridge = broker.targetBridge;
  if (!bridge?.enabled) {
    return "Vidarekoppling avstängd";
  }

  const target = bridge.targetHost || bridge.targetUrl || "målbrokern";
  return bridge.connected
    ? `Ansluten till ${target}`
    : `Ingen anslutning till ${target}`;
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

function MetricItem({
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
    <article className="metric-item" id={id}>
      <div aria-hidden="true" className="metric-icon">
        <Icon path={icon} />
      </div>
      <div>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        <div className="metric-note">{note}</div>
      </div>
    </article>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

function meshcoreIoProducerLabel(
  status: MeshcoreIoDashboardSnapshot["producer"]["status"],
): string {
  if (status === "healthy") return "Aktiv";
  if (status === "electing") return "Väljer ansvarig";
  if (status === "stale") return "Instabil";
  return "Avstängd";
}

function meshcoreIoProducerTone(
  status: MeshcoreIoDashboardSnapshot["producer"]["status"],
): "green" | "orange" | "gray" {
  if (status === "healthy") return "green";
  if (status === "disabled") return "gray";
  return "orange";
}

function MeshcoreIoView({
  state,
  compact = false,
}: {
  state?: MeshcoreIoDashboardSnapshot;
  compact?: boolean;
}) {
  if (!state || !state.enabled) {
    return (
      <Panel
        className={compact ? "span-2" : ""}
        subtitle="Aktiveras under meshcore_io i config.yaml."
        title="Meshcore.io"
      >
        <Empty>Meshcore.io-integrationen är avstängd.</Empty>
      </Panel>
    );
  }

  const activeWorkers = state.workers.reduce(
    (total, worker) => total + worker.activeUploads,
    0,
  );
  const configuredWorkers = state.workers.reduce(
    (total, worker) => total + worker.configuredWorkers,
    0,
  );

  return (
    <Panel
      className={compact ? "span-2" : ""}
      subtitle="En broker kölägger adverts. Alla friska brokerinstanser får dränera den beständiga Valkey-kön."
      title="Meshcore.io"
    >
      <section aria-label="Meshcore.io-nyckeltal" className="metrics">
        <MetricItem
          icon={MDI.server}
          id="meshcoreio-producer"
          label="Köansvarig broker"
          note={`${meshcoreIoProducerLabel(state.producer.status)} · ${Math.ceil(state.producer.leaseRemainingMs / 1000)}s lease`}
          value={state.producer.instanceId || "-"}
        />
        <MetricItem
          icon={MDI.cloudUpload}
          id="meshcoreio-queue"
          label="Delad kö"
          note={`${numberFormat.format(state.queue.active)} laddas upp · ${numberFormat.format(state.queue.ingressPending)} i inflöde`}
          value={numberFormat.format(state.queue.total)}
        />
        <MetricItem
          icon={MDI.accountMultiple}
          id="meshcoreio-workers"
          label="Uppladdningsarbetare"
          note={`${numberFormat.format(activeWorkers)} arbetar just nu`}
          value={numberFormat.format(configuredWorkers)}
        />
        <MetricItem
          icon={MDI.pulse}
          id="meshcoreio-uploaded"
          label="Uppladdade adverts"
          note={`${numberFormat.format(state.totals.retries)} återförsök · ${numberFormat.format(state.totals.dropped)} tappade`}
          value={numberFormat.format(state.totals.uploaded)}
        />
      </section>

      <div className="detail-grid">
        <div>
          <span>Köansvar</span>
          <strong>
            <StatusLabel tone={meshcoreIoProducerTone(state.producer.status)}>
              {meshcoreIoProducerLabel(state.producer.status)}
            </StatusLabel>
          </strong>
        </div>
        <div>
          <span>Kökapacitet</span>
          <strong>
            {numberFormat.format(state.queue.total)} /{" "}
            {numberFormat.format(state.queue.maxQueuedUploads)}
          </strong>
        </div>
        <div>
          <span>Köläggningar</span>
          <strong>{numberFormat.format(state.totals.enqueued)}</strong>
        </div>
        <div>
          <span>Ogiltiga adverts</span>
          <strong>{numberFormat.format(state.totals.invalid)}</strong>
        </div>
      </div>

      {state.lastError ? (
        <div className="dashboard-notice error" role="status">
          Senaste fel: {state.lastError}
        </div>
      ) : null}

      <h3 className="meshcoreio-heading">Brokerarbetare</h3>
      {state.workers.length === 0 ? (
        <Empty>Inga brokerarbetare rapporterar ännu.</Empty>
      ) : (
        <table className="broker-table">
          <thead>
            <tr>
              <th>Broker</th>
              <th>Arbetare</th>
              <th>Aktiva</th>
              <th>Uppladdade</th>
              <th>Misslyckade</th>
              <th>Senast</th>
            </tr>
          </thead>
          <tbody>
            {state.workers.map((worker) => (
              <tr key={worker.instanceId}>
                <td className="primary-cell" data-label="Broker">
                  <span className="cell-value">{worker.instanceId}</span>
                </td>
                <td data-label="Arbetare">
                  {numberFormat.format(worker.configuredWorkers)}
                </td>
                <td data-label="Aktiva">
                  {numberFormat.format(worker.activeUploads)}
                </td>
                <td data-label="Uppladdade">
                  {numberFormat.format(worker.uploadsSucceeded)}
                </td>
                <td data-label="Misslyckade">
                  {numberFormat.format(worker.uploadsFailed)}
                </td>
                <td data-label="Senast">
                  {worker.lastUploadAt
                    ? optionalStockholmShortTime(worker.lastUploadAt)
                    : age(Date.now() - worker.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!compact ? (
        <>
          <h3 className="meshcoreio-heading">Senaste uppladdningar</h3>
          {state.history.length === 0 ? (
            <Empty>Inga adverts har slutförts ännu.</Empty>
          ) : (
            <table className="broker-table">
              <thead>
                <tr>
                  <th>Tid</th>
                  <th>Nod</th>
                  <th>Typ</th>
                  <th>Broker</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {state.history.map((entry) => (
                  <tr key={`${entry.requestId}-${entry.at}`}>
                    <td data-label="Tid">{stockholmShortTime(entry.at)}</td>
                    <td className="primary-cell" data-label="Nod">
                      <span className="primary-stack">
                        <span className="cell-value">{entry.nodeName}</span>
                        <span className="cell-note">
                          {entry.nodePublicKey.slice(0, 10)}
                        </span>
                      </span>
                    </td>
                    <td data-label="Typ">{entry.advertType}</td>
                    <td data-label="Broker">{entry.workerInstanceId}</td>
                    <td data-label="Status">
                      <StatusLabel
                        tone={entry.status === "uploaded" ? "green" : "red"}
                      >
                        {entry.status === "uploaded" ? "Uppladdad" : "Tappad"}
                      </StatusLabel>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </Panel>
  );
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
          <StatusLabel tone="green">Hittades</StatusLabel>
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
          <dt>Observatör</dt>
          <dd>{o.name || o.shortKey}</dd>
          {o.name ? (
            <>
              <dt>Publik nyckel</dt>
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
              <dt>Brokerinstans</dt>
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
          <StatusLabel tone="red">Nekad</StatusLabel>
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
          <dt>Observatör</dt>
          <dd>{o.name || o.shortKey}</dd>
          {o.name ? (
            <>
              <dt>Publik nyckel</dt>
              <dd>{o.shortKey}</dd>
            </>
          ) : null}
          <dt>Orsak</dt>
          <dd>{b.reason}</dd>
          {b.deniedUntilText || b.mutedUntil ? (
            <>
              <dt>Gäller till / åtgärd</dt>
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
              <dt>Brokerinstans</dt>
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
          <StatusLabel tone={pillTone}>{label}</StatusLabel>
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
      log.error("Observer lookup API error:", error);
      setResult({
        status: "error",
        message:
          "Det gick inte att kontrollera observatören just nu. Försök igen senare.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      className="overview-lookup"
      subtitle="Klistra in observatörens publika nyckel för att se om den är registrerad eller nekad."
      title="Kontrollera din observatör"
    >
      <div className="lookup-form">
        <label className="field">
          <span className="field-label">Publik nyckel</span>
          <input
            autoComplete="off"
            className="lookup-input"
            disabled={loading}
            inputMode="text"
            placeholder="64 hexadecimala tecken"
            spellCheck={false}
            value={input}
            onChange={(event) => handleInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void lookup();
            }}
          />
        </label>
        <button
          className="lookup-button"
          disabled={loading || !input.trim()}
          type="button"
          onClick={() => void lookup()}
        >
          {loading ? "Kontrollerar..." : "Kontrollera"}
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
  if (brokers.length === 0)
    return <Empty>Inga brokerinstanser har rapporterat ännu.</Empty>;
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
            label="Instans"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="startedAt"
            label="Start"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="clients"
            label="Aktiva"
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
            label="Målbroker"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="lastUpdateAgeMs"
            label="Senast"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
        </tr>
      </thead>
      <tbody>
        {sortedBrokers.map((broker) => {
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
              <td className="primary-cell" data-label="Brokerinstans">
                <span className="primary-stack">
                  <span className="cell-value">{broker.instanceId}</span>
                  <StatusLabel tone={brokerStatusLabelTone(broker)}>
                    {brokerStatusText(broker)}
                  </StatusLabel>
                </span>
              </td>
              <td data-label="Startad">
                {optionalStockholmShortTime(broker.startedAt)}
              </td>
              <td data-label="Observatörer">
                {numberFormat.format(
                  broker.status === "healthy"
                    ? (broker.publisherClients ?? broker.connectedClients)
                    : 0,
                )}
              </td>
              <td data-label="Publiceringar/min">
                {numberFormat.format(
                  broker.status === "healthy"
                    ? broker.messagesLastMinute || 0
                    : 0,
                )}
              </td>
              <td data-label="Vidarekoppling">{uplinkShortText(broker)}</td>
              <td data-label="Uppdaterad">{age(broker.lastUpdateAgeMs)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BrokerDistribution({
  brokers,
  total,
}: {
  brokers: BrokerMetrics[];
  total: number;
}) {
  if (brokers.length === 0)
    return <Empty>Inga brokerinstanser har rapporterat ännu.</Empty>;
  return (
    <div className="distribution-list">
      {brokers.map((broker) => {
        const observers =
          broker.status === "healthy"
            ? (broker.publisherClients ?? broker.connectedClients)
            : 0;
        const pct = total > 0 ? Math.round((observers / total) * 1000) / 10 : 0;
        return (
          <div key={broker.instanceId} className="distribution-item">
            <div className="distribution-label">
              <span className="distribution-copy">
                <span className="distribution-name">{broker.instanceId}</span>
                <StatusLabel tone={brokerStatusLabelTone(broker)}>
                  {brokerStatusText(broker)}
                </StatusLabel>
              </span>
              <span className="distribution-value">
                <strong>{numberFormat.format(observers)}</strong>
                <span>{numberFormat.format(pct)}%</span>
              </span>
            </div>
            <div
              aria-label={`${broker.instanceId}: ${numberFormat.format(pct)} procent av observatörerna`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={pct}
              className="distribution-track"
              role="progressbar"
            >
              <span
                style={{ width: `${Math.max(pct, observers > 0 ? 2 : 0)}%` }}
              />
            </div>
          </div>
        );
      })}
      <p className="distribution-summary">
        {numberFormat.format(total)} anslutna observatörer fördelade över{" "}
        {numberFormat.format(brokers.length)} brokerinstanser.
      </p>
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
      <label className="field search">
        <span className="field-label">Sök</span>
        <Icon path={MDI.magnify} />
        <input
          placeholder="Sök observatör eller region"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <label className="field select-field">
        <span className="field-label">Region</span>
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
      </label>
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
          ? "Inga aktiva observatörer just nu."
          : "Inga observatörer matchar sökningen."}
      </Empty>
    );
  return (
    <table>
      <thead>
        <tr>
          <SortHeader
            field="label"
            label="Observatör"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="broker"
            label="Ansluten via"
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
              <td className="primary-cell" data-label="Observatör">
                <span className="primary-stack">
                  <span className="cell-value">
                    {observer.label || shortKey(observer.publicKey)}
                  </span>
                  <StatusLabel tone={statusTone ? "green" : "gray"}>
                    {observerStatusText(statusTone)}
                  </StatusLabel>
                </span>
              </td>
              <td data-label="Ansluten via">{observer.broker}</td>
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
                  <StatusLabel tone={denialStatusTone(observer.abuse.status)}>
                    {denialStatusLabel(observer.abuse.status)}
                  </StatusLabel>
                ) : (
                  <StatusLabel>Nej</StatusLabel>
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
      subtitle={
        <code className="modal-key" title={observer.publicKey}>
          {observer.publicKey}
        </code>
      }
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
            <span>Ansluten via</span>
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
          <div className="detail-wide">
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
        <h3>Nekad trafik</h3>
        {observer.abuse ? (
          <div className="detail-grid compact">
            <div>
              <span>Status</span>
              <strong>
                <StatusLabel tone={denialStatusTone(observer.abuse.status)}>
                  {denialStatusLabel(observer.abuse.status)}
                </StatusLabel>
              </strong>
            </div>
            <div>
              <span>Orsak</span>
              <strong>{formatPublicMuteReason(observer.abuse.reason)}</strong>
            </div>
            <div>
              <span>Rapporterad av</span>
              <strong>{observer.abuse.broker}</strong>
            </div>
            <div>
              <span>Gäller till / åtgärd</span>
              <strong>{deniedUntilLabel(observer.abuse)}</strong>
            </div>
          </div>
        ) : (
          <Empty>Observatören har inga nekade händelser.</Empty>
        )}
      </section>
      <section>
        <h3>Senaste meddelandena</h3>
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
            <span>Publiceringar senaste minuten</span>
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
            <span>Aktiva observatörer</span>
            <strong>{numberFormat.format(claimedObservers.length)}</strong>
          </div>
          <div>
            <span>Vidarekoppling</span>
            <strong>
              <StatusLabel tone={uplinkTone(broker)}>
                {uplinkText(broker)}
              </StatusLabel>
            </strong>
          </div>
          <div>
            <span>Klient-ID för vidarekoppling</span>
            <strong>{bridge?.clientId || "-"}</strong>
          </div>
          <div>
            <span>Vidarebefordrade meddelanden</span>
            <strong>
              {numberFormat.format(bridge?.successfulMessages || 0)}
            </strong>
          </div>
          <div>
            <span>Ej vidarebefordrade meddelanden</span>
            <strong>{numberFormat.format(bridge?.droppedMessages || 0)}</strong>
          </div>
        </div>
      </section>
      <section>
        <h3>Aktiva observatörer</h3>
        {claimedObservers.length === 0 ? (
          <Empty>
            Den här brokerinstansen har inga aktiva observatörer just nu.
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <SortHeader
                  field="label"
                  label="Observatör"
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
                  <td className="primary-cell" data-label="Observatör">
                    <span className="cell-value">
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
            label="Brokerinstans"
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
            label="Underämne"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="bytes"
            label="Storlek"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="topic"
            label="MQTT-ämne"
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
            <td data-label="Brokerinstans">{message.broker}</td>
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
            <td data-label="Underämne">{message.subtopic || "-"}</td>
            <td data-label="Storlek">{numberFormat.format(message.bytes)} B</td>
            <td className="wide-cell topic-cell" data-label="MQTT-ämne">
              {message.topic}
            </td>
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
  const [expanded, setExpanded] = useState(false);
  const previousKeys = useRef<Set<string> | null>(null);
  const initialLimit = 8;
  const visiblePublishes = publishes.slice(0, expanded ? 50 : initialLimit);
  const currentKeys = useMemo(
    () => new Set(visiblePublishes.map(publishKey)),
    [visiblePublishes],
  );
  const newKeys = useMemo(() => {
    if (!previousKeys.current || previousKeys.current.size === 0) {
      return new Set<string>();
    }
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
    return <Empty>Inga publiceringar har registrerats ännu.</Empty>;
  return (
    <div className="publish-feed-wrap">
      <div className="publish-feed-head">
        <span>Tid</span>
        <span>Observatör</span>
        <span>Region</span>
        <span>Underämne</span>
        <span>Storlek</span>
        <span>Brokerinstans</span>
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
                    "Observatör"}
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
              <span className="publish-meta" data-label="Underämne">
                {publish.subtopic || "-"}
              </span>
              <span className="publish-meta" data-label="Storlek">
                {numberFormat.format(publish.bytes)} B
              </span>
              <span className="publish-meta" data-label="Brokerinstans">
                {publish.broker}
              </span>
            </div>
          );
        })}
      </div>
      {publishes.length > initialLimit ? (
        <div className="feed-actions">
          <button
            className="panel-action-button"
            type="button"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded
              ? "Visa färre"
              : `Visa ${Math.min(40, publishes.length - initialLimit)} till`}
          </button>
        </div>
      ) : null}
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
      subtitle={
        <code className="modal-key" title={ban.node}>
          {ban.node}
        </code>
      }
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
            <span>Rapporterad av</span>
            <strong>{ban.broker}</strong>
          </div>
          <div>
            <span>Orsak</span>
            <strong>{formatPublicMuteReason(ban.reason)}</strong>
          </div>
          <div>
            <span>Gäller till / åtgärd</span>
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
            <div className="detail-wide">
              <span>MQTT-ämne</span>
              <strong>{ban.topic}</strong>
            </div>
          ) : null}
          <div>
            <span>Status</span>
            <strong>
              <StatusLabel tone={denialStatusTone(ban.status)}>
                {denialStatusLabel(ban.status)}
              </StatusLabel>
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
            label="Observatör / nyckel"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="broker"
            label="Rapporterad av"
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
            label="Gäller till / åtgärd"
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
            <td className="primary-cell" data-label="Observatör / nyckel">
              <span className="cell-value">
                {ban.label || shortKey(ban.node)}
              </span>
            </td>
            <td data-label="Rapporterad av">{ban.broker}</td>
            <td data-label="Orsak">{formatPublicMuteReason(ban.reason)}</td>
            <td className="wide-cell" data-label="Gäller till / åtgärd">
              {deniedUntilLabel(ban)}
            </td>
            <td data-label="Status">
              <StatusLabel tone={denialStatusTone(ban.status)}>
                {denialStatusLabel(ban.status)}
              </StatusLabel>
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
            label="Ansluten via"
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
            <td className="primary-cell" data-label="Användare">
              <span className="cell-value">{sub.username}</span>
            </td>
            <td className="wide-cell" data-label="Ansluten via">
              <div className="broker-reference-list">
                {sub.brokers.map((b) => (
                  <span key={b.brokerId} className="broker-reference">
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
    <section className={`section-surface ${className}`}>
      <header className="section-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
        </div>
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

const pageCopy: Record<
  View,
  { eyebrow: string; title: string; description: string }
> = {
  overview: {
    eyebrow: "Klusteröversikt",
    title: "Översikt",
    description:
      "Aktuell driftstatus, trafik och händelser för hela MQTT-klustret.",
  },
  brokers: {
    eyebrow: "Drift",
    title: "Brokerinstanser",
    description:
      "Hälsa, trafik och vidarekoppling för de instanser som rapporterar till klustret.",
  },
  observers: {
    eyebrow: "Nät",
    title: "Observatörer",
    description:
      "Sök och granska anslutna observatörer, regioner och senaste aktivitet.",
  },
  meshcoreio: {
    eyebrow: "Kartuppladdning",
    title: "Meshcore.io",
    description:
      "Köansvar, delad uppladdningskö och arbetare för publicering av adverts.",
  },
  bans: {
    eyebrow: "Skydd",
    title: "Nekade händelser",
    description:
      "Publiceringsförsök som har nekats eller markerats av skyddsreglerna.",
  },
  subscribers: {
    eyebrow: "Åtkomst",
    title: "Prenumeranter",
    description:
      "Aktiva prenumerantanslutningar och deras fördelning över brokerinstanserna.",
  },
};

function App() {
  const initialHash = useMemo(() => parseHash(), []);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [view, setView] = useState<View>(initialHash.view);
  const [query, setQuery] = useState(initialHash.query);
  const [regionFilter, setRegionFilter] = useState(initialHash.region);
  const [navOpen, setNavOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
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
    if (!navOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    const appFrame = document.querySelector(".app-frame");
    const appFrameWasInert = appFrame?.hasAttribute("inert") ?? false;
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ??
          [],
      ).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    appFrame?.setAttribute("inert", "");
    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => {
      sidebarRef.current
        ?.querySelector<HTMLElement>('.nav-item[aria-current="page"]')
        ?.focus();
    });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (!appFrameWasInert) appFrame?.removeAttribute("inert");
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [navOpen]);

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
        log.error("Dashboard: could not update data:", error);
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
  const meshcoreIo = snapshot?.meshcoreIo;
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
    { view: "brokers", label: "Brokerinstanser", icon: MDI.server },
    { view: "observers", label: "Observatörer", icon: MDI.accountGroup },
    { view: "meshcoreio", label: "Meshcore.io", icon: MDI.cloudUpload },
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
            title="Brokerinstanser"
          >
            <BrokerTable brokers={brokers} onSelect={setSelectedBroker} />
          </Panel>
          <Panel
            subtitle="Andel anslutna observatörer per aktiv instans."
            title="Trafikfördelning"
          >
            <BrokerDistribution
              brokers={brokers}
              total={summary.connectedObservers}
            />
          </Panel>
        </div>
      );
    }
    if (view === "observers") {
      return (
        <Panel
          subtitle="Sök efter en observatör och se anslutning, senaste meddelanden och nekade händelser."
          title="Observatörer"
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
    if (view === "meshcoreio") {
      return <MeshcoreIoView state={meshcoreIo} />;
    }
    if (view === "bans") {
      return (
        <Panel
          subtitle="Nekade publiceringsförsök och observatörer som markerats i skuggläge."
          title="Nekade händelser"
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
        <section aria-label="Nyckeltal" className="metrics">
          <MetricItem
            icon={MDI.accountGroup}
            id="clients"
            label="Anslutna observatörer"
            note="Aktiva just nu"
            value={numberFormat.format(summary.connectedObservers)}
          />
          <MetricItem
            icon={MDI.server}
            id="brokers"
            label="Aktiva brokerinstanser"
            note={`${numberFormat.format(summary.totalBrokers)} rapporterar till klustret`}
            value={numberFormat.format(summary.activeBrokers)}
          />
          <MetricItem
            icon={MDI.pulse}
            id="mps"
            label="Publiceringar"
            note="Meddelanden senaste minuten"
            value={numberFormat.format(summary.publishesLastMinute)}
          />
          <MetricItem
            icon={MDI.shieldOutline}
            id="bans"
            label="Nekade händelser"
            note="Nekade eller markerade"
            value={numberFormat.format(allBans.length)}
          />
        </section>
        <section className="grid">
          <Panel
            subtitle="Status för brokerinstanserna bakom lastbalanseraren."
            title="Brokerinstanser"
          >
            <BrokerTable brokers={brokers} onSelect={setSelectedBroker} />
          </Panel>
          <Panel
            subtitle="Andel anslutna observatörer per aktiv instans."
            title="Trafikfördelning"
          >
            <BrokerDistribution
              brokers={brokers}
              total={summary.connectedObservers}
            />
          </Panel>
          <MeshcoreIoView compact state={meshcoreIo} />
          <Panel className="span-2" title="Nekade händelser">
            <BanTable bans={overviewBans} onSelect={setSelectedBan} />
            {allBans.length > overviewBans.length ? (
              <div className="panel-actions">
                <button
                  className="panel-action-button"
                  type="button"
                  onClick={() => setView("bans")}
                >
                  Visa alla nekade händelser
                </button>
              </div>
            ) : null}
          </Panel>
          <Panel
            className="span-2"
            subtitle="De 50 senaste meddelandena som dashboarden har registrerat."
            title="Senaste publiceringarna"
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
    brokers,
    filteredObservers,
    meshcoreIo,
    observers,
    overviewBans,
    query,
    recentPublishes,
    summary,
    view,
  ]);

  const currentPage = pageCopy[view];

  return (
    <div className="app-shell">
      {navOpen ? (
        <button
          aria-label="Stäng meny"
          className="nav-scrim"
          type="button"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <aside
        ref={sidebarRef}
        aria-label="Dashboardnavigation"
        className={`navigation-drawer ${navOpen ? "open" : ""}`}
      >
        <div className="drawer-header">
          <a
            className="brand"
            href="#overview"
            onClick={() => setNavOpen(false)}
          >
            <Brand />
            <span>
              <strong>Meshat.se</strong>
              <small>MeshCore MQTT</small>
            </span>
          </a>
          <button
            aria-label="Stäng meny"
            className="icon-button drawer-close"
            type="button"
            onClick={() => setNavOpen(false)}
          >
            <Icon path={MDI.close} />
          </button>
        </div>
        <span className="nav-label">Dashboard</span>
        <nav
          aria-label="Huvudnavigation"
          className="nav"
          id="dashboard-navigation"
        >
          {navItems.map((item) => (
            <a
              key={item.view}
              aria-current={view === item.view ? "page" : undefined}
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
        <dl className="drawer-context">
          <div>
            <dt>Namnrymd</dt>
            <dd>{namespace}</dd>
          </div>
          <div>
            <dt>Svarande instans</dt>
            <dd>{respondingBroker}</dd>
          </div>
        </dl>
      </aside>
      <div className="app-frame">
        <header className="top-app-bar">
          <button
            aria-controls="dashboard-navigation"
            aria-expanded={navOpen}
            aria-label="Öppna meny"
            className="menu-button icon-button"
            type="button"
            onClick={() => setNavOpen(true)}
          >
            <Icon path={MDI.menu} />
          </button>
          <div className="topbar-title">
            <span className="mobile-brand-mark">
              <Brand />
            </span>
            <div>
              <strong>MeshCore MQTT-brokers</strong>
              <span>Meshat.se driftöversikt</span>
            </div>
          </div>
          <div className="top-actions">
            <div className="snapshot-time">
              <span>Senast uppdaterad</span>
              <strong>{headerTimeFormat.format(date)}</strong>
              <small>{headerDateFormat.format(date)}</small>
            </div>
          </div>
        </header>
        <main className="main-content">
          <div className="content-container">
            <header className="page-heading">
              <div>
                <p className="page-eyebrow">{currentPage.eyebrow}</p>
                <h1>{currentPage.title}</h1>
                <p>{currentPage.description}</p>
              </div>
              <dl className="page-context">
                <div>
                  <dt>Aktiva instanser</dt>
                  <dd>
                    {numberFormat.format(summary.activeBrokers)} av{" "}
                    {numberFormat.format(summary.totalBrokers)}
                  </dd>
                </div>
                <div>
                  <dt>Data från</dt>
                  <dd>{respondingBroker}</dd>
                </div>
              </dl>
            </header>
            {isLoading ? (
              <div className="dashboard-notice loading" role="status">
                <Icon path={MDI.pulse} />
                <div>
                  <strong>Hämtar dashboarddata</strong>
                  <span>Väntar på den första klustersnapshoten.</span>
                </div>
              </div>
            ) : null}
            {refreshError ? (
              <div className="dashboard-notice error" role="alert">
                <Icon path={MDI.shieldOutline} />
                <div>
                  <strong>Data kunde inte uppdateras</strong>
                  <span>
                    {refreshError}
                    {showingStaleData ? " Senast lyckade snapshot visas." : ""}
                  </span>
                </div>
              </div>
            ) : null}
            {page}
          </div>
        </main>
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
      </div>
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
