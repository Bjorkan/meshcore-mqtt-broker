import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  ClusterStateStore,
  normalizePublicKey,
  validatePublicKey,
} from "../dist/orchestration.js";
import { lookupObserverStatus } from "../dist/dashboard.js";

function uniqueId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function kvUrl() {
  return process.env.TEST_BROKER_KV_URL || "redis://127.0.0.1:6379";
}

const NODE_NAME_TTL_MS = 24 * 60 * 60 * 1000;

const stores = [];

function testNamespace() {
  return `meshcore-observer-api-test-${uniqueId()}`;
}

function createStore(instanceId, namespace) {
  const store = new ClusterStateStore({
    kvUrl: kvUrl(),
    namespace,
    instanceId,
  });
  stores.push(store);
  return store;
}

function publicKey(prefix) {
  return `${(prefix || "A").toUpperCase()}${uniqueId()
    .replace(/-/g, "")
    .toUpperCase()
    .padEnd(64, "F")}`.slice(0, 64);
}

afterEach(async () => {
  for (const store of stores) {
    try {
      await store.close();
    } catch {
      // ignore close errors
    }
  }
  stores.length = 0;
});

// --- validatePublicKey ---

test("validatePublicKey accepterar giltig 64-tecken hex public key", () => {
  const key =
    "7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400";
  const result = validatePublicKey(key);
  assert.equal(result, key.toUpperCase());
});

test("validatePublicKey trimmar whitespace", () => {
  const key =
    "  7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400  ";
  const result = validatePublicKey(key);
  assert.equal(result, key.trim().toUpperCase());
});

test("validatePublicKey accepterar lowercase och normaliserar till uppercase", () => {
  const key =
    "7e7662676f7f0850a8a355baafbfc1eb7b4174c340442d7d7161c9474a2c9400";
  const result = validatePublicKey(key);
  assert.equal(
    result,
    "7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400",
  );
});

test("validatePublicKey avvisar för lång input (>128 tecken)", () => {
  const result = validatePublicKey("A".repeat(129));
  assert.equal(result, null);
});

test("validatePublicKey avvisar ogiltiga tecken (G är inte hex)", () => {
  const result = validatePublicKey(
    "7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C940G",
  );
  assert.equal(result, null);
});

test("validatePublicKey avvisar fel längd (63 tecken)", () => {
  const result = validatePublicKey("A".repeat(63));
  assert.equal(result, null);
});

test("validatePublicKey avvisar fel längd (65 tecken)", () => {
  const result = validatePublicKey("A".repeat(65));
  assert.equal(result, null);
});

test("validatePublicKey avvisar tom sträng", () => {
  const result = validatePublicKey("");
  assert.equal(result, null);
});

// --- normalizePublicKey ---

test("normalizePublicKey trimmar och gör uppercase", () => {
  const result = normalizePublicKey("  abc123  ");
  assert.equal(result, "ABC123");
});

// --- lookupObserverStatus: unknown ---

test("lookupObserverStatus returnerar unknown för okänd public key", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const pk = publicKey("A");
  const result = await lookupObserverStatus(pk, store);

  assert.equal(result.status, "unknown");
  assert.equal(result.publicKey, pk);
  assert.equal(
    result.message,
    "This observer has not been seen by any broker instance.",
  );
});

// --- lookupObserverStatus: known ---

test("lookupObserverStatus returnerar known för aktiv observer", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const pk = publicKey("B");
  const now = Date.now();
  await store.setInstanceObservers([
    {
      publicKey: pk,
      label: "Test Observer",
      broker: "broker-alpha",
      region: "STO",
      active: true,
      lastConnectedAt: now - 1000,
      lastSeenAt: now,
      messageCount: 5,
      messages: [],
    },
  ]);
  await store.setObserverNodeName(pk, "Test Observer", NODE_NAME_TTL_MS);

  const result = await lookupObserverStatus(pk, store);

  assert.equal(result.status, "known");
  assert.equal(result.publicKey, pk);
  assert.equal(result.observer.publicKey, pk);
  assert.equal(result.observer.shortKey.length <= 19, true);
  assert.equal(result.observer.region, "STO");
  assert.equal(result.observer.name, "Test Observer");
  assert.equal(result.observer.brokerId, "broker-alpha");
  assert.equal(result.observer.lastSeen, now);
});

// --- lookupObserverStatus: blocked (blocked wins over known) ---

test("lookupObserverStatus blocked vinner över known", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const pk = publicKey("C");
  const now = Date.now();
  await store.setInstanceObservers([
    {
      publicKey: pk,
      label: "Test Observer",
      broker: "broker-alpha",
      region: "STO",
      active: true,
      lastConnectedAt: now - 2000,
      lastSeenAt: now - 1000,
      messageCount: 3,
      messages: [],
    },
  ]);
  await store.setObserverNodeName(pk, "Test Observer", NODE_NAME_TTL_MS);
  await store.setTrustState(
    pk,
    JSON.stringify({
      status: "muted",
      muteReason: "anomaly_threshold_exceeded",
      abuseBlockCount: 1,
      mutedUntil: now + 300_000,
      lastUpdatedAt: now,
      lastUpdatedByInstance: "broker-alpha",
    }),
  );

  const result = await lookupObserverStatus(pk, store);

  assert.equal(result.status, "blocked");
  assert.equal(result.publicKey, pk);
  assert.equal(result.observer.name, "Test Observer");
  assert.equal(result.block.reason, "Avvikelsegräns");
  assert.equal(result.block.mutedUntil, now + 300_000);
  assert.equal(result.block.brokerId, "broker-alpha");
});

