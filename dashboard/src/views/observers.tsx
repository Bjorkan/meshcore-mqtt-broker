import { useState, useMemo } from "react";
import type {
  DashboardSnapshot,
  DashboardObserver,
  SortDir,
} from "../types.js";
import { StatusBadge } from "../components/shared/status-badge.js";
import SearchBar from "../components/ui/search-bar.js";
import RegionFilter from "../components/ui/region-filter.js";
import { shortKey, age, numberFormat } from "../helpers/time.js";
import { formatRegionDisplay } from "../helpers/format.js";
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
  Stack,
  Chip,
} from "@mui/material";

interface ObserversProps {
  snapshot: DashboardSnapshot;
  query: string;
  onQueryChange: (query: string) => void;
  regionFilter: string;
  onRegionChange: (region: string) => void;
  onSelectObserver: (observer: DashboardObserver) => void;
}

export default function ObserversView({
  snapshot,
  query,
  onQueryChange,
  regionFilter,
  onRegionChange,
  onSelectObserver,
}: ObserversProps) {
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
      const q = query.toLowerCase();
      result = result.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.publicKey.toLowerCase().includes(q),
      );
    }
    return result;
  }, [observers, query, regionFilter]);

  const sorted = useMemo(() => {
    const s = [...filtered].sort((a, b) => {
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
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 600 }}>
        Observers
      </Typography>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <SearchBar
            value={query}
            onChange={onQueryChange}
            placeholder="Search by label or public key..."
          />
        </Box>
        <RegionFilter
          regions={regions}
          selectedRegion={regionFilter}
          onChange={onRegionChange}
          countyLookup={countyLookup}
        />
      </Stack>

      <Paper variant="outlined">
        <TableContainer sx={{ maxHeight: 600 }}>
          <Table size="small">
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
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    sx={{ textAlign: "center", color: "text.secondary", py: 4 }}
                  >
                    No observers match your filters
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((obs) => {
                  const regionDisplay = formatRegionDisplay(
                    obs.region,
                    countyLookup,
                  );
                  const neighborCount = obs.neighbors?.neighbors?.length || 0;
                  return (
                    <TableRow
                      key={obs.publicKey}
                      hover
                      data-testid="observer-row"
                      onClick={() => onSelectObserver(obs)}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 500,
                            maxWidth: 200,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {obs.label || shortKey(obs.publicKey)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {shortKey(obs.publicKey)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {regionDisplay?.countyName ||
                            regionDisplay?.code ||
                            "-"}
                        </Typography>
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
                        {obs.active ? (
                          <StatusBadge label="Online" color="success" />
                        ) : (
                          <StatusBadge label="Offline" color="default" />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2">
                          {neighborCount > 0
                            ? numberFormat.format(neighborCount)
                            : "-"}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
