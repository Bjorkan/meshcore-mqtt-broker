import { getModuleLogger } from "./logger.js";

const log = getModuleLogger("RateLimiter");

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

  constructor(
    windowMs: number = 60000,
    maxFailedConnections: number = 10,
    blockDurationMs: number = 300000,
  ) {
    this.windowMs = windowMs;
    this.maxFailedConnections = maxFailedConnections;
    this.blockDurationMs = blockDurationMs;
  }

  isBlocked(ip: string): boolean {
    const record = this.failedConnectionsByIP.get(ip);
    if (!record) return false;

    if (record.blockedUntil && Date.now() < record.blockedUntil) {
      return true;
    }

    if (Date.now() - record.firstFailure > this.windowMs) {
      this.failedConnectionsByIP.delete(ip);
      return false;
    }

    return false;
  }

  recordFailure(ip: string): boolean {
    const now = Date.now();
    const record = this.failedConnectionsByIP.get(ip);

    if (!record) {
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
