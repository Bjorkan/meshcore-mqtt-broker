import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Advert, BufferUtils, Packet } from "@liamcottle/meshcore.js";
import { test } from "@jest/globals";

import { MeshcoreIoPoster } from "../dist/meshcore-io-poster.js";
import { createMeshcoreIoRuntime } from "../dist/meshcore-io-runtime.js";
import {
  buildMeshcoreIoPacketCandidate,
  buildMeshcoreIoUploadParams,
  getMeshcoreIoTopicType,
  hasValidMeshcoreIoParams,
  parseMeshcoreIoRadioParams,
  parseMeshcoreIoUploadJob,
} from "../dist/meshcore-io-utils.js";

const OBSERVER_KEY = "a".repeat(64);
const NODE_KEY = "b".repeat(64);

function u32le(value) {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value);
  return result;
}

function makeAdvertPacket({
  seed = Buffer.from("22".repeat(32), "hex"),
  timestamp = 1800000000,
  name = "SE-STO-TEST",
  type = 2,
} = {}) {
  const publicKey = Buffer.from(ed25519.getPublicKey(seed));
  const appData = Buffer.concat([
    Buffer.from([0x80 | type]),
    Buffer.from(name, "utf8"),
  ]);
  const signed = Buffer.concat([publicKey, u32le(timestamp), appData]);
  const signature = Buffer.from(ed25519.sign(signed, seed));
  const payload = Buffer.concat([
    publicKey,
    u32le(timestamp),
    signature,
    appData,
  ]);
  return Buffer.concat([Buffer.from([(0x04 << 2) | 0x01, 0x00]), payload]);
}

function config(overrides = {}) {
  return {
    enabled: true,
    apiUrl: "https://map.meshcore.io/api/v1/uploader/node",
    dryRun: false,
    minReuploadIntervalSeconds: 3600,
    requestTimeoutMs: 1000,
    workersPerBroker: 1,
    maxQueuedUploads: 250,
    retriesAllowed: 3,
    retryDelayMs: 10,
    producerLeaseMs: 100,
    producerPollMs: 10,
    ingressDedupMs: 1000,
    workerClaimTimeoutMs: 100,
    ...overrides,
  };
}

function uploadJob() {
  return {
    requestId: "request-1",
    retriesAllowed: 3,
    advertKey: `${NODE_KEY}:1234`,
    advertTimestamp: 1234,
    advertType: "REPEATER",
    nodeName: "Test repeater",
    nodePublicKey: NODE_KEY,
    rawPacketHex: "01020304",
    observerId: OBSERVER_KEY,
    observerName: "Test observer",
    radioParams: { freq: 869.525, bw: 125, sf: 11, cr: 5 },
    enqueuedAt: 1,
  };
}

class SharedRedisBackend {
  values = new Map();
  hashes = new Map();
  sortedSets = new Map();

  cleanup(key) {
    const entry = this.values.get(key);
    if (
      entry &&
      entry.expiresAt !== undefined &&
      entry.expiresAt <= Date.now()
    ) {
      this.values.delete(key);
      return undefined;
    }
    return entry;
  }
}

class FakeRedis extends EventEmitter {
  constructor(backend) {
    super();
    this.backend = backend;
  }

  async xgroup() {
    return "OK";
  }

  async set(key, value, ...args) {
    const nx = args.includes("NX");
    if (nx && this.backend.cleanup(key)) return null;
    const pxIndex = args.indexOf("PX");
    const expiresAt =
      pxIndex >= 0 ? Date.now() + Number(args[pxIndex + 1]) : undefined;
    this.backend.values.set(key, { value: String(value), expiresAt });
    return "OK";
  }

  async get(key) {
    return this.backend.cleanup(key)?.value ?? null;
  }

  async pttl(key) {
    const entry = this.backend.cleanup(key);
    if (!entry) return -2;
    if (entry.expiresAt === undefined) return -1;
    return Math.max(0, entry.expiresAt - Date.now());
  }

  async del(...keys) {
    let deleted = 0;
    for (const key of keys) {
      deleted += Number(this.backend.values.delete(key));
    }
    return deleted;
  }

  async eval(script, keyCount, ...values) {
    const keys = values.slice(0, keyCount);
    const args = values.slice(keyCount);
    if (script.includes("PEXPIRE")) {
      const entry = this.backend.cleanup(keys[0]);
      if (!entry || entry.value !== String(args[0])) return 0;
      entry.expiresAt = Date.now() + Number(args[1]);
      return 1;
    }
    if (script.includes("return redis.call('DEL'")) {
      const entry = this.backend.cleanup(keys[0]);
      if (!entry || entry.value !== String(args[0])) return 0;
      this.backend.values.delete(keys[0]);
      return 1;
    }
    throw new Error(`Unexpected Lua script in test: ${script.slice(0, 40)}`);
  }

  async xautoclaim() {
    return ["0-0", []];
  }

  async xreadgroup() {
    await new Promise((resolve) => setTimeout(resolve, 2));
    return null;
  }

  async xlen() {
    return 0;
  }

