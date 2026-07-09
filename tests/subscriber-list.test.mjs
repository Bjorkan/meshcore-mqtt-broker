import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { ClusterStateStore } from "../dist/orchestration.js";

function uniqueId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function kvUrl() {
  return process.env.TEST_BROKER_KV_URL || "redis://127.0.0.1:6379";
}

const stores = [];

function testNamespace() {
  return `meshcore-subscriber-list-test-${uniqueId()}`;
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

test("listSubscriberConnections returnerar tom lista när inga subscribers finns", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const result = await store.listSubscriberConnections();
  assert.deepEqual(result, []);
});

test("listSubscriberConnections returnerar en aktiv subscriber", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const username = "viewer";
  await store.tryRegisterSubscriberConnection(username, "client-1", 5);

  const result = await store.listSubscriberConnections();
  assert.equal(result.length, 1);
  assert.equal(result[0].username, "viewer");
  assert.equal(result[0].connectionCount, 1);
  assert.equal(result[0].brokers.length, 1);
  assert.equal(result[0].brokers[0].brokerId, "broker-alpha");
  assert.equal(result[0].brokers[0].connectionCount, 1);
});

test("listSubscriberConnections hanterar username med specialtecken", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const username = "user:with/special@chars";
  await store.tryRegisterSubscriberConnection(username, "client-1", 5);

  const result = await store.listSubscriberConnections();
  assert.equal(result.length, 1);
  assert.equal(result[0].username, username);
});

test("listSubscriberConnections grupperar flera anslutningar för samma username på samma broker", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const username = "multi";
  await store.tryRegisterSubscriberConnection(username, "client-1", 10);
  await store.tryRegisterSubscriberConnection(username, "client-2", 10);

  const result = await store.listSubscriberConnections();
  assert.equal(result.length, 1);
  assert.equal(result[0].username, "multi");
  assert.equal(result[0].connectionCount, 2);
  assert.equal(result[0].brokers.length, 1);
  assert.equal(result[0].brokers[0].brokerId, "broker-alpha");
  assert.equal(result[0].brokers[0].connectionCount, 2);
});

test("listSubscriberConnections grupperar flera anslutningar över flera brokers", async () => {
  const ns = testNamespace();
  const storeA = createStore("broker-alpha", ns);
  const storeB = createStore("broker-beta", ns);
  await storeA.ready();
  await storeB.ready();

  const username = "multi-broker";
  await storeA.tryRegisterSubscriberConnection(username, "client-a1", 10);
  await storeA.tryRegisterSubscriberConnection(username, "client-a2", 10);
  await storeB.tryRegisterSubscriberConnection(username, "client-b1", 10);

  const result = await storeA.listSubscriberConnections();
  assert.equal(result.length, 1);
  assert.equal(result[0].username, "multi-broker");
  assert.equal(result[0].connectionCount, 3);
  assert.equal(result[0].brokers.length, 2);

  const brokers = result[0].brokers.sort((a, b) =>
    a.brokerId.localeCompare(b.brokerId),
  );
  assert.equal(brokers[0].brokerId, "broker-alpha");
  assert.equal(brokers[0].connectionCount, 2);
  assert.equal(brokers[1].brokerId, "broker-beta");
  assert.equal(brokers[1].connectionCount, 1);
});

test("listSubscriberConnections sorterar resultat deterministiskt på username", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  await store.tryRegisterSubscriberConnection("zulu", "client-z", 5);
  await store.tryRegisterSubscriberConnection("alpha", "client-a", 5);
  await store.tryRegisterSubscriberConnection("mike", "client-m", 5);

  const result = await store.listSubscriberConnections();
  assert.equal(result.length, 3);
  assert.equal(result[0].username, "alpha");
  assert.equal(result[1].username, "mike");
  assert.equal(result[2].username, "zulu");
});

test("listSubscriberConnections sorterar brokers deterministiskt", async () => {
  const ns = testNamespace();
  const storeA = createStore("zulu-broker", ns);
  const storeB = createStore("alpha-broker", ns);
  await storeA.ready();
  await storeB.ready();

  const username = "sorter-test";
  await storeA.tryRegisterSubscriberConnection(username, "client-z", 10);
  await storeB.tryRegisterSubscriberConnection(username, "client-a", 10);

  const result = await storeA.listSubscriberConnections();
  assert.equal(result[0].brokers[0].brokerId, "alpha-broker");
  assert.equal(result[0].brokers[1].brokerId, "zulu-broker");
});

test("listSubscriberConnections returnerar lastSeenAt", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const now = Date.now();
  await store.tryRegisterSubscriberConnection("viewer", "client-1", 5);

  const result = await store.listSubscriberConnections();
  assert.equal(result[0].lastSeenAt > 0, true);
  assert.ok(result[0].lastSeenAt >= now);
});

