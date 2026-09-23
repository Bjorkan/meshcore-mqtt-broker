import assert from "node:assert/strict";
import { spyOn, test } from "bun:test";

import { AbuseDetector } from "../src/abuse-detector.js";

const PUBLIC_KEY =
  "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";

function createDetector(overrides = {}) {
  const detector = new AbuseDetector(makeDetectorConfig(overrides));

  detector.initializeClient(PUBLIC_KEY, `v1_${PUBLIC_KEY}`);
  return detector;
}

function makeDetectorConfig(overrides = {}) {
  return {
    duplicateWindowSize: 100000,
    duplicateWindowMs: 300000,
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

test("peak rate reflects bursts, not a frozen 0.1 pps", async () => {
  await withConsoleLogSilenced(async () => {
    await withFakeNow(1_800_000_000_000, async () => {
      const detector = await createDetector({
        bucketCapacity: 100000,
        bucketRefillRate: 100000,
      });
      const client = { publicKey: PUBLIC_KEY };
      for (let index = 0; index < 100; index++) {
        detector.recordPacket(client, {
          topic: `meshcore/STO/${PUBLIC_KEY}/packets`,
          payload: Buffer.from(
            JSON.stringify({ origin_id: PUBLIC_KEY, raw: `${index}` }),
          ),
        });
      }
      const state = detector.getClientStats(PUBLIC_KEY);
      // 100 packets inside one 10 s window = 10 pps, not 0.1.
      assert.ok(state.peakRateObserved >= 9.9);
    });
  });
});

test("peak rate resets after an hour without packets", async () => {
  await withConsoleLogSilenced(async () => {
    const start = 1_800_000_000_000;
    await withFakeNow(start, async (setNow) => {
      const detector = createDetector();
      const client = { publicKey: PUBLIC_KEY };
      const packet = {
        topic: `meshcore/STO/${PUBLIC_KEY}/status`,
        payload: Buffer.from("{}"),
      };
      for (let index = 0; index < 100; index += 1) {
        detector.recordPacket(client, packet);
      }
      const state = detector.getClientStats(PUBLIC_KEY);
      assert.equal(state.peakRateObserved, 10);
      setNow(start + 3_600_000);
      detector.recordPacket(client, packet);
      assert.equal(state.peakRateObserved, 0.1);
    });
  });
});

test("topic observation fills uniqueTopics and topicHistory windows", async () => {
  await withConsoleLogSilenced(async () => {
    await withFakeNow(1_800_000_000_000, async () => {
      const detector = await createDetector({
        maxTopicsPerDay: 2,
        topicHistorySize: 3,
      });
      const client = { publicKey: PUBLIC_KEY };
      for (const topic of ["a", "b", "c", "d"]) {
        detector.recordPacket(client, {
          topic: `meshcore/STO/${PUBLIC_KEY}/${topic}`,
          payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY })),
        });
      }
      const state = detector.getClientStats(PUBLIC_KEY);
      assert.equal(state.uniqueTopics.size, 4);
      assert.equal(state.topicHistory.length, 3);
      assert.ok(
        state.anomalies.some((anomaly) => anomaly.type === "topic_count"),
      );
    });
  });
});

test("uniqueTopics is bounded and expires topics outside the observation window", async () => {
  await withConsoleLogSilenced(async () => {
    await withFakeNow(1_800_000_000_000, async (setNow) => {
      const detector = await createDetector({
        maxTopicsPerDay: 3,
        topicHistorySize: 50,
        topicHistoryWindowMs: 86_400_000,
      });
      const client = { publicKey: PUBLIC_KEY };
      for (let index = 0; index < 10_050; index += 1) {
        detector.recordPacket(client, {
          topic: `meshcore/STO/${PUBLIC_KEY}/packets-${index}`,
          payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY })),
        });
      }
      const state = detector.getClientStats(PUBLIC_KEY);
      assert.ok(
        state.uniqueTopics.size <= 10_000,
        `uniqueTopics should be capped, got ${state.uniqueTopics.size}`,
      );
      setNow(1_800_000_000_000 + 2 * 86_400_000);
      detector.recordPacket(client, {
        topic: `meshcore/STO/${PUBLIC_KEY}/packets-later`,
        payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY })),
      });
      assert.equal(state.uniqueTopics.size, 1);
    });
  });
});

test("observe-only: excessive rate is logged but never mutes", async () => {
  await withConsoleLogSilenced(async () => {
    await withFakeNow(1_800_000_000_000, async () => {
      const detector = await createDetector({
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

      assert.equal(detector.getClientStats(PUBLIC_KEY).totalPacketsReceived, 3);
    });
  });
});

test("binary-identical payloads hash stable, differing bytes do not collide", async () => {
  await withConsoleLogSilenced(async () => {
    await withFakeNow(1_800_000_000_000, async () => {
      const detector = await createDetector();
      const client = { publicKey: PUBLIC_KEY };
      const a = Buffer.from([0xff, 0xfe, 0x01]);
      const b = Buffer.from([0xff, 0xfe, 0x02]);
      detector.recordPacket(client, {
        topic: `meshcore/STO/${PUBLIC_KEY}/packets`,
        payload: a,
      });
      const before = detector.getClientStats(PUBLIC_KEY).duplicateCount;
      detector.recordPacket(client, {
        topic: `meshcore/STO/${PUBLIC_KEY}/packets`,
        payload: b,
      });
      const after = detector.getClientStats(PUBLIC_KEY).duplicateCount;
      // b differs from a: must not count as a duplicate of a.
      assert.equal(after, before);
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
      maxIataChanges24h: 1,
    });
    const state = detector.getClientStats(PUBLIC_KEY);

    assert.equal(detector.checkIataChange(state, "GSE"), true);
    assert.equal(detector.checkIataChange(state, "GOT"), true);
    assert.equal(detector.checkIataChange(state, "STO"), true);

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

test("mixed-case public keys share one trust entry", async () => {
  await withConsoleLogSilenced(async () => {
    const detector = await createDetector();
    detector.initializeClient(PUBLIC_KEY.toLowerCase(), `v1_${PUBLIC_KEY}`);
    detector.recordPacket(
      { publicKey: PUBLIC_KEY.toLowerCase() },
      { payload: Buffer.from("x") },
    );
    const upper = detector.getClientStats(PUBLIC_KEY);
    assert.ok(upper);
    assert.equal(upper.totalPacketsReceived, 1);
    detector.rememberClientName(PUBLIC_KEY.toLowerCase(), "TestObserver");
    assert.equal(detector.getClientStats(PUBLIC_KEY).username, "TestObserver");
  });
});

test("sweepInactiveClients caps the client map", async () => {
  await withConsoleLogSilenced(async () => {
    await withFakeNow(1_800_000_000_000, async () => {
      const detector = await createDetector();
      for (let index = 0; index < 5; index += 1) {
        const key = index.toString(16).padStart(64, "0").toUpperCase();
        detector.initializeClient(key, `v1_${key}`);
      }
      // 1 fixture client + 5 new = 6; cap at 3 evicts oldest 3.
      assert.equal(detector.sweepInactiveClients(30 * 86_400_000, 3), 3);
      assert.equal(detector.getClientStats(PUBLIC_KEY), undefined);
      for (let index = 0; index < 5; index += 1) {
        const key = index.toString(16).padStart(64, "0");
        assert.equal(detector.getClientStats(key) !== undefined, index >= 2);
      }
    });
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
