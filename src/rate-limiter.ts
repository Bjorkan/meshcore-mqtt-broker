import { getModuleLogger } from "./logger.js";

const log = getModuleLogger("RateLimiter");
const DEFAULT_MAX_TRACKED_IPS = 10_000;
const MAX_PRUNE_INTERVAL_MS = 60_000;

interface RateLimitRecord {
  count: number;
  firstFailure: number;
  blockedUntil?: number;
}

export class RateLimiter {
  private failedConnectionsByIP = new Map<string, RateLimitRecord>();
  private readonly windowMs: number;
  private readonly maxFailedConnections: number;
  private readonly blockDurationMs: number;
  private readonly maxTrackedIPs: number;
  private nextPruneAt = 0;

  constructor(
    windowMs: number = 60000,
    maxFailedConnections: number = 10,
    blockDurationMs: number = 300000,
    maxTrackedIPs: number = DEFAULT_MAX_TRACKED_IPS,
  ) {
    this.windowMs = windowMs;
    this.maxFailedConnections = maxFailedConnections;
    this.blockDurationMs = blockDurationMs;
    this.maxTrackedIPs = Math.max(1, Math.floor(maxTrackedIPs));
  }

  private pruneExpired(now: number): void {
    if (now < this.nextPruneAt) {
      return;
    }

    for (const [ip, record] of this.failedConnectionsByIP) {
      const expiresAt =
        record.blockedUntil ?? record.firstFailure + this.windowMs;
      if (now >= expiresAt) {
        this.failedConnectionsByIP.delete(ip);
      }
    }

    const pruneInterval = Math.max(
      1_000,
      Math.min(this.windowMs, this.blockDurationMs, MAX_PRUNE_INTERVAL_MS),
    );
    this.nextPruneAt = now + pruneInterval;
  }

  private makeRoomForNewIP(): void {
    while (this.failedConnectionsByIP.size >= this.maxTrackedIPs) {
      const oldestIP = this.failedConnectionsByIP.keys().next().value;
      if (!oldestIP) {
        return;
      }
      this.failedConnectionsByIP.delete(oldestIP);
    }
  }

  isBlocked(ip: string): boolean {
    const now = Date.now();
    this.pruneExpired(now);

    const record = this.failedConnectionsByIP.get(ip);
    if (!record) return false;

    if (record.blockedUntil) {
      if (now < record.blockedUntil) {
        return true;
      }

      this.failedConnectionsByIP.delete(ip);
      return false;
    }

    if (now - record.firstFailure > this.windowMs) {
      this.failedConnectionsByIP.delete(ip);
      return false;
    }

    return false;
  }

  recordFailure(ip: string): boolean {
    const now = Date.now();
    this.pruneExpired(now);
    const record = this.failedConnectionsByIP.get(ip);

    if (!record) {
      this.makeRoomForNewIP();
      this.failedConnectionsByIP.set(ip, { count: 1, firstFailure: now });
      return false;
    }

    if (record.blockedUntil && now >= record.blockedUntil) {
      this.failedConnectionsByIP.delete(ip);
      this.makeRoomForNewIP();
      this.failedConnectionsByIP.set(ip, { count: 1, firstFailure: now });
      return false;
    }

    if (now - record.firstFailure > this.windowMs) {
      this.failedConnectionsByIP.set(ip, { count: 1, firstFailure: now });
      return false;
    }

    record.count++;

    if (record.count >= this.maxFailedConnections && !record.blockedUntil) {
      record.blockedUntil = now + this.blockDurationMs;
      log.info(
        `blocking IP ${ip} for ${this.blockDurationMs / 1000}s ` +
          `(${record.count} failed connections in ${this.windowMs / 1000}s)`,
      );
      return true;
    }

    return false;
  }
}
