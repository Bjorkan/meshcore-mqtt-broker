import { useState, useMemo } from "react";
import type { BanSummary, SortDir } from "../types.js";
import { StatusBadge } from "../components/shared/status-badge.js";
import { MobileSortControls } from "../components/ui/mobile-sort-controls.js";
import { shortKey, numberFormat } from "../helpers/time.js";
import {
  formatDeniedUntilLabel,
  formatPublicMuteReason,
  formatDenialStatus,
} from "../helpers/format.js";
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

function statusForBan(ban: BanSummary) {
  return formatDenialStatus(ban.status);
}

export default function BansView({ bans, onSelectBan }: BansProps) {
  const theme = useTheme();
  const compactLayout = useMediaQuery(theme.breakpoints.down("lg"));
  const [sortField, setSortField] = useState("blockCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;
    return [...bans].sort((a, b) => {
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
      return (a.label || a.node).localeCompare(b.label || b.node) * direction;
    });
  }, [bans, sortField, sortDir]);

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
        Bans
      </Typography>

      {bans.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="h6">No active bans</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            All observers are currently operating within acceptable limits.
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
              {sorted.map((ban, idx) => {
                const status = statusForBan(ban);
                return (
                  <Card key={`${ban.node}-${idx}`} data-testid="ban-row">
                    <CardActionArea onClick={() => onSelectBan(ban)}>
                      <CardContent>
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
                              variant="subtitle1"
                              sx={{ wordBreak: "break-word" }}
                            >
                              {ban.label || shortKey(ban.node)}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              component="div"
                              sx={{ fontFamily: "monospace" }}
                            >
                              {shortKey(ban.node)}
                            </Typography>
                            {ban.region && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {ban.region}
                              </Typography>
                            )}
                          </Box>
                          <StatusBadge
                            label={status.label}
                            color={status.color}
                          />
                        </Box>

                        <Box
                          sx={{
                            display: "grid",
                            gridTemplateColumns: {
                              xs: "1fr",
                              sm: "2fr 1fr 2fr",
                            },
                            gap: 2,
                            mt: 2,
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
                              sx={{ wordBreak: "break-word" }}
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
                              sx={{ wordBreak: "break-word" }}
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
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>
                        {renderSortLabel("node", "Observer / key")}
                      </TableCell>
                      <TableCell>
                        {renderSortLabel("reason", "Reason")}
                      </TableCell>
                      <TableCell>
                        {renderSortLabel("blockCount", "Blocks")}
                      </TableCell>
                      <TableCell>Action / expiry</TableCell>
                      <TableCell>
                        {renderSortLabel("status", "Status")}
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sorted.map((ban, idx) => {
                      const status = statusForBan(ban);
                      return (
                        <TableRow
                          key={`${ban.node}-${idx}`}
                          hover
                          data-testid="ban-row"
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
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 500 }}
                            >
                              {ban.label || shortKey(ban.node)}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ fontFamily: "monospace" }}
                            >
                              {shortKey(ban.node)}
                            </Typography>
                            {ban.region && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                component="div"
                              >
                                {ban.region}
                              </Typography>
                            )}
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
  );
}
