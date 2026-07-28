import { useMemo, useState } from "react";
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
  shortKey,
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

type MessageSortKey = "time" | "region" | "subtopic" | "size" | "topic";

const MESSAGE_SORT_OPTIONS = [
  { value: "time", label: "Time" },
  { value: "region", label: "Region" },
  { value: "subtopic", label: "Subtopic" },
  { value: "size", label: "Size" },
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

  const handleSort = (key: MessageSortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const regionDisplay = formatRegionDisplay(observer.region, countyLookup);

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
          case "topic":
            result = a.topic.localeCompare(b.topic);
            break;
        }
        if (result === 0) result = a.receivedAt - b.receivedAt;
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
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          minWidth: 0,
          flexShrink: 0,
        }}
      >
        <Typography
          variant="h6"
          component="div"
          sx={{
            minWidth: 0,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {observer.label || shortKey(observer.publicKey)}
        </Typography>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ width: 48, height: 48, flexShrink: 0, mr: -1 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={{
          p: { xs: 2, sm: 3 },
          overflowX: "hidden",
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
                  "& .MuiChip-label": { whiteSpace: "normal", py: 0.25 },
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
                sm: "repeat(3, minmax(0, 1fr))",
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
                    sx={{ mt: 1 }}
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
                  sx={{ mt: 0.5 }}
                >
                  Block count: {numberFormat.format(observer.abuse.blockCount)}{" "}
                  · Broker: {observer.abuse.broker || "—"}
                </Typography>
              </Paper>
            </Box>
          )}

          {observer.neighbors && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Neighbors ({observer.neighbors.neighbors.length})
              </Typography>
              {observer.neighbors.neighbors.length > 0 ? (
                compactLayout ? (
                  <Paper variant="outlined" sx={{ overflow: "hidden" }}>
                    <Stack
                      divider={
                        <Box sx={{ borderTop: 1, borderColor: "divider" }} />
                      }
                    >
                      {observer.neighbors.neighbors.map((neighbor, index) => (
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
                              title={neighbor.publicKey}
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.8125rem",
                                overflowWrap: "anywhere",
                                minWidth: 0,
                              }}
                            >
                              {shortKey(neighbor.publicKey)}
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
                              <Typography variant="body2">
                                {age(neighbor.heardSecsAgo * 1000)}
                              </Typography>
                            </Box>
                          </Box>
                          {neighbor.scopes.length > 0 && (
                            <Box
                              sx={{
                                display: "flex",
                                gap: 0.5,
                                flexWrap: "wrap",
                                mt: 1,
                              }}
                            >
                              {neighbor.scopes.map((scope) => (
                                <Chip
                                  key={scope}
                                  label={scope}
                                  size="small"
                                  variant="outlined"
                                />
                              ))}
                            </Box>
                          )}
                        </Box>
                      ))}
                    </Stack>
                  </Paper>
                ) : (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Public key</TableCell>
                          <TableCell>SNR</TableCell>
                          <TableCell>Heard</TableCell>
                          <TableCell>Scopes</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {observer.neighbors.neighbors.map((neighbor, index) => (
                          <TableRow key={`${neighbor.publicKey}-${index}`}>
                            <TableCell
                              title={neighbor.publicKey}
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.8rem",
                              }}
                            >
                              {shortKey(neighbor.publicKey)}
                            </TableCell>
                            <TableCell>
                              {Number.isFinite(neighbor.snr)
                                ? `${neighbor.snr.toFixed(1)} dB`
                                : "—"}
                            </TableCell>
                            <TableCell>
                              {age(neighbor.heardSecsAgo * 1000)}
                            </TableCell>
                            <TableCell>
                              <Box
                                sx={{
                                  display: "flex",
                                  gap: 0.5,
                                  flexWrap: "wrap",
                                }}
                              >
                                {neighbor.scopes.map((scope) => (
                                  <Chip
                                    key={scope}
                                    label={scope}
                                    size="small"
                                    variant="outlined"
                                  />
                                ))}
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
              {observer.neighbors.invalidEntryCount > 0 && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 1, display: "block" }}
                >
                  {observer.neighbors.invalidEntryCount} invalid entries were
                  filtered.
                </Typography>
              )}
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
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {[
                          ["time", "Time"],
                          ["region", "Region"],
                          ["subtopic", "Subtopic"],
                          ["size", "Size"],
                          ["topic", "Topic"],
                        ].map(([key, label]) => (
                          <TableCell key={key}>
                            <TableSortLabel
                              active={sortKey === key}
                              direction={sortKey === key ? sortDir : "desc"}
                              onClick={() => handleSort(key as MessageSortKey)}
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
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
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
        sx={{ mt: 1 }}
      >
        {region?.code ?? message.region ?? "No region"} ·{" "}
        {numberFormat.format(message.bytes)} B
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
      <TableCell>{region?.code ?? message.region ?? "—"}</TableCell>
      <TableCell>{message.subtopic ?? "—"}</TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {numberFormat.format(message.bytes)} B
      </TableCell>
      <TableCell sx={{ maxWidth: 360 }}>
        <Typography
          variant="body2"
          sx={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={message.topic}
        >
          {message.topic}
        </Typography>
      </TableCell>
    </TableRow>
  );
}
