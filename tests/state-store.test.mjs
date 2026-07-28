import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { ApplicationDatabase } from "../dist/database.js";
import { BrokerStateStore } from "../dist/state-store.js";
import { DashboardState } from "../dist/dashboard.js";
import { NEIGHBOR_RETENTION_MS } from "../dist/neighbors.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

async function storeFixture(prefix) {
  const fixture = await temporaryDatabase(prefix);
  fixtures.push(fixture);
  return {
    fixture,
    store: new BrokerStateStore(fixture.database, "Broker-LOCAL"),
  };
}

test("subscriber limits are local, concurrency-safe, and stale disconnects cannot remove replacements", async () => {
  const { store } = await storeFixture("subscribers-");
  const first = await store.tryRegisterSubscriberConnection(
    "viewer",
    "same",
    1,
  );
  store.activateSubscriberConnection("viewer", "same", first.connectionId);
  const replacement = await store.tryRegisterSubscriberConnection(
    "viewer",
    "same",
    1,
  );
  assert.equal(first.allowed, true);
  assert.equal(replacement.allowed, true);
  const concurrentReplacement = await store.tryRegisterSubscriberConnection(
    "viewer",
    "same",
    1,
  );
  assert.equal(concurrentReplacement.allowed, false);
  await store.releaseSubscriberConnection(
    "viewer",
    "same",
    replacement.connectionId,
  );
  assert.equal((await store.listSubscriberConnections())[0].connectionCount, 1);
  await store.releaseSubscriberConnection("viewer", "same", first.connectionId);
  const final = await store.tryRegisterSubscriberConnection(
    "viewer",
    "same",
    1,
  );
  store.activateSubscriberConnection("viewer", "same", final.connectionId);
  assert.equal((await store.listSubscriberConnections())[0].connectionCount, 1);
  const denied = await store.tryRegisterSubscriberConnection(
    "viewer",
    "other",
    1,
  );
  assert.equal(denied.allowed, false);
});

test("observer names, status ordering, observer state, and neighbors survive restart", async () => {
  const { fixture, store } = await storeFixture("observer-state-");
  const key = "A".repeat(64);
  const now = Date.now();
  await store.setObserverNodeName(key, "Node A", 60_000);
  assert.equal(
    await store.acceptObserverStatusTimestamp(key, 200, 60_000),
    true,
  );
  assert.equal(
    await store.acceptObserverStatusTimestamp(key, 199, 60_000),
    false,
  );
  await store.setObserverEntries([
    {
      label: "Node A",
      publicKey: key,
      broker: "Broker-LOCAL",
      active: true,
      lastConnectedAt: now,
      lastSeenAt: now,
      messageCount: 1,
      messages: [],
      neighbors: {
        receivedAt: now,
        selfScopes: [],
        neighbors: [],
        invalidEntryCount: 0,
      },
    },
  ]);
  await fixture.database.close();
  fixture.database = await ApplicationDatabase.open(fixture.file);
  const reopened = new BrokerStateStore(fixture.database, "Broker-LOCAL");
  await reopened.ready();
  assert.equal(await reopened.getObserverNodeName(key), "Node A");
  const durableObservers = await reopened.listObservers();
  assert.equal(durableObservers[0].active, false);
  assert.equal(durableObservers[0].neighbors.receivedAt, now);

  const dashboard = new DashboardState({ instanceId: "Broker-LOCAL" });
  dashboard.hydrateObserverEntries(durableObservers);
  dashboard.recordClientConnected({
    id: "replacement",
    clientType: "publisher",
    publicKey: key,
    connectedAt: now + 1,
  });
  const [reconnected] = dashboard.getObserverEntries();
  assert.equal(reconnected.messageCount, 1);
  assert.equal(reconnected.neighbors.receivedAt, now);
});

test("neighbor state expires after 48 hours and cleanup is bounded", async () => {
  const { store, fixture } = await storeFixture("neighbor-expiry-");
  const key = "B".repeat(64);
  const receivedAt = Date.now() - NEIGHBOR_RETENTION_MS;
  await store.setObserverEntries([
    {
      label: "B",
      publicKey: key,
      broker: "Broker-LOCAL",
      active: false,
      lastConnectedAt: receivedAt,
      lastSeenAt: receivedAt,
      messageCount: 1,
      messages: [],
      neighbors: {
        receivedAt,
        selfScopes: [],
        neighbors: [],
        invalidEntryCount: 0,
      },
    },
  ]);
  await store.cleanupExpired(1);
  assert.equal((await store.listObservers())[0].neighbors, undefined);
  const row = await fixture.database.get(
    "SELECT neighbors_json FROM observer_state WHERE public_key = ?",
    key,
  );
  assert.equal(row.neighbors_json, null);
});

test("trust state and stable denial event identities persist with deterministic ordering", async () => {
  const { fixture, store } = await storeFixture("abuse-");
  const key = "C".repeat(64);
  await store.setTrustState(
    key,
    JSON.stringify({
      status: "muted",
      muteReason: "rate_limit_exceeded",
      abuseBlockCount: 2,
    }),
  );
  const denial = {
    node: key,
    reason: "same denial",
    topic: "meshcore/TEST/denied",
  };
  await store.recordDeniedPublish(denial);
  await store.recordDeniedPublish(denial);
  const beforeReopen = await store.listDeniedPublishes();
  assert.equal(beforeReopen.length, 2);
  assert.equal(typeof beforeReopen[0].eventId, "string");
  assert.equal(typeof beforeReopen[1].eventId, "string");
  assert.notEqual(beforeReopen[0].eventId, beforeReopen[1].eventId);
  assert.deepEqual(await store.getLatestDeniedPublish(key), beforeReopen[0]);

  await fixture.database.close();
  fixture.database = await ApplicationDatabase.open(fixture.file);
  const reopened = new BrokerStateStore(fixture.database, "Broker-LOCAL");
  const [trustStateBan] = await reopened.listPublicBans();
  assert.equal(trustStateBan.blockCount, 2);
  assert.equal(Object.hasOwn(trustStateBan, "eventId"), false);
  assert.deepEqual(await reopened.listDeniedPublishes(), beforeReopen);
  assert.deepEqual(await reopened.getLatestDeniedPublish(key), beforeReopen[0]);
  assert.equal(await reopened.removePublicBan(key), true);
});
