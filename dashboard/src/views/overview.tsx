import { useState, useMemo } from "react";
import type {
  DashboardSnapshot,
  DashboardObserver,
  BanSummary,
  ObserverMessage,
  SortDir,
} from "../types.js";
import { MetricCard } from "../components/shared/metric-card.js";
import { DataTable } from "../components/shared/data-table.js";
import { StatusBadge } from "../components/shared/status-badge.js";
import TimeAgo from "../components/ui/time-ago.js";
import SearchBar from "../components/ui/search-bar.js";
import { shortKey, age, numberFormat } from "../helpers/time.js";
import { formatDeniedUntilLabel } from "../helpers/format.js";
import {
  Box,
  Paper,
  Typography,
  Chip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableSortLabel,
  TableContainer,
  Alert,
  Stack,
  Grid,
} from "@mui/material";
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
  if (status === "muted") return <StatusBadge label="Blocked" color="error" />;
  if (status === "denied") return <StatusBadge label="Blocked" color="error" />;
  if (status === "would_mute")
    return <StatusBadge label="Warning" color="warning" />;
  return <StatusBadge label={status} color="default" />;
}

function formatPublicMuteReason(reason: string): string {
  const map: Record<string, string> = {
    spam: "Spam/high rate",
    flood: "Message flood",
    invalid_json: "Invalid JSON",
    empty_payload: "Empty payload",
    missing_origin_id: "Missing origin_id",
    origin_mismatch: "origin_id mismatch",
    invalid_origin_length: "Invalid origin length",
    key_length: "Invalid key length",
    encoded_origin: "Encoded origin",
    invalid_topic: "Invalid topic",
    subscription_limit: "Subscription limit",
    spoofed_region: "Spoofed region",
    invalid_iata: "Invalid IATA",
    duplicate: "Duplicate message",
    rapid_publish: "Rapid publishing",
    excessive_messages: "Excessive messages",
    retry_storm: "Retry storm",
    no_subtopic: "No subtopic",
    blocked_origin: "Blocked origin",
  };
  return map[reason] ?? reason;
}

