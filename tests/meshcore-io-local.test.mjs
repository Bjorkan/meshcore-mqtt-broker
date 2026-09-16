import assert from "node:assert/strict";
import { test } from "bun:test";
import { LocalMeshcoreIoRuntime } from "../src/meshcore-io-runtime.js";

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

function runtimeWith(poster) {
  const runtime = new LocalMeshcoreIoRuntime(config, "Broker-LOCAL", {
    poster,
    startLoops: false,
  });
  return runtime;
}

test("queue capacity drops the second queued job for another node", async () => {
  const runtime = runtimeWith({
    post: async () => ({ status: "handled" }),
  });
  await runtime.ready;
  runtime.admitJob(job("1"));
  runtime.admitJob(job("2"));
  const first = runtime.claimJob();
  assert.ok(first);
  assert.equal(first.job.nodePublicKey, job("1").nodePublicKey);
  assert.equal(runtime.claimJob(), undefined);
  await runtime.stop();
});

test("duplicate jobs for one node are admitted once", async () => {
  const runtime = runtimeWith({
    post: async () => ({ status: "handled" }),
  });
  await runtime.ready;
  runtime.admitJob(job("1"));
  runtime.admitJob(job("1"));
  const first = runtime.claimJob();
  assert.ok(first);
  assert.equal(runtime.claimJob(), undefined);
  await runtime.stop();
});

test("retry attempts return the job before successful completion", async () => {
  let attempts = 0;
  const runtime = runtimeWith({
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
  await runtime.ready;
  runtime.admitJob(job("3"));
  await runtime.processJob(runtime.claimJob());
  assert.equal(attempts, 1);
  const retry = runtime.claimJob();
  assert.ok(retry);
  assert.equal(retry.attemptCount, 2);
  await runtime.processJob(retry);
  assert.equal(attempts, 2);
  assert.equal(runtime.claimJob(), undefined);
  await runtime.stop();
});

test("permanent failure drops after configured attempts", async () => {
  const runtime = runtimeWith({
    post: async () => ({ status: "retry", error: new Error("permanent") }),
  });
  await runtime.ready;
  runtime.admitJob(job("4"));
  await runtime.processJob(runtime.claimJob());
  await runtime.processJob(runtime.claimJob());
  assert.equal(runtime.claimJob(), undefined);
  await runtime.stop();
});

test("attempts beyond the configured limit are dropped without HTTP", async () => {
  let posts = 0;
  const runtime = runtimeWith({
    post: async () => {
      posts += 1;
      return { status: "handled" };
    },
  });
  await runtime.ready;
  runtime.admitJob(job("7"));
  const claimed = runtime.claimJob();
  claimed.attemptCount = 99;
  await runtime.processJob(claimed);
  assert.equal(posts, 0);
  assert.equal(runtime.claimJob(), undefined);
  await runtime.stop();
});

test("unexpected worker exceptions return claimed jobs to retry", async () => {
  const runtime = runtimeWith({
    post: async () => {
      throw new Error("unexpected poster failure");
    },
  });
  await runtime.ready;
  runtime.admitJob(job("6"));
  await assert.rejects(
    runtime.processJob(runtime.claimJob()),
    /unexpected poster failure/,
  );
  const retry = runtime.claimJob();
  assert.ok(retry);
  assert.equal(retry.attemptCount, 2);
  await assert.rejects(runtime.processJob(retry), /unexpected poster failure/);
  assert.equal(runtime.claimJob(), undefined);
  await runtime.stop();
});
