import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Logger } from "tslog";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  formatDeniedUntilLabel as deniedUntilLabel,
  formatRegionDisplay,
  formatRegionOptionLabel,
} from "./dashboard-helpers.js";
import {
  neighborLastHeardAt,
  type NeighborQueryStatus,
  type ObserverNeighborEntry,
  type ObserverNeighborsSnapshot,
} from "./neighbors.js";

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
  crosshairsGps:
    "M12 8A4 4 0 1 0 16 12A4 4 0 0 0 12 8M20.94 11A8.99 8.99 0 0 0 13 3.06V1H11V3.06A8.99 8.99 0 0 0 3.06 11H1V13H3.06A8.99 8.99 0 0 0 11 20.94V23H13V20.94A8.99 8.99 0 0 0 20.94 13H23V11M12 19A7 7 0 1 1 19 12A7 7 0 0 1 12 19Z",
  mapMarker:
    "M12 11.5A2.5 2.5 0 1 0 9.5 9A2.5 2.5 0 0 0 12 11.5M12 2A7 7 0 0 1 19 9C19 14.25 12 22 12 22S5 14.25 5 9A7 7 0 0 1 12 2M12 4A5 5 0 0 0 7 9C7 12.54 10.82 17.7 12 19.2C13.18 17.7 17 12.54 17 9A5 5 0 0 0 12 4Z",
};

interface BrokerMetrics {
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
  subscriptions: string[];
  subscriptionsTruncated: boolean;
}

interface SubscriberConnectionDetail {
  clientId: string;
  brokerId: string;
  lastSeenAt: number;
  subscriptions: string[];
  subscriptionsTruncated: boolean;
}

interface SubscriberConnectionEntry {
  username: string;
  connectionCount: number;
  lastSeenAt: number;
  brokers: SubscriberBrokerSummary[];
  subscriptions: string[];
  subscriptionsTruncated: boolean;
  connections: SubscriberConnectionDetail[];
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

interface MeshcoreIoMapAdvert {
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
const numberFormat = new Intl.NumberFormat("en-GB");
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const headerTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const headerDateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const shortTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
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
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return "just now";

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function stockholmTime(timestamp: number): string {
  return `${timeFormat.format(new Date(timestamp))} (Stockholm)`;
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
  return `${headerDateFormat.format(eventDate)} · ${stockholmShortTime(timestamp)}`;
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
            aria-label="Close"
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
  const collator = new Intl.Collator("en-GB", {
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
    return "Anomaly threshold exceeded";
  }
  if (reason.startsWith("iata_changes_exceeded")) {
    return "Too many region changes";
  }

  switch (reason) {
    case "rate_limit_exceeded":
      return "Rate limit exceeded";
    case "anomaly:packet_size":
      return "Unusual packet size";
    case "anomaly:excessive_packet_copies":
      return "Too many packet copies";
    case "anomaly:high_duplicate_rate":
      return "High duplicate rate";
    case "iata_changes_exceeded":
      return "Too many region changes";
    case "wrong_audience":
      return "Invalid audience";
    default:
      return reason;
  }
}

type DenialStatus = BanSummary["status"];

function denialStatusLabel(status: DenialStatus): string {
  if (status === "would_mute") {
    return "Warning";
  }
  return "Blocked";
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
  if (tone === "green") return "Healthy";
  if (tone === "yellow") return broker.ready ? "Degraded" : "Starting";
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
    return "Uplink disabled";
  }

  const target = bridge.targetHost || bridge.targetUrl || "target broker";
  return bridge.connected
    ? `Connected to ${target}`
    : `Not connected to ${target}`;
}

function uplinkShortText(broker: BrokerMetrics): string {
  const bridge = broker.targetBridge;
  return bridge?.enabled && bridge.connected ? "Yes" : "No";
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
  textualValue = false,
}: {
  id: string;
  label: string;
  value: string;
  note: string;
  icon: string;
  textualValue?: boolean;
}) {
  return (
    <article className="metric-item" id={id}>
      <div aria-hidden="true" className="metric-icon">
        <Icon path={icon} />
      </div>
      <div className="metric-copy">
        <div className="metric-label">{label}</div>
        <div
          className={`metric-value ${textualValue ? "textual" : ""}`}
          title={textualValue ? value : undefined}
        >
          {value}
        </div>
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
  if (status === "healthy") return "Active";
  if (status === "electing") return "Electing coordinator";
  if (status === "stale") return "Degraded";
  return "Disabled";
}

function meshcoreIoProducerTone(
  status: MeshcoreIoDashboardSnapshot["producer"]["status"],
): "green" | "orange" | "gray" {
  if (status === "healthy") return "green";
  if (status === "disabled") return "gray";
  return "orange";
}

interface MeshcoreMapFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    key: string;
    advertType: string;
  };
}

interface MeshcoreMapFeatureCollection {
  type: "FeatureCollection";
  features: MeshcoreMapFeature[];
}

const MESHCORE_MAP_SOURCE = "meshcoreio-adverts";
const MESHCORE_MAP_HIT_LAYER = "meshcoreio-advert-hit-area";
const MESHCORE_MAP_MARKER_LAYER = "meshcoreio-advert-markers";

function meshcoreMapStyle(darkMode: boolean): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [
          darkMode
            ? "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
            : "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: darkMode
          ? "© OpenStreetMap contributors © CARTO"
          : "© OpenStreetMap contributors",
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": darkMode ? "#17211c" : "#e8eeea",
        },
      },
      {
        id: "basemap",
        type: "raster",
        source: "basemap",
        paint: { "raster-opacity": 0.96 },
      },
    ],
  };
}

function mapAdvertKey(advert: MeshcoreIoMapAdvert): string {
  return advert.nodePublicKey || advert.requestId;
}

function mapFeatures(
  adverts: MeshcoreIoMapAdvert[],
): MeshcoreMapFeatureCollection {
  return {
    type: "FeatureCollection",
    features: adverts.map((advert) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [advert.longitude, advert.latitude],
      },
      properties: {
        key: mapAdvertKey(advert),
        advertType: advert.advertType.toUpperCase(),
      },
    })),
  };
}

