import { useId, useMemo, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
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
import type {
  CountyLookupEntry,
  DashboardObserver,
  ObserverMessage,
  SortDir,
} from "../../types.js";
import {
  formatPublicMuteReason,
  formatRegionDisplay,
  formatDenialStatus,
} from "../../helpers/format.js";
import {
  stockholmShortTime,
  optionalStockholmTime,
  age,
  numberFormat,
} from "../../helpers/time.js";
import { StatusBadge } from "../shared/status-badge.js";
import { MobileSortControls } from "../ui/mobile-sort-controls.js";

export interface ObserverDetailProps {
  observer: DashboardObserver;
  countyLookup?: Record<string, CountyLookupEntry>;
  onClose: () => void;
}

type MessageSortKey =
  "time" | "region" | "subtopic" | "size" | "broker" | "topic";

const MESSAGE_SORT_OPTIONS = [
  { value: "time", label: "Time" },
  { value: "region", label: "Region" },
  { value: "subtopic", label: "Subtopic" },
  { value: "size", label: "Size" },
  { value: "broker", label: "Broker" },
  { value: "topic", label: "Topic" },
];

function neighborStatusColor(status: string) {
  if (status === "responded") return "success" as const;
  if (status === "timeout") return "warning" as const;
  if (status === "send_failed") return "error" as const;
  return "default" as const;
}

function neighborStatusLabel(status: string) {
  const labels: Record<string, string> = {
    responded: "Responded",
    timeout: "Timed out",
    send_failed: "Send failed",
  };
  return (
    labels[status] ??
    status.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase())
  );
}

function ScopeChip({ scope }: { scope: string }) {
  return (
    <Chip
      label={scope}
      size="small"
      variant="outlined"
      sx={{
        maxWidth: "100%",
        height: "auto",
        minHeight: 24,
        "& .MuiChip-label": {
          py: 0.25,
          whiteSpace: "normal",
          overflowWrap: "anywhere",
        },
      }}
    />
  );
}

