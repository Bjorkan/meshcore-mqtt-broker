import { useState, useCallback, useMemo } from "react";
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
}

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
  };
}

export function replaceHash(
  view: View,
  query: string,
  region: string,
  observer: string,
  ban: string,
): void {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (region) params.set("region", region);
  if (observer) params.set("o", observer);
  if (ban) params.set("b", ban);
  const qs = params.toString();
  const hash = `#${view}${qs ? "?" + qs : ""}`;
  history.replaceState(null, "", hash);
}

export function useHashRouter(): [HashState, (hash: HashState) => void] {
  const initial = useMemo(() => parseHash(), []);
  const [state, setState] = useState<HashState>(initial);

  const navigate = useCallback((next: HashState) => {
    setState(next);
    replaceHash(next.view, next.query, next.region, next.observer, next.ban);
  }, []);

  return [state, navigate];
}
