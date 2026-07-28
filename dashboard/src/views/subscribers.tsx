import { useState, useMemo } from "react";
import type { SubscriberConnectionEntry, SortDir } from "../types.js";
import { MobileSortControls } from "../components/ui/mobile-sort-controls.js";
import { age, numberFormat } from "../helpers/time.js";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Paper,
  Stack,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableSortLabel,
  TableContainer,
  Chip,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";

interface SubscribersProps {
  subscribers: SubscriberConnectionEntry[];
  onSelectSubscriber: (sub: SubscriberConnectionEntry) => void;
}

const MAX_VISIBLE_SUBS = 3;
const MOBILE_SORT_OPTIONS = [
  { value: "username", label: "Username" },
  { value: "connectionCount", label: "Connections" },
  { value: "lastSeenAt", label: "Last active" },
];

function SubscriptionChips({ sub }: { sub: SubscriberConnectionEntry }) {
  const visibleSubs = sub.subscriptions.slice(0, MAX_VISIBLE_SUBS);
  const remaining = Math.max(0, sub.subscriptions.length - MAX_VISIBLE_SUBS);
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
      {visibleSubs.map((topic, index) => (
        <Chip
          key={`${topic}-${index}`}
          label={topic}
          size="small"
          variant="outlined"
          title={topic}
          sx={{
            maxWidth: "100%",
            "& .MuiChip-label": {
              overflow: "hidden",
              textOverflow: "ellipsis",
            },
          }}
        />
      ))}
      {remaining > 0 && (
        <Chip label={`+${remaining} more`} size="small" color="primary" />
      )}
      {sub.subscriptionsTruncated && (
        <Chip label="Truncated" size="small" color="warning" />
      )}
    </Box>
  );
}

export default function SubscribersView({
  subscribers,
  onSelectSubscriber,
}: SubscribersProps) {
  const theme = useTheme();
  const compactLayout = useMediaQuery(theme.breakpoints.down("lg"));
  const [sortField, setSortField] = useState("lastSeenAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;
    return [...subscribers].sort((a, b) => {
      let av: unknown = (a as unknown as Record<string, unknown>)[sortField];
      let bv: unknown = (b as unknown as Record<string, unknown>)[sortField];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av == null) av = "";
      if (bv == null) bv = "";
      const aValue = av as string | number;
      const bValue = bv as string | number;
      if (aValue < bValue) return -1 * direction;
      if (aValue > bValue) return 1 * direction;
      return a.username.localeCompare(b.username) * direction;
    });
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
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        Subscribers
      </Typography>

      {subscribers.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="h6">No active subscribers</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Subscribers will appear here when clients connect with
            subscriptions.
          </Typography>
        </Paper>
      ) : (
        <>
          {compactLayout && (
            <Box sx={{ mb: 2 }}>
              <MobileSortControls
                field={sortField}
                direction={sortDir}
                options={MOBILE_SORT_OPTIONS}
                onFieldChange={(field) => {
                  setSortField(field);
                  setSortDir("desc");
                }}
                onDirectionToggle={() =>
                  setSortDir((direction) =>
                    direction === "asc" ? "desc" : "asc",
                  )
                }
              />
            </Box>
          )}

          {compactLayout ? (
            <Stack spacing={1.5}>
              {sorted.map((sub) => (
                <Card key={sub.username} data-testid="subscriber-row">
                  <CardActionArea onClick={() => onSelectSubscriber(sub)}>
                    <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                      <Typography
                        variant="subtitle1"
                        sx={{ wordBreak: "break-word", mb: 1 }}
                      >
                        {sub.username}
                      </Typography>
                      <SubscriptionChips sub={sub} />
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 1.5,
                          mt: 1.5,
                        }}
                      >
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Connections
                          </Typography>
                          <Typography variant="body2">
                            {numberFormat.format(sub.connectionCount)}{" "}
                            connection
                            {sub.connectionCount !== 1 ? "s" : ""} ·{" "}
                            {sub.brokers?.length ?? 0} broker
                            {(sub.brokers?.length ?? 0) !== 1 ? "s" : ""}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Last active
                          </Typography>
                          <Typography variant="body2">
                            {age(Date.now() - sub.lastSeenAt)}
                          </Typography>
                        </Box>
                      </Box>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </Stack>
          ) : (
            <Paper>
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
                    {sorted.map((sub) => (
                      <TableRow
                        key={sub.username}
                        hover
                        data-testid="subscriber-row"
                        onClick={() => onSelectSubscriber(sub)}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelectSubscriber(sub);
                          }
                        }}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell>
                          <Typography
                            variant="body2"
                            title={sub.username}
                            sx={{
                              fontWeight: 500,
                              maxWidth: 220,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {sub.username}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <SubscriptionChips sub={sub} />
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2">
                            {numberFormat.format(sub.connectionCount)}{" "}
                            connection
                            {sub.connectionCount !== 1 ? "s" : ""} ·{" "}
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
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
