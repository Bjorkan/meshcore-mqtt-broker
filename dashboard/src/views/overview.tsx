import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  DashboardSnapshot,
  DashboardObserver,
  BanSummary,
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
  Card,
  CardActionArea,
  CardContent,
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
  action,
}: {
  title: string;
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
      <Typography variant="subtitle1">{title}</Typography>
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
  const [observerSortField, setObserverSortField] = useState("messageCount");
  const [observerSortDir, setObserverSortDir] = useState<SortDir>("desc");
  const [banSortField, setBanSortField] = useState("blockCount");
  const [banSortDir, setBanSortDir] = useState<SortDir>("desc");

  const { summary, observers, recentPublishes, bans, meshcoreIo } = snapshot;

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
      let av: unknown = (a as unknown as Record<string, unknown>)[
        observerSortField
      ];
      let bv: unknown = (b as unknown as Record<string, unknown>)[
        observerSortField
      ];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av == null) av = "";
      if (bv == null) bv = "";
      const aValue = av as string | number;
      const bValue = bv as string | number;
      if (aValue < bValue) return -1 * direction;
      if (aValue > bValue) return 1 * direction;
      return a.label.localeCompare(b.label) * direction;
    });
  }, [filteredObservers, observerSortField, observerSortDir]);

  const sortedBans = useMemo(() => {
    const direction = banSortDir === "asc" ? 1 : -1;
    return [...bans].sort((a, b) => {
      let av: unknown = (a as unknown as Record<string, unknown>)[banSortField];
      let bv: unknown = (b as unknown as Record<string, unknown>)[banSortField];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av == null) av = "";
      if (bv == null) bv = "";
      const aValue = av as string | number;
      const bValue = bv as string | number;
      if (aValue < bValue) return -1 * direction;
      if (aValue > bValue) return 1 * direction;
      return (a.label || a.node).localeCompare(b.label || b.node) * direction;
    });
  }, [bans, banSortField, banSortDir]);

  const topObservers = sortedObservers.slice(0, 10);
  const topBans = sortedBans.slice(0, 10);

  function handleObserverSort(field: string) {
    if (observerSortField === field) {
      setObserverSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setObserverSortField(field);
      setObserverSortDir("desc");
    }
  }

  function handleBanSort(field: string) {
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
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricCard
            label="Protection events"
            value={numberFormat.format(summary.activeBans)}
            note={
              summary.protectionEventsTruncated
                ? `${summary.protectionEventsTotal} events · ${summary.protectionEventsShown} shown`
                : `${summary.protectionEventsTotal} events`
            }
            icon={<Shield />}
          />
        </Grid>
      </Grid>

      <Box sx={{ mb: 2 }}>
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search observers by name or key…"
        />
      </Box>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Paper sx={{ overflow: "hidden" }}>
            <SectionHeader
              title="Most active observers"
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
                No observers found.
              </Typography>
            ) : compactLayout ? (
              <Stack
                divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}
              >
                {topObservers.map((observer) => (
                  <CardActionArea
                    key={observer.publicKey}
                    onClick={() => onSelectObserver(observer)}
                    sx={{ px: 2, py: 1.5 }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 2,
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
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
                          sx={{ fontFamily: "monospace" }}
                        >
                          {shortKey(observer.publicKey)}
                        </Typography>
                      </Box>
                      <StatusBadge
                        label={observer.active ? "Online" : "Offline"}
                        color={observer.active ? "success" : "default"}
                      />
                    </Box>
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 2,
                        mt: 1.25,
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
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>
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
                      <TableCell>
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
                      <TableCell>Last seen</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {topObservers.map((observer) => (
                      <TableRow
                        key={observer.publicKey}
                        hover
                        onClick={() => onSelectObserver(observer)}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelectObserver(observer);
                          }
                        }}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {observer.label || shortKey(observer.publicKey)}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: "monospace" }}
                          >
                            {shortKey(observer.publicKey)}
                          </Typography>
                        </TableCell>
                        <TableCell>
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
          {meshcoreIo?.enabled ? (
            <Paper sx={{ overflow: "hidden", height: "100%" }}>
              <SectionHeader
                title="MeshCore.io"
                action={
                  <Button size="small" onClick={() => onNavigate("meshcoreio")}>
                    Open
                  </Button>
                }
              />
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
                  <Alert severity="error">{meshcoreIo.lastError}</Alert>
                )}
              </Stack>
            </Paper>
          ) : (
            <Paper sx={{ p: 3, height: "100%" }}>
              <Typography variant="h6">MeshCore.io</Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                Integration disabled.
              </Typography>
            </Paper>
          )}
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Paper sx={{ overflow: "hidden" }}>
            <SectionHeader
              title="Active bans"
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
                No active bans.
              </Typography>
            ) : compactLayout ? (
              <Stack
                divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}
              >
                {topBans.map((ban, index) => (
                  <CardActionArea
                    key={`${ban.node}-${index}`}
                    onClick={() => onSelectBan(ban)}
                    sx={{ px: 2, py: 1.5 }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 2,
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 500, overflowWrap: "anywhere" }}
                        >
                          {ban.label || shortKey(ban.node)}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="div"
                        >
                          {formatPublicMuteReason(ban.reason)}
                        </Typography>
                      </Box>
                      {renderDenialStatus(ban.status)}
                    </Box>
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "1fr 2fr",
                        gap: 2,
                        mt: 1.25,
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
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>
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
                      <TableCell>Reason</TableCell>
                      <TableCell>
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
                      <TableCell>Action / expiry</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {topBans.map((ban, index) => (
                      <TableRow
                        key={`${ban.node}-${index}`}
                        hover
                        onClick={() => onSelectBan(ban)}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelectBan(ban);
                          }
                        }}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {ban.label || shortKey(ban.node)}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: "monospace" }}
                          >
                            {shortKey(ban.node)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {formatPublicMuteReason(ban.reason)}
                        </TableCell>
                        <TableCell>
                          {numberFormat.format(ban.blockCount)}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
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
          <Paper sx={{ overflow: "hidden" }}>
            <SectionHeader title="Recent publishes" />
            {recentPublishes.length === 0 ? (
              <Typography
                color="text.secondary"
                sx={{ p: 3, textAlign: "center" }}
              >
                No recent publishes.
              </Typography>
            ) : compactLayout ? (
              <Stack
                divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}
              >
                {recentPublishes.slice(0, 50).map((message, index) => (
                  <Box
                    key={`${message.receivedAt}-${message.topic}-${index}`}
                    sx={{ px: 2, py: 1.5 }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 2,
                      }}
                    >
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: "monospace",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {message.topic}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ whiteSpace: "nowrap" }}
                      >
                        <TimeAgo timestamp={message.receivedAt} />
                      </Typography>
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      component="div"
                      sx={{ mt: 0.75 }}
                    >
                      {message.observer ||
                        (message.publicKey
                          ? shortKey(message.publicKey)
                          : "—")}{" "}
                      · {numberFormat.format(message.bytes)} B
                    </Typography>
                  </Box>
                ))}
              </Stack>
            ) : (
              <TableContainer sx={{ maxHeight: 500 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Time</TableCell>
                      <TableCell>Topic</TableCell>
                      <TableCell>Observer</TableCell>
                      <TableCell align="right">Size</TableCell>
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
                        <TableCell sx={{ maxWidth: 560 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontFamily: "monospace",
                            }}
                            title={message.topic}
                          >
                            {message.topic}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {message.observer ||
                              (message.publicKey
                                ? shortKey(message.publicKey)
                                : "—")}
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
