import { useState, useMemo } from "react";
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
  const [sortField, setSortField] = useState("lastSeenAt");
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
      return a.label.localeCompare(b.label) * direction;
    });
  }, [filtered, sortField, sortDir]);

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
              setSortField(field);
              setSortDir("desc");
            }}
            onDirectionToggle={() =>
              setSortDir((direction) => (direction === "asc" ? "desc" : "asc"))
            }
          />
        </Box>
      )}

      {sorted.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">
            No observers match your filters.
          </Typography>
        </Paper>
      ) : compactLayout ? (
        <Stack spacing={1.5}>
          {sorted.map((obs) => {
            const regionDisplay = formatRegionDisplay(obs.region, countyLookup);
            const neighborCount = obs.neighbors?.neighbors?.length ?? 0;
            return (
              <Card key={obs.publicKey} data-testid="observer-row">
                <CardActionArea onClick={() => onSelectObserver(obs)}>
                  <CardContent>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 2,
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="subtitle1"
                          sx={{ wordBreak: "break-word" }}
                        >
                          {obs.label || shortKey(obs.publicKey)}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="div"
                          sx={{ fontFamily: "monospace" }}
                        >
                          {shortKey(obs.publicKey)}
                        </Typography>
                      </Box>
                      <StatusBadge
                        label={obs.active ? "Online" : "Offline"}
                        color={obs.active ? "success" : "default"}
                      />
                    </Box>

                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: {
                          xs: "1fr 1fr",
                          sm: "2fr 1fr 1fr 1fr",
                        },
                        gap: 2,
                        mt: 2,
                      }}
                    >
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Region
                        </Typography>
                        <Typography variant="body2">
                          {regionDisplay?.countyName ||
                            regionDisplay?.code ||
                            "—"}
                        </Typography>
                        {regionDisplay?.countyName && (
                          <Typography variant="caption" color="text.secondary">
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
          <TableContainer sx={{ maxHeight: "calc(100vh - 220px)" }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{renderSortLabel("label", "Observer")}</TableCell>
                  <TableCell>{renderSortLabel("region", "Region")}</TableCell>
                  <TableCell>
                    {renderSortLabel("lastConnectedAt", "Last connected")}
                  </TableCell>
                  <TableCell>
                    {renderSortLabel("lastSeenAt", "Last message")}
                  </TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Neighbors</TableCell>
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
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectObserver(obs);
                        }
                      }}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell>
                        <Typography
                          variant="body2"
                          title={obs.label || shortKey(obs.publicKey)}
                          sx={{
                            fontWeight: 500,
                            maxWidth: 240,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {obs.label || shortKey(obs.publicKey)}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontFamily: "monospace" }}
                        >
                          {shortKey(obs.publicKey)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {regionDisplay?.countyName ||
                            regionDisplay?.code ||
                            "—"}
                        </Typography>
                        {regionDisplay?.countyName && (
                          <Typography variant="caption" color="text.secondary">
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
  );
}
