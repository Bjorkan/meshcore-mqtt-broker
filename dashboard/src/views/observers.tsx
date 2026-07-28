import { useState, useMemo } from "react";
import type { CSSProperties } from "react";
import type {
  DashboardSnapshot,
  DashboardObserver,
  SortDir,
} from "../types.js";
import { StatusBadge } from "../components/shared/status-badge.js";
import SearchBar from "../components/ui/search-bar.js";
import RegionFilter from "../components/ui/region-filter.js";
import { MobileSortControls } from "../components/ui/mobile-sort-controls.js";
import { shortKey, age, numberFormat } from "../helpers/time.js";
import { formatRegionDisplay } from "../helpers/format.js";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Paper,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableSortLabel,
  TableContainer,
  Stack,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";

interface ObserversProps {
  snapshot: DashboardSnapshot;
  query: string;
  onQueryChange: (query: string) => void;
  regionFilter: string;
  onRegionChange: (region: string) => void;
  onSelectObserver: (observer: DashboardObserver) => void;
}

const MOBILE_SORT_OPTIONS = [
  { value: "label", label: "Observer" },
  { value: "region", label: "Region" },
  { value: "lastConnectedAt", label: "Last connected" },
  { value: "lastSeenAt", label: "Last message" },
];

type ObserverSortField = "label" | "region" | "lastConnectedAt" | "lastSeenAt";

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

function observerName(observer: DashboardObserver): string {
  return observer.label || observer.publicKey;
}

function observerRegion(
  observer: DashboardObserver,
  countyLookup: DashboardSnapshot["countyLookup"],
): string {
  const region = formatRegionDisplay(observer.region, countyLookup);
  if (!region) return "—";
  return region.countyName
    ? `${region.countyName} (${region.code})`
    : region.code;
}