function fitMeshcoreMap(
  map: MapLibreMap,
  adverts: MeshcoreIoMapAdvert[],
): void {
  if (adverts.length === 0) return;

  if (adverts.length === 1) {
    map.flyTo({
      center: [adverts[0].longitude, adverts[0].latitude],
      zoom: 11,
      essential: true,
    });
    return;
  }

  const bounds = new maplibregl.LngLatBounds();
  adverts.forEach((advert) => {
    bounds.extend([advert.longitude, advert.latitude]);
  });
  map.fitBounds(bounds, {
    padding: 48,
    maxZoom: 12,
    duration: 450,
  });
}

function MeshcoreIoAdvertMap({ adverts }: { adverts: MeshcoreIoMapAdvert[] }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | undefined>(undefined);
  const initiallyFittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [darkMode, setDarkMode] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const sortedAdverts = useMemo(
    () => [...adverts].sort((a, b) => b.at - a.at),
    [adverts],
  );
  const [selectedKey, setSelectedKey] = useState(
    sortedAdverts[0] ? mapAdvertKey(sortedAdverts[0]) : "",
  );
  const selectedAdvert =
    sortedAdverts.find((advert) => mapAdvertKey(advert) === selectedKey) ??
    sortedAdverts[0];

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setDarkMode(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (
      sortedAdverts.length > 0 &&
      !sortedAdverts.some((advert) => mapAdvertKey(advert) === selectedKey)
    ) {
      setSelectedKey(mapAdvertKey(sortedAdverts[0]));
    }
  }, [selectedKey, sortedAdverts]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    setMapUnavailable(false);
    setMapReady(false);
    initiallyFittedRef.current = false;

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container,
        center: [12, 54],
        zoom: 4,
        minZoom: 2,
        maxZoom: 18,
        attributionControl: { compact: true },
        style: meshcoreMapStyle(darkMode),
      });
    } catch (error) {
      log.warn("MapLibre could not initialize", error);
      setMapUnavailable(true);
      return;
    }
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
        visualizePitch: false,
      }),
      "top-right",
    );
    void map.once("load", () => {
      map.addSource(MESHCORE_MAP_SOURCE, {
        type: "geojson",
        data: mapFeatures([]),
      });
      map.addLayer({
        id: MESHCORE_MAP_HIT_LAYER,
        type: "circle",
        source: MESHCORE_MAP_SOURCE,
        paint: {
          "circle-radius": 24,
          "circle-color": "#000000",
          "circle-opacity": 0.01,
        },
      });
      map.addLayer({
        id: MESHCORE_MAP_MARKER_LAYER,
        type: "circle",
        source: MESHCORE_MAP_SOURCE,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 6, 12, 10],
          "circle-color": [
            "match",
            ["get", "advertType"],
            "REPEATER",
            "#087f5b",
            "ROOM",
            "#2f6f89",
            "SENSOR",
            "#a15c00",
            "#5e6d64",
          ],
          "circle-stroke-color": darkMode ? "#e7f0ea" : "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": 0.96,
        },
      });
      map.on("click", MESHCORE_MAP_HIT_LAYER, (event) => {
        const key: unknown = event.features?.[0]?.properties?.key;
        if (typeof key === "string") setSelectedKey(key);
      });
      map.on("mouseenter", MESHCORE_MAP_HIT_LAYER, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", MESHCORE_MAP_HIT_LAYER, () => {
        map.getCanvas().style.cursor = "";
      });
      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = undefined;
    };
  }, [darkMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map
      .getSource<GeoJSONSource>(MESHCORE_MAP_SOURCE)
      ?.setData(mapFeatures(sortedAdverts));
    if (!initiallyFittedRef.current && sortedAdverts.length > 0) {
      fitMeshcoreMap(map, sortedAdverts);
      initiallyFittedRef.current = true;
    }
  }, [mapReady, sortedAdverts]);

  function focusAdvert(advert: MeshcoreIoMapAdvert): void {
    setSelectedKey(mapAdvertKey(advert));
    mapRef.current?.flyTo({
      center: [advert.longitude, advert.latitude],
      zoom: 12,
      duration: 450,
      essential: true,
    });
  }

  if (sortedAdverts.length === 0) {
    return (
      <Empty>
        No adverts have been added to the MeshCore.io map during the last seven
        days.
      </Empty>
    );
  }

  return (
    <div className="meshcoreio-map-layout">
      <div className="meshcoreio-map-column">
        <div className="meshcoreio-map-frame">
          <div
            ref={mapContainerRef}
            aria-label={`Map showing ${numberFormat.format(sortedAdverts.length)} MeshCore.io nodes`}
            className="meshcoreio-map-canvas"
          />
          {mapUnavailable ? (
            <div className="meshcoreio-map-fallback" role="status">
              The interactive map is unavailable in this browser. Node details
              remain available in the list.
            </div>
          ) : null}
          <div aria-label="Map marker legend" className="meshcoreio-map-legend">
            <span>
              <i className="repeater" />
              Repeater
            </span>
            <span>
              <i className="room" />
              Room
            </span>
            <span>
              <i className="sensor" />
              Sensor
            </span>
          </div>
          <button
            className="meshcoreio-map-fit"
            type="button"
            onClick={() => {
              if (mapRef.current) fitMeshcoreMap(mapRef.current, sortedAdverts);
            }}
          >
            <Icon path={MDI.crosshairsGps} />
            Fit adverts
          </button>
        </div>
        {selectedAdvert ? (
          <div aria-live="polite" className="meshcoreio-map-selection">
            <div className="meshcoreio-map-selection-icon">
              <Icon path={MDI.mapMarker} />
            </div>
            <div>
              <strong>{selectedAdvert.nodeName}</strong>
              <span>
                {selectedAdvert.advertType} ·{" "}
                {selectedAdvert.latitude.toFixed(5)},{" "}
                {selectedAdvert.longitude.toFixed(5)}
              </span>
              <span>
                Added {stockholmEventTime(selectedAdvert.at)} by{" "}
                {selectedAdvert.workerInstanceId}
              </span>
            </div>
          </div>
        ) : null}
      </div>
      <div aria-label="Mapped adverts" className="meshcoreio-map-list">
        {sortedAdverts.map((advert) => {
          const key = mapAdvertKey(advert);
          const selected = key === selectedKey;
          return (
            <button
              key={key}
              aria-pressed={selected}
              className={`meshcoreio-map-item ${selected ? "selected" : ""}`}
              type="button"
              onClick={() => focusAdvert(advert)}
            >
              <span
                className={`meshcoreio-map-dot ${advert.advertType.toLowerCase()}`}
              />
              <span className="meshcoreio-map-item-copy">
                <strong>{advert.nodeName}</strong>
                <span>{advert.observerName || "Observer unknown"}</span>
              </span>
              <span className="meshcoreio-map-item-meta">
                <strong>{advert.advertType}</strong>
                <span>{stockholmEventTime(advert.at)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
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
        subtitle="Enable this integration under meshcore_io in config.yaml."
        title="MeshCore.io"
      >
        <Empty>The MeshCore.io integration is disabled.</Empty>
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

  if (compact) {
    return (
      <Panel
        className="span-2 meshcoreio-panel meshcoreio-panel-compact"
        subtitle="Shared queue health and distributed upload workers."
        title="MeshCore.io"
      >
        <section
          aria-label="MeshCore.io overview"
          className="metrics meshcoreio-metrics meshcoreio-metrics-compact"
        >
          <MetricItem
            textualValue
            icon={MDI.server}
            id="meshcoreio-producer"
            label="Queue coordinator"
            note={`${meshcoreIoProducerLabel(state.producer.status)} · ${Math.ceil(state.producer.leaseRemainingMs / 1000)}s lease`}
            value={state.producer.instanceId || "-"}
          />
          <MetricItem
            icon={MDI.cloudUpload}
            id="meshcoreio-queue"
            label="Shared queue"
            note={`${numberFormat.format(state.queue.active)} uploading · ${numberFormat.format(state.queue.queued)} queued${state.queue.claimedNotActive > 0 ? ` · ${numberFormat.format(state.queue.claimedNotActive)} claimed, not active` : ""} · ${numberFormat.format(state.queue.ingressPending)} incoming`}
            value={numberFormat.format(state.queue.total)}
          />
          <MetricItem
            icon={MDI.accountMultiple}
            id="meshcoreio-workers"
            label="Upload workers"
            note={`${numberFormat.format(activeWorkers)} active now`}
            value={numberFormat.format(configuredWorkers)}
          />
          <MetricItem
            icon={MDI.pulse}
            id="meshcoreio-uploaded"
            label="Cluster uploads"
            note={`${numberFormat.format(state.totals.retries)} cluster retries · ${numberFormat.format(state.totals.dropped)} cluster drops`}
            value={numberFormat.format(state.totals.uploaded)}
          />
        </section>
        <div className="panel-actions meshcoreio-compact-actions">
          <a className="panel-action-button" href="#meshcoreio">
            View queue and workers
          </a>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      className="meshcoreio-panel"
      subtitle="One broker coordinates intake while every healthy broker can drain the persistent Valkey queue."
      title="MeshCore.io"
    >
      <section
        aria-label="MeshCore.io metrics"
        className="metrics meshcoreio-metrics"
      >
        <MetricItem
          textualValue
          icon={MDI.server}
          id="meshcoreio-producer"
          label="Queue coordinator"
          note={`${meshcoreIoProducerLabel(state.producer.status)} · ${Math.ceil(state.producer.leaseRemainingMs / 1000)}s lease`}
          value={state.producer.instanceId || "-"}
        />
        <MetricItem
          icon={MDI.cloudUpload}
          id="meshcoreio-queue"
          label="Shared queue"
          note={`${numberFormat.format(state.queue.active)} uploading · ${numberFormat.format(state.queue.queued)} queued${state.queue.claimedNotActive > 0 ? ` · ${numberFormat.format(state.queue.claimedNotActive)} claimed, not active` : ""} · ${numberFormat.format(state.queue.ingressPending)} incoming`}
          value={numberFormat.format(state.queue.total)}
        />
        <MetricItem
          icon={MDI.accountMultiple}
          id="meshcoreio-workers"
          label="Upload workers"
          note={`${numberFormat.format(activeWorkers)} active now`}
          value={numberFormat.format(configuredWorkers)}
        />
        <MetricItem
          icon={MDI.pulse}
          id="meshcoreio-uploaded"
          label="Cluster uploads"
          note={`${numberFormat.format(state.totals.retries)} cluster retries · ${numberFormat.format(state.totals.dropped)} cluster drops`}
          value={numberFormat.format(state.totals.uploaded)}
        />
      </section>

      <div className="detail-grid">
        <div>
          <span>Coordinator status</span>
          <strong>
            <StatusLabel tone={meshcoreIoProducerTone(state.producer.status)}>
              {meshcoreIoProducerLabel(state.producer.status)}
            </StatusLabel>
          </strong>
        </div>
        <div>
          <span>Queue capacity</span>
          <strong>
            {numberFormat.format(state.queue.total)} /{" "}
            {numberFormat.format(state.queue.maxQueuedUploads)}
          </strong>
        </div>
        <div>
          <span>Cluster adverts enqueued</span>
          <strong>{numberFormat.format(state.totals.enqueued)}</strong>
        </div>
        <div>
          <span>Cluster invalid adverts</span>
          <strong>{numberFormat.format(state.totals.invalid)}</strong>
        </div>
      </div>

      {state.lastError ? (
        <div className="dashboard-notice error" role="status">
          Latest error: {state.lastError}
        </div>
      ) : null}

      <section
        aria-labelledby="meshcoreio-map-title"
        className="meshcoreio-map-section"
      >
        <div className="meshcoreio-map-heading">
          <div>
            <h3 id="meshcoreio-map-title">Advert map</h3>
            <p>
              Latest position for every advert accepted by MeshCore.io during
              the last seven days.
            </p>
          </div>
          <span className="meshcoreio-map-count">
            {numberFormat.format(state.map?.advertsLast7Days.length ?? 0)} nodes
          </span>
        </div>
        <MeshcoreIoAdvertMap adverts={state.map?.advertsLast7Days ?? []} />
      </section>

      <h3 className="meshcoreio-heading">Broker workers</h3>
      {state.workers.length === 0 ? (
        <Empty>No broker workers have reported yet.</Empty>
      ) : (
        <table className="broker-table">
          <thead>
            <tr>
              <th>Broker</th>
              <th>Workers</th>
              <th>Active</th>
              <th>Uploaded since start</th>
              <th>Failed since start</th>
              <th>Last upload</th>
            </tr>
          </thead>
          <tbody>
            {state.workers.map((worker) => (
              <tr key={worker.instanceId}>
                <td className="primary-cell" data-label="Broker">
                  <span className="cell-value">{worker.instanceId}</span>
                </td>
                <td data-label="Upload workers">
                  {numberFormat.format(worker.configuredWorkers)}
                </td>
                <td data-label="Active">
                  {numberFormat.format(worker.activeUploads)}
                </td>
                <td data-label="Uploaded since broker start">
                  {numberFormat.format(worker.uploadsSucceeded)}
                </td>
                <td data-label="Failed since broker start">
                  {numberFormat.format(worker.uploadsFailed)}
                </td>
                <td data-label="Last upload">
                  {worker.lastUploadAt
                    ? optionalStockholmShortTime(worker.lastUploadAt)
                    : age(Date.now() - worker.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="meshcoreio-heading">Recent uploads</h3>
      {state.history.length === 0 ? (
        <Empty>No adverts have completed yet.</Empty>
      ) : (
        <table className="broker-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Node</th>
              <th>Type</th>
              <th>Broker</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {state.history.map((entry) => (
              <tr key={`${entry.requestId}-${entry.at}`}>
                <td data-label="Time">{stockholmShortTime(entry.at)}</td>
                <td className="primary-cell" data-label="Node">
                  <span className="primary-stack">
                    <span className="cell-value">{entry.nodeName}</span>
                    <span className="cell-note">
                      {entry.nodePublicKey.slice(0, 10)}
                    </span>
                  </span>
                </td>
                <td data-label="Type">{entry.advertType}</td>
                <td data-label="Broker">{entry.workerInstanceId}</td>
                <td data-label="Status">
                  <StatusLabel
                    tone={entry.status === "uploaded" ? "green" : "red"}
                  >
                    {entry.status === "uploaded" ? "Uploaded" : "Dropped"}
                  </StatusLabel>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
          <StatusLabel tone="green">Known</StatusLabel>
          {onOpenObserver ? (
            <button
              className="lookup-detail-button"
              type="button"
              onClick={() => onOpenObserver(observerFromLookupResult(result))}
            >
              View details
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
              <dt>Broker instance</dt>
              <dd>{o.brokerId}</dd>
            </>
          ) : null}
          {o.lastSeen ? (
            <>
              <dt>Last seen</dt>
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
          <StatusLabel tone="red">Blocked</StatusLabel>
          {onOpenObserver ? (
            <button
              className="lookup-detail-button"
              type="button"
              onClick={() => onOpenObserver(observerFromLookupResult(result))}
            >
              View details
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
          <dt>Reason</dt>
          <dd>{b.reason}</dd>
          {b.deniedUntilText || b.mutedUntil ? (
            <>
              <dt>Action / expiry</dt>
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
              <dt>Broker instance</dt>
              <dd>{b.brokerId}</dd>
            </>
          ) : null}
          {b.lastSeen ? (
            <>
              <dt>Last seen</dt>
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
      label = "Unknown";
    } else if (result.status === "invalid") {
      pillTone = "orange";
      label = "Invalid";
    } else {
      pillTone = "red";
      label = "Error";
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
        message: "Observer status could not be checked. Try again later.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      className="overview-lookup"
      subtitle="Enter an observer public key to check whether it is known or blocked."
      title="Check observer status"
    >
      <div className="lookup-form">
        <label className="field">
          <span className="field-label">Public key</span>
          <input
            autoComplete="off"
            className="lookup-input"
            disabled={loading}
            inputMode="text"
            placeholder="64 hexadecimal characters"
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
          {loading ? "Checking…" : "Check status"}
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
    return <Empty>No broker instances have reported yet.</Empty>;
  const brokerGetters: Record<string, (b: BrokerMetrics) => string | number> = {
    instanceId: (b) => b.instanceId,
    startedAt: (b) => b.startedAt,
    clients: (b) => b.claimedObservers ?? b.publisherClients ?? 0,
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
            label="Instance"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="startedAt"
            label="Started"
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
            label="Publishes/min"
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
            label="Updated"
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
              <td className="primary-cell" data-label="Broker instance">
                <span className="primary-stack">
                  <span className="cell-value">{broker.instanceId}</span>
                  <StatusLabel tone={brokerStatusLabelTone(broker)}>
                    {brokerStatusText(broker)}
                  </StatusLabel>
                </span>
              </td>
              <td data-label="Started">
                {optionalStockholmShortTime(broker.startedAt)}
              </td>
              <td data-label="Observers">
                {numberFormat.format(
                  broker.status === "healthy"
                    ? (broker.claimedObservers ?? broker.publisherClients)
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
              <td data-label="Updated">{age(broker.lastUpdateAgeMs)}</td>
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
  const activeBrokers = brokers.filter((broker) => broker.status === "healthy");
  if (activeBrokers.length === 0)
    return <Empty>No active broker instances are reporting right now.</Empty>;
  return (
    <div className="distribution-list">
      {activeBrokers.map((broker) => {
        const observers = broker.claimedObservers ?? broker.publisherClients;
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
              aria-label={`${broker.instanceId}: ${numberFormat.format(pct)} percent of observers`}
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
        {numberFormat.format(total)} connected observers distributed across{" "}
        {numberFormat.format(activeBrokers.length)} active broker instances.
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
        <span className="field-label">Search</span>
        <Icon path={MDI.magnify} />
        <input
          placeholder="Search by observer, key, or region"
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
          <option value="">All regions</option>
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
          ? "No active observers right now."
          : "No observers match the current filters."}
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
            label="Connected through"
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
            label="Last connected"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="lastSeenAt"
            label="Last message"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="blocked"
            label="Blocked"
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
              <td className="primary-cell" data-label="Observer">
                <span className="primary-stack">
                  <span className="cell-value">
                    {observer.label || shortKey(observer.publicKey)}
                  </span>
                  <StatusLabel tone={statusTone ? "green" : "gray"}>
                    {observerStatusText(statusTone)}
                  </StatusLabel>
                </span>
              </td>
              <td data-label="Connected through">{observer.broker}</td>
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
              <td data-label="Last connected">
                {stockholmShortTime(observer.lastConnectedAt)}
              </td>
              <td data-label="Last message">
                {observer.messageCount > 0
                  ? stockholmShortTime(observer.lastSeenAt)
                  : "-"}
              </td>
              <td data-label="Blocked">
                {observer.abuse ? (
                  <StatusLabel tone={denialStatusTone(observer.abuse.status)}>
                    {denialStatusLabel(observer.abuse.status)}
                  </StatusLabel>
                ) : (
                  <StatusLabel>No events</StatusLabel>
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
            <span>Connected through</span>
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
            <span>Last connected</span>
            <strong>{stockholmTime(observer.lastConnectedAt)}</strong>
          </div>
          <div>
            <span>Last message</span>
            <strong>
              {observer.messageCount > 0
                ? stockholmEventTime(observer.lastSeenAt)
                : "-"}
            </strong>
          </div>
          <div>
            <span>Messages on this broker runtime</span>
            <strong>{numberFormat.format(observer.messageCount)}</strong>
          </div>
        </div>
      </section>
      <section>
        <h3>Protection status</h3>
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
              <span>Reason</span>
              <strong>{formatPublicMuteReason(observer.abuse.reason)}</strong>
            </div>
            <div>
              <span>Reported by</span>
              <strong>{observer.abuse.broker}</strong>
            </div>
            <div>
              <span>Action / expiry</span>
              <strong>{deniedUntilLabel(observer.abuse)}</strong>
            </div>
          </div>
        ) : (
          <Empty>
            No protection events have been recorded for this observer.
          </Empty>
        )}
      </section>
      <section>
        <h3>Latest neighbor snapshot</h3>
        {observer.neighbors ? (
          <NeighborSnapshot snapshot={observer.neighbors} />
        ) : (
          <Empty>
            No <code>/neighbors</code> snapshot has been received from this
            observer yet.
          </Empty>
        )}
      </section>
      <section>
        <h3>Recent messages</h3>
        <MessageTable
          countyLookup={countyLookup}
          messages={observer.messages}
        />
      </section>
    </ModalShell>
  );
}

function neighborStatusLabel(status: NeighborQueryStatus): string {
  switch (status) {
    case "responded":
      return "Responded";
    case "send_failed":
      return "Send failed";
    default:
      return "Timed out";
  }
}

function neighborStatusTone(
  status: NeighborQueryStatus,
): "green" | "orange" | "red" {
  switch (status) {
    case "responded":
      return "green";
    case "send_failed":
      return "red";
    default:
      return "orange";
  }
}

function NeighborSnapshot({
  snapshot,
}: {
  snapshot: ObserverNeighborsSnapshot;
}) {
  const { sortField, sortDir, toggle } = useTableSort("heardSecsAgo", "asc");
  const getters: Record<
    string,
    (neighbor: ObserverNeighborEntry) => string | number
  > = {
    publicKey: (neighbor) => neighbor.publicKey,
    snr: (neighbor) => neighbor.snr,
    heardSecsAgo: (neighbor) => neighbor.heardSecsAgo,
    scopes: (neighbor) => neighbor.scopes.join(","),
    status: (neighbor) => neighbor.status,
  };
  const neighbors = sortData(snapshot.neighbors, sortField, sortDir, getters);
  const responded = snapshot.neighbors.filter(
    (neighbor) => neighbor.status === "responded",
  ).length;
  const timedOut = snapshot.neighbors.filter(
    (neighbor) => neighbor.status === "timeout",
  ).length;
  const sendFailed = snapshot.neighbors.filter(
    (neighbor) => neighbor.status === "send_failed",
  ).length;

  return (
    <div className="neighbor-snapshot">
      <div className="detail-grid compact">
        <div>
          <span>Received</span>
          <strong>{stockholmEventTime(snapshot.receivedAt)}</strong>
        </div>
        <div>
          <span>Firmware timestamp</span>
          <strong>{optionalStockholmTime(snapshot.reportedAt)}</strong>
        </div>
        <div>
          <span>Neighbors</span>
          <strong>{numberFormat.format(snapshot.neighbors.length)}</strong>
        </div>
        <div>
          <span>Query result</span>
          <strong>
            {numberFormat.format(responded)} responded ·{" "}
            {numberFormat.format(timedOut)} timed out
            {sendFailed > 0
              ? ` · ${numberFormat.format(sendFailed)} send failed`
              : ""}
          </strong>
        </div>
        <div className="detail-wide">
          <span>Observer scopes</span>
          <strong className="scope-list">
            {snapshot.selfScopes.length > 0
              ? snapshot.selfScopes.join(", ")
              : "None reported"}
          </strong>
        </div>
        {snapshot.invalidEntryCount > 0 ? (
          <div className="detail-wide">
            <span>Ignored entries</span>
            <strong>
              {numberFormat.format(snapshot.invalidEntryCount)} entries were
              malformed, duplicated, or beyond the display limit
            </strong>
          </div>
        ) : null}
      </div>

      {neighbors.length === 0 ? (
        <Empty>The snapshot contains no valid neighbors.</Empty>
      ) : (
        <table className="neighbor-table">
          <thead>
            <tr>
              <SortHeader
                field="publicKey"
                label="Neighbor"
                sortDir={sortDir}
                sortField={sortField}
                onToggle={toggle}
              />
              <SortHeader
                field="snr"
                label="SNR"
                sortDir={sortDir}
                sortField={sortField}
                onToggle={toggle}
              />
              <SortHeader
                field="heardSecsAgo"
                label="Last heard"
                sortDir={sortDir}
                sortField={sortField}
                onToggle={toggle}
              />
              <SortHeader
                field="scopes"
                label="Scopes"
                sortDir={sortDir}
                sortField={sortField}
                onToggle={toggle}
              />
              <SortHeader
                field="status"
                label="Scope query"
                sortDir={sortDir}
                sortField={sortField}
                onToggle={toggle}
              />
            </tr>
          </thead>
          <tbody>
            {neighbors.map((neighbor) => (
              <tr key={neighbor.publicKey}>
                <td className="primary-cell" data-label="Neighbor">
                  <code className="neighbor-key" title={neighbor.publicKey}>
                    {shortKey(neighbor.publicKey)}
                  </code>
                </td>
                <td data-label="SNR">{neighbor.snr.toFixed(1)} dB</td>
                <td data-label="Last heard">
                  {age(
                    Date.now() -
                      neighborLastHeardAt(
                        snapshot.receivedAt,
                        neighbor.heardSecsAgo,
                      ),
                  )}
                </td>
                <td className="wide-cell" data-label="Scopes">
                  <span className="scope-list">
                    {neighbor.scopes.length > 0
                      ? neighbor.scopes.join(", ")
                      : "None reported"}
                  </span>
                </td>
                <td data-label="Scope query">
                  <StatusLabel tone={neighborStatusTone(neighbor.status)}>
                    {neighborStatusLabel(neighbor.status)}
                  </StatusLabel>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
            <span>Started</span>
            <strong>{optionalStockholmTime(broker.startedAt)}</strong>
          </div>
          <div>
            <span>Publishes in the last minute</span>
            <strong>
              {numberFormat.format(
                broker.status === "healthy"
                  ? broker.messagesLastMinute || 0
                  : 0,
              )}
            </strong>
          </div>
          <div>
            <span>Updated</span>
            <strong>{age(broker.lastUpdateAgeMs)}</strong>
          </div>
          <div>
            <span>Active observers</span>
            <strong>{numberFormat.format(claimedObservers.length)}</strong>
          </div>
          <div>
            <span>Uplink</span>
            <strong>
              <StatusLabel tone={uplinkTone(broker)}>
                {uplinkText(broker)}
              </StatusLabel>
            </strong>
          </div>
          <div>
            <span>Uplink client ID</span>
            <strong>{bridge?.clientId || "-"}</strong>
          </div>
          <div>
            <span>Forwarded since broker start</span>
            <strong>
              {numberFormat.format(bridge?.successfulMessages || 0)}
            </strong>
          </div>
          <div>
            <span>Dropped since broker start</span>
            <strong>{numberFormat.format(bridge?.droppedMessages || 0)}</strong>
          </div>
        </div>
      </section>
      <section>
        <h3>Active observers</h3>
        {claimedObservers.length === 0 ? (
          <Empty>This broker instance has no active observers right now.</Empty>
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
                  label="Last message"
                  sortDir={sortDir}
                  sortField={sortField}
                  onToggle={toggle}
                />
                <SortHeader
                  field="messageCount"
                  label="Messages on this broker runtime"
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
                  <td className="primary-cell" data-label="Observer">
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
                  <td data-label="Last message">
                    {observer.messageCount > 0
                      ? stockholmShortTime(observer.lastSeenAt)
                      : "-"}
                  </td>
                  <td data-label="Messages on this broker runtime">
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
    return <Empty>No messages have been recorded yet.</Empty>;
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
            label="Time"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="broker"
            label="Broker instance"
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
            label="Size"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="topic"
            label="MQTT topic"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
        </tr>
      </thead>
      <tbody>
        {sortedMsgs.map((message, index) => (
          <tr key={`${message.receivedAt}-${index}`}>
            <td data-label="Time">{stockholmShortTime(message.receivedAt)}</td>
            <td data-label="Broker instance">{message.broker}</td>
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
            <td data-label="Size">{numberFormat.format(message.bytes)} B</td>
            <td className="wide-cell topic-cell" data-label="MQTT topic">
              <code className="topic-code" title={message.topic}>
                {message.topic}
              </code>
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
    return <Empty>No publishes have been recorded yet.</Empty>;
  return (
    <div className="publish-feed-wrap">
      <div className="publish-feed-head">
        <span>Time</span>
        <span>Observer</span>
        <span>Region</span>
        <span>Subtopic</span>
        <span>Size</span>
        <span>Broker instance</span>
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
                <span className="publish-topic" title={publish.topic}>
                  {publish.topic}
                </span>
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
              <span className="publish-meta" data-label="Subtopic">
                {publish.subtopic || "-"}
              </span>
              <span className="publish-meta" data-label="Size">
                {numberFormat.format(publish.bytes)} B
              </span>
              <span className="publish-meta" data-label="Broker instance">
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
              ? "Show fewer"
              : `Show ${Math.min(40, publishes.length - initialLimit)} more`}
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
            <span>Reported by</span>
            <strong>{ban.broker}</strong>
          </div>
          <div>
            <span>Reason</span>
            <strong>{formatPublicMuteReason(ban.reason)}</strong>
          </div>
          <div>
            <span>Action / expiry</span>
            <strong>{deniedUntilLabel(ban)}</strong>
          </div>
          <div>
            <span>Last seen</span>
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
          <div>
            <span>Status</span>
            <strong>
              <StatusLabel tone={denialStatusTone(ban.status)}>
                {denialStatusLabel(ban.status)}
              </StatusLabel>
            </strong>
          </div>
          {ban.topic ? (
            <div className="detail-wide">
              <span>MQTT topic</span>
              <code className="topic-code" title={ban.topic}>
                {ban.topic}
              </code>
            </div>
          ) : null}
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
  if (bans.length === 0) return <Empty>No protection events.</Empty>;
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
            label="Observer / key"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="broker"
            label="Reported by"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="reason"
            label="Reason"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="deniedUntil"
            label="Action / expiry"
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
            <td className="primary-cell" data-label="Observer / key">
              <span className="cell-value">
                {ban.label || shortKey(ban.node)}
              </span>
            </td>
            <td data-label="Reported by">{ban.broker}</td>
            <td data-label="Reason">{formatPublicMuteReason(ban.reason)}</td>
            <td className="wide-cell" data-label="Action / expiry">
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
function SubscriptionList({
  topics,
  truncated = false,
  limit,
}: {
  topics: string[];
  truncated?: boolean;
  limit?: number;
}) {
  const visibleTopics = limit ? topics.slice(0, limit) : topics;
  const hiddenCount = Math.max(0, topics.length - visibleTopics.length);

  if (topics.length === 0 && !truncated) {
    return <span className="subscription-empty">No active subscriptions</span>;
  }

  return (
    <div className="subscription-list">
      {visibleTopics.map((topic) => (
        <code key={topic} className="subscription-topic" title={topic}>
          {topic}
        </code>
      ))}
      {hiddenCount > 0 ? (
        <span className="subscription-more">
          +{numberFormat.format(hiddenCount)} more
        </span>
      ) : null}
      {truncated ? (
        <span
          className="subscription-more"
          title="The broker limits how many topic filters are retained for dashboard display."
        >
          Additional topics not shown
        </span>
      ) : null}
    </div>
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
    subscriptionsStr: (s) => s.subscriptions.join(", "),
    connectionCount: (s) => s.connectionCount,
    lastSeenAt: (s) => (s.lastSeenAt > 0 ? s.lastSeenAt : 0),
  };

  if (snapshotError) {
    return <Empty>Subscriber data could not be loaded from Valkey.</Empty>;
  }
  if (subscribers.length === 0) return <Empty>No active subscribers.</Empty>;

  const sorted = sortData(subscribers, sortField, sortDir, getters);
  return (
    <table className="subscriber-table">
      <thead>
        <tr>
          <SortHeader
            field="username"
            label="Username"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="brokersStr"
            label="Connected through"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="subscriptionsStr"
            label="Subscriptions"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="connectionCount"
            label="Connections"
            sortDir={sortDir}
            sortField={sortField}
            onToggle={toggle}
          />
          <SortHeader
            field="lastSeenAt"
            label="Last active"
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
            <td className="primary-cell" data-label="Username">
              <span className="cell-value">{sub.username}</span>
            </td>
            <td className="wide-cell" data-label="Connected through">
              <div className="broker-reference-list">
                {sub.brokers.map((b) => (
                  <span key={b.brokerId} className="broker-reference">
                    {b.brokerId} ({numberFormat.format(b.connectionCount)})
                  </span>
                ))}
              </div>
            </td>
            <td className="wide-cell topic-cell" data-label="Subscriptions">
              <SubscriptionList
                limit={3}
                topics={sub.subscriptions}
                truncated={sub.subscriptionsTruncated}
              />
            </td>
            <td data-label="Connections">
              {numberFormat.format(sub.connectionCount)}
            </td>
            <td data-label="Last active">
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
      subtitle="Active subscriber connections"
      title={sub.username}
      titleId="subscriber-dialog-title"
      onClose={onClose}
    >
      <section>
        <div className="detail-grid">
          <div>
            <span>Total active connections</span>
            <strong>{numberFormat.format(sub.connectionCount)}</strong>
          </div>
          <div>
            <span>Unique subscriptions</span>
            <strong>
              {numberFormat.format(sub.subscriptions.length)}
              {sub.subscriptionsTruncated ? "+" : ""}
            </strong>
          </div>
          <div>
            <span>Broker instances</span>
            <strong>{numberFormat.format(sub.brokers.length)}</strong>
          </div>
          <div>
            <span>Last active</span>
            <strong>
              {sub.lastSeenAt > 0 ? stockholmTime(sub.lastSeenAt) : "-"}
            </strong>
          </div>
        </div>
      </section>
      <section>
        <h3>Subscribed topic filters</h3>
        <SubscriptionList
          topics={sub.subscriptions}
          truncated={sub.subscriptionsTruncated}
        />
      </section>
      <section>
        <h3>Active connections</h3>
        <div className="subscriber-connection-list">
          {sub.connections.map((connection, index) => (
            <article
              key={`${connection.brokerId}-${connection.clientId}-${index}`}
              className="subscriber-connection"
            >
              <header>
                <div>
                  <strong>{connection.clientId}</strong>
                  <span>{connection.brokerId}</span>
                </div>
                <span>{stockholmShortTime(connection.lastSeenAt)}</span>
              </header>
              <SubscriptionList
                topics={connection.subscriptions}
                truncated={connection.subscriptionsTruncated}
              />
            </article>
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
    eyebrow: "Cluster overview",
    title: "Overview",
    description:
      "Current health, traffic, and protection status across the MQTT cluster.",
  },
  brokers: {
    eyebrow: "Operations",
    title: "Broker instances",
    description:
      "Health, traffic, and uplink status for every reporting broker instance.",
  },
  observers: {
    eyebrow: "Network",
    title: "Observers",
    description:
      "Search connected observers, inspect regions, and review recent activity.",
  },
  meshcoreio: {
    eyebrow: "Map uploads",
    title: "MeshCore.io",
    description:
      "Queue coordination, upload workers, and recent MeshCore.io advert activity.",
  },
  bans: {
    eyebrow: "Security",
    title: "Protection events",
    description: "Publishes blocked or flagged by the broker protection rules.",
  },
  subscribers: {
    eyebrow: "Access",
    title: "Subscribers",
    description:
      "Active subscriber connections, topic filters, and their distribution across broker instances.",
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
          throw new Error(`Dashboard API returned HTTP ${response.status}`);
        }

        const data = (await response.json()) as DashboardSnapshot;
        if (!active) {
          return;
        }

        if (data.error) {
          setRefreshError(
            "Dashboard data could not be read from Valkey. Check the cluster connection.",
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
          "The dashboard API could not be reached. Previously loaded data remains visible.",
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
    protectionEventsShown: 0,
    protectionEventsTruncated: false,
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
    { view: "overview", label: "Overview", icon: MDI.homeOutline },
    { view: "brokers", label: "Brokers", icon: MDI.server },
    { view: "observers", label: "Observers", icon: MDI.accountGroup },
    { view: "meshcoreio", label: "MeshCore.io", icon: MDI.cloudUpload },
    { view: "bans", label: "Protection", icon: MDI.shieldOutline },
    { view: "subscribers", label: "Subscribers", icon: MDI.accountMultiple },
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
            subtitle="Broker instances that have reported status recently."
            title="Broker instances"
          >
            <BrokerTable brokers={brokers} onSelect={setSelectedBroker} />
          </Panel>
          <Panel
            subtitle="Share of connected observers handled by each active instance."
            title="Traffic distribution"
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
          subtitle="Search observers and inspect connectivity, recent messages, and protection events."
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
    if (view === "meshcoreio") {
      return <MeshcoreIoView state={meshcoreIo} />;
    }
    if (view === "bans") {
      return (
        <Panel
          subtitle={`Blocked publishes and observers flagged while enforcement is in shadow mode.${summary.protectionEventsTruncated ? " Showing the latest 50 events." : ""}`}
          title="Protection events"
        >
          <BanTable bans={allBans} onSelect={setSelectedBan} />
        </Panel>
      );
    }
    if (view === "subscribers") {
      return (
        <Panel
          subtitle="Active subscriber connections to brokers in this cluster."
          title="Subscribers"
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
        <section aria-label="Cluster metrics" className="metrics">
          <MetricItem
            icon={MDI.accountGroup}
            id="clients"
            label="Connected observers"
            note="Active now"
            value={numberFormat.format(summary.connectedObservers)}
          />
          <MetricItem
            icon={MDI.server}
            id="brokers"
            label="Active brokers"
            note={`${numberFormat.format(summary.totalBrokers)} broker records with recent metrics`}
            value={numberFormat.format(summary.activeBrokers)}
          />
          <MetricItem
            icon={MDI.pulse}
            id="mps"
            label="Public publishes"
            note="Public observer messages in the last minute"
            value={numberFormat.format(summary.publishesLastMinute)}
          />
          <MetricItem
            icon={MDI.shieldOutline}
            id="bans"
            label="Retained protection events"
            note={
              summary.protectionEventsTruncated
                ? "Latest 50 blocked or flagged events"
                : "Blocked or flagged events still retained"
            }
            value={`${numberFormat.format(summary.protectionEventsShown)}${summary.protectionEventsTruncated ? "+" : ""}`}
          />
        </section>
        <section className="grid">
          <Panel
            subtitle="Health of the broker instances behind the load balancer."
            title="Broker instances"
          >
            <BrokerTable brokers={brokers} onSelect={setSelectedBroker} />
          </Panel>
          <Panel
            subtitle="Share of connected observers handled by each active instance."
            title="Traffic distribution"
          >
            <BrokerDistribution
              brokers={brokers}
              total={summary.connectedObservers}
            />
          </Panel>
          <MeshcoreIoView compact state={meshcoreIo} />
          <Panel
            className="span-2"
            subtitle={
              summary.protectionEventsTruncated
                ? "Showing the latest 50 retained events."
                : undefined
            }
            title="Protection events"
          >
            <BanTable bans={overviewBans} onSelect={setSelectedBan} />
            {allBans.length > overviewBans.length ? (
              <div className="panel-actions">
                <button
                  className="panel-action-button"
                  type="button"
                  onClick={() => setView("bans")}
                >
                  View protection events
                </button>
              </div>
            ) : null}
          </Panel>
          <Panel
            className="span-2"
            subtitle="The 50 most recent messages recorded by the dashboard."
            title="Recent publishes"
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
          aria-label="Close menu"
          className="nav-scrim"
          type="button"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <aside
        ref={sidebarRef}
        aria-label="Dashboard navigation"
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
            aria-label="Close menu"
            className="icon-button drawer-close"
            type="button"
            onClick={() => setNavOpen(false)}
          >
            <Icon path={MDI.close} />
          </button>
        </div>
        <span className="nav-label">Dashboard</span>
        <nav
          aria-label="Primary navigation"
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
            <dt>Namespace</dt>
            <dd>{namespace}</dd>
          </div>
          <div>
            <dt>Responding broker</dt>
            <dd>{respondingBroker}</dd>
          </div>
        </dl>
      </aside>
      <div className="app-frame">
        <header className="top-app-bar">
          <button
            aria-controls="dashboard-navigation"
            aria-expanded={navOpen}
            aria-label="Open menu"
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
              <strong>
                <span className="desktop-title">MeshCore MQTT</span>
                <span className="mobile-title">MeshCore MQTT</span>
              </strong>
              <span>Meshat.se operations dashboard</span>
            </div>
          </div>
          <div className="top-actions">
            <div className="snapshot-time">
              <span>Updated</span>
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
                  <dt>Active brokers</dt>
                  <dd>
                    {numberFormat.format(summary.activeBrokers)} of{" "}
                    {numberFormat.format(summary.totalBrokers)}
                  </dd>
                </div>
                <div>
                  <dt>Data source</dt>
                  <dd>{respondingBroker}</dd>
                </div>
              </dl>
            </header>
            {isLoading ? (
              <div className="dashboard-notice loading" role="status">
                <Icon path={MDI.pulse} />
                <div>
                  <strong>Loading dashboard data</strong>
                  <span>Waiting for the first cluster snapshot.</span>
                </div>
              </div>
            ) : null}
            {refreshError ? (
              <div className="dashboard-notice error" role="alert">
                <Icon path={MDI.shieldOutline} />
                <div>
                  <strong>Data could not be refreshed</strong>
                  <span>
                    {refreshError}
                    {showingStaleData
                      ? " The last successful snapshot remains visible."
                      : ""}
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
