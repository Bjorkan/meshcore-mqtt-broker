import { createHash, randomUUID } from "node:crypto";
import { Advert, BufferUtils, Packet } from "@liamcottle/meshcore.js";
import { getModuleLogger } from "./logger.js";
import { MeshcoreIoPoster } from "./meshcore-io-poster.js";
import type {
  MeshcoreIoConfig,
  MeshcoreIoUploadJob,
  ObserverRadioState,
} from "./meshcore-io-types.js";
import {
  MESHCORE_IO_OBSERVER_TTL_MS,
  MESHCORE_IO_SEEN_ADVERT_TTL_SECONDS,
  MESHCORE_IO_UPLOADABLE_ADVERT_TYPES,
  MESHCORE_IO_VALID_ADVERT_COOLDOWN_MS,
  buildMeshcoreIoPacketCandidate,
  buildMeshcoreIoUploadParams,
  formatMeshcoreIoError,
  getMeshcoreIoTopicType,
  hasCompleteMeshcoreIoParams,
  hasValidMeshcoreIoParams,
  parseMeshcoreIoJson,
  parseMeshcoreIoRadioParams,
  parseMeshcoreIoUploadJob,
  parseObserverRadioState,
  readMeshcoreIoObserverId,
  sanitizeMeshcoreIoText,
} from "./meshcore-io-utils.js";

const log = getModuleLogger("MeshCoreIO");
const POLL_MS = 250;
const INGRESS_RETENTION_MS = 24 * 60 * 60 * 1_000;
// Hard bounds so a flood of unique digests/ids cannot grow memory without
// limit inside the short dedup/observer windows.
const MAX_INGRESS_DEDUP_ENTRIES = 50_000;
const MAX_OBSERVER_RADIO_ENTRIES = 10_000;
const MAX_NODE_STATE_ENTRIES = 50_000;
// A poison ingress row is retried this many times before it is dropped so
// one bad payload cannot stall the single ingress worker forever.
const MAX_INGRESS_ATTEMPTS = 5;

export interface MeshcoreIoRuntimeDependencies {
  fetch?: typeof fetch;
  now?: () => number;
  randomId?: () => string;
  poster?: MeshcoreIoPoster;
  startLoops?: boolean;
}

export interface MeshcoreIoRuntime {
  ready: Promise<void>;
  offerPublish(topic: string, payload: Buffer): void;
  getQueueStats: () => {
    ingressPending: number;
    jobsPending: number;
    jobsProcessing: number;
    jobsRetrying: number;
    dedupEntries: number;
    observerEntries: number;
    nodeEntries: number;
    completedUploads: number;
    droppedUploads: number;
  };
  stop(): Promise<void>;
}

interface IngressEntry {
  id: number;
  topic: string;
  payload: Buffer;
  receivedAtMs: number;
  expiresAtMs: number;
  processing: boolean;
  attempts: number;
}

interface QueuedJob {
  id: number;
  job: MeshcoreIoUploadJob;
  status: "pending" | "processing" | "retry";
  nextAttemptAtMs: number;
  attemptCount: number;
}

interface NodeUploadState {
  cooldownUntilMs: number | null;
  acceptedAdvertTimestamp: number | null;
  acceptedExpiresAtMs: number | null;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

function relevantTopic(topic: string): boolean {
  const type = getMeshcoreIoTopicType(topic);
  return type === "status" || type === "packets";
}

function advertCoordinates(
  advert: Advert,
): { latitude: number; longitude: number } | undefined {
  if (advert.parsed.lat === null || advert.parsed.lon === null)
    return undefined;
  const latitude = advert.parsed.lat / 1_000_000;
  const longitude = advert.parsed.lon / 1_000_000;
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
    ? { latitude, longitude }
    : undefined;
}

function isNodesInsertedResponse(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as { code?: unknown };
    return parsed.code === "NODES_INSERTED";
  } catch {
    return false;
  }
}

class DisabledMeshcoreIoRuntime implements MeshcoreIoRuntime {
  readonly ready = Promise.resolve();

