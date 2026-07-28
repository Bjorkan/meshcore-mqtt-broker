import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MeshcoreIoDashboardSnapshot,
  MeshcoreIoHistoryEntry,
  MeshcoreIoMapAdvert,
  MeshcoreIoWorkerStatus,
  SortDir,
} from "../types.js";
import { MetricCard } from "../components/shared/metric-card.js";
import { StatusBadge } from "../components/shared/status-badge.js";
import { MobileSortControls } from "../components/ui/mobile-sort-controls.js";
import { stockholmEventTime, numberFormat } from "../helpers/time.js";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  CloudDone,
  CloudUpload,
  Dns,
  MyLocation,
  Storage,
} from "@mui/icons-material";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface MeshcoreIoViewProps {
  state: MeshcoreIoDashboardSnapshot | undefined;
  generatedAt: number;
}

const ADVERT_COLORS: Record<string, string> = {
  repeater: "#2e7d32",
  room: "#1565c0",
  sensor: "#bf360c",
  default: "#546e7a",
};

const WORKER_SORT_OPTIONS = [
  { value: "instanceId", label: "Instance" },
  { value: "activeUploads", label: "Active uploads" },
  { value: "uploadsSucceeded", label: "Succeeded" },
  { value: "uploadsFailed", label: "Failed" },
  { value: "lastUploadAt", label: "Last upload" },
];

const HISTORY_SORT_OPTIONS = [
  { value: "at", label: "Time" },
  { value: "status", label: "Status" },
  { value: "nodeName", label: "Node" },
  { value: "advertType", label: "Type" },
];

const EMPTY_WORKERS: MeshcoreIoWorkerStatus[] = [];
const EMPTY_HISTORY: MeshcoreIoHistoryEntry[] = [];

function advertColor(type: string): string {
  return ADVERT_COLORS[type] ?? ADVERT_COLORS.default;
}

