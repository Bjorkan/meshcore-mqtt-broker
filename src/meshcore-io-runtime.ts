import { createHash, randomUUID } from "node:crypto";
import { Advert, BufferUtils, Packet } from "@liamcottle/meshcore.js";
import type { ApplicationDatabase, Transaction } from "./database.js";
import { getModuleLogger } from "./logger.js";
import { MeshcoreIoPoster } from "./meshcore-io-poster.js";
import type {
  MeshcoreIoConfig,
  MeshcoreIoDashboardSnapshot,
  MeshcoreIoHistoryEntry,
  MeshcoreIoMapAdvert,
  MeshcoreIoUploadJob,
  MeshcoreIoWorkerStatus,
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
const HISTORY_LIMIT = 100;
const MAP_HISTORY_MS = 7 * 24 * 60 * 60 * 1_000;
const TERMINAL_JOB_LIMIT = 100;

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
  getDashboardSnapshot(): Promise<MeshcoreIoDashboardSnapshot>;
  getLocalWorkerStatus(): MeshcoreIoWorkerStatus;
  stop(): Promise<void>;
}

interface IngressRow {
  id: number;
  topic: string;
  payload: Uint8Array;
  received_at_ms: number;
}

interface JobRow {
  id: number;
  job_json: string;
  attempt_count: number;
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

  constructor(
    private readonly config: MeshcoreIoConfig,
    private readonly instanceId: string,
  ) {
    log.info("Integration: Meshcore.io är avstängd");
  }

  offerPublish(): void {}

  getLocalWorkerStatus(): MeshcoreIoWorkerStatus {
    return {
      instanceId: this.instanceId,
      configuredWorkers: 0,
      activeUploads: 0,
      uploadsSucceeded: 0,
      uploadsFailed: 0,
      updatedAt: Date.now(),
    };
  }

