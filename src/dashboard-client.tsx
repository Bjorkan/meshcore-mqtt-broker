import {
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
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
  type RegionLookup,
} from "./dashboard-helpers.js";
import type { PublicDashboardConfig } from "./dashboard.js";
import {
  type NeighborQueryStatus,
  type ObserverNeighborEntry,
  type ObserverNeighborsSnapshot,
} from "./neighbors.js";

const log = new Logger({ name: "Dashboard", type: "pretty" });
setWorkerUrl("/maplibre-gl-worker.js");

declare global {
  interface Window {
    __DASHBOARD_CONFIG__?: PublicDashboardConfig;
  }
}

const dashboardConfig: PublicDashboardConfig = window.__DASHBOARD_CONFIG__ ?? {
  branding: {
    operatorName: "MeshCore MQTT",
    dashboardTitle: "MeshCore MQTT Broker",
    dashboardSubtitle: "Operations dashboard",
  },
  iataWhitelistEnabled: false,
};

const MDI = {
  accessPointNetwork:
    "M4.93 4.93C3.12 6.74 2 9.24 2 12S3.12 17.26 4.93 19.07L6.34 17.66C4.89 16.21 4 14.21 4 12S4.89 7.79 6.34 6.34L4.93 4.93M19.07 4.93L17.66 6.34C19.11 7.79 20 9.79 20 12S19.11 16.21 17.66 17.66L19.07 19.07C20.88 17.26 22 14.76 22 12S20.88 6.74 19.07 4.93M7.76 7.76C6.67 8.85 6 10.35 6 12S6.67 15.15 7.76 16.24L9.17 14.83C8.45 14.11 8 13.11 8 12S8.45 9.89 9.17 9.17L7.76 7.76M16.24 7.76L14.83 9.17C15.55 9.89 16 10.89 16 12S15.55 14.11 14.83 14.83L16.24 16.24C17.33 15.15 18 13.65 18 12S17.33 8.85 16.24 7.76M12 10A2 2 0 1 0 12 14A2 2 0 0 0 12 10Z",
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
  moon: "M21 12.79A9 9 0 1 1 11.21 3C10.49 3.96 10 5.15 10 6.5C10 10.64 13.36 14 17.5 14C18.85 14 20.04 13.5 21 12.79Z",
  server:
    "M4 1H20A2 2 0 0 1 22 3V7A2 2 0 0 1 20 9H4A2 2 0 0 1 2 7V3A2 2 0 0 1 4 1M4 3V7H20V3H4M4 11H20A2 2 0 0 1 22 13V17A2 2 0 0 1 20 19H4A2 2 0 0 1 2 17V13A2 2 0 0 1 4 11M4 13V17H20V13H4M6 4.5A1.5 1.5 0 1 1 6 7.5A1.5 1.5 0 0 1 6 4.5M6 14.5A1.5 1.5 0 1 1 6 17.5A1.5 1.5 0 0 1 6 14.5Z",
  shieldOutline:
    "M12 1L3 5V11C3 16.55 6.84 21.74 12 23C17.16 21.74 21 16.55 21 11V5L12 1M12 3.18L19 6.3V11.22C19 15.77 16.04 20 12 21C7.96 20 5 15.77 5 11.22V6.3L12 3.18Z",
  sun: "M12 7A5 5 0 1 0 17 12A5 5 0 0 0 12 7M12 9A3 3 0 1 1 9 12A3 3 0 0 1 12 9M11 1H13V5H11V1M11 19H13V23H11V19M1 11H5V13H1V11M19 11H23V13H19V11M4.22 2.81L7.05 5.64L5.64 7.05L2.81 4.22L4.22 2.81M16.95 18.36L18.36 16.95L21.19 19.78L19.78 21.19L16.95 18.36M2.81 19.78L5.64 16.95L7.05 18.36L4.22 21.19L2.81 19.78M16.95 5.64L19.78 2.81L21.19 4.22L18.36 7.05L16.95 5.64Z",
  accountMultiple:
    "M13.07 10.41A5 5 0 0 0 13.07 4.59A3.97 3.97 0 0 1 15 5A4 4 0 0 1 15 10A3.97 3.97 0 0 1 13.07 10.41M5.5 6.5A3 3 0 1 1 6.5 9.5A3 3 0 0 1 5.5 6.5M18.5 6.5A3 3 0 1 1 19.5 9.5A3 3 0 0 1 18.5 6.5M12 12A4 4 0 0 0 8 16H16A4 4 0 0 0 12 12M4.5 12A2.5 2.5 0 0 0 2 14.5V15H7.17A5.9 5.9 0 0 1 7 13A5.9 5.9 0 0 1 7.16 12ZM19.5 12A2.5 2.5 0 0 1 22 14.5V15H16.83A5.9 5.9 0 0 0 17 13A5.9 5.9 0 0 0 16.84 12Z",
  cloudUpload:
    "M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 6 20H19A5 5 0 0 0 19.35 10.04M14 13V17H10V13H7L12 8L17 13H14Z",
  crosshairsGps:
    "M12 8A4 4 0 1 0 16 12A4 4 0 0 0 12 8M20.94 11A8.99 8.99 0 0 0 13 3.06V1H11V3.06A8.99 8.99 0 0 0 3.06 11H1V13H3.06A8.99 8.99 0 0 0 11 20.94V23H13V20.94A8.99 8.99 0 0 0 20.94 13H23V11M12 19A7 7 0 1 1 19 12A7 7 0 0 1 12 19Z",
  mapMarker:
    "M12 11.5A2.5 2.5 0 1 0 9.5 9A2.5 2.5 0 0 0 12 11.5M12 2A7 7 0 0 1 19 9C19 14.25 12 22 12 22S5 14.25 5 9A7 7 0 0 1 12 2M12 4A5 5 0 0 0 7 9C7 12.54 10.82 17.7 12 19.2C13.18 17.7 17 12.54 17 9A5 5 0 0 0 12 4Z",
};

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "meshcore-dashboard-theme";

function getStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

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

interface DashboardSnapshot {
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
    blockedObservers: number;
    protectionEventsShown: number;
    protectionEventsTruncated: boolean;
    protectionEventsTotal: number;
  };
  brokers: BrokerMetrics[];
  observers: DashboardObserver[];
  recentPublishes: ObserverMessage[];
  bans: BanSummary[];
  subscribers: SubscriberConnectionEntry[];
  regionLookup?: RegionLookup;
  meshcoreIo?: MeshcoreIoDashboardSnapshot;
  error?: string;
}

type View = "overview" | "observers" | "meshcoreio" | "bans" | "subscribers";

const views: View[] = [
  "overview",
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
      <rect fill="#006c4c" height="24" rx="5" width="24" />
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

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const nextTheme = theme === "dark" ? "light" : "dark";
  return (
    <button
      aria-label={`Switch to ${nextTheme} mode`}
      className="theme-toggle"
      title={`Switch to ${nextTheme} mode`}
      type="button"
      onClick={onToggle}
    >
      <Icon path={theme === "dark" ? MDI.moon : MDI.sun} />
      <span>{theme === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}

function BrandIdentity({ onActivate }: { onActivate: () => void }) {
  const content = (
    <>
      <Brand />
      <span>
        <strong>{dashboardConfig.branding.operatorName}</strong>
        <small>{dashboardConfig.branding.dashboardTitle}</small>
      </span>
    </>
  );
  return dashboardConfig.branding.websiteUrl ? (
    <a
      className="brand"
      href={dashboardConfig.branding.websiteUrl}
      onClick={onActivate}
    >
      {content}
    </a>
  ) : (
    <div className="brand">{content}</div>
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
  return `${headerDateFormat.format(new Date(timestamp))} · ${stockholmShortTime(timestamp)}`;
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

type ModalSize = "sm" | "md" | "lg" | "wide";

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
  size?: ModalSize;
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
            className="modal-close"
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
        <span
          aria-hidden="true"
          className={`sort-arrow ${active ? sortDir : "inactive"}`}
        />
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
  regionLookup,
}: {
  region?: string;
  regionLookup?: RegionLookup;
}) {
  const formatted = formatRegionDisplay(region, regionLookup);
  if (!formatted) return <span className="cell-value">-</span>;
  if (!formatted.friendlyName)
    return <span className="cell-value">{formatted.code}</span>;
  return (
    <span className="cell-value">
      <span className="region-name">{formatted.friendlyName}</span>
      <span className="region-code">{formatted.code}</span>
      {formatted.isAllowed === false && formatted.primaryRegion ? (
        <span className="cell-note">Use {formatted.primaryRegion}</span>
      ) : null}
    </span>
  );
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

function ModalFacts({
  columns,
  children,
}: {
  columns: "two" | "three" | "four";
  children: React.ReactNode;
}) {
  return <dl className={`modal-facts ${columns}`}>{children}</dl>;
}

function ModalFact({
  label,
  note,
  children,
}: {
  label: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
      {note ? <dd className="modal-fact-note">{note}</dd> : null}
    </div>
  );
}

interface ModalFactItem {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
}

interface ModalRecordItem {
  label: string;
  value: React.ReactNode;
}

function DetailDialog({
  titleId,
  title,
  subtitle,
  summaryLabel,
  facts,
  columns,
  children,
  onClose,
  size = "md",
}: {
  titleId: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  summaryLabel: string;
  facts: ModalFactItem[];
  columns: "two" | "three" | "four";
  children?: React.ReactNode;
  onClose: () => void;
  size?: ModalSize;
}) {
  return (
    <ModalShell
      size={size}
      subtitle={subtitle}
      title={title}
      titleId={titleId}
      onClose={onClose}
    >
      <section aria-label={summaryLabel} className="modal-summary">
        <ModalFacts columns={columns}>
          {facts.map((fact) => (
            <ModalFact key={fact.label} label={fact.label} note={fact.note}>
              {fact.value}
            </ModalFact>
          ))}
        </ModalFacts>
      </section>
      {children}
    </ModalShell>
  );
}

function ModalSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="modal-section-heading">
        <h3>{title}</h3>
        {meta ? <span className="modal-section-meta">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function ModalRecord({
  items,
  compact = false,
}: {
  items: ModalRecordItem[];
  compact?: boolean;
}) {
  return (
    <dl className={`modal-record ${compact ? "compact" : ""}`}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function meshcoreIoProcessorLabel(
  status: MeshcoreIoDashboardSnapshot["processor"]["status"],
): string {
  if (status === "healthy") return "Active";
  return "Disabled";
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

function meshcoreMapMotionDuration(): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : 450;
}

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
      duration: meshcoreMapMotionDuration(),
      essential: false,
    });
    return;
  }

  const bounds = new LngLatBounds();
  adverts.forEach((advert) => {
    bounds.extend([advert.longitude, advert.latitude]);
  });
  map.fitBounds(bounds, {
    padding: 48,
    maxZoom: 12,
    duration: meshcoreMapMotionDuration(),
  });
}

function MeshcoreIoAdvertMap({
  adverts,
  darkMode,
}: {
  adverts: MeshcoreIoMapAdvert[];
  darkMode: boolean;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | undefined>(undefined);
  const initiallyFittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
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
      map = new MapLibreMap({
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
      new NavigationControl({
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(meshcoreMapStyle(darkMode));
    void map.once("styledata", () => {
      if (map.getSource(MESHCORE_MAP_SOURCE)) return;
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
      if (sortedAdverts.length > 0) {
        void map
          .getSource<GeoJSONSource>(MESHCORE_MAP_SOURCE)
          ?.setData(mapFeatures(sortedAdverts));
      }
    });
  }, [darkMode, sortedAdverts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    void map
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
      duration: meshcoreMapMotionDuration(),
      essential: false,
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
            role="region"
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
  generatedAt,
  theme,
}: {
  state?: MeshcoreIoDashboardSnapshot;
  compact?: boolean;
  generatedAt?: number;
  theme: Theme;
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
        subtitle="Local durable queue and upload workers."
        title="MeshCore.io"
      >
        <section
          aria-label="MeshCore.io overview"
          className="metrics meshcoreio-metrics meshcoreio-metrics-compact"
        >
          <MetricItem
            textualValue
            icon={MDI.server}
            id="meshcoreio-processor"
            label="Queue processor"
            note={meshcoreIoProcessorLabel(state.processor.status)}
            value={state.processor.instanceId || "-"}
          />
          <MetricItem
            icon={MDI.cloudUpload}
            id="meshcoreio-queue"
            label="Durable queue"
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
            label="Uploads"
            note={`${numberFormat.format(state.totals.retries)} retries · ${numberFormat.format(state.totals.dropped)} drops`}
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
      subtitle="This broker processes a persistent local Turso queue."
      title="MeshCore.io"
    >
      <section
        aria-label="MeshCore.io metrics"
        className="metrics meshcoreio-metrics"
      >
        <MetricItem
          textualValue
          icon={MDI.server}
          id="meshcoreio-processor"
          label="Queue processor"
          note={meshcoreIoProcessorLabel(state.processor.status)}
          value={state.processor.instanceId || "-"}
        />
        <MetricItem
          icon={MDI.cloudUpload}
          id="meshcoreio-queue"
          label="Durable queue"
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
          label="Uploads"
          note={`${numberFormat.format(state.totals.retries)} retries · ${numberFormat.format(state.totals.dropped)} drops`}
          value={numberFormat.format(state.totals.uploaded)}
        />
      </section>

      {state.lastError ? (
        <div className="dashboard-notice error" role="alert">
          <Icon path={MDI.shieldOutline} />
          <div>
            <strong>Latest MeshCore.io error</strong>
            <span>{state.lastError}</span>
          </div>
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
        <MeshcoreIoAdvertMap
          adverts={state.map?.advertsLast7Days ?? []}
          darkMode={theme === "dark"}
        />
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
                    : age(
                        generatedAt
                          ? Math.max(0, generatedAt - worker.updatedAt)
                          : 0,
                      )}
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

function ObserverLookup({
  onOpenObserver,
  regionLookup,
  observers,
}: {
  onOpenObserver: (observer: DashboardObserver) => void;
  regionLookup?: RegionLookup;
  observers: DashboardObserver[];
}) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const matches = useMemo(() => {
    const trimmed = input.trim().toUpperCase();
    if (!trimmed || trimmed.length < 2) return [];

    const scored: { observer: DashboardObserver; score: number }[] = [];
    for (const observer of observers) {
      let score = 0;
      const key = observer.publicKey.toUpperCase();
      const label = observer.label.toUpperCase();

      if (key === trimmed) {
        score = 100;
      } else if (label === trimmed) {
        score = 90;
      } else if (key.startsWith(trimmed)) {
        score = 80;
      } else if (label.startsWith(trimmed)) {
        score = 70;
      } else if (key.includes(trimmed)) {
        score = 60;
      } else if (label.includes(trimmed)) {
        score = 50;
      } else {
        continue;
      }
      scored.push({ observer, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 10);
  }, [input, observers]);
  const popupOpen = focused && input.trim().length >= 2;

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <Panel
      className="overview-lookup"
      subtitle="Search for an observer by name or public key."
      title="Find observer"
    >
      <div ref={containerRef} className="lookup-form">
        <div className={`field lookup-field ${popupOpen ? "open" : ""}`}>
          <label className="field-label" htmlFor="observer-lookup-input">
            Name or public key
          </label>
          <input
            ref={inputRef}
            aria-controls="observer-lookup-results"
            aria-expanded={popupOpen}
            autoComplete="off"
            className="lookup-input"
            id="observer-lookup-input"
            inputMode="text"
            placeholder="Name or public key…"
            spellCheck={false}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setFocused(true);
            }}
            onFocus={() => {
              if (input.trim().length >= 2) setFocused(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setFocused(false);
              } else if (event.key === "ArrowDown" && matches.length > 0) {
                event.preventDefault();
                resultRefs.current[0]?.focus();
              }
            }}
          />
          {popupOpen ? (
            <div
              aria-label="Observer search results"
              className="lookup-results"
              id="observer-lookup-results"
              role="region"
            >
              <div className="lookup-results-header">
                <strong>
                  {matches.length === 1
                    ? "1 observer"
                    : `${numberFormat.format(matches.length)} observers`}
                </strong>
                <span>Select to view details</span>
              </div>
              {matches.length > 0 ? (
                <div className="lookup-results-list">
                  {matches.map(({ observer }, index) => (
                    <button
                      ref={(element) => {
                        resultRefs.current[index] = element;
                      }}
                      key={observer.publicKey}
                      className="lookup-result-row"
                      type="button"
                      onClick={() => {
                        onOpenObserver(observer);
                        setInput("");
                        setFocused(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setFocused(false);
                          inputRef.current?.focus();
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          resultRefs.current[
                            Math.min(index + 1, matches.length - 1)
                          ]?.focus();
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          if (index === 0) {
                            inputRef.current?.focus();
                          } else {
                            resultRefs.current[index - 1]?.focus();
                          }
                        }
                      }}
                    >
                      <span className="lookup-result-label">
                        {observer.label || shortKey(observer.publicKey)}
                      </span>
                      {observer.region ? (
                        <span className="lookup-result-region">
                          <RegionDisplay
                            regionLookup={regionLookup}
                            region={observer.region}
                          />
                        </span>
                      ) : null}
                      <span className="lookup-result-key">
                        {shortKey(observer.publicKey)}
                      </span>
                      {observer.abuse ? (
                        <StatusLabel tone="red">Blocked</StatusLabel>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="lookup-no-results">
                  No observers match this name or public key.
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function TopObserversTable({
  observers,
  regionLookup,
  onSelect,
}: {
  observers: DashboardObserver[];
  regionLookup?: RegionLookup;
  onSelect: (observer: DashboardObserver) => void;
}) {
  const top10 = useMemo(() => {
    return [...observers]
      .filter((o) => o.messageCount > 0)
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 10);
  }, [observers]);

  if (top10.length === 0)
    return <Empty>No active observers with messages yet.</Empty>;

  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Observer</th>
          <th>Region</th>
          <th>Messages</th>
          <th>Last seen</th>
        </tr>
      </thead>
      <tbody>
        {top10.map((observer, index) => (
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
            <td data-label="#">{index + 1}</td>
            <td className="primary-cell" data-label="Observer">
              <span className="cell-value">
                {observer.label || shortKey(observer.publicKey)}
              </span>
            </td>
            <td data-label="Region">
              {observer.region ? (
                <RegionDisplay
                  regionLookup={regionLookup}
                  region={observer.region}
                />
              ) : (
                <span className="cell-value">-</span>
              )}
            </td>
            <td data-label="Messages">
              {numberFormat.format(observer.messageCount)}
            </td>
            <td data-label="Last seen">
              {stockholmShortTime(observer.lastSeenAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ObserverSearch({
  query,
  setQuery,
  regions,
  selectedRegion,
  setSelectedRegion,
  regionLookup,
}: {
  query: string;
  setQuery: (value: string) => void;
  regions: string[];
  selectedRegion: string;
  setSelectedRegion: (value: string) => void;
  regionLookup?: RegionLookup;
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
              {formatRegionOptionLabel(region, regionLookup)}
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
  regionLookup,
}: {
  observers: DashboardObserver[];
  onSelect: (observer: DashboardObserver) => void;
  activeOnly?: boolean;
  regionLookup?: RegionLookup;
}) {
  const { sortField, sortDir, toggle } = useTableSort("label");
  const visibleObservers = useMemo(() => {
    const getters: Record<string, (o: DashboardObserver) => string | number> = {
      label: (o) => o.label || o.publicKey,
      region: (o) => o.region || "",
      lastConnectedAt: (o) => o.lastConnectedAt,
      lastSeenAt: (o) => o.lastSeenAt,
      blocked: (o) => (o.abuse ? 1 : 0),
    };
    const filtered = activeOnly
      ? observers.filter((observer) => observer.active)
      : observers;
    return sortData(filtered, sortField, sortDir, getters);
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
          <th aria-label="Reports neighbors">Neighbors</th>
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
              <td data-label="Region">
                {observer.region ? (
                  <RegionDisplay
                    regionLookup={regionLookup}
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
              <td
                aria-label={
                  observer.neighbors
                    ? "Observer reports neighbors"
                    : "Observer does not report neighbors"
                }
                data-label="Neighbors"
              >
                {observer.neighbors ? "Reported" : "None"}
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
  regionLookup,
  onClose,
}: {
  observer: DashboardObserver;
  regionLookup?: RegionLookup;
  onClose: () => void;
}) {
  const statusTone = observerStatusTone(observer);
  const facts: ModalFactItem[] = [
    {
      label: "Connection",
      value: (
        <StatusLabel tone={statusTone ? "green" : "gray"}>
          {observerStatusText(statusTone)}
        </StatusLabel>
      ),
      note: `Last connected ${stockholmEventTime(observer.lastConnectedAt)}`,
    },
    {
      label: "Region",
      value: observer.region ? (
        <RegionDisplay regionLookup={regionLookup} region={observer.region} />
      ) : (
        "Not reported"
      ),
    },
    {
      label: "Recorded messages",
      value: numberFormat.format(observer.messageCount),
    },
    {
      label: "Last message",
      value:
        observer.messageCount > 0
          ? stockholmEventTime(observer.lastSeenAt)
          : "No messages yet",
    },
  ];

  return (
    <DetailDialog
      columns="four"
      facts={facts}
      size="wide"
      summaryLabel="Observer summary"
      subtitle={
        <code className="modal-key" title={observer.publicKey}>
          {observer.publicKey}
        </code>
      }
      title={observer.label || shortKey(observer.publicKey)}
      titleId="observer-dialog-title"
      onClose={onClose}
    >
      {!observer.abuse || !observer.neighbors ? (
        <div
          aria-label="Observer data availability"
          className="modal-availability"
        >
          {!observer.abuse ? (
            <div>
              <span className="modal-availability-copy">
                <strong>Protection</strong>
                <span>No protection events have been recorded.</span>
              </span>
              <StatusLabel tone="gray">No events</StatusLabel>
            </div>
          ) : null}
          {!observer.neighbors ? (
            <div>
              <span className="modal-availability-copy">
                <strong>Neighbor report</strong>
                <span>
                  No <code>/neighbors</code> report has been received.
                </span>
              </span>
              <StatusLabel tone="gray">Not received</StatusLabel>
            </div>
          ) : null}
        </div>
      ) : null}
      {observer.abuse ? (
        <ModalSection
          meta={
            <StatusLabel tone={denialStatusTone(observer.abuse.status)}>
              {denialStatusLabel(observer.abuse.status)}
            </StatusLabel>
          }
          title="Protection event"
        >
          <ModalRecord
            items={[
              {
                label: "Reason",
                value: formatPublicMuteReason(observer.abuse.reason),
              },
              {
                label: "Action / expiry",
                value: deniedUntilLabel(observer.abuse),
              },
            ]}
          />
        </ModalSection>
      ) : null}
      {observer.neighbors ? (
        <ModalSection
          meta={`${numberFormat.format(observer.neighbors.neighbors.length)} entries`}
          title="Latest neighbor report"
        >
          <NeighborSnapshot snapshot={observer.neighbors} />
        </ModalSection>
      ) : null}
      <ModalSection
        meta={`${numberFormat.format(observer.messages.length)} shown`}
        title="Recent messages"
      >
        <MessageTable
          regionLookup={regionLookup}
          messages={observer.messages}
        />
      </ModalSection>
    </DetailDialog>
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
      <ModalFacts columns="three">
        <ModalFact label="Received">
          {age(Date.now() - snapshot.receivedAt)}
        </ModalFact>
        <ModalFact label="Firmware timestamp">
          {optionalStockholmTime(snapshot.reportedAt)}
        </ModalFact>
        <ModalFact label="Query result">
          <span className="modal-fact-detail">
            {numberFormat.format(responded)} responded ·{" "}
            {numberFormat.format(timedOut)} timed out
            {sendFailed > 0
              ? ` · ${numberFormat.format(sendFailed)} send failed`
              : ""}
          </span>
        </ModalFact>
      </ModalFacts>
      <ModalRecord
        compact
        items={[
          {
            label: "Observer scopes",
            value: (
              <span className="scope-list">
                {snapshot.selfScopes.length > 0
                  ? snapshot.selfScopes.join(", ")
                  : "None reported"}
              </span>
            ),
          },
          ...(snapshot.invalidEntryCount > 0
            ? [
                {
                  label: "Ignored entries",
                  value: `${numberFormat.format(snapshot.invalidEntryCount)} malformed, duplicate, or out-of-range entries`,
                },
              ]
            : []),
        ]}
      />

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
                  {neighbor.heardSecsAgo != null
                    ? age(neighbor.heardSecsAgo * 1000)
                    : "-"}
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

function MessageTable({
  messages,
  regionLookup,
}: {
  messages: ObserverMessage[];
  regionLookup?: RegionLookup;
}) {
  const { sortField, sortDir, toggle } = useTableSort("receivedAt", "desc");
  if (messages.length === 0)
    return <Empty>No messages have been recorded yet.</Empty>;
  const msgGetters: Record<string, (m: ObserverMessage) => string | number> = {
    receivedAt: (m) => m.receivedAt,
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
            <td data-label="Region">
              {message.region ? (
                <RegionDisplay
                  regionLookup={regionLookup}
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
  regionLookup,
}: {
  publishes: ObserverMessage[];
  regionLookup?: RegionLookup;
}) {
  const [expanded, setExpanded] = useState(false);
  const [previousKeys, setPreviousKeys] = useState<Set<string>>(new Set());
  const initialLimit = 8;
  const visiblePublishes = publishes.slice(0, expanded ? 50 : initialLimit);
  const currentKeys = useMemo(
    () => new Set(visiblePublishes.map(publishKey)),
    [visiblePublishes],
  );
  const newKeys = useMemo(() => {
    if (previousKeys.size === 0) {
      return new Set<string>();
    }
    return new Set(
      visiblePublishes.map(publishKey).filter((key) => !previousKeys.has(key)),
    );
  }, [visiblePublishes, previousKeys]);

  useEffect(() => {
    setPreviousKeys(currentKeys);
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
      </div>
      <span aria-atomic="true" className="sr-only" role="status">
        {newKeys.size > 0
          ? `${numberFormat.format(newKeys.size)} new ${newKeys.size === 1 ? "publish" : "publishes"}`
          : ""}
      </span>
      <div className="publish-feed">
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
                    regionLookup={regionLookup}
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
  regionLookup,
  onClose,
}: {
  ban: BanSummary;
  regionLookup?: RegionLookup;
  onClose: () => void;
}) {
  const facts: ModalFactItem[] = [
    {
      label: "Status",
      value: (
        <StatusLabel tone={denialStatusTone(ban.status)}>
          {denialStatusLabel(ban.status)}
        </StatusLabel>
      ),
    },
    {
      label: "Region",
      value: ban.region ? (
        <RegionDisplay regionLookup={regionLookup} region={ban.region} />
      ) : (
        "Not reported"
      ),
    },
    {
      label: "Last seen",
      value: ban.lastUpdatedAt
        ? stockholmEventTime(ban.lastUpdatedAt)
        : "Unknown",
    },
  ];

  return (
    <DetailDialog
      columns="three"
      facts={facts}
      size="md"
      summaryLabel="Protection event summary"
      subtitle={
        <code className="modal-key" title={ban.node}>
          {ban.node}
        </code>
      }
      title={ban.label || shortKey(ban.node)}
      titleId="ban-dialog-title"
      onClose={onClose}
    >
      <ModalSection title="Event details">
        <ModalRecord
          items={[
            {
              label: "Reason",
              value: formatPublicMuteReason(ban.reason),
            },
            { label: "Action / expiry", value: deniedUntilLabel(ban) },
            ...(ban.topic
              ? [
                  {
                    label: "MQTT topic",
                    value: (
                      <code className="topic-code" title={ban.topic}>
                        {ban.topic}
                      </code>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </ModalSection>
    </DetailDialog>
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
            aria-label={`Protection event for ${ban.label || ban.node}`}
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
    subscriptionsStr: (s) => s.subscriptions.join(", "),
    connectionCount: (s) => s.connectionCount,
    lastSeenAt: (s) => (s.lastSeenAt > 0 ? s.lastSeenAt : 0),
  };

  if (snapshotError) {
    return <Empty>Subscriber data could not be loaded.</Empty>;
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
            aria-label={`Subscriber ${sub.username}`}
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
  const facts: ModalFactItem[] = [
    {
      label: "Active connections",
      value: numberFormat.format(sub.connectionCount),
    },
    {
      label: "Topic filters",
      value: `${numberFormat.format(sub.subscriptions.length)}${sub.subscriptionsTruncated ? "+" : ""}`,
    },
    {
      label: "Last active",
      value:
        sub.lastSeenAt > 0 ? stockholmEventTime(sub.lastSeenAt) : "Unknown",
    },
  ];

  return (
    <DetailDialog
      columns="three"
      facts={facts}
      size="lg"
      summaryLabel="Subscriber summary"
      subtitle="Subscriber connection details"
      title={sub.username}
      titleId="subscriber-dialog-title"
      onClose={onClose}
    >
      <ModalSection title="Subscribed topic filters">
        <SubscriptionList
          topics={sub.subscriptions}
          truncated={sub.subscriptionsTruncated}
        />
      </ModalSection>
      <ModalSection
        meta={`${numberFormat.format(sub.connections.length)} active`}
        title="Connections"
      >
        {sub.connections.length === 0 ? (
          <Empty>No connection details are available.</Empty>
        ) : (
          <div className="subscriber-connection-list">
            {sub.connections.map((connection, index) => (
              <article
                key={`${connection.brokerId}-${connection.clientId}-${index}`}
                className="subscriber-connection"
              >
                <header>
                  <strong>{connection.clientId}</strong>
                  <span>{stockholmShortTime(connection.lastSeenAt)}</span>
                </header>
                <SubscriptionList
                  topics={connection.subscriptions}
                  truncated={connection.subscriptionsTruncated}
                />
              </article>
            ))}
          </div>
        )}
      </ModalSection>
    </DetailDialog>
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

const pageCopy: Record<View, { title: string; description: string }> = {
  overview: {
    title: "Overview",
    description:
      "Current health, traffic, and protection status for this broker.",
  },
  observers: {
    title: "Observers",
    description:
      "Search connected observers, inspect regions, and review recent activity.",
  },
  meshcoreio: {
    title: "MeshCore.io",
    description:
      "Durable upload queue, workers, and recent MeshCore.io advert activity.",
  },
  bans: {
    title: "Protection",
    description: "Review denied publishes and active mutes.",
  },
  subscribers: {
    title: "Subscribers",
    description: "Active subscriber connections and topic filters.",
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
  const [themePreference, setThemePreference] = useState<Theme | null>(
    getStoredTheme,
  );
  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemTheme);
  const theme = themePreference ?? systemTheme;
  const sidebarRef = useRef<HTMLElement>(null);
  const [selectedObserver, _setSelectedObserver] =
    useState<DashboardObserver | null>(null);
  const [selectedBan, _setSelectedBan] = useState<BanSummary | null>(null);
  const [selectedSubscriber, _setSelectedSubscriber] =
    useState<SubscriberConnectionEntry | null>(null);
  const selectedObserverKey = useRef<string | null>(
    initialHash.observer || null,
  );
  const selectedBanKey = useRef<string | null>(initialHash.ban || null);
  const [hashTick, setHashTick] = useState(0);

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

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    setThemePreference(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The in-memory preference still works when storage is unavailable.
    }
  }

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

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
      setHashTick((t) => t + 1);
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
            "Dashboard data could not be read from local storage. Retrying automatically.",
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
          "The dashboard API could not be reached. Retrying automatically.",
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
      return;
    }
  }, [selectedObserver, snapshot, hashTick]);

  const hasSnapshot = snapshot !== null && snapshot.error === undefined;
  const date = hasSnapshot ? new Date(snapshot.generatedAt) : null;
  const summary = useMemo(
    () =>
      snapshot?.summary ?? {
        connectedClients: 0,
        connectedObservers: 0,
        activeBrokers: 0,
        totalBrokers: 0,
        messagesPerSecond: 0,
        publishesLastMinute: 0,
        activeBans: 0,
        blockedObservers: 0,
        protectionEventsShown: 0,
        protectionEventsTruncated: false,
        protectionEventsTotal: 0,
      },
    [snapshot?.summary],
  );
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
      return;
    }
  }, [selectedBan, allBans, hashTick]);

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
    if (selectedBan) {
      const updated = allBans.find((b) => b.node === selectedBan.node);
      if (updated) {
        setSelectedBan(updated);
      }
    }
  }, [allBans, selectedBan]);

  const navItems: Array<{ view: View; label: string; icon: string }> = [
    { view: "overview", label: "Overview", icon: MDI.homeOutline },
    { view: "observers", label: "Observers", icon: MDI.accountGroup },
    { view: "meshcoreio", label: "MeshCore.io", icon: MDI.cloudUpload },
    { view: "bans", label: "Protection", icon: MDI.shieldOutline },
    {
      view: "subscribers",
      label: "Subscribers",
      icon: MDI.accessPointNetwork,
    },
  ];
  const isLoading = snapshot === null && refreshError === null;
  const showingStaleData =
    refreshError !== null && snapshot !== null && snapshot.error === undefined;

  const page = useMemo(() => {
    if (view === "observers") {
      return (
        <Panel
          subtitle="Search observers and inspect connectivity, recent messages, and protection events."
          title="Observer directory"
        >
          <ObserverSearch
            regionLookup={snapshot?.regionLookup}
            query={query}
            regions={observerRegions}
            selectedRegion={regionFilter}
            setQuery={setQuery}
            setSelectedRegion={setRegionFilter}
          />
          <ObserverTable
            regionLookup={snapshot?.regionLookup}
            observers={filteredObservers}
            onSelect={setSelectedObserver}
          />
        </Panel>
      );
    }
    if (view === "meshcoreio") {
      return (
        <MeshcoreIoView
          generatedAt={snapshot?.generatedAt}
          state={meshcoreIo}
          theme={theme}
        />
      );
    }
    if (view === "bans") {
      return (
        <Panel
          subtitle={
            summary.protectionEventsTruncated
              ? "Showing the 50 most recent denied publishes and active mutes retained for review."
              : "Denied publishes and active mutes retained for review."
          }
          title="Protection events"
        >
          <BanTable bans={allBans} onSelect={setSelectedBan} />
        </Panel>
      );
    }
    if (view === "subscribers") {
      return (
        <Panel
          subtitle="Active subscriber connections to this broker."
          title="Active connections"
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
          regionLookup={snapshot?.regionLookup}
          observers={observers}
          onOpenObserver={setSelectedObserver}
        />
        <section
          aria-label="Broker metrics"
          className="metrics overview-metrics"
        >
          <MetricItem
            icon={MDI.accountGroup}
            id="clients"
            label="Connected observers"
            note="Active now"
            value={numberFormat.format(summary.connectedObservers)}
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
            label="Blocked observers"
            note="Distinct auth/publish rejection in 24h or active mute"
            value={numberFormat.format(summary.blockedObservers)}
          />
        </section>
        <section className="grid">
          <Panel
            className="span-2"
            subtitle="Observers with the most recorded messages."
            title="Most active observers"
          >
            <TopObserversTable
              regionLookup={snapshot?.regionLookup}
              observers={observers}
              onSelect={setSelectedObserver}
            />
          </Panel>
          <MeshcoreIoView
            compact
            generatedAt={snapshot?.generatedAt}
            state={meshcoreIo}
            theme={theme}
          />
          <Panel
            className="span-2"
            subtitle={
              allBans.length > overviewBans.length ||
              summary.protectionEventsTruncated
                ? `Showing the ${numberFormat.format(overviewBans.length)} most recent denied publishes and active mutes.`
                : "Recent denied publishes and active mutes."
            }
            title="Recent protection events"
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
              regionLookup={snapshot?.regionLookup}
              publishes={recentPublishes}
            />
          </Panel>
        </section>
      </>
    );
  }, [
    allBans,
    filteredObservers,
    meshcoreIo,
    observerRegions,
    observers,
    overviewBans,
    query,
    recentPublishes,
    regionFilter,
    snapshot?.regionLookup,
    snapshot?.error,
    snapshot?.generatedAt,
    snapshot?.subscribers,
    summary,
    theme,
    view,
  ]);

  const currentPage = pageCopy[view];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to dashboard content
      </a>
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
          <BrandIdentity onActivate={() => setNavOpen(false)} />
          <button
            aria-label="Close menu"
            className="icon-button drawer-close"
            type="button"
            onClick={() => setNavOpen(false)}
          >
            <Icon path={MDI.close} />
          </button>
        </div>
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
                <span className="desktop-title">
                  {dashboardConfig.branding.dashboardTitle}
                </span>
                <span className="mobile-title">
                  {dashboardConfig.branding.dashboardTitle}
                </span>
              </strong>
              <span>{dashboardConfig.branding.dashboardSubtitle}</span>
            </div>
          </div>
          <div className="top-actions">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <div className="snapshot-time">
              <div className="snapshot-labels">
                <span>Updated</span>
                <small>
                  {date ? headerDateFormat.format(date) : "Waiting"}
                </small>
              </div>
              <strong>{date ? headerTimeFormat.format(date) : "-"}</strong>
            </div>
          </div>
        </header>
        <main className="main-content" id="main-content" tabIndex={-1}>
          <div className="content-container">
            <header className="page-heading">
              <div>
                <h1>{currentPage.title}</h1>
                <p>{currentPage.description}</p>
              </div>
            </header>
            {isLoading ? (
              <div className="dashboard-notice loading" role="status">
                <Icon path={MDI.pulse} />
                <div>
                  <strong>Loading dashboard data</strong>
                  <span>Waiting for the first broker snapshot.</span>
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
            {hasSnapshot ? page : null}
          </div>
        </main>
        {selectedObserver ? (
          <ObserverModal
            regionLookup={snapshot?.regionLookup}
            observer={selectedObserver}
            onClose={() => setSelectedObserver(null)}
          />
        ) : null}
        {selectedBan ? (
          <BanModal
            ban={selectedBan}
            regionLookup={snapshot?.regionLookup}
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

createRoot(document.getElementById("root")!).render(<App />);
