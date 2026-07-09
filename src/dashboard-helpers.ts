export interface DenialEntry {
  status: string;
  deniedUntilText?: string;
  mutedUntil?: number;
}

const BLOCKING_STATUSES = new Set(["denied", "muted"]);

export function formatDeniedUntilLabel(entry: DenialEntry): string {
  if (entry.status === "would_mute") return "-";
  if (!BLOCKING_STATUSES.has(entry.status)) return "-";
  if (entry.deniedUntilText) return entry.deniedUntilText;
  if (entry.mutedUntil) return stockholmTime(entry.mutedUntil);
  return "-";
}

export interface CountyLookupEntry {
  countyName: string;
  primaryIata: string;
  isPrimary: boolean;
}

function normalizeRegion(region: string): string | null {
  const trimmed = region.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "test") return "test";
  return trimmed.toUpperCase();
}

export function formatRegionDisplay(
  region: string | undefined,
  countyLookup?: Record<string, CountyLookupEntry>,
): { countyName?: string; code: string } | null {
  if (!region) return null;
  const normalized = normalizeRegion(region);
  if (!normalized) return null;
  const entry = countyLookup?.[normalized];
  if (!entry) return { code: normalized };
  return { countyName: entry.countyName, code: normalized };
}

export function formatRegionOptionLabel(
  region: string,
  countyLookup?: Record<string, CountyLookupEntry>,
): string {
  const formatted = formatRegionDisplay(region, countyLookup);
  if (!formatted) return "-";
  if (!formatted.countyName) return formatted.code;
  return `${formatted.countyName} (${formatted.code})`;
}

const timeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function stockholmTime(timestamp: number): string {
  return `${timeFormat.format(new Date(timestamp))} Europe/Stockholm`;
}
