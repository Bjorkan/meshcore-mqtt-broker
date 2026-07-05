import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import Redis from 'ioredis';
import { ClusterStateStore } from '../dist/orchestration.js';

function uniqueId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function kvUrl() {
  return process.env.TEST_BROKER_KV_URL || 'redis://127.0.0.1:6379';
}

const stores = [];

function testNamespace() {
  return `meshcore-observer-claim-test-${uniqueId()}`;
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

test('claimObserver sets initial claim and returns null on first call', async () => {
  const ns = testNamespace();
  const store = createStore('broker-alpha', ns);
  const pk = `A${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  const previous = await store.claimObserver(pk);
  assert.equal(previous, null);
});

test('claimObserver returns null when same instance reclaims', async () => {
  const ns = testNamespace();
  const store = createStore('broker-alpha', ns);
  const pk = `B${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  await store.claimObserver(pk);
  const previous = await store.claimObserver(pk);
  assert.equal(previous, null);
});

test('claimObserver returns previous owner when another instance takes over', async () => {
  const ns = testNamespace();
  const alpha = createStore('broker-alpha', ns);
  const beta = createStore('broker-beta', ns);
  const pk = `C${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  await alpha.claimObserver(pk);
  const previous = await beta.claimObserver(pk);
  assert.equal(previous, 'broker-alpha');
});

test('renewObserverClaim returns true when claim is still owned', async () => {
  const ns = testNamespace();
  const store = createStore('broker-alpha', ns);
  const pk = `D${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  await store.claimObserver(pk);
  const renewed = await store.renewObserverClaim(pk);
  assert.equal(renewed, true);
});

test('renewObserverClaim returns false when claim does not exist', async () => {
  const ns = testNamespace();
  const store = createStore('broker-alpha', ns);
  const pk = `E${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  const renewed = await store.renewObserverClaim(pk);
  assert.equal(renewed, false);
});

test('renewObserverClaim returns false when claim was taken by another instance', async () => {
  const ns = testNamespace();
  const alpha = createStore('broker-alpha', ns);
  const beta = createStore('broker-beta', ns);
  const pk = `F${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  await alpha.claimObserver(pk);
  await beta.claimObserver(pk);
  const renewed = await alpha.renewObserverClaim(pk);
  assert.equal(renewed, false);
});

test('renewObserverClaim refreshes TTL on owned claim', async () => {
  const ns = testNamespace();
  const store = createStore('broker-alpha', ns);
  const redis = new Redis(kvUrl(), { maxRetriesPerRequest: 1 });
  const pk = `G${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  try {
    await store.claimObserver(pk);

    // Check TTL was set
    const key = `${ns}:observers:${pk}:claim`;
    let ttl = await redis.pttl(key);
    assert.ok(ttl > 0, `expected positive TTL, got ${ttl}`);

    // Wait a tiny bit and renew
    await new Promise((r) => setTimeout(r, 50));
    const renewed = await store.renewObserverClaim(pk);
    assert.equal(renewed, true);

    // TTL should have been refreshed
    const ttlAfter = await redis.pttl(key);
    assert.ok(ttlAfter > 0, `expected positive TTL after renew, got ${ttlAfter}`);
  } finally {
    await redis.quit();
  }
});

test('getObserverClaim returns correct owner', async () => {
  const ns = testNamespace();
  const alpha = createStore('broker-alpha', ns);
  const beta = createStore('broker-beta', ns);
  const pk = `H${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  await alpha.claimObserver(pk);
  const owner1 = await alpha.getObserverClaim(pk);
  assert.equal(owner1, 'broker-alpha');

  await beta.claimObserver(pk);
  const owner2 = await beta.getObserverClaim(pk);
  assert.equal(owner2, 'broker-beta');
});

test('getObserverClaim returns null for unclaimed observer', async () => {
  const ns = testNamespace();
  const store = createStore('broker-alpha', ns);
  const pk = `I${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  const owner = await store.getObserverClaim(pk);
  assert.equal(owner, null);
});

test('claims are independent per public key', async () => {
  const ns = testNamespace();
  const alpha = createStore('broker-alpha', ns);
  const beta = createStore('broker-beta', ns);
  const pk1 = `J1${uniqueId().replace(/-/g, '').toUpperCase().padEnd(62, 'F')}`.slice(0, 64);
  const pk2 = `J2${uniqueId().replace(/-/g, '').toUpperCase().padEnd(62, 'F')}`.slice(0, 64);

  await alpha.claimObserver(pk1);
  await beta.claimObserver(pk2);

  assert.equal(await alpha.getObserverClaim(pk1), 'broker-alpha');
  assert.equal(await beta.getObserverClaim(pk2), 'broker-beta');
  assert.equal(await alpha.getObserverClaim(pk2), 'broker-beta');
  assert.equal(await beta.getObserverClaim(pk1), 'broker-alpha');
});

test('claims are isolated by Valkey namespace', async () => {
  const ns1 = testNamespace();
  const ns2 = testNamespace();
  const store1 = createStore('broker-a', ns1);
  const store2 = createStore('broker-b', ns2);
  const pk = `K${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  await store1.claimObserver(pk);
  await store2.claimObserver(pk);

  assert.equal(await store1.getObserverClaim(pk), 'broker-a');
  assert.equal(await store2.getObserverClaim(pk), 'broker-b');
});

test('concurrent claims from multiple instances resolve to a single winner', async () => {
  const ns = testNamespace();
  const instances = [
    createStore('broker-1', ns),
    createStore('broker-2', ns),
    createStore('broker-3', ns),
    createStore('broker-4', ns),
    createStore('broker-5', ns),
  ];
  const pk = `L${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  const results = await Promise.all(instances.map((s) => s.claimObserver(pk)));

  // Exactly one claimObserver must return null (the first to execute in Redis)
  const nullCount = results.filter((r) => r === null).length;
  assert.equal(nullCount, 1, `expected exactly one first claim, got ${nullCount}`);

  // Every non-null result must be a non-empty string (the previous owner)
  for (const r of results) {
    if (r !== null) {
      assert.ok(typeof r === 'string' && r.length > 0, `expected previous owner string, got ${r}`);
    }
  }

  // One instance must currently own the claim (the last GETSET in the race)
  const renewResults = await Promise.all(instances.map((s) => s.renewObserverClaim(pk)));
  const ownerCount = renewResults.filter((r) => r === true).length;
  assert.equal(ownerCount, 1, `expected exactly one claim owner, got ${ownerCount}`);
});

test('expired claim can be reclaimed by any instance', async () => {
  const ns = testNamespace();
  const alpha = createStore('broker-alpha', ns);
  const beta = createStore('broker-beta', ns);
  const redis = new Redis(kvUrl(), { maxRetriesPerRequest: 1 });
  const pk = `M${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  try {
    await alpha.claimObserver(pk);
    assert.equal(await alpha.getObserverClaim(pk), 'broker-alpha');

    const key = `${ns}:observers:${pk}:claim`;
    await redis.del(key);

    assert.equal(await alpha.renewObserverClaim(pk), false);
    assert.equal(await alpha.getObserverClaim(pk), null);

    const previous = await beta.claimObserver(pk);
    assert.equal(previous, null);
    assert.equal(await beta.getObserverClaim(pk), 'broker-beta');
  } finally {
    await redis.quit();
  }
});

test('full lifecycle: claim -> renew -> takeover -> reclaim after expiry', async () => {
  const ns = testNamespace();
  const alpha = createStore('broker-alpha', ns);
  const beta = createStore('broker-beta', ns);
  const gamma = createStore('broker-gamma', ns);
  const redis = new Redis(kvUrl(), { maxRetriesPerRequest: 1 });
  const pk = `N${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);

  try {
    assert.equal(await alpha.claimObserver(pk), null);
    assert.equal(await alpha.renewObserverClaim(pk), true);

    assert.equal(await beta.claimObserver(pk), 'broker-alpha');
    assert.equal(await alpha.renewObserverClaim(pk), false);
    assert.equal(await beta.renewObserverClaim(pk), true);
    assert.equal(await beta.getObserverClaim(pk), 'broker-beta');

    assert.equal(await gamma.claimObserver(pk), 'broker-beta');
    assert.equal(await beta.renewObserverClaim(pk), false);
    assert.equal(await gamma.renewObserverClaim(pk), true);

    const key = `${ns}:observers:${pk}:claim`;
    await redis.del(key);

    assert.equal(await alpha.claimObserver(pk), null);
    assert.equal(await alpha.renewObserverClaim(pk), true);
    assert.equal(await alpha.getObserverClaim(pk), 'broker-alpha');
  } finally {
    await redis.quit();
  }
});
