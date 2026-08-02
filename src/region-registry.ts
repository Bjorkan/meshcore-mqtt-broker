import type { RegionConfig } from "./config.js";

export interface RegionLookupEntry {
  friendlyName?: string;
  primaryRegion: string;
  isPrimary: boolean;
  isAllowed: boolean;
}

export class RegionRegistry {
  constructor(private readonly config: RegionConfig) {}

  isWhitelistEnabled(): boolean {
    return this.config.whitelistEnabled;
  }

  isAllowedRegion(code: string): boolean {
    const normalized = normalize(code);
    if (!/^[A-Z]{3}$/.test(normalized)) return false;
    if (!this.config.whitelistEnabled) return true;
    return this.config.primaryEntries[normalized] !== undefined;
  }

  isSecondaryRegion(code: string): boolean {
    if (!this.config.whitelistEnabled) return false;
    return this.config.secondaryEntries[normalize(code)] !== undefined;
  }

  getPrimaryRegion(code: string): string | undefined {
    if (!this.config.whitelistEnabled) return undefined;
    const normalized = normalize(code);
    if (this.config.primaryEntries[normalized]) return normalized;
    return this.config.secondaryEntries[normalized]?.primaryRegion;
  }

  getFriendlyName(code: string): string | undefined {
    const primaryRegion = this.getPrimaryRegion(code);
    return primaryRegion
      ? this.config.primaryEntries[primaryRegion]?.friendlyName
      : undefined;
  }

  getCorrection(code: string): string | undefined {
    const normalized = normalize(code);
    const primaryRegion =
      this.config.secondaryEntries[normalized]?.primaryRegion;
    if (!this.config.whitelistEnabled || !primaryRegion) return undefined;
    const friendlyName =
      this.config.primaryEntries[primaryRegion]?.friendlyName;
    return friendlyName
      ? `Region ${normalized} is a secondary code. Use ${primaryRegion} (${friendlyName}).`
      : `Region ${normalized} is a secondary code. Use ${primaryRegion}.`;
  }

  getPublicLookup(): Record<string, RegionLookupEntry> {
    if (!this.config.whitelistEnabled) return {};
    const lookup: Record<string, RegionLookupEntry> = {};
    for (const code of this.config.allowedPrimaryRegions) {
      const entry = this.config.primaryEntries[code];
      lookup[code] = {
        friendlyName: entry.friendlyName,
        primaryRegion: code,
        isPrimary: true,
        isAllowed: true,
      };
    }
    for (const [code, entry] of Object.entries(this.config.secondaryEntries)) {
      lookup[code] = {
        friendlyName:
          this.config.primaryEntries[entry.primaryRegion]?.friendlyName,
        primaryRegion: entry.primaryRegion,
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
