import assert from "node:assert/strict";
import { afterEach, jest, test } from "@jest/globals";

import { AbuseDetector } from "../dist/abuse-detector.js";

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
  detector.initializeClient(PUBLIC_KEY, `v1_${PUBLIC_KEY}`, "127.0.0.1");
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
  const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

  try {
    return await callback();
  } finally {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

async function withConsoleLogCaptured(callback) {
  const logs = [];
  const logSpy = jest.spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  });

  try {
    return await callback(logs);
  } finally {
    logSpy.mockRestore();
  }
}

async function withFakeNow(initialNow, callback) {
  let currentNow = initialNow;
  const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => currentNow);

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

function publishUntilRateLimited(detector, client, raw) {
  assert.equal(
    detector.recordPacket(client, {
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: `${raw}0` }),
      ),
    }),
    true,
  );
  assert.equal(
    detector.recordPacket(client, {
      payload: Buffer.from(
        JSON.stringify({ origin_id: PUBLIC_KEY, raw: `${raw}1` }),
      ),
    }),
    false,
  );
}

test("expires abuse blocks at 15m, 1h, 24h and resets escalation weekly", async () => {
  await withConsoleLogSilenced(async () => {
    await withFakeNow(1_800_000_000_000, async (setNow) => {
      const detector = await createDetector({
        enforcementEnabled: true,
        bucketCapacity: 1,
        bucketRefillRate: 0,
      });
      const client = { publicKey: PUBLIC_KEY };

      publishUntilRateLimited(detector, client, "0");

      const firstState = detector.getClientStats(PUBLIC_KEY);
      assert.equal(firstState.status, "muted");
      assert.equal(firstState.abuseBlockCount, 1);
      assert.equal(
        firstState.abuseBlockCountWindowStartedAt,
        firstState.mutedAt,
      );
      assert.equal(firstState.mutedUntil - firstState.mutedAt, 15 * 60 * 1000);
      assert.equal(detector.shouldSilencePacket(client), true);

      setNow(firstState.mutedUntil + 1);
      assert.equal(detector.shouldSilencePacket(client), false);
      assert.equal(firstState.status, "allowed");

      publishUntilRateLimited(detector, client, "1");

      const secondState = detector.getClientStats(PUBLIC_KEY);
      assert.equal(secondState.status, "muted");
      assert.equal(secondState.abuseBlockCount, 2);
      assert.equal(
        secondState.abuseBlockCountWindowStartedAt,
        firstState.abuseBlockCountWindowStartedAt,
      );
      assert.equal(
        secondState.mutedUntil - secondState.mutedAt,
        60 * 60 * 1000,
      );

      setNow(secondState.mutedUntil + 1);
      assert.equal(detector.shouldSilencePacket(client), false);

      publishUntilRateLimited(detector, client, "2");

      const thirdState = detector.getClientStats(PUBLIC_KEY);
      assert.equal(thirdState.status, "muted");
      assert.equal(thirdState.abuseBlockCount, 3);
      assert.equal(
        thirdState.mutedUntil - thirdState.mutedAt,
        24 * 60 * 60 * 1000,
      );

      setNow(thirdState.mutedUntil + 7 * 24 * 60 * 60 * 1000 + 1);
      assert.equal(detector.shouldSilencePacket(client), false);

      publishUntilRateLimited(detector, client, "3");

      const weeklyResetState = detector.getClientStats(PUBLIC_KEY);
      assert.equal(weeklyResetState.status, "muted");
      assert.equal(weeklyResetState.abuseBlockCount, 1);
      assert.equal(
        weeklyResetState.mutedUntil - weeklyResetState.mutedAt,
        15 * 60 * 1000,
      );
      assert.equal(
        weeklyResetState.abuseBlockCountWindowStartedAt,
        weeklyResetState.mutedAt,
      );
    });
  });
});

test("logs clear abuse trigger and denial escalation details", async () => {
  await withFakeNow(1_800_000_000_000, async () => {
    await withConsoleLogCaptured(async (logs) => {
      const detector = await createDetector({
        enforcementEnabled: true,
        bucketCapacity: 1,
        bucketRefillRate: 0,
      });
      const client = { publicKey: PUBLIC_KEY };

      publishUntilRateLimited(detector, client, "a");

      assert.ok(
        logs.some((line) => line.includes("trigger: rate limit exceeded")),
      );
      assert.ok(
        logs.some(
          (line) => line.includes("tokens=0.00") && line.includes("payload="),
        ),
      );
      assert.ok(
        logs.some(
          (line) => line.includes("DENIED") && line.includes("duration=15 min"),
        ),
      );
      assert.ok(
        logs.some(
          (line) =>
            line.includes("escalation step=1") &&
            line.includes("week reset=yes"),
        ),
      );
      assert.ok(
        logs.some((line) => line.includes("until=2027-01-15T08:15:00.000Z")),
      );
    });
  });
});

test("detects duplicate packet payloads by raw field instead of full JSON envelope", async () => {
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
      false,
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
