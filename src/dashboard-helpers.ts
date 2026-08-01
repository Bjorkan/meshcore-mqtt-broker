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

export interface RegionLookupEntry {
  friendlyName?: string;
  primaryRegion: string;
  isPrimary: boolean;
  isAllowed: boolean;
}

export type RegionLookup = Record<string, RegionLookupEntry>;

function normalizeRegion(region: string): string | null {
  const trimmed = region.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "test") return "test";
  return trimmed.toUpperCase();
}

export function formatRegionDisplay(
  region: string | undefined,
  regionLookup?: RegionLookup,
): {
  friendlyName?: string;
  code: string;
  primaryRegion?: string;
  isAllowed?: boolean;
} | null {
  if (!region) return null;
  const normalized = normalizeRegion(region);
  if (!normalized) return null;
  const entry = regionLookup?.[normalized];
  if (!entry) return { code: normalized };
  return {
    friendlyName: entry.friendlyName,
    code: normalized,
    primaryRegion: entry.primaryRegion,
    isAllowed: entry.isAllowed,
  };
}

export function formatRegionOptionLabel(
  region: string,
  regionLookup?: RegionLookup,
): string {
  const formatted = formatRegionDisplay(region, regionLookup);
  if (!formatted) return "-";
  const name = formatted.friendlyName
    ? `${formatted.friendlyName} (${formatted.code})`
    : formatted.code;
  return formatted.isAllowed === false && formatted.primaryRegion
    ? `${name} - use ${formatted.primaryRegion}`
    : name;
}

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function stockholmTime(timestamp: number): string {
  return timeFormat.format(new Date(timestamp));
}
