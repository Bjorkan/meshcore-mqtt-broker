export interface DenialEntry {
  status: string;
  deniedUntilText?: string;
  mutedUntil?: number;
}

const BLOCKING_STATUSES = new Set(["denied", "muted"]);

const PUBLIC_MUTE_REASON_LABELS: Record<string, string> = {
  spam: "Spam/high rate",
  flood: "Message flood",
  invalid_json: "Invalid JSON",
  empty_payload: "Empty payload",
  missing_origin_id: "Missing origin_id",
  origin_mismatch: "origin_id mismatch",
  invalid_origin_length: "Invalid origin length",
  key_length: "Invalid key length",
  encoded_origin: "Encoded origin",
  invalid_topic: "Invalid topic",
  subscription_limit: "Subscription limit",
  spoofed_region: "Spoofed region",
  invalid_iata: "Invalid IATA",
  duplicate: "Duplicate message",
  rapid_publish: "Rapid publishing",
  excessive_messages: "Excessive messages",
  retry_storm: "Retry storm",
  no_subtopic: "No subtopic",
  blocked_origin: "Blocked origin",
  rate_limit_exceeded: "Rate limit exceeded",
  iata_changes_exceeded: "Too many IATA changes",
};

function stockholmTime(timestamp: number): string {
  const timeFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return timeFormat.format(new Date(timestamp));
}

export function formatDeniedUntilLabel(entry: DenialEntry): string {
  if (entry.status === "would_mute") return "-";
  if (!BLOCKING_STATUSES.has(entry.status)) return "-";
  if (entry.deniedUntilText) return entry.deniedUntilText;
  if (entry.mutedUntil) return stockholmTime(entry.mutedUntil);
  return "-";
}

export function formatPublicMuteReason(reason: string): string {
  return PUBLIC_MUTE_REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
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
