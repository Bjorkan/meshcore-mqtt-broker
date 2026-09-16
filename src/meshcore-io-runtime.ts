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
  stop(): Promise<void>;
}

interface IngressEntry {
  id: number;
  topic: string;
  payload: Buffer;
  receivedAtMs: number;
  expiresAtMs: number;
  processing: boolean;
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

  constructor(_config: MeshcoreIoConfig, _instanceId: string) {
    log.info("Integration: Meshcore.io är avstängd");
  }

  offerPublish(): void {}

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * In-memory MeshCore.io upload queue. All ingress, dedup, and job state
 * resets on restart; the broker is stateless by design. There is no
 * dashboard: uploads, retries, and drops are only logged.
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

  constructor(
    private readonly config: MeshcoreIoConfig,
    private readonly instanceId: string,
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

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.shutdownController.abort(new Error("Brokerinstansen stängs ned"));
    await Promise.allSettled(this.loops);
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
    if (this.ingressDedup.size > 50_000) {
      for (const [key, expiresAt] of this.ingressDedup) {
        if (expiresAt <= now) this.ingressDedup.delete(key);
        if (this.ingressDedup.size <= 50_000) break;
      }
    }
    const maxRows = Math.max(10_000, this.config.maxQueuedUploads * 20);
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
    });
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
        if (row) row.processing = false;
        this.recordError("Lokalt inflöde misslyckades", error);
        await delay(1_000, this.shutdownController.signal);
      }
    }
  }

  private claimIngress(): IngressEntry | undefined {
    const now = this.now();
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
    if (type !== "packets") return;
    const candidate = buildMeshcoreIoPacketCandidate(row.topic, payload, type);
    if (!candidate) return;
    let packet: Packet;
    let advert: Advert;
    try {
      packet = Packet.fromBytes(candidate.rawPacket);
      if (packet.payload_type_string !== "ADVERT") return;
      advert = Advert.fromBytes(packet.payload);
    } catch {
      return;
    }
    const advertType = advert.parsed.type?.toUpperCase() ?? "UNKNOWN";
    if (!MESHCORE_IO_UPLOADABLE_ADVERT_TYPES.has(advertType)) return;
    if (!(await advert.isVerified())) return;
    const observerEntry = this.observerRadio.get(candidate.observerId);
    const observer =
      observerEntry && observerEntry.expiresAtMs > this.now()
        ? parseObserverRadioState(JSON.stringify(observerEntry.state))
        : undefined;
    const params = buildMeshcoreIoUploadParams(observer?.params ?? {});
    if (!hasValidMeshcoreIoParams(params)) return;
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
    row.nextAttemptAtMs = this.now() + this.config.retryDelayMs;
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
    this.nodeState.set(job.nodePublicKey, {
      cooldownUntilMs: null,
      acceptedAdvertTimestamp: job.advertTimestamp,
      acceptedExpiresAtMs: now + MESHCORE_IO_SEEN_ADVERT_TTL_SECONDS * 1_000,
    });
    if (isNodesInsertedResponse(response)) {
      log.info(
        `Integration: meshcore.io tog emot advert för ${job.nodeName} (${job.nodePublicKey.slice(0, 8)})`,
      );
    } else {
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
    this.jobs.splice(index, 1);
    log.warn(`Integration: tappade köjobb: ${reason}`);
  }

  private recordError(context: string, error: unknown): void {
    log.error(`${context}: ${formatMeshcoreIoError(error)}`.slice(0, 500));
  }
}

export function createMeshcoreIoRuntime(
  config: MeshcoreIoConfig,
  options: { instanceId: string },
  dependencies: MeshcoreIoRuntimeDependencies = {},
): MeshcoreIoRuntime {
  return config.enabled
    ? new LocalMeshcoreIoRuntime(config, options.instanceId, dependencies)
    : new DisabledMeshcoreIoRuntime(config, options.instanceId);
}