function isObserverSortField(field: string): field is ObserverSortField {
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
      aria-label={`View observer details for ${label}`}
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

export default function ObserversView({
  snapshot,
  query,
  onQueryChange,
  regionFilter,
  onRegionChange,
  onSelectObserver,
}: ObserversProps) {
  const theme = useTheme();
  const compactLayout = useMediaQuery(theme.breakpoints.down("lg"));
  const [sortField, setSortField] = useState<ObserverSortField>("lastSeenAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { observers, countyLookup } = snapshot;

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const obs of observers) {
      if (obs.region) set.add(obs.region);
    }
    return Array.from(set).sort();
  }, [observers]);

  const filtered = useMemo(() => {
    let result = observers;
    if (regionFilter) {
      result = result.filter((o) => o.region === regionFilter);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.publicKey.toLowerCase().includes(q),
      );
    }
    return result;
  }, [observers, query, regionFilter]);

  const sorted = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let comparison: number;
      switch (sortField) {
        case "label":
          comparison = compareDisplayText(observerName(a), observerName(b));
          break;
        case "region":
          comparison = compareDisplayText(
            observerRegion(a, countyLookup),
            observerRegion(b, countyLookup),
          );
          break;
        case "lastConnectedAt":
          comparison = a.lastConnectedAt - b.lastConnectedAt;
          break;
        case "lastSeenAt":
          comparison = a.lastSeenAt - b.lastSeenAt;
          break;
      }
      if (comparison !== 0) return comparison * direction;
      return compareDisplayText(a.publicKey, b.publicKey);
    });
  }, [countyLookup, filtered, sortField, sortDir]);

  function handleSort(field: ObserverSortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function renderSortLabel(field: ObserverSortField, label: string) {
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
        Observers
      </Typography>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <SearchBar
            value={query}
            onChange={onQueryChange}
            placeholder="Search by label or public key…"
          />
        </Box>
        <Box sx={{ width: { xs: "100%", sm: 260 } }}>
          <RegionFilter
            regions={regions}
            selectedRegion={regionFilter}
            onChange={onRegionChange}
            countyLookup={countyLookup}
          />
        </Box>
      </Stack>

      {compactLayout && (
        <Box sx={{ mb: 2 }}>
          <MobileSortControls
            field={sortField}
            direction={sortDir}
            options={MOBILE_SORT_OPTIONS}
            onFieldChange={(field) => {
              if (isObserverSortField(field)) {
                setSortField(field);
                setSortDir("desc");
              }
            }}
            onDirectionToggle={() =>
              setSortDir((direction) => (direction === "asc" ? "desc" : "asc"))
            }
          />
        </Box>
      )}

      <Box component="section" aria-labelledby="observer-results-heading">
        <Typography
          id="observer-results-heading"
          variant="subtitle1"
          component="h2"
          sx={{ mb: 1 }}
        >
          Observer results ({numberFormat.format(sorted.length)})
        </Typography>

        {sorted.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary">
              {observers.length === 0
                ? "No observers have reported yet."
                : "No observers match the current search and region filters."}
            </Typography>
          </Paper>
        ) : compactLayout ? (
          <Stack spacing={1.5}>
            {sorted.map((obs) => {
              const regionDisplay = formatRegionDisplay(
                obs.region,
                countyLookup,
              );
              const neighborCount = obs.neighbors?.neighbors?.length ?? 0;
              return (
                <Card key={obs.publicKey} data-testid="observer-row">
                  <CardActionArea onClick={() => onSelectObserver(obs)}>
                    <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 1.5,
                        }}
                      >
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography
                            variant="subtitle1"
                            sx={{
                              wordBreak: "break-word",
                              lineHeight: 1.3,
                            }}
                          >
                            {obs.label || shortKey(obs.publicKey)}
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
                            {obs.publicKey}
                          </Typography>
                        </Box>
                        <Box sx={{ flexShrink: 0, pt: 0.25 }}>
                          <StatusBadge
                            label={obs.active ? "Online" : "Offline"}
                            color={obs.active ? "success" : "default"}
                          />
                        </Box>
                      </Box>

                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: {
                            xs: "1fr 1fr",
                            sm: "2fr 1fr 1fr 1fr",
                          },
                          gap: 1.5,
                          mt: 1.5,
                        }}
                      >
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Region
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{ overflowWrap: "anywhere" }}
                          >
                            {regionDisplay?.countyName ||
                              regionDisplay?.code ||
                              "—"}
                          </Typography>
                          {regionDisplay?.countyName && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {regionDisplay.code}
                            </Typography>
                          )}
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Last connected
                          </Typography>
                          <Typography variant="body2">
                            {age(Date.now() - obs.lastConnectedAt)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Last message
                          </Typography>
                          <Typography variant="body2">
                            {age(Date.now() - obs.lastSeenAt)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Neighbors
                          </Typography>
                          <Typography variant="body2">
                            {neighborCount > 0
                              ? numberFormat.format(neighborCount)
                              : "—"}
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
            <TableContainer
              sx={{ maxHeight: "calc(100vh - 220px)", overflowX: "hidden" }}
            >
              <Table
                size="small"
                stickyHeader
                sx={{ tableLayout: "fixed", width: "100%" }}
              >
                <caption style={visuallyHiddenCaptionStyle}>
                  Observers matching the current search and region filters
                </caption>
                <TableHead>
                  <TableRow>
                    <TableCell
                      sortDirection={sortField === "label" ? sortDir : false}
                      sx={{ width: "26%" }}
                    >
                      {renderSortLabel("label", "Observer")}
                    </TableCell>
                    <TableCell
                      sortDirection={sortField === "region" ? sortDir : false}
                      sx={{ width: "18%" }}
                    >
                      {renderSortLabel("region", "Region")}
                    </TableCell>
                    <TableCell
                      sortDirection={
                        sortField === "lastConnectedAt" ? sortDir : false
                      }
                      sx={{ width: "17%" }}
                    >
                      {renderSortLabel("lastConnectedAt", "Last connected")}
                    </TableCell>
                    <TableCell
                      sortDirection={
                        sortField === "lastSeenAt" ? sortDir : false
                      }
                      sx={{ width: "17%" }}
                    >
                      {renderSortLabel("lastSeenAt", "Last message")}
                    </TableCell>
                    <TableCell sx={{ width: "12%" }}>Status</TableCell>
                    <TableCell align="right" sx={{ width: "10%" }}>
                      Neighbors
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sorted.map((obs) => {
                    const regionDisplay = formatRegionDisplay(
                      obs.region,
                      countyLookup,
                    );
                    const neighborCount = obs.neighbors?.neighbors?.length ?? 0;
                    return (
                      <TableRow
                        key={obs.publicKey}
                        hover
                        data-testid="observer-row"
                        onClick={() => onSelectObserver(obs)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell sx={{ minWidth: 0 }}>
                          <RecordDetailsButton
                            label={observerName(obs)}
                            onSelect={() => onSelectObserver(obs)}
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
                            {obs.publicKey}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ overflowWrap: "anywhere" }}>
                          <Typography
                            variant="body2"
                            sx={{ overflowWrap: "anywhere" }}
                          >
                            {regionDisplay?.countyName ||
                              regionDisplay?.code ||
                              "—"}
                          </Typography>
                          {regionDisplay?.countyName && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {regionDisplay.code}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {age(Date.now() - obs.lastConnectedAt)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {age(Date.now() - obs.lastSeenAt)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            label={obs.active ? "Online" : "Offline"}
                            color={obs.active ? "success" : "default"}
                          />
                        </TableCell>
                        <TableCell align="right">
                          {neighborCount > 0
                            ? numberFormat.format(neighborCount)
                            : "—"}
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
    </Box>
  );
}
