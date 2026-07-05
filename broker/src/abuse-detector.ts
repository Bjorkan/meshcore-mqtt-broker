import { createHash } from 'crypto';

const MAX_PEAK_RATE_TIMESTAMPS = 10_000;
const MAX_ANOMALIES_PER_CLIENT = 100;
const FIRST_ABUSE_BLOCK_MS = 60 * 60 * 1000;
const REPEATED_ABUSE_BLOCK_MS = 6 * 60 * 60 * 1000;

// ============================================================================
// Type Definitions
// ============================================================================

export interface ClientTrustState {
  // Identity
  publicKey: string;
  username: string;
  connectedAt: number;
  
  // Network tracking
  recentIPs: {
    ip: string;
    firstSeen: number;
    lastSeen: number;
    connectionCount: number;
  }[];
  
  // Status
  status: 'allowed' | 'muted' | 'would_mute';
  mutedAt?: number;
  mutedUntil?: number;
  muteReason?: string;
  abuseBlockCount: number;
  
  // Rate limiting (leaky bucket)
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
    count: number;              // How many times this packet was seen
  }[];
  duplicateCount: number;       // Total duplicates seen (lifetime)
  duplicateRateWindow: {        // Track duplicate rate over time
    totalPackets: number;
    duplicatePackets: number;
    windowStart: number;
    windowMs: number;           // 5 minutes
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
    version: number;                  // Schema version for clock tracking (increment to reset)
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
    version: number;             // Schema version (increment to reset)
    packets: number[];
    windowMs: number;
  };
}

export interface AbuseConfig {
  // Duplicate detection
  duplicateWindowSize: number;
  duplicateWindowMs: number;
  duplicateThreshold: number;
  maxDuplicatesPerPacket: number;    // Allow N copies of same packet (repeaters)
  duplicateRateThreshold: number;    // Max % of packets that can be duplicates (0-1)
  duplicateRateWindowMs: number;     // Window to measure duplicate rate (5 min)
  
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
  
  // Enforcement
  enforcementEnabled: boolean;
}

interface SerializedTrustState {
  publicKey: string;
  username: string;
  connectedAt: number;
  recentIPs: {
    ip: string;
    firstSeen: number;
    lastSeen: number;
    connectionCount: number;
  }[];
  status: 'allowed' | 'muted' | 'would_mute';
  mutedAt?: number;
  mutedUntil?: number;
  muteReason?: string;
  abuseBlockCount?: number;
  tokenBucket: {
    tokens: number;
    lastRefill: number;
    capacity: number;
    refillRate: number;
  };
  recentPacketHashes: {
    hash: string;
    timestamp: number;
    count: number;
  }[];
  duplicateCount: number;
  duplicateRateWindow: {
    totalPackets: number;
    duplicatePackets: number;
    windowStart: number;
    windowMs: number;
  };
  totalPacketsReceived: number;
  totalPacketsSilenced: number;
  totalPacketsRelayed: number;
  uniqueTopics: string[];
  topicHistory: { topic: string; timestamp: number }[];
  iataHistory: { iata: string; firstSeen: number; lastSeen: number }[];
  currentIata?: string;
  iataChangeCount24h: number;
  clockTracking: {
    version: number;
    estimatedOffset?: number;
    lastDeviceTimestamp?: number;
    lastBrokerTimestamp?: number;
    erraticJumps: { from: number; to: number; offsetChange: number; timestamp: number }[];
  };
  anomalyCount: number;
  anomalies: { type: string; details: string; timestamp: number }[];
  lastPacketAt: number;
  avgPacketSize: number;
  peakRateObserved: number;
  peakRateWindow: {
    version: number;
    packets: number[];
    windowMs: number;
  };
}

function formatStatusForLog(status: ClientTrustState['status']): string {
  switch (status) {
    case 'allowed':
      return 'tillåten';
    case 'muted':
      return 'tystad';
    case 'would_mute':
      return 'skulle tystas';
  }
}

function formatAnomalyTypeForLog(type: string): string {
  switch (type) {
    case 'packet_size':
      return 'paketstorlek';
    case 'excessive_packet_copies':
      return 'för många paketkopior';
    case 'high_duplicate_rate':
      return 'hög dubblettandel';
    default:
      return type;
  }
}