  constructor() {
    log.info("Integration: Meshcore.io är avstängd");
  }

  offerPublish(): void {}

  getQueueStats(): {
    ingressPending: number;
    jobsPending: number;
    jobsProcessing: number;
    jobsRetrying: number;
    dedupEntries: number;
    observerEntries: number;
    nodeEntries: number;
    completedUploads: number;
    droppedUploads: number;
  } {
    return {
      ingressPending: 0,
      jobsPending: 0,
      jobsProcessing: 0,
      jobsRetrying: 0,
      dedupEntries: 0,
      observerEntries: 0,
      nodeEntries: 0,
      completedUploads: 0,
      droppedUploads: 0,
    };
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * In-memory MeshCore.io upload queue. All ingress, dedup, and job state
 * resets on restart; the broker is stateless by design. Uploads, retries,
 * and drops are only logged.
 */
export class LocalMeshcoreIoRuntime implements MeshcoreIoRuntime {
  readonly ready: Promise<void>;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly poster: MeshcoreIoPoster;
  private readonly startLoops: boolean;
  private readonly shutdownController = new AbortController();
  private readonly loops: Promise<void>[] = [];
  private stopped = false;

  private nextIngressId = 1;
  private ingress: IngressEntry[] = [];
  private readonly ingressDedup = new Map<string, number>();
  private nextJobId = 1;
  private jobs: QueuedJob[] = [];
  private readonly observerRadio = new Map<
    string,
    { state: ObserverRadioState; expiresAtMs: number }
  >();
  private readonly nodeState = new Map<string, NodeUploadState>();
  private completedUploads = 0;
  private droppedUploads = 0;
  // Idle sweeper for expired ingress/dedup/observer/node rows (also keeps
  // /status counters honest when no traffic arrives). unref'd, cleared on
  // stop; the worker loops already poll, but an idle broker would otherwise
  // pin expired rows forever.
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly SWEEP_INTERVAL_MS = 60_000;
  private static readonly DEDUP_SCAN_BUDGET = 512;

  constructor(
    private readonly config: MeshcoreIoConfig,
    dependencies: MeshcoreIoRuntimeDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.randomId = dependencies.randomId ?? randomUUID;
    this.poster =
      dependencies.poster ??
      new MeshcoreIoPoster(config, { fetch: dependencies.fetch });
    this.startLoops = dependencies.startLoops !== false;
    this.ready = Promise.resolve();
    if (this.startLoops) {
      this.loops.push(this.runIngressLoop());
      for (let index = 0; index < this.config.workers; index += 1) {
        this.loops.push(this.runWorkerLoop());
      }
      // Idle sweeper: without traffic, expired rows would otherwise pin
      // memory and skew /status counters forever.
      this.sweepTimer = setInterval(() => {
        try {
          this.sweepExpired(this.now());
        } catch (error) {
          this.recordError("Periodisk rensning misslyckades", error);
        }
      }, LocalMeshcoreIoRuntime.SWEEP_INTERVAL_MS);
      this.sweepTimer.unref?.();
    }
    log.info(
      `Integration: aktiverad med ${this.config.workers} lokala uppladdningsarbetare och minnesbaserad kö`,
    );
  }

  offerPublish(topic: string, payload: Buffer): void {
    if (this.stopped || !relevantTopic(topic)) return;
    try {
      this.enqueueIngress(topic, payload);
    } catch (error) {
      this.recordError("Kunde inte kölägga MQTT-meddelande", error);
    }
  }

  getQueueStats(): {
    ingressPending: number;
    jobsPending: number;
    jobsProcessing: number;
    jobsRetrying: number;
    dedupEntries: number;
    observerEntries: number;
    nodeEntries: number;
    completedUploads: number;
    droppedUploads: number;
  } {
    const now = this.now();
    // Count only live rows so idle-expired entries never inflate /status.
    let liveDedup = 0;
    for (const expiresAt of this.ingressDedup.values()) {
      if (expiresAt > now) liveDedup += 1;
    }
    let liveObservers = 0;
    for (const entry of this.observerRadio.values()) {
      if (entry.expiresAtMs > now) liveObservers += 1;
    }
    let liveNodes = 0;
    for (const entry of this.nodeState.values()) {
      const cooldownDone =
        entry.cooldownUntilMs === null || entry.cooldownUntilMs <= now;
      const acceptDone =
        entry.acceptedExpiresAtMs === null || entry.acceptedExpiresAtMs <= now;
      if (!cooldownDone || !acceptDone) liveNodes += 1;
    }
    return {
      ingressPending: this.ingress.filter((entry) => entry.expiresAtMs > now)
        .length,
      jobsPending: this.jobs.filter((job) => job.status === "pending").length,
      jobsProcessing: this.jobs.filter((job) => job.status === "processing")
        .length,
      jobsRetrying: this.jobs.filter((job) => job.status === "retry").length,
      dedupEntries: liveDedup,
      observerEntries: liveObservers,
      nodeEntries: liveNodes,
      completedUploads: this.completedUploads,
      droppedUploads: this.droppedUploads,
    };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.shutdownController.abort(new Error("Brokerinstansen stängs ned"));
    await Promise.allSettled(this.loops);
  }

  /** Idle sweep: evict every expired map/queue row even with no traffic. */
  sweepExpired(now: number = this.now()): void {
    this.evictExpiredIngress(now);
    this.evictExpiredDedup(now);
    this.evictExpiredObserverRadio(now);
    this.evictExpiredNodeState(now);
    // Drop expired-but-unclaimed ingress rows the claim loop only skips.
    if (this.ingress.length > 0) {
      const before = this.ingress.length;
      this.ingress = this.ingress.filter(
        (entry) => entry.processing || entry.expiresAtMs > now,
      );
      const evicted = before - this.ingress.length;
      if (evicted > 0) {
        log.debug(
          `Integration: sweeprensade ${evicted} utgångna ingress-rader`,
        );
      }
    }
  }

  enqueueIngress(topic: string, payload: Buffer): void {
    if (this.stopped) return;
    const digest = createHash("sha256")
      .update(topic)
      .update("\0")
      .update(payload)
      .digest("hex");
    const now = this.now();
    const dedupExpiresAt = now + this.config.ingressDedupMs;
    const existing = this.ingressDedup.get(digest);
    if (existing !== undefined && existing > now) return;
    this.ingressDedup.set(digest, dedupExpiresAt);
    this.evictExpiredDedup(now);
    const maxRows = Math.max(10_000, this.config.maxQueuedUploads * 20);
    this.evictExpiredIngress(now);
    if (this.ingress.length >= maxRows) {
      log.warn(
        `Integration: inflödet är fullt (${this.ingress.length}/${maxRows}), tappar ${topic}`,
      );
      return;
    }
    this.ingress.push({
      id: this.nextIngressId++,
      topic,
      payload: Buffer.from(payload),
      receivedAtMs: now,
      expiresAtMs: now + INGRESS_RETENTION_MS,
      processing: false,
      attempts: 0,
    });
  }

  /** Drop expired ingress rows so dead rows can never pin the queue full. */
  private evictExpiredIngress(now: number): void {
    if (this.ingress.length === 0) return;
    const before = this.ingress.length;
    this.ingress = this.ingress.filter(
      (entry) => entry.processing || entry.expiresAtMs > now,
    );
    const evicted = before - this.ingress.length;
    if (evicted > 0) {
      log.debug(`Integration: rensade ${evicted} utgångna ingress-rader`);
    }
  }

  /** Bounded dedup map: expired first, then oldest-inserted. */
  private evictExpiredDedup(now: number): void {
    // Amortized expiry: a full scan per publish at 50k entries is O(N)
    // per MQTT message. Scan at most EVIDT_DEDUP_SCAN_BUDGET entries per
    // call (round-robin); the 60 s sweeper guarantees full coverage.
    const iterator = this.ingressDedup.entries();
    for (
      let scanned = 0;
      scanned < LocalMeshcoreIoRuntime.DEDUP_SCAN_BUDGET;
      scanned += 1
    ) {
      const next = iterator.next();
      if (next.done) break;
      const [key, expiresAt] = next.value;
      if (expiresAt <= now) this.ingressDedup.delete(key);
    }
    while (this.ingressDedup.size > MAX_INGRESS_DEDUP_ENTRIES) {
      const oldest = this.ingressDedup.keys().next();
      if (oldest.done) break;
      this.ingressDedup.delete(oldest.value);
    }
  }

  private async runIngressLoop(): Promise<void> {
    await this.ready;
    while (!this.stopped) {
      let row: IngressEntry | undefined;
      try {
        row = this.claimIngress();
        if (!row) {
          await delay(POLL_MS, this.shutdownController.signal);
          continue;
        }
        const claimed: IngressEntry = row;
        await this.processIngress(claimed);
        this.ingress = this.ingress.filter((entry) => entry.id !== claimed.id);
      } catch (error) {
        // A poison row must not head-of-line-block the single ingress
        // worker forever: a few attempts, then drop it with a log line.
        if (row) {
          row.attempts += 1;
          row.processing = false;
          if (row.attempts >= MAX_INGRESS_ATTEMPTS) {
            this.ingress = this.ingress.filter((entry) => entry.id !== row!.id);
            log.warn(
              `Integration: tappar poison-ingress ${row.topic} efter ${row.attempts} försök`,
            );
          }
        }
        this.recordError("Lokalt inflöde misslyckades", error);
        await delay(1_000, this.shutdownController.signal);
      }
    }
  }

  private claimIngress(): IngressEntry | undefined {
    const now = this.now();
    // Opportunistically drop expired head rows so claimIngress never
    // scans a graveyard of dead entries on every poll.
    while (
      this.ingress.length > 0 &&
      !this.ingress[0].processing &&
      this.ingress[0].expiresAtMs <= now
    ) {
      this.ingress.shift();
    }
    const row = this.ingress.find(
      (entry) => !entry.processing && entry.expiresAtMs > now,
    );
    if (!row) return undefined;
    row.processing = true;
    return row;
  }

  private async processIngress(row: IngressEntry): Promise<void> {
    const payload = Buffer.from(row.payload);
    const type = getMeshcoreIoTopicType(row.topic);
    if (type === "status") {
      this.rememberObserverStatus(row.topic, payload, Number(row.receivedAtMs));
      return;
    }
    if (type !== "packets") {
      // Unknown topic type can never become processable: count one poison
      // attempt so the cap below eventually drops it instead of spinning.
      throw new Error(`Okänt ingress-ämne: ${row.topic}`);
    }
    const candidate = buildMeshcoreIoPacketCandidate(row.topic, payload, type);
    if (!candidate) {
      throw new Error(`Oparsningsbar ingress: ${row.topic}`);
    }
    let packet: Packet;
    let advert: Advert;
    try {
      packet = Packet.fromBytes(candidate.rawPacket);
      if (packet.payload_type_string !== "ADVERT") return;
      advert = Advert.fromBytes(packet.payload);
    } catch {
      throw new Error(`Ogiltigt ADVERT-paket: ${row.topic}`);
    }
    const advertType = advert.parsed.type?.toUpperCase() ?? "UNKNOWN";
    if (!MESHCORE_IO_UPLOADABLE_ADVERT_TYPES.has(advertType)) return;
    if (!(await advert.isVerified())) {
      throw new Error(`Overifierad advert: ${row.topic}`);
    }
    const observerEntry = this.observerRadio.get(candidate.observerId);
    const observer =
      observerEntry && observerEntry.expiresAtMs > this.now()
        ? parseObserverRadioState(JSON.stringify(observerEntry.state))
        : undefined;
    const params = buildMeshcoreIoUploadParams(observer?.params ?? {});
    if (!hasValidMeshcoreIoParams(params)) {
      throw new Error(`Ogiltiga radioparametrar: ${row.topic}`);
    }
    const nodePublicKey = BufferUtils.bytesToHex(
      advert.publicKey,
    ).toLowerCase();
    const nodeName =
      sanitizeMeshcoreIoText(advert.parsed.name, 200) ??
      nodePublicKey.slice(0, 8);
    const coordinates = advertCoordinates(advert);
    const job: MeshcoreIoUploadJob = {
      requestId: this.randomId(),
      retriesAllowed: this.config.retriesAllowed,
      advertKey: `${nodePublicKey}:${advert.timestamp}`,
      advertTimestamp: advert.timestamp,
      advertType,
      nodeName,
      nodePublicKey,
      rawPacketHex: BufferUtils.bytesToHex(candidate.rawPacket),
      observerId: candidate.observerId,
      observerName: observer?.origin,
      latitude: coordinates?.latitude,
      longitude: coordinates?.longitude,
      radioParams: params,
      enqueuedAt: this.now(),
    };
    this.admitJob(job);
  }

  private rememberObserverStatus(
    topic: string,
    payload: Buffer,
    receivedAt: number,
  ): void {
    const parsed = parseMeshcoreIoJson(payload);
    if (!parsed || typeof parsed !== "object") return;
    const data = parsed as Record<string, unknown>;
    const observerId = readMeshcoreIoObserverId(data, topic);
    if (!observerId) return;
    const params = parseMeshcoreIoRadioParams(data);
    if (
      hasCompleteMeshcoreIoParams(params) &&
      !hasValidMeshcoreIoParams(params)
    )
      return;
    if (!hasValidMeshcoreIoParams(params)) return;
    const state: ObserverRadioState = {
      origin: sanitizeMeshcoreIoText(data.origin, 200),
      originId: observerId,
      params,
      updatedAt: receivedAt,
    };
    const existing = this.observerRadio.get(observerId);
    if (existing && existing.state.updatedAt >= receivedAt) return;
    this.observerRadio.set(observerId, {
      state,
      expiresAtMs: receivedAt + MESHCORE_IO_OBSERVER_TTL_MS,
    });
    this.evictExpiredObserverRadio(this.now());
    while (this.observerRadio.size > MAX_OBSERVER_RADIO_ENTRIES) {
      const oldest = this.observerRadio.keys().next();
      if (oldest.done) break;
      this.observerRadio.delete(oldest.value);
    }
  }

  private evictExpiredObserverRadio(now: number): void {
    for (const [key, entry] of this.observerRadio) {
      if (entry.expiresAtMs <= now) this.observerRadio.delete(key);
    }
  }

  private evictExpiredNodeState(now: number): void {
    for (const [key, entry] of this.nodeState) {
      const cooldownDone =
        entry.cooldownUntilMs === null || entry.cooldownUntilMs <= now;
      const acceptDone =
        entry.acceptedExpiresAtMs === null || entry.acceptedExpiresAtMs <= now;
      if (cooldownDone && acceptDone) this.nodeState.delete(key);
    }
  }

  admitJob(job: MeshcoreIoUploadJob): void {
    const now = this.now();
    const state = this.nodeState.get(job.nodePublicKey);
    if (
      state?.acceptedExpiresAtMs &&
      state.acceptedExpiresAtMs > now &&
      state.acceptedAdvertTimestamp !== null
    ) {
      const previous = state.acceptedAdvertTimestamp;
      if (previous >= job.advertTimestamp) return;
      // advert.timestamp is a UInt32LE seconds-since-epoch (meshcore.js
      // Advert.fromBytes), same unit as min_reupload_seconds. Documented
      // here so a future ms-based firmware field cannot silently 1000x
      // the interval.
      if (
        job.advertTimestamp <
        previous + this.config.minReuploadIntervalSeconds
      ) {
        return;
      }
    }
    if (state?.cooldownUntilMs && state.cooldownUntilMs > now) {
      return;
    }
    if (
      this.jobs.some((queued) => queued.job.nodePublicKey === job.nodePublicKey)
    ) {
      return;
    }
    const activeJobs = this.jobs.length;
    if (activeJobs >= this.config.maxQueuedUploads) {
      log.warn(
        `Integration: kön är full (${activeJobs}/${this.config.maxQueuedUploads}), tappar ${job.nodeName}`,
      );
      return;
    }
    this.jobs.push({
      id: this.nextJobId++,
      job,
      status: "pending",
      nextAttemptAtMs: now,
      attemptCount: 0,
    });
    this.nodeState.set(job.nodePublicKey, {
      cooldownUntilMs: now + MESHCORE_IO_VALID_ADVERT_COOLDOWN_MS,
      acceptedAdvertTimestamp: state?.acceptedAdvertTimestamp ?? null,
      acceptedExpiresAtMs: state?.acceptedExpiresAtMs ?? null,
    });
    this.evictExpiredNodeState(now);
    while (this.nodeState.size > MAX_NODE_STATE_ENTRIES) {
      const oldest = this.nodeState.keys().next();
      if (oldest.done) break;
      this.nodeState.delete(oldest.value);
    }
  }

  private async runWorkerLoop(): Promise<void> {
    await this.ready;
    while (!this.stopped) {
      let claimed: QueuedJob | undefined;
      try {
        claimed = this.claimJob();
        if (!claimed) {
          await delay(POLL_MS, this.shutdownController.signal);
          continue;
        }
        await this.processJob(claimed);
      } catch (error) {
        this.recordError("Lokal uppladdningsarbetare misslyckades", error);
        if (claimed && !this.stopped) {
          try {
            this.recoverClaim(claimed, error);
          } catch (recoveryError) {
            this.recordError(
              "Kunde inte återställa ett avbrutet köjobb",
              recoveryError,
            );
          }
        }
        await delay(1_000, this.shutdownController.signal);
      }
    }
  }

  private claimJob(): QueuedJob | undefined {
    const now = this.now();
    const row = this.jobs
      .filter(
        (job) =>
          (job.status === "pending" || job.status === "retry") &&
          job.nextAttemptAtMs <= now,
      )
      .sort(
        (left, right) =>
          left.nextAttemptAtMs - right.nextAttemptAtMs || left.id - right.id,
      )[0];
    if (!row) return undefined;
    row.status = "processing";
    row.attemptCount += 1;
    return row;
  }

  async processJob(row: QueuedJob): Promise<void> {
    const job = parseMeshcoreIoUploadJob(JSON.stringify(row.job));
    if (!job) {
      this.finishDropped(row.id, "Ogiltigt köjobb");
      return;
    }
    if (row.attemptCount > Math.max(1, job.retriesAllowed)) {
      this.finishDropped(
        row.id,
        "Maximalt antal uppladdningsförsök uppnått före omstart",
      );
      return;
    }
    // The poster never throws for network/HTTP failures (it returns
    // {status:"retry"}); only unexpected bugs (mock throws in tests, coding
    // errors) throw. Recover exactly once here AND rethrow so the worker
    // loop's catch only logs: recoverClaim is status-guarded (processing
    // only), so the second call is a safe no-op, not a double retry.
    try {
      const result = await this.poster.post(
        job,
        this.shutdownController.signal,
      );
      if (this.stopped) return;
      if (result.status === "handled") {
        this.finishCompleted(row.id, job, result.responseFromMeshcoreIO);
      } else if (row.attemptCount < Math.max(1, job.retriesAllowed)) {
        this.scheduleRetry(row.id);
      } else {
        const reason = formatMeshcoreIoError(result.error).slice(0, 500);
        this.finishDropped(row.id, reason);
      }
    } catch (error) {
      if (!this.stopped) {
        this.recoverClaim(row, error);
      }
      throw error;
    }
  }

  private recoverClaim(row: QueuedJob, error: unknown): void {
    // Only used by runWorkerLoop for unexpected throws (poster.post itself
    // never throws for HTTP/network: it returns {status:"retry"}). Kept
    // separate from processJob so recovery happens exactly once.
    const job = parseMeshcoreIoUploadJob(JSON.stringify(row.job));
    const reason = formatMeshcoreIoError(error).slice(0, 500);
    if (job && row.attemptCount < Math.max(1, job.retriesAllowed)) {
      this.scheduleRetry(row.id);
      return;
    }
    this.finishDropped(row.id, reason);
  }

  private scheduleRetry(id: number): void {
    const row = this.jobs.find((job) => job.id === id);
    if (!row || row.status !== "processing") return;
    row.status = "retry";
    // Exponential backoff with jitter (capped at 5 min) so a struggling
    // upstream is not hammered at a fixed interval by every worker.
    const base = Math.max(0, this.config.retryDelayMs);
    const backoff = Math.min(
      300_000,
      base * 2 ** Math.max(0, row.attemptCount - 1),
    );
    const jitter = Math.floor(Math.random() * Math.min(1_000, backoff / 4 + 1));
    row.nextAttemptAtMs = this.now() + backoff + jitter;
  }

  private finishCompleted(
    id: number,
    job: MeshcoreIoUploadJob,
    response?: string,
  ): void {
    const now = this.now();
    const index = this.jobs.findIndex(
      (queued) => queued.id === id && queued.status === "processing",
    );
    if (index === -1) return;
    this.jobs.splice(index, 1);
    this.completedUploads += 1;
    // Only a real NODES_INSERTED suppresses future adverts. Terminal
    // validation failures (ERR_ADVERT_*, ERR_COORDS_*, permanent 4xx,
    // invalid radio params, dry-run) must NOT poison nodeState: the next
    // advert may carry fixed coords/params and must be uploadable. Clear
    // the admission cooldown in both cases so retries are paced by
    // backoff, not by the 1 h valid-advert cooldown.
    const state = this.nodeState.get(job.nodePublicKey);
    if (isNodesInsertedResponse(response)) {
      this.nodeState.set(job.nodePublicKey, {
        cooldownUntilMs: null,
        acceptedAdvertTimestamp: job.advertTimestamp,
        acceptedExpiresAtMs: now + MESHCORE_IO_SEEN_ADVERT_TTL_SECONDS * 1_000,
      });
      log.info(
        `Integration: meshcore.io tog emot advert för ${job.nodeName} (${job.nodePublicKey.slice(0, 8)})`,
      );
    } else {
      // Terminal but not accepted: keep any prior accepted-advert record,
      // but clear the admission cooldown so a corrected advert is not
      // stuck behind the 1 h valid-advert cooldown.
      if (state) {
        this.nodeState.set(job.nodePublicKey, {
          cooldownUntilMs: null,
          acceptedAdvertTimestamp: state.acceptedAdvertTimestamp,
          acceptedExpiresAtMs: state.acceptedExpiresAtMs,
        });
      }
      log.info(
        `Integration: uppladdning hanterad för ${job.nodeName} (${job.nodePublicKey.slice(0, 8)})`,
      );
    }
  }

  private finishDropped(id: number, reason: string): void {
    const index = this.jobs.findIndex(
      (queued) => queued.id === id && queued.status === "processing",
    );
    if (index === -1) return;
    const job = this.jobs[index].job;
    this.jobs.splice(index, 1);
    this.droppedUploads += 1;
    // A drop must not black out the node for the 1 h admission cooldown
    // set in admitJob: clear it so the next advert can be re-admitted
    // immediately (backoff already paced the retries).
    const state = this.nodeState.get(job.nodePublicKey);
    if (state) {
      this.nodeState.set(job.nodePublicKey, {
        cooldownUntilMs: null,
        acceptedAdvertTimestamp: state.acceptedAdvertTimestamp,
        acceptedExpiresAtMs: state.acceptedExpiresAtMs,
      });
    }
    log.warn(`Integration: tappade köjobb: ${reason}`);
  }

  private recordError(context: string, error: unknown): void {
    log.error(`${context}: ${formatMeshcoreIoError(error)}`.slice(0, 500));
  }
}

export function createMeshcoreIoRuntime(
  config: MeshcoreIoConfig,
  dependencies: MeshcoreIoRuntimeDependencies = {},
): MeshcoreIoRuntime {
  return config.enabled
    ? new LocalMeshcoreIoRuntime(config, dependencies)
    : new DisabledMeshcoreIoRuntime();
}
