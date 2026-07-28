import { useState, useMemo } from "react";
import type { CSSProperties } from "react";
import type { BanSummary, SortDir } from "../types.js";
import { StatusBadge } from "../components/shared/status-badge.js";
import { MobileSortControls } from "../components/ui/mobile-sort-controls.js";
import { numberFormat } from "../helpers/time.js";
import {
  formatDeniedUntilLabel,
  formatPublicMuteReason,
  formatDenialStatus,
} from "../helpers/format.js";
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
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";

interface BansProps {
  bans: BanSummary[];
  onSelectBan: (ban: BanSummary) => void;
}

const MOBILE_SORT_OPTIONS = [
  { value: "node", label: "Observer" },
  { value: "reason", label: "Reason" },
  { value: "blockCount", label: "Blocks" },
  { value: "status", label: "Status" },
];

type BanSortField = "node" | "reason" | "blockCount" | "status";

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

function isBanSortField(field: string): field is BanSortField {
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
      aria-label={`View protection event details for ${label}`}
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

function statusForBan(ban: BanSummary) {
  return formatDenialStatus(ban.status);
}

export default function BansView({ bans, onSelectBan }: BansProps) {
  const theme = useTheme();
  const compactLayout = useMediaQuery(theme.breakpoints.down("lg"));
  const [sortField, setSortField] = useState<BanSortField>("blockCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;
    return [...bans].sort((a, b) => {
      let comparison: number;
      switch (sortField) {
        case "node":
          comparison = compareDisplayText(banName(a), banName(b));
          break;
        case "reason":
          comparison = compareDisplayText(
            formatPublicMuteReason(a.reason),
            formatPublicMuteReason(b.reason),
          );
          break;
        case "blockCount":
          comparison = a.blockCount - b.blockCount;
          break;
        case "status":
          comparison = compareDisplayText(
            statusForBan(a).label,
            statusForBan(b).label,
          );
          break;
      }
      if (comparison !== 0) return comparison * direction;
      return compareDisplayText(banStableKey(a), banStableKey(b));
    });
  }, [bans, sortField, sortDir]);

  function handleSort(field: BanSortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function renderSortLabel(field: BanSortField, label: string) {
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
        Protection events
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Observer protection decisions include active blocks and non-blocking
        warnings. Check each event&apos;s Status field for the current outcome.
      </Typography>

      <Box component="section" aria-labelledby="protection-events-heading">
        <Typography
          id="protection-events-heading"
          variant="subtitle1"
          component="h2"
          sx={{ mb: 1 }}
        >
          Reported events ({numberFormat.format(bans.length)})
        </Typography>

        {bans.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: "center" }}>
            <Typography variant="h6" component="p">
              No protection events reported
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              No blocked or warning events are present in this dashboard
              snapshot.
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
                    if (isBanSortField(field)) {
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
                {sorted.map((ban) => {
                  const status = statusForBan(ban);
                  return (
                    <Card key={banStableKey(ban)} data-testid="ban-row">
                      <CardActionArea onClick={() => onSelectBan(ban)}>
                        <CardContent
                          sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}
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
                                variant="subtitle1"
                                sx={{ wordBreak: "break-word" }}
                              >
                                {banName(ban)}
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
                                {ban.node}
                              </Typography>
                              {ban.region && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  component="div"
                                  sx={{ overflowWrap: "anywhere" }}
                                >
                                  {ban.region}
                                </Typography>
                              )}
                            </Box>
                            <Box sx={{ flexShrink: 0, pt: 0.25 }}>
                              <StatusBadge
                                label={status.label}
                                color={status.color}
                              />
                            </Box>
                          </Box>

                          <Box
                            sx={{
                              display: "grid",
                              gridTemplateColumns: {
                                xs: "1fr",
                                sm: "2fr 1fr 2fr",
                              },
                              gap: 1.5,
                              mt: 1.5,
                            }}
                          >
                            <Box>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                Reason
                              </Typography>
                              <Typography
                                variant="body2"
                                sx={{ overflowWrap: "anywhere" }}
                              >
                                {formatPublicMuteReason(ban.reason)}
                              </Typography>
                            </Box>
                            <Box>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                Blocks
                              </Typography>
                              <Typography variant="body2">
                                {numberFormat.format(ban.blockCount)}
                              </Typography>
                            </Box>
                            <Box>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
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
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  );
                })}
              </Stack>
            ) : (
              <Paper>
                <TableContainer sx={{ overflowX: "hidden" }}>
                  <Table
                    size="small"
                    sx={{ tableLayout: "fixed", width: "100%" }}
                  >
                    <caption style={visuallyHiddenCaptionStyle}>
                      Protection events with block, warning, reason, and expiry
                      status
                    </caption>
                    <TableHead>
                      <TableRow>
                        <TableCell
                          sortDirection={sortField === "node" ? sortDir : false}
                          sx={{ width: "25%" }}
                        >
                          {renderSortLabel("node", "Observer")}
                        </TableCell>
                        <TableCell
                          sortDirection={
                            sortField === "reason" ? sortDir : false
                          }
                          sx={{ width: "23%" }}
                        >
                          {renderSortLabel("reason", "Reason")}
                        </TableCell>
                        <TableCell
                          align="right"
                          sortDirection={
                            sortField === "blockCount" ? sortDir : false
                          }
                          sx={{ width: "12%" }}
                        >
                          {renderSortLabel("blockCount", "Blocks")}
                        </TableCell>
                        <TableCell sx={{ width: "24%" }}>
                          Action / expiry
                        </TableCell>
                        <TableCell
                          sortDirection={
                            sortField === "status" ? sortDir : false
                          }
                          sx={{ width: "16%" }}
                        >
                          {renderSortLabel("status", "Status")}
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sorted.map((ban) => {
                        const status = statusForBan(ban);
                        return (
                          <TableRow
                            key={banStableKey(ban)}
                            hover
                            data-testid="ban-row"
                            onClick={() => onSelectBan(ban)}
                            sx={{ cursor: "pointer" }}
                          >
                            <TableCell sx={{ minWidth: 0 }}>
                              <RecordDetailsButton
                                label={banName(ban)}
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
                              {ban.region && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  component="div"
                                  sx={{ overflowWrap: "anywhere" }}
                                >
                                  {ban.region}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell sx={{ minWidth: 0 }}>
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
                            <TableCell>
                              <StatusBadge
                                label={status.label}
                                color={status.color}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
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
