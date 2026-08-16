import {
  bytesToHex,
  calcRegionKey,
  ChannelCrypto,
  MeshCoreKeyStore,
  type CryptoKeyStore,
} from "@michaelhart/meshcore-decoder";
import type { DecryptionConfig } from "./config.js";

export type ChannelKeyKind = "hashtag" | "psk";

export interface ChannelKeyEntry {
  name: string;
  key: string;
  kind: ChannelKeyKind;
}

export interface ChannelKeyRegistry {
  readonly entryCount: number;
  readonly hashtagCount: number;
  readonly pskCount: number;
  readonly collisionCount: number;
  buildKeyStore(): CryptoKeyStore;
  resolveEntry(channelHashHex: string): ChannelKeyEntry | undefined;
}

export function normalizeHashtagChannelName(name: string): string {
  return (name.startsWith("#") ? name : `#${name}`).toLowerCase();
}

export function deriveHashtagChannelKey(name: string): string {
  return bytesToHex(
    calcRegionKey(normalizeHashtagChannelName(name)),
  ).toLowerCase();
}

export function channelHashForKey(keyHex: string): string {
  return ChannelCrypto.calculateChannelHash(keyHex).toLowerCase();
}

export function buildChannelKeyRegistry(
  config: DecryptionConfig,
): ChannelKeyRegistry | undefined {
  if (!config.enabled) return undefined;
  const entries: ChannelKeyEntry[] = [
    ...config.hashtagChannels.map((rawName) => {
      const name = normalizeHashtagChannelName(rawName);
      return {
        name,
        key: deriveHashtagChannelKey(name),
        kind: "hashtag" as const,
      };
    }),
    ...config.channels.map((channel) => ({
      name: channel.name,
      key: channel.key,
      kind: "psk" as const,
    })),
  ];
  if (entries.length === 0) return undefined;
  const byHash = new Map<string, ChannelKeyEntry[]>();
  const seenKeys = new Set<string>();
  const deduplicated: ChannelKeyEntry[] = [];
  for (const entry of entries) {
    const seenKey = `${entry.kind}:${entry.key}`;
    if (seenKeys.has(seenKey)) continue;
    seenKeys.add(seenKey);
    deduplicated.push(entry);
    const hash = channelHashForKey(entry.key);
    const list = byHash.get(hash) ?? [];
    list.push(entry);
    byHash.set(hash, list);
  }
  let collisionCount = 0;
  for (const list of byHash.values()) {
    if (list.length > 1) collisionCount += 1;
  }
  return {
    entryCount: deduplicated.length,
    hashtagCount: config.hashtagChannels.length,
    pskCount: config.channels.length,
    collisionCount,
    buildKeyStore: () =>
      new MeshCoreKeyStore({
        channelSecrets: deduplicated.map((entry) => entry.key),
      }),
    resolveEntry: (channelHashHex: string) => {
      const list = byHash.get(channelHashHex.toLowerCase());
      return list?.[list.length - 1];
    },
  };
}
