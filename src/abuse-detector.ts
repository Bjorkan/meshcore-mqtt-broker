import { createHash } from "crypto";
import type { MeshAedesClient } from "./aedes-types.js";
import { getModuleLogger } from "./logger.js";
const log = getModuleLogger("AbuseDetector");

const MAX_PEAK_RATE_TIMESTAMPS = 10_000;
const MAX_ANOMALIES_PER_CLIENT = 100;

// ============================================================================
// Type Definitions
// ============================================================================

export interface ClientTrustState {
  // Identity
  publicKey: string;
  username: string;
  connectedAt: number;

  // Status (observe-only: never transitions to muted by the broker)
  status: "allowed" | "muted" | "would_mute";
  mutedAt?: number;
  mutedUntil?: number;
  muteReason?: string;
  abuseBlockCount: number;
  abuseBlockCountWindowStartedAt?: number;

  // Rate observation (leaky bucket counters, never enforced)
  tokenBucket: {
    tokens: number;
    lastRefill: number;
    capacity: number;
    refillRate: number;
  };

  // Duplicate detection
  recentPacketHashes: {
    hash: string;
    timestamp: number;
    count: number; // How many times this packet was seen
  }[];
  duplicateCount: number; // Total duplicates seen (lifetime)
  duplicateRateWindow: {
    // Track duplicate rate over time
    totalPackets: number;
    duplicatePackets: number;
    windowStart: number;
    windowMs: number; // 5 minutes
  };

  // Counters (lifetime)
  totalPacketsReceived: number;
  totalPacketsSilenced: number;
  totalPacketsRelayed: number;

  // Behavioral metrics
  uniqueTopics: Set<string>;
  topicHistory: {
    topic: string;
    timestamp: number;
  }[];

  // IATA location tracking
  iataHistory: {
    iata: string;
    firstSeen: number;
    lastSeen: number;
  }[];
  currentIata?: string;
  iataChangeCount24h: number;

  // Clock tracking
  clockTracking: {
    version: number; // Schema version for clock tracking (increment to reset)
    estimatedOffset?: number;
    lastDeviceTimestamp?: number;
    lastBrokerTimestamp?: number;
    erraticJumps: {
      from: number;
      to: number;
      offsetChange: number;
      timestamp: number;
    }[];
  };

  // Anomaly tracking
  anomalyCount: number;
  anomalies: {
    type: string;
    details: string;
    timestamp: number;
  }[];

  // Performance/debugging
  lastPacketAt: number;
  avgPacketSize: number;
  peakRateObserved: number;
  peakRateWindow: {
    version: number; // Schema version (increment to reset)
    packets: number[];
    windowMs: number;
  };
}

export interface AbuseConfig {
  // Duplicate detection
  duplicateWindowSize: number;
  duplicateWindowMs: number;
  duplicateThreshold: number;
  maxDuplicatesPerPacket: number; // Allow N copies of same packet (repeaters)
  duplicateRateThreshold: number; // Max % of packets that can be duplicates (0-1)
  duplicateRateWindowMs: number; // Window to measure duplicate rate (5 min)

  // Rate limiting
  bucketCapacity: number;
  bucketRefillRate: number;

  // Anomaly detection
  maxPacketSize: number;
  maxTopicsPerDay: number;
  anomalyThreshold: number;

  // IATA change detection
  maxIataChanges24h: number;

  // Topic tracking
  topicHistorySize: number;
  topicHistoryWindowMs: number;

  // Enforcement (retained for config compatibility; always observe-only)
  enforcementEnabled: boolean;
}

function formatStatusForLog(status: ClientTrustState["status"]): string {
  switch (status) {
    case "allowed":
      return "allowed";
    case "muted":
      return "muted";
    case "would_mute":
      return "would mute";
  }
}

function formatAnomalyTypeForLog(type: string): string {
  switch (type) {
    case "packet_size":
      return "packet size";
    case "excessive_packet_copies":
      return "too many packet copies";
    case "high_duplicate_rate":
      return "high duplicate rate";
    default:
      return type;
  }
}

// ============================================================================
// Abuse Detector Class (observe-only; IP blocking lives in CrowdSec/Traefik)
// ============================================================================

