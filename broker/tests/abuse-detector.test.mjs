import assert from 'node:assert/strict';
import { afterEach, test } from '@jest/globals';

import { AbuseDetector } from '../dist/abuse-detector.js';
import { colorizeLogBrackets, colorizeLogLine, formatBrokerLog, setBrokerLogContext, stockholmLogTime, stockholmTimestamp } from '../dist/logger.js';

const PUBLIC_KEY = '4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E';
const detectors = [];

afterEach(() => {
  while (detectors.length > 0) {
    detectors.pop().shutdown();
  }
});

function createDetector(overrides = {}) {
  const detector = new AbuseDetector(makeDetectorConfig(overrides));

  detectors.push(detector);
  detector.initializeClient(PUBLIC_KEY, `v1_${PUBLIC_KEY}`, '127.0.0.1');
  return detector;
}

function makeDetectorConfig(overrides = {}) {
  return {
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
    enforcementEnabled: false,
    ...overrides,
  };
}

async function withConsoleLogSilenced(callback) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};

  try {
    return await callback();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

async function withConsoleLogCaptured(callback) {
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => {
    logs.push(args.map((arg) => String(arg)).join(' '));
  };

  try {
    return await callback(logs);
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
  setBrokerLogContext();

  assert.equal(stockholmTimestamp(date), '2026-06-17 21:14:03.245 Europe/Stockholm');
  assert.equal(stockholmLogTime(date), '21:14');
  assert.equal(
    formatBrokerLog('WARN', ['[TEST] händelse %s', 'klar'], date),
    '[TEST 21:14] WARN händelse klar'
  );
  assert.equal(
    formatBrokerLog('INFO', ['Broker startad'], date),
    '[Broker 21:14] Broker startad'
  );
  assert.equal(
    formatBrokerLog('INFO', ['[SE-STO-TEST (040680)] [MQTT] Tog emot PINGREQ (PING) från klient'], date),
    '[MQTT 21:14] Tog emot PINGREQ (PING) från SE-STO-TEST (040680)'
  );
  assert.equal(
    formatBrokerLog('INFO', ['[okänd klient (040680)] [MQTT] Skickar PINGRESP (PONG) till klient'], date),
    '[MQTT 21:14] Skickar PINGRESP (PONG) till okänd klient (040680)'
  );
  assert.equal(
    formatBrokerLog('INFO', ['[MISSBRUK] [4852B693] Initierade tillitsspårning'], date),
    '[MISSBRUK 21:14] [4852B693] Initierade tillitsspårning'
  );
});

test('formats broker logs with optional multi-container instance context', () => {
  const date = new Date('2026-06-17T19:14:03.245Z');

  try {
    setBrokerLogContext({ instanceId: 'broker-a', namespace: 'meshcore-prod' });

    assert.equal(
      formatBrokerLog('INFO', ['[VALKEY] PING OK'], date),
      '[VALKEY 21:14 instans=broker-a ns=meshcore-prod] PING OK'
    );
    assert.equal(
      formatBrokerLog('WARN', ['[TEST] händelse'], date),
      '[TEST 21:14 instans=broker-a ns=meshcore-prod] WARN händelse'
    );
  } finally {
    setBrokerLogContext();
  }
});

test('colorizes broker logs semantically', () => {
  const originalNoColor = process.env.NO_COLOR;
  const originalLogColor = process.env.LOG_COLOR;
  setBrokerLogContext();
  delete process.env.NO_COLOR;
  delete process.env.LOG_COLOR;

  try {
    assert.equal(
      colorizeLogBrackets('[TEST 21:14] WARN [BEHÖRIGHET] händelse klar'),
      '[\x1b[36mTEST 21:14\x1b[0m] WARN [\x1b[33mBEHÖRIGHET\x1b[0m] händelse klar'
    );
    assert.match(
      formatBrokerLog('INFO', ['[TEST] händelse [KLIENT]'], new Date('2026-06-17T19:14:03.245Z'), true),
      /^\[\x1b\[36mTEST 21:14\x1b\[0m\] händelse \[KLIENT\]$/
    );
    assert.match(
      colorizeLogLine('[MQTT 21:14] Forwarded meshcore/SE/040680/status -> mshse/meshcore/SE/040680/status'),
      /\x1b\[32mForwarded\x1b\[0m/
    );
    assert.match(
      colorizeLogLine('[FILTRERING 21:14] DEBUG Kunde inte tolka statusmeddelande: <fel>'),
      /\x1b\[91mKunde inte\x1b\[0m/
    );

    process.env.NO_COLOR = '1';
    assert.equal(colorizeLogBrackets('[TEST] händelse'), '[TEST] händelse');
  } finally {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }

    if (originalLogColor === undefined) {
      delete process.env.LOG_COLOR;
    } else {
      process.env.LOG_COLOR = originalLogColor;
    }
  }
});

function publishUntilRateLimited(detector, client, raw) {
  assert.equal(detector.recordPacket(client, {
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: `${raw}0` })),
  }), true);
  assert.equal(detector.recordPacket(client, {
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: `${raw}1` })),
  }), false);
}

