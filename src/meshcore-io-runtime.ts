import { createHash, randomUUID } from "node:crypto";
import { Advert, BufferUtils, Packet } from "@liamcottle/meshcore.js";
import { Redis, type RedisOptions } from "ioredis";
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
  parseMeshcoreIoIngressMessage,
  parseMeshcoreIoJson,
  parseMeshcoreIoUploadJob,
  parseMeshcoreIoRadioParams,
  parseObserverRadioState,
  readMeshcoreIoObserverId,
  sanitizeMeshcoreIoText,
} from "./meshcore-io-utils.js";

const log = getModuleLogger("MeshCoreIO");
const INGRESS_GROUP = "producer";
const QUEUE_GROUP = "uploaders";
const WORKER_STATUS_TTL_MS = 90_000;
const NODE_QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAP_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 100;
const LOOP_ERROR_BACKOFF_MS = 1_000;
const WORKER_POLL_MS = 250;

interface RedisStreamEntry {
  id: string;
  fields: Record<string, string>;
}

interface LeaderValue {
  instanceId: string;
  token: string;
}

export interface MeshcoreIoRuntimeDependencies {
  redis?: Redis;
  fetch?: typeof fetch;
  now?: () => number;
  randomId?: () => string;
  poster?: MeshcoreIoPoster;
}

export interface MeshcoreIoRuntime {
  ready: Promise<void>;
  offerPublish(topic: string, payload: Buffer): void;
  getDashboardSnapshot(): Promise<MeshcoreIoDashboardSnapshot>;
  getLocalWorkerStatus(): MeshcoreIoWorkerStatus;
  stop(): Promise<void>;
}

function normalizeNamespace(namespace: string): string {
  return (
    namespace
      .trim()
      .replace(/[^A-Za-z0-9:_-]/g, "-")
      .replace(/:+$/g, "") || "meshcore-mqtt-broker"
  );
}

function redisOptions(): RedisOptions {
  return {
    connectTimeout: 5_000,
    commandTimeout: 5_000,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 250, 5_000),
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function parseFields(values: unknown): Record<string, string> {
  if (!Array.isArray(values)) return {};
  const fields: Record<string, string> = {};
  for (let index = 0; index + 1 < values.length; index += 2) {
    fields[String(values[index])] = String(values[index + 1]);
  }
  return fields;
}

function parseEntryList(values: unknown): RedisStreamEntry[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) return [];
    return [{ id: String(entry[0]), fields: parseFields(entry[1]) }];
  });
}

function parseXReadResult(value: unknown): RedisStreamEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((stream) => {
    if (!Array.isArray(stream) || stream.length < 2) return [];
    return parseEntryList(stream[1]);
  });
}

function parseXAutoClaimResult(value: unknown): RedisStreamEntry[] {
  if (!Array.isArray(value) || value.length < 2) return [];
  return parseEntryList(value[1]);
}