export class AbuseDetector {
  private config: AbuseConfig;
  private clients: Map<string, ClientTrustState> = new Map();

  // Global stats
  private stats = {
    totalClientsConnected: 0,
    totalClientsMuted: 0,
    totalPacketsSilenced: 0,
  };

  constructor(config: AbuseConfig) {
    this.config = config;
    log.info(
      "initialized in observe-only mode; IP blocking is handled by CrowdSec/Traefik",
    );
  }

  public shutdown(): void {
    log.info("shutdown complete");
  }

  // ============================================================================
  // Client Management
  // ============================================================================

  private formatClientForLog(
    stateOrPublicKey: ClientTrustState | string,
  ): string {
    const publicKey =
      typeof stateOrPublicKey === "string"
        ? stateOrPublicKey
        : stateOrPublicKey.publicKey;
    const username =
      typeof stateOrPublicKey === "string"
        ? undefined
        : stateOrPublicKey.username;
    if (username && !username.startsWith("v1_")) {
      return username;
    }

    return publicKey.substring(0, 8);
  }

  public initializeClient(publicKey: string, username: string): void {
    const key = publicKey.toUpperCase();
    const tracked = this.clients.get(key);
    if (tracked) {
      if (username && !username.startsWith("v1_")) {
        tracked.username = username;
      }
      log.info(
        `[${this.formatClientForLog(tracked)}] client reconnected (status: ${formatStatusForLog(tracked.status)})`,
      );
      tracked.connectedAt = Date.now();
      return;
    }

    const state: ClientTrustState = {
      publicKey,
      username,
      connectedAt: Date.now(),
      status: "allowed",
      abuseBlockCount: 0,
      tokenBucket: {
        tokens: this.config.bucketCapacity,
        lastRefill: Date.now(),
        capacity: this.config.bucketCapacity,
        refillRate: this.config.bucketRefillRate,
      },
      recentPacketHashes: [],
      duplicateCount: 0,
      duplicateRateWindow: {
        totalPackets: 0,
        duplicatePackets: 0,
        windowStart: Date.now(),
        windowMs: this.config.duplicateRateWindowMs,
      },
      totalPacketsReceived: 0,
      totalPacketsSilenced: 0,
      totalPacketsRelayed: 0,
      uniqueTopics: new Set(),
      topicHistory: [],
      iataHistory: [],
      iataChangeCount24h: 0,
      clockTracking: {
        version: 1,
        erraticJumps: [],
      },
      anomalyCount: 0,
      anomalies: [],
      lastPacketAt: Date.now(),
      avgPacketSize: 0,
      peakRateObserved: 0,
      peakRateWindow: {
        version: 1,
        packets: [],
        windowMs: 86400000, // 24 hours
      },
    };

    this.clients.set(key, state);
    this.stats.totalClientsConnected++;

    log.info(`[${this.formatClientForLog(state)}] initialized trust tracking`);
  }

  public rememberClientName(publicKey: string, username: string): void {
    if (!username || username.startsWith("v1_")) {
      return;
    }

    const state = this.clients.get(publicKey.toUpperCase());
    if (state) {
      state.username = username;
    }
  }

  public getClientStats(publicKey: string): ClientTrustState | undefined {
    return this.clients.get(publicKey.toUpperCase());
  }

  public getAllStats() {
    return {
      ...this.stats,
      clients: Array.from(this.clients.entries()).map(([key, state]) => ({
        publicKey: key,
        status: state.status,
        totalPacketsReceived: state.totalPacketsReceived,
        totalPacketsSilenced: state.totalPacketsSilenced,
        duplicateCount: state.duplicateCount,
        anomalyCount: state.anomalyCount,
      })),
    };
  }

  // ============================================================================
  // Packet Processing (observation only; always allows)
  // ============================================================================

