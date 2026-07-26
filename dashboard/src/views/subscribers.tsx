import { useState, useMemo } from "react";
import type { SubscriberConnectionEntry, SortDir } from "../types.js";
import { age, numberFormat } from "../helpers/time.js";
import {
  Box,
  Paper,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableSortLabel,
  TableContainer,
  Chip,
} from "@mui/material";

interface SubscribersProps {
  subscribers: SubscriberConnectionEntry[];
  onSelectSubscriber: (sub: SubscriberConnectionEntry) => void;
}

const MAX_VISIBLE_SUBS = 3;

export default function SubscribersView({
  subscribers,
  onSelectSubscriber,
}: SubscribersProps) {
  const [sortField, setSortField] = useState("lastSeenAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const s = [...subscribers].sort((a, b) => {
      let av: any = (a as any)[sortField];
      let bv: any = (b as any)[sortField];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    if (sortDir === "desc") s.reverse();
    return s;
  }, [subscribers, sortField, sortDir]);

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function renderSortLabel(field: string, label: string) {
    return (
      <TableSortLabel
        active={sortField === field}
        direction={sortField === field ? sortDir : "asc"}
        onClick={() => handleSort(field)}
      >
        {label}
      </TableSortLabel>
    );
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 600 }}>
        Subscribers
      </Typography>

      {subscribers.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="h6" color="text.secondary">
            No active subscribers
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Subscribers will appear here when clients connect with
            subscriptions.
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>
                    {renderSortLabel("username", "Username")}
                  </TableCell>
                  <TableCell>Subscriptions</TableCell>
                  <TableCell align="right">
                    {renderSortLabel("connectionCount", "Connections")}
                  </TableCell>
                  <TableCell>
                    {renderSortLabel("lastSeenAt", "Last active")}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sorted.map((sub) => {
                  const visibleSubs = sub.subscriptions.slice(
                    0,
                    MAX_VISIBLE_SUBS,
                  );
                  const remaining = sub.subscriptions.length - MAX_VISIBLE_SUBS;

                  return (
                    <TableRow
                      key={sub.username}
                      hover
                      onClick={() => onSelectSubscriber(sub)}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 500,
                            maxWidth: 180,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {sub.username}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box
                          sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}
                        >
                          {visibleSubs.map((topic) => (
                            <Chip
                              key={topic}
                              label={topic}
                              size="small"
                              variant="outlined"
                              sx={{ maxWidth: 200, fontSize: "0.7rem" }}
                            />
                          ))}
                          {remaining > 0 && (
                            <Chip
                              label={`+${remaining} more`}
                              size="small"
                              color="primary"
                              variant="filled"
                              sx={{ fontSize: "0.7rem" }}
                            />
                          )}
                          {sub.subscriptionsTruncated && (
                            <Chip
                              label="truncated"
                              size="small"
                              color="warning"
                              variant="filled"
                              sx={{ fontSize: "0.7rem" }}
                            />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2">
                          {numberFormat.format(sub.connectionCount)}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="div"
                        >
                          {sub.brokers?.length ?? 0} broker
                          {(sub.brokers?.length ?? 0) !== 1 ? "s" : ""}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {age(Date.now() - sub.lastSeenAt)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
