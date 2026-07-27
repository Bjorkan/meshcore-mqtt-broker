import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ThemeProvider,
  CssBaseline,
  useMediaQuery,
  Box,
  Typography,
  CircularProgress,
  Alert,
} from "@mui/material";
import { createAppTheme } from "./theme.js";
import { useHashRouter, replaceHash } from "./router.js";
import type {
  DashboardSnapshot,
  DashboardObserver,
  BanSummary,
  SubscriberConnectionEntry,
  View,
} from "./types.js";
import { ErrorBoundary } from "./components/error-boundary.js";
import { AppShell } from "./components/layout/app-shell.js";
import ObserverDetail from "./components/details/observer-detail.js";
import BanDetail from "./components/details/ban-detail.js";
import SubscriberDetail from "./components/details/subscriber-detail.js";
import OverviewView from "./views/overview.js";
import ObserversView from "./views/observers.js";
import MeshcoreIoView from "./views/meshcore-io.js";
import BansView from "./views/bans.js";
import SubscribersView from "./views/subscribers.js";

export function App() {
  const prefersDarkSystem = useMediaQuery("(prefers-color-scheme: dark)");
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem("dashboard-dark-mode");
    return stored !== null ? stored === "true" : prefersDarkSystem;
  });

  useEffect(() => {
    const onChange = (e: StorageEvent) => {
      if (e.key === "dashboard-dark-mode") {
        setDarkMode(e.newValue === "true");
      }
    };
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, []);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => {
      localStorage.setItem("dashboard-dark-mode", String(!prev));
      return !prev;
    });
  }, []);

  const theme = useMemo(() => createAppTheme(darkMode), [darkMode]);

  const [hashState, setHashState] = useHashRouter();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [selectedObserver, setSelectedObserver] =
    useState<DashboardObserver | null>(null);
  const [selectedBan, setSelectedBan] = useState<BanSummary | null>(null);
  const [selectedSubscriber, setSelectedSubscriber] =
    useState<SubscriberConnectionEntry | null>(null);

  const [query, setQuery] = useState(hashState.query);
  const [regionFilter, setRegionFilter] = useState(hashState.region);

  useEffect(() => {
    let active = true;
    let refreshTimer: number | undefined;
    let requestController: AbortController | undefined;

    async function refresh() {
      const controller = new AbortController();
      requestController = controller;

      try {
        const response = await fetch("/api/dashboard", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Dashboard API returned HTTP ${response.status}`);
        }

        const data = (await response.json()) as DashboardSnapshot;
        if (!active) return;

        if (data.error) {
          setRefreshError("Dashboard data could not be read. Check storage.");
          return;
        }

        setSnapshot(data);
        setRefreshError(null);
      } catch (error) {
        if (!active || (error as { name?: string })?.name === "AbortError") {
          return;
        }
        console.error("Dashboard: could not update data:", error);
        setRefreshError(
          "The dashboard API could not be reached. Previously loaded data remains visible.",
        );
      } finally {
        if (requestController === controller) {
          requestController = undefined;
        }
        if (active) {
          refreshTimer = window.setTimeout(() => {
            void refresh();
          }, 5000);
        }
      }
    }

    void refresh();
    return () => {
      active = false;
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
      requestController?.abort();
    };
  }, []);

  useEffect(() => {
    replaceHash(
      hashState.view,
      query,
      regionFilter,
      selectedObserver?.publicKey || "",
      selectedBan?.node || "",
    );
  }, [hashState.view, query, regionFilter, selectedObserver, selectedBan]);

  const allObservers = snapshot?.observers ?? [];
  const allBans = snapshot?.bans ?? [];
  const allSubscribers = snapshot?.subscribers ?? [];
  const generatedAt = snapshot?.generatedAt ?? 0;

  useEffect(() => {
    if (selectedObserver) {
      const updated = allObservers.find(
        (o) => o.publicKey === selectedObserver.publicKey,
      );
      setSelectedObserver(updated ?? null);
    }
  }, [allObservers, selectedObserver]);

  useEffect(() => {
    if (selectedBan) {
      const updated = allBans.find((b) => b.node === selectedBan.node);
      setSelectedBan(updated ?? null);
    }
  }, [allBans, selectedBan]);

  useEffect(() => {
    if (selectedSubscriber) {
      const updated = allSubscribers.find(
        (subscriber) => subscriber.username === selectedSubscriber.username,
      );
      setSelectedSubscriber(updated ?? null);
    }
  }, [allSubscribers, selectedSubscriber]);

  const navigate = useCallback(
    (view: View) => {
      setSelectedObserver(null);
      setSelectedBan(null);
      setHashState({
        view,
        query,
        region: regionFilter,
        observer: "",
        ban: "",
      });
    },
    [setHashState, query, regionFilter],
  );

  const handleQueryChange = useCallback((q: string) => {
    setQuery(q);
  }, []);

  const handleRegionChange = useCallback((r: string) => {
    setRegionFilter(r);
  }, []);

  const isLoading = snapshot === null && refreshError === null;
  const meshcoreIo = snapshot?.meshcoreIo;
  const recentPublishes = useMemo(() => {
    const apiPublishes = snapshot?.recentPublishes ?? [];
    if (apiPublishes.length > 0) return apiPublishes;
    return allObservers
      .flatMap((observer) => observer.messages)
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, 50);
  }, [allObservers, snapshot]);

  const overviewBans = useMemo(() => {
    return [...allBans]
      .sort(
        (a, b) =>
          (b.lastUpdatedAt || b.mutedUntil || 0) -
          (a.lastUpdatedAt || a.mutedUntil || 0),
      )
      .slice(0, 10);
  }, [allBans]);

  const renderView = () => {
    if (isLoading) {
      return (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "60vh",
            gap: 2,
          }}
        >
          <CircularProgress />
          <Typography color="text.secondary">
            Loading dashboard data…
          </Typography>
        </Box>
      );
    }

    if (!snapshot && refreshError) {
      return (
        <Alert severity="error" sx={{ mb: 2 }}>
          {refreshError}
        </Alert>
      );
    }

    if (!snapshot) return null;

    switch (hashState.view) {
      case "observers":
        return (
          <ObserversView
            snapshot={snapshot}
            query={query}
            onQueryChange={handleQueryChange}
            regionFilter={regionFilter}
            onRegionChange={handleRegionChange}
            onSelectObserver={setSelectedObserver}
          />
        );
      case "meshcoreio":
        return <MeshcoreIoView state={meshcoreIo} generatedAt={generatedAt} />;
      case "bans":
        return <BansView bans={allBans} onSelectBan={setSelectedBan} />;
      case "subscribers":
        return (
          <SubscribersView
            subscribers={allSubscribers}
            onSelectSubscriber={setSelectedSubscriber}
          />
        );
      default:
        return (
          <OverviewView
            snapshot={{
              ...snapshot,
              bans: overviewBans,
              recentPublishes,
            }}
            onSelectObserver={setSelectedObserver}
            onSelectBan={setSelectedBan}
            onNavigate={navigate}
          />
        );
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <AppShell
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
          lastUpdated={generatedAt}
          route={hashState.view}
          onNavigate={navigate}
        >
          {refreshError && snapshot ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {refreshError}
            </Alert>
          ) : null}
          {renderView()}
          {selectedObserver ? (
            <ObserverDetail
              observer={selectedObserver}
              countyLookup={snapshot?.countyLookup}
              onClose={() => setSelectedObserver(null)}
            />
          ) : null}
          {selectedBan ? (
            <BanDetail
              ban={selectedBan}
              countyLookup={snapshot?.countyLookup}
              onClose={() => setSelectedBan(null)}
            />
          ) : null}
          {selectedSubscriber ? (
            <SubscriberDetail
              sub={selectedSubscriber}
              onClose={() => setSelectedSubscriber(null)}
            />
          ) : null}
        </AppShell>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
