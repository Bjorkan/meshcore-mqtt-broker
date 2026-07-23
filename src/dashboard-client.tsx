/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Astryx conditional exports are typed by TypeScript but not resolved by the ESLint project service. */
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "./themes/gothic/gothicTheme.css";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid, GridSpan } from "@astryxdesign/core/Grid";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Icon as AstryxIcon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import {
  MetadataList,
  MetadataListItem,
} from "@astryxdesign/core/MetadataList";
import { NavIcon } from "@astryxdesign/core/NavIcon";
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
import { Toolbar } from "@astryxdesign/core/Toolbar";
import {
  Table,
  pixel,
  proportional,
  type BodyRowRenderProps,
  type HeaderCellRenderProps,
  type TableColumn,
  type TablePlugin,
} from "@astryxdesign/core/Table";
import { Text, Heading } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Theme } from "@astryxdesign/core/theme";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { Token } from "@astryxdesign/core/Token";
import { Logger } from "tslog";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
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
import { gothicTheme } from "./themes/gothic/gothic.js";

const log = new Logger({ name: "Dashboard", type: "pretty" });

const MDI = {
  accountGroup:
    "M12 5.5A3.5 3.5 0 0 1 15.5 9A3.5 3.5 0 0 1 12 12.5A3.5 3.5 0 0 1 8.5 9A3.5 3.5 0 0 1 12 5.5M5 8C6.11 8 7 8.89 7 10S6.11 12 5 12 3 11.11 3 10 3.89 8 5 8M19 8C20.11 8 21 8.89 21 10S20.11 12 19 12 17 11.11 17 10 17.89 8 19 8M12 14C14.33 14 19 15.17 19 17.5V20H5V17.5C5 15.17 9.67 14 12 14M5 13C6.16 13 8.05 13.3 9.4 13.9C7.83 14.68 7 15.76 7 17.5V18H1V15.5C1 13.84 3.67 13 5 13M19 13C20.33 13 23 13.84 23 15.5V18H17V17.5C17 15.76 16.17 14.68 14.6 13.9C15.95 13.3 17.84 13 19 13Z",
  homeOutline: "M10 20V14H14V20H19V12H22L12 3L2 12H5V20H10Z",
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
const MOBILE_RECORD_QUERY = "(max-width: 768px)";

function Icon({
  path,
  color = "inherit",
  size = "md",
}: {
  path: string;
  color?: "primary" | "secondary" | "accent" | "inherit";
  size?: "xsm" | "sm" | "md" | "lg";
}) {
  function MdiIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
      <svg {...props} aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d={path} fill="currentColor" />
      </svg>
    );
  }

  return <AstryxIcon color={color} icon={MdiIcon} size={size} />;
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

interface MobileRecordFieldData {
  label: string;
  value: React.ReactNode;
  technical?: boolean;
}

function TechnicalText({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <Text as="span" size="sm" title={title} type="code" wordBreak="break-word">
      {children}
    </Text>
  );
}

function TechnicalValue({
  value,
  displayValue = value,
}: {
  value: string;
  displayValue?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Stack direction="horizontal" gap={2} hAlign="between" vAlign="start">
      <TechnicalText title={value}>{displayValue}</TechnicalText>
      <IconButton
        icon={<AstryxIcon icon="copy" size="sm" />}
        label={copied ? "Copied" : "Copy value"}
        size="sm"
        variant="ghost"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
      />
    </Stack>
  );
}

function compactTopic(topic: string): string {
  return topic
    .split("/")
    .map((part) => (part.length > 18 ? shortKey(part) : part))
    .join("/");
}

function MobileRecordField({ field }: { field: MobileRecordFieldData }) {
  return (
    <Stack as="span" gap={0.5}>
      <Text as="span" color="secondary" type="label">
        {field.label}
      </Text>
      {field.technical ? (
        <TechnicalText>{field.value}</TechnicalText>
      ) : typeof field.value === "string" || typeof field.value === "number" ? (
        <Text as="span">{field.value}</Text>
      ) : (
        field.value
      )}
    </Stack>
  );
}

function MobileRecord({
  fields,
  kind,
  recordKey,
  onClick,
}: {
  fields: MobileRecordFieldData[];
  kind: string;
  recordKey: string;
  onClick?: () => void;
}) {
  const [primary, ...details] = fields;
  return (
    <ListItem
      data-dashboard-record="true"
      data-record-interactive={onClick ? "true" : "false"}
      data-record-key={recordKey}
      data-record-kind={kind}
      description={
        details.length > 0 ? (
          <Grid columns={2} gap={2} width="100%">
            {details.map((field) => (
              <MobileRecordField key={field.label} field={field} />
            ))}
          </Grid>
        ) : undefined
      }
      endContent={
        onClick ? (
          <AstryxIcon color="secondary" icon="chevronRight" size="sm" />
        ) : undefined
      }
      label={
        <Stack as="span" gap={1}>
          {primary.value}
        </Stack>
      }
      onClick={onClick}
    />
  );
}

function ResponsiveRecords({
  desktop,
  mobile,
}: {
  desktop: React.ReactNode;
  mobile: React.ReactNode;
}) {
  const isMobile = useMediaQuery(MOBILE_RECORD_QUERY);
  return isMobile ? mobile : desktop;
}

function ModalShell({
  title,
  subtitle,
  status,
  children,
  onClose,
  size = "md",
}: {
  title: string;
  subtitle?: string;
  status?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "wide";
}) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const useFullscreen = isMobile && (size === "lg" || size === "wide");
  const width = {
    sm: 560,
    md: 720,
    lg: 900,
    wide: 1080,
  }[size];

  return (
    <Dialog
      isOpen
      aria-label={title}
      maxHeight="92dvh"
      padding={0}
      purpose="info"
      variant={useFullscreen ? "fullscreen" : "standard"}
      width={width}
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) onClose();
      }}
    >
      <Layout
        defaultHasDividers
        content={
          <LayoutContent padding={isMobile ? 4 : 5}>
            <Stack gap={4}>
              {isMobile && status ? (
                <Stack paddingBlock={2}>{status}</Stack>
              ) : null}
              {children}
            </Stack>
          </LayoutContent>
        }
        header={
          <DialogHeader
            endContent={isMobile ? undefined : status}
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

type DashboardTableRow<T extends object> = T & Record<string, unknown>;

function dashboardTableData<T extends object>(
  data: T[],
): DashboardTableRow<T>[] {
  return data as DashboardTableRow<T>[];
}

function dashboardTablePlugins<T extends Record<string, unknown>>({
  kind,
  recordKey,
  sortField,
  sortDir = "asc",
}: {
  kind: string;
  recordKey: (item: T, index: number) => string;
  sortField?: string | null;
  sortDir?: SortDir;
}): Record<string, TablePlugin<T>> {
  const dashboardRecords: TablePlugin<T> = {
    transformHeaderCell: (
      props: HeaderCellRenderProps,
      column: TableColumn<T>,
    ) =>
      sortField === undefined
        ? props
        : {
            ...props,
            htmlProps: {
              ...props.htmlProps,
              "aria-sort":
                sortField === column.key
                  ? sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none",
            },
          },
    transformBodyRow: (props: BodyRowRenderProps, item: T, index: number) => ({
      ...props,
      htmlProps: {
        ...props.htmlProps,
        "data-dashboard-record": "true",
        "data-record-interactive": "false",
        "data-record-key": recordKey(item, index),
        "data-record-kind": kind,
      },
    }),
  };

  return {
    dashboardRecords,
  };
}

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
    <Button
      icon={
        active ? (
          <AstryxIcon
            icon={sortDir === "asc" ? "arrowUp" : "arrowDown"}
            size="xsm"
          />
        ) : undefined
      }
      label={label}
      size="sm"
      variant="ghost"
      onClick={() => onToggle(field)}
    />
  );
}

