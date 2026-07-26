import { useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from "@mui/material";
import type {
  CountyLookupEntry,
  DashboardObserver,
  ObserverMessage,
  SortDir,
} from "../../types.js";
import { formatRegionDisplay } from "../../helpers/format.js";
import {
  shortKey,
  stockholmShortTime,
  optionalStockholmTime,
  age,
} from "../../helpers/time.js";

export interface ObserverDetailProps {
  observer: DashboardObserver;
  countyLookup?: Record<string, CountyLookupEntry>;
  onClose: () => void;
}

type MessageSortKey = "time" | "region" | "subtopic" | "size" | "topic";

export default function ObserverDetail({
  observer,
  countyLookup,
  onClose,
}: ObserverDetailProps) {
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

  const sortedMessages = [...observer.messages].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "time":
        return (a.receivedAt - b.receivedAt) * dir;
      case "region":
        return (a.region ?? "").localeCompare(b.region ?? "") * dir;
      case "subtopic":
        return (a.subtopic ?? "").localeCompare(b.subtopic ?? "") * dir;
      case "size":
        return (a.bytes - b.bytes) * dir;
      case "topic":
        return a.topic.localeCompare(b.topic) * dir;
    }
  });

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography
          noWrap
          sx={{
            maxWidth: "70vw",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {observer.label || shortKey(observer.publicKey)}
        </Typography>
        <IconButton aria-label="Close" onClick={onClose} sx={{ ml: "auto" }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            <Chip
              label={observer.active ? "Online" : "Offline"}
              color={observer.active ? "success" : "default"}
              size="small"
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
              />
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Public Key
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
              {observer.publicKey}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Last Connected
              </Typography>
              <Typography variant="body2">
                {optionalStockholmTime(observer.lastConnectedAt)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Last Message
              </Typography>
              <Typography variant="body2">
                {optionalStockholmTime(observer.lastSeenAt)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Messages
              </Typography>
              <Typography variant="body2">{observer.messageCount}</Typography>
            </Box>
          </Box>

          {observer.abuse && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Protection Status
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  gap: 1,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <Chip
                  label={observer.abuse.status}
                  color={
                    observer.abuse.status === "denied"
                      ? "error"
                      : observer.abuse.status === "muted"
                        ? "warning"
                        : "default"
                  }
                  size="small"
                />
                <Typography variant="body2">{observer.abuse.reason}</Typography>
              </Box>
              {(observer.abuse.deniedUntilText ||
                observer.abuse.mutedUntil) && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5 }}
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
                Block count: {observer.abuse.blockCount} · Broker:{" "}
                {observer.abuse.broker}
              </Typography>
            </Box>
          )}

          {observer.neighbors && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Neighbors ({observer.neighbors.neighbors.length})
              </Typography>
              {observer.neighbors.neighbors.length > 0 ? (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Public Key</TableCell>
                      <TableCell>SNR</TableCell>
                      <TableCell>Heard</TableCell>
                      <TableCell>Scopes</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {observer.neighbors.neighbors.map((n, i) => (
                      <TableRow key={i}>
                        <TableCell
                          sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}
                        >
                          {shortKey(n.publicKey)}
                        </TableCell>
                        <TableCell>{n.snr}</TableCell>
                        <TableCell>{age(n.heardSecsAgo * 1000)}</TableCell>
                        <TableCell
                          sx={{
                            maxWidth: 200,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {n.scopes.join(", ")}
                        </TableCell>
                        <TableCell>
                          <Chip label={n.status} size="small" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No neighbors reported.
                </Typography>
              )}
              {observer.neighbors.invalidEntryCount > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {observer.neighbors.invalidEntryCount} invalid entries
                  filtered.
                </Typography>
              )}
            </Box>
          )}

          <Box>
            <Typography variant="h6" gutterBottom>
              Recent Messages ({observer.messages.length})
            </Typography>
            {sortedMessages.length > 0 ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <TableSortLabel
                        active={sortKey === "time"}
                        direction={sortKey === "time" ? sortDir : "desc"}
                        onClick={() => handleSort("time")}
                      >
                        Time
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortKey === "region"}
                        direction={sortKey === "region" ? sortDir : "desc"}
                        onClick={() => handleSort("region")}
                      >
                        Region
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortKey === "subtopic"}
                        direction={sortKey === "subtopic" ? sortDir : "desc"}
                        onClick={() => handleSort("subtopic")}
                      >
                        Subtopic
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortKey === "size"}
                        direction={sortKey === "size" ? sortDir : "desc"}
                        onClick={() => handleSort("size")}
                      >
                        Size
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortKey === "topic"}
                        direction={sortKey === "topic" ? sortDir : "desc"}
                        onClick={() => handleSort("topic")}
                      >
                        Topic
                      </TableSortLabel>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedMessages.map((msg, i) => (
                    <MessageRow
                      key={i}
                      message={msg}
                      countyLookup={countyLookup}
                    />
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No messages.
              </Typography>
            )}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

function MessageRow({
  message,
  countyLookup,
}: {
  message: ObserverMessage;
  countyLookup?: Record<string, CountyLookupEntry>;
}) {
  const r = message.region
    ? formatRegionDisplay(message.region, countyLookup)
    : null;
  return (
    <TableRow>
      <TableCell>{stockholmShortTime(message.receivedAt)}</TableCell>
      <TableCell>{r?.code ?? message.region ?? "-"}</TableCell>
      <TableCell>{message.subtopic ?? "-"}</TableCell>
      <TableCell>{message.bytes}B</TableCell>
      <TableCell
        sx={{
          maxWidth: 300,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {message.topic}
      </TableCell>
    </TableRow>
  );
}