  public recordPacket(
    client: MeshAedesClient,
    packet: { payload: Buffer | string; topic?: string },
  ): boolean {
    const publicKey = client.publicKey;
    if (!publicKey) {
      return false;
    }
    const state = this.clients.get(publicKey.toUpperCase());

    if (!state) {
      log.error(`no trust state for ${publicKey}`);
      return false;
    }

    const now = Date.now();
    state.totalPacketsReceived++;
    state.lastPacketAt = now;

    // Update average packet size
    const payloadSize = packet.payload.length;
    if (state.avgPacketSize === 0) {
      state.avgPacketSize = payloadSize;
    } else {
      state.avgPacketSize = state.avgPacketSize * 0.9 + payloadSize * 0.1;
    }

    // Single JSON parse shared by the size and duplicate checks below.
    let parsedMessage: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(packet.payload.toString("utf-8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        parsedMessage = parsed as Record<string, unknown>;
      }
    } catch {
      // Non-JSON payloads (e.g. serial/responses) skip JSON-based checks.
    }

    this.observePeakRate(state, now);

    // Check packet size based on raw LoRa packet data
    if (parsedMessage?.raw) {
      const rawByteSize = (parsedMessage.raw as string).length / 2;

      if (rawByteSize > this.config.maxPacketSize) {
        log.info(
          `[${this.formatClientForLog(state)}] anomalous raw packet size: ${rawByteSize} bytes (hex: ${(parsedMessage.raw as string).length} chars)`,
        );
        this.recordAnomaly(
          state,
          "packet_size",
          `Raw packet size ${rawByteSize} bytes exceeds limit ${this.config.maxPacketSize}`,
        );
      }
    }

    // Observe the token-bucket level without enforcing it.
    this.checkRateLimit(state);

    // Check for duplicates. Status är heartbeat/statusdata och ska inte behandlas som radiopaket-dubbletter.
    const subtopic =
      typeof packet.topic === "string"
        ? packet.topic.split("/").slice(3).join("/")
        : "";
    if (subtopic !== "status") {
      let duplicateFingerprint = packet.payload.toString();

      if (
        parsedMessage &&
        (subtopic === "packets" || subtopic === "raw") &&
        typeof parsedMessage.raw === "string"
      ) {
        duplicateFingerprint = `raw:${parsedMessage.raw.toLowerCase()}`;
      }

      this.checkDuplicates(state, duplicateFingerprint);
    }

    return true;
  }

  /**
   * Incremental peak-rate observation. The packet array stays sorted because
   * timestamps are appended in arrival order, so expiry is a cheap shift
   * from the front instead of three full-array filters per packet.
   */
  private observePeakRate(state: ClientTrustState, now: number): void {
    const window = state.peakRateWindow;
    window.packets.push(now);

    const windowStart = now - window.windowMs;
    let expired = 0;
    while (
      expired < window.packets.length &&
      window.packets[expired] <= windowStart
    ) {
      expired += 1;
    }
    if (expired > 0) {
      window.packets.splice(0, expired);
    }
    if (window.packets.length > MAX_PEAK_RATE_TIMESTAMPS) {
      window.packets.splice(
        0,
        window.packets.length - MAX_PEAK_RATE_TIMESTAMPS,
      );
    }

    // Count backwards: the array is arrival-ordered, so the 10s rate and
    // the 1h "any traffic" probe both stop at the first older entry.
    const tenSecondsAgo = now - 10_000;
    let recentCount = 0;
    let seenWithinHour = false;
    for (let index = window.packets.length - 1; index >= 0; index -= 1) {
      const timestamp = window.packets[index];
      if (timestamp > tenSecondsAgo) {
        recentCount += 1;
      }
      if (timestamp > now - 3_600_000) {
        seenWithinHour = true;
        break;
      }
    }
    const currentRate = recentCount / 10; // packets per second

    // Update peak if current rate is higher
    if (currentRate > state.peakRateObserved) {
      state.peakRateObserved = currentRate;
    }

    // Reset peak if no packets in last hour (allows peak to decay)
    if (!seenWithinHour) {
      state.peakRateObserved = 0;
    }
  }

  public shouldSilencePacket(_client: MeshAedesClient): boolean {
    // Observe-only: the broker never silences packets. IP blocking is
    // handled by CrowdSec/Traefik in front of the broker.
    return false;
  }

  public isEnforcementEnabled(): boolean {
    return false;
  }