function formatMuteReasonForLog(reason: string): string {
  if (reason === 'rate_limit_exceeded') {
    return 'hastighetsgräns överskreds';
  }

  const anomalyMatch = reason.match(/^anomaly_threshold_exceeded \((\d+) anomalies\)$/);
  if (anomalyMatch) {
    return `avvikelsegräns överskreds (${anomalyMatch[1]} avvikelser)`;
  }

  const iataMatch = reason.match(/^iata_changes_exceeded \((\d+) changes in 24h\)$/);
  if (iataMatch) {
    return `för många regionbyten (${iataMatch[1]} byten på 24h)`;
  }

  return reason;
}

// ============================================================================
// Abuse Detector Class
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
    console.log('[MISSBRUK] Initierad utan lokal filpersistens; runtime-state delas via Valkey.');
  }

  private serializeTrustState(state: ClientTrustState): SerializedTrustState {
    return {
      publicKey: state.publicKey,
      username: state.username,
      connectedAt: state.connectedAt,
      recentIPs: state.recentIPs,
      status: state.status,
      mutedAt: state.mutedAt,
      mutedUntil: state.mutedUntil,
      muteReason: state.muteReason,
      abuseBlockCount: state.abuseBlockCount,
      tokenBucket: state.tokenBucket,
      recentPacketHashes: state.recentPacketHashes,
      duplicateCount: state.duplicateCount,
      duplicateRateWindow: state.duplicateRateWindow,
      totalPacketsReceived: state.totalPacketsReceived,
      totalPacketsSilenced: state.totalPacketsSilenced,
      totalPacketsRelayed: state.totalPacketsRelayed,
      uniqueTopics: Array.from(state.uniqueTopics),
      topicHistory: state.topicHistory,
      iataHistory: state.iataHistory,
      currentIata: state.currentIata,
      iataChangeCount24h: state.iataChangeCount24h,
      clockTracking: state.clockTracking,
      anomalyCount: state.anomalyCount,
      anomalies: state.anomalies,
      lastPacketAt: state.lastPacketAt,
      avgPacketSize: state.avgPacketSize,
      peakRateObserved: state.peakRateObserved,
      peakRateWindow: state.peakRateWindow,
    };
  }

  private deserializeTrustState(serialized: SerializedTrustState): ClientTrustState {
    const state: ClientTrustState = {
      ...serialized,
      abuseBlockCount: serialized.abuseBlockCount ?? (serialized.mutedAt ? 1 : 0),
      uniqueTopics: new Set(serialized.uniqueTopics),
    };
    
    // Initialize duplicateRateWindow if missing
    if (!state.duplicateRateWindow) {
      state.duplicateRateWindow = {
        totalPackets: 0,
        duplicatePackets: 0,
        windowStart: Date.now(),
        windowMs: 300000, // 5 minutes
      };
    }

    if (state.status === 'muted' && !state.mutedUntil) {
      state.mutedUntil = (state.mutedAt ?? Date.now()) + this.getBlockDurationMs(state.abuseBlockCount || 1);
    }
    
    // Initialize peakRateWindow if missing
    if (!state.peakRateWindow || !state.peakRateWindow.version || state.peakRateWindow.version < 1) {
      state.peakRateWindow = {
        version: 1,
        packets: [],
        windowMs: 86400000,
      };
      state.peakRateObserved = 0; // Reset bad old values
    }
    
    // Reset clock tracking if version is old or missing
    if (!state.clockTracking.version || state.clockTracking.version < 1) {
      state.clockTracking = {
        version: 1,
        erraticJumps: [],
      };
      state.anomalyCount = 0;
      state.anomalies = [];
    }
    
    return state;
  }

  public exportClientState(publicKey: string): string | undefined {
    const state = this.clients.get(publicKey.toUpperCase());
    if (!state) {
      return undefined;
    }

    return JSON.stringify(this.serializeTrustState(state));
  }

  public importClientState(publicKey: string, stateJson: string): boolean {
    try {
      const serialized: SerializedTrustState = JSON.parse(stateJson);
      const state = this.deserializeTrustState(serialized);
      this.clients.set(publicKey.toUpperCase(), state);
      return true;
    } catch (error) {
      console.error(`[MISSBRUK] Kunde inte läsa klustrat tillitstillstånd för ${publicKey}:`, error);
      return false;
    }
  }

  public shutdown(): void {
    console.log('[MISSBRUK] Nedstängning klar');
  }

  // ============================================================================
  // Client Management
  // ============================================================================

  public initializeClient(publicKey: string, username: string, clientIP?: string): void {
    if (this.clients.has(publicKey)) {
      const existing = this.clients.get(publicKey)!;
      console.log(`[MISSBRUK] [${publicKey.substring(0, 8)}] Klient återanslöt (status: ${formatStatusForLog(existing.status)})`);
      existing.connectedAt = Date.now();
      
      // Update IP tracking
      if (clientIP) {
        this.recordIP(existing, clientIP);
      }
      
      return;
    }

    const state: ClientTrustState = {
      publicKey,
      username,
      connectedAt: Date.now(),
      recentIPs: [],
      status: 'allowed',
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

    this.clients.set(publicKey, state);
    this.stats.totalClientsConnected++;
    
    // Record initial IP
    if (clientIP) {
      this.recordIP(state, clientIP);
    }
    
    console.log(`[MISSBRUK] [${publicKey.substring(0, 8)}] Initierade tillitsspårning`);
  }

  private recordIP(state: ClientTrustState, ip: string): void {
    const now = Date.now();
    const existing = state.recentIPs.find(entry => entry.ip === ip);
    
    if (existing) {
      existing.lastSeen = now;
      existing.connectionCount++;
    } else {
      state.recentIPs.push({
        ip,
        firstSeen: now,
        lastSeen: now,
        connectionCount: 1,
      });
      
      // Keep only most recent 100 IPs
      if (state.recentIPs.length > 100) {
        // Sort by lastSeen desc and keep top 100
        state.recentIPs.sort((a, b) => b.lastSeen - a.lastSeen);
        state.recentIPs = state.recentIPs.slice(0, 100);
      }
    }
  }

  public getClientStats(publicKey: string): ClientTrustState | undefined {
    return this.clients.get(publicKey);
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
  // Packet Processing
  // ============================================================================

  public recordPacket(client: any, packet: any): boolean {
    const publicKey = client.publicKey;
    const state = this.clients.get(publicKey);
    
    if (!state) {
      console.error(`[MISSBRUK] Inget tillitstillstånd för ${publicKey}`);
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
    
    // Spara bara ett begränsat antal timestamps så missbruksskyddet inte själv blir en minnesrisk.
    state.peakRateWindow.packets.push(now);
    
    // Clean old packets outside 24h window
    const windowStart = now - state.peakRateWindow.windowMs;
    state.peakRateWindow.packets = state.peakRateWindow.packets.filter(
      (timestamp: number) => timestamp > windowStart
    );
    if (state.peakRateWindow.packets.length > MAX_PEAK_RATE_TIMESTAMPS) {
      state.peakRateWindow.packets = state.peakRateWindow.packets.slice(-MAX_PEAK_RATE_TIMESTAMPS);
    }
    
    // Calculate current rate (packets in last 10 seconds)
    const tenSecondsAgo = now - 10000;
    const recentPackets = state.peakRateWindow.packets.filter(
      (timestamp: number) => timestamp > tenSecondsAgo
    );
    const currentRate = recentPackets.length / 10; // packets per second
    
    // Update peak if current rate is higher
    if (currentRate > state.peakRateObserved) {
      state.peakRateObserved = currentRate;
    }
    
    // Reset peak if no packets in last hour (allows peak to decay)
    const oneHourAgo = now - 3600000;
    const packetsInLastHour = state.peakRateWindow.packets.filter(
      (timestamp: number) => timestamp > oneHourAgo
    );
    if (packetsInLastHour.length === 0) {
      state.peakRateObserved = 0;
    }

    // Check packet size based on raw LoRa packet data
    try {
      const message = JSON.parse(packet.payload.toString('utf-8'));
      if (message.raw) {
        // raw is hex string, so divide by 2 to get actual byte size
        const rawByteSize = message.raw.length / 2;
        
        // LoRa max packet size is ~255 bytes, anything beyond is suspicious
        if (rawByteSize > this.config.maxPacketSize) {
          console.log(`[MISSBRUK] [${publicKey.substring(0, 8)}] Avvikande rå paketstorlek: ${rawByteSize} byte (hex: ${message.raw.length} tecken)`);
          this.recordAnomaly(state, 'packet_size', `Rå paketstorlek ${rawByteSize} byte överskrider gränsen ${this.config.maxPacketSize}`);
        }
      }
    } catch (error) {
      // If not JSON or no raw field, skip check
    }

    // Check rate limit
    if (!this.checkRateLimit(state)) {
      console.log(`[MISSBRUK] [${publicKey.substring(0, 8)}] Hastighetsgräns överskreds`);
      this.muteClient(state, 'rate_limit_exceeded');
      return false;
    }

    // Check for duplicates. Status är heartbeat/statusdata och ska inte behandlas som radiopaket-dubbletter.
    const subtopic = typeof packet.topic === 'string' ? packet.topic.split('/').slice(3).join('/') : '';
    if (subtopic !== 'status') {
      const payload = packet.payload.toString();
      let duplicateFingerprint = payload;

      try {
        const message = JSON.parse(payload);
        if ((subtopic === 'packets' || subtopic === 'raw') && typeof message.raw === 'string') {
          duplicateFingerprint = `raw:${message.raw.toLowerCase()}`;
        }
      } catch (error) {
        // Ogenomskinliga payloads, till exempel serial/responses, hashas som rå payload.
      }

      if (!this.checkDuplicates(state, duplicateFingerprint)) {
        console.log(`[MISSBRUK] [${publicKey.substring(0, 8)}] Dubblettpaket upptäckt`);
        return false;
      }
    }

    return true;
  }

  public shouldSilencePacket(client: any): boolean {
    const publicKey = client.publicKey;
    const state = this.clients.get(publicKey);
    
    if (!state) {
      return false;
    }

    if (state.status === 'muted') {
      const now = Date.now();

      if (state.mutedUntil && now >= state.mutedUntil) {
        this.unmuteClient(state);
        return false;
      }

      state.totalPacketsSilenced++;
      this.stats.totalPacketsSilenced++;
      return true;
    }

    return false;
  }

  public isEnforcementEnabled(): boolean {
    return this.config.enforcementEnabled;
  }

  // ============================================================================
  // Detection Methods
  // ============================================================================

  public checkDuplicates(state: ClientTrustState, payload: string): boolean {
    const hash = createHash('sha256').update(payload).digest('hex');
    const now = Date.now();

    // Clean old hashes (outside window)
    state.recentPacketHashes = state.recentPacketHashes.filter(
      item => now - item.timestamp < this.config.duplicateWindowMs
    );

    // Check if hash exists
    const existingHash = state.recentPacketHashes.find(item => item.hash === hash);
    
    // Reset duplicate rate window if expired
    if (now - state.duplicateRateWindow.windowStart > state.duplicateRateWindow.windowMs) {
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
        this.recordAnomaly(
          state,
          'excessive_packet_copies',
          `Paketet sågs ${existingHash.count} gånger (max: ${this.config.maxDuplicatesPerPacket})`
        );
        
        if (state.anomalyCount >= this.config.anomalyThreshold) {
          this.muteClient(state, `anomaly_threshold_exceeded (${state.anomalyCount} anomalies)`);
        }
        
        return false; // Reject this copy
      }
      
      // Check 2: Overall duplicate rate too high
      if (state.duplicateRateWindow.totalPackets >= 20) { // Need at least 20 packets to judge
        const duplicateRate = state.duplicateRateWindow.duplicatePackets / state.duplicateRateWindow.totalPackets;
        
        if (duplicateRate > this.config.duplicateRateThreshold) {
          this.recordAnomaly(
            state,
            'high_duplicate_rate',
            `${Math.round(duplicateRate * 100)}% dubbletter de senaste ${state.duplicateRateWindow.windowMs / 60000} min (max: ${this.config.duplicateRateThreshold * 100}%)`
          );
          
          if (state.anomalyCount >= this.config.anomalyThreshold) {
            this.muteClient(state, `anomaly_threshold_exceeded (${state.anomalyCount} anomalies)`);
          }
          
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
    const timeSinceLastRefill = (now - state.tokenBucket.lastRefill) / 1000;
    
    // Refill tokens
    const tokensToAdd = timeSinceLastRefill * state.tokenBucket.refillRate;
    state.tokenBucket.tokens = Math.min(
      state.tokenBucket.capacity,
      state.tokenBucket.tokens + tokensToAdd
    );
    state.tokenBucket.lastRefill = now;

    // Check if we have tokens
    if (state.tokenBucket.tokens < 1) {
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
      item => item.lastSeen > twentyFourHoursAgo
    );

    // Check if this is a new IATA
    if (state.currentIata && state.currentIata !== iata) {
      const existingEntry = state.iataHistory.find(item => item.iata === iata);
      
      if (!existingEntry) {
        // New IATA
        state.iataChangeCount24h = state.iataHistory.length + 1;
        
        console.log(`[MISSBRUK] [${state.publicKey.substring(0, 8)}] Regionbyte upptäckt (${state.currentIata} -> ${iata}, totalt: ${state.iataChangeCount24h}/${this.config.maxIataChanges24h} på 24h)`);
        
        if (state.iataChangeCount24h > this.config.maxIataChanges24h) {
          console.log(`[MISSBRUK] [${state.publicKey.substring(0, 8)}] Regionbyte över observationsgräns, tillåter ändå (${state.iataChangeCount24h} byten på 24h)`);
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
      const entry = state.iataHistory.find(item => item.iata === iata);
      if (entry) {
        entry.lastSeen = now;
      }
    }

    return true;
  }

  public checkAnomalies(state: ClientTrustState, packet: any): boolean {
    // Additional anomaly checks can be added here
    return true;
  }

  private recordAnomaly(state: ClientTrustState, type: string, details: string): void {
    state.anomalyCount++;
    state.anomalies.push({
      type,
      details,
      timestamp: Date.now(),
    });
    if (state.anomalies.length > MAX_ANOMALIES_PER_CLIENT) {
      state.anomalies = state.anomalies.slice(-MAX_ANOMALIES_PER_CLIENT);
    }

    console.log(`[MISSBRUK] [${state.publicKey.substring(0, 8)}] Avvikelse: ${formatAnomalyTypeForLog(type)} - ${details}`);

    if (state.anomalyCount >= this.config.anomalyThreshold) {
      this.muteClient(state, `anomaly_threshold_exceeded (${state.anomalyCount} anomalies)`);
    }
  }

  private getBlockDurationMs(blockCount: number): number {
    return blockCount <= 1 ? FIRST_ABUSE_BLOCK_MS : REPEATED_ABUSE_BLOCK_MS;
  }

  private formatDurationForLog(durationMs: number): string {
    const hours = Math.round(durationMs / 3600000);
    return `${hours}h`;
  }

  private unmuteClient(state: ClientTrustState): void {
    state.status = 'allowed';
    state.mutedAt = undefined;
    state.mutedUntil = undefined;
    state.muteReason = undefined;
    state.tokenBucket.tokens = state.tokenBucket.capacity;
    state.tokenBucket.lastRefill = Date.now();
    console.log(`[MISSBRUK] [${state.publicKey.substring(0, 8)}] Blockering har löpt ut, klienten är tillåten igen`);
  }

  public muteClient(state: ClientTrustState, reason: string): void {
    if (state.status === 'muted') {
      return;
    }

    const now = Date.now();
    const nextBlockCount = state.abuseBlockCount + 1;
    const blockDurationMs = this.getBlockDurationMs(nextBlockCount);
    const mutedUntil = now + blockDurationMs;

    if (state.status === 'would_mute' && !this.config.enforcementEnabled) {
      state.mutedAt = now;
      state.mutedUntil = mutedUntil;
      state.muteReason = reason;
      console.log(`[MISSBRUK] [${state.publicKey.substring(0, 8)}] SKULLE TYSTAS igen i ${this.formatDurationForLog(blockDurationMs)} (orsak: ${formatMuteReasonForLog(reason)}) [verkställighet avstängd]`);
      return;
    }

    // Only actually mute if enforcement is enabled
    if (this.config.enforcementEnabled) {
      state.status = 'muted';
      state.mutedAt = now;
      state.mutedUntil = mutedUntil;
      state.muteReason = reason;
      state.abuseBlockCount = nextBlockCount;
      this.stats.totalClientsMuted++;
      console.log(`[MISSBRUK] [${state.publicKey.substring(0, 8)}] TYSTAD i ${this.formatDurationForLog(blockDurationMs)} (orsak: ${formatMuteReasonForLog(reason)})`);
    } else {
      state.status = 'would_mute';
      state.mutedAt = now;
      state.mutedUntil = mutedUntil;
      state.muteReason = reason;
      console.log(`[MISSBRUK] [${state.publicKey.substring(0, 8)}] SKULLE TYSTAS i ${this.formatDurationForLog(blockDurationMs)} (orsak: ${formatMuteReasonForLog(reason)}) [verkställighet avstängd]`);
    }
  }
}