test("listSubscriberConnections returnerar inte tom username efter cleanup", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  await store.tryRegisterSubscriberConnection("temp-user", "client-1", 5);
  await store.releaseSubscriberConnection("temp-user", "client-1");

  const result = await store.listSubscriberConnections();
  assert.equal(result.length, 0);
});

test("tryRegisterSubscriberConnection är idempotent för samma username+clientId+broker", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const reg1 = await store.tryRegisterSubscriberConnection(
    "idem-user",
    "client-1",
    5,
  );
  assert.equal(reg1.allowed, true);
  assert.equal(reg1.activeConnections, 1);

  const reg2 = await store.tryRegisterSubscriberConnection(
    "idem-user",
    "client-1",
    5,
  );
  assert.equal(reg2.allowed, true, "reconnect must be allowed");
  assert.equal(
    reg2.activeConnections,
    2,
    "reconnect generates new member so count increases",
  );

  const result = await store.listSubscriberConnections();
  assert.equal(result.length, 1);
  assert.equal(result[0].connectionCount, 2);
});

test("tryRegisterSubscriberConnection nekar annan clientId vid max=1", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  await store.tryRegisterSubscriberConnection("max-user", "client-1", 1);
  const reg2 = await store.tryRegisterSubscriberConnection(
    "max-user",
    "client-2",
    1,
  );
  assert.equal(reg2.allowed, false);
});

test("tryRegisterSubscriberConnection fungerar med max=2 över två brokers", async () => {
  const ns = testNamespace();
  const storeA = createStore("broker-alpha", ns);
  const storeB = createStore("broker-beta", ns);
  await storeA.ready();
  await storeB.ready();

  const regA = await storeA.tryRegisterSubscriberConnection(
    "multi",
    "client-a",
    2,
  );
  const regB = await storeB.tryRegisterSubscriberConnection(
    "multi",
    "client-b",
    2,
  );
  assert.equal(regA.allowed, true);
  assert.equal(regB.allowed, true);

  const result = await storeA.listSubscriberConnections();
  assert.equal(result[0].connectionCount, 2);
  assert.equal(result[0].brokers.length, 2);
});

test("Map-nyckel hanterar kolon i username/clientId utan kollision", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  await store.tryRegisterSubscriberConnection("a:b", "c:d", 5);
  await store.tryRegisterSubscriberConnection("a", "b:c:d", 5);

  const result = await store.listSubscriberConnections();
  assert.equal(result.length, 2);
  const usernames = result.map((r) => r.username).sort();
  assert.deepEqual(usernames, ["a", "a:b"]);

  await store.releaseSubscriberConnection("a:b", "c:d");
  const after = await store.listSubscriberConnections();
  assert.equal(after.length, 1);
  assert.equal(after[0].username, "a");
});

test("listSubscriberConnections rensar stale members när aktiv member håller key vid liv", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const now = Date.now();
  const staleScore = now - 100_000;

  const key = `${ns}:subscribers:${encodeURIComponent("stale-user")}:connections`;
  await store.redis.zadd(
    key,
    now,
    JSON.stringify({
      clientId: "active",
      lastUpdatedByInstance: "broker-alpha",
    }),
  );
  await store.redis.zadd(
    key,
    staleScore,
    JSON.stringify({
      clientId: "stale",
      lastUpdatedByInstance: "broker-alpha",
    }),
  );

  const result = await store.listSubscriberConnections();
  assert.equal(result.length, 1);
  assert.equal(result[0].connectionCount, 1);
  assert.equal(result[0].brokers[0].connectionCount, 1);
});

test("listSubscriberConnections ignorerar malformed JSON-member", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const now = Date.now();
  const key = `${ns}:subscribers:${encodeURIComponent("malformed-user")}:connections`;
  await store.redis.zadd(
    key,
    now,
    JSON.stringify({
      clientId: "valid",
      lastUpdatedByInstance: "broker-alpha",
    }),
  );
  await store.redis.zadd(key, now, "{broken json");

  const result = await store.listSubscriberConnections();
  assert.equal(result.length, 1);
  assert.equal(result[0].connectionCount, 1);
});

test("listSubscriberConnections hanterar member utan lastUpdatedByInstance", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  const now = Date.now();
  const key = `${ns}:subscribers:${encodeURIComponent("no-broker-user")}:connections`;
  await store.redis.zadd(key, now, JSON.stringify({ clientId: "nobroker" }));

  const result = await store.listSubscriberConnections();
  assert.equal(result.length, 1);
  assert.equal(result[0].brokers[0].brokerId, "unknown");
});

test("gammal disconnect påverkar inte ny anslutning med annat clientId", async () => {
  const ns = testNamespace();
  const store = createStore("broker-alpha", ns);
  await store.ready();

  await store.tryRegisterSubscriberConnection("stable", "old-client", 5);
  await store.tryRegisterSubscriberConnection("stable", "new-client", 5);

  await store.releaseSubscriberConnection("stable", "old-client");

  const result = await store.listSubscriberConnections();
  assert.equal(result.length, 1);
  assert.equal(result[0].connectionCount, 1);
});