  getDashboardSnapshot(): Promise<MeshcoreIoDashboardSnapshot> {
    return Promise.resolve(emptySnapshot(this.config.maxQueuedUploads));
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

function emptySnapshot(maxQueuedUploads: number): MeshcoreIoDashboardSnapshot {
  return {
    enabled: false,
    processor: {
      status: "disabled",
    },
    queue: {
      ingressPending: 0,
      queued: 0,
      claimed: 0,
      active: 0,
      claimedNotActive: 0,
      total: 0,
      maxQueuedUploads,
    },
    totals: { enqueued: 0, uploaded: 0, dropped: 0, invalid: 0, retries: 0 },
    workers: [],
    history: [],
    map: { advertsLast7Days: [] },
  };
}

export class LocalMeshcoreIoRuntime implements MeshcoreIoRuntime {
  readonly ready: Promise<void>;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly poster: MeshcoreIoPoster;
  private readonly startLoops: boolean;
  private readonly shutdownController = new AbortController();
  private readonly loops: Promise<void>[] = [];
  private readonly backgroundWrites = new Set<Promise<unknown>>();
  private stopped = false;
  private activeUploads = 0;
  private uploadsSucceeded = 0;
  private uploadsFailed = 0;
  private lastUploadAt: number | undefined;
  private lastError: string | undefined;

  constructor(
    private readonly config: MeshcoreIoConfig,
    private readonly instanceId: string,
    private readonly database: ApplicationDatabase,
    dependencies: MeshcoreIoRuntimeDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.randomId = dependencies.randomId ?? randomUUID;
    this.poster =
      dependencies.poster ??
      new MeshcoreIoPoster(config, { fetch: dependencies.fetch });
    this.startLoops = dependencies.startLoops !== false;
    this.ready = this.initialize();
  }

  offerPublish(topic: string, payload: Buffer): void {
    if (this.stopped || !relevantTopic(topic)) return;
    const operation = this.enqueueIngress(topic, payload).catch((error) => {
      this.recordError("Kunde inte kölägga MQTT-meddelande", error);
    });
    this.backgroundWrites.add(operation);
    void operation.finally(() => this.backgroundWrites.delete(operation));
  }

  getLocalWorkerStatus(): MeshcoreIoWorkerStatus {
    return {
      instanceId: this.instanceId,
      configuredWorkers: this.config.workers,
      activeUploads: this.activeUploads,
      uploadsSucceeded: this.uploadsSucceeded,
      uploadsFailed: this.uploadsFailed,
      lastUploadAt: this.lastUploadAt,
      lastError: this.lastError,
      updatedAt: this.now(),
    };
  }

  async getDashboardSnapshot(): Promise<MeshcoreIoDashboardSnapshot> {
    const now = this.now();
    const [ingress, queue, stats, historyRows, mapRows] = await Promise.all([
      this.database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM meshcore_io_ingress",
      ),
      this.database.all<{ status: string; count: number }>(
        `SELECT status, COUNT(*) AS count FROM meshcore_io_jobs
         WHERE status IN ('pending', 'processing', 'retry') GROUP BY status`,
      ),
      this.database.get<{
        enqueued: number;
        uploaded: number;
        dropped: number;
        invalid: number;
        retries: number;
        last_error: string | null;
      }>("SELECT * FROM meshcore_io_stats WHERE singleton = 1"),
      this.database.all<{
        at_ms: number;
        status: "uploaded" | "dropped";
        request_id: string;
        node_name: string;
        node_public_key: string;
        advert_type: string;
        observer_name: string | null;
        worker_instance_id: string;
        detail: string | null;
      }>(
        `SELECT at_ms, status, request_id, node_name, node_public_key,
                advert_type, observer_name, worker_instance_id, detail
         FROM meshcore_io_history ORDER BY at_ms DESC, id DESC LIMIT 50`,
      ),
      this.database.all<{ advert_json: string }>(
        `SELECT advert_json FROM meshcore_io_map WHERE at_ms > $1
         ORDER BY at_ms DESC, node_public_key ASC LIMIT 1000`,
        now - MAP_HISTORY_MS,
      ),
    ]);
    const counts = new Map(queue.map((row) => [row.status, Number(row.count)]));
    const processing = counts.get("processing") ?? 0;
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const history: MeshcoreIoHistoryEntry[] = historyRows.map((row) => ({
      at: Number(row.at_ms),
      status: row.status,
      requestId: row.request_id,
      nodeName: row.node_name,
      nodePublicKey: row.node_public_key,
      advertType: row.advert_type,
      observerName: row.observer_name ?? undefined,
      workerInstanceId: row.worker_instance_id,
      detail: row.detail ?? undefined,
    }));
    const map = mapRows.flatMap((row) => {
      try {
        return [JSON.parse(row.advert_json) as MeshcoreIoMapAdvert];
      } catch {
        return [];
      }
    });
    const worker = this.getLocalWorkerStatus();
    return {
      enabled: true,
      processor: {
        instanceId: this.instanceId,
        status: "healthy",
      },
      queue: {
        ingressPending: Number(ingress?.count ?? 0),
        queued: (counts.get("pending") ?? 0) + (counts.get("retry") ?? 0),
        claimed: processing,
        active: Math.min(processing, this.activeUploads),
        claimedNotActive: Math.max(0, processing - this.activeUploads),
        total,
        maxQueuedUploads: this.config.maxQueuedUploads,
      },
      totals: {
        enqueued: Number(stats?.enqueued ?? 0),
        uploaded: Number(stats?.uploaded ?? 0),
        dropped: Number(stats?.dropped ?? 0),
        invalid: Number(stats?.invalid ?? 0),
        retries: Number(stats?.retries ?? 0),
      },
      workers: [worker],
      history,
      map: { advertsLast7Days: map },
      lastError: stats?.last_error ?? undefined,
    };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.shutdownController.abort(new Error("Brokerinstansen stängs ned"));
    await Promise.allSettled(this.loops);
    while (this.backgroundWrites.size > 0) {
      await Promise.allSettled([...this.backgroundWrites]);
    }
    await this.database.run(
      `UPDATE meshcore_io_jobs SET status = 'retry', next_attempt_at_ms = $1,
       processing_started_at_ms = NULL
       WHERE status = 'processing'`,
      this.now(),
    );
    await this.database.run(
      "UPDATE meshcore_io_ingress SET processing = false WHERE processing",
    );
  }

  private async initialize(): Promise<void> {
    await this.database.run(
      `UPDATE meshcore_io_jobs SET status = 'retry', next_attempt_at_ms = $1,
       processing_started_at_ms = NULL
       WHERE status = 'processing'`,
      this.now(),
    );
    await this.database.run(
      "UPDATE meshcore_io_ingress SET processing = false WHERE processing",
    );
    if (this.startLoops) {
      this.loops.push(this.runIngressLoop());
      for (let index = 0; index < this.config.workers; index += 1) {
        this.loops.push(this.runWorkerLoop());
      }
    }
    log.info(
      `Integration: aktiverad med ${this.config.workers} lokala uppladdningsarbetare och hållbar PostgreSQL-kö`,
    );
  }

  private async enqueueIngress(topic: string, payload: Buffer): Promise<void> {
    await this.ready;
    if (this.stopped) return;
    const digest = createHash("sha256")
      .update(topic)
      .update("\0")
      .update(payload)
      .digest("hex");
    const now = this.now();
    const enqueue = this.database.transaction(
      async (
        transaction,
        key: string,
        mqttTopic: string,
        bytes: Buffer,
        receivedAt: number,
        dedupExpiresAt: number,
        ingressExpiresAt: number,
        maxRows: number,
      ) => {
        await transaction.run(
          "DELETE FROM meshcore_io_ingress_dedup WHERE digest = $1 AND expires_at_ms <= $2",
          key,
          receivedAt,
        );
        const existing = await transaction.get<{ found: number }>(
          "SELECT 1 AS found FROM meshcore_io_ingress_dedup WHERE digest = $1 LIMIT 1",
          key,
        );
        if (existing) return false;
        await transaction.run(
          `INSERT INTO meshcore_io_ingress_dedup(digest, expires_at_ms)
           VALUES ($1, $2)`,
          key,
          dedupExpiresAt,
        );
        const count = (await transaction.get(
          "SELECT COUNT(*) AS count FROM meshcore_io_ingress",
        )) as { count: number };
        if (Number(count.count) >= maxRows) {
          await transaction.run(
            `UPDATE meshcore_io_stats SET dropped = dropped + 1
             WHERE singleton = 1`,
          );
          return false;
        }
        await transaction.run(
          `INSERT INTO meshcore_io_ingress(digest, topic, payload, received_at_ms, expires_at_ms)
           VALUES ($1, $2, $3, $4, $5)`,
          key,
          mqttTopic,
          bytes,
          receivedAt,
          ingressExpiresAt,
        );
        return true;
      },
    );
    await enqueue(
      digest,
      topic,
      payload,
      now,
      now + this.config.ingressDedupMs,
      now + INGRESS_RETENTION_MS,
      Math.max(10_000, this.config.maxQueuedUploads * 20),
    );
  }

  private async runIngressLoop(): Promise<void> {
    await this.ready;
    while (!this.stopped) {
      let row: IngressRow | undefined;
      try {
        row = await this.claimIngress();
        if (!row) {
          await delay(POLL_MS, this.shutdownController.signal);
          continue;
        }
        await this.processIngress(row);
        await this.database.run(
          "DELETE FROM meshcore_io_ingress WHERE id = $1 AND processing",
          row.id,
        );
      } catch (error) {
        if (row) {
          await this.database
            .run(
              `UPDATE meshcore_io_ingress SET processing = false
                WHERE id = $1 AND processing`,
              row.id,
            )
            .catch(() => undefined);
        }
        this.recordError("Lokalt inflöde misslyckades", error);
        await delay(1_000, this.shutdownController.signal);
      }
    }
  }

  private async claimIngress(): Promise<IngressRow | undefined> {
    const claim = this.database.transaction(
      async (transaction, now: number) => {
        const row = await transaction.get<IngressRow>(
          `SELECT id, topic, payload, received_at_ms FROM meshcore_io_ingress
           WHERE NOT processing AND expires_at_ms > $1
          ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
          now,
        );
        if (!row) return undefined;
        const result = await transaction.run(
          `UPDATE meshcore_io_ingress SET processing = true
           WHERE id = $1 AND NOT processing`,
          row.id,
        );
        return result.rowCount === 1 ? row : undefined;
      },
    );
    return claim(this.now());
  }

  private async processIngress(row: IngressRow): Promise<void> {
    const payload = Buffer.from(row.payload);
    const type = getMeshcoreIoTopicType(row.topic);
    if (type === "status") {
      await this.rememberObserverStatus(
        row.topic,
        payload,
        Number(row.received_at_ms),
      );
      return;
    }
    if (type !== "packets") return;
    const candidate = buildMeshcoreIoPacketCandidate(row.topic, payload, type);
    if (!candidate) return this.incrementInvalidStat();
    let packet: Packet;
    let advert: Advert;
    try {
      packet = Packet.fromBytes(candidate.rawPacket);
      if (packet.payload_type_string !== "ADVERT") return;
      advert = Advert.fromBytes(packet.payload);
    } catch {
      return this.incrementInvalidStat();
    }
    const advertType = advert.parsed.type?.toUpperCase() ?? "UNKNOWN";
    if (!MESHCORE_IO_UPLOADABLE_ADVERT_TYPES.has(advertType)) return;
    if (!(await advert.isVerified())) return this.incrementInvalidStat();
    const observerRow = await this.database.get<{ state_json: string }>(
      `SELECT state_json FROM meshcore_io_observer_radio
        WHERE observer_id = $1 AND expires_at_ms > $2`,
      candidate.observerId,
      this.now(),
    );
    const observer = parseObserverRadioState(observerRow?.state_json ?? null);
    const params = buildMeshcoreIoUploadParams(observer?.params ?? {});
    if (!hasValidMeshcoreIoParams(params)) return this.incrementInvalidStat();
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
    await this.admitJob(job);
  }

  private async rememberObserverStatus(
    topic: string,
    payload: Buffer,
    receivedAt: number,
  ): Promise<void> {
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
    await this.database.run(
      `INSERT INTO meshcore_io_observer_radio(observer_id, state_json, updated_at_ms, expires_at_ms)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(observer_id) DO UPDATE SET
         state_json = excluded.state_json, updated_at_ms = excluded.updated_at_ms,
         expires_at_ms = excluded.expires_at_ms
       WHERE excluded.updated_at_ms > meshcore_io_observer_radio.updated_at_ms`,
      observerId,
      JSON.stringify(state),
      receivedAt,
      receivedAt + MESHCORE_IO_OBSERVER_TTL_MS,
    );
  }

  private async admitJob(job: MeshcoreIoUploadJob): Promise<void> {
    const admit = this.database.transaction(
      async (transaction, value: MeshcoreIoUploadJob, now: number) => {
        const state = await transaction.get<{
          cooldown_until_ms: number | null;
          accepted_advert_timestamp: number | null;
          accepted_expires_at_ms: number | null;
        }>(
          `SELECT cooldown_until_ms, accepted_advert_timestamp, accepted_expires_at_ms
           FROM meshcore_io_node_state WHERE node_public_key = $1`,
          value.nodePublicKey,
        );
        if (
          state?.accepted_expires_at_ms &&
          Number(state.accepted_expires_at_ms) > now &&
          state.accepted_advert_timestamp !== null
        ) {
          const previous = Number(state.accepted_advert_timestamp);
          if (previous >= value.advertTimestamp) return false;
          if (
            value.advertTimestamp <
            previous + this.config.minReuploadIntervalSeconds
          ) {
            return false;
          }
        }
        if (state?.cooldown_until_ms && Number(state.cooldown_until_ms) > now) {
          return false;
        }
        const existing = await transaction.get<{ found: number }>(
          `SELECT 1 AS found FROM meshcore_io_jobs
           WHERE node_public_key = $1 AND status IN ('pending', 'processing', 'retry') LIMIT 1`,
          value.nodePublicKey,
        );
        if (existing) return false;
        const count = (await transaction.get(
          `SELECT COUNT(*) AS count FROM meshcore_io_jobs
           WHERE status IN ('pending', 'processing', 'retry')`,
        )) as { count: number };
        if (Number(count.count) >= this.config.maxQueuedUploads) {
          await transaction.run(
            "UPDATE meshcore_io_stats SET dropped = dropped + 1 WHERE singleton = 1",
          );
          return false;
        }
        await transaction.run(
          `INSERT INTO meshcore_io_jobs(
             request_id, deduplication_key, node_public_key, job_json, status,
             created_at_ms, next_attempt_at_ms, attempt_count
            ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, 0)`,
          value.requestId,
          value.advertKey,
          value.nodePublicKey,
          JSON.stringify(value),
          now,
          now,
        );
        await transaction.run(
          `INSERT INTO meshcore_io_node_state(node_public_key, cooldown_until_ms)
           VALUES ($1, $2)
           ON CONFLICT(node_public_key) DO UPDATE SET cooldown_until_ms = excluded.cooldown_until_ms`,
          value.nodePublicKey,
          now + MESHCORE_IO_VALID_ADVERT_COOLDOWN_MS,
        );
        await transaction.run(
          "UPDATE meshcore_io_stats SET enqueued = enqueued + 1 WHERE singleton = 1",
        );
        return true;
      },
    );
    await admit(job, this.now());
  }

  private async runWorkerLoop(): Promise<void> {
    await this.ready;
    while (!this.stopped) {
      let claimed: JobRow | undefined;
      try {
        claimed = await this.claimJob();
        if (!claimed) {
          await delay(POLL_MS, this.shutdownController.signal);
          continue;
        }
        await this.processJob(claimed);
      } catch (error) {
        this.recordError("Lokal uppladdningsarbetare misslyckades", error);
        if (claimed && !this.stopped) {
          await this.recoverClaim(claimed, error).catch((recoveryError) => {
            this.recordError(
              "Kunde inte återställa ett avbrutet köjobb",
              recoveryError,
            );
          });
        }
        await delay(1_000, this.shutdownController.signal);
      }
    }
  }

  private async claimJob(): Promise<JobRow | undefined> {
    const claim = this.database.transaction(
      async (transaction, now: number) => {
        const row = await transaction.get<JobRow>(
          `SELECT id, job_json, attempt_count FROM meshcore_io_jobs
          WHERE status IN ('pending', 'retry') AND next_attempt_at_ms <= $1
          ORDER BY next_attempt_at_ms ASC, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
          now,
        );
        if (!row) return undefined;
        const result = await transaction.run(
          `UPDATE meshcore_io_jobs SET status = 'processing',
          processing_started_at_ms = $1, attempt_count = attempt_count + 1
          WHERE id = $2 AND status IN ('pending', 'retry')`,
          now,
          row.id,
        );
        return result.rowCount === 1
          ? { ...row, attempt_count: Number(row.attempt_count) + 1 }
          : undefined;
      },
    );
    return claim(this.now());
  }

  private async processJob(row: JobRow): Promise<void> {
    const job = parseMeshcoreIoUploadJob(row.job_json);
    if (!job) {
      await this.finishDropped(row.id, undefined, "Ogiltigt köjobb");
      return;
    }
    if (row.attempt_count > Math.max(1, job.retriesAllowed)) {
      await this.finishDropped(
        row.id,
        job,
        "Maximalt antal uppladdningsförsök uppnått före omstart",
      );
      return;
    }
    this.activeUploads += 1;
    try {
      const result = await this.poster.post(
        job,
        this.shutdownController.signal,
      );
      if (this.stopped) return;
      if (result.status === "handled") {
        await this.finishCompleted(row.id, job, result.responseFromMeshcoreIO);
        this.uploadsSucceeded += 1;
        this.lastUploadAt = this.now();
        this.lastError = undefined;
      } else if (row.attempt_count < Math.max(1, job.retriesAllowed)) {
        await this.scheduleRetry(row.id, result.error);
      } else {
        const reason = formatMeshcoreIoError(result.error).slice(0, 500);
        await this.finishDropped(row.id, job, reason);
        this.uploadsFailed += 1;
        this.lastError = reason;
      }
    } catch (error) {
      if (!this.stopped) {
        await this.recoverClaim(row, error);
      }
      throw error;
    } finally {
      this.activeUploads = Math.max(0, this.activeUploads - 1);
    }
  }

  private async recoverClaim(row: JobRow, error: unknown): Promise<void> {
    const job = parseMeshcoreIoUploadJob(row.job_json);
    const reason = formatMeshcoreIoError(error).slice(0, 500);
    if (job && row.attempt_count < Math.max(1, job.retriesAllowed)) {
      await this.scheduleRetry(row.id, error);
      return;
    }
    await this.finishDropped(row.id, job, reason);
    this.uploadsFailed += 1;
    this.lastError = reason;
  }

  private async scheduleRetry(id: number, error: unknown): Promise<void> {
    const retry = this.database.transaction(
      async (
        transaction,
        jobId: number,
        nextAttemptAt: number,
        reason: string,
      ) => {
        const result = await transaction.run(
          `UPDATE meshcore_io_jobs SET status = 'retry', next_attempt_at_ms = $1,
           processing_started_at_ms = NULL, last_error = $2
           WHERE id = $3 AND status = 'processing'`,
          nextAttemptAt,
          reason,
          jobId,
        );
        if (result.rowCount === 1) {
          await transaction.run(
            `UPDATE meshcore_io_stats SET retries = retries + 1
             WHERE singleton = 1`,
          );
        }
      },
    );
    await retry(
      id,
      this.now() + this.config.retryDelayMs,
      formatMeshcoreIoError(error).slice(0, 500),
    );
  }

  private async finishCompleted(
    id: number,
    job: MeshcoreIoUploadJob,
    response?: string,
  ): Promise<void> {
    const now = this.now();
    const history: MeshcoreIoHistoryEntry = {
      at: now,
      status: "uploaded",
      requestId: job.requestId,
      nodeName: job.nodeName,
      nodePublicKey: job.nodePublicKey,
      advertType: job.advertType,
      observerName: job.observerName,
      workerInstanceId: this.instanceId,
      detail: response?.slice(0, 1_000),
    };
    const mapAdvert: MeshcoreIoMapAdvert | undefined =
      isNodesInsertedResponse(response) &&
      job.latitude !== undefined &&
      job.longitude !== undefined
        ? {
            at: now,
            requestId: job.requestId,
            nodeName: job.nodeName,
            nodePublicKey: job.nodePublicKey,
            advertType: job.advertType,
            observerName: job.observerName,
            workerInstanceId: this.instanceId,
            latitude: job.latitude,
            longitude: job.longitude,
          }
        : undefined;
    const finish = this.database.transaction(async (transaction) => {
      const updated = await transaction.run(
        `UPDATE meshcore_io_jobs SET status = 'completed', completed_at_ms = $1,
         processing_started_at_ms = NULL, last_error = NULL
          WHERE id = $2 AND status = 'processing'`,
        now,
        id,
      );
      if (updated.rowCount !== 1) return;
      await transaction.run(
        `INSERT INTO meshcore_io_node_state(
           node_public_key, cooldown_until_ms, accepted_advert_timestamp, accepted_expires_at_ms
          ) VALUES ($1, NULL, $2, $3)
         ON CONFLICT(node_public_key) DO UPDATE SET
           cooldown_until_ms = NULL,
           accepted_advert_timestamp = excluded.accepted_advert_timestamp,
           accepted_expires_at_ms = excluded.accepted_expires_at_ms`,
        job.nodePublicKey,
        job.advertTimestamp,
        now + MESHCORE_IO_SEEN_ADVERT_TTL_SECONDS * 1_000,
      );
      await transaction.run(
        "UPDATE meshcore_io_stats SET uploaded = uploaded + 1 WHERE singleton = 1",
      );
      await this.insertHistory(transaction, history);
      if (mapAdvert) {
        await transaction.run(
          `INSERT INTO meshcore_io_map(node_public_key, advert_json, at_ms)
           VALUES ($1, $2, $3)
           ON CONFLICT(node_public_key) DO UPDATE SET
             advert_json = excluded.advert_json, at_ms = excluded.at_ms`,
          job.nodePublicKey,
          JSON.stringify(mapAdvert),
          now,
        );
      }
      await this.cleanupHistory(transaction, now);
    });
    await finish();
  }

  private async finishDropped(
    id: number,
    job: MeshcoreIoUploadJob | undefined,
    reason: string,
  ): Promise<void> {
    const now = this.now();
    const finish = this.database.transaction(async (transaction) => {
      const updated = await transaction.run(
        `UPDATE meshcore_io_jobs SET status = 'dropped', completed_at_ms = $1,
         processing_started_at_ms = NULL, last_error = $2
         WHERE id = $3 AND status = 'processing'`,
        now,
        reason,
        id,
      );
      if (updated.rowCount !== 1) return;
      await transaction.run(
        "UPDATE meshcore_io_stats SET dropped = dropped + 1 WHERE singleton = 1",
      );
      if (job) {
        await this.insertHistory(transaction, {
          at: now,
          status: "dropped",
          requestId: job.requestId,
          nodeName: job.nodeName,
          nodePublicKey: job.nodePublicKey,
          advertType: job.advertType,
          observerName: job.observerName,
          workerInstanceId: this.instanceId,
          detail: reason,
        });
      }
      await this.cleanupHistory(transaction, now);
    });
    await finish();
  }

  private async insertHistory(
    transaction: Transaction,
    entry: MeshcoreIoHistoryEntry,
  ): Promise<void> {
    await transaction.run(
      `INSERT INTO meshcore_io_history(
         at_ms, status, request_id, node_name, node_public_key,
         advert_type, observer_name, worker_instance_id, detail
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      entry.at,
      entry.status,
      entry.requestId,
      entry.nodeName,
      entry.nodePublicKey,
      entry.advertType,
      entry.observerName ?? null,
      entry.workerInstanceId,
      entry.detail ?? null,
    );
  }

  private async cleanupHistory(
    transaction: Transaction,
    now: number,
  ): Promise<void> {
    await transaction.run(
      `DELETE FROM meshcore_io_history WHERE id IN (
          SELECT id FROM meshcore_io_history ORDER BY at_ms DESC, id DESC
           LIMIT 500 OFFSET $1
        )`,
      HISTORY_LIMIT,
    );
    await transaction.run(
      `DELETE FROM meshcore_io_jobs WHERE id IN (
          SELECT id FROM meshcore_io_jobs WHERE status IN ('completed', 'dropped')
           ORDER BY completed_at_ms DESC, id DESC LIMIT 500 OFFSET $1
        )`,
      TERMINAL_JOB_LIMIT,
    );
    await transaction.run(
      `DELETE FROM meshcore_io_map WHERE node_public_key IN (
         SELECT node_public_key FROM meshcore_io_map
          WHERE at_ms <= $1 ORDER BY at_ms ASC, node_public_key ASC LIMIT 500
       )`,
      now - MAP_HISTORY_MS,
    );
    await transaction.run(
      `DELETE FROM meshcore_io_observer_radio WHERE observer_id IN (
         SELECT observer_id FROM meshcore_io_observer_radio
          WHERE expires_at_ms <= $1 ORDER BY expires_at_ms ASC LIMIT 100
       )`,
      now,
    );
  }

  private async incrementInvalidStat(): Promise<void> {
    await this.database.run(
      "UPDATE meshcore_io_stats SET invalid = invalid + 1 WHERE singleton = 1",
    );
  }

  private recordError(context: string, error: unknown): void {
    const message = `${context}: ${formatMeshcoreIoError(error)}`.slice(0, 500);
    this.lastError = message;
    log.error(message);
    const write = this.database
      .run(
        `UPDATE meshcore_io_stats SET last_error = $1, last_error_at_ms = $2
         WHERE singleton = 1`,
        message,
        this.now(),
      )
      .catch(() => undefined);
    this.backgroundWrites.add(write);
    void write.finally(() => this.backgroundWrites.delete(write));
  }
}

export function createMeshcoreIoRuntime(
  config: MeshcoreIoConfig,
  options: { instanceId: string; database: ApplicationDatabase },
  dependencies: MeshcoreIoRuntimeDependencies = {},
): MeshcoreIoRuntime {
  return config.enabled
    ? new LocalMeshcoreIoRuntime(
        config,
        options.instanceId,
        options.database,
        dependencies,
      )
    : new DisabledMeshcoreIoRuntime(config, options.instanceId);
}
