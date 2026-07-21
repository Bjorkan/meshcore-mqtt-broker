/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- Astryx theme conditional exports are typed by TypeScript but not resolved by the ESLint project service. */
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid, GridSpan } from "@astryxdesign/core/Grid";
import { Icon as AstryxIcon } from "@astryxdesign/core/Icon";
import { Item } from "@astryxdesign/core/Item";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import {
  MetadataList,
  MetadataListItem,
} from "@astryxdesign/core/MetadataList";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { Overlay } from "@astryxdesign/core/Overlay";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import {
  SideNav,
  SideNavItem,
  SideNavSection,
} from "@astryxdesign/core/SideNav";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Stack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@astryxdesign/core/Table";
import { Text, Heading } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { MediaTheme, Theme, defineTheme } from "@astryxdesign/core/theme";
import { Token } from "@astryxdesign/core/Token";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { Logger } from "tslog";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

const meshatTheme = defineTheme({
  name: "meshat-operations",
  tokens: {
    "--color-accent": ["#087a55", "#6de2ae"],
    "--color-accent-muted": ["#d7f3e6", "#174b37"],
    "--color-background-body": ["#f5f8f6", "#0d1310"],
    "--color-background-surface": ["#ffffff", "#151c18"],
    "--color-background-card": ["#ffffff", "#19211c"],
    "--color-background-muted": ["#edf3ef", "#202a24"],
    "--color-background-popover": ["#ffffff", "#202a24"],
    "--color-text-primary": ["#142019", "#e8f0eb"],
    "--color-text-secondary": ["#526159", "#aebdb4"],
    "--color-border": ["#d9e2dc", "#344239"],
    "--color-border-emphasized": ["#aebdb4", "#617168"],
    "--color-success": ["#087a55", "#6de2ae"],
    "--color-success-muted": ["#d7f3e6", "#174b37"],
    "--color-warning": ["#9b6500", "#f2bd66"],
    "--color-warning-muted": ["#fff0ce", "#503a11"],
    "--color-error": ["#b42318", "#ffb4ab"],
    "--color-error-muted": ["#fee4e2", "#55201d"],
    "--radius-page": "18px",
    "--radius-container": "14px",
    "--radius-element": "9px",
  },
});

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
  function MdiIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
      <svg {...props} aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d={path} fill="currentColor" />
      </svg>
    );
  }

  return <AstryxIcon icon={MdiIcon} />;
}

function BrandMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <g
        fill="none"
        stroke="currentColor"
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

