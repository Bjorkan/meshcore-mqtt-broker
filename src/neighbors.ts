export const FIRMWARE_NEIGHBORS_JSON_BUFFER_BYTES = 10_240;
export const MAX_DASHBOARD_NEIGHBORS = 50;
const MAX_SCOPE_COUNT = 64;
const MAX_SCOPE_LENGTH = 96;
const MAX_HEARD_SECS_AGO = 0xffff_ffff;

export type NeighborQueryStatus = "responded" | "timeout" | "send_failed";

export interface ObserverNeighborEntry {
  publicKey: string;
  snr: number;
  heardSecsAgo: number;
  scopes: string[];
  status: NeighborQueryStatus;
}

export interface ObserverNeighborsSnapshot {
  receivedAt: number;
  reportedAt?: number;
  selfScopes: string[];
  neighbors: ObserverNeighborEntry[];
  invalidEntryCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseScopes(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  const seen = new Set<string>();
  const scopes: string[] = [];
  for (const rawScope of value.split(",")) {
    const scope = rawScope.trim().slice(0, MAX_SCOPE_LENGTH);
    if (!scope || seen.has(scope)) {
      continue;
    }
    seen.add(scope);
    scopes.push(scope);
    if (scopes.length >= MAX_SCOPE_COUNT) {
      break;
    }
  }
  return scopes;
}

function parseStatus(value: unknown): NeighborQueryStatus | undefined {
  if (value === "responded" || value === "timeout" || value === "send_failed") {
    return value;
  }
  return undefined;
}

function parseReportedAt(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length > 80) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function jsonPublishLimitForSubtopic(
  configuredLimit: number,
  subtopic: string,
): number {
  return subtopic === "neighbors"
    ? Math.max(configuredLimit, FIRMWARE_NEIGHBORS_JSON_BUFFER_BYTES)
    : configuredLimit;
}

export function neighborLastHeardAt(
  snapshotReceivedAt: number,
  heardSecsAgo: number,
): number {
  return snapshotReceivedAt - heardSecsAgo * 1000;
}

export function parseNeighborsSnapshot(
  payload: Buffer,
  receivedAt: number,
  expectedOriginId?: string,
): ObserverNeighborsSnapshot | undefined {
  let root: unknown;
  try {
    root = JSON.parse(payload.toString("utf8"));
  } catch {
    return undefined;
  }

  if (!isRecord(root) || !Array.isArray(root.neighbors)) {
    return undefined;
  }

  if (expectedOriginId) {
    const originId =
      typeof root.origin_id === "string" ? root.origin_id.toUpperCase() : "";
    if (originId !== expectedOriginId.toUpperCase()) {
      return undefined;
    }
  }

  const neighbors: ObserverNeighborEntry[] = [];
  const seenPublicKeys = new Set<string>();
  let invalidEntryCount = 0;

  for (const candidate of root.neighbors) {
    if (neighbors.length >= MAX_DASHBOARD_NEIGHBORS) {
      invalidEntryCount++;
      continue;
    }
    if (!isRecord(candidate)) {
      invalidEntryCount++;
      continue;
    }

    const publicKey =
      typeof candidate.pubkey === "string"
        ? candidate.pubkey.toUpperCase()
        : "";
    const status = parseStatus(candidate.status);
    const snr = candidate.snr;
    const heardSecsAgo = candidate.heard_secs_ago;

    if (
      !/^[0-9A-F]{64}$/.test(publicKey) ||
      seenPublicKeys.has(publicKey) ||
      !status ||
      typeof snr !== "number" ||
      !Number.isFinite(snr) ||
      typeof heardSecsAgo !== "number" ||
      !Number.isSafeInteger(heardSecsAgo) ||
      heardSecsAgo < 0 ||
      heardSecsAgo > MAX_HEARD_SECS_AGO
    ) {
      invalidEntryCount++;
      continue;
    }

    seenPublicKeys.add(publicKey);
    neighbors.push({
      publicKey,
      snr,
      heardSecsAgo,
      scopes: parseScopes(candidate.scopes),
      status,
    });
  }

  const self = isRecord(root.self) ? root.self : undefined;
  return {
    receivedAt,
    reportedAt: parseReportedAt(root.timestamp),
    selfScopes: parseScopes(self?.scopes),
    neighbors,
    invalidEntryCount,
  };
}

export function isObserverNeighborsSnapshot(
  value: unknown,
): value is ObserverNeighborsSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.receivedAt !== "number" ||
    !Number.isFinite(value.receivedAt) ||
    value.receivedAt < 0 ||
    (value.reportedAt !== undefined &&
      (typeof value.reportedAt !== "number" ||
        !Number.isFinite(value.reportedAt) ||
        value.reportedAt < 0)) ||
    !Array.isArray(value.selfScopes) ||
    value.selfScopes.length > MAX_SCOPE_COUNT ||
    !value.selfScopes.every(
      (scope) => typeof scope === "string" && scope.length <= MAX_SCOPE_LENGTH,
    ) ||
    !Array.isArray(value.neighbors) ||
    value.neighbors.length > MAX_DASHBOARD_NEIGHBORS ||
    typeof value.invalidEntryCount !== "number" ||
    !Number.isSafeInteger(value.invalidEntryCount) ||
    value.invalidEntryCount < 0
  ) {
    return false;
  }

  const seenPublicKeys = new Set<string>();
  return value.neighbors.every((candidate) => {
    if (!isRecord(candidate)) {
      return false;
    }
    if (
      typeof candidate.publicKey !== "string" ||
      seenPublicKeys.has(candidate.publicKey)
    ) {
      return false;
    }
    seenPublicKeys.add(candidate.publicKey);
    return (
      /^[0-9A-F]{64}$/.test(candidate.publicKey) &&
      typeof candidate.snr === "number" &&
      Number.isFinite(candidate.snr) &&
      typeof candidate.heardSecsAgo === "number" &&
      Number.isSafeInteger(candidate.heardSecsAgo) &&
      candidate.heardSecsAgo >= 0 &&
      candidate.heardSecsAgo <= MAX_HEARD_SECS_AGO &&
      Array.isArray(candidate.scopes) &&
      candidate.scopes.length <= MAX_SCOPE_COUNT &&
      candidate.scopes.every(
        (scope) =>
          typeof scope === "string" && scope.length <= MAX_SCOPE_LENGTH,
      ) &&
      parseStatus(candidate.status) !== undefined
    );
  });
}

export function stripNeighborSnrForLimitedSubscriber(
  message: Record<string, unknown>,
): boolean {
  if (!Array.isArray(message.neighbors)) {
    return false;
  }

  let filtered = false;
  for (const candidate of message.neighbors) {
    if (isRecord(candidate) && candidate.snr !== undefined) {
      delete candidate.snr;
      filtered = true;
    }
  }
  return filtered;
}