  // ============================================================================
  // Detection Methods
  // ============================================================================

  public checkDuplicates(state: ClientTrustState, payload: string): boolean {
    const hash = createHash("sha256").update(payload).digest("hex");
    const now = Date.now();

    // Clean old hashes (outside window)
    state.recentPacketHashes = state.recentPacketHashes.filter(
      (item) => now - item.timestamp < this.config.duplicateWindowMs,
    );

    // Check if hash exists
    const existingHash = state.recentPacketHashes.find(
      (item) => item.hash === hash,
    );

    // Reset duplicate rate window if expired
    if (
      now - state.duplicateRateWindow.windowStart >
      state.duplicateRateWindow.windowMs
    ) {
      state.duplicateRateWindow.totalPackets = 0;
      state.duplicateRateWindow.duplicatePackets = 0;
      state.duplicateRateWindow.windowStart = now;
    }

    // Track total packets in window
    state.duplicateRateWindow.totalPackets++;

    if (existingHash) {
      existingHash.count++;
      existingHash.timestamp = now; // Update last seen
      state.duplicateCount++;
      state.duplicateRateWindow.duplicatePackets++;

      // Check 1: Too many copies of this specific packet
      if (existingHash.count > this.config.maxDuplicatesPerPacket) {
        const details = [
          `hash=${hash.substring(0, 12)}`,
          `copies=${existingHash.count}`,
          `max=${this.config.maxDuplicatesPerPacket}`,
          `window=${Math.round(this.config.duplicateWindowMs / 60000)} min`,
        ].join(", ");
        this.recordAnomaly(state, "excessive_packet_copies", details);

        return false; // Observed as excessive, but never enforced
      }

      // Check 2: Overall duplicate rate too high
      if (state.duplicateRateWindow.totalPackets >= 20) {
        // Need at least 20 packets to judge
        const duplicateRate =
          state.duplicateRateWindow.duplicatePackets /
          state.duplicateRateWindow.totalPackets;

        if (duplicateRate > this.config.duplicateRateThreshold) {
          const details = [
            `duplicate rate=${Math.round(duplicateRate * 100)}%`,
            `max=${Math.round(this.config.duplicateRateThreshold * 100)}%`,
            `duplicates=${state.duplicateRateWindow.duplicatePackets}`,
            `total=${state.duplicateRateWindow.totalPackets}`,
            `window=${Math.round(state.duplicateRateWindow.windowMs / 60000)} min`,
          ].join(", ");
          this.recordAnomaly(state, "high_duplicate_rate", details);

          return false;
        }
      }

      // Duplicate, but within acceptable limits
      return true;
    }

    // New unique packet - add to tracking
    state.recentPacketHashes.push({ hash, timestamp: now, count: 1 });

    // Limit size
    if (state.recentPacketHashes.length > this.config.duplicateWindowSize) {
      state.recentPacketHashes.shift();
    }

    return true;
  }

  public checkRateLimit(state: ClientTrustState): boolean {
    const now = Date.now();
    const timeSinceLastRefill =
      Math.max(0, now - state.tokenBucket.lastRefill) / 1000;

    // Refill tokens
    const tokensToAdd = timeSinceLastRefill * state.tokenBucket.refillRate;
    state.tokenBucket.tokens = Math.min(
      state.tokenBucket.capacity,
      state.tokenBucket.tokens + tokensToAdd,
    );
    state.tokenBucket.lastRefill = now;

    if (state.tokenBucket.tokens < 1) {
      log.info(
        `[${this.formatClientForLog(state)}] trigger: rate limit observed (tokens=${state.tokenBucket.tokens.toFixed(2)}, capacity=${state.tokenBucket.capacity})`,
      );
      return false;
    }

    // Consume token
    state.tokenBucket.tokens -= 1;
    return true;
  }

