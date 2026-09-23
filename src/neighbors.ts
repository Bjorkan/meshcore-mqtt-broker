export const FIRMWARE_NEIGHBORS_JSON_BUFFER_BYTES = 10_240;
export const NEIGHBOR_RETENTION_MS = 48 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonPublishLimitForSubtopic(
  configuredLimit: number,
  subtopic: string,
): number {
  // Case-insensitive to match isRetainedSubtopic: NEIGHBORS/Neighbors get
  // the same firmware buffer as neighbors.
  return subtopic.toLowerCase() === "neighbors"
    ? Math.max(configuredLimit, FIRMWARE_NEIGHBORS_JSON_BUFFER_BYTES)
    : configuredLimit;
}

export function stripNeighborSnrForLimitedSubscriber(
  message: Record<string, unknown>,
): boolean {
  if (!Array.isArray(message.neighbors)) {
    return false;
  }

  let filtered = false;
  for (const candidate of message.neighbors) {
    if (!isRecord(candidate)) continue;
    // Case-insensitive: strip snr/SNR (and RSSI/rssi/score variants if a
    // future firmware adds them per-neighbor) so LIMITED never sees signal
    // quality regardless of firmware field casing.
    for (const key of Object.keys(candidate)) {
      const lower = key.toLowerCase();
      if (lower === "snr" || lower === "rssi" || lower === "score") {
        delete candidate[key];
        filtered = true;
      }
    }
  }
  return filtered;
}
