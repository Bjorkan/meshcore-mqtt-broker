import type { DashboardSnapshot } from "./types.js";

export function fetchDashboard(
  signal?: AbortSignal,
): Promise<DashboardSnapshot> {
  return fetch("/api/dashboard", {
    cache: "no-store",
    signal,
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Dashboard API returned HTTP ${response.status}`);
    }
    return response.json();
  });
}

export function useDashboardData(): {
  data: DashboardSnapshot | null;
  error: string | null;
  lastUpdated: number;
} {
  // This is implemented directly in app.tsx since it needs the polling loop
  throw new Error("useDashboardData hook is implemented inline in app.tsx");
}