function historyStatusLabel(status: string): string {
  if (status === "uploaded") return "Uploaded";
  if (status === "dropped") return "Dropped";
  return status.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

function historyStatusColor(status: string): "success" | "error" | "default" {
  if (status === "uploaded") return "success";
  if (status === "dropped") return "error";
  return "default";
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: "divider" }}>
      <Typography variant="subtitle1">{title}</Typography>
    </Box>
  );
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
  const advertsRef = useRef(adverts);
  const hasFittedInitialBounds = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [selected, setSelected] = useState<MeshcoreIoMapAdvert | null>(null);

  useEffect(() => {
    advertsRef.current = adverts;
  }, [adverts]);

  useEffect(() => {
    if (!mapContainer.current) return;

    setMapReady(false);
    setMapError(false);
    hasFittedInitialBounds.current = false;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: dark
        ? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        : "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [15.6, 62.0],
      zoom: 3.5,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    const loadTimeout = window.setTimeout(() => {
      if (!map.loaded()) setMapError(true);
    }, 10000);

    map.on("load", () => {
      window.clearTimeout(loadTimeout);
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
            6,
            10,
            10,
            16,
            16,
          ],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.9,
          "circle-stroke-width": 2.5,
          "circle-stroke-color": dark ? "#121212" : "#ffffff",
        },
      });

      map.on("click", "advert-circles", (event) => {
        const feature = event.features?.[0];
        const advertIndex = Number(feature?.properties?.advertIndex);
        const currentAdverts = advertsRef.current;
        if (
          !feature ||
          !Number.isInteger(advertIndex) ||
          !currentAdverts[advertIndex]
        )
          return;
        setSelected(currentAdverts[advertIndex]);
        const coordinates = (
          feature.geometry as { coordinates: [number, number] }
        ).coordinates;
        map.easeTo({
          center: coordinates,
          zoom: Math.max(map.getZoom(), 8),
          duration: 450,
        });
      });
      map.on("mouseenter", "advert-circles", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "advert-circles", () => {
        map.getCanvas().style.cursor = "";
      });

      setMapReady(true);
    });

    map.on("error", (event) => {
      const message = String(event.error?.message || "");
      if (message.includes("style") || message.includes("Failed to fetch")) {
        setMapError(true);
      }
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainer.current);

    return () => {
      window.clearTimeout(loadTimeout);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [dark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource("adverts") as
      maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData({
      type: "FeatureCollection",
      features: adverts.map((advert, advertIndex) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [advert.longitude, advert.latitude],
        },
        properties: {
          color: advertColor(advert.advertType),
          advertIndex,
        },
      })),
    });

    if (!hasFittedInitialBounds.current && adverts.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      adverts.forEach((advert) =>
        bounds.extend([advert.longitude, advert.latitude]),
      );
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 8, duration: 0 });
        hasFittedInitialBounds.current = true;
      }
    }
  }, [adverts, mapReady]);

  const fitAdverts = () => {
    const map = mapRef.current;
    if (!map || adverts.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    adverts.forEach((advert) =>
      bounds.extend([advert.longitude, advert.latitude]),
    );
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 450 });
    }
  };

  return (
    <Box>
      <Box
        sx={{
          position: "relative",
          width: "100%",
          height: { xs: 300, sm: 360, md: 440 },
          overflow: "hidden",
          border: 1,
          borderColor: "divider",
          bgcolor: "action.hover",
          "& .maplibregl-ctrl-group": {
            borderRadius: 1,
            overflow: "hidden",
            border: 1,
            borderColor: "divider",
            boxShadow: 1,
          },
          "& .maplibregl-ctrl-group button": {
            width: 40,
            height: 40,
          },
          "& .maplibregl-ctrl-attrib": {
            borderRadius: "4px 0 0 0",
            fontSize: "0.6875rem",
            ...(dark && {
              "&, & a": {
                color: "rgba(255,255,255,0.7)",
                backgroundColor: "rgba(30,30,30,0.85)",
              },
            }),
          },
          ...(dark && {
            "& .maplibregl-ctrl-group": {
              backgroundColor: "#1e1e1e",
              borderColor: "rgba(255,255,255,0.12)",
            },
            "& .maplibregl-ctrl-group button": {
              backgroundColor: "#1e1e1e",
            },
            "& .maplibregl-ctrl-group button + button": {
              borderTopColor: "rgba(255,255,255,0.12)",
            },
            "& .maplibregl-ctrl-group button span": {
              filter: "invert(1)",
            },
          }),
        }}
      >
        <Box ref={mapContainer} sx={{ position: "absolute", inset: 0 }} />
        {!mapReady && !mapError && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              bgcolor: "background.paper",
              zIndex: 10,
            }}
          >
            <Stack sx={{ alignItems: "center" }} spacing={1.5}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary">
                Loading map…
              </Typography>
            </Stack>
          </Box>
        )}
        {mapError && !mapReady && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              p: 3,
              bgcolor: "background.paper",
              zIndex: 10,
            }}
          >
            <Alert severity="warning" sx={{ maxWidth: 520 }}>
              Map tiles could not be loaded. Advert coordinates are listed below
              instead.
            </Alert>
          </Box>
        )}
      </Box>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 1.5,
          mt: 1.5,
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            gap: 0.75,
            alignItems: "center",
          }}
        >
          {[
            ["Repeater", ADVERT_COLORS.repeater],
            ["Room", ADVERT_COLORS.room],
            ["Sensor", ADVERT_COLORS.sensor],
            ["Other", ADVERT_COLORS.default],
          ].map(([label, color]) => (
            <Chip
              key={label}
              label={label}
              size="small"
              variant="outlined"
              icon={
                <Box
                  component="span"
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: color,
                    border: "2px solid",
                    borderColor: dark ? "#121212" : "#ffffff",
                    ml: 0.5,
                  }}
                />
              }
            />
          ))}
        </Box>
        <Button
          data-testid="fit-adverts"
          size="small"
          variant="outlined"
          startIcon={<MyLocation />}
          onClick={fitAdverts}
          disabled={adverts.length === 0}
        >
          Fit adverts
        </Button>
      </Box>

      {selected && (
        <Paper variant="outlined" sx={{ mt: 1.5, p: 2 }}>
          <Typography variant="subtitle2">{selected.nodeName}</Typography>
          <Typography variant="body2" color="text.secondary">
            {selected.advertType} ·{" "}
            {selected.observerName || "Unknown observer"}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{ mt: 0.5 }}
          >
            {selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)}
          </Typography>
        </Paper>
      )}

      {mapError && !mapReady && adverts.length > 0 && (
        <Paper variant="outlined" sx={{ mt: 1.5, overflow: "hidden" }}>
          <Box
            sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: "divider" }}
          >
            <Typography variant="subtitle2">Advert coordinates</Typography>
          </Box>
          <Stack
            divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}
          >
            {adverts.slice(0, 20).map((advert, index) => (
              <Box
                key={`${advert.requestId}-${index}`}
                sx={{ px: 2, py: 1.25 }}
              >
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 500, overflowWrap: "anywhere" }}
                >
                  {advert.nodeName}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                >
                  {advert.advertType} · {advert.latitude.toFixed(4)},{" "}
                  {advert.longitude.toFixed(4)}
                </Typography>
              </Box>
            ))}
          </Stack>
          {adverts.length > 20 && (
            <Typography
              variant="caption"
              color="text.secondary"
              component="div"
              sx={{ px: 2, py: 1.25 }}
            >
              {numberFormat.format(adverts.length - 20)} additional adverts are
              not shown.
            </Typography>
          )}
        </Paper>
      )}
    </Box>
  );
}