test('expires abuse blocks at 15m, 1h, 24h and resets escalation weekly', async () => {
  await withConsoleLogSilenced(async () => {
    await withFakeNow(1_800_000_000_000, async (setNow) => {
      const detector = await createDetector({
        enforcementEnabled: true,
        bucketCapacity: 1,
        bucketRefillRate: 0,
      });
      const client = { publicKey: PUBLIC_KEY };

      publishUntilRateLimited(detector, client, '0');

      const firstState = detector.getClientStats(PUBLIC_KEY);
      assert.equal(firstState.status, 'muted');
      assert.equal(firstState.abuseBlockCount, 1);
      assert.equal(firstState.abuseBlockCountWindowStartedAt, firstState.mutedAt);
      assert.equal(firstState.mutedUntil - firstState.mutedAt, 15 * 60 * 1000);
      assert.equal(detector.shouldSilencePacket(client), true);

      setNow(firstState.mutedUntil + 1);
      assert.equal(detector.shouldSilencePacket(client), false);
      assert.equal(firstState.status, 'allowed');

      publishUntilRateLimited(detector, client, '1');

      const secondState = detector.getClientStats(PUBLIC_KEY);
      assert.equal(secondState.status, 'muted');
      assert.equal(secondState.abuseBlockCount, 2);
      assert.equal(secondState.abuseBlockCountWindowStartedAt, firstState.abuseBlockCountWindowStartedAt);
      assert.equal(secondState.mutedUntil - secondState.mutedAt, 60 * 60 * 1000);

      setNow(secondState.mutedUntil + 1);
      assert.equal(detector.shouldSilencePacket(client), false);

      publishUntilRateLimited(detector, client, '2');

      const thirdState = detector.getClientStats(PUBLIC_KEY);
      assert.equal(thirdState.status, 'muted');
      assert.equal(thirdState.abuseBlockCount, 3);
      assert.equal(thirdState.mutedUntil - thirdState.mutedAt, 24 * 60 * 60 * 1000);

      setNow(thirdState.mutedUntil + 7 * 24 * 60 * 60 * 1000 + 1);
      assert.equal(detector.shouldSilencePacket(client), false);

      publishUntilRateLimited(detector, client, '3');

      const weeklyResetState = detector.getClientStats(PUBLIC_KEY);
      assert.equal(weeklyResetState.status, 'muted');
      assert.equal(weeklyResetState.abuseBlockCount, 1);
      assert.equal(weeklyResetState.mutedUntil - weeklyResetState.mutedAt, 15 * 60 * 1000);
      assert.equal(weeklyResetState.abuseBlockCountWindowStartedAt, weeklyResetState.mutedAt);
    });
  });
});

test('logs clear abuse trigger and block escalation details', async () => {
  await withFakeNow(1_800_000_000_000, async () => {
    await withConsoleLogCaptured(async (logs) => {
      const detector = await createDetector({
        enforcementEnabled: true,
        bucketCapacity: 1,
        bucketRefillRate: 0,
      });
      const client = { publicKey: PUBLIC_KEY };

      publishUntilRateLimited(detector, client, 'a');

      assert.ok(logs.some((line) => line.includes('Trigger: hastighetsgräns överskreds')));
      assert.ok(logs.some((line) => line.includes('tokens=0.00') && line.includes('payload=')));
      assert.ok(logs.some((line) => line.includes('TYSTAD') && line.includes('längd=15 min')));
      assert.ok(logs.some((line) => line.includes('eskaleringssteg=1') && line.includes('veckoreset=ja')));
      assert.ok(logs.some((line) => line.includes('till=2027-01-15T08:15:00.000Z')));
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

test('tracks frequent IATA changes without muting publishers', async () => {
  await withConsoleLogSilenced(async () => {
    const detector = await createDetector({
      enforcementEnabled: true,
      maxIataChanges24h: 1,
    });
    const state = detector.getClientStats(PUBLIC_KEY);

    assert.equal(detector.checkIataChange(state, 'GSE'), true);
    assert.equal(detector.checkIataChange(state, 'GOT'), true);
    assert.equal(detector.checkIataChange(state, 'STO'), true);

    assert.equal(state.status, 'allowed');
    assert.equal(state.muteReason, undefined);
    assert.equal(state.currentIata, 'STO');
    assert.deepEqual(state.iataHistory.map((entry) => entry.iata), ['GSE', 'GOT', 'STO']);
    assert.equal(state.iataChangeCount24h, 3);
  });
});
