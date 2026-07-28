import { useState, useMemo } from "react";
import type { CSSProperties } from "react";
import type { SubscriberConnectionEntry, SortDir } from "../types.js";
import { MobileSortControls } from "../components/ui/mobile-sort-controls.js";
import { age, numberFormat } from "../helpers/time.js";
import {
  Box,
  Button,
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

type SubscriberSortField = "username" | "connectionCount" | "lastSeenAt";

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

function isSubscriberSortField(field: string): field is SubscriberSortField {
  return MOBILE_SORT_OPTIONS.some((option) => option.value === field);
}

function RecordDetailsButton({
  label,
  onSelect,
}: {
  label: string;
  onSelect: () => void;
}) {
  return (
    <Button
      fullWidth
      size="small"
      aria-label={`View subscriber details for ${label}`}
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

function SubscriptionChips({ sub }: { sub: SubscriberConnectionEntry }) {
  const visibleSubs = sub.subscriptions.slice(0, MAX_VISIBLE_SUBS);
  const remaining = Math.max(0, sub.subscriptions.length - MAX_VISIBLE_SUBS);
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
      {sub.subscriptions.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No topics reported.
        </Typography>
      )}
      {visibleSubs.map((topic, index) => (
        <Chip
          key={`${topic}-${index}`}
          label={topic}
          size="small"
          variant="outlined"
          title={topic}
          sx={{
            maxWidth: "100%",
            height: "auto",
            "& .MuiChip-label": {
              display: "block",
              py: 0.5,
              whiteSpace: "normal",
              overflowWrap: "anywhere",
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
  const [sortField, setSortField] = useState<SubscriberSortField>("lastSeenAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;
    return [...subscribers].sort((a, b) => {
      let comparison: number;
      switch (sortField) {
        case "username":
          comparison = compareDisplayText(a.username, b.username);
          break;
        case "connectionCount":
          comparison = a.connectionCount - b.connectionCount;
          break;
        case "lastSeenAt":
          comparison = a.lastSeenAt - b.lastSeenAt;
          break;
      }
      if (comparison !== 0) return comparison * direction;
      return compareDisplayText(a.username, b.username);
    });
  }, [subscribers, sortField, sortDir]);

  function handleSort(field: SubscriberSortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function renderSortLabel(field: SubscriberSortField, label: string) {
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

      <Box component="section" aria-labelledby="subscriber-results-heading">
        <Typography
          id="subscriber-results-heading"
          variant="subtitle1"
          component="h2"
          sx={{ mb: 1 }}
        >
          Connected subscribers ({numberFormat.format(subscribers.length)})
        </Typography>

        {subscribers.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: "center" }}>
            <Typography variant="h6" component="p">
              No subscriber connections reported
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Connected subscriber clients will appear here, including clients
              that have not reported any topics.
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
                    if (isSubscriberSortField(field)) {
                      setSortField(field);
                      setSortDir("desc");
                    }
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
                      <CardContent
                        sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}
                      >
                        <Typography
                          variant="subtitle1"
                          sx={{ overflowWrap: "anywhere", mb: 1 }}
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
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
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
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
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
                <TableContainer sx={{ overflowX: "hidden" }}>
                  <Table
                    size="small"
                    sx={{ tableLayout: "fixed", width: "100%" }}
                  >
                    <caption style={visuallyHiddenCaptionStyle}>
                      Connected subscribers with reported topics, connection
                      counts, and last activity
                    </caption>
                    <TableHead>
                      <TableRow>
                        <TableCell
                          sortDirection={
                            sortField === "username" ? sortDir : false
                          }
                          sx={{ width: "25%" }}
                        >
                          {renderSortLabel("username", "Username")}
                        </TableCell>
                        <TableCell sx={{ width: "39%" }}>
                          Subscriptions
                        </TableCell>
                        <TableCell
                          align="right"
                          sortDirection={
                            sortField === "connectionCount" ? sortDir : false
                          }
                          sx={{ width: "20%" }}
                        >
                          {renderSortLabel("connectionCount", "Connections")}
                        </TableCell>
                        <TableCell
                          sortDirection={
                            sortField === "lastSeenAt" ? sortDir : false
                          }
                          sx={{ width: "16%" }}
                        >
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
                          sx={{ cursor: "pointer" }}
                        >
                          <TableCell sx={{ minWidth: 0 }}>
                            <RecordDetailsButton
                              label={sub.username}
                              onSelect={() => onSelectSubscriber(sub)}
                            />
                          </TableCell>
                          <TableCell sx={{ minWidth: 0 }}>
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
    </Box>
  );
}
