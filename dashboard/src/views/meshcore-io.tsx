import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import type {
  MeshcoreIoDashboardSnapshot,
  MeshcoreIoMapAdvert,
  SortDir,
} from "../types.js";
import { MetricCard } from "../components/shared/metric-card.js";
import { StatusBadge } from "../components/shared/status-badge.js";
import { stockholmEventTime, numberFormat } from "../helpers/time.js";
import {
  Box,
  Button,
  Paper,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableSortLabel,
  TableContainer,
  Card,
  CardContent,
  Chip,
  Alert,
  Stack,
  Grid,
  useTheme,
} from "@mui/material";
import {
  CloudUpload,
  Dns,
  MyLocation,
  Storage,
  BugReport,
} from "@mui/icons-material";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface MeshcoreIoViewProps {
  state: MeshcoreIoDashboardSnapshot | undefined;
  compact: boolean;
  generatedAt: number;
}

const ADVERT_COLORS: Record<string, string> = {
  repeater: "#1b5e20",
  room: "#0d47a1",
  sensor: "#e65100",
  default: "#546e7a",
};

function advertColor(type: string): string {
  return ADVERT_COLORS[type] ?? ADVERT_COLORS.default;
}

function historyStatusLabel(status: string): string {
  if (status === "uploaded") return "Uploaded";
  if (status === "dropped") return "Dropped";
  return status;
}
function historyStatusColor(status: string): "success" | "error" | "default" {
  if (status === "uploaded") return "success";
  if (status === "dropped") return "error";
  return "default";
}

function MapView({
  adverts,
  dark,
}: {
  adverts: MeshcoreIoMapAdvert[];
  dark: boolean;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [selected, setSelected] = useState<MeshcoreIoMapAdvert | null>(null);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: dark
        ? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        : "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [15.6, 62.0],
      zoom: 3.5,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    map.on("load", () => {
      map.addSource("adverts", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "advert-circles",
        type: "circle",
        source: "adverts",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            3,
            10,
            8,
            16,
            14,
          ],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.8,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#fff",
        },
      });

      map.on("click", "advert-circles", (e) => {
        if (e.features && e.features[0]) {
          const props = e.features[0].properties as any;
          setSelected(props.advert as MeshcoreIoMapAdvert);
          map.flyTo({
            center: (e.features[0].geometry as any).coordinates,
            zoom: 10,
          });
        }
      });

      map.on("mouseenter", "advert-circles", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "advert-circles", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [dark]);

  useEffect(() => {
    const handleResize = () => {
      mapRef.current?.resize();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("adverts")) return;

    const features = adverts.map((ad) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [ad.longitude, ad.latitude],
      },
      properties: {
        color: advertColor(ad.advertType),
        advert: ad,
      },
    }));

    (map.getSource("adverts") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features,
    });
  }, [adverts]);

  return (
    <Box sx={{ position: "relative" }}>
      <Box
        ref={mapContainer}
        sx={{
          width: "100%",
          height: 400,
          borderRadius: 1,
          overflow: "hidden",
          border: 1,
          borderColor: "divider",
        }}
      />
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ mt: 1, flexWrap: "wrap", gap: 1 }}
      >
        <Chip
          label="Repeater"
          size="small"
          sx={{ bgcolor: ADVERT_COLORS.repeater, color: "#fff" }}
        />
        <Chip
          label="Room"
          size="small"
          sx={{ bgcolor: ADVERT_COLORS.room, color: "#fff" }}
        />
        <Chip
          label="Sensor"
          size="small"
          sx={{ bgcolor: ADVERT_COLORS.sensor, color: "#fff" }}
        />
        <Chip
          label="Other"
          size="small"
          sx={{ bgcolor: ADVERT_COLORS.default, color: "#fff" }}
        />
      </Stack>
      <Button
        data-testid="fit-adverts"
        size="small"
        variant="outlined"
        startIcon={<MyLocation />}
        onClick={() => {
          if (mapRef.current) {
            const bounds = new maplibregl.LngLatBounds();
            adverts.forEach((a) => bounds.extend([a.longitude, a.latitude]));
            if (!bounds.isEmpty()) {
              mapRef.current.fitBounds(bounds, {
                padding: 48,
                maxZoom: 12,
                duration: 450,
              });
            }
          }
        }}
        sx={{ mt: 1 }}
      >
        Fit adverts
      </Button>
      {selected && (
        <Paper variant="outlined" sx={{ mt: 1, p: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {selected.nodeName}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {selected.advertType} · {selected.observerName || "-"}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)}
          </Typography>
        </Paper>
      )}
    </Box>
  );
}

