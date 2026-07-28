import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  DashboardSnapshot,
  DashboardObserver,
  BanSummary,
  BrokerMetrics,
  SortDir,
} from "../types.js";
import { MetricCard } from "../components/shared/metric-card.js";
import { StatusBadge } from "../components/shared/status-badge.js";
import TimeAgo from "../components/ui/time-ago.js";
import SearchBar from "../components/ui/search-bar.js";
import { shortKey, age, numberFormat } from "../helpers/time.js";
import {
  formatDeniedUntilLabel,
  formatPublicMuteReason,
  formatDenialStatus,
} from "../helpers/format.js";
import {
  Alert,
  Box,
  Button,
  CardActionArea,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { People, ShowChart, Shield } from "@mui/icons-material";

type OverviewObserverSortField = "label" | "messageCount";
type OverviewBanSortField = "node" | "blockCount";

const visuallyHiddenCaptionStyle: CSSProperties = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: 1,
  margin: -1,
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: 1,
};

function compareDisplayText(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function observerName(observer: DashboardObserver): string {
  return observer.label || observer.publicKey;
}

function banName(ban: BanSummary): string {
  return ban.label || ban.node;
}

function banStableKey(ban: BanSummary): string {
  if (ban.eventId) return JSON.stringify(["event-id", ban.eventId]);
  if (ban.status !== "denied") {
    return JSON.stringify(["active", ban.status, ban.node]);
  }
  return [
    "event",
    ban.node,
    ban.broker,
    ban.reason,
    ban.topic ?? "",
    ban.lastUpdatedAt ?? "",
    ban.region ?? "",
    ban.deniedUntilText ?? "",
  ].join("\u0000");
}

function brokerHealth(broker: BrokerMetrics) {
  if (!broker.ready) {
    return { label: "Not ready", color: "error" as const };
  }
  if (broker.status === "stale") {
    return { label: "Stale", color: "warning" as const };
  }
  return { label: "Healthy", color: "success" as const };
}

function bridgeHealth(bridge: BrokerMetrics["targetBridge"]) {
  if (!bridge) return { label: "Not reported", color: "default" as const };
  if (!bridge.enabled) return { label: "Disabled", color: "default" as const };
  if (bridge.connected) {
    return { label: "Connected", color: "success" as const };
  }
  return { label: "Disconnected", color: "error" as const };
}

function RecordDetailsButton({
  label,
  accessibleLabel,
  onSelect,
}: {
  label: string;
  accessibleLabel: string;
  onSelect: () => void;
}) {
  return (
    <Button
      fullWidth
      size="small"
      aria-label={accessibleLabel}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      sx={{
        minWidth: 0,
        minHeight: 44,
        p: 0,
        justifyContent: "flex-start",
        textAlign: "left",
        textTransform: "none",
        lineHeight: 1.35,
        overflowWrap: "anywhere",
      }}
    >
      {label}
    </Button>
  );
}

interface OverviewProps {
  snapshot: DashboardSnapshot;
  onSelectObserver: (observer: DashboardObserver) => void;
  onSelectBan: (ban: BanSummary) => void;
  onNavigate: (
    view: "overview" | "observers" | "meshcoreio" | "bans" | "subscribers",
  ) => void;
}

function renderDenialStatus(status: string) {
  const { label, color } = formatDenialStatus(status);
  return <StatusBadge label={label} color={color} />;
}

function SectionHeader({
  title,
  headingId,
  action,
}: {
  title: string;
  headingId: string;
  action?: ReactNode;
}) {
  return (
    <Box
      sx={{
        px: 2,
        py: 1.25,
        minHeight: 52,
        borderBottom: 1,
        borderColor: "divider",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 2,
      }}
    >
      <Typography id={headingId} variant="subtitle1" component="h2">
        {title}
      </Typography>
      {action}
    </Box>
  );
}

export default function OverviewView({
  snapshot,
  onSelectObserver,
  onSelectBan,
  onNavigate,
}: OverviewProps) {
  const theme = useTheme();
  const compactLayout = useMediaQuery(theme.breakpoints.down("lg"));
  const [search, setSearch] = useState("");
  const [observerSortField, setObserverSortField] =
    useState<OverviewObserverSortField>("messageCount");
  const [observerSortDir, setObserverSortDir] = useState<SortDir>("desc");
  const [banSortField, setBanSortField] =
    useState<OverviewBanSortField>("blockCount");
  const [banSortDir, setBanSortDir] = useState<SortDir>("desc");

  const {
    summary,
    brokers,
    respondingBroker,
    observers,
    recentPublishes,
    bans,
    meshcoreIo,
  } = snapshot;

  const sortedBrokers = useMemo(
    () =>
      [...brokers].sort((a, b) =>
        compareDisplayText(a.instanceId, b.instanceId),
      ),
    [brokers],
  );

  const filteredObservers = useMemo(() => {
    if (!search.trim()) return observers;
    const query = search.trim().toLowerCase();
    return observers.filter(
      (observer) =>
        observer.label.toLowerCase().includes(query) ||
        observer.publicKey.toLowerCase().includes(query),
    );
  }, [observers, search]);

  const sortedObservers = useMemo(() => {
    const direction = observerSortDir === "asc" ? 1 : -1;
    return [...filteredObservers].sort((a, b) => {
      const comparison =
        observerSortField === "label"
          ? compareDisplayText(observerName(a), observerName(b))
          : a.messageCount - b.messageCount;
      if (comparison !== 0) return comparison * direction;
      return compareDisplayText(a.publicKey, b.publicKey);
    });
  }, [filteredObservers, observerSortField, observerSortDir]);

  const sortedBans = useMemo(() => {
    const direction = banSortDir === "asc" ? 1 : -1;
    return [...bans].sort((a, b) => {
      const comparison =
        banSortField === "node"
          ? compareDisplayText(banName(a), banName(b))
          : a.blockCount - b.blockCount;
      if (comparison !== 0) return comparison * direction;
      return compareDisplayText(banStableKey(a), banStableKey(b));
    });
  }, [bans, banSortField, banSortDir]);

  const topObservers = sortedObservers.slice(0, 10);
  const topBans = sortedBans.slice(0, 10);

  function handleObserverSort(field: OverviewObserverSortField) {
    if (observerSortField === field) {
      setObserverSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setObserverSortField(field);
      setObserverSortDir("desc");
    }
  }

  function handleBanSort(field: OverviewBanSortField) {
    if (banSortField === field) {
      setBanSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setBanSortField(field);
      setBanSortDir("desc");
    }
  }

  return (
    <Box>
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        Overview
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricCard
            label="Connected observers"
            value={numberFormat.format(summary.connectedObservers)}
            note={`${numberFormat.format(summary.connectedClients)} total clients`}
            icon={<People />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricCard
            label="Public publishes"
            value={numberFormat.format(summary.publishesLastMinute)}
            note={`Last minute · ${summary.messagesPerSecond.toFixed(1)}/s`}
            icon={<ShowChart />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 12, md: 4 }}>
          <MetricCard
            label="Protection events"
            value={numberFormat.format(summary.protectionEventsTotal)}
            note={
              summary.protectionEventsTruncated
                ? `${summary.activeBans} active blocks · ${summary.protectionEventsShown} of ${summary.protectionEventsTotal} event records shown`
                : `${summary.activeBans} active blocks · ${summary.protectionEventsShown} event records shown`
            }
            icon={<Shield />}
          />
        </Grid>
      </Grid>

      <Paper
        component="section"
        aria-labelledby="broker-health-heading"
        sx={{ mb: 3, overflow: "hidden" }}
      >
        <SectionHeader
          title="Broker and target-bridge health"
          headingId="broker-health-heading"
          action={
            <StatusBadge
              label={
                summary.totalBrokers === 0
                  ? "No broker reports"
                  : `${numberFormat.format(summary.activeBrokers)} of ${numberFormat.format(summary.totalBrokers)} healthy`
              }
              color={
                summary.totalBrokers === 0
                  ? "default"
                  : summary.activeBrokers === summary.totalBrokers
                    ? "success"
                    : "warning"
              }
            />
          }
        />
        <Box
          component="dl"
          sx={{
            m: 0,
            px: 2,
            py: 1.5,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "auto minmax(0, 1fr)" },
            gap: { xs: 0.5, sm: 2 },
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Typography component="dt" variant="body2" color="text.secondary">
            Dashboard response from
          </Typography>
          <Typography
            component="dd"
            variant="body2"
            sx={{
              m: 0,
              fontFamily: "monospace",
              overflowWrap: "anywhere",
            }}
          >
            {respondingBroker || "Not reported"}
          </Typography>
        </Box>
        {sortedBrokers.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 3, textAlign: "center" }}>
            No broker health reports are available in this snapshot.
          </Typography>
        ) : (
          <Stack
            divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}
          >
            {sortedBrokers.map((broker) => {
              const health = brokerHealth(broker);
              const bridge = bridgeHealth(broker.targetBridge);
              return (
                <Box
                  component="article"
                  key={broker.instanceId}
                  sx={{ px: 2, py: 1.5, minWidth: 0 }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 1.5,
                    }}
                  >
                    <Typography
                      variant="subtitle2"
                      component="h3"
                      sx={{
                        minWidth: 0,
                        fontFamily: "monospace",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {broker.instanceId}
                    </Typography>
                    <StatusBadge label={health.label} color={health.color} />
                  </Box>
                  <Box
                    component="dl"
                    sx={{
                      m: 0,
                      mt: 1,
                      display: "grid",
                      gridTemplateColumns: {
                        xs: "minmax(0, 1fr) auto",
                        sm: "minmax(0, 1fr) auto minmax(0, 1fr) auto",
                      },
                      columnGap: 1.5,
                      rowGap: 0.5,
                    }}
                  >
                    <Typography
                      component="dt"
                      variant="caption"
                      color="text.secondary"
                    >
                      Connected clients
                    </Typography>
                    <Typography
                      component="dd"
                      variant="body2"
                      sx={{ m: 0, textAlign: "right" }}
                    >
                      {numberFormat.format(broker.connectedClients)}
                    </Typography>
                    <Typography
                      component="dt"
                      variant="caption"
                      color="text.secondary"
                    >
                      Publishes / min
                    </Typography>
                    <Typography
                      component="dd"
                      variant="body2"
                      sx={{ m: 0, textAlign: "right" }}
                    >
                      {numberFormat.format(broker.messagesLastMinute)}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      mt: 1,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 1.5,
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      Target bridge
                    </Typography>
                    <StatusBadge label={bridge.label} color={bridge.color} />
                  </Box>
                  {broker.targetBridge?.enabled && (
                    <Box sx={{ mt: 0.75, minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        Target
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: "monospace",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {broker.targetBridge.targetUrl ||
                          broker.targetBridge.targetHost ||
                          "Address not reported"}
                      </Typography>
                      {broker.targetBridge.clientId && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="div"
                          sx={{
                            fontFamily: "monospace",
                            overflowWrap: "anywhere",
                          }}
                        >
                          Client ID: {broker.targetBridge.clientId}
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </Paper>

      <Box sx={{ mb: 2 }}>
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search observers by name or key…"
        />
      </Box>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Paper
            component="section"
            aria-labelledby="active-observers-heading"
            sx={{ overflow: "hidden" }}
          >
            <SectionHeader
              title="Most active observers"
              headingId="active-observers-heading"
              action={
                <Button size="small" onClick={() => onNavigate("observers")}>
                  View all
                </Button>
              }
            />
            {topObservers.length === 0 ? (
              <Typography
                color="text.secondary"
                sx={{ p: 3, textAlign: "center" }}
              >
                {observers.length === 0
                  ? "No observers have reported yet."
                  : "No observers match the current search."}
              </Typography>
            ) : compactLayout ? (
              <Stack
                divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}
              >
                {topObservers.map((observer) => (
                  <CardActionArea
                    key={observer.publicKey}
                    onClick={() => onSelectObserver(observer)}
                    sx={{ px: 2, py: 1.25 }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 1.5,
                      }}
                    >
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 500, overflowWrap: "anywhere" }}
                        >
                          {observer.label || shortKey(observer.publicKey)}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="div"
                          sx={{
                            fontFamily: "monospace",
                            mt: 0.25,
                            overflowWrap: "anywhere",
                          }}
                        >
                          {observer.publicKey}
                        </Typography>
                      </Box>
                      <Box sx={{ flexShrink: 0, pt: 0.25 }}>
                        <StatusBadge
                          label={observer.active ? "Online" : "Offline"}
                          color={observer.active ? "success" : "default"}
                        />
                      </Box>
                    </Box>
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 1.5,
                        mt: 1,
                      }}
                    >
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Messages
                        </Typography>
                        <Typography variant="body2">
                          {numberFormat.format(observer.messageCount)}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Last seen
                        </Typography>
                        <Typography variant="body2">
                          {age(Date.now() - observer.lastSeenAt)}
                        </Typography>
                      </Box>
                    </Box>
                  </CardActionArea>
                ))}
              </Stack>
            ) : (
              <TableContainer sx={{ overflowX: "hidden" }}>
                <Table
                  size="small"
                  sx={{ tableLayout: "fixed", width: "100%" }}
                >
                  <caption style={visuallyHiddenCaptionStyle}>
                    Most active observers matching the current search
                  </caption>
                  <TableHead>
                    <TableRow>
                      <TableCell
                        sortDirection={
                          observerSortField === "label"
                            ? observerSortDir
                            : false
                        }
                        sx={{ width: "40%" }}
                      >
                        <TableSortLabel
                          active={observerSortField === "label"}
                          direction={
                            observerSortField === "label"
                              ? observerSortDir
                              : "asc"
                          }
                          onClick={() => handleObserverSort("label")}
                        >
                          Observer
                        </TableSortLabel>
                      </TableCell>
                      <TableCell
                        align="right"
                        sortDirection={
                          observerSortField === "messageCount"
                            ? observerSortDir
                            : false
                        }
                        sx={{ width: "18%" }}
                      >
                        <TableSortLabel
                          active={observerSortField === "messageCount"}
                          direction={
                            observerSortField === "messageCount"
                              ? observerSortDir
                              : "asc"
                          }
                          onClick={() => handleObserverSort("messageCount")}
                        >
                          Messages
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ width: "24%" }}>Last seen</TableCell>
                      <TableCell sx={{ width: "18%" }}>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {topObservers.map((observer) => (
                      <TableRow
                        key={observer.publicKey}
                        hover
                        onClick={() => onSelectObserver(observer)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell sx={{ minWidth: 0 }}>
                          <RecordDetailsButton
                            label={observerName(observer)}
                            accessibleLabel={`View observer details for ${observerName(observer)}`}
                            onSelect={() => onSelectObserver(observer)}
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            component="div"
                            sx={{
                              fontFamily: "monospace",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {observer.publicKey}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {numberFormat.format(observer.messageCount)}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {age(Date.now() - observer.lastSeenAt)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            label={observer.active ? "Online" : "Offline"}
                            color={observer.active ? "success" : "default"}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, lg: 4 }}>
          <Paper
            component="section"
            aria-labelledby="meshcore-io-heading"
            sx={{ overflow: "hidden" }}
          >
            <SectionHeader
              title="MeshCore.io"
              headingId="meshcore-io-heading"
              action={
                meshcoreIo?.enabled ? (
                  <Button size="small" onClick={() => onNavigate("meshcoreio")}>
                    Open
                  </Button>
                ) : undefined
              }
            />
            {meshcoreIo === undefined ? (
              <Stack spacing={1} sx={{ p: 2 }}>
                <StatusBadge label="Unavailable" color="warning" />
                <Typography variant="body2" color="text.secondary">
                  MeshCore.io state was not included in this dashboard response.
                  This is different from a configured integration being
                  disabled.
                </Typography>
              </Stack>
            ) : !meshcoreIo.enabled ? (
              <Stack spacing={1} sx={{ p: 2 }}>
                <StatusBadge label="Disabled" color="default" />
                <Typography variant="body2" color="text.secondary">
                  The MeshCore.io integration is configured as disabled.
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={1.5} sx={{ p: 2 }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 2,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Processor
                  </Typography>
                  <StatusBadge
                    label={
                      meshcoreIo.processor.status === "healthy"
                        ? "Healthy"
                        : "Disabled"
                    }
                    color={
                      meshcoreIo.processor.status === "healthy"
                        ? "success"
                        : "default"
                    }
                  />
                </Box>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 2,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Queue total
                  </Typography>
                  <Typography variant="body2">
                    {numberFormat.format(meshcoreIo.queue.total)}
                    {meshcoreIo.queue.maxQueuedUploads > 0 &&
                      ` / ${numberFormat.format(meshcoreIo.queue.maxQueuedUploads)}`}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 2,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Uploaded
                  </Typography>
                  <Typography variant="body2">
                    {numberFormat.format(meshcoreIo.totals.uploaded)}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 2,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Dropped
                  </Typography>
                  <Typography
                    variant="body2"
                    color={
                      meshcoreIo.totals.dropped > 0 ? "error.main" : undefined
                    }
                  >
                    {numberFormat.format(meshcoreIo.totals.dropped)}
                  </Typography>
                </Box>
                {meshcoreIo.lastError && (
                  <Alert
                    severity="error"
                    sx={{
                      minWidth: 0,
                      "& .MuiAlert-message": {
                        minWidth: 0,
                        overflowWrap: "anywhere",
                      },
                    }}
                  >
                    {meshcoreIo.lastError}
                  </Alert>
                )}
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Paper
            component="section"
            aria-labelledby="protection-events-heading"
            sx={{ overflow: "hidden" }}
          >
            <SectionHeader
              title="Protection events"
              headingId="protection-events-heading"
              action={
                topBans.length > 0 ? (
                  <Button size="small" onClick={() => onNavigate("bans")}>
                    View all
                  </Button>
                ) : undefined
              }
            />
            {topBans.length === 0 ? (
              <Typography
                color="text.secondary"
                sx={{ p: 3, textAlign: "center" }}
              >
                No protection events were reported in this dashboard snapshot.
              </Typography>
            ) : compactLayout ? (
              <Stack
                divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}
              >
                {topBans.map((ban) => (
                  <CardActionArea
                    key={banStableKey(ban)}
                    onClick={() => onSelectBan(ban)}
                    sx={{ px: 2, py: 1.25 }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 1.5,
                      }}
                    >
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 500, overflowWrap: "anywhere" }}
                        >
                          {banName(ban)}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="div"
                          sx={{ mt: 0.25, overflowWrap: "anywhere" }}
                        >
                          {formatPublicMuteReason(ban.reason)}
                        </Typography>
                      </Box>
                      <Box sx={{ flexShrink: 0, pt: 0.25 }}>
                        {renderDenialStatus(ban.status)}
                      </Box>
                    </Box>
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "1fr 2fr",
                        gap: 1.5,
                        mt: 1,
                      }}
                    >
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Blocks
                        </Typography>
                        <Typography variant="body2">
                          {numberFormat.format(ban.blockCount)}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Action / expiry
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ overflowWrap: "anywhere" }}
                        >
                          {formatDeniedUntilLabel(ban)}
                        </Typography>
                      </Box>
                    </Box>
                  </CardActionArea>
                ))}
              </Stack>
            ) : (
              <TableContainer sx={{ overflowX: "hidden" }}>
                <Table
                  size="small"
                  sx={{ tableLayout: "fixed", width: "100%" }}
                >
                  <caption style={visuallyHiddenCaptionStyle}>
                    Recent protection events with current block or warning
                    status
                  </caption>
                  <TableHead>
                    <TableRow>
                      <TableCell
                        sortDirection={
                          banSortField === "node" ? banSortDir : false
                        }
                        sx={{ width: "25%" }}
                      >
                        <TableSortLabel
                          active={banSortField === "node"}
                          direction={
                            banSortField === "node" ? banSortDir : "asc"
                          }
                          onClick={() => handleBanSort("node")}
                        >
                          Observer
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ width: "23%" }}>Reason</TableCell>
                      <TableCell
                        align="right"
                        sortDirection={
                          banSortField === "blockCount" ? banSortDir : false
                        }
                        sx={{ width: "12%" }}
                      >
                        <TableSortLabel
                          active={banSortField === "blockCount"}
                          direction={
                            banSortField === "blockCount" ? banSortDir : "asc"
                          }
                          onClick={() => handleBanSort("blockCount")}
                        >
                          Blocks
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ width: "24%" }}>
                        Action / expiry
                      </TableCell>
                      <TableCell sx={{ width: "16%" }}>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {topBans.map((ban) => (
                      <TableRow
                        key={banStableKey(ban)}
                        hover
                        onClick={() => onSelectBan(ban)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell sx={{ minWidth: 0 }}>
                          <RecordDetailsButton
                            label={banName(ban)}
                            accessibleLabel={`View protection event details for ${banName(ban)}`}
                            onSelect={() => onSelectBan(ban)}
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            component="div"
                            sx={{
                              fontFamily: "monospace",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {ban.node}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ overflowWrap: "anywhere" }}>
                          <Typography
                            variant="body2"
                            sx={{ overflowWrap: "anywhere" }}
                          >
                            {formatPublicMuteReason(ban.reason)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {numberFormat.format(ban.blockCount)}
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ overflowWrap: "anywhere" }}
                          >
                            {formatDeniedUntilLabel(ban)}
                          </Typography>
                        </TableCell>
                        <TableCell>{renderDenialStatus(ban.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Paper
            component="section"
            aria-labelledby="recent-publishes-heading"
            sx={{ overflow: "hidden" }}
          >
            <SectionHeader
              title="Recent publishes"
              headingId="recent-publishes-heading"
            />
            {recentPublishes.length === 0 ? (
              <Typography
                color="text.secondary"
                sx={{ p: 3, textAlign: "center" }}
              >
                No publishes have been reported yet.
              </Typography>
            ) : compactLayout ? (
              <Stack
                divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}
              >
                {recentPublishes.slice(0, 50).map((message, index) => (
                  <Box
                    key={`${message.receivedAt}-${message.topic}-${index}`}
                    sx={{ px: 2, py: 1.25 }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.8125rem",
                        lineHeight: 1.5,
                        overflowWrap: "anywhere",
                        mb: 1,
                      }}
                    >
                      {message.topic}
                    </Typography>
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: 0.5,
                        columnGap: 1.5,
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        Time
                      </Typography>
                      <Box sx={{ minWidth: 0 }}>
                        <TimeAgo timestamp={message.receivedAt} />
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        Observer
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ overflowWrap: "anywhere" }}
                      >
                        {message.observer ||
                          (message.publicKey ? message.publicKey : "—")}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Size
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {numberFormat.format(message.bytes)} B
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Stack>
            ) : (
              <TableContainer sx={{ maxHeight: 500, overflowX: "hidden" }}>
                <Table
                  size="small"
                  stickyHeader
                  sx={{ tableLayout: "fixed", width: "100%" }}
                >
                  <caption style={visuallyHiddenCaptionStyle}>
                    Recent public MQTT messages with topic, observer, time, and
                    payload size
                  </caption>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 120 }}>Time</TableCell>
                      <TableCell>Topic</TableCell>
                      <TableCell sx={{ width: 160 }}>Observer</TableCell>
                      <TableCell align="right" sx={{ width: 80 }}>
                        Size
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recentPublishes.slice(0, 50).map((message, index) => (
                      <TableRow
                        key={`${message.receivedAt}-${message.topic}-${index}`}
                      >
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          <TimeAgo timestamp={message.receivedAt} />
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{
                              fontFamily: "monospace",
                              fontSize: "0.8125rem",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {message.topic}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ overflowWrap: "anywhere" }}
                          >
                            {message.observer ||
                              (message.publicKey ? message.publicKey : "—")}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          {numberFormat.format(message.bytes)} B
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