function sortRecords<T extends object>(
  records: T[],
  field: string,
  direction: SortDir,
  tieBreaker: (record: T) => string,
) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...records].sort((a, b) => {
    let av: unknown = (a as Record<string, unknown>)[field];
    let bv: unknown = (b as Record<string, unknown>)[field];
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av == null) av = "";
    if (bv == null) bv = "";
    const aValue = av as string | number;
    const bValue = bv as string | number;
    if (aValue < bValue) return -1 * multiplier;
    if (aValue > bValue) return 1 * multiplier;
    return tieBreaker(a).localeCompare(tieBreaker(b)) * multiplier;
  });
}

export default function MeshcoreIoView({
  state,
  generatedAt,
}: MeshcoreIoViewProps) {
  const theme = useTheme();
  const compactLayout = useMediaQuery(theme.breakpoints.down("lg"));
  const dark = theme.palette.mode === "dark";

  const [sortField, setSortField] = useState("lastUploadAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [historySortField, setHistorySortField] = useState("at");
  const [historySortDir, setHistorySortDir] = useState<SortDir>("desc");

  const workers = state?.workers ?? EMPTY_WORKERS;
  const history = state?.history ?? EMPTY_HISTORY;

  const sortedWorkers = useMemo(
    () =>
      sortRecords<MeshcoreIoWorkerStatus>(
        workers,
        sortField,
        sortDir,
        (worker) => worker.instanceId,
      ),
    [workers, sortField, sortDir],
  );

  const sortedHistory = useMemo(
    () =>
      sortRecords<MeshcoreIoHistoryEntry>(
        history,
        historySortField,
        historySortDir,
        (entry) => `${entry.nodeName}-${entry.requestId}`,
      ),
    [history, historySortField, historySortDir],
  );

  if (!state || !state.enabled) {
    return (
      <Box>
        <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
          MeshCore.io
        </Typography>
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <CloudUpload sx={{ fontSize: 48, color: "text.secondary", mb: 1 }} />
          <Typography variant="h6">
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

  const { processor, queue, totals, map } = state;
  const adverts = map?.advertsLast7Days ?? [];
  const configuredWorkerSlots = workers.reduce(
    (total, worker) => total + worker.configuredWorkers,
    0,
  );

  function setWorkerSort(field: string) {
    if (sortField === field) {
      setSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function setHistorySort(field: string) {
    if (historySortField === field) {
      setHistorySortDir((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setHistorySortField(field);
      setHistorySortDir("desc");
    }
  }

  function sortHeader(
    field: string,
    label: string,
    activeField: string,
    direction: SortDir,
    onSort: (field: string) => void,
  ) {
    return (
      <TableSortLabel
        active={activeField === field}
        direction={activeField === field ? direction : "asc"}
        onClick={() => onSort(field)}
      >
        {label}
      </TableSortLabel>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1">
          MeshCore.io
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {generatedAt > 0
            ? `Snapshot ${stockholmEventTime(generatedAt)}`
            : "Snapshot time unavailable"}
        </Typography>
      </Box>

      {state.lastError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {state.lastError}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <MetricCard
            label="Queue processor"
            value={processor.status === "healthy" ? "Healthy" : "Disabled"}
            icon={<CloudUpload />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <MetricCard
            label="Durable queue"
            value={numberFormat.format(queue.total)}
            note={
              queue.maxQueuedUploads > 0
                ? `Maximum ${numberFormat.format(queue.maxQueuedUploads)}`
                : undefined
            }
            icon={<Storage />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <MetricCard
            label="Upload workers"
            value={numberFormat.format(workers.length)}
            note={`${numberFormat.format(configuredWorkerSlots)} configured slots`}
            icon={<Dns />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <MetricCard
            label="Uploads"
            value={numberFormat.format(totals.uploaded)}
            note={`${numberFormat.format(totals.dropped)} dropped · ${numberFormat.format(totals.enqueued)} enqueued`}
            icon={<CloudDone />}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 2, height: "100%" }}>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
              Queue details
            </Typography>
            <Stack spacing={1}>
              {[
                ["Ingress pending", queue.ingressPending],
                ["Queued", queue.queued],
                ["Claimed", queue.claimed],
                ["Active", queue.active],
                ["Claimed (not active)", queue.claimedNotActive],
              ].map(([label, value]) => (
                <Box
                  key={String(label)}
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 2,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="body2">
                    {numberFormat.format(Number(value))}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 2, height: "100%" }}>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
              Totals
            </Typography>
            <Stack spacing={1}>
              {[
                ["Enqueued", totals.enqueued, undefined],
                ["Uploaded", totals.uploaded, undefined],
                [
                  "Dropped",
                  totals.dropped,
                  totals.dropped > 0 ? "error.main" : undefined,
                ],
                [
                  "Invalid",
                  totals.invalid,
                  totals.invalid > 0 ? "warning.main" : undefined,
                ],
                ["Retries", totals.retries, undefined],
              ].map(([label, value, color]) => (
                <Box
                  key={String(label)}
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 2,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography
                    variant="body2"
                    color={color as string | undefined}
                  >
                    {numberFormat.format(Number(value))}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {adverts.length > 0 && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            Advert map (last 7 days)
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
        <Paper sx={{ mb: 2, overflow: "hidden" }}>
          <SectionHeader title="Upload workers" />
          {compactLayout ? (
            <Box sx={{ p: 2 }}>
              <MobileSortControls
                field={sortField}
                direction={sortDir}
                options={WORKER_SORT_OPTIONS}
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
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                {sortedWorkers.map((worker) => (
                  <Card key={worker.instanceId} variant="outlined">
                    <CardContent>
                      <Typography
                        variant="subtitle1"
                        sx={{ overflowWrap: "anywhere" }}
                      >
                        {worker.instanceId}
                      </Typography>
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: {
                            xs: "repeat(2, minmax(0, 1fr))",
                            sm: "repeat(4, minmax(0, 1fr))",
                          },
                          gap: 2,
                          mt: 1.5,
                        }}
                      >
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Configured
                          </Typography>
                          <Typography variant="body2">
                            {numberFormat.format(worker.configuredWorkers)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Active
                          </Typography>
                          <Typography variant="body2">
                            {numberFormat.format(worker.activeUploads)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Succeeded
                          </Typography>
                          <Typography variant="body2">
                            {numberFormat.format(worker.uploadsSucceeded)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Failed
                          </Typography>
                          <Typography
                            variant="body2"
                            color={
                              worker.uploadsFailed > 0
                                ? "error.main"
                                : undefined
                            }
                          >
                            {numberFormat.format(worker.uploadsFailed)}
                          </Typography>
                        </Box>
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                        sx={{ mt: 1.5 }}
                      >
                        Last upload:{" "}
                        {worker.lastUploadAt
                          ? stockholmEventTime(worker.lastUploadAt)
                          : "—"}
                      </Typography>
                      {worker.lastError && (
                        <Alert severity="error" sx={{ mt: 1.5 }}>
                          {worker.lastError}
                        </Alert>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Box>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>
                      {sortHeader(
                        "instanceId",
                        "Instance",
                        sortField,
                        sortDir,
                        setWorkerSort,
                      )}
                    </TableCell>
                    <TableCell align="right">Configured</TableCell>
                    <TableCell align="right">
                      {sortHeader(
                        "activeUploads",
                        "Active",
                        sortField,
                        sortDir,
                        setWorkerSort,
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {sortHeader(
                        "uploadsSucceeded",
                        "Succeeded",
                        sortField,
                        sortDir,
                        setWorkerSort,
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {sortHeader(
                        "uploadsFailed",
                        "Failed",
                        sortField,
                        sortDir,
                        setWorkerSort,
                      )}
                    </TableCell>
                    <TableCell>
                      {sortHeader(
                        "lastUploadAt",
                        "Last upload",
                        sortField,
                        sortDir,
                        setWorkerSort,
                      )}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedWorkers.map((worker) => (
                    <TableRow key={worker.instanceId}>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 500, overflowWrap: "anywhere" }}
                        >
                          {worker.instanceId}
                        </Typography>
                        {worker.lastError && (
                          <Typography
                            variant="caption"
                            color="error.main"
                            component="div"
                            sx={{ mt: 0.25, overflowWrap: "anywhere" }}
                          >
                            {worker.lastError}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {numberFormat.format(worker.configuredWorkers)}
                      </TableCell>
                      <TableCell align="right">
                        {numberFormat.format(worker.activeUploads)}
                      </TableCell>
                      <TableCell align="right">
                        {numberFormat.format(worker.uploadsSucceeded)}
                      </TableCell>
                      <TableCell align="right">
                        <Typography
                          variant="body2"
                          color={
                            worker.uploadsFailed > 0 ? "error.main" : undefined
                          }
                        >
                          {numberFormat.format(worker.uploadsFailed)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {worker.lastUploadAt
                            ? stockholmEventTime(worker.lastUploadAt)
                            : "—"}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      ) : (
        <Paper sx={{ p: 3, mb: 2, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            No workers have reported yet.
          </Typography>
        </Paper>
      )}

      {history.length > 0 ? (
        <Paper sx={{ overflow: "hidden" }}>
          <SectionHeader title="Recent upload history" />
          {compactLayout ? (
            <Box sx={{ p: 2 }}>
              <MobileSortControls
                field={historySortField}
                direction={historySortDir}
                options={HISTORY_SORT_OPTIONS}
                onFieldChange={(field) => {
                  setHistorySortField(field);
                  setHistorySortDir("desc");
                }}
                onDirectionToggle={() =>
                  setHistorySortDir((direction) =>
                    direction === "asc" ? "desc" : "asc",
                  )
                }
              />
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                {sortedHistory.map((entry, index) => (
                  <Card key={`${entry.requestId}-${index}`} variant="outlined">
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
                            sx={{ overflowWrap: "anywhere" }}
                          >
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
                        </Box>
                        <StatusBadge
                          label={historyStatusLabel(entry.status)}
                          color={historyStatusColor(entry.status)}
                        />
                      </Box>
                      <Box
                        sx={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 1,
                          mt: 1.5,
                        }}
                      >
                        <Chip
                          label={entry.advertType}
                          size="small"
                          variant="outlined"
                        />
                        <Typography variant="caption" color="text.secondary">
                          {stockholmEventTime(entry.at)}
                        </Typography>
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                        sx={{ mt: 1 }}
                      >
                        Worker: {entry.workerInstanceId || "—"}
                      </Typography>
                      {entry.detail && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 1, overflowWrap: "anywhere" }}
                        >
                          {entry.detail}
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Box>
          ) : (
            <TableContainer sx={{ maxHeight: 500 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      {sortHeader(
                        "at",
                        "Time",
                        historySortField,
                        historySortDir,
                        setHistorySort,
                      )}
                    </TableCell>
                    <TableCell>
                      {sortHeader(
                        "status",
                        "Status",
                        historySortField,
                        historySortDir,
                        setHistorySort,
                      )}
                    </TableCell>
                    <TableCell>
                      {sortHeader(
                        "nodeName",
                        "Node",
                        historySortField,
                        historySortDir,
                        setHistorySort,
                      )}
                    </TableCell>
                    <TableCell>
                      {sortHeader(
                        "advertType",
                        "Type",
                        historySortField,
                        historySortDir,
                        setHistorySort,
                      )}
                    </TableCell>
                    <TableCell>Worker</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedHistory.map((entry, index) => (
                    <TableRow key={`${entry.requestId}-${index}`}>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {stockholmEventTime(entry.at)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          label={historyStatusLabel(entry.status)}
                          color={historyStatusColor(entry.status)}
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
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ overflowWrap: "anywhere" }}
                        >
                          {entry.workerInstanceId || "—"}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      ) : (
        <Paper sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            No uploads have completed yet.
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