  async xpending() {
    return [0, null, null, []];
  }

  async hgetall() {
    return {};
  }

  async lrange() {
    return [];
  }

  async scan(_cursor, _match, pattern) {
    const prefix = String(pattern).replace(/\*+$/, "");
    const keys = [...this.backend.values.keys()].filter((key) => {
      this.backend.cleanup(key);
      return key.startsWith(prefix) && this.backend.values.has(key);
    });
    return ["0", keys];
  }

  async mget(...keys) {
    return Promise.all(keys.map((key) => this.get(key)));
  }

  async hmget(key, ...fields) {
    const hash = this.backend.hashes.get(key) ?? new Map();
    return fields.map((field) => hash.get(field) ?? null);
  }

  async zrevrangebyscore(key, max, min) {
    const sortedSet = this.backend.sortedSets.get(key) ?? new Map();
    return [...sortedSet.entries()]
      .filter(([, score]) => score <= Number(max) && score >= Number(min))
      .sort((a, b) => b[1] - a[1])
      .map(([member]) => member);
  }

  disconnect() {}
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

test("normalizes observer radio settings and extracts packet candidates", () => {
  const params = parseMeshcoreIoRadioParams({
    radio: "869525000,125000,11,5",
  });
  assert.deepEqual(params, { freq: 869.525, bw: 125, sf: 11, cr: 5 });
  assert.equal(
    hasValidMeshcoreIoParams(buildMeshcoreIoUploadParams(params)),
    true,
  );

  const candidate = buildMeshcoreIoPacketCandidate(
    `meshcore/JKG/${OBSERVER_KEY}/packets`,
    Buffer.from(JSON.stringify({ origin_id: OBSERVER_KEY, raw: "00ff" })),
    "packets",
  );
  assert.equal(candidate?.observerId, OBSERVER_KEY);
  assert.equal(candidate?.rawPacket.toString("hex"), "00ff");
  assert.equal(getMeshcoreIoTopicType("meshcore/JKG/key/status"), "status");
});

test("parses and verifies a real MeshCore advert packet", async () => {
  const rawPacket = makeAdvertPacket();
  const packet = Packet.fromBytes(rawPacket);
  assert.equal(packet.payload_type_string, "ADVERT");

  const advert = Advert.fromBytes(packet.payload);
  assert.equal(advert.parsed.type, "REPEATER");
  assert.equal(advert.parsed.name, "SE-STO-TEST");
  assert.equal(advert.timestamp, 1800000000);
  assert.equal(await advert.isVerified(), true);
  assert.equal(
    BufferUtils.bytesToHex(advert.publicKey),
    "a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f0",
  );
});

test("rejects malformed shared upload jobs before posting", () => {
  assert.deepEqual(
    parseMeshcoreIoUploadJob(JSON.stringify(uploadJob())),
    uploadJob(),
  );
  assert.equal(
    parseMeshcoreIoUploadJob(
      JSON.stringify({ ...uploadJob(), advertKey: `${NODE_KEY}:9999` }),
    ),
    undefined,
  );
  assert.equal(
    parseMeshcoreIoUploadJob(
      JSON.stringify({ ...uploadJob(), radioParams: { freq: 1 } }),
    ),
    undefined,
  );
  assert.deepEqual(
    parseMeshcoreIoUploadJob(
      JSON.stringify({ ...uploadJob(), latitude: 59.3293, longitude: 18.0686 }),
    ),
    { ...uploadJob(), latitude: 59.3293, longitude: 18.0686 },
  );
  assert.equal(
    parseMeshcoreIoUploadJob(
      JSON.stringify({ ...uploadJob(), latitude: 91, longitude: 18.0686 }),
    ),
    undefined,
  );
});

test("signs Meshcore.io requests and treats terminal API results as handled", async () => {
  let requestBody;
  const poster = new MeshcoreIoPoster(config(), {
    privateSeed: Buffer.alloc(32, 7),
    fetch: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ code: "NODES_INSERTED" }), {
        status: 200,
      });
    },
  });

  const result = await poster.post(uploadJob());
  assert.equal(result.status, "handled");
  const data = JSON.parse(requestBody.data);
  assert.deepEqual(data.params, { freq: 869.525, bw: 125, sf: 11, cr: 5 });
  assert.deepEqual(data.links, ["meshcore://01020304"]);
  const digest = createHash("sha256").update(requestBody.data).digest();
  assert.equal(
    ed25519.verify(
      Buffer.from(requestBody.signature, "hex"),
      digest,
      Buffer.from(requestBody.publicKey, "hex"),
    ),
    true,
  );
});

test("retries transient Meshcore.io responses but accepts duplicate adverts", async () => {
  const transient = new MeshcoreIoPoster(config(), {
    privateSeed: Buffer.alloc(32, 1),
    fetch: async () => new Response("unavailable", { status: 503 }),
  });
  assert.equal((await transient.post(uploadJob())).status, "retry");

  const duplicate = new MeshcoreIoPoster(config(), {
    privateSeed: Buffer.alloc(32, 2),
    fetch: async () =>
      new Response(JSON.stringify({ code: "ERR_ADVERT_DUPLICATE" }), {
        status: 409,
      }),
  });
  assert.equal((await duplicate.post(uploadJob())).status, "handled");
});

