const SWEDISH_COUNTIES_URL = 'https://codeberg.org/meshat/lookup-data/raw/branch/main/meshcore/swedish_counties.json';
const FETCH_TIMEOUT_MS = 10_000;

interface CountyEntry {
  name: string;
  primary_iata: string;
  county_code: string;
  iata_codes: string[];
}

interface SwedishCountiesResponse {
  swedish_counties: CountyEntry[];
}

export interface SwedishCountiesLookup {
  isAvailable(): boolean;
  getCountyForIata(iata: string): string | undefined;
  getPrimaryIataForIata(iata: string): string | undefined;
  isPrimaryIata(iata: string): boolean;
  getCorrectionForIata(iata: string): string | undefined;
  getAllCountyNames(): Record<string, string>;
}

export interface CreateLookupOptions {
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}

class SwedishCountiesLookupImpl implements SwedishCountiesLookup {
  private iataToCounty: Map<string, { countyName: string; primaryIATA: string }> = new Map();
  private primaryIatas: Set<string> = new Set();
  private available = false;

  constructor(entries: CountyEntry[]) {
    if (entries.length === 0) return;

    for (const entry of entries) {
      const countyName = entry.name;
      const primaryIATA = entry.primary_iata.trim().toUpperCase();

      for (const rawIata of entry.iata_codes || []) {
        const iata = rawIata.trim().toUpperCase();
        this.iataToCounty.set(iata, { countyName, primaryIATA });
      }
      this.primaryIatas.add(primaryIATA);
    }

    if (this.iataToCounty.size > 0) {
      this.available = true;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  getCountyForIata(iata: string): string | undefined {
    return this.iataToCounty.get(iata.trim().toUpperCase())?.countyName;
  }

  getPrimaryIataForIata(iata: string): string | undefined {
    return this.iataToCounty.get(iata.trim().toUpperCase())?.primaryIATA;
  }

  isPrimaryIata(iata: string): boolean {
    return this.primaryIatas.has(iata.trim().toUpperCase());
  }

  getCorrectionForIata(iata: string): string | undefined {
    const info = this.iataToCounty.get(iata.trim().toUpperCase());
    if (!info) return undefined;
    if (info.primaryIATA === iata.trim().toUpperCase()) return undefined;
    return `Tills observer byter till korrekt IATA ${info.primaryIATA} för ${info.countyName}`;
  }

  getAllCountyNames(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [iata, info] of this.iataToCounty) {
      result[iata] = info.countyName;
    }
    return result;
  }
}

function isValidCountyEntry(value: unknown): value is CountyEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.name !== 'string' || entry.name.trim() === '') return false;
  if (typeof entry.primary_iata !== 'string') return false;
  const primary = entry.primary_iata.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(primary)) return false;
  if (!Array.isArray(entry.iata_codes)) return false;
  for (const code of entry.iata_codes) {
    if (typeof code !== 'string') return false;
  }
  if (!entry.iata_codes.some((c: string) => c.trim().toUpperCase() === primary)) return false;
  return true;
}

export async function createSwedishCountiesLookup(options?: CreateLookupOptions): Promise<SwedishCountiesLookup> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? FETCH_TIMEOUT_MS;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let raw: SwedishCountiesResponse;
    try {
      const response = await fetchImpl(SWEDISH_COUNTIES_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        console.warn(`[SVENSKA LÄN] Kunde inte hämta svenska län-data: HTTP ${response.status}`);
        return new SwedishCountiesLookupImpl([]);
      }

      raw = await response.json() as SwedishCountiesResponse;
    } finally {
      clearTimeout(timeout);
    }

    if (!raw.swedish_counties || !Array.isArray(raw.swedish_counties) || raw.swedish_counties.length === 0) {
      console.warn('[SVENSKA LÄN] Ogiltigt eller tomt svenska län-data');
      return new SwedishCountiesLookupImpl([]);
    }

    const validEntries = raw.swedish_counties.filter(isValidCountyEntry);
    const lookup = new SwedishCountiesLookupImpl(validEntries);

    if (lookup.isAvailable()) {
      console.log(`[SVENSKA LÄN] Laddade ${validEntries.length} svenska län`);
    } else {
      console.warn('[SVENSKA LÄN] Inga giltiga län kunde laddas från datan');
    }
    return lookup;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[SVENSKA LÄN] Kunde inte hämta svenska län-data: ${message}`);
    return new SwedishCountiesLookupImpl([]);
  }
}