export default function ObserverDetail({
  observer,
  countyLookup,
  onClose,
}: ObserverDetailProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const compactLayout = useMediaQuery(theme.breakpoints.down("md"));
  const [sortKey, setSortKey] = useState<MessageSortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const titleId = useId();

  const handleSort = (key: MessageSortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const regionDisplay = formatRegionDisplay(observer.region, countyLookup);
  const neighborsSnapshot = observer.neighbors;

  const sortedMessages = useMemo(
    () =>
      [...observer.messages].sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        let result = 0;
        switch (sortKey) {
          case "time":
            result = a.receivedAt - b.receivedAt;
            break;
          case "region":
            result = (a.region ?? "").localeCompare(b.region ?? "");
            break;
          case "subtopic":
            result = (a.subtopic ?? "").localeCompare(b.subtopic ?? "");
            break;
          case "size":
            result = a.bytes - b.bytes;
            break;
          case "broker":
            result = a.broker.localeCompare(b.broker);
            break;
          case "topic":
            result = a.topic.localeCompare(b.topic);
            break;
        }
        if (result === 0) result = a.receivedAt - b.receivedAt;
        if (result === 0) {
          result =
            `${a.topic}\u0000${a.broker}\u0000${a.subtopic ?? ""}`.localeCompare(
              `${b.topic}\u0000${b.broker}\u0000${b.subtopic ?? ""}`,
            );
        }
        return result * dir;
      }),
    [observer.messages, sortDir, sortKey],
  );

  const abuseStatus = observer.abuse
    ? formatDenialStatus(observer.abuse.status)
    : null;

  return (
    <Dialog
      open
      fullWidth
      fullScreen={fullScreen}
      maxWidth="md"
      onClose={onClose}
      aria-labelledby={titleId}
      slotProps={{
        paper: {
          sx: {
            display: "flex",
            flexDirection: "column",
            maxHeight: { xs: "100%", sm: "calc(100vh - 64px)" },
          },
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          flexShrink: 0,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <DialogTitle
          id={titleId}
          sx={{
            minWidth: 0,
            flex: 1,
            overflowWrap: "anywhere",
            borderBottom: 0,
            pr: 1,
          }}
        >
          {observer.label || observer.publicKey}
        </DialogTitle>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ width: 48, height: 48, flexShrink: 0, mr: 1 }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <DialogContent
        sx={{
          p: { xs: 2, sm: 3 },
          overflowY: "auto",
          flex: 1,
        }}
      >
        <Stack spacing={2.5}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, pt: 0.5 }}>
            <StatusBadge
              label={observer.active ? "Online" : "Offline"}
              color={observer.active ? "success" : "default"}
            />
            {regionDisplay && (
              <Chip
                label={
                  regionDisplay.countyName
                    ? `${regionDisplay.countyName} (${regionDisplay.code})`
                    : regionDisplay.code
                }
                size="small"
                variant="outlined"
                sx={{
                  maxWidth: "100%",
                  height: "auto",
                  minHeight: 24,
                  "& .MuiChip-label": {
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    py: 0.25,
                  },
                }}
              />
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Public key
            </Typography>
            <Paper
              component="code"
              sx={{
                display: "block",
                p: 1.5,
                fontSize: "0.8125rem",
                lineHeight: 1.6,
                overflowWrap: "anywhere",
                userSelect: "all",
                bgcolor: "action.hover",
                borderRadius: 1,
              }}
            >
              {observer.publicKey}
            </Paper>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                md: "repeat(4, minmax(0, 1fr))",
              },
              gap: 1.5,
            }}
          >
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Last connected
              </Typography>
              <Typography variant="body2">
                {optionalStockholmTime(observer.lastConnectedAt)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Last message
              </Typography>
              <Typography variant="body2">
                {optionalStockholmTime(observer.lastSeenAt)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Messages
              </Typography>
              <Typography variant="body2">
                {numberFormat.format(observer.messageCount)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Broker
              </Typography>
              <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                {observer.broker || "—"}
              </Typography>
            </Box>
          </Box>

          {observer.abuse && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Protection status
              </Typography>
              <Paper sx={{ p: 2, bgcolor: "action.hover", borderRadius: 1 }}>
                <Box
                  sx={{
                    display: "flex",
                    gap: 1,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <StatusBadge
                    label={abuseStatus!.label}
                    color={abuseStatus!.color}
                  />
                  <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                    {formatPublicMuteReason(observer.abuse.reason)}
                  </Typography>
                </Box>
                {(observer.abuse.deniedUntilText ||
                  observer.abuse.mutedUntil) && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 1, overflowWrap: "anywhere" }}
                  >
                    {observer.abuse.deniedUntilText ??
                      (observer.abuse.mutedUntil
                        ? `Until ${stockholmShortTime(observer.abuse.mutedUntil)}`
                        : null)}
                  </Typography>
                )}
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5, overflowWrap: "anywhere" }}
                >
                  Block count: {numberFormat.format(observer.abuse.blockCount)}{" "}
                  · Broker: {observer.abuse.broker || "—"}
                </Typography>
              </Paper>
            </Box>
          )}

          {neighborsSnapshot ? (
            <Box>
              <Typography variant="h6" gutterBottom>
                Neighbors ({neighborsSnapshot.neighbors.length})
              </Typography>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "repeat(2, minmax(0, 1fr))",
                  },
                  gap: 1.5,
                  mb: 1.5,
                }}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Snapshot received
                  </Typography>
                  <Typography variant="body2">
                    {optionalStockholmTime(neighborsSnapshot.receivedAt)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Device reported
                  </Typography>
                  <Typography variant="body2">
                    {optionalStockholmTime(neighborsSnapshot.reportedAt)}
                  </Typography>
                </Box>
              </Box>
              <Typography variant="subtitle2" color="text.secondary">
                Observer scopes
              </Typography>
              {neighborsSnapshot.selfScopes.length > 0 ? (
                <Box
                  sx={{
                    display: "flex",
                    gap: 0.5,
                    flexWrap: "wrap",
                    mt: 0.5,
                    mb: 1.5,
                  }}
                >
                  {neighborsSnapshot.selfScopes.map((scope) => (
                    <ScopeChip key={scope} scope={scope} />
                  ))}
                </Box>
              ) : (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5, mb: 1.5 }}
                >
                  No observer scopes reported.
                </Typography>
              )}
              {neighborsSnapshot.neighbors.length > 0 ? (
                compactLayout ? (
                  <Paper variant="outlined" sx={{ overflow: "hidden" }}>
                    <Stack
                      divider={
                        <Box sx={{ borderTop: 1, borderColor: "divider" }} />
                      }
                    >
                      {neighborsSnapshot.neighbors.map((neighbor, index) => (
                        <Box
                          key={`${neighbor.publicKey}-${index}`}
                          sx={{ px: 2, py: 1.5 }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              gap: 1,
                            }}
                          >
                            <Typography
                              variant="body2"
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.8125rem",
                                overflowWrap: "anywhere",
                                minWidth: 0,
                              }}
                            >
                              {neighbor.publicKey}
                            </Typography>
                            <StatusBadge
                              label={neighborStatusLabel(neighbor.status)}
                              color={neighborStatusColor(neighbor.status)}
                            />
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
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                SNR
                              </Typography>
                              <Typography variant="body2">
                                {Number.isFinite(neighbor.snr)
                                  ? `${neighbor.snr.toFixed(1)} dB`
                                  : "—"}
                              </Typography>
                            </Box>
                            <Box>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                Heard
                              </Typography>
                              <Typography
                                variant="body2"
                                sx={{ overflowWrap: "anywhere" }}
                              >
                                {age(neighbor.heardSecsAgo * 1000)}
                                <br />
                                {optionalStockholmTime(
                                  neighborsSnapshot.receivedAt -
                                    neighbor.heardSecsAgo * 1000,
                                )}
                              </Typography>
                            </Box>
                          </Box>
                          {neighbor.scopes.length > 0 ? (
                            <Box
                              sx={{
                                display: "flex",
                                gap: 0.5,
                                flexWrap: "wrap",
                                mt: 1,
                              }}
                            >
                              {neighbor.scopes.map((scope) => (
                                <ScopeChip key={scope} scope={scope} />
                              ))}
                            </Box>
                          ) : (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              component="div"
                              sx={{ mt: 1 }}
                            >
                              No scopes reported.
                            </Typography>
                          )}
                        </Box>
                      ))}
                    </Stack>
                  </Paper>
                ) : (
                  <TableContainer component={Paper} variant="outlined">
                    <Table
                      size="small"
                      aria-label="Observer neighbors"
                      sx={{ tableLayout: "fixed" }}
                    >
                      <TableHead>
                        <TableRow>
                          <TableCell scope="col">Public key</TableCell>
                          <TableCell scope="col">SNR</TableCell>
                          <TableCell scope="col">Heard</TableCell>
                          <TableCell scope="col">Scopes</TableCell>
                          <TableCell scope="col">Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {neighborsSnapshot.neighbors.map((neighbor, index) => (
                          <TableRow key={`${neighbor.publicKey}-${index}`}>
                            <TableCell
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.8rem",
                                overflowWrap: "anywhere",
                              }}
                            >
                              {neighbor.publicKey}
                            </TableCell>
                            <TableCell>
                              {Number.isFinite(neighbor.snr)
                                ? `${neighbor.snr.toFixed(1)} dB`
                                : "—"}
                            </TableCell>
                            <TableCell>
                              {age(neighbor.heardSecsAgo * 1000)}
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                component="div"
                                sx={{ overflowWrap: "anywhere" }}
                              >
                                {optionalStockholmTime(
                                  neighborsSnapshot.receivedAt -
                                    neighbor.heardSecsAgo * 1000,
                                )}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Box
                                sx={{
                                  display: "flex",
                                  gap: 0.5,
                                  flexWrap: "wrap",
                                }}
                              >
                                {neighbor.scopes.length > 0 ? (
                                  neighbor.scopes.map((scope) => (
                                    <ScopeChip key={scope} scope={scope} />
                                  ))
                                ) : (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                  >
                                    No scopes
                                  </Typography>
                                )}
                              </Box>
                            </TableCell>
                            <TableCell>
                              <StatusBadge
                                label={neighborStatusLabel(neighbor.status)}
                                color={neighborStatusColor(neighbor.status)}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No neighbors reported.
                </Typography>
              )}
              {neighborsSnapshot.invalidEntryCount > 0 && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 1, display: "block" }}
                >
                  {neighborsSnapshot.invalidEntryCount} invalid entries were
                  filtered.
                </Typography>
              )}
            </Box>
          ) : (
            <Box>
              <Typography variant="h6" gutterBottom>
                Neighbors
              </Typography>
              <Typography variant="body2" color="text.secondary">
                No neighbor snapshot has been reported.
              </Typography>
            </Box>
          )}

          <Box>
            <Typography variant="h6" gutterBottom>
              Recent messages ({observer.messages.length})
            </Typography>
            {sortedMessages.length > 0 ? (
              compactLayout ? (
                <Stack spacing={1.5}>
                  <MobileSortControls
                    field={sortKey}
                    direction={sortDir}
                    options={MESSAGE_SORT_OPTIONS}
                    onFieldChange={(field) => {
                      setSortKey(field as MessageSortKey);
                      setSortDir("desc");
                    }}
                    onDirectionToggle={() =>
                      setSortDir((direction) =>
                        direction === "asc" ? "desc" : "asc",
                      )
                    }
                  />
                  <Stack spacing={1}>
                    {sortedMessages.map((message, index) => (
                      <MessageCard
                        key={`${message.receivedAt}-${message.topic}-${index}`}
                        message={message}
                        countyLookup={countyLookup}
                      />
                    ))}
                  </Stack>
                </Stack>
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table
                    size="small"
                    aria-label="Recent observer messages"
                    sx={{ tableLayout: "fixed" }}
                  >
                    <TableHead>
                      <TableRow>
                        {[
                          ["time", "Time"],
                          ["region", "Region"],
                          ["subtopic", "Subtopic"],
                          ["size", "Size"],
                          ["broker", "Broker"],
                          ["topic", "Topic"],
                        ].map(([key, label]) => (
                          <TableCell
                            key={key}
                            scope="col"
                            sortDirection={sortKey === key ? sortDir : false}
                            sx={{
                              width:
                                key === "time" || key === "size"
                                  ? 80
                                  : undefined,
                            }}
                          >
                            <TableSortLabel
                              active={sortKey === key}
                              direction={sortKey === key ? sortDir : "asc"}
                              onClick={() => handleSort(key as MessageSortKey)}
                              aria-label={
                                sortKey === key
                                  ? `Sort by ${label}; currently sorted ${sortDir === "asc" ? "ascending" : "descending"}`
                                  : `Sort by ${label}`
                              }
                            >
                              {label}
                            </TableSortLabel>
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedMessages.map((message, index) => (
                        <MessageRow
                          key={`${message.receivedAt}-${message.topic}-${index}`}
                          message={message}
                          countyLookup={countyLookup}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )
            ) : (
              <Typography variant="body2" color="text.secondary">
                No messages.
              </Typography>
            )}
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

function MessageCard({
  message,
  countyLookup,
}: {
  message: ObserverMessage;
  countyLookup?: Record<string, CountyLookupEntry>;
}) {
  const region = message.region
    ? formatRegionDisplay(message.region, countyLookup)
    : null;
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
        <Typography
          variant="body2"
          sx={{ fontWeight: 500, minWidth: 0, overflowWrap: "anywhere" }}
        >
          {message.subtopic ?? "Message"}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ whiteSpace: "nowrap" }}
        >
          {stockholmShortTime(message.receivedAt)}
        </Typography>
      </Box>
      <Typography
        variant="body2"
        sx={{
          mt: 1,
          fontFamily: "monospace",
          fontSize: "0.8125rem",
          overflowWrap: "anywhere",
        }}
      >
        {message.topic}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        sx={{ mt: 1, overflowWrap: "anywhere" }}
      >
        {region?.code ?? message.region ?? "No region"} ·{" "}
        {numberFormat.format(message.bytes)} B · Broker: {message.broker || "—"}
      </Typography>
    </Paper>
  );
}

function MessageRow({
  message,
  countyLookup,
}: {
  message: ObserverMessage;
  countyLookup?: Record<string, CountyLookupEntry>;
}) {
  const region = message.region
    ? formatRegionDisplay(message.region, countyLookup)
    : null;
  return (
    <TableRow>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {stockholmShortTime(message.receivedAt)}
      </TableCell>
      <TableCell sx={{ overflowWrap: "anywhere" }}>
        {region?.code ?? message.region ?? "—"}
      </TableCell>
      <TableCell sx={{ overflowWrap: "anywhere" }}>
        {message.subtopic ?? "—"}
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {numberFormat.format(message.bytes)} B
      </TableCell>
      <TableCell sx={{ overflowWrap: "anywhere" }}>
        {message.broker || "—"}
      </TableCell>
      <TableCell>
        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
          {message.topic}
        </Typography>
      </TableCell>
    </TableRow>
  );
}
