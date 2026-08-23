import type { IataConfig } from "./config.js";

export interface IataLookupEntry {
  friendlyName?: string;
  primaryIata: string;
  isPrimary: boolean;
  isAllowed: boolean;
}

export class IataRegistry {
  constructor(private readonly config: IataConfig) {}

  isAllowlistEnabled(): boolean {
    return this.config.allowlistEnabled;
  }

  isAllowedIata(code: string): boolean {
    const normalized = normalize(code);
    if (!/^[A-Z]{3}$/.test(normalized)) return false;
    return this.config.primaryEntries[normalized] !== undefined;
  }

  isSecondaryIata(code: string): boolean {
    return this.config.secondaryEntries[normalize(code)] !== undefined;
  }

  getPrimaryIata(code: string): string | undefined {
    const normalized = normalize(code);
    if (this.config.primaryEntries[normalized]) return normalized;
    return this.config.secondaryEntries[normalized]?.primaryIata;
  }

  getFriendlyName(code: string): string | undefined {
    const primaryIata = this.getPrimaryIata(code);
    return primaryIata
      ? this.config.primaryEntries[primaryIata]?.friendlyName
      : undefined;
  }

  getCorrection(code: string): string | undefined {
    const normalized = normalize(code);
    const primaryIata = this.config.secondaryEntries[normalized]?.primaryIata;
    if (!primaryIata) return undefined;
    const friendlyName = this.config.primaryEntries[primaryIata]?.friendlyName;
    return friendlyName
      ? `IATA ${normalized} is a secondary code. Use ${primaryIata} (${friendlyName}).`
      : `IATA ${normalized} is a secondary code. Use ${primaryIata}.`;
  }

  getPublicLookup(): Record<string, IataLookupEntry> {
    const lookup: Record<string, IataLookupEntry> = {};
    for (const code of this.config.allowedPrimaryIata) {
      const entry = this.config.primaryEntries[code];
      lookup[code] = {
        friendlyName: entry.friendlyName,
        primaryIata: code,
        isPrimary: true,
        isAllowed: true,
      };
    }
    for (const [code, entry] of Object.entries(this.config.secondaryEntries)) {
      lookup[code] = {
        friendlyName:
          this.config.primaryEntries[entry.primaryIata]?.friendlyName,
        primaryIata: entry.primaryIata,
        isPrimary: false,
        isAllowed: false,
      };
    }
    return lookup;
  }
}

function normalize(code: string): string {
  return code.trim().toUpperCase();
}