function safeJsonParse<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function numberFromHash(values: Record<string, string>, key: string): number {
  const value = Number(values[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function relevantTopic(topic: string): boolean {
  const type = getMeshcoreIoTopicType(topic);
  return type === "status" || type === "raw" || type === "packets";
}

function advertCoordinates(
  advert: Advert,
): { latitude: number; longitude: number } | undefined {
  if (advert.parsed.lat === null || advert.parsed.lon === null) {
    return undefined;
  }

  const latitude = advert.parsed.lat / 1_000_000;
  const longitude = advert.parsed.lon / 1_000_000;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }

  return { latitude, longitude };
}

function isNodesInsertedResponse(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { code?: unknown }).code === "NODES_INSERTED"
    );
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
    return Promise.resolve({
      enabled: false,
      producer: {
        respondingBrokerIsProducer: false,
        leaseRemainingMs: 0,
        status: "disabled",
      },
      queue: {
        ingressPending: 0,
        queued: 0,
        active: 0,
        total: 0,
        maxQueuedUploads: this.config.maxQueuedUploads,
      },
      totals: {
        enqueued: 0,
        uploaded: 0,
        dropped: 0,
        invalid: 0,
        retries: 0,
      },
      workers: [],
      history: [],
      map: { advertsLast7Days: [] },
    });
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

export class DistributedMeshcoreIoRuntime implements MeshcoreIoRuntime {
  readonly ready: Promise<void>;
  private readonly redis: Redis;
  private readonly ownsRedis: boolean;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly poster: MeshcoreIoPoster;
  private readonly prefix: string;
  private readonly ingressStream: string;
  private readonly queueStream: string;
  private readonly statsKey: string;
  private readonly historyKey: string;
  private readonly mapAdvertsKey: string;
  private readonly mapIndexKey: string;
  private readonly leaderKey: string;
  private readonly lastErrorKey: string;
  private readonly leaderValue: LeaderValue;
  private readonly leaderJson: string;
  private readonly workerConsumerIds: string[];
  private readonly activeEntryIds = new Set<string>();
  private readonly shutdownController = new AbortController();
  private readonly loops: Promise<void>[] = [];
  private workerStatusTimer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private producer = false;
  private activeUploads = 0;
  private uploadsSucceeded = 0;
  private uploadsFailed = 0;
  private lastUploadAt: number | undefined;
  private lastError: string | undefined;

  constructor(
    private readonly config: MeshcoreIoConfig,
    private readonly instanceId: string,
    kvUrl: string,
    namespace: string,
    dependencies: MeshcoreIoRuntimeDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.randomId = dependencies.randomId ?? randomUUID;
    this.ownsRedis = dependencies.redis === undefined;
    this.redis = dependencies.redis ?? new Redis(kvUrl, redisOptions());
    this.poster =
      dependencies.poster ??
      new MeshcoreIoPoster(config, { fetch: dependencies.fetch });
    this.prefix = `${normalizeNamespace(namespace)}:meshcoreio`;
    this.ingressStream = `${this.prefix}:ingress`;
    this.queueStream = `${this.prefix}:queue`;
    this.statsKey = `${this.prefix}:stats`;
    this.historyKey = `${this.prefix}:history`;
    this.mapAdvertsKey = `${this.prefix}:map:adverts`;
    this.mapIndexKey = `${this.prefix}:map:index`;
    this.leaderKey = `${this.prefix}:producer:leader`;
    this.lastErrorKey = `${this.prefix}:last-error`;
    this.leaderValue = { instanceId, token: this.randomId() };
    this.leaderJson = JSON.stringify(this.leaderValue);
    this.workerConsumerIds = Array.from(
      { length: config.workersPerBroker },
      (_, index) => `${instanceId}:${index + 1}:${this.randomId()}`,
    );

    this.redis.on("error", (error: Error) => {
      this.recordLocalError(`Valkey: ${error.message}`);
    });

    this.ready = this.initialize();
  }

  offerPublish(topic: string, payload: Buffer): void {
    if (!this.config.enabled || this.stopped || !relevantTopic(topic)) {
      return;
    }

    void this.enqueueIngress(topic, payload).catch((error) => {
      this.recordError(
        "Kunde inte skriva MQTT-meddelande till inflödeskön",
        error,
      );
    });
  }

  getLocalWorkerStatus(): MeshcoreIoWorkerStatus {
    return {
      instanceId: this.instanceId,
      configuredWorkers: this.config.enabled ? this.config.workersPerBroker : 0,
      activeUploads: this.activeUploads,
      uploadsSucceeded: this.uploadsSucceeded,
      uploadsFailed: this.uploadsFailed,
      lastUploadAt: this.lastUploadAt,
      lastError: this.lastError,
      updatedAt: this.now(),
    };
  }

  async getDashboardSnapshot(): Promise<MeshcoreIoDashboardSnapshot> {
    if (!this.config.enabled) {
      return {
        enabled: false,
        producer: {
          respondingBrokerIsProducer: false,
          leaseRemainingMs: 0,
          status: "disabled",
        },
        queue: {
          ingressPending: 0,
          queued: 0,
          active: 0,
          total: 0,
          maxQueuedUploads: this.config.maxQueuedUploads,
        },
        totals: {
          enqueued: 0,
          uploaded: 0,
          dropped: 0,
          invalid: 0,
          retries: 0,
        },
        workers: [],
        history: [],
        map: { advertsLast7Days: [] },
      };
    }

    const [
      leaderRaw,
      leaseRaw,
      ingressLengthRaw,
      queueLengthRaw,
      pendingRaw,
      stats,
      workers,
      historyRaw,
      mapAdverts,
      lastErrorRaw,
    ] = await Promise.all([
      this.redis.get(this.leaderKey),
      this.redis.pttl(this.leaderKey),
      this.redis.xlen(this.ingressStream),
      this.redis.xlen(this.queueStream),
      this.redis.xpending(this.queueStream, QUEUE_GROUP),
      this.redis.hgetall(this.statsKey),
      this.listWorkerStatuses(),
      this.redis.lrange(this.historyKey, 0, 49),
      this.listMapAdverts(),
      this.redis.get(this.lastErrorKey),
    ]);

    const leader = safeJsonParse<LeaderValue>(leaderRaw);
    const leaseRemainingMs = Math.max(0, Number(leaseRaw));
    const queueTotal = Math.max(0, Number(queueLengthRaw));
    const pending = Array.isArray(pendingRaw)
      ? Math.max(0, Number(pendingRaw[0]))
      : 0;
    const lastError = safeJsonParse<{ message?: string }>(
      lastErrorRaw,
    )?.message;

    return {
      enabled: true,
      producer: {
        instanceId: leader?.instanceId,
        respondingBrokerIsProducer: leader?.token === this.leaderValue.token,
        leaseRemainingMs,
        status:
          !leader || leaseRemainingMs <= 0
            ? "electing"
            : leaseRemainingMs < this.config.producerPollMs
              ? "stale"
              : "healthy",
      },
      queue: {
        ingressPending: Math.max(0, Number(ingressLengthRaw)),
        queued: Math.max(0, queueTotal - pending),
        active: pending,
        total: queueTotal,
        maxQueuedUploads: this.config.maxQueuedUploads,
      },
      totals: {
        enqueued: numberFromHash(stats, "enqueued"),
        uploaded: numberFromHash(stats, "uploaded"),
        dropped: numberFromHash(stats, "dropped"),
        invalid: numberFromHash(stats, "invalid"),
        retries: numberFromHash(stats, "retries"),
      },
      workers,
      history: historyRaw.flatMap((entry) => {
        const parsed = safeJsonParse<MeshcoreIoHistoryEntry>(entry);
        return parsed ? [parsed] : [];
      }),
      map: { advertsLast7Days: mapAdverts },
      lastError,
    };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const activeEntryIds = [...this.activeEntryIds];
    this.shutdownController.abort(new Error("Brokerinstansen stängs ned"));
    if (this.workerStatusTimer) {
      clearInterval(this.workerStatusTimer);
      this.workerStatusTimer = undefined;
    }

    await this.releaseProducerLease().catch(() => undefined);
    await Promise.allSettled(this.loops);
    await this.markClaimsStale(activeEntryIds).catch(() => undefined);
    await this.redis.del(this.workerStatusKey()).catch(() => undefined);
    if (this.ownsRedis) {
      this.redis.disconnect(false);
    }
  }

  private async initialize(): Promise<void> {
    if (!this.config.enabled) {
      log.info("Integration: Meshcore.io är avstängd");
      return;
    }

    await Promise.all([
      this.ensureGroup(this.ingressStream, INGRESS_GROUP),
      this.ensureGroup(this.queueStream, QUEUE_GROUP),
    ]);
    await this.writeWorkerStatus();
    this.workerStatusTimer = setInterval(() => {
      void this.writeWorkerStatus().catch((error) => {
        this.recordError("Kunde inte uppdatera workerstatus", error);
      });
    }, 10_000);
    this.workerStatusTimer.unref?.();

    this.loops.push(this.runProducerLoop());
    for (const consumerId of this.workerConsumerIds) {
      this.loops.push(this.runWorkerLoop(consumerId));
    }

    log.info(
      `Integration: aktiverad, ${this.config.workersPerBroker} uppladdningsarbetare på ${this.instanceId}, delad kö ${this.queueStream}`,
    );
  }

  private async ensureGroup(stream: string, group: string): Promise<void> {
    try {
      await this.redis.xgroup("CREATE", stream, group, "0", "MKSTREAM");
    } catch (error) {
      if (!/BUSYGROUP/i.test(formatMeshcoreIoError(error))) {
        throw error;
      }
    }
  }

  private async enqueueIngress(topic: string, payload: Buffer): Promise<void> {
    await this.ready;
    if (this.stopped) return;
    const digest = createHash("sha256")
      .update(topic)
      .update("\0")
      .update(payload)
      .digest("hex");
    const dedupKey = `${this.prefix}:ingress:dedup:${digest}`;
    const maxIngressLength = Math.max(
      10_000,
      this.config.maxQueuedUploads * 20,
    );
    await this.redis.eval(
      `
        if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
        redis.call('SET', KEYS[1], '1', 'PX', ARGV[1])
        local serverTime = redis.call('TIME')
        local receivedAt = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
        redis.call('XADD', KEYS[2], 'MAXLEN', '~', ARGV[2], '*',
          'topic', ARGV[3], 'payload', ARGV[4], 'receivedAt', receivedAt)
        return 1
      `,
      2,
      dedupKey,
      this.ingressStream,
      this.config.ingressDedupMs,
      maxIngressLength,
      topic,
      payload.toString("base64"),
    );
  }

  private async runProducerLoop(): Promise<void> {
    await this.ready;
    while (!this.stopped) {
      try {
        await this.refreshProducerLease();
        if (this.producer) {
          const recovered = await this.claimStaleIngress();
          const entries =
            recovered.length > 0 ? recovered : await this.readNewIngress();
          for (const entry of entries) {
            if (this.stopped || !this.producer) break;
            await this.refreshProducerLease();
            if (!this.producer) break;
            await this.processIngressEntry(entry);
          }
          if (entries.length === 0) {
            await delay(
              this.config.producerPollMs,
              this.shutdownController.signal,
            );
          }
        } else {
          await delay(
            this.config.producerPollMs,
            this.shutdownController.signal,
          );
        }
      } catch (error) {
        this.producer = false;
        this.recordError("Köansvarig loop misslyckades", error);
        await delay(LOOP_ERROR_BACKOFF_MS, this.shutdownController.signal);
      }
    }
  }

  private async refreshProducerLease(): Promise<void> {
    if (this.producer) {
      const renewed = Number(
        await this.redis.eval(
          `if redis.call('GET', KEYS[1]) == ARGV[1] then
             return redis.call('PEXPIRE', KEYS[1], ARGV[2])
           end
           return 0`,
          1,
          this.leaderKey,
          this.leaderJson,
          this.config.producerLeaseMs,
        ),
      );
      if (renewed === 1) return;
      this.producer = false;
      log.warn("Köansvar: ledarlåset förlorades");
    }

    const acquired = await this.redis.set(
      this.leaderKey,
      this.leaderJson,
      "PX",
      this.config.producerLeaseMs,
      "NX",
    );
    if (acquired === "OK") {
      this.producer = true;
      log.info(`Köansvar: ${this.instanceId} tog över inflöde och köläggning`);
    }
  }

  private async claimStaleIngress(): Promise<RedisStreamEntry[]> {
    const result = await this.redis.xautoclaim(
      this.ingressStream,
      INGRESS_GROUP,
      this.leaderValue.token,
      this.config.producerLeaseMs,
      "0-0",
      "COUNT",
      20,
    );
    return parseXAutoClaimResult(result);
  }

  private async readNewIngress(): Promise<RedisStreamEntry[]> {
    const result = await this.redis.xreadgroup(
      "GROUP",
      INGRESS_GROUP,
      this.leaderValue.token,
      "COUNT",
      20,
      "STREAMS",
      this.ingressStream,
      ">",
    );
    return parseXReadResult(result);
  }

  private async processIngressEntry(entry: RedisStreamEntry): Promise<void> {
    const message = parseMeshcoreIoIngressMessage(entry.fields);
    if (!message) {
      await this.incrementStat("invalid");
      await this.ackAndDelete(this.ingressStream, INGRESS_GROUP, entry.id);
      return;
    }

    try {
      await this.processIngressMessage(
        message.topic,
        Buffer.from(message.payloadBase64, "base64"),
        message.receivedAt,
      );
      await this.ackAndDelete(this.ingressStream, INGRESS_GROUP, entry.id);
    } catch (error) {
      this.recordError(`Kunde inte behandla inflödespost ${entry.id}`, error);
      throw error;
    }
  }

  private async processIngressMessage(
    topic: string,
    payload: Buffer,
    receivedAt: number,
  ): Promise<void> {
    const type = getMeshcoreIoTopicType(topic);
    if (type === "status") {
      await this.rememberObserverStatus(topic, payload, receivedAt);
      return;
    }
    if (type !== "raw" && type !== "packets") return;

    const candidate = buildMeshcoreIoPacketCandidate(topic, payload, type);
    if (!candidate) {
      await this.incrementStat("invalid");
      return;
    }

    let packet: Packet;
    try {
      packet = Packet.fromBytes(candidate.rawPacket);
    } catch {
      await this.incrementStat("invalid");
      return;
    }
    if (packet.payload_type_string !== "ADVERT") return;

    let advert: Advert;
    try {
      advert = Advert.fromBytes(packet.payload);
    } catch {
      await this.incrementStat("invalid");
      return;
    }

    const advertType = advert.parsed.type?.toUpperCase() ?? "UNKNOWN";
    if (!MESHCORE_IO_UPLOADABLE_ADVERT_TYPES.has(advertType)) return;
    if (!(await advert.isVerified())) {
      await this.incrementStat("invalid");
      return;
    }

    const observer = parseObserverRadioState(
      await this.redis.get(this.observerStatusKey(candidate.observerId)),
    );
    const params = buildMeshcoreIoUploadParams(observer?.params ?? {});
    if (!hasValidMeshcoreIoParams(params)) {
      await this.incrementStat("invalid");
      return;
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

    const result = String(
      await this.redis.eval(
        `
          local previous = tonumber(redis.call('GET', KEYS[4]) or '')
          local advertTimestamp = tonumber(ARGV[2])
          local minInterval = tonumber(ARGV[3])
          if previous and previous >= advertTimestamp then return 'replay' end
          if previous and advertTimestamp < previous + minInterval then return 'interval' end
          if redis.call('EXISTS', KEYS[3]) == 1 then return 'cooldown' end
          if redis.call('EXISTS', KEYS[2]) == 1 then return 'queued' end
          if redis.call('XLEN', KEYS[1]) >= tonumber(ARGV[1]) then
            redis.call('HINCRBY', KEYS[5], 'dropped', 1)
            return 'full'
          end
          local streamId = redis.call('XADD', KEYS[1], '*', 'nodePublicKey', ARGV[7], 'job', ARGV[4])
          redis.call('SET', KEYS[2], streamId, 'PX', ARGV[5])
          redis.call('SET', KEYS[3], '1', 'PX', ARGV[6])
          redis.call('HINCRBY', KEYS[5], 'enqueued', 1)
          return streamId
        `,
        5,
        this.queueStream,
        this.nodeQueueKey(nodePublicKey),
        this.cooldownKey(nodePublicKey),
        this.seenAdvertKey(nodePublicKey),
        this.statsKey,
        this.config.maxQueuedUploads,
        advert.timestamp,
        this.config.minReuploadIntervalSeconds,
        JSON.stringify(job),
        NODE_QUEUE_TTL_MS,
        MESHCORE_IO_VALID_ADVERT_COOLDOWN_MS,
        nodePublicKey,
      ),
    );

    if (/^\d+-\d+$/.test(result)) {
      log.info(
        `Köansvar: lade ${nodeName} (${nodePublicKey.slice(0, 6)}) i delad kö från ${observer?.origin ?? candidate.observerId.slice(0, 6)}`,
      );
    }
  }

  private async rememberObserverStatus(
    topic: string,
    payload: Buffer,
    receivedAt: number,
  ): Promise<void> {
    const parsed = parseMeshcoreIoJson(payload);
    if (typeof parsed !== "object" || parsed === null) return;
    const data = parsed as Record<string, unknown>;
    const observerId = readMeshcoreIoObserverId(data, topic);
    if (!observerId) return;
    const params = parseMeshcoreIoRadioParams(data);
    if (
      hasCompleteMeshcoreIoParams(params) &&
      !hasValidMeshcoreIoParams(params)
    ) {
      return;
    }
    if (!hasValidMeshcoreIoParams(params)) return;

    const state: ObserverRadioState = {
      origin: sanitizeMeshcoreIoText(data.origin, 200),
      originId: observerId,
      params,
      updatedAt: receivedAt,
    };
    await this.redis.eval(
      `
        local previous = tonumber(redis.call('GET', KEYS[2]) or '')
        local receivedAt = tonumber(ARGV[2])
        if previous and previous >= receivedAt then return 0 end
        redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
        redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
        return 1
      `,
      2,
      this.observerStatusKey(observerId),
      this.observerStatusTimestampKey(observerId),
      JSON.stringify(state),
      receivedAt,
      MESHCORE_IO_OBSERVER_TTL_MS,
    );
  }

  private async runWorkerLoop(consumerId: string): Promise<void> {
    await this.ready;
    while (!this.stopped) {
      try {
        const recovered = await this.claimStaleQueueJob(consumerId);
        const entries =
          recovered.length > 0
            ? recovered
            : await this.readNewQueueJob(consumerId);
        for (const entry of entries) {
          if (this.stopped) break;
          await this.processQueueEntry(consumerId, entry);
        }
        if (entries.length === 0) {
          await delay(WORKER_POLL_MS, this.shutdownController.signal);
        }
      } catch (error) {
        this.recordError(
          `Uppladdningsarbetare ${consumerId} misslyckades`,
          error,
        );
        await delay(LOOP_ERROR_BACKOFF_MS, this.shutdownController.signal);
      }
    }
  }

  private async claimStaleQueueJob(
    consumerId: string,
  ): Promise<RedisStreamEntry[]> {
    const result = await this.redis.xautoclaim(
      this.queueStream,
      QUEUE_GROUP,
      consumerId,
      this.config.workerClaimTimeoutMs,
      "0-0",
      "COUNT",
      1,
    );
    return parseXAutoClaimResult(result);
  }

  private async readNewQueueJob(
    consumerId: string,
  ): Promise<RedisStreamEntry[]> {
    const result = await this.redis.xreadgroup(
      "GROUP",
      QUEUE_GROUP,
      consumerId,
      "COUNT",
      1,
      "STREAMS",
      this.queueStream,
      ">",
    );
    return parseXReadResult(result);
  }

  private async processQueueEntry(
    consumerId: string,
    entry: RedisStreamEntry,
  ): Promise<void> {
    const job = parseMeshcoreIoUploadJob(entry.fields.job);
    if (!job) {
      await this.incrementStat("invalid");
      await this.discardInvalidQueueEntry(entry);
      return;
    }

    this.activeEntryIds.add(entry.id);
    this.activeUploads += 1;
    await this.writeWorkerStatus();
    const renewalTimer = setInterval(
      () => {
        void this.redis
          .xclaim(
            this.queueStream,
            QUEUE_GROUP,
            consumerId,
            0,
            entry.id,
            "JUSTID",
          )
          .catch((error) => {
            this.recordError(`Kunde inte förnya jobbclaim ${entry.id}`, error);
          });
      },
      Math.max(1_000, Math.floor(this.config.workerClaimTimeoutMs / 3)),
    );
    renewalTimer.unref?.();

    try {
      let lastFailure: unknown;
      for (
        let attempt = 1;
        attempt <= Math.max(1, job.retriesAllowed);
        attempt += 1
      ) {
        const result = await this.poster.post(
          job,
          this.shutdownController.signal,
        );
        if (this.stopped) return;
        if (result.status === "handled") {
          const completed = await this.completeJob(
            entry.id,
            job,
            result.responseFromMeshcoreIO,
          );
          if (completed) {
            this.uploadsSucceeded += 1;
            this.lastUploadAt = this.now();
            this.lastError = undefined;
          }
          return;
        }

        lastFailure = result.error;
        if (attempt < Math.max(1, job.retriesAllowed)) {
          await this.incrementStat("retries");
          await delay(this.config.retryDelayMs, this.shutdownController.signal);
          if (this.stopped) return;
        }
      }

      const reason = formatMeshcoreIoError(lastFailure);
      const dropped = await this.dropJob(entry.id, job, reason);
      if (dropped) {
        this.uploadsFailed += 1;
        this.lastError = reason;
      }
    } finally {
      clearInterval(renewalTimer);
      this.activeEntryIds.delete(entry.id);
      this.activeUploads = Math.max(0, this.activeUploads - 1);
      await this.writeWorkerStatus().catch(() => undefined);
    }
  }

  private async completeJob(
    streamId: string,
    job: MeshcoreIoUploadJob,
    response?: string,
  ): Promise<boolean> {
    const history: MeshcoreIoHistoryEntry = {
      at: this.now(),
      status: "uploaded",
      requestId: job.requestId,
      nodeName: job.nodeName,
      nodePublicKey: job.nodePublicKey,
      advertType: job.advertType,
      observerName: job.observerName,
      workerInstanceId: this.instanceId,
      detail: response?.slice(0, 1_000),
    };
    const completedAt = this.now();
    const mapAdvert: MeshcoreIoMapAdvert | undefined =
      isNodesInsertedResponse(response) &&
      job.latitude !== undefined &&
      job.longitude !== undefined
        ? {
            at: completedAt,
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
    const completed = Number(
      await this.redis.eval(
        `
        local acknowledged = redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
        if acknowledged ~= 1 then return 0 end
        redis.call('XDEL', KEYS[1], ARGV[2])
        redis.call('DEL', KEYS[2])
        redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[4])
        redis.call('HINCRBY', KEYS[4], 'uploaded', 1)
        redis.call('LPUSH', KEYS[5], ARGV[5])
        redis.call('LTRIM', KEYS[5], 0, ARGV[6])
        if ARGV[7] ~= '' then
          redis.call('HSET', KEYS[6], ARGV[8], ARGV[7])
          redis.call('ZADD', KEYS[7], ARGV[9], ARGV[8])
          local expired = redis.call('ZRANGEBYSCORE', KEYS[7], '-inf', ARGV[10])
          for _, member in ipairs(expired) do
            redis.call('HDEL', KEYS[6], member)
          end
          redis.call('ZREMRANGEBYSCORE', KEYS[7], '-inf', ARGV[10])
        end
        return 1
      `,
        7,
        this.queueStream,
        this.nodeQueueKey(job.nodePublicKey),
        this.seenAdvertKey(job.nodePublicKey),
        this.statsKey,
        this.historyKey,
        this.mapAdvertsKey,
        this.mapIndexKey,
        QUEUE_GROUP,
        streamId,
        job.advertTimestamp,
        MESHCORE_IO_SEEN_ADVERT_TTL_SECONDS,
        JSON.stringify(history),
        HISTORY_LIMIT - 1,
        mapAdvert ? JSON.stringify(mapAdvert) : "",
        job.nodePublicKey,
        completedAt,
        completedAt - MAP_HISTORY_MS,
      ),
    );
    return completed === 1;
  }

  private async dropJob(
    streamId: string,
    job: MeshcoreIoUploadJob,
    reason: string,
  ): Promise<boolean> {
    const history: MeshcoreIoHistoryEntry = {
      at: this.now(),
      status: "dropped",
      requestId: job.requestId,
      nodeName: job.nodeName,
      nodePublicKey: job.nodePublicKey,
      advertType: job.advertType,
      observerName: job.observerName,
      workerInstanceId: this.instanceId,
      detail: reason,
    };
    const dropped = Number(
      await this.redis.eval(
        `
        local acknowledged = redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
        if acknowledged ~= 1 then return 0 end
        redis.call('XDEL', KEYS[1], ARGV[2])
        redis.call('DEL', KEYS[2])
        redis.call('HINCRBY', KEYS[3], 'dropped', 1)
        redis.call('LPUSH', KEYS[4], ARGV[3])
        redis.call('LTRIM', KEYS[4], 0, ARGV[4])
        return 1
      `,
        4,
        this.queueStream,
        this.nodeQueueKey(job.nodePublicKey),
        this.statsKey,
        this.historyKey,
        QUEUE_GROUP,
        streamId,
        JSON.stringify(history),
        HISTORY_LIMIT - 1,
      ),
    );
    return dropped === 1;
  }

  private async incrementStat(field: string): Promise<void> {
    await this.redis.hincrby(this.statsKey, field, 1);
  }

  private async ackAndDelete(
    stream: string,
    group: string,
    id: string,
  ): Promise<void> {
    await this.redis.eval(
      `
        local acknowledged = redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
        if acknowledged == 1 then redis.call('XDEL', KEYS[1], ARGV[2]) end
        return acknowledged
      `,
      1,
      stream,
      group,
      id,
    );
  }

  private async discardInvalidQueueEntry(
    entry: RedisStreamEntry,
  ): Promise<void> {
    const publicKey = entry.fields.nodePublicKey?.toLowerCase();
    const queueKey =
      publicKey && /^[0-9a-f]{64}$/.test(publicKey)
        ? this.nodeQueueKey(publicKey)
        : `${this.prefix}:invalid-queue-entry`;
    await this.redis.eval(
      `
        local acknowledged = redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
        if acknowledged ~= 1 then return 0 end
        redis.call('XDEL', KEYS[1], ARGV[2])
        if ARGV[3] == '1' then redis.call('DEL', KEYS[2]) end
        return 1
      `,
      2,
      this.queueStream,
      queueKey,
      QUEUE_GROUP,
      entry.id,
      publicKey && /^[0-9a-f]{64}$/.test(publicKey) ? "1" : "0",
    );
  }

  private async writeWorkerStatus(): Promise<void> {
    if (!this.config.enabled) return;
    await this.redis.set(
      this.workerStatusKey(),
      JSON.stringify(this.getLocalWorkerStatus()),
      "PX",
      WORKER_STATUS_TTL_MS,
    );
  }

  private async listMapAdverts(): Promise<MeshcoreIoMapAdvert[]> {
    const nodeKeys = await this.redis.zrevrangebyscore(
      this.mapIndexKey,
      this.now(),
      this.now() - MAP_HISTORY_MS,
    );
    if (nodeKeys.length === 0) return [];

    const values = await this.redis.hmget(this.mapAdvertsKey, ...nodeKeys);
    return values.flatMap((value) => {
      const advert = safeJsonParse<MeshcoreIoMapAdvert>(value);
      if (
        !advert ||
        !Number.isFinite(advert.at) ||
        advert.at <= 0 ||
        typeof advert.requestId !== "string" ||
        advert.requestId.length === 0 ||
        typeof advert.nodeName !== "string" ||
        advert.nodeName.length === 0 ||
        typeof advert.nodePublicKey !== "string" ||
        !/^[0-9a-f]{64}$/.test(advert.nodePublicKey) ||
        typeof advert.advertType !== "string" ||
        !MESHCORE_IO_UPLOADABLE_ADVERT_TYPES.has(advert.advertType) ||
        (advert.observerName !== undefined &&
          typeof advert.observerName !== "string") ||
        typeof advert.workerInstanceId !== "string" ||
        advert.workerInstanceId.length === 0 ||
        !Number.isFinite(advert.latitude) ||
        advert.latitude < -90 ||
        advert.latitude > 90 ||
        !Number.isFinite(advert.longitude) ||
        advert.longitude < -180 ||
        advert.longitude > 180
      ) {
        return [];
      }
      return [advert];
    });
  }

  private async listWorkerStatuses(): Promise<MeshcoreIoWorkerStatus[]> {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, found] = await this.redis.scan(
        cursor,
        "MATCH",
        `${this.prefix}:workers:*`,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      keys.push(...found);
    } while (cursor !== "0");

    if (keys.length === 0) return [];
    const values = await this.redis.mget(...keys);
    return values
      .flatMap((value) => {
        const parsed = safeJsonParse<MeshcoreIoWorkerStatus>(value);
        return parsed ? [parsed] : [];
      })
      .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  }

  private recordLocalError(message: string): void {
    this.lastError = message.slice(0, 500);
    log.error(message);
  }

  private recordError(context: string, error: unknown): void {
    const message = `${context}: ${formatMeshcoreIoError(error)}`;
    this.recordLocalError(message);
    void this.redis
      .set(
        this.lastErrorKey,
        JSON.stringify({ at: this.now(), message }),
        "PX",
        24 * 60 * 60 * 1000,
      )
      .catch(() => undefined);
  }

  private async releaseProducerLease(): Promise<void> {
    if (!this.producer) return;
    await this.redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then
         return redis.call('DEL', KEYS[1])
       end
       return 0`,
      1,
      this.leaderKey,
      this.leaderJson,
    );
    this.producer = false;
  }

  private async markClaimsStale(entryIds: string[]): Promise<void> {
    for (const id of entryIds) {
      await this.redis.xclaim(
        this.queueStream,
        QUEUE_GROUP,
        `${this.instanceId}:shutdown`,
        0,
        id,
        "IDLE",
        this.config.workerClaimTimeoutMs,
        "JUSTID",
      );
    }
  }

  private observerStatusKey(observerId: string): string {
    return `${this.prefix}:observers:${observerId}:radio`;
  }

  private observerStatusTimestampKey(observerId: string): string {
    return `${this.prefix}:observers:${observerId}:radio-updated-at`;
  }

  private nodeQueueKey(publicKey: string): string {
    return `${this.prefix}:queued-nodes:${publicKey}`;
  }

  private cooldownKey(publicKey: string): string {
    return `${this.prefix}:cooldown:${publicKey}`;
  }

  private seenAdvertKey(publicKey: string): string {
    return `${this.prefix}:seen:${publicKey}`;
  }

  private workerStatusKey(): string {
    return `${this.prefix}:workers:${encodeURIComponent(this.instanceId)}`;
  }
}

export function createMeshcoreIoRuntime(
  config: MeshcoreIoConfig,
  options: {
    instanceId: string;
    kvUrl: string;
    namespace: string;
  },
  dependencies: MeshcoreIoRuntimeDependencies = {},
): MeshcoreIoRuntime {
  if (!config.enabled) {
    return new DisabledMeshcoreIoRuntime(config, options.instanceId);
  }

  return new DistributedMeshcoreIoRuntime(
    config,
    options.instanceId,
    options.kvUrl,
    options.namespace,
    dependencies,
  );
}
