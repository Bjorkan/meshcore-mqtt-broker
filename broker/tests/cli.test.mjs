import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from '@jest/globals';
import { resetConfigCacheForTests, setConfigDocumentForTests } from '../dist/config.js';
import { ClusterStateStore } from '../dist/orchestration.js';
import { runCli } from '../dist/cli.js';

function uniqueId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function kvUrl() {
  return process.env.TEST_BROKER_KV_URL || 'redis://127.0.0.1:6379';
}

function testNamespace() {
  return `meshcore-cli-test-${uniqueId()}`;
}

function publicKey(prefix) {
  return `${prefix}${uniqueId().replace(/-/g, '').toUpperCase().padEnd(64, 'F')}`.slice(0, 64);
}

function createStore(instanceId, namespace) {
  const store = new ClusterStateStore({
    kvUrl: kvUrl(),
    namespace,
    instanceId,
    backgroundRefresh: false,
  });
  stores.push(store);
  return store;
}

async function captureCli(argv, config, dependencies = {}) {
  const originalLog = console.log;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];

  setConfigDocumentForTests(config);
  console.log = (...args) => stdout.push(args.join(' '));
  console.error = (...args) => stderr.push(args.join(' '));

  try {
    const code = await runCli(argv, dependencies);
    return {
      code,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    resetConfigCacheForTests();
  }
}

const stores = [];
const tempDirs = [];

async function configForInstance(namespace, instanceId) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'meshcore-cli-id-test-'));
  tempDirs.push(tempDir);
  const runtimeIdFile = path.join(tempDir, 'broker-id');
  await writeFile(runtimeIdFile, `${instanceId}\n`);
  return {
    broker: {
      kv_url: kvUrl(),
      kv_namespace: namespace,
      runtime_id_file: runtimeIdFile,
    },
  };
}

afterEach(async () => {
  for (const store of stores.splice(0)) {
    await store.close().catch(() => {});
  }
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { recursive: true, force: true });
  }
  resetConfigCacheForTests();
});

test('mc-mqtt status reports this instance and cluster instances', async () => {
  const namespace = testNamespace();
  const alpha = createStore('broker-alpha', namespace);
  const beta = createStore('broker-beta', namespace);
  await alpha.ready();
  await beta.ready();
  await alpha.setInstanceMetrics({
    instanceId: 'broker-alpha',
    connectedClients: 2,
    subscriberClients: 0,
    publisherClients: 2,
    messagesPerSecond: 1,
    messagesLastMinute: 60,
    activeBans: 0,
    localReady: true,
    startedAt: 1_800_000_000_000,
    lastUpdatedAt: Date.now(),
    lastUpdatedByInstance: 'broker-alpha',
  });
  await beta.setInstanceMetrics({
    instanceId: 'broker-beta',
    connectedClients: 1,
    subscriberClients: 0,
    publisherClients: 1,
    messagesPerSecond: 0.5,
    messagesLastMinute: 30,
    activeBans: 0,
    localReady: true,
    startedAt: 1_800_000_001_000,
    lastUpdatedAt: Date.now(),
    lastUpdatedByInstance: 'broker-beta',
  });

  const config = await configForInstance(namespace, 'broker-alpha');

  const local = await captureCli(['status'], config);
  assert.equal(local.code, 0);
  assert.match(local.stdout, /broker-alpha/);
  assert.doesNotMatch(local.stdout, /broker-beta/);

  const cluster = await captureCli(['status', '--cluster'], config);
  assert.equal(cluster.code, 0);
  assert.match(cluster.stdout, /broker-alpha/);
  assert.match(cluster.stdout, /broker-beta/);
});

