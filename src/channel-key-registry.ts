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
  const entries = new Map<string, ChannelKeyEntry>();
  for (const rawName of config.hashtagChannels) {
    const name = normalizeHashtagChannelName(rawName);
    const key = deriveHashtagChannelKey(name);
    entries.set(channelHashForKey(key), { name, key, kind: "hashtag" });
  }
  for (const channel of config.channels) {
    entries.set(channelHashForKey(channel.key), {
      name: channel.name,
      key: channel.key,
      kind: "psk",
    });
  }
  if (entries.size === 0) return undefined;
  const hashtagCount = config.hashtagChannels.length;
  const pskCount = config.channels.length;
  return {
    entryCount: entries.size,
    hashtagCount,
    pskCount,
    buildKeyStore: () =>
      new MeshCoreKeyStore({
        channelSecrets: [...entries.values()].map((entry) => entry.key),
      }),
    resolveEntry: (channelHashHex: string) =>
      entries.get(channelHashHex.toLowerCase()),
  };
}
