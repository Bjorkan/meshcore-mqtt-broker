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
  getCountyName(iata: string): string | undefined;
  getPrimaryIata(iata: string): string | undefined;
  getAllCountyNames(): Record<string, string>;
  getAllIataPrimaryMappings(): Record<string, string>;
  isAvailable(): boolean;
}

class SwedishCountiesLookupImpl implements SwedishCountiesLookup {
  private iataToCounty: Map<string, { countyName: string; primaryIATA: string }> = new Map();
  private primaryIataToCounty: Map<string, string> = new Map();
  private available = false;

  constructor(entries: CountyEntry[]) {
    if (entries.length === 0) {
      return;
    }

    for (const entry of entries) {
      if (entry.primary_iata) {
        this.primaryIataToCounty.set(entry.primary_iata, entry.name);
      }
      for (const iata of entry.iata_codes || []) {
        if (entry.primary_iata) {
          this.iataToCounty.set(iata, {
            countyName: entry.name,
            primaryIATA: entry.primary_iata,
          });
        }
      }
    }
    this.available = true;
  }

  getCountyName(iata: string): string | undefined {
    return this.iataToCounty.get(iata)?.countyName;
  }

  getPrimaryIata(iata: string): string | undefined {
    return this.iataToCounty.get(iata)?.primaryIATA;
  }

  getAllCountyNames(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [iata, info] of this.iataToCounty) {
      result[iata] = info.countyName;
    }
    return result;
  }

  getAllIataPrimaryMappings(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [iata, info] of this.iataToCounty) {
      result[iata] = info.primaryIATA;
    }
    return result;
  }

  isAvailable(): boolean {
    return this.available;
  }
}

export async function createSwedishCountiesLookup(): Promise<SwedishCountiesLookup> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(SWEDISH_COUNTIES_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[SVENSKA LÄN] Kunde inte hämta svenska län-data: HTTP ${response.status}`);
      return new SwedishCountiesLookupImpl([]);
    }

    const raw = await response.json() as SwedishCountiesResponse;

    if (!raw.swedish_counties || !Array.isArray(raw.swedish_counties)) {
      console.warn('[SVENSKA LÄN] Ogiltigt format på svenska län-data: saknar swedish_counties-array');
      return new SwedishCountiesLookupImpl([]);
    }

    const lookup = new SwedishCountiesLookupImpl(raw.swedish_counties);
    console.log(`[SVENSKA LÄN] Laddade ${raw.swedish_counties.length} svenska län`);
    return lookup;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[SVENSKA LÄN] Kunde inte hämta svenska län-data: ${message}`);
    return new SwedishCountiesLookupImpl([]);
  }
}