function MobileSortControls({
  options,
  sortDir,
  sortField,
  onToggle,
}: {
  options: Array<{ label: string; value: string }>;
  sortDir: SortDir;
  sortField: string | null;
  onToggle: (field: string) => void;
}) {
  return (
    <Toolbar
      dividers={["top", "bottom"]}
      endContent={
        <IconButton
          icon={
            <AstryxIcon
              icon={sortDir === "asc" ? "arrowUp" : "arrowDown"}
              size="sm"
            />
          }
          isDisabled={!sortField}
          label={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
          variant="secondary"
          onClick={() => {
            if (sortField) onToggle(sortField);
          }}
        />
      }
      label="Sort records"
      size="sm"
      startContent={
        <Selector
          isLabelHidden
          label="Sort by"
          options={options}
          placeholder="Sort by"
          value={sortField ?? ""}
          onChange={(value: string | null) => {
            if (value && value !== sortField) onToggle(value);
          }}
        />
      }
      variant="muted"
    />
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
  tone = "gray",
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
    <Stack as="span" direction="horizontal" gap={2} vAlign="center">
      <StatusDot label={label} variant={variant} />
      <Text aria-hidden="true" as="span" type="supporting" weight="medium">
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

function targetForwardingText(broker: BrokerMetrics): string {
  const bridge = broker.targetBridge;
  if (!bridge?.enabled) {
    return "Disabled";
  }

  const target = bridge.targetHost || bridge.targetUrl || "target broker";
  return bridge.connected
    ? `Connected to ${target}`
    : `Disconnected from ${target}`;
}

function targetForwardingShortText(broker: BrokerMetrics): string {
  const bridge = broker.targetBridge;
  if (!bridge?.enabled) return "Disabled";
  return bridge.connected ? "Connected" : "Disconnected";
}

function targetForwardingTone(
  broker: BrokerMetrics,
): "green" | "orange" | "gray" {
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
    <Card id={id} padding={4}>
      <Stack gap={2}>
        <Stack direction="horizontal" gap={3} hAlign="between" vAlign="center">
          <Text color="secondary" type="label">
            {label}
          </Text>
          <Stack aria-hidden="true">
            <Icon color="accent" path={icon} size="md" />
          </Stack>
        </Stack>
        <Text
          hasTabularNumbers={!textualValue}
          maxLines={textualValue ? 2 : 0}
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
    </Card>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <Section padding={4} variant="muted">
      <EmptyState isCompact headingLevel={3} title={children} />
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

function mapAdvertKey(advert: MeshcoreIoMapAdvert): string {
  return advert.nodePublicKey || advert.requestId;
}

function MeshcoreIoAdvertList({ adverts }: { adverts: MeshcoreIoMapAdvert[] }) {
  const sortedAdverts = useMemo(
    () => [...adverts].sort((a, b) => b.at - a.at),
    [adverts],
  );

  if (sortedAdverts.length === 0) {
    return (
      <Empty>No adverts have been accepted during the last seven days.</Empty>
    );
  }

  return (
    <List hasDividers density="compact" header="Recent positioned adverts">
      {sortedAdverts.map((advert) => (
        <ListItem
          key={mapAdvertKey(advert)}
          description={
            <Stack as="span" gap={1}>
              <Text as="span" color="secondary" type="supporting">
                {advert.observerName || "Observer unknown"} ·{" "}
                {advert.latitude.toFixed(5)}, {advert.longitude.toFixed(5)}
              </Text>
              <Text as="span" color="secondary" type="supporting">
                Added {stockholmEventTime(advert.at)} by{" "}
                {advert.workerInstanceId}
              </Text>
            </Stack>
          }
          endContent={<Badge label={advert.advertType} />}
          label={advert.nodeName}
        />
      ))}
    </List>
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
        subtitle={
          compact
            ? "Enable this integration under meshcore_io in config.yaml."
            : undefined
        }
        title={compact ? "MeshCore.io" : undefined}
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
          subtitle="Shared queue health and distributed upload workers."
          title="MeshCore.io"
        >
          <Grid
            aria-label="MeshCore.io overview"
            columns={{ minWidth: 160, max: 4, repeat: "fit" }}
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

  const workerColumns: TableColumn<
    DashboardTableRow<MeshcoreIoWorkerStatus>
  >[] = [
    {
      key: "instanceId",
      header: "Broker",
      width: proportional(2, { minWidth: 220 }),
      renderCell: (worker: DashboardTableRow<MeshcoreIoWorkerStatus>) => (
        <Text weight="semibold">{worker.instanceId}</Text>
      ),
    },
    {
      key: "configuredWorkers",
      header: "Workers",
      width: pixel(96),
      renderCell: (worker: DashboardTableRow<MeshcoreIoWorkerStatus>) =>
        numberFormat.format(worker.configuredWorkers),
    },
    {
      key: "activeUploads",
      header: "Active",
      width: pixel(80),
      renderCell: (worker: DashboardTableRow<MeshcoreIoWorkerStatus>) =>
        numberFormat.format(worker.activeUploads),
    },
    {
      key: "uploadsSucceeded",
      header: "Uploaded",
      width: pixel(110),
      renderCell: (worker: DashboardTableRow<MeshcoreIoWorkerStatus>) =>
        numberFormat.format(worker.uploadsSucceeded),
    },
    {
      key: "uploadsFailed",
      header: "Failed",
      width: pixel(100),
      renderCell: (worker: DashboardTableRow<MeshcoreIoWorkerStatus>) =>
        numberFormat.format(worker.uploadsFailed),
    },
    {
      key: "lastUploadAt",
      header: "Last upload",
      width: pixel(110),
      renderCell: (worker: DashboardTableRow<MeshcoreIoWorkerStatus>) =>
        worker.lastUploadAt
          ? optionalStockholmShortTime(worker.lastUploadAt)
          : age(Date.now() - worker.updatedAt),
    },
  ];
  const historyColumns: TableColumn<
    DashboardTableRow<MeshcoreIoHistoryEntry>
  >[] = [
    {
      key: "at",
      header: "Time",
      width: pixel(80),
      renderCell: (entry: DashboardTableRow<MeshcoreIoHistoryEntry>) =>
        stockholmShortTime(entry.at),
    },
    {
      key: "nodeName",
      header: "Node",
      width: proportional(2, { minWidth: 200 }),
      renderCell: (entry: DashboardTableRow<MeshcoreIoHistoryEntry>) => (
        <Stack as="span" gap={1}>
          <Text as="span" weight="semibold">
            {entry.nodeName}
          </Text>
          <Text as="span" color="secondary" type="supporting">
            {entry.nodePublicKey.slice(0, 10)}
          </Text>
        </Stack>
      ),
    },
    {
      key: "advertType",
      header: "Type",
      width: pixel(120),
    },
    {
      key: "workerInstanceId",
      header: "Broker",
      width: proportional(1, { minWidth: 180 }),
    },
    {
      key: "status",
      header: "Status",
      width: pixel(110),
      renderCell: (entry: DashboardTableRow<MeshcoreIoHistoryEntry>) => (
        <StatusLabel tone={entry.status === "uploaded" ? "green" : "red"}>
          {entry.status === "uploaded" ? "Uploaded" : "Dropped"}
        </StatusLabel>
      ),
    },
  ];

  return (
    <Panel>
      <Grid
        aria-label="MeshCore.io metrics"
        columns={{ minWidth: 160, max: 4, repeat: "fit" }}
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

      <Stack paddingInline={4}>
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
      </Stack>

      {state.lastError ? (
        <Banner
          container="section"
          description={state.lastError}
          status="error"
          title="Latest MeshCore.io error"
        />
      ) : null}

      <Stack paddingInline={4}>
        <Section aria-labelledby="meshcoreio-map-title" padding={0}>
          <Stack
            direction="horizontal"
            gap={4}
            hAlign="between"
            padding={4}
            vAlign="center"
          >
            <Stack gap={1}>
              <Heading id="meshcoreio-map-title" level={3}>
                Positioned adverts
              </Heading>
              <Text color="secondary" type="supporting">
                Coordinates reported for every advert accepted by MeshCore.io
                during the last seven days.
              </Text>
            </Stack>
            <Badge
              label={`${numberFormat.format(state.map?.advertsLast7Days.length ?? 0)} nodes`}
            />
          </Stack>
          <MeshcoreIoAdvertList adverts={state.map?.advertsLast7Days ?? []} />
        </Section>
      </Stack>

      <Stack paddingInline={4}>
        <Heading level={3}>Broker workers</Heading>
      </Stack>
      {state.workers.length === 0 ? (
        <Empty>No broker workers have reported yet.</Empty>
      ) : (
        <ResponsiveRecords
          desktop={
            <Table
              hasHover
              columns={workerColumns}
              data={dashboardTableData(state.workers)}
              density="compact"
              dividers="rows"
              idKey="instanceId"
              plugins={dashboardTablePlugins<
                DashboardTableRow<MeshcoreIoWorkerStatus>
              >({
                kind: "meshcore-worker",
                recordKey: (worker) => worker.instanceId,
              })}
            />
          }
          mobile={
            <List hasDividers density="compact">
              {state.workers.map((worker) => (
                <MobileRecord
                  key={worker.instanceId}
                  fields={[
                    {
                      label: "Broker",
                      value: (
                        <Stack
                          as="span"
                          direction="horizontal"
                          gap={2}
                          hAlign="between"
                          vAlign="center"
                        >
                          <TechnicalText>{worker.instanceId}</TechnicalText>
                          <Text as="span" color="secondary" type="supporting">
                            {optionalStockholmShortTime(worker.updatedAt)}
                          </Text>
                        </Stack>
                      ),
                    },
                    {
                      label: "Capacity",
                      value: `${numberFormat.format(worker.configuredWorkers)} workers · ${numberFormat.format(worker.activeUploads)} active`,
                    },
                    {
                      label: "Since start",
                      value: `${numberFormat.format(worker.uploadsSucceeded)} uploaded · ${numberFormat.format(worker.uploadsFailed)} failed`,
                    },
                    {
                      label: "Last upload",
                      value: worker.lastUploadAt
                        ? optionalStockholmShortTime(worker.lastUploadAt)
                        : age(Date.now() - worker.updatedAt),
                    },
                  ]}
                  kind="meshcore-worker"
                  recordKey={worker.instanceId}
                />
              ))}
            </List>
          }
        />
      )}

      <Stack paddingInline={4}>
        <Heading level={3}>Recent uploads</Heading>
      </Stack>
      {state.history.length === 0 ? (
        <Empty>No adverts have completed yet.</Empty>
      ) : (
        <ResponsiveRecords
          desktop={
            <Table
              hasHover
              columns={historyColumns}
              data={dashboardTableData(state.history)}
              density="compact"
              dividers="rows"
              idKey={(entry: DashboardTableRow<MeshcoreIoHistoryEntry>) =>
                `${entry.requestId}-${entry.at}`
              }
              plugins={dashboardTablePlugins<
                DashboardTableRow<MeshcoreIoHistoryEntry>
              >({
                kind: "meshcore-upload",
                recordKey: (entry) => `${entry.requestId}-${entry.at}`,
              })}
            />
          }
          mobile={
            <List hasDividers density="compact">
              {state.history.map((entry) => {
                const recordKey = `${entry.requestId}-${entry.at}`;
                return (
                  <MobileRecord
                    key={recordKey}
                    fields={[
                      {
                        label: "Node",
                        value: (
                          <Stack
                            as="span"
                            direction="horizontal"
                            gap={2}
                            hAlign="between"
                            vAlign="center"
                          >
                            <Text as="span" weight="semibold">
                              {entry.nodeName}
                            </Text>
                            <StatusLabel
                              tone={
                                entry.status === "uploaded" ? "green" : "red"
                              }
                            >
                              {entry.status === "uploaded"
                                ? "Uploaded"
                                : "Dropped"}
                            </StatusLabel>
                          </Stack>
                        ),
                      },
                      {
                        label: "Route",
                        value: `${entry.advertType} · ${entry.workerInstanceId}`,
                      },
                      {
                        label: "Time",
                        value: stockholmShortTime(entry.at),
                      },
                      {
                        label: "Public key",
                        value: (
                          <TechnicalValue
                            displayValue={shortKey(entry.nodePublicKey)}
                            value={entry.nodePublicKey}
                          />
                        ),
                      },
                    ]}
                    kind="meshcore-upload"
                    recordKey={recordKey}
                  />
                );
              })}
            </List>
          }
        />
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
    return result.status === "unknown" ? (
      <Section padding={4} variant="muted">
        <Stack gap={2}>
          <StatusLabel tone="gray">Not seen</StatusLabel>
          <Text color="secondary">
            {result.message} No retained observer record was found; this does
            not confirm whether the observer is online or trusted.
          </Text>
        </Stack>
      </Section>
    ) : (
      <Banner
        container="section"
        description={result.message}
        status={result.status === "invalid" ? "warning" : "error"}
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
        <Stack hAlign="start" vAlign="end">
          <Button
            isDisabled={loading || !input.trim()}
            isLoading={loading}
            label="Check status"
            variant="primary"
            onClick={() => void lookup()}
          />
        </Stack>
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
  compact = false,
  onSelect,
}: {
  brokers: BrokerMetrics[];
  compact?: boolean;
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
  const brokerColumns: TableColumn<DashboardTableRow<BrokerMetrics>>[] = [
    {
      key: "instanceId",
      header: (
        <SortHeader
          field="instanceId"
          label="Instance"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: compact
        ? proportional(2, { minWidth: 140 })
        : proportional(2, { minWidth: 200 }),
      renderCell: (broker: DashboardTableRow<BrokerMetrics>) => (
        <Stack gap={1}>
          <Button
            label={broker.instanceId}
            size="sm"
            variant="ghost"
            onClick={() => onSelect(broker)}
          />
          <StatusLabel tone={brokerStatusLabelTone(broker)}>
            {brokerStatusText(broker)}
          </StatusLabel>
        </Stack>
      ),
    },
    ...(!compact
      ? [
          {
            key: "startedAt",
            header: (
              <SortHeader
                field="startedAt"
                label="Started"
                sortDir={sortDir}
                sortField={sortField}
                onToggle={toggle}
              />
            ),
            width: pixel(112),
            renderCell: (broker: DashboardTableRow<BrokerMetrics>) =>
              optionalStockholmShortTime(broker.startedAt),
          },
        ]
      : []),
    {
      key: "clients",
      header: (
        <SortHeader
          field="clients"
          label={compact ? "Obs." : "Observers"}
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(compact ? 90 : 118),
      renderCell: (broker: DashboardTableRow<BrokerMetrics>) =>
        numberFormat.format(
          broker.status === "healthy"
            ? (broker.claimedObservers ?? broker.publisherClients)
            : 0,
        ),
    },
    {
      key: "messagesLastMinute",
      header: (
        <SortHeader
          field="messagesLastMinute"
          label={compact ? "Pub/min" : "Publishes/min"}
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(compact ? 100 : 132),
      renderCell: (broker: DashboardTableRow<BrokerMetrics>) =>
        numberFormat.format(
          broker.status === "healthy" ? broker.messagesLastMinute || 0 : 0,
        ),
    },
    ...(!compact
      ? [
          {
            key: "uplink",
            header: (
              <SortHeader
                field="uplink"
                label="Target forwarding"
                sortDir={sortDir}
                sortField={sortField}
                onToggle={toggle}
              />
            ),
            width: pixel(180),
            renderCell: (broker: DashboardTableRow<BrokerMetrics>) =>
              targetForwardingShortText(broker),
          },
        ]
      : []),
    {
      key: "lastUpdateAgeMs",
      header: (
        <SortHeader
          field="lastUpdateAgeMs"
          label="Updated"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(compact ? 96 : 108),
      renderCell: (broker: DashboardTableRow<BrokerMetrics>) =>
        age(broker.lastUpdateAgeMs),
    },
  ];
  return (
    <ResponsiveRecords
      desktop={
        <Table
          hasHover
          columns={brokerColumns}
          data={dashboardTableData(sortedBrokers)}
          density="compact"
          dividers="rows"
          idKey="instanceId"
          plugins={dashboardTablePlugins<DashboardTableRow<BrokerMetrics>>({
            kind: "broker",
            recordKey: (broker) => broker.instanceId,
            sortDir,
            sortField,
          })}
        />
      }
      mobile={
        <Stack gap={0}>
          <Stack padding={3}>
            <MobileSortControls
              options={[
                { label: "Instance", value: "instanceId" },
                ...(!compact ? [{ label: "Started", value: "startedAt" }] : []),
                { label: "Observers", value: "clients" },
                { label: "Publishes/min", value: "messagesLastMinute" },
                ...(!compact
                  ? [{ label: "Target forwarding", value: "uplink" }]
                  : []),
                { label: "Updated", value: "lastUpdateAgeMs" },
              ]}
              sortDir={sortDir}
              sortField={sortField}
              onToggle={toggle}
            />
          </Stack>
          <List hasDividers density="balanced">
            {sortedBrokers.map((broker) => (
              <MobileRecord
                key={broker.instanceId}
                fields={[
                  {
                    label: "Instance",
                    value: (
                      <Stack
                        as="span"
                        direction="horizontal"
                        gap={2}
                        hAlign="between"
                        vAlign="center"
                      >
                        <TechnicalText>{broker.instanceId}</TechnicalText>
                        <StatusLabel tone={brokerStatusLabelTone(broker)}>
                          {brokerStatusText(broker)}
                        </StatusLabel>
                      </Stack>
                    ),
                  },
                  {
                    label: "Started",
                    value: optionalStockholmShortTime(broker.startedAt),
                  },
                  {
                    label: "Observers",
                    value: numberFormat.format(
                      broker.status === "healthy"
                        ? (broker.claimedObservers ?? broker.publisherClients)
                        : 0,
                    ),
                  },
                  {
                    label: "Publishes/min",
                    value: numberFormat.format(
                      broker.status === "healthy"
                        ? broker.messagesLastMinute || 0
                        : 0,
                    ),
                  },
                  {
                    label: "Target forwarding",
                    value: targetForwardingShortText(broker),
                  },
                  { label: "Updated", value: age(broker.lastUpdateAgeMs) },
                ]}
                kind="broker"
                recordKey={broker.instanceId}
                onClick={() => onSelect(broker)}
              />
            ))}
          </List>
        </Stack>
      }
    />
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
    <Stack gap={4} maxWidth={760} padding={4}>
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
  visibleCount,
  totalCount,
}: {
  query: string;
  setQuery: (value: string) => void;
  regions: string[];
  selectedRegion: string;
  setSelectedRegion: (value: string) => void;
  visibleCount: number;
  totalCount: number;
  countyLookup?: Record<
    string,
    { countyName: string; primaryIata: string; isPrimary: boolean }
  >;
}) {
  return (
    <Stack gap={3} paddingInline={4}>
      <Grid columns={{ minWidth: 160, max: 2, repeat: "fit" }} gap={3}>
        <TextInput
          hasClear={query.length > 0}
          label="Search"
          placeholder="Search by observer, key, or region"
          startIcon={<AstryxIcon icon="search" />}
          value={query}
          width="100%"
          onChange={setQuery}
        />
        <Selector
          hasClear={selectedRegion.length > 0}
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
      <Text color="secondary" type="supporting">
        {numberFormat.format(visibleCount)} of {numberFormat.format(totalCount)}{" "}
        observers
      </Text>
    </Stack>
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
  const observerColumns: TableColumn<DashboardTableRow<DashboardObserver>>[] = [
    {
      key: "label",
      header: (
        <SortHeader
          field="label"
          label="Observer"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(2, { minWidth: 190 }),
      renderCell: (observer: DashboardTableRow<DashboardObserver>) => {
        const statusTone = observerStatusTone(observer);
        return (
          <Stack gap={1}>
            <Button
              label={observer.label || shortKey(observer.publicKey)}
              size="sm"
              variant="ghost"
              onClick={() => onSelect(observer)}
            />
            <StatusLabel tone={statusTone ? "green" : "gray"}>
              {observerStatusText(statusTone)}
            </StatusLabel>
          </Stack>
        );
      },
    },
    {
      key: "broker",
      header: (
        <SortHeader
          field="broker"
          label="Connected through"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(1, { minWidth: 170 }),
    },
    {
      key: "region",
      header: (
        <SortHeader
          field="region"
          label="Region"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(1, { minWidth: 150 }),
      renderCell: (observer: DashboardTableRow<DashboardObserver>) =>
        observer.region ? (
          <RegionDisplay countyLookup={countyLookup} region={observer.region} />
        ) : (
          "-"
        ),
    },
    {
      key: "lastConnectedAt",
      header: (
        <SortHeader
          field="lastConnectedAt"
          label="Last connected"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(138),
      renderCell: (observer: DashboardTableRow<DashboardObserver>) =>
        stockholmShortTime(observer.lastConnectedAt),
    },
    {
      key: "lastSeenAt",
      header: (
        <SortHeader
          field="lastSeenAt"
          label="Last message"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(132),
      renderCell: (observer: DashboardTableRow<DashboardObserver>) =>
        observer.messageCount > 0
          ? stockholmShortTime(observer.lastSeenAt)
          : "-",
    },
    {
      key: "blocked",
      header: (
        <SortHeader
          field="blocked"
          label="Protection"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(126),
      renderCell: (observer: DashboardTableRow<DashboardObserver>) =>
        observer.abuse ? (
          <StatusLabel tone={denialStatusTone(observer.abuse.status)}>
            {denialStatusLabel(observer.abuse.status)}
          </StatusLabel>
        ) : (
          <StatusLabel>No events</StatusLabel>
        ),
    },
  ];

  if (visibleObservers.length === 0)
    return (
      <Empty>
        {activeOnly
          ? "No active observers right now."
          : "No observers match the current filters."}
      </Empty>
    );
  return (
    <ResponsiveRecords
      desktop={
        <Table
          hasHover
          columns={observerColumns}
          data={dashboardTableData(visibleObservers)}
          density="compact"
          dividers="rows"
          idKey="publicKey"
          plugins={dashboardTablePlugins<DashboardTableRow<DashboardObserver>>({
            kind: "observer",
            recordKey: (observer) => observer.publicKey,
            sortDir,
            sortField,
          })}
        />
      }
      mobile={
        <Stack gap={0}>
          <Stack padding={3}>
            <MobileSortControls
              options={[
                { label: "Observer", value: "label" },
                { label: "Connected through", value: "broker" },
                { label: "Region", value: "region" },
                { label: "Last connected", value: "lastConnectedAt" },
                { label: "Last message", value: "lastSeenAt" },
                { label: "Protection", value: "blocked" },
              ]}
              sortDir={sortDir}
              sortField={sortField}
              onToggle={toggle}
            />
          </Stack>
          <List hasDividers density="balanced">
            {visibleObservers.map((observer) => {
              const statusTone = observerStatusTone(observer);
              return (
                <MobileRecord
                  key={observer.publicKey}
                  fields={[
                    {
                      label: "Observer",
                      value: (
                        <Stack
                          as="span"
                          direction="horizontal"
                          gap={2}
                          hAlign="between"
                          vAlign="center"
                        >
                          {observer.label ? (
                            <Text as="span" weight="semibold">
                              {observer.label}
                            </Text>
                          ) : (
                            <TechnicalText>
                              {shortKey(observer.publicKey)}
                            </TechnicalText>
                          )}
                          <StatusLabel tone={statusTone ? "green" : "gray"}>
                            {observerStatusText(statusTone)}
                          </StatusLabel>
                        </Stack>
                      ),
                    },
                    {
                      label: "Connected through",
                      value: observer.broker,
                      technical: true,
                    },
                    {
                      label: "Region",
                      value: observer.region ? (
                        <RegionDisplay
                          countyLookup={countyLookup}
                          region={observer.region}
                        />
                      ) : (
                        "-"
                      ),
                    },
                    {
                      label: "Last connected",
                      value: stockholmShortTime(observer.lastConnectedAt),
                    },
                    {
                      label: "Last message",
                      value:
                        observer.messageCount > 0
                          ? stockholmShortTime(observer.lastSeenAt)
                          : "-",
                    },
                    {
                      label: "Blocked",
                      value: observer.abuse ? (
                        <StatusLabel
                          tone={denialStatusTone(observer.abuse.status)}
                        >
                          {denialStatusLabel(observer.abuse.status)}
                        </StatusLabel>
                      ) : (
                        <StatusLabel>No events</StatusLabel>
                      ),
                    },
                  ]}
                  kind="observer"
                  recordKey={observer.publicKey}
                  onClick={() => onSelect(observer)}
                />
              );
            })}
          </List>
        </Stack>
      }
    />
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
      subtitle="Observer details"
      title={observer.label || shortKey(observer.publicKey)}
      onClose={onClose}
    >
      <Stack gap={3}>
        <MetadataList columns="multi">
          <MetadataListItem label="Public key">
            <TechnicalValue value={observer.publicKey} />
          </MetadataListItem>
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
      </Stack>
      <Stack gap={3}>
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
      </Stack>
      <Stack gap={3}>
        <Heading level={3}>Latest neighbor snapshot</Heading>
        {observer.neighbors ? (
          <NeighborSnapshot snapshot={observer.neighbors} />
        ) : (
          <Empty>
            No /neighbors snapshot has been received from this observer yet.
          </Empty>
        )}
      </Stack>
      <Stack gap={3}>
        <Heading level={3}>Recent messages</Heading>
        <MessageTable
          countyLookup={countyLookup}
          messages={observer.messages}
        />
      </Stack>
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
  const neighborColumns: TableColumn<
    DashboardTableRow<ObserverNeighborEntry>
  >[] = [
    {
      key: "publicKey",
      header: (
        <SortHeader
          field="publicKey"
          label="Neighbor"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(2, { minWidth: 200 }),
      renderCell: (neighbor: DashboardTableRow<ObserverNeighborEntry>) => (
        <Text
          as="span"
          color="secondary"
          size="sm"
          title={neighbor.publicKey}
          type="code"
          wordBreak="break-word"
        >
          {shortKey(neighbor.publicKey)}
        </Text>
      ),
    },
    {
      key: "snr",
      header: (
        <SortHeader
          field="snr"
          label="SNR"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(88),
      renderCell: (neighbor: DashboardTableRow<ObserverNeighborEntry>) =>
        `${neighbor.snr.toFixed(1)} dB`,
    },
    {
      key: "heardSecsAgo",
      header: (
        <SortHeader
          field="heardSecsAgo"
          label="Last heard"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(100),
      renderCell: (neighbor: DashboardTableRow<ObserverNeighborEntry>) =>
        age(
          Date.now() -
            neighborLastHeardAt(snapshot.receivedAt, neighbor.heardSecsAgo),
        ),
    },
    {
      key: "scopes",
      header: (
        <SortHeader
          field="scopes"
          label="Scopes"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(2, { minWidth: 180 }),
      renderCell: (neighbor: DashboardTableRow<ObserverNeighborEntry>) => (
        <Text
          as="span"
          color="secondary"
          size="sm"
          type="code"
          wordBreak="break-word"
        >
          {neighbor.scopes.length > 0
            ? neighbor.scopes.join(", ")
            : "None reported"}
        </Text>
      ),
    },
    {
      key: "status",
      header: (
        <SortHeader
          field="status"
          label="Scope query"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(150),
      renderCell: (neighbor: DashboardTableRow<ObserverNeighborEntry>) => (
        <StatusLabel tone={neighborStatusTone(neighbor.status)}>
          {neighborStatusLabel(neighbor.status)}
        </StatusLabel>
      ),
    },
  ];
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
        <ResponsiveRecords
          desktop={
            <Table
              hasHover
              columns={neighborColumns}
              data={dashboardTableData(neighbors)}
              density="compact"
              dividers="rows"
              idKey="publicKey"
              plugins={dashboardTablePlugins<
                DashboardTableRow<ObserverNeighborEntry>
              >({
                kind: "neighbor",
                recordKey: (neighbor) => neighbor.publicKey,
                sortDir,
                sortField,
              })}
            />
          }
          mobile={
            <Stack gap={0}>
              <Stack padding={3}>
                <MobileSortControls
                  options={[
                    { label: "Neighbor", value: "publicKey" },
                    { label: "SNR", value: "snr" },
                    { label: "Last heard", value: "heardSecsAgo" },
                    { label: "Scopes", value: "scopes" },
                    { label: "Scope query", value: "status" },
                  ]}
                  sortDir={sortDir}
                  sortField={sortField}
                  onToggle={toggle}
                />
              </Stack>
              <List hasDividers density="compact">
                {neighbors.map((neighbor) => (
                  <MobileRecord
                    key={neighbor.publicKey}
                    fields={[
                      {
                        label: "Neighbor",
                        value: neighbor.publicKey,
                        technical: true,
                      },
                      { label: "SNR", value: `${neighbor.snr.toFixed(1)} dB` },
                      {
                        label: "Last heard",
                        value: age(
                          Date.now() -
                            neighborLastHeardAt(
                              snapshot.receivedAt,
                              neighbor.heardSecsAgo,
                            ),
                        ),
                      },
                      {
                        label: "Scopes",
                        value:
                          neighbor.scopes.length > 0
                            ? neighbor.scopes.join(", ")
                            : "None reported",
                        technical: true,
                      },
                      {
                        label: "Scope query",
                        value: (
                          <StatusLabel
                            tone={neighborStatusTone(neighbor.status)}
                          >
                            {neighborStatusLabel(neighbor.status)}
                          </StatusLabel>
                        ),
                      },
                    ]}
                    kind="neighbor"
                    recordKey={neighbor.publicKey}
                  />
                ))}
              </List>
            </Stack>
          }
        />
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
  const claimedObserverColumns: TableColumn<
    DashboardTableRow<DashboardObserver>
  >[] = [
    {
      key: "label",
      header: (
        <SortHeader
          field="label"
          label="Observer"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(2, { minWidth: 220 }),
      renderCell: (observer: DashboardTableRow<DashboardObserver>) => (
        <Button
          label={observer.label || shortKey(observer.publicKey)}
          size="sm"
          variant="ghost"
          onClick={() => onOpenObserver(observer)}
        />
      ),
    },
    {
      key: "region",
      header: (
        <SortHeader
          field="region"
          label="Region"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(1, { minWidth: 180 }),
      renderCell: (observer: DashboardTableRow<DashboardObserver>) =>
        observer.region ? (
          <RegionDisplay countyLookup={countyLookup} region={observer.region} />
        ) : (
          "-"
        ),
    },
    {
      key: "lastSeenAt",
      header: (
        <SortHeader
          field="lastSeenAt"
          label="Last message"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(120),
      renderCell: (observer: DashboardTableRow<DashboardObserver>) =>
        observer.messageCount > 0
          ? stockholmShortTime(observer.lastSeenAt)
          : "-",
    },
    {
      key: "messageCount",
      header: (
        <SortHeader
          field="messageCount"
          label="Runtime messages"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(160),
      renderCell: (observer: DashboardTableRow<DashboardObserver>) =>
        numberFormat.format(observer.messageCount),
    },
  ];
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
      subtitle="Broker instance details"
      title={broker.instanceId}
      onClose={onClose}
    >
      <Stack gap={3}>
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
          <MetadataListItem label="Target forwarding">
            <StatusLabel tone={targetForwardingTone(broker)}>
              {targetForwardingText(broker)}
            </StatusLabel>
          </MetadataListItem>
          <MetadataListItem label="Forwarding client ID">
            {bridge?.clientId ? (
              <TechnicalValue value={bridge.clientId} />
            ) : (
              "-"
            )}
          </MetadataListItem>
          <MetadataListItem label="Forwarded since broker start">
            {numberFormat.format(bridge?.successfulMessages || 0)}
          </MetadataListItem>
          <MetadataListItem label="Dropped since broker start">
            {numberFormat.format(bridge?.droppedMessages || 0)}
          </MetadataListItem>
        </MetadataList>
      </Stack>
      <Stack gap={3}>
        <Heading level={3}>Active observers</Heading>
        {claimedObservers.length === 0 ? (
          <Empty>This broker instance has no active observers right now.</Empty>
        ) : (
          <ResponsiveRecords
            desktop={
              <Table
                hasHover
                columns={claimedObserverColumns}
                data={dashboardTableData(claimedObservers)}
                density="compact"
                dividers="rows"
                idKey="publicKey"
                plugins={dashboardTablePlugins<
                  DashboardTableRow<DashboardObserver>
                >({
                  kind: "broker-observer",
                  recordKey: (observer) => observer.publicKey,
                  sortDir,
                  sortField,
                })}
              />
            }
            mobile={
              <Stack gap={0}>
                <Stack padding={3}>
                  <MobileSortControls
                    options={[
                      { label: "Observer", value: "label" },
                      { label: "Region", value: "region" },
                      { label: "Last message", value: "lastSeenAt" },
                      {
                        label: "Messages on this runtime",
                        value: "messageCount",
                      },
                    ]}
                    sortDir={sortDir}
                    sortField={sortField}
                    onToggle={toggle}
                  />
                </Stack>
                <List hasDividers density="compact">
                  {claimedObservers.map((observer) => (
                    <MobileRecord
                      key={observer.publicKey}
                      fields={[
                        {
                          label: "Observer",
                          value: observer.label ? (
                            observer.label
                          ) : (
                            <TechnicalText>
                              {shortKey(observer.publicKey)}
                            </TechnicalText>
                          ),
                        },
                        {
                          label: "Region",
                          value: observer.region ? (
                            <RegionDisplay
                              countyLookup={countyLookup}
                              region={observer.region}
                            />
                          ) : (
                            "-"
                          ),
                        },
                        {
                          label: "Last message",
                          value:
                            observer.messageCount > 0
                              ? stockholmShortTime(observer.lastSeenAt)
                              : "-",
                        },
                        {
                          label: "Messages on this broker runtime",
                          value: numberFormat.format(observer.messageCount),
                        },
                      ]}
                      kind="broker-observer"
                      recordKey={observer.publicKey}
                      onClick={() => onOpenObserver(observer)}
                    />
                  ))}
                </List>
              </Stack>
            }
          />
        )}
      </Stack>
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
  const messageKeys = new Map(
    messages.map((message, index) => [
      message,
      `${publishKey(message)}:${index}`,
    ]),
  );
  const messageColumns: TableColumn<DashboardTableRow<ObserverMessage>>[] = [
    {
      key: "receivedAt",
      header: (
        <SortHeader
          field="receivedAt"
          label="Time"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(75),
      renderCell: (message: DashboardTableRow<ObserverMessage>) =>
        stockholmShortTime(message.receivedAt),
    },
    {
      key: "broker",
      header: (
        <SortHeader
          field="broker"
          label="Delivery"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(2, { minWidth: 190 }),
      renderCell: (message: DashboardTableRow<ObserverMessage>) => (
        <Stack gap={0}>
          <Text type="code">{message.broker}</Text>
          {message.region ? (
            <RegionDisplay
              countyLookup={countyLookup}
              region={message.region}
            />
          ) : null}
        </Stack>
      ),
    },
    {
      key: "subtopic",
      header: (
        <SortHeader
          field="subtopic"
          label="Message"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(1, { minWidth: 130 }),
      renderCell: (message: DashboardTableRow<ObserverMessage>) => (
        <Stack gap={0}>
          <Text>{message.subtopic || "-"}</Text>
          <Text color="secondary" type="supporting">
            {numberFormat.format(message.bytes)} B
          </Text>
        </Stack>
      ),
    },
    {
      key: "topic",
      header: (
        <SortHeader
          field="topic"
          label="MQTT topic"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(3, { minWidth: 300 }),
      renderCell: (message: DashboardTableRow<ObserverMessage>) => (
        <TechnicalValue value={message.topic} />
      ),
    },
  ];
  return (
    <ResponsiveRecords
      desktop={
        <Table
          hasHover
          columns={messageColumns}
          data={dashboardTableData(sortedMsgs)}
          density="compact"
          dividers="rows"
          idKey={(message: DashboardTableRow<ObserverMessage>) =>
            messageKeys.get(message)!
          }
          plugins={dashboardTablePlugins<DashboardTableRow<ObserverMessage>>({
            kind: "message",
            recordKey: (message) => messageKeys.get(message)!,
            sortDir,
            sortField,
          })}
        />
      }
      mobile={
        <Stack gap={0}>
          <Stack padding={3}>
            <MobileSortControls
              options={[
                { label: "Time", value: "receivedAt" },
                { label: "Broker instance", value: "broker" },
                { label: "Region", value: "region" },
                { label: "Subtopic", value: "subtopic" },
                { label: "Size", value: "bytes" },
                { label: "MQTT topic", value: "topic" },
              ]}
              sortDir={sortDir}
              sortField={sortField}
              onToggle={toggle}
            />
          </Stack>
          <List hasDividers density="compact">
            {sortedMsgs.map((message) => {
              const recordKey = messageKeys.get(message)!;
              return (
                <MobileRecord
                  key={recordKey}
                  fields={[
                    {
                      label: "Time",
                      value: stockholmShortTime(message.receivedAt),
                    },
                    {
                      label: "Broker instance",
                      value: message.broker,
                      technical: true,
                    },
                    {
                      label: "Region",
                      value: message.region ? (
                        <RegionDisplay
                          countyLookup={countyLookup}
                          region={message.region}
                        />
                      ) : (
                        "-"
                      ),
                    },
                    {
                      label: "Subtopic",
                      value: message.subtopic || "-",
                      technical: true,
                    },
                    {
                      label: "Size",
                      value: `${numberFormat.format(message.bytes)} B`,
                    },
                    {
                      label: "MQTT topic",
                      value: (
                        <TechnicalValue
                          displayValue={compactTopic(message.topic)}
                          value={message.topic}
                        />
                      ),
                    },
                  ]}
                  kind="message"
                  recordKey={recordKey}
                />
              );
            })}
          </List>
        </Stack>
      }
    />
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
  const isMobile = useMediaQuery(MOBILE_RECORD_QUERY);
  const initialLimit = isMobile ? 4 : 8;
  const visiblePublishes = publishes.slice(0, expanded ? 50 : initialLimit);
  const publishColumns: TableColumn<DashboardTableRow<ObserverMessage>>[] = [
    {
      key: "receivedAt",
      header: "Time",
      width: pixel(75),
      renderCell: (publish: DashboardTableRow<ObserverMessage>) =>
        stockholmShortTime(publish.receivedAt),
    },
    {
      key: "observer",
      header: "Observer",
      width: proportional(3, { minWidth: 250 }),
      renderCell: (publish: DashboardTableRow<ObserverMessage>) => (
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
      ),
    },
    {
      key: "region",
      header: "Region",
      width: proportional(1, { minWidth: 150 }),
      renderCell: (publish: DashboardTableRow<ObserverMessage>) =>
        publish.region ? (
          <RegionDisplay countyLookup={countyLookup} region={publish.region} />
        ) : (
          "-"
        ),
    },
    {
      key: "subtopic",
      header: "Subtopic",
      width: proportional(1, { minWidth: 120 }),
      renderCell: (publish: DashboardTableRow<ObserverMessage>) =>
        publish.subtopic || "-",
    },
    {
      key: "bytes",
      header: "Size",
      width: pixel(75),
      renderCell: (publish: DashboardTableRow<ObserverMessage>) =>
        `${numberFormat.format(publish.bytes)} B`,
    },
    {
      key: "broker",
      header: "Broker instance",
      width: proportional(1, { minWidth: 150 }),
    },
  ];

  if (publishes.length === 0)
    return <Empty>No publishes have been recorded yet.</Empty>;
  return (
    <Stack gap={0}>
      <ResponsiveRecords
        desktop={
          <Table
            hasHover
            columns={publishColumns}
            data={dashboardTableData(visiblePublishes)}
            density="compact"
            dividers="rows"
            idKey={(publish: DashboardTableRow<ObserverMessage>) =>
              publishKey(publish)
            }
            plugins={dashboardTablePlugins<DashboardTableRow<ObserverMessage>>({
              kind: "publish",
              recordKey: (publish) => publishKey(publish),
            })}
          />
        }
        mobile={
          <Stack>
            <List hasDividers density="compact">
              {visiblePublishes.map((publish) => {
                const key = publishKey(publish);
                return (
                  <MobileRecord
                    key={key}
                    fields={[
                      {
                        label: "Observer",
                        value: (
                          <Stack
                            as="span"
                            direction="horizontal"
                            gap={2}
                            hAlign="between"
                            vAlign="center"
                          >
                            <Text as="span" weight="medium">
                              {publish.observer ||
                                shortKey(publish.publicKey || "") ||
                                "Observer"}
                            </Text>
                            <Text as="span" color="secondary" type="supporting">
                              {stockholmShortTime(publish.receivedAt)}
                            </Text>
                          </Stack>
                        ),
                      },
                      {
                        label: "Region",
                        value: publish.region ? (
                          <RegionDisplay
                            countyLookup={countyLookup}
                            region={publish.region}
                          />
                        ) : (
                          "-"
                        ),
                      },
                      {
                        label: "Subtopic",
                        value: publish.subtopic || "-",
                        technical: true,
                      },
                      {
                        label: "Size",
                        value: `${numberFormat.format(publish.bytes)} B`,
                      },
                      {
                        label: "Broker instance",
                        value: publish.broker,
                        technical: true,
                      },
                      {
                        label: "MQTT topic",
                        value: (
                          <TechnicalValue
                            displayValue={compactTopic(publish.topic)}
                            value={publish.topic}
                          />
                        ),
                      },
                    ]}
                    kind="publish"
                    recordKey={key}
                  />
                );
              })}
            </List>
          </Stack>
        }
      />
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
      subtitle="Protection event details"
      title={ban.label || shortKey(ban.node)}
      onClose={onClose}
    >
      <Stack gap={3}>
        <MetadataList columns="multi">
          <MetadataListItem label="Public key">
            <TechnicalValue value={ban.node} />
          </MetadataListItem>
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
          {ban.topic ? (
            <MetadataListItem label="MQTT topic">
              <TechnicalValue value={ban.topic} />
            </MetadataListItem>
          ) : null}
        </MetadataList>
      </Stack>
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
  const recordKey = (ban: BanSummary) =>
    [
      ban.node,
      ban.broker,
      ban.reason,
      ban.status,
      ban.lastUpdatedAt ?? ban.mutedUntil ?? 0,
    ].join(":");
  const banColumns: TableColumn<DashboardTableRow<BanSummary>>[] = [
    {
      key: "node",
      header: (
        <SortHeader
          field="node"
          label="Observer / key"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(2, { minWidth: 190 }),
      renderCell: (ban: DashboardTableRow<BanSummary>) => (
        <Button
          label={ban.label || shortKey(ban.node)}
          size="sm"
          variant="ghost"
          onClick={() => onSelect(ban)}
        />
      ),
    },
    {
      key: "broker",
      header: (
        <SortHeader
          field="broker"
          label="Reported by"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(1, { minWidth: 150 }),
    },
    {
      key: "reason",
      header: (
        <SortHeader
          field="reason"
          label="Reason"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(2, { minWidth: 180 }),
      renderCell: (ban: DashboardTableRow<BanSummary>) =>
        formatPublicMuteReason(ban.reason),
    },
    {
      key: "deniedUntil",
      header: (
        <SortHeader
          field="deniedUntil"
          label="Action / expiry"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(150),
      renderCell: (ban: DashboardTableRow<BanSummary>) => deniedUntilLabel(ban),
    },
    {
      key: "status",
      header: (
        <SortHeader
          field="status"
          label="Status"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(110),
      renderCell: (ban: DashboardTableRow<BanSummary>) => (
        <StatusLabel tone={denialStatusTone(ban.status)}>
          {denialStatusLabel(ban.status)}
        </StatusLabel>
      ),
    },
  ];
  return (
    <ResponsiveRecords
      desktop={
        <Table
          hasHover
          columns={banColumns}
          data={dashboardTableData(sortedBans)}
          density="compact"
          dividers="rows"
          idKey={(ban: DashboardTableRow<BanSummary>) => recordKey(ban)}
          plugins={dashboardTablePlugins<DashboardTableRow<BanSummary>>({
            kind: "ban",
            recordKey,
            sortDir,
            sortField,
          })}
        />
      }
      mobile={
        <Stack gap={0}>
          <Stack padding={3}>
            <MobileSortControls
              options={[
                { label: "Observer / key", value: "node" },
                { label: "Reported by", value: "broker" },
                { label: "Reason", value: "reason" },
                { label: "Action / expiry", value: "deniedUntil" },
                { label: "Status", value: "status" },
              ]}
              sortDir={sortDir}
              sortField={sortField}
              onToggle={toggle}
            />
          </Stack>
          <List hasDividers density="compact">
            {sortedBans.map((ban) => {
              const key = recordKey(ban);
              return (
                <MobileRecord
                  key={key}
                  fields={[
                    {
                      label: "Observer / key",
                      value: (
                        <Stack
                          as="span"
                          direction="horizontal"
                          gap={2}
                          hAlign="between"
                          vAlign="center"
                        >
                          {ban.label ? (
                            <Text as="span" weight="semibold">
                              {ban.label}
                            </Text>
                          ) : (
                            <TechnicalText>{shortKey(ban.node)}</TechnicalText>
                          )}
                          <StatusLabel tone={denialStatusTone(ban.status)}>
                            {denialStatusLabel(ban.status)}
                          </StatusLabel>
                        </Stack>
                      ),
                    },
                    {
                      label: "Reported by",
                      value: ban.broker,
                      technical: true,
                    },
                    {
                      label: "Reason",
                      value: formatPublicMuteReason(ban.reason),
                    },
                    {
                      label: "Action / expiry",
                      value: deniedUntilLabel(ban),
                    },
                  ]}
                  kind="ban"
                  recordKey={key}
                  onClick={() => onSelect(ban)}
                />
              );
            })}
          </List>
        </Stack>
      }
    />
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
    <Stack as="span" direction="horizontal" gap={2} wrap="wrap">
      {visibleTopics.map((topic) => (
        <TechnicalText key={topic} title={topic}>
          {compactTopic(topic)}
        </TechnicalText>
      ))}
      {hiddenCount > 0 ? (
        <Text as="span" color="secondary" type="supporting">
          +{numberFormat.format(hiddenCount)} more
        </Text>
      ) : null}
      {truncated ? (
        <Text as="span" color="secondary" type="supporting">
          Additional topics not shown
        </Text>
      ) : null}
    </Stack>
  );
}

function TechnicalTopicList({
  topics,
  truncated = false,
}: {
  topics: string[];
  truncated?: boolean;
}) {
  if (topics.length === 0 && !truncated) {
    return (
      <Text color="secondary" type="supporting">
        No active subscriptions
      </Text>
    );
  }
  return (
    <Stack gap={2}>
      {topics.map((topic) => (
        <TechnicalValue key={topic} value={topic} />
      ))}
      {truncated ? (
        <Text color="secondary" type="supporting">
          Additional topic filters are not retained for dashboard display.
        </Text>
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
  const subscriberColumns: TableColumn<
    DashboardTableRow<SubscriberConnectionEntry>
  >[] = [
    {
      key: "username",
      header: (
        <SortHeader
          field="username"
          label="Username"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(1, { minWidth: 150 }),
      renderCell: (
        subscriber: DashboardTableRow<SubscriberConnectionEntry>,
      ) => (
        <Button
          label={subscriber.username}
          size="sm"
          variant="ghost"
          onClick={() => onSelect(subscriber)}
        />
      ),
    },
    {
      key: "brokersStr",
      header: (
        <SortHeader
          field="brokersStr"
          label="Connected through"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(2, { minWidth: 200 }),
      renderCell: (
        subscriber: DashboardTableRow<SubscriberConnectionEntry>,
      ) => (
        <Stack direction="horizontal" gap={2} wrap="wrap">
          {subscriber.brokers.map((broker) => (
            <Token
              key={broker.brokerId}
              label={`${broker.brokerId} (${numberFormat.format(broker.connectionCount)})`}
              size="sm"
            />
          ))}
        </Stack>
      ),
    },
    {
      key: "subscriptionsStr",
      header: (
        <SortHeader
          field="subscriptionsStr"
          label="Subscriptions"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: proportional(3, { minWidth: 250 }),
      renderCell: (
        subscriber: DashboardTableRow<SubscriberConnectionEntry>,
      ) => (
        <SubscriptionList
          limit={3}
          topics={subscriber.subscriptions}
          truncated={subscriber.subscriptionsTruncated}
        />
      ),
    },
    {
      key: "connectionCount",
      header: (
        <SortHeader
          field="connectionCount"
          label="Connections"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(132),
      renderCell: (subscriber: DashboardTableRow<SubscriberConnectionEntry>) =>
        numberFormat.format(subscriber.connectionCount),
    },
    {
      key: "lastSeenAt",
      header: (
        <SortHeader
          field="lastSeenAt"
          label="Last active"
          sortDir={sortDir}
          sortField={sortField}
          onToggle={toggle}
        />
      ),
      width: pixel(126),
      renderCell: (subscriber: DashboardTableRow<SubscriberConnectionEntry>) =>
        subscriber.lastSeenAt > 0
          ? stockholmShortTime(subscriber.lastSeenAt)
          : "-",
    },
  ];
  return (
    <ResponsiveRecords
      desktop={
        <Table
          hasHover
          columns={subscriberColumns}
          data={dashboardTableData(sorted)}
          density="compact"
          dividers="rows"
          idKey="username"
          plugins={dashboardTablePlugins<
            DashboardTableRow<SubscriberConnectionEntry>
          >({
            kind: "subscriber",
            recordKey: (subscriber) => subscriber.username,
            sortDir,
            sortField,
          })}
        />
      }
      mobile={
        <Stack gap={0}>
          <Stack padding={3}>
            <MobileSortControls
              options={[
                { label: "Username", value: "username" },
                { label: "Connected through", value: "brokersStr" },
                { label: "Subscriptions", value: "subscriptionsStr" },
                { label: "Connections", value: "connectionCount" },
                { label: "Last active", value: "lastSeenAt" },
              ]}
              sortDir={sortDir}
              sortField={sortField}
              onToggle={toggle}
            />
          </Stack>
          <List hasDividers density="compact">
            {sorted.map((sub) => (
              <MobileRecord
                key={sub.username}
                fields={[
                  {
                    label: "Username",
                    value: (
                      <Stack
                        as="span"
                        direction="horizontal"
                        gap={2}
                        hAlign="between"
                        vAlign="center"
                      >
                        <TechnicalText>{sub.username}</TechnicalText>
                        <Text as="span" color="secondary" type="supporting">
                          {numberFormat.format(sub.connectionCount)} connections
                        </Text>
                      </Stack>
                    ),
                  },
                  {
                    label: "Connected through",
                    value: (
                      <Stack as="span" gap={1}>
                        {sub.brokers.map((broker) => (
                          <TechnicalText key={broker.brokerId}>
                            {broker.brokerId} (
                            {numberFormat.format(broker.connectionCount)})
                          </TechnicalText>
                        ))}
                      </Stack>
                    ),
                  },
                  {
                    label: "Subscriptions",
                    value: (
                      <SubscriptionList
                        limit={3}
                        topics={sub.subscriptions}
                        truncated={sub.subscriptionsTruncated}
                      />
                    ),
                  },
                  {
                    label: "Last active",
                    value:
                      sub.lastSeenAt > 0
                        ? stockholmShortTime(sub.lastSeenAt)
                        : "-",
                  },
                ]}
                kind="subscriber"
                recordKey={sub.username}
                onClick={() => onSelect(sub)}
              />
            ))}
          </List>
        </Stack>
      }
    />
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
      onClose={onClose}
    >
      <Stack gap={3}>
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
      </Stack>
      <Stack gap={3}>
        <Heading level={3}>Subscribed topic filters</Heading>
        <TechnicalTopicList
          topics={sub.subscriptions}
          truncated={sub.subscriptionsTruncated}
        />
      </Stack>
      <Stack gap={3}>
        <List hasDividers density="compact" header="Active connections">
          {sub.connections.map((connection, index) => (
            <ListItem
              key={`${connection.brokerId}-${connection.clientId}-${index}`}
              description={
                <Stack gap={2}>
                  <Text color="secondary" type="supporting">
                    {connection.brokerId}
                  </Text>
                  <TechnicalTopicList
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
              label={<TechnicalValue value={connection.clientId} />}
            />
          ))}
        </List>
      </Stack>
    </ModalShell>
  );
}
function Panel({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Section padding={0} variant="transparent">
      <Stack gap={0}>
        {title || subtitle ? (
          <Stack gap={2} padding={5}>
            {title ? <Heading level={2}>{title}</Heading> : null}
            {subtitle ? (
              <Text color="secondary" type="body">
                {subtitle}
              </Text>
            ) : null}
          </Stack>
        ) : null}
        <Stack gap={4} padding={0}>
          {children}
        </Stack>
      </Stack>
    </Section>
  );
}

function PageHeader({
  copy,
  activeBrokers,
  totalBrokers,
  respondingBroker,
  namespace,
  updatedAt,
}: {
  copy: { eyebrow: string; title: string; description: string };
  activeBrokers: number;
  totalBrokers: number;
  respondingBroker: string;
  namespace: string;
  updatedAt: Date;
}) {
  const isMobile = useMediaQuery(MOBILE_RECORD_QUERY);
  const metadata = (
    <MetadataList
      columns={isMobile ? 2 : undefined}
      orientation={isMobile ? "vertical" : "horizontal"}
    >
      <MetadataListItem label="Active brokers">
        <Text hasTabularNumbers>
          {numberFormat.format(activeBrokers)} of{" "}
          {numberFormat.format(totalBrokers)}
        </Text>
      </MetadataListItem>
      <MetadataListItem label="Data source">
        <TechnicalText>{respondingBroker}</TechnicalText>
      </MetadataListItem>
      <MetadataListItem label="Namespace">
        <TechnicalText>{namespace}</TechnicalText>
      </MetadataListItem>
      <MetadataListItem label="Updated">
        <Text hasTabularNumbers>
          {headerTimeFormat.format(updatedAt)} ·{" "}
          {headerDateFormat.format(updatedAt)}
        </Text>
      </MetadataListItem>
    </MetadataList>
  );

  return (
    <Section padding={isMobile ? 4 : 5} variant="muted">
      <Grid
        columns={{ minWidth: 260, max: 2, repeat: "fit" }}
        gap={isMobile ? 3 : 6}
      >
        <Stack gap={1.5}>
          {!isMobile ? (
            <Text color="accent" type="label">
              {copy.eyebrow}
            </Text>
          ) : null}
          <Stack aria-live="polite">
            <Heading id="dashboard-page-title" level={1}>
              {copy.title}
            </Heading>
          </Stack>
          <Text
            color="secondary"
            textWrap="pretty"
            type={isMobile ? "supporting" : "body"}
          >
            {copy.description}
          </Text>
          {isMobile ? (
            <Text color="secondary" type="supporting">
              {numberFormat.format(activeBrokers)} of{" "}
              {numberFormat.format(totalBrokers)} brokers active · Updated{" "}
              {headerTimeFormat.format(updatedAt)}
            </Text>
          ) : null}
        </Stack>
        {isMobile ? (
          <Collapsible
            defaultIsOpen={false}
            trigger={
              <Stack paddingBlock={0.5}>
                <Text type="body">Cluster details</Text>
              </Stack>
            }
          >
            <Stack paddingBlock={2}>{metadata}</Stack>
          </Collapsible>
        ) : (
          metadata
        )}
      </Grid>
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
      "Health, traffic, and target forwarding status for every reporting broker instance.",
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
        <Stack gap={6}>
          <Panel>
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
        </Stack>
      );
    }
    if (view === "observers") {
      return (
        <Panel>
          <ObserverSearch
            countyLookup={snapshot?.countyLookup}
            query={query}
            regions={observerRegions}
            selectedRegion={regionFilter}
            setQuery={setQuery}
            setSelectedRegion={setRegionFilter}
            totalCount={observers.length}
            visibleCount={filteredObservers.length}
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
          subtitle={
            summary.protectionEventsTruncated
              ? "Showing the latest 50 events."
              : undefined
          }
        >
          <BanTable bans={allBans} onSelect={setSelectedBan} />
        </Panel>
      );
    }
    if (view === "subscribers") {
      return (
        <Panel>
          <SubscriberTable
            snapshotError={snapshot?.error}
            subscribers={snapshot?.subscribers ?? []}
            onSelect={setSelectedSubscriber}
          />
        </Panel>
      );
    }
    return (
      <Stack gap={6}>
        <Grid
          aria-label="Cluster metrics"
          columns={{ minWidth: 160, max: 4, repeat: "fit" }}
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
        <ObserverLookup
          countyLookup={snapshot?.countyLookup}
          onOpenObserver={setSelectedObserver}
        />
        <Grid columns={{ minWidth: 520, max: 2, repeat: "fit" }} gap={6}>
          <Panel
            subtitle="Health of the broker instances behind the load balancer."
            title="Broker instances"
          >
            <BrokerTable
              compact
              brokers={brokers}
              onSelect={setSelectedBroker}
            />
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
    document.title = `${currentPage.title} | MeshCore MQTT`;
  }, [currentPage.title, view]);

  return (
    <Theme mode="dark" theme={gothicTheme}>
      <AppShell
        contentPadding={0}
        height="auto"
        sideNav={
          <SideNav
            collapsible={{ buttonLabel: "Collapse navigation" }}
            resizable={{
              autoSaveId: "meshat-dashboard-sidenav",
              defaultWidth: 280,
              maxWidth: 380,
              minWidth: 240,
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
                superheading="Meshat.se"
              />
            }
            label="Dashboard navigation"
          />
        }
        variant="section"
      >
        <Stack gap={0} hAlign="center">
          <Stack gap={5} maxWidth={1440} padding={6} width="100%">
            <PageHeader
              activeBrokers={summary.activeBrokers}
              copy={currentPage}
              namespace={namespace}
              respondingBroker={respondingBroker}
              totalBrokers={summary.totalBrokers}
              updatedAt={date}
            />

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