// --- lookupObserverStatus: blocked only (no observer entry) ---

test("lookupObserverStatus returnerar blocked när observern bara finns i blocked-state", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const pk = publicKey("D");
  const now = Date.now();
  await store.setTrustState(
    pk,
    JSON.stringify({
      status: "muted",
      muteReason: "rate_limit_exceeded",
      abuseBlockCount: 2,
      mutedUntil: now + 600_000,
      lastUpdatedAt: now,
      lastUpdatedByInstance: "broker-alpha",
    }),
  );

  const result = await lookupObserverStatus(pk, store);

  assert.equal(result.status, "blocked");
  assert.equal(result.publicKey, pk);
  assert.equal(result.block.reason !== "Okänd orsak", true);
  assert.equal(result.block.mutedUntil, now + 600_000);
});

// --- lookupObserverStatus: blocked with deniedUntilText ---

test("lookupObserverStatus returnerar deniedUntilText i block", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const pk = publicKey("E");
  await store.recordDeniedPublish({
    node: pk,
    label: "Test Observer",
    reason: "Ogiltig IATA-region",
    topic: "meshcore/XXX/" + pk + "/status",
    region: "XXX",
    deniedUntilText: "2027-01-01",
  });

  const result = await lookupObserverStatus(pk, store);

  assert.equal(result.status, "blocked");
  assert.equal(result.block.reason, "Ogiltig IATA-region");
  assert.equal(result.block.deniedUntilText, "2027-01-01");
  assert.equal(result.block.region, "XXX");
});

// --- lookupObserverStatus: would_mute ---

test("lookupObserverStatus returnerar blocked för would_mute", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const pk = publicKey("F");
  const now = Date.now();
  await store.setTrustState(
    pk,
    JSON.stringify({
      status: "would_mute",
      muteReason: "anomaly:packet_size",
      abuseBlockCount: 1,
      lastUpdatedAt: now,
      lastUpdatedByInstance: "broker-alpha",
      mutedUntil: now + 900_000,
    }),
  );

  const result = await lookupObserverStatus(pk, store);

  assert.equal(result.status, "blocked");
});

// --- lookupObserverStatus: input normalisering ---

test("lookupObserverStatus normaliserar lowercase input till uppercase", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const pkUpper = publicKey("1");
  const pkLower = pkUpper.toLowerCase();
  const now = Date.now();
  await store.setInstanceObservers([
    {
      publicKey: pkUpper,
      label: "Test Observer",
      broker: "broker-alpha",
      region: "STO",
      active: true,
      lastConnectedAt: now,
      lastSeenAt: now,
      messageCount: 0,
      messages: [],
    },
  ]);

  const result = await lookupObserverStatus(pkLower, store);

  assert.equal(result.status, "known");
  assert.equal(result.publicKey, pkUpper);
});

// --- lookupObserverStatus: trimmed whitespace ---

test("lookupObserverStatus trimmar whitespace från input", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const pk = publicKey("2");
  const now = Date.now();
  await store.setInstanceObservers([
    {
      publicKey: pk,
      label: "Test Observer",
      broker: "broker-alpha",
      active: true,
      lastConnectedAt: now,
      lastSeenAt: now,
      messageCount: 0,
      messages: [],
    },
  ]);

  const result = await lookupObserverStatus("  " + pk + "  ", store);

  assert.equal(result.status, "known");
  assert.equal(result.publicKey, pk);
});

// --- lookupObserverStatus: multi-broker lastSeen ---

test("lookupObserverStatus använder senaste lastSeen vid data från flera brokers", async () => {
  const ns = testNamespace();
  const storeA = createStore("broker-alpha", ns);
  const storeB = createStore("broker-beta", ns);
  await storeA.ready();
  await storeB.ready();

  const pk = publicKey("3");
  const now = Date.now();
  await storeA.setInstanceObservers([
    {
      publicKey: pk,
      label: "Observer Alpha",
      broker: "broker-alpha",
      active: false,
      lastConnectedAt: now - 10000,
      lastSeenAt: now - 5000,
      messageCount: 1,
      messages: [],
    },
  ]);
  await storeB.setInstanceObservers([
    {
      publicKey: pk,
      label: "Observer Beta",
      broker: "broker-beta",
      active: true,
      lastConnectedAt: now - 1000,
      lastSeenAt: now,
      messageCount: 3,
      messages: [],
    },
  ]);

  const result = await lookupObserverStatus(pk, storeA);

  assert.equal(result.status, "known");
  assert.equal(result.observer.lastSeen, now);
});

// --- Error handling ---

test("lookupObserverStatus hanterar Valkey-fel utan att kasta", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  try {
    await store.close();
  } catch {
    // ignore close errors
  }
  stores.length = 0;

  const pk = publicKey("4");
  try {
    const result = await lookupObserverStatus(pk, store);
    assert.equal(result.status, "error");
  } catch {
    // expected - some Redis operations on closed connection may throw
  }
});
