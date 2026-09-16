import assert from "node:assert/strict";
import { afterEach, spyOn, test } from "bun:test";

import { AbuseDetector } from "../src/abuse-detector.js";

const PUBLIC_KEY =
  "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";
const detectors = [];

afterEach(() => {
  while (detectors.length > 0) {
    detectors.pop().shutdown();
  }
});

function createDetector(overrides = {}) {
  const detector = new AbuseDetector(makeDetectorConfig(overrides));

  detectors.push(detector);
  detector.initializeClient(PUBLIC_KEY, `v1_${PUBLIC_KEY}`);
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
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});

  try {
    return await callback();
  } finally {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

async function withFakeNow(initialNow, callback) {
  let currentNow = initialNow;
  const nowSpy = spyOn(Date, "now").mockImplementation(() => currentNow);

  try {
    return await callback((nextNow) => {
      currentNow = nextNow;
    });
  } finally {
    nowSpy.mockRestore();
  }
}

test("bounds peak rate timestamps and anomaly history", async () => {
  await withConsoleLogSilenced(async () => {
    const detector = await createDetector();
    const client = { publicKey: PUBLIC_KEY };

    for (let index = 0; index < 10050; index++) {
      const packet = {
        payload: Buffer.from(
          JSON.stringify({
            origin_id: PUBLIC_KEY,
            raw: `${index.toString(16).padStart(4, "0")}`,
          }),
        ),
      };
      assert.equal(detector.recordPacket(client, packet), true);
    }

    const oversizedRaw = "aa".repeat(300);
    for (let index = 0; index < 150; index++) {
      const packet = {
        payload: Buffer.from(
          JSON.stringify({
            origin_id: PUBLIC_KEY,
            raw: `${oversizedRaw}${index.toString(16)}`,
          }),
        ),
      };
      detector.recordPacket(client, packet);
    }

    const state = detector.getClientStats(PUBLIC_KEY);
    assert.ok(state.peakRateWindow.packets.length <= 10000);
    assert.ok(state.anomalies.length <= 100);
  });
});

test("observe-only: excessive rate is logged but never mutes", async () => {
  await withConsoleLogSilenced(async () => {
    await withFakeNow(1_800_000_000_000, async () => {
      const detector = await createDetector({
        enforcementEnabled: true,
        bucketCapacity: 1,
        bucketRefillRate: 0,
      });
      const client = { publicKey: PUBLIC_KEY };

      for (const raw of ["00", "01", "02"]) {
        assert.equal(
          detector.recordPacket(client, {
            payload: Buffer.from(
              JSON.stringify({ origin_id: PUBLIC_KEY, raw }),
            ),
          }),
          true,
        );
      }

      const state = detector.getClientStats(PUBLIC_KEY);
      assert.equal(state.status, "allowed");
      assert.equal(detector.shouldSilencePacket(client), false);
      assert.equal(detector.isEnforcementEnabled(), false);
      detector.muteClient(state, "rate_limit_exceeded", "test");
      assert.equal(state.status, "allowed");
    });
  });
});

test("observe-only: duplicate observations never deny", async () => {
  await withConsoleLogSilenced(async () => {
    const detector = await createDetector({
      maxDuplicatesPerPacket: 1,
      anomalyThreshold: 100000,
    });
    const client = { publicKey: PUBLIC_KEY };

    assert.equal(
      detector.recordPacket(client, {
        topic: `meshcore/test/${PUBLIC_KEY}/packets`,
        payload: Buffer.from(
          JSON.stringify({ origin_id: PUBLIC_KEY, raw: "AABB", RSSI: -80 }),
        ),
      }),
      true,
    );

    assert.equal(
      detector.recordPacket(client, {
        topic: `meshcore/test/${PUBLIC_KEY}/packets`,
        payload: Buffer.from(
          JSON.stringify({ RSSI: -95, raw: "aabb", origin_id: PUBLIC_KEY }),
        ),
      }),
      true,
    );

    const state = detector.getClientStats(PUBLIC_KEY);
    assert.equal(state.duplicateCount, 1);
    assert.equal(state.status, "allowed");
  });
});

test("does not run packet duplicate policy for status messages", async () => {
  await withConsoleLogSilenced(async () => {
    const detector = await createDetector({
      maxDuplicatesPerPacket: 1,
      anomalyThreshold: 100000,
    });
    const client = { publicKey: PUBLIC_KEY };
    const packet = {
      topic: `meshcore/test/${PUBLIC_KEY}/status`,
      payload: Buffer.from(
        JSON.stringify({
          origin_id: PUBLIC_KEY,
          timestamp: "2026-01-01T00:00:00.000Z",
        }),
      ),
    };

    assert.equal(detector.recordPacket(client, packet), true);
    assert.equal(detector.recordPacket(client, packet), true);

    const state = detector.getClientStats(PUBLIC_KEY);
    assert.equal(state.duplicateCount, 0);
  });
});

test("tracks frequent IATA changes without muting publishers", async () => {
  await withConsoleLogSilenced(async () => {
    const detector = await createDetector({
      enforcementEnabled: true,
      maxIataChanges24h: 1,
    });
    const state = detector.getClientStats(PUBLIC_KEY);

    assert.equal(detector.checkIataChange(state, "GSE"), true);
    assert.equal(detector.checkIataChange(state, "GOT"), true);
    assert.equal(detector.checkIataChange(state, "STO"), true);

    assert.equal(state.status, "allowed");
    assert.equal(state.muteReason, undefined);
    assert.equal(state.currentIata, "STO");
    assert.deepEqual(
      state.iataHistory.map((entry) => entry.iata),
      ["GSE", "GOT", "STO"],
    );
    assert.equal(state.iataChangeCount24h, 3);
  });
});

test("re-initializing a client keeps process-local state", async () => {
  await withConsoleLogSilenced(async () => {
    const detector = await createDetector();
    const original = detector.getClientStats(PUBLIC_KEY);

    assert.doesNotThrow(() =>
      detector.initializeClient(PUBLIC_KEY, `v1_${PUBLIC_KEY}`),
    );
    assert.equal(detector.getClientStats(PUBLIC_KEY), original);
  });
});

test("backward wall-clock jumps do not remove rate-limit tokens", async () => {
  await withConsoleLogSilenced(async () => {
    await withFakeNow(2_000, async (setNow) => {
      const detector = await createDetector({
        bucketCapacity: 10,
        bucketRefillRate: 1,
      });
      const state = detector.getClientStats(PUBLIC_KEY);
      state.tokenBucket.tokens = 5;
      state.tokenBucket.lastRefill = 2_000;

      setNow(1_000);
      assert.equal(detector.checkRateLimit(state), true);
      assert.equal(state.tokenBucket.tokens, 4);
    });
  });
});

test("evicts inactive client trust state", async () => {
  await withConsoleLogSilenced(async () => {
    await withFakeNow(1_800_000_000_000, async (setNow) => {
      const detector = await createDetector();

      assert.notEqual(detector.getClientStats(PUBLIC_KEY), undefined);
      assert.equal(
        detector.evictInactiveClients(
          1_800_000_000_000 + 31 * 86_400_000,
          30 * 86_400_000,
        ),
        1,
      );
      assert.equal(detector.getClientStats(PUBLIC_KEY), undefined);

      const rehydrated = await createDetector();
      assert.equal(rehydrated.getClientStats(PUBLIC_KEY) !== undefined, true);
      setNow(1_800_000_000_000 + 30 * 86_400_000);
      assert.equal(
        rehydrated.recordPacket(
          { publicKey: PUBLIC_KEY },
          { payload: Buffer.from("x") },
        ),
        true,
      );
      assert.equal(
        rehydrated.evictInactiveClients(
          1_800_000_000_000 + 31 * 86_400_000,
          30 * 86_400_000,
        ),
        0,
      );
      setNow(1_800_000_000_000);
    });
  });
});