  public checkIataChange(state: ClientTrustState, iata: string): boolean {
    const now = Date.now();
    const twentyFourHoursAgo = now - 86400000;

    // Clean old history
    state.iataHistory = state.iataHistory.filter(
      (item) => item.lastSeen > twentyFourHoursAgo,
    );

    // Check if this is a new IATA
    if (state.currentIata && state.currentIata !== iata) {
      const existingEntry = state.iataHistory.find(
        (item) => item.iata === iata,
      );

      if (!existingEntry) {
        // New IATA
        state.iataChangeCount24h = state.iataHistory.length + 1;

        log.info(
          `[${this.formatClientForLog(state)}] IATA change detected (${state.currentIata} -> ${iata}, total: ${state.iataChangeCount24h}/${this.config.maxIataChanges24h} in 24h)`,
        );

        if (state.iataChangeCount24h > this.config.maxIataChanges24h) {
          log.info(
            `[${this.formatClientForLog(state)}] IATA change over observation threshold, still allowing (${state.iataChangeCount24h} changes in 24h)`,
          );
        }

        state.iataHistory.push({
          iata,
          firstSeen: now,
          lastSeen: now,
        });
      } else {
        existingEntry.lastSeen = now;
      }

      state.currentIata = iata;
    } else if (!state.currentIata) {
      // First IATA
      state.currentIata = iata;
      state.iataHistory.push({
        iata,
        firstSeen: now,
        lastSeen: now,
      });
    } else {
      // Same IATA, update last seen
      const entry = state.iataHistory.find((item) => item.iata === iata);
      if (entry) {
        entry.lastSeen = now;
      }
    }

    return true;
  }

  public checkAnomalies(
    _state: ClientTrustState,
    _packet: { payload: Buffer | string; topic?: string },
  ): boolean {
    // Additional anomaly checks can be added here
    return true;
  }

  private recordAnomaly(
    state: ClientTrustState,
    type: string,
    details: string,
  ): void {
    state.anomalyCount++;
    state.anomalies.push({
      type,
      details,
      timestamp: Date.now(),
    });
    if (state.anomalies.length > MAX_ANOMALIES_PER_CLIENT) {
      state.anomalies = state.anomalies.slice(-MAX_ANOMALIES_PER_CLIENT);
    }

    log.info(
      `[${this.formatClientForLog(state)}] trigger: anomaly ${formatAnomalyTypeForLog(type)} (${state.anomalyCount}/${this.config.anomalyThreshold}) - ${details}`,
    );
  }

  public evictInactiveClients(now = Date.now(), maxInactiveMs: number): number {
    let evicted = 0;
    for (const [key, state] of this.clients) {
      const lastActivity = Math.max(
        state.lastPacketAt ?? 0,
        state.connectedAt ?? 0,
      );
      if (now - lastActivity <= maxInactiveMs) {
        continue;
      }
      this.clients.delete(key);
      evicted += 1;
    }
    if (evicted > 0) {
      log.info(
        `evicted ${evicted} inactive client trust states (inactive for more than ${Math.round(
          maxInactiveMs / 86_400_000,
        )} days)`,
      );
    }
    return evicted;
  }

  /** Periodic sweep entry point; keeps process-local observations bounded. */
  public sweepInactiveClients(
    maxInactiveMs = 30 * 86_400_000,
    maxClients = 50_000,
  ): number {
    let evicted = this.evictInactiveClients(Date.now(), maxInactiveMs);
    if (this.clients.size > maxClients) {
      // Oldest activity first.
      const entries = [...this.clients.entries()].sort(
        ([, a], [, b]) =>
          Math.max(a.lastPacketAt ?? 0, a.connectedAt ?? 0) -
          Math.max(b.lastPacketAt ?? 0, b.connectedAt ?? 0),
      );
      const overflow = entries.length - maxClients;
      for (let index = 0; index < overflow; index += 1) {
        this.clients.delete(entries[index][0]);
        evicted += 1;
      }
      if (overflow > 0) {
        log.info(
          `evicted ${overflow} excess client trust states (over cap ${maxClients})`,
        );
      }
    }
    return evicted;
  }

  public muteClient(
    _state: ClientTrustState,
    reason: string,
    details?: string,
  ): void {
    // Observe-only: record the would-be denial in logs instead of muting.
    log.info(
      `observe-only: would have muted (${reason}${details ? ` - ${details}` : ""})`,
    );
  }
}