export default function OverviewView({
  snapshot,
  onSelectObserver,
  onSelectBan,
  onNavigate,
}: OverviewProps) {
  const [search, setSearch] = useState("");
  const [observerSortField, setObserverSortField] = useState("messageCount");
  const [observerSortDir, setObserverSortDir] = useState<SortDir>("desc");
  const [banSortField, setBanSortField] = useState("blockCount");
  const [banSortDir, setBanSortDir] = useState<SortDir>("desc");

  const { summary, observers, recentPublishes, bans, meshcoreIo } = snapshot;

  const filteredObservers = useMemo(() => {
    if (!search.trim()) return observers;
    const q = search.toLowerCase();
    return observers.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.publicKey.toLowerCase().includes(q),
    );
  }, [observers, search]);

  const sortedObservers = useMemo(() => {
    const s = [...filteredObservers].sort((a, b) => {
      let av: any = (a as any)[observerSortField];
      let bv: any = (b as any)[observerSortField];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    if (observerSortDir === "desc") s.reverse();
    return s;
  }, [filteredObservers, observerSortField, observerSortDir]);

  const sortedBans = useMemo(() => {
    const s = [...bans].sort((a, b) => {
      let av: any = (a as any)[banSortField];
      let bv: any = (b as any)[banSortField];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    if (banSortDir === "desc") s.reverse();
    return s;
  }, [bans, banSortField, banSortDir]);

  const topObservers = sortedObservers.slice(0, 10);
  const topBans = sortedBans.slice(0, 10);

  function handleObserverSort(field: string) {
    if (observerSortField === field) {
      setObserverSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setObserverSortField(field);
      setObserverSortDir("desc");
    }
  }

  function handleBanSort(field: string) {
    if (banSortField === field) {
      setBanSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setBanSortField(field);
      setBanSortDir("desc");
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 600 }}>
        Overview
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <MetricCard
            label="Connected observers"
            value={numberFormat.format(summary.connectedObservers)}
            note={`${summary.connectedClients} total clients`}
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
            label="Blocked observers"
            value={numberFormat.format(summary.activeBans)}
            note={
              summary.protectionEventsTruncated
                ? `${summary.protectionEventsTotal} events (showing ${summary.protectionEventsShown})`
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
          placeholder="Search observers by name or key..."
        />
      </Box>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Paper variant="outlined" sx={{ mb: 2 }}>
            <Box
              sx={{
                px: 2,
                py: 1.5,
                borderBottom: 1,
                borderColor: "divider",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Most Active Observers
              </Typography>
              <Chip
                label="View all"
                size="small"
                variant="outlined"
                clickable
                onClick={() => onNavigate("observers")}
              />
            </Box>
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
                  {topObservers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        sx={{ textAlign: "center", color: "text.secondary" }}
                      >
                        No observers found
                      </TableCell>
                    </TableRow>
                  ) : (
                    topObservers.map((obs) => (
                      <TableRow
                        key={obs.publicKey}
                        hover
                        onClick={() => onSelectObserver(obs)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {obs.label || shortKey(obs.publicKey)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {shortKey(obs.publicKey)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {numberFormat.format(obs.messageCount)}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {age(Date.now() - obs.lastSeenAt)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {obs.active ? (
                            <StatusBadge label="Online" color="success" />
                          ) : (
                            <StatusBadge label="Offline" color="default" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          {meshcoreIo?.enabled ? (
            <Paper variant="outlined" sx={{ mb: 2 }}>
              <Box
                sx={{
                  px: 2,
                  py: 1.5,
                  borderBottom: 1,
                  borderColor: "divider",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  MeshCore.io
                </Typography>
                <Chip
                  label="Open"
                  size="small"
                  variant="outlined"
                  clickable
                  onClick={() => onNavigate("meshcoreio")}
                />
              </Box>
              <Box sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Box
                    sx={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      Processor
                    </Typography>
                    <StatusBadge
                      label={
                        meshcoreIo.processor.status === "healthy"
                          ? "Healthy"
                          : "Idle"
                      }
                      color={
                        meshcoreIo.processor.status === "healthy"
                          ? "success"
                          : "default"
                      }
                    />
                  </Box>
                  <Box
                    sx={{ display: "flex", justifyContent: "space-between" }}
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
                    sx={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      Uploaded
                    </Typography>
                    <Typography variant="body2">
                      {numberFormat.format(meshcoreIo.totals.uploaded)}
                    </Typography>
                  </Box>
                  <Box
                    sx={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      Dropped
                    </Typography>
                    <Typography variant="body2" color="error">
                      {numberFormat.format(meshcoreIo.totals.dropped)}
                    </Typography>
                  </Box>
                  {meshcoreIo.lastError && (
                    <Alert severity="error" sx={{ mt: 1 }}>
                      {meshcoreIo.lastError}
                    </Alert>
                  )}
                </Stack>
              </Box>
            </Paper>
          ) : null}
        </Grid>

        <Grid size={{ xs: 12 }}>
          {topBans.length > 0 ? (
            <Paper variant="outlined" sx={{ mb: 2 }}>
              <Box
                sx={{
                  px: 2,
                  py: 1.5,
                  borderBottom: 1,
                  borderColor: "divider",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  Active Bans
                </Typography>
                <Chip
                  label="View all"
                  size="small"
                  variant="outlined"
                  clickable
                  onClick={() => onNavigate("bans")}
                />
              </Box>
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
                      <TableCell>Until</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {topBans.map((ban, idx) => (
                      <TableRow
                        key={`${ban.node}-${idx}`}
                        hover
                        onClick={() => onSelectBan(ban)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {ban.label || shortKey(ban.node)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {shortKey(ban.node)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {formatPublicMuteReason(ban.reason)}
                          </Typography>
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
            </Paper>
          ) : (
            <Paper variant="outlined" sx={{ mb: 2, p: 3, textAlign: "center" }}>
              <Typography color="text.secondary">No active bans</Typography>
            </Paper>
          )}
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Paper variant="outlined">
            <Box
              sx={{
                px: 2,
                py: 1.5,
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Recent Publishes
              </Typography>
            </Box>
            <TableContainer sx={{ maxHeight: 500, overflow: "auto" }}>
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
                  {recentPublishes.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        sx={{ textAlign: "center", color: "text.secondary" }}
                      >
                        No recent publishes
                      </TableCell>
                    </TableRow>
                  ) : (
                    recentPublishes.slice(0, 50).map((msg, idx) => (
                      <TableRow
                        key={`${msg.receivedAt}-${msg.topic}-${idx}`}
                        sx={{
                          "&:nth-of-type(odd)": {
                            bgcolor: "action.hover",
                          },
                        }}
                      >
                        <TableCell
                          sx={{ whiteSpace: "nowrap", fontSize: "0.75rem" }}
                        >
                          <TimeAgo timestamp={msg.receivedAt} />
                        </TableCell>
                        <TableCell
                          sx={{
                            maxWidth: 300,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <Typography
                            variant="body2"
                            sx={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {msg.topic}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {msg.observer || shortKey(msg.publicKey || "")}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" color="text.secondary">
                            {numberFormat.format(msg.bytes)} B
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