test('mc-mqtt observer list uses Valkey claims for local and cluster views', async () => {
  const namespace = testNamespace();
  const alpha = createStore('broker-alpha', namespace);
  const beta = createStore('broker-beta', namespace);
  const alphaKey = publicKey('A');
  const betaKey = publicKey('B');

  await alpha.claimObserver(alphaKey);
  await beta.claimObserver(betaKey);
  await alpha.setObserverNodeName(alphaKey, 'alpha-node', 60_000);
  await beta.setObserverNodeName(betaKey, 'beta-node', 60_000);
  await alpha.setInstanceObservers([{
    label: 'alpha-node',
    publicKey: alphaKey,
    broker: 'broker-alpha',
    region: 'GOT',
    active: true,
    lastConnectedAt: Date.now(),
    lastSeenAt: Date.now(),
    messageCount: 7,
    messages: [],
  }]);
  await beta.setInstanceObservers([{
    label: 'beta-node',
    publicKey: betaKey,
    broker: 'broker-beta',
    region: 'ARN',
    active: true,
    lastConnectedAt: Date.now(),
    lastSeenAt: Date.now(),
    messageCount: 3,
    messages: [],
  }]);

  const config = await configForInstance(namespace, 'broker-alpha');

  const local = await captureCli(['observer', 'list'], config);
  assert.match(local.stdout, /alpha-node/);
  assert.doesNotMatch(local.stdout, /beta-node/);

  const cluster = await captureCli(['observer', 'list', '--cluster'], config);
  assert.match(cluster.stdout, /alpha-node/);
  assert.match(cluster.stdout, /beta-node/);
});

test('mc-mqtt abuse list, remove, and clearall manage Valkey ban state', async () => {
  const namespace = testNamespace();
  const store = createStore('broker-alpha', namespace);
  const firstKey = publicKey('C');
  const secondKey = publicKey('D');
  const config = await configForInstance(namespace, 'broker-alpha');

  await store.setTrustState(firstKey, JSON.stringify({
    status: 'muted',
    muteReason: 'rate_limit_exceeded',
    abuseBlockCount: 2,
    mutedUntil: Date.now() + 60_000,
  }));
  await store.setTrustState(secondKey, JSON.stringify({
    status: 'would_mute',
    muteReason: 'anomaly:packet_size',
    abuseBlockCount: 1,
  }));

  const listed = await captureCli(['abuse', 'list'], config);
  assert.match(listed.stdout, new RegExp(firstKey.slice(0, 10)));
  assert.match(listed.stdout, new RegExp(secondKey.slice(0, 10)));

  const removed = await captureCli(['abuse', 'remove', firstKey], config);
  assert.match(removed.stdout, /Tog bort nekad post/);
  const afterRemove = await captureCli(['abuse', 'list'], config);
  assert.doesNotMatch(afterRemove.stdout, new RegExp(firstKey.slice(0, 10)));
  assert.match(afterRemove.stdout, new RegExp(secondKey.slice(0, 10)));

  const cleared = await captureCli(['abuse', 'clearall'], config);
  assert.match(cleared.stdout, /1 nekad post borttagen/);
  const afterClear = await captureCli(['abuse', 'list'], config);
  assert.match(afterClear.stdout, /\(tomt\)/);
});

test('mc-mqtt reset requires confirmation and clears the Valkey namespace', async () => {
  const namespace = testNamespace();
  const store = createStore('broker-alpha', namespace);
  const pk = publicKey('E');
  const config = await configForInstance(namespace, 'broker-alpha');

  await store.ready();
  await store.claimObserver(pk);
  await store.setObserverNodeName(pk, 'reset-node', 60_000);
  await store.setInstanceMetrics({
    instanceId: 'broker-alpha',
    connectedClients: 1,
    subscriberClients: 0,
    publisherClients: 1,
    messagesPerSecond: 0,
    messagesLastMinute: 0,
    activeBans: 0,
    localReady: true,
    startedAt: 1_800_000_000_000,
    lastUpdatedAt: Date.now(),
    lastUpdatedByInstance: 'broker-alpha',
  });
  await store.setTrustState(pk, JSON.stringify({
    status: 'muted',
    muteReason: 'rate_limit_exceeded',
    abuseBlockCount: 1,
  }));

  const cancelled = await captureCli(['reset'], config, { confirmReset: async () => false });
  assert.equal(cancelled.code, 0);
  assert.match(cancelled.stdout, /Avbrutet/);
  assert.equal(await store.getObserverClaim(pk), 'broker-alpha');
  assert.equal((await store.listInstanceMetrics()).length, 1);
  assert.equal((await store.listPublicBans()).length, 1);

  const reset = await captureCli(['reset'], config, { confirmReset: async (confirmedNamespace) => {
    assert.equal(confirmedNamespace, namespace);
    return true;
  } });
  assert.equal(reset.code, 0);
  assert.match(reset.stdout, /Valkey namespace/);
  assert.equal(await store.getObserverClaim(pk), null);
  assert.deepEqual(await store.listInstanceMetrics(), []);
  assert.deepEqual(await store.listPublicBans(), []);
});