export default function MeshcoreIoView({
  state,
  compact,
  generatedAt,
}: MeshcoreIoViewProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";

  const [sortField, setSortField] = useState("lastUploadAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [historySortField, setHistorySortField] = useState("at");
  const [historySortDir, setHistorySortDir] = useState<SortDir>("desc");

  if (!state || !state.enabled) {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 3, fontWeight: 600 }}>
          MeshCore.io
        </Typography>
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <CloudUpload sx={{ fontSize: 48, color: "text.secondary", mb: 1 }} />
          <Typography variant="h6" color="text.secondary">
            MeshCore.io integration is disabled
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Enable the integration in the broker configuration to see upload
            statistics.
          </Typography>
        </Paper>
      </Box>
    );
  }

  const { processor, queue, totals, workers, history, map } = state;

  function handleWorkerSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function handleHistorySort(field: string) {
    if (historySortField === field) {
      setHistorySortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setHistorySortDir("desc");
      setHistorySortField(field);
    }
  }

  const sortedWorkers = useMemo(() => {
    const s = [...workers].sort((a, b) => {
      let av: any = (a as any)[sortField];
      let bv: any = (b as any)[sortField];
      if (av == null) av = 0;
      if (bv == null) bv = 0;
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    if (sortDir === "desc") s.reverse();
    return s;
  }, [workers, sortField, sortDir]);

  const sortedHistory = useMemo(() => {
    const s = [...history].sort((a, b) => {
      let av: any = (a as any)[historySortField];
      let bv: any = (b as any)[historySortField];
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    if (historySortDir === "desc") s.reverse();
    return s;
  }, [history, historySortField, historySortDir]);

  const adverts = map?.advertsLast7Days ?? [];

  if (compact) {
    return (
      <Box>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Card variant="outlined">
              <CardContent sx={{ "&:last-child": { pb: 1.5 } }}>
                <Typography variant="body2" color="text.secondary">
                  Processor
                </Typography>
                <StatusBadge
                  label={processor.status === "healthy" ? "Healthy" : "Idle"}
                  color={processor.status === "healthy" ? "success" : "default"}
                />
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Card variant="outlined">
              <CardContent sx={{ "&:last-child": { pb: 1.5 } }}>
                <Typography variant="body2" color="text.secondary">
                  Queue
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {numberFormat.format(queue.total)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Card variant="outlined">
              <CardContent sx={{ "&:last-child": { pb: 1.5 } }}>
                <Typography variant="body2" color="text.secondary">
                  Workers
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {numberFormat.format(workers.length)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Card variant="outlined">
              <CardContent sx={{ "&:last-child": { pb: 1.5 } }}>
                <Typography variant="body2" color="text.secondary">
                  Uploaded
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {numberFormat.format(totals.uploaded)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    );
  }

  function renderSortHeader(
    field: string,
    label: string,
    currentField: string,
    currentDir: SortDir,
    handler: (f: string) => void,
  ) {
    return (
      <TableSortLabel
        active={currentField === field}
        direction={currentField === field ? currentDir : "asc"}
        onClick={() => handler(field)}
      >
        {label}
      </TableSortLabel>
    );
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 600 }}>
        MeshCore.io
      </Typography>

      {state.lastError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {state.lastError}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <MetricCard
            label="Queue processor"
            value={processor.status === "healthy" ? "Healthy" : "Idle"}
            icon={<CloudUpload />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <MetricCard
            label="Durable queue"
            value={numberFormat.format(queue.total)}
            note={
              queue.maxQueuedUploads > 0
                ? `Max: ${numberFormat.format(queue.maxQueuedUploads)}`
                : undefined
            }
            icon={<Storage />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <MetricCard
            label="Upload workers"
            value={numberFormat.format(workers.length)}
            icon={<Dns />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <MetricCard
            label="Uploads"
            value={numberFormat.format(totals.uploaded)}
            note={`${numberFormat.format(totals.dropped)} dropped · ${numberFormat.format(totals.enqueued)} enqueued`}
            icon={<BugReport />}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
              Queue Details
            </Typography>
            <Stack spacing={1}>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Ingress pending
                </Typography>
                <Typography variant="body2">
                  {numberFormat.format(queue.ingressPending)}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Queued
                </Typography>
                <Typography variant="body2">
                  {numberFormat.format(queue.queued)}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Claimed
                </Typography>
                <Typography variant="body2">
                  {numberFormat.format(queue.claimed)}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Active
                </Typography>
                <Typography variant="body2">
                  {numberFormat.format(queue.active)}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Claimed (not active)
                </Typography>
                <Typography variant="body2">
                  {numberFormat.format(queue.claimedNotActive)}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
              Totals
            </Typography>
            <Stack spacing={1}>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Enqueued
                </Typography>
                <Typography variant="body2">
                  {numberFormat.format(totals.enqueued)}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Uploaded
                </Typography>
                <Typography variant="body2" color="success.main">
                  {numberFormat.format(totals.uploaded)}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Dropped
                </Typography>
                <Typography variant="body2" color="error">
                  {numberFormat.format(totals.dropped)}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Invalid
                </Typography>
                <Typography variant="body2" color="warning.main">
                  {numberFormat.format(totals.invalid)}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography variant="body2" color="text.secondary">
                  Retries
                </Typography>
                <Typography variant="body2">
                  {numberFormat.format(totals.retries)}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {adverts.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
            Advert Map (last 7 days)
          </Typography>
          <MapView adverts={adverts} dark={dark} />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 1, display: "block" }}
          >
            {numberFormat.format(adverts.length)} adverts with coordinates
          </Typography>
        </Paper>
      )}

      {workers.length > 0 ? (
        <Paper variant="outlined" sx={{ mb: 2 }}>
          <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Upload Workers
            </Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>
                    {renderSortHeader(
                      "instanceId",
                      "Instance",
                      sortField,
                      sortDir,
                      handleWorkerSort,
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {renderSortHeader(
                      "activeUploads",
                      "Active",
                      sortField,
                      sortDir,
                      handleWorkerSort,
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {renderSortHeader(
                      "uploadsSucceeded",
                      "Succeeded",
                      sortField,
                      sortDir,
                      handleWorkerSort,
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {renderSortHeader(
                      "uploadsFailed",
                      "Failed",
                      sortField,
                      sortDir,
                      handleWorkerSort,
                    )}
                  </TableCell>
                  <TableCell>
                    {renderSortHeader(
                      "lastUploadAt",
                      "Last upload",
                      sortField,
                      sortDir,
                      handleWorkerSort,
                    )}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedWorkers.map((w) => (
                  <TableRow key={w.instanceId}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {w.instanceId}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {numberFormat.format(w.activeUploads)}
                    </TableCell>
                    <TableCell align="right">
                      {numberFormat.format(w.uploadsSucceeded)}
                    </TableCell>
                    <TableCell align="right">
                      {numberFormat.format(w.uploadsFailed)}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {w.lastUploadAt
                          ? stockholmEventTime(w.lastUploadAt)
                          : "-"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No workers have reported yet.
        </Typography>
      )}

      {history.length > 0 ? (
        <Paper variant="outlined">
          <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Recent Upload History
            </Typography>
          </Box>
          <TableContainer sx={{ maxHeight: 500 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>
                    {renderSortHeader(
                      "at",
                      "Time",
                      historySortField,
                      historySortDir,
                      handleHistorySort,
                    )}
                  </TableCell>
                  <TableCell>
                    {renderSortHeader(
                      "status",
                      "Status",
                      historySortField,
                      historySortDir,
                      handleHistorySort,
                    )}
                  </TableCell>
                  <TableCell>
                    {renderSortHeader(
                      "nodeName",
                      "Node",
                      historySortField,
                      historySortDir,
                      handleHistorySort,
                    )}
                  </TableCell>
                  <TableCell>
                    {renderSortHeader(
                      "advertType",
                      "Type",
                      historySortField,
                      historySortDir,
                      handleHistorySort,
                    )}
                  </TableCell>
                  <TableCell>Worker</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedHistory.map((entry, idx) => (
                  <TableRow key={`${entry.requestId}-${idx}`}>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {stockholmEventTime(entry.at)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        label={
                          entry.status === "uploaded" ? "Uploaded" : "Dropped"
                        }
                        color={
                          entry.status === "uploaded" ? "success" : "error"
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {entry.nodeName}
                      </Typography>
                      {entry.observerName && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="div"
                        >
                          {entry.observerName}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={entry.advertType}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {entry.workerInstanceId}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No uploads have completed yet.
        </Typography>
      )}
    </Box>
  );
}