test("elects one queue producer, exposes workers from every broker, and fails over", async () => {
  const backend = new SharedRedisBackend();
  const noOpPoster = {
    async post() {
      return { status: "handled" };
    },
  };
  const first = createMeshcoreIoRuntime(
    config(),
    { instanceId: "Broker-A", kvUrl: "redis://unused", namespace: "test" },
    { redis: new FakeRedis(backend), poster: noOpPoster },
  );
  const second = createMeshcoreIoRuntime(
    config(),
    { instanceId: "Broker-B", kvUrl: "redis://unused", namespace: "test" },
    { redis: new FakeRedis(backend), poster: noOpPoster },
  );

  await Promise.all([first.ready, second.ready]);
  const elected = await waitFor(async () => {
    const [a, b] = await Promise.all([
      first.getDashboardSnapshot(),
      second.getDashboardSnapshot(),
    ]);
    return [a, b].filter(
      (snapshot) => snapshot.producer.respondingBrokerIsProducer,
    ).length === 1
      ? { a, b }
      : null;
  });

  assert.equal(elected.a.workers.length, 2);
  assert.deepEqual(
    elected.a.workers.map((worker) => worker.instanceId),
    ["Broker-A", "Broker-B"],
  );

  const firstWasLeader = elected.a.producer.respondingBrokerIsProducer;
  await (firstWasLeader ? first : second).stop();
  const survivor = firstWasLeader ? second : first;
  const survivorId = firstWasLeader ? "Broker-B" : "Broker-A";

  const takeover = await waitFor(async () => {
    const snapshot = await survivor.getDashboardSnapshot();
    return snapshot.producer.respondingBrokerIsProducer ? snapshot : null;
  });
  assert.equal(takeover.producer.instanceId, survivorId);

  await survivor.stop();
});

test("shares only recent valid MeshCore.io map adverts across brokers", async () => {
  const now = 2_000_000_000_000;
  const backend = new SharedRedisBackend();
  const prefix = "map-test:meshcoreio";
  const mapHash = new Map();
  const mapIndex = new Map();
  const recent = {
    at: now - 1_000,
    requestId: "map-request",
    nodeName: "Stockholm repeater",
    nodePublicKey: NODE_KEY,
    advertType: "REPEATER",
    observerName: "Stockholm observer",
    workerInstanceId: "Broker-A",
    latitude: 59.3293,
    longitude: 18.0686,
  };
  const staleKey = "c".repeat(64);
  const invalidKey = "d".repeat(64);

  mapHash.set(NODE_KEY, JSON.stringify(recent));
  mapHash.set(
    staleKey,
    JSON.stringify({
      ...recent,
      nodePublicKey: staleKey,
      at: now - 8 * 86400000,
    }),
  );
  mapHash.set(
    invalidKey,
    JSON.stringify({ ...recent, nodePublicKey: invalidKey, latitude: 120 }),
  );
  mapIndex.set(NODE_KEY, recent.at);
  mapIndex.set(staleKey, now - 8 * 86400000);
  mapIndex.set(invalidKey, now - 500);
  backend.hashes.set(`${prefix}:map:adverts`, mapHash);
  backend.sortedSets.set(`${prefix}:map:index`, mapIndex);

  const runtime = createMeshcoreIoRuntime(
    config({ producerPollMs: 30000 }),
    { instanceId: "Broker-B", kvUrl: "redis://unused", namespace: "map-test" },
    {
      redis: new FakeRedis(backend),
      now: () => now,
      poster: {
        async post() {
          return { status: "handled" };
        },
      },
    },
  );

  await runtime.ready;
  const snapshot = await runtime.getDashboardSnapshot();
  assert.deepEqual(snapshot.map.advertsLast7Days, [recent]);
  await runtime.stop();
});

test("stops promptly even with a long producer poll interval", async () => {
  const backend = new SharedRedisBackend();
  const runtime = createMeshcoreIoRuntime(
    config({ producerPollMs: 30000 }),
    { instanceId: "Broker-STOP", kvUrl: "redis://unused", namespace: "test" },
    {
      redis: new FakeRedis(backend),
      poster: {
        async post() {
          return { status: "handled" };
        },
      },
    },
  );
  await runtime.ready;
  await waitFor(
    async () =>
      (await runtime.getDashboardSnapshot()).producer
        .respondingBrokerIsProducer,
  );

  const startedAt = Date.now();
  await runtime.stop();
  assert.ok(Date.now() - startedAt < 500);
});

test("disabled integration creates no Valkey runtime", async () => {
  const runtime = createMeshcoreIoRuntime(config({ enabled: false }), {
    instanceId: "Broker-OFF",
    kvUrl: "redis://invalid.invalid:6379",
    namespace: "test",
  });
  await runtime.ready;
  assert.equal((await runtime.getDashboardSnapshot()).enabled, false);
  await runtime.stop();
});