function Brand() {
  return <NavIcon icon={<AstryxIcon icon={BrandMark} size="lg" />} />;
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
  status,
  children,
  onClose,
  size = "md",
}: {
  titleId: string;
  title: string;
  subtitle?: string;
  status?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "wide";
}) {
  const width = {
    sm: 560,
    md: 720,
    lg: 900,
    wide: 1080,
  }[size];

  return (
    <Dialog
      isOpen
      aria-label={titleId}
      maxHeight="88dvh"
      purpose="info"
      width={width}
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) onClose();
      }}
    >
      <Layout
        content={
          <LayoutContent padding={5}>
            <Stack gap={6}>{children}</Stack>
          </LayoutContent>
        }
        header={
          <DialogHeader
            endContent={status}
            subtitle={subtitle}
            title={title}
            onOpenChange={(isOpen: boolean) => {
              if (!isOpen) onClose();
            }}
          />
        }
      />
    </Dialog>
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
    <TableHeaderCell
      aria-sort={
        active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <Button
        className="sort-button"
        icon={
          <AstryxIcon
            icon={
              active
                ? sortDir === "asc"
                  ? "arrowUp"
                  : "arrowDown"
                : "arrowsUpDown"
            }
            size="xsm"
          />
        }
        label={label}
        size="sm"
        variant="ghost"
        onClick={() => onToggle(field)}
      />
    </TableHeaderCell>
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
  const variant = {
    green: "success",
    orange: "warning",
    red: "error",
    gray: "neutral",
  }[tone] as "success" | "warning" | "error" | "neutral";
  const label = typeof children === "string" ? children : "Status";

  return (
    <Stack direction="horizontal" gap={2} vAlign="center">
      <StatusDot label={label} variant={variant} />
      <Text aria-hidden="true" type="supporting" weight="medium">
        {children}
      </Text>
    </Stack>
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
  if (!formatted) return <Text as="span">-</Text>;
  if (!formatted.countyName) return <Text as="span">{formatted.code}</Text>;
  return (
    <Stack as="span" gap={0}>
      <Text as="span" weight="medium">
        {formatted.countyName}
      </Text>
      <Text as="span" color="secondary" type="supporting">
        {formatted.code}
      </Text>
    </Stack>
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
    <Card id={id} minHeight={120} padding={3}>
      <Stack direction="horizontal" gap={4} vAlign="start">
        <Stack aria-hidden="true">
          <Icon path={icon} />
        </Stack>
        <Stack gap={1}>
          <Text color="secondary" type="supporting">
            {label}
          </Text>
          <Text
            hasTabularNumbers={!textualValue}
            maxLines={textualValue ? 1 : 0}
            title={textualValue ? value : undefined}
            type="large"
            weight="bold"
          >
            {value}
          </Text>
          <Text color="secondary" type="supporting">
            {note}
          </Text>
        </Stack>
      </Stack>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Section padding={4} variant="muted">
      {typeof children === "string" ? (
        <EmptyState isCompact headingLevel={3} title={children} />
      ) : (
        <Stack hAlign="center">
          <Text as="div" color="secondary" type="supporting">
            {children}
          </Text>
        </Stack>
      )}
    </Section>
  );
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
  reduceMotion = false,
): void {
  if (adverts.length === 0) return;

  if (adverts.length === 1) {
    map.flyTo({
      center: [adverts[0].longitude, adverts[0].latitude],
      zoom: 11,
      duration: reduceMotion ? 0 : 450,
      essential: false,
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
    duration: reduceMotion ? 0 : 450,
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
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
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
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) =>
      setReduceMotion(event.matches);
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
      fitMeshcoreMap(map, sortedAdverts, reduceMotion);
      initiallyFittedRef.current = true;
    }
  }, [mapReady, reduceMotion, sortedAdverts]);

  function focusAdvert(advert: MeshcoreIoMapAdvert): void {
    setSelectedKey(mapAdvertKey(advert));
    mapRef.current?.flyTo({
      center: [advert.longitude, advert.latitude],
      zoom: 12,
      duration: reduceMotion ? 0 : 450,
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
    <Grid className="meshcoreio-map-layout">
      <Stack className="meshcoreio-map-column" gap={0}>
        <Overlay
          align="start"
          content={
            <Button
              icon={<Icon path={MDI.crosshairsGps} />}
              label="Fit adverts"
              size="sm"
              variant="secondary"
              onClick={() => {
                if (mapRef.current) {
                  fitMeshcoreMap(mapRef.current, sortedAdverts, reduceMotion);
                }
              }}
            />
          }
          position="top"
          scrim={false}
        >
          <Overlay
            align="start"
            content={
              <MediaTheme mode="dark">
                <Stack
                  aria-label="Map marker legend"
                  direction="horizontal"
                  gap={3}
                >
                  <Stack
                    as="span"
                    direction="horizontal"
                    gap={1}
                    vAlign="center"
                  >
                    <i className="meshcoreio-map-dot repeater" />
                    <Text as="span" type="supporting">
                      Repeater
                    </Text>
                  </Stack>
                  <Stack
                    as="span"
                    direction="horizontal"
                    gap={1}
                    vAlign="center"
                  >
                    <i className="meshcoreio-map-dot room" />
                    <Text as="span" type="supporting">
                      Room
                    </Text>
                  </Stack>
                  <Stack
                    as="span"
                    direction="horizontal"
                    gap={1}
                    vAlign="center"
                  >
                    <i className="meshcoreio-map-dot sensor" />
                    <Text as="span" type="supporting">
                      Sensor
                    </Text>
                  </Stack>
                </Stack>
              </MediaTheme>
            }
            position="bottom"
            scrim="dark"
          >
            <div
              ref={mapContainerRef}
              aria-label={`Map showing ${numberFormat.format(sortedAdverts.length)} MeshCore.io nodes`}
              className="meshcoreio-map-canvas"
            />
          </Overlay>
        </Overlay>
        {mapUnavailable ? (
          <Banner
            container="section"
            description="Node details remain available in the list."
            status="warning"
            title="The interactive map is unavailable in this browser"
          />
        ) : null}
        {selectedAdvert ? (
          <Item
            aria-live="polite"
            className="meshcoreio-map-selection"
            description={
              <Stack gap={0}>
                <Text color="secondary" type="supporting">
                  {selectedAdvert.advertType} ·{" "}
                  {selectedAdvert.latitude.toFixed(5)},{" "}
                  {selectedAdvert.longitude.toFixed(5)}
                </Text>
                <Text color="secondary" type="supporting">
                  Added {stockholmEventTime(selectedAdvert.at)} by{" "}
                  {selectedAdvert.workerInstanceId}
                </Text>
              </Stack>
            }
            label={selectedAdvert.nodeName}
            startContent={<Icon path={MDI.mapMarker} />}
          />
        ) : null}
      </Stack>
      <List
        hasDividers
        className="meshcoreio-map-list"
        density="compact"
        header="Mapped adverts"
      >
        {sortedAdverts.map((advert) => {
          const key = mapAdvertKey(advert);
          const selected = key === selectedKey;
          return (
            <ListItem
              key={key}
              description={advert.observerName || "Observer unknown"}
              endContent={
                <Stack gap={0} hAlign="end">
                  <Text type="supporting" weight="medium">
                    {advert.advertType}
                  </Text>
                  <Text color="secondary" type="supporting">
                    {stockholmEventTime(advert.at)}
                  </Text>
                </Stack>
              }
              isSelected={selected}
              label={advert.nodeName}
              startContent={
                <span
                  className={`meshcoreio-map-dot ${advert.advertType.toLowerCase()}`}
                />
              }
              onClick={() => focusAdvert(advert)}
            />
          );
        })}
      </List>
    </Grid>
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
    const content = (
      <Panel
        subtitle="Enable this integration under meshcore_io in config.yaml."
        title="MeshCore.io"
      >
        <Empty>The MeshCore.io integration is disabled.</Empty>
      </Panel>
    );
    return compact ? <GridSpan columns="full">{content}</GridSpan> : content;
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
      <GridSpan columns="full">
        <Panel
          className="meshcoreio-panel meshcoreio-panel-compact"
          subtitle="Shared queue health and distributed upload workers."
          title="MeshCore.io"
        >
          <Grid
            aria-label="MeshCore.io overview"
            className="metrics meshcoreio-metrics meshcoreio-metrics-compact"
            columns={{ minWidth: 144, max: 4, repeat: "fit" }}
            gap={4}
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
          </Grid>
          <Stack hAlign="end" padding={4}>
            <Button
              label="View queue and workers"
              variant="ghost"
              onClick={() => {
                window.location.hash = "meshcoreio";
              }}
            />
          </Stack>
        </Panel>
      </GridSpan>
    );
  }

  return (
    <Panel
      className="meshcoreio-panel"
      subtitle="One broker coordinates intake while every healthy broker can drain the persistent Valkey queue."
      title="MeshCore.io"
    >
      <Grid
        aria-label="MeshCore.io metrics"
        className="metrics meshcoreio-metrics"
        columns={{ minWidth: 144, max: 4, repeat: "fit" }}
        gap={4}
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
      </Grid>

      <MetadataList columns="multi">
        <MetadataListItem label="Coordinator status">
          <StatusLabel tone={meshcoreIoProducerTone(state.producer.status)}>
            {meshcoreIoProducerLabel(state.producer.status)}
          </StatusLabel>
        </MetadataListItem>
        <MetadataListItem label="Queue capacity">
          {numberFormat.format(state.queue.total)} /{" "}
          {numberFormat.format(state.queue.maxQueuedUploads)}
        </MetadataListItem>
        <MetadataListItem label="Cluster adverts enqueued">
          {numberFormat.format(state.totals.enqueued)}
        </MetadataListItem>
        <MetadataListItem label="Cluster invalid adverts">
          {numberFormat.format(state.totals.invalid)}
        </MetadataListItem>
      </MetadataList>

      {state.lastError ? (
        <Banner
          container="section"
          description={state.lastError}
          status="error"
          title="Latest MeshCore.io error"
        />
      ) : null}

      <Section
        aria-labelledby="meshcoreio-map-title"
        className="meshcoreio-map-section"
        padding={0}
      >
        <Stack
          direction="horizontal"
          gap={4}
          hAlign="between"
          padding={4}
          vAlign="center"
        >
          <Stack gap={1}>
            <Heading id="meshcoreio-map-title" level={3}>
              Advert map
            </Heading>
            <Text color="secondary" type="supporting">
              Latest position for every advert accepted by MeshCore.io during
              the last seven days.
            </Text>
          </Stack>
          <Badge
            label={`${numberFormat.format(state.map?.advertsLast7Days.length ?? 0)} nodes`}
          />
        </Stack>
        <MeshcoreIoAdvertMap adverts={state.map?.advertsLast7Days ?? []} />
      </Section>

      <Stack paddingInline={4}>
        <Heading level={3}>Broker workers</Heading>
      </Stack>
      {state.workers.length === 0 ? (
        <Empty>No broker workers have reported yet.</Empty>
      ) : (
        <Table hasHover density="compact" dividers="rows">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Broker</TableHeaderCell>
              <TableHeaderCell>Workers</TableHeaderCell>
              <TableHeaderCell>Active</TableHeaderCell>
              <TableHeaderCell>Uploaded since start</TableHeaderCell>
              <TableHeaderCell>Failed since start</TableHeaderCell>
              <TableHeaderCell>Last upload</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.workers.map((worker) => (
              <TableRow key={worker.instanceId}>
                <TableCell className="primary-cell" data-label="Broker">
                  <span className="cell-value">{worker.instanceId}</span>
                </TableCell>
                <TableCell data-label="Upload workers">
                  {numberFormat.format(worker.configuredWorkers)}
                </TableCell>
                <TableCell data-label="Active">
                  {numberFormat.format(worker.activeUploads)}
                </TableCell>
                <TableCell data-label="Uploaded since broker start">
                  {numberFormat.format(worker.uploadsSucceeded)}
                </TableCell>
                <TableCell data-label="Failed since broker start">
                  {numberFormat.format(worker.uploadsFailed)}
                </TableCell>
                <TableCell data-label="Last upload">
                  {worker.lastUploadAt
                    ? optionalStockholmShortTime(worker.lastUploadAt)
                    : age(Date.now() - worker.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Stack paddingInline={4}>
        <Heading level={3}>Recent uploads</Heading>
      </Stack>
      {state.history.length === 0 ? (
        <Empty>No adverts have completed yet.</Empty>
      ) : (
        <Table hasHover density="compact" dividers="rows">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Time</TableHeaderCell>
              <TableHeaderCell>Node</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Broker</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.history.map((entry) => (
              <TableRow key={`${entry.requestId}-${entry.at}`}>
                <TableCell data-label="Time">
                  {stockholmShortTime(entry.at)}
                </TableCell>
                <TableCell className="primary-cell" data-label="Node">
                  <span className="primary-stack">
                    <span className="cell-value">{entry.nodeName}</span>
                    <span className="cell-note">
                      {entry.nodePublicKey.slice(0, 10)}
                    </span>
                  </span>
                </TableCell>
                <TableCell data-label="Type">{entry.advertType}</TableCell>
                <TableCell data-label="Broker">
                  {entry.workerInstanceId}
                </TableCell>
                <TableCell data-label="Status">
                  <StatusLabel
                    tone={entry.status === "uploaded" ? "green" : "red"}
                  >
                    {entry.status === "uploaded" ? "Uploaded" : "Dropped"}
                  </StatusLabel>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
      <Section padding={4} variant="muted">
        <Stack direction="horizontal" hAlign="between" vAlign="center">
          <StatusLabel tone="green">Known</StatusLabel>
          {onOpenObserver ? (
            <Button
              label="View details"
              size="sm"
              variant="ghost"
              onClick={() => onOpenObserver(observerFromLookupResult(result))}
            />
          ) : null}
        </Stack>
        <MetadataList>
          <MetadataListItem label="Observer">
            {o.name || o.shortKey}
          </MetadataListItem>
          {o.name ? (
            <MetadataListItem label="Public key">{o.shortKey}</MetadataListItem>
          ) : null}
          {o.region ? (
            <MetadataListItem label="Region">
              <RegionDisplay countyLookup={countyLookup} region={o.region} />
            </MetadataListItem>
          ) : null}
          {o.brokerId ? (
            <MetadataListItem label="Broker instance">
              {o.brokerId}
            </MetadataListItem>
          ) : null}
          {o.lastSeen ? (
            <MetadataListItem label="Last seen">
              {stockholmShortTime(o.lastSeen)}
            </MetadataListItem>
          ) : null}
        </MetadataList>
      </Section>
    );
  }

  if (isBlockedResult(result)) {
    const o = result.observer;
    const b = result.block;
    return (
      <Section padding={4} variant="muted">
        <Stack direction="horizontal" hAlign="between" vAlign="center">
          <StatusLabel tone="red">Blocked</StatusLabel>
          {onOpenObserver ? (
            <Button
              label="View details"
              size="sm"
              variant="ghost"
              onClick={() => onOpenObserver(observerFromLookupResult(result))}
            />
          ) : null}
        </Stack>
        <MetadataList>
          <MetadataListItem label="Observer">
            {o.name || o.shortKey}
          </MetadataListItem>
          {o.name ? (
            <MetadataListItem label="Public key">{o.shortKey}</MetadataListItem>
          ) : null}
          <MetadataListItem label="Reason">{b.reason}</MetadataListItem>
          {b.deniedUntilText || b.mutedUntil ? (
            <MetadataListItem label="Action / expiry">
              {deniedUntilLabel({
                status: "muted",
                deniedUntilText: b.deniedUntilText,
                mutedUntil: b.mutedUntil,
              })}
            </MetadataListItem>
          ) : null}
          {b.region ? (
            <MetadataListItem label="Region">
              <RegionDisplay countyLookup={countyLookup} region={b.region} />
            </MetadataListItem>
          ) : null}
          {b.brokerId ? (
            <MetadataListItem label="Broker instance">
              {b.brokerId}
            </MetadataListItem>
          ) : null}
          {b.lastSeen ? (
            <MetadataListItem label="Last seen">
              {stockholmShortTime(b.lastSeen)}
            </MetadataListItem>
          ) : null}
        </MetadataList>
      </Section>
    );
  }

  if (isMessageResult(result)) {
    let label: string;
    if (result.status === "unknown") {
      label = "Unknown";
    } else if (result.status === "invalid") {
      label = "Invalid";
    } else {
      label = "Error";
    }
    return (
      <Banner
        container="section"
        description={result.message}
        status={
          result.status === "invalid"
            ? "warning"
            : result.status === "error"
              ? "error"
              : "info"
        }
        title={label}
      />
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
      subtitle="Enter an observer public key to check whether it is known or blocked."
      title="Check observer status"
    >
      <Grid columns={{ minWidth: 280, max: 2, repeat: "fit" }} gap={3}>
        <TextInput
          autoComplete="off"
          isDisabled={loading}
          label="Public key"
          placeholder="64 hexadecimal characters"
          value={input}
          width="100%"
          onChange={handleInput}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") void lookup();
          }}
        />
        <Button
          isDisabled={loading || !input.trim()}
          isLoading={loading}
          label="Check status"
          variant="primary"
          onClick={() => void lookup()}
        />
      </Grid>
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
    <Table hasHover density="compact" dividers="rows">
      <TableHeader>
        <TableRow>
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedBrokers.map((broker) => {
          return (
            <TableRow
              key={broker.instanceId}
              className="click-row"
              onClick={() => onSelect(broker)}
            >
              <TableCell className="primary-cell" data-label="Broker instance">
                <Stack gap={1}>
                  <Button
                    className="row-action"
                    label={broker.instanceId}
                    size="sm"
                    variant="ghost"
                    onClick={(event: React.MouseEvent) => {
                      event.stopPropagation();
                      onSelect(broker);
                    }}
                  />
                  <StatusLabel tone={brokerStatusLabelTone(broker)}>
                    {brokerStatusText(broker)}
                  </StatusLabel>
                </Stack>
              </TableCell>
              <TableCell data-label="Started">
                {optionalStockholmShortTime(broker.startedAt)}
              </TableCell>
              <TableCell data-label="Observers">
                {numberFormat.format(
                  broker.status === "healthy"
                    ? (broker.claimedObservers ?? broker.publisherClients)
                    : 0,
                )}
              </TableCell>
              <TableCell data-label="Publishes/min">
                {numberFormat.format(
                  broker.status === "healthy"
                    ? broker.messagesLastMinute || 0
                    : 0,
                )}
              </TableCell>
              <TableCell data-label="Uplink">
                {uplinkShortText(broker)}
              </TableCell>
              <TableCell data-label="Updated">
                {age(broker.lastUpdateAgeMs)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
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
    <Stack gap={4} padding={4}>
      {activeBrokers.map((broker) => {
        const observers = broker.claimedObservers ?? broker.publisherClients;
        const pct = total > 0 ? Math.round((observers / total) * 1000) / 10 : 0;
        return (
          <Stack key={broker.instanceId} gap={2}>
            <Stack
              direction="horizontal"
              gap={3}
              hAlign="between"
              vAlign="center"
            >
              <Stack gap={1}>
                <Text weight="semibold">{broker.instanceId}</Text>
                <StatusLabel tone={brokerStatusLabelTone(broker)}>
                  {brokerStatusText(broker)}
                </StatusLabel>
              </Stack>
              <Stack gap={0} hAlign="end">
                <Text hasTabularNumbers weight="bold">
                  {numberFormat.format(observers)}
                </Text>
                <Text hasTabularNumbers color="secondary" type="supporting">
                  {numberFormat.format(pct)}%
                </Text>
              </Stack>
            </Stack>
            <ProgressBar
              isLabelHidden
              label={`${broker.instanceId}: ${numberFormat.format(pct)} percent of observers`}
              max={100}
              value={pct}
              variant={broker.ready ? "success" : "warning"}
            />
          </Stack>
        );
      })}
      <Text color="secondary" type="supporting">
        {numberFormat.format(total)} connected observers distributed across{" "}
        {numberFormat.format(activeBrokers.length)} active broker instances.
      </Text>
    </Stack>
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
    <Grid columns={{ minWidth: 280, max: 2, repeat: "fit" }} gap={3}>
      <TextInput
        label="Search"
        placeholder="Search by observer, key, or region"
        startIcon={<Icon path={MDI.magnify} />}
        value={query}
        width="100%"
        onChange={setQuery}
      />
      <Selector
        hasClear
        label="Region"
        options={regions.map((region) => ({
          label: formatRegionOptionLabel(region, countyLookup),
          value: region,
        }))}
        placeholder="All regions"
        value={selectedRegion}
        onChange={(value: string | null) => setSelectedRegion(value ?? "")}
      />
    </Grid>
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
    <Table hasHover density="compact" dividers="rows">
      <TableHeader>
        <TableRow>
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {visibleObservers.map((observer) => {
          const statusTone = observerStatusTone(observer);
          return (
            <TableRow
              key={observer.publicKey}
              className="click-row"
              onClick={() => onSelect(observer)}
            >
              <TableCell className="primary-cell" data-label="Observer">
                <Stack gap={1}>
                  <Button
                    className="row-action"
                    label={observer.label || shortKey(observer.publicKey)}
                    size="sm"
                    variant="ghost"
                    onClick={(event: React.MouseEvent) => {
                      event.stopPropagation();
                      onSelect(observer);
                    }}
                  />
                  <StatusLabel tone={statusTone ? "green" : "gray"}>
                    {observerStatusText(statusTone)}
                  </StatusLabel>
                </Stack>
              </TableCell>
              <TableCell data-label="Connected through">
                {observer.broker}
              </TableCell>
              <TableCell data-label="Region">
                {observer.region ? (
                  <RegionDisplay
                    countyLookup={countyLookup}
                    region={observer.region}
                  />
                ) : (
                  "-"
                )}
              </TableCell>
              <TableCell data-label="Last connected">
                {stockholmShortTime(observer.lastConnectedAt)}
              </TableCell>
              <TableCell data-label="Last message">
                {observer.messageCount > 0
                  ? stockholmShortTime(observer.lastSeenAt)
                  : "-"}
              </TableCell>
              <TableCell data-label="Blocked">
                {observer.abuse ? (
                  <StatusLabel tone={denialStatusTone(observer.abuse.status)}>
                    {denialStatusLabel(observer.abuse.status)}
                  </StatusLabel>
                ) : (
                  <StatusLabel>No events</StatusLabel>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
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
      status={
        <StatusLabel tone={statusTone ? "green" : "gray"}>
          {observerStatusText(statusTone)}
        </StatusLabel>
      }
      subtitle={observer.publicKey}
      title={observer.label || shortKey(observer.publicKey)}
      titleId="observer-dialog-title"
      onClose={onClose}
    >
      <Section padding={0} variant="transparent">
        <MetadataList columns="multi">
          <MetadataListItem label="Connected through">
            {observer.broker}
          </MetadataListItem>
          <MetadataListItem label="Region">
            {observer.region ? (
              <RegionDisplay
                countyLookup={countyLookup}
                region={observer.region}
              />
            ) : (
              "-"
            )}
          </MetadataListItem>
          <MetadataListItem label="Last connected">
            {stockholmTime(observer.lastConnectedAt)}
          </MetadataListItem>
          <MetadataListItem label="Last message">
            {observer.messageCount > 0
              ? stockholmEventTime(observer.lastSeenAt)
              : "-"}
          </MetadataListItem>
          <MetadataListItem label="Messages on this broker runtime">
            {numberFormat.format(observer.messageCount)}
          </MetadataListItem>
        </MetadataList>
      </Section>
      <Section padding={0} variant="transparent">
        <Heading level={3}>Protection status</Heading>
        {observer.abuse ? (
          <MetadataList columns="multi">
            <MetadataListItem label="Status">
              <StatusLabel tone={denialStatusTone(observer.abuse.status)}>
                {denialStatusLabel(observer.abuse.status)}
              </StatusLabel>
            </MetadataListItem>
            <MetadataListItem label="Reason">
              {formatPublicMuteReason(observer.abuse.reason)}
            </MetadataListItem>
            <MetadataListItem label="Reported by">
              {observer.abuse.broker}
            </MetadataListItem>
            <MetadataListItem label="Action / expiry">
              {deniedUntilLabel(observer.abuse)}
            </MetadataListItem>
          </MetadataList>
        ) : (
          <Empty>
            No protection events have been recorded for this observer.
          </Empty>
        )}
      </Section>
      <Section padding={0} variant="transparent">
        <Heading level={3}>Latest neighbor snapshot</Heading>
        {observer.neighbors ? (
          <NeighborSnapshot snapshot={observer.neighbors} />
        ) : (
          <Empty>
            No <code>/neighbors</code> snapshot has been received from this
            observer yet.
          </Empty>
        )}
      </Section>
      <Section padding={0} variant="transparent">
        <Heading level={3}>Recent messages</Heading>
        <MessageTable
          countyLookup={countyLookup}
          messages={observer.messages}
        />
      </Section>
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
    <Stack gap={4}>
      <MetadataList columns="multi">
        <MetadataListItem label="Received">
          {stockholmEventTime(snapshot.receivedAt)}
        </MetadataListItem>
        <MetadataListItem label="Firmware timestamp">
          {optionalStockholmTime(snapshot.reportedAt)}
        </MetadataListItem>
        <MetadataListItem label="Neighbors">
          {numberFormat.format(snapshot.neighbors.length)}
        </MetadataListItem>
        <MetadataListItem label="Query result">
          {numberFormat.format(responded)} responded ·{" "}
          {numberFormat.format(timedOut)} timed out
          {sendFailed > 0
            ? ` · ${numberFormat.format(sendFailed)} send failed`
            : ""}
        </MetadataListItem>
        <MetadataListItem label="Observer scopes">
          {snapshot.selfScopes.length > 0
            ? snapshot.selfScopes.join(", ")
            : "None reported"}
        </MetadataListItem>
        {snapshot.invalidEntryCount > 0 ? (
          <MetadataListItem label="Ignored entries">
            {numberFormat.format(snapshot.invalidEntryCount)} entries were
            malformed, duplicated, or beyond the display limit
          </MetadataListItem>
        ) : null}
      </MetadataList>

      {neighbors.length === 0 ? (
        <Empty>The snapshot contains no valid neighbors.</Empty>
      ) : (
        <Table hasHover density="compact" dividers="rows">
          <TableHeader>
            <TableRow>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {neighbors.map((neighbor) => (
              <TableRow key={neighbor.publicKey}>
                <TableCell className="primary-cell" data-label="Neighbor">
                  <code className="neighbor-key" title={neighbor.publicKey}>
                    {shortKey(neighbor.publicKey)}
                  </code>
                </TableCell>
                <TableCell data-label="SNR">
                  {neighbor.snr.toFixed(1)} dB
                </TableCell>
                <TableCell data-label="Last heard">
                  {age(
                    Date.now() -
                      neighborLastHeardAt(
                        snapshot.receivedAt,
                        neighbor.heardSecsAgo,
                      ),
                  )}
                </TableCell>
                <TableCell className="wide-cell" data-label="Scopes">
                  <span className="scope-list">
                    {neighbor.scopes.length > 0
                      ? neighbor.scopes.join(", ")
                      : "None reported"}
                  </span>
                </TableCell>
                <TableCell data-label="Scope query">
                  <StatusLabel tone={neighborStatusTone(neighbor.status)}>
                    {neighborStatusLabel(neighbor.status)}
                  </StatusLabel>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Stack>
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
      status={
        <StatusLabel
          tone={
            statusTone === "green"
              ? "green"
              : statusTone === "yellow"
                ? "orange"
                : "red"
          }
        >
          {brokerStatusText(broker)}
        </StatusLabel>
      }
      subtitle={brokerStatusText(broker)}
      title={broker.instanceId}
      titleId="broker-dialog-title"
      onClose={onClose}
    >
      <Section padding={0} variant="transparent">
        <MetadataList columns="multi">
          <MetadataListItem label="Started">
            {optionalStockholmTime(broker.startedAt)}
          </MetadataListItem>
          <MetadataListItem label="Publishes in the last minute">
            {numberFormat.format(
              broker.status === "healthy" ? broker.messagesLastMinute || 0 : 0,
            )}
          </MetadataListItem>
          <MetadataListItem label="Updated">
            {age(broker.lastUpdateAgeMs)}
          </MetadataListItem>
          <MetadataListItem label="Active observers">
            {numberFormat.format(claimedObservers.length)}
          </MetadataListItem>
          <MetadataListItem label="Uplink">
            <StatusLabel tone={uplinkTone(broker)}>
              {uplinkText(broker)}
            </StatusLabel>
          </MetadataListItem>
          <MetadataListItem label="Uplink client ID">
            {bridge?.clientId || "-"}
          </MetadataListItem>
          <MetadataListItem label="Forwarded since broker start">
            {numberFormat.format(bridge?.successfulMessages || 0)}
          </MetadataListItem>
          <MetadataListItem label="Dropped since broker start">
            {numberFormat.format(bridge?.droppedMessages || 0)}
          </MetadataListItem>
        </MetadataList>
      </Section>
      <Section padding={0} variant="transparent">
        <Heading level={3}>Active observers</Heading>
        {claimedObservers.length === 0 ? (
          <Empty>This broker instance has no active observers right now.</Empty>
        ) : (
          <Table hasHover density="compact" dividers="rows">
            <TableHeader>
              <TableRow>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {claimedObservers.map((observer) => (
                <TableRow
                  key={observer.publicKey}
                  className="click-row"
                  onClick={() => onOpenObserver(observer)}
                >
                  <TableCell className="primary-cell" data-label="Observer">
                    <Button
                      className="row-action"
                      label={observer.label || shortKey(observer.publicKey)}
                      size="sm"
                      variant="ghost"
                      onClick={(event: React.MouseEvent) => {
                        event.stopPropagation();
                        onOpenObserver(observer);
                      }}
                    />
                  </TableCell>
                  <TableCell className="region-cell" data-label="Region">
                    {observer.region ? (
                      <RegionDisplay
                        countyLookup={countyLookup}
                        region={observer.region}
                      />
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell data-label="Last message">
                    {observer.messageCount > 0
                      ? stockholmShortTime(observer.lastSeenAt)
                      : "-"}
                  </TableCell>
                  <TableCell data-label="Messages on this broker runtime">
                    {numberFormat.format(observer.messageCount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
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
    <Table hasHover density="compact" dividers="rows">
      <TableHeader>
        <TableRow>
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedMsgs.map((message, index) => (
          <TableRow key={`${message.receivedAt}-${index}`}>
            <TableCell data-label="Time">
              {stockholmShortTime(message.receivedAt)}
            </TableCell>
            <TableCell data-label="Broker instance">{message.broker}</TableCell>
            <TableCell data-label="Region">
              {message.region ? (
                <RegionDisplay
                  countyLookup={countyLookup}
                  region={message.region}
                />
              ) : (
                "-"
              )}
            </TableCell>
            <TableCell data-label="Subtopic">
              {message.subtopic || "-"}
            </TableCell>
            <TableCell data-label="Size">
              {numberFormat.format(message.bytes)} B
            </TableCell>
            <TableCell className="wide-cell topic-cell" data-label="MQTT topic">
              <code className="topic-code" title={message.topic}>
                {message.topic}
              </code>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
    <Stack gap={0}>
      <Table hasHover density="compact" dividers="rows">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Time</TableHeaderCell>
            <TableHeaderCell>Observer</TableHeaderCell>
            <TableHeaderCell>Region</TableHeaderCell>
            <TableHeaderCell>Subtopic</TableHeaderCell>
            <TableHeaderCell>Size</TableHeaderCell>
            <TableHeaderCell>Broker instance</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody aria-live="polite">
          {visiblePublishes.map((publish) => {
            const key = publishKey(publish);
            return (
              <TableRow
                key={key}
                className={newKeys.has(key) ? "new-publish" : undefined}
              >
                <TableCell>{stockholmShortTime(publish.receivedAt)}</TableCell>
                <TableCell>
                  <Stack gap={1}>
                    <Text weight="medium">
                      {publish.observer ||
                        shortKey(publish.publicKey || "") ||
                        "Observer"}
                    </Text>
                    <Text
                      color="secondary"
                      maxLines={1}
                      title={publish.topic}
                      type="code"
                    >
                      {publish.topic}
                    </Text>
                  </Stack>
                </TableCell>
                <TableCell>
                  {publish.region ? (
                    <RegionDisplay
                      countyLookup={countyLookup}
                      region={publish.region}
                    />
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell>{publish.subtopic || "-"}</TableCell>
                <TableCell>{numberFormat.format(publish.bytes)} B</TableCell>
                <TableCell>{publish.broker}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {publishes.length > initialLimit ? (
        <Stack hAlign="end" padding={4}>
          <Button
            label={
              expanded
                ? "Show fewer"
                : `Show ${Math.min(40, publishes.length - initialLimit)} more`
            }
            variant="ghost"
            onClick={() => setExpanded((current) => !current)}
          />
        </Stack>
      ) : null}
    </Stack>
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
      status={
        <StatusLabel tone={denialStatusTone(ban.status)}>
          {denialStatusLabel(ban.status)}
        </StatusLabel>
      }
      subtitle={ban.node}
      title={ban.label || shortKey(ban.node)}
      titleId="ban-dialog-title"
      onClose={onClose}
    >
      <Section padding={0} variant="transparent">
        <MetadataList columns="multi">
          <MetadataListItem label="Reported by">{ban.broker}</MetadataListItem>
          <MetadataListItem label="Reason">
            {formatPublicMuteReason(ban.reason)}
          </MetadataListItem>
          <MetadataListItem label="Action / expiry">
            {deniedUntilLabel(ban)}
          </MetadataListItem>
          <MetadataListItem label="Last seen">
            {ban.lastUpdatedAt ? stockholmTime(ban.lastUpdatedAt) : "-"}
          </MetadataListItem>
          {ban.region ? (
            <MetadataListItem label="Region">
              <RegionDisplay countyLookup={countyLookup} region={ban.region} />
            </MetadataListItem>
          ) : null}
          <MetadataListItem label="Status">
            <StatusLabel tone={denialStatusTone(ban.status)}>
              {denialStatusLabel(ban.status)}
            </StatusLabel>
          </MetadataListItem>
          {ban.topic ? (
            <MetadataListItem label="MQTT topic">
              <code className="topic-code" title={ban.topic}>
                {ban.topic}
              </code>
            </MetadataListItem>
          ) : null}
        </MetadataList>
      </Section>
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
    <Table hasHover density="compact" dividers="rows">
      <TableHeader>
        <TableRow>
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedBans.map((ban, index) => (
          <TableRow
            key={`${ban.node}-${index}`}
            className="click-row"
            onClick={() => onSelect(ban)}
          >
            <TableCell className="primary-cell" data-label="Observer / key">
              <Button
                className="row-action"
                label={ban.label || shortKey(ban.node)}
                size="sm"
                variant="ghost"
                onClick={(event: React.MouseEvent) => {
                  event.stopPropagation();
                  onSelect(ban);
                }}
              />
            </TableCell>
            <TableCell data-label="Reported by">{ban.broker}</TableCell>
            <TableCell data-label="Reason">
              {formatPublicMuteReason(ban.reason)}
            </TableCell>
            <TableCell className="wide-cell" data-label="Action / expiry">
              {deniedUntilLabel(ban)}
            </TableCell>
            <TableCell data-label="Status">
              <StatusLabel tone={denialStatusTone(ban.status)}>
                {denialStatusLabel(ban.status)}
              </StatusLabel>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
    return (
      <Text color="secondary" type="supporting">
        No active subscriptions
      </Text>
    );
  }

  return (
    <Stack direction="horizontal" gap={2} wrap="wrap">
      {visibleTopics.map((topic) => (
        <Token key={topic} description={topic} label={topic} size="sm" />
      ))}
      {hiddenCount > 0 ? (
        <Token
          color="gray"
          label={`+${numberFormat.format(hiddenCount)} more`}
          size="sm"
        />
      ) : null}
      {truncated ? (
        <Token
          color="gray"
          description="The broker limits how many topic filters are retained for dashboard display."
          label="Additional topics not shown"
          size="sm"
        />
      ) : null}
    </Stack>
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
    <Table hasHover density="compact" dividers="rows">
      <TableHeader>
        <TableRow>
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((sub) => (
          <TableRow
            key={sub.username}
            className="click-row"
            onClick={() => onSelect(sub)}
          >
            <TableCell className="primary-cell" data-label="Username">
              <Button
                className="row-action"
                label={sub.username}
                size="sm"
                variant="ghost"
                onClick={(event: React.MouseEvent) => {
                  event.stopPropagation();
                  onSelect(sub);
                }}
              />
            </TableCell>
            <TableCell className="wide-cell" data-label="Connected through">
              <Stack direction="horizontal" gap={2} wrap="wrap">
                {sub.brokers.map((b) => (
                  <Token
                    key={b.brokerId}
                    label={`${b.brokerId} (${numberFormat.format(b.connectionCount)})`}
                    size="sm"
                  />
                ))}
              </Stack>
            </TableCell>
            <TableCell
              className="wide-cell topic-cell"
              data-label="Subscriptions"
            >
              <SubscriptionList
                limit={3}
                topics={sub.subscriptions}
                truncated={sub.subscriptionsTruncated}
              />
            </TableCell>
            <TableCell data-label="Connections">
              {numberFormat.format(sub.connectionCount)}
            </TableCell>
            <TableCell data-label="Last active">
              {sub.lastSeenAt > 0 ? stockholmShortTime(sub.lastSeenAt) : "-"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
      <Section padding={0} variant="transparent">
        <MetadataList columns="multi">
          <MetadataListItem label="Total active connections">
            {numberFormat.format(sub.connectionCount)}
          </MetadataListItem>
          <MetadataListItem label="Unique subscriptions">
            {numberFormat.format(sub.subscriptions.length)}
            {sub.subscriptionsTruncated ? "+" : ""}
          </MetadataListItem>
          <MetadataListItem label="Broker instances">
            {numberFormat.format(sub.brokers.length)}
          </MetadataListItem>
          <MetadataListItem label="Last active">
            {sub.lastSeenAt > 0 ? stockholmTime(sub.lastSeenAt) : "-"}
          </MetadataListItem>
        </MetadataList>
      </Section>
      <Section padding={0} variant="transparent">
        <Heading level={3}>Subscribed topic filters</Heading>
        <SubscriptionList
          topics={sub.subscriptions}
          truncated={sub.subscriptionsTruncated}
        />
      </Section>
      <Section padding={0} variant="transparent">
        <List hasDividers density="compact" header="Active connections">
          {sub.connections.map((connection, index) => (
            <ListItem
              key={`${connection.brokerId}-${connection.clientId}-${index}`}
              description={
                <Stack gap={2}>
                  <Text color="secondary" type="supporting">
                    {connection.brokerId}
                  </Text>
                  <SubscriptionList
                    topics={connection.subscriptions}
                    truncated={connection.subscriptionsTruncated}
                  />
                </Stack>
              }
              endContent={
                <Text color="secondary" type="supporting">
                  {stockholmShortTime(connection.lastSeenAt)}
                </Text>
              }
              label={connection.clientId}
            />
          ))}
        </List>
      </Section>
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
    <Section className={className} padding={0}>
      <Stack gap={0}>
        <Stack gap={1} padding={4}>
          <Heading level={2}>{title}</Heading>
          {subtitle ? (
            <Text color="secondary" type="supporting">
              {subtitle}
            </Text>
          ) : null}
        </Stack>
        <Stack gap={4} padding={0}>
          {children}
        </Stack>
      </Stack>
    </Section>
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
  const [selectedBroker, _setSelectedBroker] = useState<BrokerMetrics | null>(
    null,
  );
  const [selectedObserver, _setSelectedObserver] =
    useState<DashboardObserver | null>(null);
  const [selectedBan, _setSelectedBan] = useState<BanSummary | null>(null);
  const [selectedSubscriber, _setSelectedSubscriber] =
    useState<SubscriberConnectionEntry | null>(null);
  const [selectedObserverKey, setSelectedObserverKey] = useState(
    initialHash.observer,
  );
  const [selectedBanKey, setSelectedBanKey] = useState(initialHash.ban);

  function setSelectedBroker(broker: BrokerMetrics | null) {
    _setSelectedBroker(broker);
  }

  function setSelectedObserver(observer: DashboardObserver | null) {
    setSelectedObserverKey(observer?.publicKey || "");
    _setSelectedObserver(observer);
  }

  function setSelectedBan(ban: BanSummary | null) {
    setSelectedBanKey(ban?.node || "");
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
      setSelectedObserverKey(observerKey || "");
      setSelectedBanKey(banKey || "");
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
    replaceHash(view, query, regionFilter, selectedObserverKey, selectedBanKey);
  }, [view, query, regionFilter, selectedObserverKey, selectedBanKey]);

  useEffect(() => {
    if (selectedObserver || !selectedObserverKey || !snapshot) {
      return;
    }
    const match = snapshot.observers.find(
      (observer) => observer.publicKey === selectedObserverKey,
    );
    if (match) {
      _setSelectedObserver(match);
    } else {
      setSelectedObserverKey("");
    }
  }, [selectedObserver, selectedObserverKey, snapshot]);

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
    if (selectedBan || !selectedBanKey || !snapshot) {
      return;
    }
    const match = allBans.find((ban) => ban.node === selectedBanKey);
    if (match) {
      _setSelectedBan(match);
    } else {
      setSelectedBanKey("");
    }
  }, [selectedBan, selectedBanKey, allBans, snapshot]);

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
    setSelectedObserver(observer);
  }

  const page = useMemo(() => {
    if (view === "brokers") {
      return (
        <Grid
          className="page-grid two"
          columns={{ minWidth: 720, max: 2, repeat: "fit" }}
          gap={4}
        >
          <Panel
            className="broker-panel"
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
        </Grid>
      );
    }
    if (view === "observers") {
      return (
        <Panel
          className="observer-panel"
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
          className="ban-panel"
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
          className="subscriber-panel"
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
      <Stack className="overview-page" gap={4}>
        <ObserverLookup
          countyLookup={snapshot?.countyLookup}
          onOpenObserver={setSelectedObserver}
        />
        <Grid
          aria-label="Cluster metrics"
          className="metrics"
          columns={{ minWidth: 144, max: 4, repeat: "fit" }}
          gap={4}
        >
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
        </Grid>
        <Grid
          className="grid"
          columns={{ minWidth: 420, max: 2, repeat: "fit" }}
          gap={4}
        >
          <Panel
            className="broker-panel"
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
          <GridSpan columns="full">
            <Panel
              className="ban-panel"
              subtitle={
                summary.protectionEventsTruncated
                  ? "Showing the latest 50 retained events."
                  : undefined
              }
              title="Protection events"
            >
              <BanTable bans={overviewBans} onSelect={setSelectedBan} />
              {allBans.length > overviewBans.length ? (
                <Stack direction="horizontal" hAlign="end" padding={4}>
                  <Button
                    label="View protection events"
                    variant="secondary"
                    onClick={() => setView("bans")}
                  />
                </Stack>
              ) : null}
            </Panel>
          </GridSpan>
          <GridSpan columns="full">
            <Panel
              subtitle="The 50 most recent messages recorded by the dashboard."
              title="Recent publishes"
            >
              <PublishFeed
                countyLookup={snapshot?.countyLookup}
                publishes={recentPublishes}
              />
            </Panel>
          </GridSpan>
        </Grid>
      </Stack>
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

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  return (
    <Theme mode="system" theme={meshatTheme}>
      <AppShell
        contentPadding={0}
        height="auto"
        sideNav={
          <SideNav
            collapsible={{ buttonLabel: "Collapse navigation" }}
            footer={
              <Stack gap={3} padding={3}>
                <Stack gap={0}>
                  <Text color="secondary" type="supporting">
                    Namespace
                  </Text>
                  <Text
                    maxLines={1}
                    title={namespace}
                    type="supporting"
                    weight="semibold"
                  >
                    {namespace}
                  </Text>
                </Stack>
                <Stack gap={0}>
                  <Text color="secondary" type="supporting">
                    Responding broker
                  </Text>
                  <Text
                    maxLines={1}
                    title={respondingBroker}
                    type="supporting"
                    weight="semibold"
                  >
                    {respondingBroker}
                  </Text>
                </Stack>
              </Stack>
            }
            resizable={{
              autoSaveId: "meshat-dashboard-sidenav",
              defaultWidth: 260,
              maxWidth: 340,
              minWidth: 220,
            }}
          >
            <SideNavSection isHeaderHidden title="Dashboard">
              {navItems.map((item) => (
                <SideNavItem
                  key={item.view}
                  href={`#${item.view}`}
                  icon={<Icon path={item.icon} />}
                  isSelected={view === item.view}
                  label={item.label}
                />
              ))}
            </SideNavSection>
          </SideNav>
        }
        topNav={
          <TopNav
            heading={
              <TopNavHeading
                heading="MeshCore MQTT"
                headingHref="#overview"
                logo={<Brand />}
                logoLabel="Meshat.se"
                subheading="Operations dashboard"
                superheading="Meshat.se"
              />
            }
            label="Dashboard toolbar"
          />
        }
        variant="elevated"
      >
        <Stack gap={0}>
          <Stack gap={5} maxWidth={1440} padding={6}>
            <Grid columns={{ minWidth: 320, max: 2, repeat: "fit" }} gap={6}>
              <Stack gap={1}>
                <Text color="accent" type="supporting" weight="semibold">
                  {currentPage.eyebrow}
                </Text>
                <Heading level={1}>{currentPage.title}</Heading>
                <Text color="secondary" type="body">
                  {currentPage.description}
                </Text>
              </Stack>
              <MetadataList orientation="horizontal">
                <MetadataListItem label="Active brokers">
                  <Text hasTabularNumbers weight="semibold">
                    {numberFormat.format(summary.activeBrokers)} of{" "}
                    {numberFormat.format(summary.totalBrokers)}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="Data source">
                  <Text maxLines={1} title={respondingBroker} weight="semibold">
                    {respondingBroker}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="Updated">
                  <Text hasTabularNumbers weight="semibold">
                    {headerTimeFormat.format(date)} ·{" "}
                    {headerDateFormat.format(date)}
                  </Text>
                </MetadataListItem>
              </MetadataList>
            </Grid>

            {isLoading ? (
              <Banner
                container="card"
                description="Waiting for the first cluster snapshot."
                icon={<Spinner label="Loading dashboard data" size="sm" />}
                status="info"
                title="Loading dashboard data"
              />
            ) : null}
            {refreshError ? (
              <Banner
                container="card"
                description={`${refreshError}${
                  showingStaleData
                    ? " The last successful snapshot remains visible."
                    : ""
                }`}
                status="error"
                title="Data could not be refreshed"
              />
            ) : null}

            {page}
          </Stack>
        </Stack>

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
      </AppShell>
    </Theme>
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
