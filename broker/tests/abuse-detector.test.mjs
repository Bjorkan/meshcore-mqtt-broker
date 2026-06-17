import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { AbuseDetector } from '../dist/abuse-detector.js';
import { formatBrokerLog, stockholmTimestamp } from '../dist/logger.js';

const PUBLIC_KEY = '4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E';
const detectors = [];

afterEach(() => {
  while (detectors.length > 0) {
    detectors.pop().shutdown();
  }
});

async function createDetector(overrides = {}) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'meshcore-abuse-test-'));
  const detector = new AbuseDetector({
    duplicateWindowSize: 100000,
    duplicateWindowMs: 300000,
    duplicateThreshold: 10,
    maxDuplicatesPerPacket: 100000,
    duplicateRateThreshold: 1,
    duplicateRateWindowMs: 300000,
    bucketCapacity: 20000,
    bucketRefillRate: 0,
    maxPacketSize: 255,
    maxTopicsPerDay: 3,
    anomalyThreshold: 100000,
    maxIataChanges24h: 3,
    topicHistorySize: 50,
    topicHistoryWindowMs: 86400000,
    persistencePath: path.join(tmpDir, 'abuse-detection.db'),
    persistenceIntervalMs: 300000,
    enforcementEnabled: false,
    ...overrides,
  });

  detectors.push(detector);
  detector.initializeClient(PUBLIC_KEY, `v1_${PUBLIC_KEY}`, '127.0.0.1');
  return detector;
}

async function withConsoleLogSilenced(callback) {
  const originalLog = console.log;
  console.log = () => {};

  try {
    return await callback();
  } finally {
    console.log = originalLog;
  }
}

async function withFakeNow(initialNow, callback) {
  const originalNow = Date.now;
  let currentNow = initialNow;
  Date.now = () => currentNow;

  try {
    return await callback((nextNow) => {
      currentNow = nextNow;
    });
  } finally {
    Date.now = originalNow;
  }
}

test('bounds peak rate timestamps and anomaly history', async () => {
  await withConsoleLogSilenced(async () => {
    const detector = await createDetector();
    const client = { publicKey: PUBLIC_KEY };

    for (let index = 0; index < 10050; index++) {
      const packet = {
        payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: `${index.toString(16).padStart(4, '0')}` })),
      };
      assert.equal(detector.recordPacket(client, packet), true);
    }

    const oversizedRaw = 'aa'.repeat(300);
    for (let index = 0; index < 150; index++) {
      const packet = {
        payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: `${oversizedRaw}${index.toString(16)}` })),
      };
      detector.recordPacket(client, packet);
    }

    const state = detector.getClientStats(PUBLIC_KEY);
    assert.ok(state.peakRateWindow.packets.length <= 10000);
    assert.ok(state.anomalies.length <= 100);
  });
});

test('formats broker logs with explicit Europe/Stockholm timestamp', () => {
  const date = new Date('2026-06-17T19:14:03.245Z');

  assert.equal(stockholmTimestamp(date), '2026-06-17 21:14:03.245 Europe/Stockholm');
  assert.equal(
    formatBrokerLog('WARN', ['[TEST] händelse %s', 'klar'], date),
    '2026-06-17 21:14:03.245 Europe/Stockholm WARN [TEST] händelse klar'
  );
});

test('expires first abuse block after 1h and escalates later blocks to 6h', async () => {
  await withConsoleLogSilenced(async () => {
    await withFakeNow(1_800_000_000_000, async (setNow) => {
      const detector = await createDetector({
        enforcementEnabled: true,
        bucketCapacity: 1,
        bucketRefillRate: 0,
      });
      const client = { publicKey: PUBLIC_KEY };

      assert.equal(detector.recordPacket(client, {
        payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: '00' })),
      }), true);
      assert.equal(detector.recordPacket(client, {
        payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: '01' })),
      }), false);

      const firstState = detector.getClientStats(PUBLIC_KEY);
      assert.equal(firstState.status, 'muted');
      assert.equal(firstState.abuseBlockCount, 1);
      assert.equal(firstState.mutedUntil - firstState.mutedAt, 60 * 60 * 1000);
      assert.equal(detector.shouldSilencePacket(client), true);

      setNow(firstState.mutedUntil + 1);
      assert.equal(detector.shouldSilencePacket(client), false);
      assert.equal(firstState.status, 'allowed');

      assert.equal(detector.recordPacket(client, {
        payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: '02' })),
      }), true);
      assert.equal(detector.recordPacket(client, {
        payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: '03' })),
      }), false);

      const secondState = detector.getClientStats(PUBLIC_KEY);
      assert.equal(secondState.status, 'muted');
      assert.equal(secondState.abuseBlockCount, 2);
      assert.equal(secondState.mutedUntil - secondState.mutedAt, 6 * 60 * 60 * 1000);
    });
  });
});

test('detects duplicate packet payloads by raw field instead of full JSON envelope', async () => {
  await withConsoleLogSilenced(async () => {
    const detector = await createDetector({
      maxDuplicatesPerPacket: 1,
      anomalyThreshold: 100000,
    });
    const client = { publicKey: PUBLIC_KEY };

    assert.equal(detector.recordPacket(client, {
      topic: `meshcore/test/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: 'AABB', RSSI: -80 })),
    }), true);

    assert.equal(detector.recordPacket(client, {
      topic: `meshcore/test/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(JSON.stringify({ RSSI: -95, raw: 'aabb', origin_id: PUBLIC_KEY })),
    }), false);

    const state = detector.getClientStats(PUBLIC_KEY);
    assert.equal(state.duplicateCount, 1);
  });
});

test('does not run packet duplicate policy for status messages', async () => {
  await withConsoleLogSilenced(async () => {
    const detector = await createDetector({
      maxDuplicatesPerPacket: 1,
      anomalyThreshold: 100000,
    });
    const client = { publicKey: PUBLIC_KEY };
    const packet = {
      topic: `meshcore/test/${PUBLIC_KEY}/status`,
      payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, timestamp: '2026-01-01T00:00:00.000Z' })),
    };

    assert.equal(detector.recordPacket(client, packet), true);
    assert.equal(detector.recordPacket(client, packet), true);

    const state = detector.getClientStats(PUBLIC_KEY);
    assert.equal(state.duplicateCount, 0);
  });
});
