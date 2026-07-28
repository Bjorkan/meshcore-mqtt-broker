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
import { isDashboardDetailHistoryEntry, useHashRouter } from "./router.js";
import { fetchDashboard } from "./api.js";
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

interface BanRouteEntry {
  ban: BanSummary;
  id: string;
  fallbackId: string;
}

function fallbackBanIdentity(ban: BanSummary): string {
  if (ban.status !== "denied") {
    return JSON.stringify(["active", ban.status, ban.node]);
  }
  return JSON.stringify([
    "event",
    ban.node,
    ban.broker,
    ban.lastUpdatedAt ?? null,
    ban.topic ?? "",
    ban.reason,
    ban.region ?? "",
    ban.deniedUntilText ?? "",
  ]);
}

function baseBanIdentity(ban: BanSummary): string {
  return ban.eventId
    ? JSON.stringify(["event-id", ban.eventId])
    : fallbackBanIdentity(ban);
}

function banRouteEntries(bans: BanSummary[]): BanRouteEntry[] {
  const occurrences = new Map<string, number>();
  const fallbackOccurrences = new Map<string, number>();
  return bans.map((ban) => {
    const base = baseBanIdentity(ban);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    const fallbackBase = fallbackBanIdentity(ban);
    const fallbackOccurrence = fallbackOccurrences.get(fallbackBase) ?? 0;
    fallbackOccurrences.set(fallbackBase, fallbackOccurrence + 1);
    return {
      ban,
      id: `v1:${base}:${occurrence}`,
      fallbackId: `v1:${fallbackBase}:${fallbackOccurrence}`,
    };
  });
}

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

  useEffect(() => {
    let active = true;
    let hasValidSnapshot = false;
    let refreshTimer: number | undefined;
    let requestController: AbortController | undefined;

    async function refresh() {
      const controller = new AbortController();
      requestController = controller;

      try {
        const data = await fetchDashboard(controller.signal);
        if (!active) return;

        if (data.error) {
          setRefreshError(
            hasValidSnapshot
              ? "Dashboard data could not be refreshed. Previously loaded data remains visible. Check broker storage."
              : "Dashboard data could not be loaded. Check broker storage and try again.",
          );
          return;
        }

        hasValidSnapshot = true;
        setSnapshot(data);
        setRefreshError(null);
      } catch (error) {
        if (
          !active ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return;
        }
        console.error("Dashboard: could not update data:", error);
        setRefreshError(
          hasValidSnapshot
            ? "Dashboard data could not be refreshed. Previously loaded data remains visible."
            : "Dashboard data could not be loaded. Check the broker connection and try again.",
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

  const allObservers = snapshot?.observers ?? [];
  const allBans = snapshot?.bans ?? [];
  const allSubscribers = snapshot?.subscribers ?? [];
  const generatedAt = snapshot?.generatedAt ?? 0;
  const routedBans = useMemo(() => banRouteEntries(allBans), [allBans]);
  const selectedObserver = hashState.observer
    ? (allObservers.find(
        (observer) => observer.publicKey === hashState.observer,
      ) ?? null)
    : null;
  const selectedBanEntry = useMemo(() => {
    if (!hashState.ban) return null;
    const exact = routedBans.find(
      (entry) =>
        entry.id === hashState.ban || entry.fallbackId === hashState.ban,
    );
    if (exact) return exact;

    const legacyMatches = routedBans.filter(
      (entry) => entry.ban.node === hashState.ban,
    );
    return legacyMatches.length === 1 ? legacyMatches[0] : null;
  }, [hashState.ban, routedBans]);
  const selectedBan = selectedBanEntry?.ban ?? null;
  const selectedSubscriber = hashState.subscriber
    ? (allSubscribers.find(
        (subscriber) => subscriber.username === hashState.subscriber,
      ) ?? null)
    : null;

  useEffect(() => {
    if (!snapshot) return;

    const observer =
      hashState.observer && !selectedObserver ? "" : hashState.observer;
    const ban = selectedBanEntry
      ? selectedBanEntry.id
      : hashState.ban
        ? ""
        : hashState.ban;
    const subscriber =
      hashState.subscriber && !selectedSubscriber ? "" : hashState.subscriber;
    if (
      observer !== hashState.observer ||
      ban !== hashState.ban ||
      subscriber !== hashState.subscriber
    ) {
      setHashState(
        { ...hashState, observer, ban, subscriber },
        {
          replace: true,
          detail: observer || ban || subscriber ? undefined : false,
        },
      );
    }
  }, [
    hashState,
    selectedBanEntry,
    selectedObserver,
    selectedSubscriber,
    setHashState,
    snapshot,
  ]);

  const navigate = useCallback(
    (view: View) => {
      setHashState({
        view,
        query: hashState.query,
        region: hashState.region,
        observer: "",
        ban: "",
        subscriber: "",
      });
    },
    [hashState.query, hashState.region, setHashState],
  );

  const handleQueryChange = useCallback(
    (query: string) => {
      setHashState({ ...hashState, query }, { replace: true });
    },
    [hashState, setHashState],
  );

  const handleRegionChange = useCallback(
    (region: string) => {
      setHashState({ ...hashState, region }, { replace: true });
    },
    [hashState, setHashState],
  );

  const handleSelectObserver = useCallback(
    (observer: DashboardObserver) => {
      setHashState(
        {
          ...hashState,
          observer: observer.publicKey,
          ban: "",
          subscriber: "",
        },
        { detail: true },
      );
    },
    [hashState, setHashState],
  );

  const handleSelectBan = useCallback(
    (ban: BanSummary) => {
      const entry = routedBans.find((candidate) => candidate.ban === ban);
      if (!entry) return;
      setHashState(
        {
          ...hashState,
          observer: "",
          ban: entry.id,
          subscriber: "",
        },
        { detail: true },
      );
    },
    [hashState, routedBans, setHashState],
  );

  const handleSelectSubscriber = useCallback(
    (subscriber: SubscriberConnectionEntry) => {
      setHashState(
        {
          ...hashState,
          observer: "",
          ban: "",
          subscriber: subscriber.username,
        },
        { detail: true },
      );
    },
    [hashState, setHashState],
  );

  const handleCloseDetail = useCallback(() => {
    if (isDashboardDetailHistoryEntry()) {
      history.back();
      return;
    }
    setHashState(
      { ...hashState, observer: "", ban: "", subscriber: "" },
      { replace: true, detail: false },
    );
  }, [hashState, setHashState]);

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
            query={hashState.query}
            onQueryChange={handleQueryChange}
            regionFilter={hashState.region}
            onRegionChange={handleRegionChange}
            onSelectObserver={handleSelectObserver}
          />
        );
      case "meshcoreio":
        return <MeshcoreIoView state={meshcoreIo} generatedAt={generatedAt} />;
      case "bans":
        return <BansView bans={allBans} onSelectBan={handleSelectBan} />;
      case "subscribers":
        return (
          <SubscribersView
            subscribers={allSubscribers}
            onSelectSubscriber={handleSelectSubscriber}
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
            onSelectObserver={handleSelectObserver}
            onSelectBan={handleSelectBan}
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
              onClose={handleCloseDetail}
            />
          ) : null}
          {selectedBan ? (
            <BanDetail
              ban={selectedBan}
              countyLookup={snapshot?.countyLookup}
              onClose={handleCloseDetail}
            />
          ) : null}
          {selectedSubscriber ? (
            <SubscriberDetail
              sub={selectedSubscriber}
              onClose={handleCloseDetail}
            />
          ) : null}
        </AppShell>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
