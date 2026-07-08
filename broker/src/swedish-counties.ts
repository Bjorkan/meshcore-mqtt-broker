const SWEDISH_COUNTIES_URL = 'https://codeberg.org/meshat/lookup-data/raw/branch/main/meshcore/swedish_counties.json';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_NAME_LENGTH = 100;
const MAX_RESPONSE_BYTES = 256 * 1024;

export interface CountyEntry {
  name: string;
  primary_iata: string;
  county_code: string;
  iata_codes: string[];
}

interface SwedishCountiesResponse {
  swedish_counties: CountyEntry[];
}

export interface CountyLookupEntry {
  countyName: string;
  primaryIata: string;
  isPrimary: boolean;
}

export interface SwedishCountiesLookup {
  isAvailable(): boolean;
  getCountyForIata(iata: string): string | undefined;
  getPrimaryIataForIata(iata: string): string | undefined;
  isPrimaryIata(iata: string): boolean;
  getCorrectionForIata(iata: string): string | undefined;
  getAllCountyLookup(): Record<string, CountyLookupEntry>;
}

export interface CreateLookupOptions {
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export function createUnavailableLookup(): SwedishCountiesLookup {
  return new SwedishCountiesLookupImpl([]);
}

class SwedishCountiesLookupImpl implements SwedishCountiesLookup {
  private iataToCounty: Map<string, { countyName: string; primaryIATA: string }> = new Map();
  private primaryIatas: Set<string> = new Set();
  private available = false;

  constructor(entries: CountyEntry[]) {
    if (entries.length === 0) return;

    const resolved = resolveEntries(entries);
    if (!resolved) return;

    for (const entry of resolved) {
      const countyName = entry.name.trim();
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
    return this.iataToCounty.get(normalize(iata))?.countyName;
  }

  getPrimaryIataForIata(iata: string): string | undefined {
    return this.iataToCounty.get(normalize(iata))?.primaryIATA;
  }

  isPrimaryIata(iata: string): boolean {
    return this.primaryIatas.has(normalize(iata));
  }

  getCorrectionForIata(iata: string): string | undefined {
    const info = this.iataToCounty.get(normalize(iata));
    if (!info) return undefined;
    if (info.primaryIATA === normalize(iata)) return undefined;
    return `Tills observer byter till korrekt IATA ${info.primaryIATA} för ${info.countyName}`;
  }

  getAllCountyLookup(): Record<string, CountyLookupEntry> {
    const result: Record<string, CountyLookupEntry> = {};
    for (const [iata, info] of this.iataToCounty) {
      result[iata] = {
        countyName: info.countyName,
        primaryIata: info.primaryIATA,
        isPrimary: this.primaryIatas.has(iata),
      };
    }
    return result;
  }
}

function normalize(iata: string): string {
  return iata.trim().toUpperCase();
}

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function resolveEntries(entries: CountyEntry[]): CountyEntry[] | null {
  const seenIata = new Map<string, { countyName: string; primaryIATA: string }>();

  for (const entry of entries) {
    const countyName = entry.name.trim();
    const primaryIATA = entry.primary_iata.trim().toUpperCase();

    for (const rawIata of entry.iata_codes || []) {
      const iata = rawIata.trim().toUpperCase();
      const existing = seenIata.get(iata);
      if (existing && (existing.countyName !== countyName || existing.primaryIATA !== primaryIATA)) {
        console.warn(`[SVENSKA LÄN] IATA ${iata} finns i flera län: "${existing.countyName}" och "${countyName}"`);
        return null;
      }
      if (!existing) {
        seenIata.set(iata, { countyName, primaryIATA });
      }
    }
  }

  return entries;
}

function isValidCountyEntry(value: unknown): value is CountyEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.name !== 'string') return false;
  const trimmedName = entry.name.trim();
  if (trimmedName === '') return false;
  if (trimmedName.length > MAX_NAME_LENGTH) return false;
  if (hasControlChars(trimmedName)) return false;
  if (typeof entry.primary_iata !== 'string') return false;
  const primary = normalize(entry.primary_iata);
  if (!/^[A-Z]{3}$/.test(primary)) return false;
  if (!Array.isArray(entry.iata_codes)) return false;
  for (const code of entry.iata_codes) {
    if (typeof code !== 'string') return false;
    if (!/^[A-Z]{3}$/.test(normalize(code))) return false;
  }
  if (!entry.iata_codes.some((c: string) => normalize(c) === primary)) return false;
  return true;
}

function isTooLarge(text: string): boolean {
  return Buffer.byteLength(text, 'utf-8') > MAX_RESPONSE_BYTES;
}

export async function createSwedishCountiesLookup(options?: CreateLookupOptions): Promise<SwedishCountiesLookup> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? FETCH_TIMEOUT_MS;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let rawText: string;
    try {
      const response = await fetchImpl(SWEDISH_COUNTIES_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        console.warn(`[SVENSKA LÄN] Kunde inte hämta svenska län-data: HTTP ${response.status}`);
        return new SwedishCountiesLookupImpl([]);
      }

      const contentLength = response.headers?.get?.('content-length');
      if (contentLength !== null && contentLength !== undefined) {
        const length = parseInt(contentLength, 10);
        if (!isNaN(length) && length > MAX_RESPONSE_BYTES) {
          console.warn(`[SVENSKA LÄN] Content-Length ${length} överstiger gränsen ${MAX_RESPONSE_BYTES}`);
          return new SwedishCountiesLookupImpl([]);
        }
      }

      rawText = await response.text();

      if (isTooLarge(rawText)) {
        console.warn(`[SVENSKA LÄN] Svenska län-data är för stor (${Buffer.byteLength(rawText, 'utf-8')} byte)`);
        return new SwedishCountiesLookupImpl([]);
      }
    } finally {
      clearTimeout(timeout);
    }

    let raw: SwedishCountiesResponse;
    try {
      raw = JSON.parse(rawText) as SwedishCountiesResponse;
    } catch {
      console.warn('[SVENSKA LÄN] Ogiltig JSON i svenska län-data');
      return new SwedishCountiesLookupImpl([]);
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
