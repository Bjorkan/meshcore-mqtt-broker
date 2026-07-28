import { useCallback, useEffect, useMemo, useState } from "react";
import type { View } from "./types.js";

const views: View[] = [
  "overview",
  "observers",
  "meshcoreio",
  "bans",
  "subscribers",
];

export interface HashState {
  view: View;
  query: string;
  region: string;
  observer: string;
  ban: string;
  subscriber: string;
}

export interface HashNavigationOptions {
  replace?: boolean;
  detail?: boolean;
}

export type HashNavigate = (
  hash: HashState,
  options?: HashNavigationOptions,
) => void;

function parseHash(): HashState {
  const hash = window.location.hash.replace("#", "");
  const [viewPart, ...rest] = hash.split("?");
  const view = views.includes(viewPart as View)
    ? (viewPart as View)
    : "overview";
  const params = new URLSearchParams(rest.join("?"));
  return {
    view,
    query: params.get("q") || "",
    region: params.get("region") || "",
    observer: params.get("o") || "",
    ban: params.get("b") || "",
    subscriber: params.get("s") || "",
  };
}

export function replaceHash(
  view: View,
  query: string,
  region: string,
  observer: string,
  ban: string,
  subscriber = "",
  historyState: unknown = null,
): void {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (region) params.set("region", region);
  if (observer) params.set("o", observer);
  if (ban) params.set("b", ban);
  if (subscriber) params.set("s", subscriber);
  const qs = params.toString();
  const hash = `#${view}${qs ? "?" + qs : ""}`;
  history.replaceState(historyState, "", hash);
}

function pushHash(state: HashState, historyState: unknown): void {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.region) params.set("region", state.region);
  if (state.observer) params.set("o", state.observer);
  if (state.ban) params.set("b", state.ban);
  if (state.subscriber) params.set("s", state.subscriber);
  const qs = params.toString();
  const hash = `#${state.view}${qs ? "?" + qs : ""}`;

  if (window.location.hash === hash) return;
  history.pushState(historyState, "", hash);
}

export function isDashboardDetailHistoryEntry(): boolean {
  const state: unknown = history.state;
  return (
    typeof state === "object" &&
    state !== null &&
    "dashboardDetail" in state &&
    (state as { dashboardDetail?: unknown }).dashboardDetail === true
  );
}

export function useHashRouter(): [HashState, HashNavigate] {
  const initial = useMemo(() => parseHash(), []);
  const [state, setState] = useState<HashState>(initial);

  useEffect(() => {
    const handleHistoryNavigation = () => setState(parseHash());
    window.addEventListener("hashchange", handleHistoryNavigation);
    window.addEventListener("popstate", handleHistoryNavigation);
    return () => {
      window.removeEventListener("hashchange", handleHistoryNavigation);
      window.removeEventListener("popstate", handleHistoryNavigation);
    };
  }, []);

  const navigate = useCallback(
    (next: HashState, options: HashNavigationOptions = {}) => {
      setState(next);
      const nextHistoryState =
        options.detail === undefined
          ? history.state
          : options.detail
            ? { dashboardDetail: true }
            : null;
      if (options.replace) {
        replaceHash(
          next.view,
          next.query,
          next.region,
          next.observer,
          next.ban,
          next.subscriber,
          nextHistoryState,
        );
      } else {
        pushHash(next, options.detail ? { dashboardDetail: true } : null);
      }
    },
    [],
  );

  return [state, navigate];
}
