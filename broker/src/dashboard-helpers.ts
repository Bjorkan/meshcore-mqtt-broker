export interface DenialEntry {
  status: string;
  deniedUntilText?: string;
  mutedUntil?: number;
}

export function formatDeniedUntilLabel(entry: DenialEntry): string {
  if (entry.status === 'would_mute') return '-';
  if (entry.deniedUntilText) return entry.deniedUntilText;
  if (entry.mutedUntil) return stockholmTime(entry.mutedUntil);
  return '-';
}

export interface CountyLookupEntry {
  countyName: string;
  primaryIata: string;
  isPrimary: boolean;
}

export function formatRegionDisplay(
  region: string | undefined,
  countyLookup?: Record<string, CountyLookupEntry>
): { countyName?: string; code: string } | null {
  if (!region) return null;
  const entry = countyLookup?.[region];
  if (!entry) return { code: region };
  return { countyName: entry.countyName, code: region };
}

const timeFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function stockholmTime(timestamp: number): string {
  return `${timeFormat.format(new Date(timestamp))} Europe/Stockholm`;
}
