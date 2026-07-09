import { readFileSync } from 'node:fs';

const SWEDISH_COUNTIES_URL = 'https://codeberg.org/meshat/lookup-data/raw/branch/main/meshcore/swedish_counties.json';
const LOCAL_COUNTIES_FILE = new URL('../lookup-data/swedish_counties.json', import.meta.url);
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
  private primaryByIata: Map<string, string> = new Map();
  private secondaryCorrectionByIata: Map<string, { primaryIATA: string; countyName: string }> = new Map();
  private ambiguousSecondaryIatas: Set<string> = new Set();
  private primaryIatas: Set<string> = new Set();
  private available = false;

  constructor(entries: CountyEntry[]) {
    if (entries.length === 0) return;

    const primaryNames = new Map<string, string[]>();
    for (const entry of entries) {
      const primary = entry.primary_iata.trim().toUpperCase();
      const names = primaryNames.get(primary) || [];
      names.push(entry.name.trim());
      primaryNames.set(primary, names);
    }

    for (const [primary, names] of primaryNames) {
      if (names.length > 1) {
        console.warn(`[SVENSKA LÄN] Duplicate primary IATA ${primary} i flera län: ${names.join(', ')}, visar "${names.join(' / ')}"`);
      }
      this.primaryByIata.set(primary, names.join(' / '));
    }

    const uniqueEntries = entries.filter(entry => {
      const primary = entry.primary_iata.trim().toUpperCase();
      const first = entries.find(e => e.primary_iata.trim().toUpperCase() === primary);
      return entry === first;
    });

    const secondaryCount = new Map<string, number>();
    for (const entry of uniqueEntries) {
      const primary = entry.primary_iata.trim().toUpperCase();
      for (const rawCode of entry.iata_codes || []) {
        const code = rawCode.trim().toUpperCase();
        if (code !== primary) {
          secondaryCount.set(code, (secondaryCount.get(code) || 0) + 1);
        }
      }
    }

    for (const entry of uniqueEntries) {
      const countyName = entry.name.trim();
      const primaryIATA = entry.primary_iata.trim().toUpperCase();

      this.primaryIatas.add(primaryIATA);

      for (const rawCode of entry.iata_codes || []) {
        const code = rawCode.trim().toUpperCase();
        if (code === primaryIATA) continue;
        const count = secondaryCount.get(code) || 0;
        if (count === 1) {
          this.secondaryCorrectionByIata.set(code, { primaryIATA, countyName });
        }
      }
    }

    for (const [code, count] of secondaryCount) {
      if (count > 1) {
        this.ambiguousSecondaryIatas.add(code);
      }
    }

    for (const code of this.ambiguousSecondaryIatas) {
      console.warn(`[SVENSKA LÄN] Sekundär IATA ${code} förekommer i flera län och används inte för correction`);
    }

    if (this.primaryByIata.size > 0) {
      this.available = true;
    }

    console.log(`[SVENSKA LÄN] Lookup available: ${this.primaryByIata.size} län, ${this.primaryIatas.size} primary IATA, ${this.secondaryCorrectionByIata.size} unika secondary, ${this.ambiguousSecondaryIatas.size} ambiguous`);
  }

  isAvailable(): boolean {
    return this.available;
  }

  getCountyForIata(iata: string): string | undefined {
    const key = normalize(iata);
    const primary = this.primaryByIata.get(key);
    if (primary) return primary;
    return this.secondaryCorrectionByIata.get(key)?.countyName;
  }

  getPrimaryIataForIata(iata: string): string | undefined {
    const key = normalize(iata);
    if (this.primaryByIata.has(key)) return key;
    return this.secondaryCorrectionByIata.get(key)?.primaryIATA;
  }

  isPrimaryIata(iata: string): boolean {
    return this.primaryIatas.has(normalize(iata));
  }

  getCorrectionForIata(iata: string): string | undefined {
    const key = normalize(iata);
    if (this.primaryByIata.has(key)) return undefined;
    if (this.ambiguousSecondaryIatas.has(key)) return undefined;
    const info = this.secondaryCorrectionByIata.get(key);
    if (!info) return undefined;
    return `Tills observer byter till korrekt IATA ${info.primaryIATA} för ${info.countyName}`;
  }

  getAllCountyLookup(): Record<string, CountyLookupEntry> {
    const result: Record<string, CountyLookupEntry> = {};
    for (const [iata, countyName] of this.primaryByIata) {
      result[iata] = { countyName, primaryIata: iata, isPrimary: true };
    }
    for (const [iata, info] of this.secondaryCorrectionByIata) {
      result[iata] = { countyName: info.countyName, primaryIata: info.primaryIATA, isPrimary: false };
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

function isValidCountyEntry(value: unknown): value is CountyEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.name !== 'string') return false;
  if (hasControlChars(entry.name)) return false;
  const trimmedName = entry.name.trim();
  if (trimmedName === '') return false;
  if (trimmedName.length > MAX_NAME_LENGTH) return false;
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

async function readResponseBody(response: { body?: any; text(): Promise<string>; headers?: { get?(name: string): string | null } }, maxBytes: number): Promise<string | null> {
  const rawLength = response.headers?.get?.('content-length');
  if (rawLength !== null && rawLength !== undefined) {
    const length = Number(rawLength);
    if (Number.isFinite(length) && length >= 0 && length > maxBytes) {
      console.warn(`[SVENSKA LÄN] Content-Length ${length} överstiger gränsen ${maxBytes}`);
      if (response.body?.cancel) {
        await response.body.cancel().catch(() => {});
      }
      return null;
    }
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result = '';
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => {});
          console.warn(`[SVENSKA LÄN] Svenska län-data är för stor (stream avbruten vid ${totalBytes} byte)`);
          return null;
        }
        result += decoder.decode(value, { stream: true });
      }
      result += decoder.decode();
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }
    return result;
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf-8') > maxBytes) {
    console.warn(`[SVENSKA LÄN] Svenska län-data är för stor (${Buffer.byteLength(text, 'utf-8')} byte)`);
    return null;
  }
  return text;
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

      const body = await readResponseBody(response, MAX_RESPONSE_BYTES);
      if (body === null) {
        return new SwedishCountiesLookupImpl([]);
      }
      rawText = body;
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
    const invalidCount = raw.swedish_counties.length - validEntries.length;
    if (invalidCount > 0) {
      console.warn(`[SVENSKA LÄN] ${invalidCount} av ${raw.swedish_counties.length} entries var ogiltiga och ignorerades`);
    }

    return new SwedishCountiesLookupImpl(validEntries);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[SVENSKA LÄN] Kunde inte hämta svenska län-data: ${message}`);

    if (options?.fetchImpl) {
      return new SwedishCountiesLookupImpl([]);
    }

    try {
      console.log('[SVENSKA LÄN] Försöker ladda lokal fallback-fil...');
      const localText = readFileSync(LOCAL_COUNTIES_FILE, 'utf-8');
      if (Buffer.byteLength(localText, 'utf-8') > MAX_RESPONSE_BYTES) {
        console.warn('[SVENSKA LÄN] Lokal fallback-fil är för stor');
        return new SwedishCountiesLookupImpl([]);
      }
      const localRaw = JSON.parse(localText) as SwedishCountiesResponse;
      if (!localRaw.swedish_counties || !Array.isArray(localRaw.swedish_counties) || localRaw.swedish_counties.length === 0) {
        console.warn('[SVENSKA LÄN] Lokal fallback-fil saknar giltig swedish_counties-array');
        return new SwedishCountiesLookupImpl([]);
      }
      console.log('[SVENSKA LÄN] Laddar svenska län-data från lokal fallback-fil');
      const localValidEntries = localRaw.swedish_counties.filter(isValidCountyEntry);
      return new SwedishCountiesLookupImpl(localValidEntries);
    } catch (fallbackError) {
      const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      console.warn(`[SVENSKA LÄN] Kunde inte ladda lokal fallback-fil: ${fallbackMsg}`);
      return new SwedishCountiesLookupImpl([]);
    }
  }
}
