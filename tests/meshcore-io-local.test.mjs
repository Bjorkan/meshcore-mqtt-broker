import assert from "node:assert/strict";
import { afterEach, test } from "bun:test";
import { LocalMeshcoreIoRuntime } from "../src/meshcore-io-runtime.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

const config = {
  enabled: true,
  apiUrl: "https://example.invalid",
  dryRun: false,
  minReuploadIntervalSeconds: 3600,
  requestTimeoutMs: 1000,
  workers: 1,
  maxQueuedUploads: 1,
  retriesAllowed: 2,
  retryDelayMs: 0,
  ingressDedupMs: 1000,
};

function job(suffix = "1") {
  const nodePublicKey = suffix.padStart(64, "a");
  return {
    requestId: `request-${suffix}`,
    retriesAllowed: 2,
    advertKey: `${nodePublicKey}:100`,
    advertTimestamp: 100,
    advertType: "REPEATER",
    nodeName: `Node ${suffix}`,
    nodePublicKey,
    rawPacketHex: "00",
    observerId: "b".repeat(64),
    radioParams: { freq: 869.525, bw: 125, sf: 11, cr: 5 },
    enqueuedAt: Date.now(),
  };
}

async function runtimeWith(poster) {
  const fixture = await temporaryDatabase("meshcore-io-");
  fixtures.push(fixture);
  const runtime = new LocalMeshcoreIoRuntime(
    config,
    "Broker-LOCAL",
    fixture.database,
    {
      poster,
      startLoops: false,
    },
  );
  await runtime.ready;
  return { fixture, runtime };
}

test("queue capacity and active-node deduplication are transactional", async () => {
  const { fixture, runtime } = await runtimeWith({
    post: async () => ({ status: "handled" }),
  });
  await runtime.admitJob(job("1"));
  await runtime.admitJob(job("1"));
  await runtime.admitJob(job("2"));
  const active = await fixture.database.get(
    "SELECT COUNT(*) AS count FROM meshcore_io_jobs WHERE status = 'pending'",
  );
  const stats = await fixture.database.get(
    "SELECT enqueued, dropped FROM meshcore_io_stats WHERE singleton = 1",
  );
  assert.equal(Number(active.count), 1);
  assert.equal(Number(stats.enqueued), 1);
  assert.equal(Number(stats.dropped), 1);
  await runtime.stop();
});

test("durable ingress outlives the short duplicate-suppression window", async () => {
  const { fixture, runtime } = await runtimeWith({
    post: async () => ({ status: "handled" }),
  });
  await runtime.enqueueIngress(
    `meshcore/test/${"a".repeat(64)}/status`,
    Buffer.from("{}"),
  );
  const ingress = await fixture.database.get(
    `SELECT received_at_ms, expires_at_ms FROM meshcore_io_ingress LIMIT 1`,
  );
  const dedup = await fixture.database.get(
    `SELECT expires_at_ms FROM meshcore_io_ingress_dedup LIMIT 1`,
  );
  assert.ok(
    Number(ingress.expires_at_ms) - Number(ingress.received_at_ms) >
      config.ingressDedupMs,
  );
  assert.equal(
    Number(dedup.expires_at_ms) - Number(ingress.received_at_ms),
    config.ingressDedupMs,
  );
  await runtime.stop();
});

test("expired ingress is not claimed for processing", async () => {
  const { fixture, runtime } = await runtimeWith({
    post: async () => ({ status: "handled" }),
  });
  await fixture.database.run(
    `INSERT INTO meshcore_io_ingress(
       digest, topic, payload, received_at_ms, expires_at_ms
      ) VALUES ($1, $2, $3, $4, $5)`,
    "expired",
    `meshcore/test/${"a".repeat(64)}/status`,
    Buffer.from("{}"),
    1,
    1,
  );
  assert.equal(await runtime.claimIngress(), undefined);
  await runtime.stop();
});

test("retry attempts persist and successful completion records bounded durable history", async () => {
  let attempts = 0;
  const { fixture, runtime } = await runtimeWith({
    async post() {
      attempts += 1;
      return attempts === 1
        ? { status: "retry", error: new Error("temporary") }
        : {
            status: "handled",
            responseFromMeshcoreIO: '{"code":"NODES_INSERTED"}',
          };
    },
  });
  await runtime.admitJob(job("3"));
  await runtime.processJob(await runtime.claimJob());
  let row = await fixture.database.get(
    "SELECT status, attempt_count FROM meshcore_io_jobs LIMIT 1",
  );
  assert.equal(row.status, "retry");
  assert.equal(Number(row.attempt_count), 1);
  await runtime.processJob(await runtime.claimJob());
  row = await fixture.database.get(
    "SELECT status, attempt_count FROM meshcore_io_jobs LIMIT 1",
  );
  assert.equal(row.status, "completed");
  assert.equal(Number(row.attempt_count), 2);
  assert.equal(
    (await runtime.getDashboardSnapshot()).history[0].status,
    "uploaded",
  );
  await runtime.stop();
});

test("permanent failure drops after configured attempts", async () => {
  const { fixture, runtime } = await runtimeWith({
    post: async () => ({ status: "retry", error: new Error("permanent") }),
  });
  await runtime.admitJob(job("4"));
  await runtime.processJob(await runtime.claimJob());
  await runtime.processJob(await runtime.claimJob());
  const row = await fixture.database.get(
    "SELECT status FROM meshcore_io_jobs LIMIT 1",
  );
  assert.equal(row.status, "dropped");
  assert.equal(
    (await runtime.getDashboardSnapshot()).history[0].status,
    "dropped",
  );
  await runtime.stop();
});

test("interrupted processing jobs recover when a runtime starts", async () => {
  const fixture = await temporaryDatabase("meshcore-recovery-");
  fixtures.push(fixture);
  const value = job("5");
  await fixture.database.run(
    `INSERT INTO meshcore_io_jobs(
      request_id, deduplication_key, node_public_key, job_json, status,
      created_at_ms, next_attempt_at_ms, attempt_count, processing_started_at_ms
    ) VALUES ($1, $2, $3, $4, 'processing', 1, 1, 1, 1)`,
    value.requestId,
    value.advertKey,
    value.nodePublicKey,
    JSON.stringify(value),
  );
  const runtime = new LocalMeshcoreIoRuntime(
    config,
    "Broker-LOCAL",
    fixture.database,
    {
      poster: { post: async () => ({ status: "handled" }) },
      startLoops: false,
    },
  );
  await runtime.ready;
  assert.equal(
    (await fixture.database.get("SELECT status FROM meshcore_io_jobs")).status,
    "retry",
  );
  await runtime.stop();
});

test("restart does not issue an HTTP attempt beyond the configured limit", async () => {
  const fixture = await temporaryDatabase("meshcore-attempt-limit-");
  fixtures.push(fixture);
  const value = job("7");
  await fixture.database.run(
    `INSERT INTO meshcore_io_jobs(
       request_id, deduplication_key, node_public_key, job_json, status,
       created_at_ms, next_attempt_at_ms, attempt_count, processing_started_at_ms
      ) VALUES ($1, $2, $3, $4, 'processing', 1, 1, 2, 1)`,
    value.requestId,
    value.advertKey,
    value.nodePublicKey,
    JSON.stringify(value),
  );
  let posts = 0;
  const runtime = new LocalMeshcoreIoRuntime(
    config,
    "Broker-LOCAL",
    fixture.database,
    {
      poster: {
        post: async () => {
          posts += 1;
          return { status: "handled" };
        },
      },
      startLoops: false,
    },
  );
  await runtime.ready;
  await runtime.processJob(await runtime.claimJob());
  assert.equal(posts, 0);
  assert.equal(
    (await fixture.database.get("SELECT status FROM meshcore_io_jobs LIMIT 1"))
      .status,
    "dropped",
  );
  await runtime.stop();
});

test("unexpected worker exceptions return claimed jobs to retry", async () => {
  const { fixture, runtime } = await runtimeWith({
    post: async () => {
      throw new Error("unexpected poster failure");
    },
  });
  await runtime.admitJob(job("6"));
  await assert.rejects(
    runtime.processJob(await runtime.claimJob()),
    /unexpected poster failure/,
  );
  const row = await fixture.database.get(
    "SELECT status, processing_started_at_ms FROM meshcore_io_jobs LIMIT 1",
  );
  assert.equal(row.status, "retry");
  assert.equal(row.processing_started_at_ms, null);
  await assert.rejects(
    runtime.processJob(await runtime.claimJob()),
    /unexpected poster failure/,
  );
  assert.equal(
    (await fixture.database.get("SELECT status FROM meshcore_io_jobs LIMIT 1"))
      .status,
    "dropped",
  );
  await runtime.stop();
});
