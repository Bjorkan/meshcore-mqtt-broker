import assert from "node:assert/strict";
import { test } from "@jest/globals";

import {
  FIRMWARE_NEIGHBORS_JSON_BUFFER_BYTES,
  isObserverNeighborsSnapshot,
  jsonPublishLimitForSubtopic,
  neighborLastHeardAt,
  parseNeighborsSnapshot,
  stripNeighborSnrForLimitedSubscriber,
} from "../dist/neighbors.js";

const ORIGIN =
  "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";
const NEIGHBOR =
  "7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400";

test("parses the observer firmware /neighbors payload into bounded dashboard state", () => {
  const receivedAt = 1_800_000_000_000;
  const snapshot = parseNeighborsSnapshot(
    Buffer.from(
      JSON.stringify({
        timestamp: "2026-06-07T12:00:00.000000+00:00",
        origin: "MQTT Observer",
        origin_id: ORIGIN.toLowerCase(),
        self: { scopes: " Europe, UK,Europe " },
        neighbors: [
          {
            pubkey: NEIGHBOR.toLowerCase(),
            snr: 8.5,
            heard_secs_ago: 120,
            scopes: "*, Europe",
            status: "responded",
          },
        ],
      }),
    ),
    receivedAt,
    ORIGIN,
  );

  assert.deepEqual(snapshot, {
    receivedAt,
    reportedAt: Date.parse("2026-06-07T12:00:00.000000+00:00"),
    selfScopes: ["Europe", "UK"],
    neighbors: [
      {
        publicKey: NEIGHBOR,
        snr: 8.5,
        heardSecsAgo: 120,
        scopes: ["*", "Europe"],
        status: "responded",
      },
    ],
    invalidEntryCount: 0,
  });
  assert.equal(isObserverNeighborsSnapshot(snapshot), true);
  assert.equal(FIRMWARE_NEIGHBORS_JSON_BUFFER_BYTES, 10_240);
});

test("ignores malformed and duplicate neighbor entries without losing the snapshot", () => {
  const snapshot = parseNeighborsSnapshot(
    Buffer.from(
      JSON.stringify({
        origin_id: ORIGIN,
        self: { scopes: "*" },
        neighbors: [
          {
            pubkey: NEIGHBOR,
            snr: 1,
            heard_secs_ago: 0,
            scopes: "SE",
            status: "timeout",
          },
          {
            pubkey: NEIGHBOR,
            snr: 2,
            heard_secs_ago: 1,
            scopes: "SE",
            status: "responded",
          },
          { pubkey: "bad", snr: "1", heard_secs_ago: -1, status: "bad" },
        ],
      }),
    ),
    123,
    ORIGIN,
  );

  assert.equal(snapshot.neighbors.length, 1);
  assert.equal(snapshot.invalidEntryCount, 2);
});

test("rejects non-neighbor payloads and origin mismatches", () => {
  assert.equal(
    parseNeighborsSnapshot(Buffer.from("not-json"), Date.now(), ORIGIN),
    undefined,
  );
  assert.equal(
    parseNeighborsSnapshot(
      Buffer.from(JSON.stringify({ origin_id: NEIGHBOR, neighbors: [] })),
      Date.now(),
      ORIGIN,
    ),
    undefined,
  );
});

test("removes per-neighbor SNR from limited subscriber payloads", () => {
  const message = {
    origin_id: ORIGIN,
    self: { scopes: "Europe" },
    neighbors: [
      {
        pubkey: NEIGHBOR,
        snr: 8.5,
        heard_secs_ago: 120,
        scopes: "*,Europe",
        status: "responded",
      },
    ],
  };

  assert.equal(stripNeighborSnrForLimitedSubscriber(message), true);
  assert.deepEqual(message.neighbors[0], {
    pubkey: NEIGHBOR,
    heard_secs_ago: 120,
    scopes: "*,Europe",
    status: "responded",
  });
  assert.equal(stripNeighborSnrForLimitedSubscriber(message), false);
});

test("uses the firmware buffer size only for /neighbors JSON", () => {
  assert.equal(jsonPublishLimitForSubtopic(8192, "neighbors"), 10_240);
  assert.equal(jsonPublishLimitForSubtopic(16_384, "neighbors"), 16_384);
  assert.equal(jsonPublishLimitForSubtopic(8192, "packets"), 8192);
});

test("rejects unsafe clustered neighbor snapshots", () => {
  const valid = {
    receivedAt: 123,
    selfScopes: ["Europe"],
    neighbors: [
      {
        publicKey: NEIGHBOR,
        snr: 8.5,
        heardSecsAgo: 120,
        scopes: ["Europe"],
        status: "responded",
      },
    ],
    invalidEntryCount: 0,
  };

  assert.equal(isObserverNeighborsSnapshot(valid), true);
  assert.equal(
    isObserverNeighborsSnapshot({
      ...valid,
      neighbors: [...valid.neighbors, { ...valid.neighbors[0] }],
    }),
    false,
  );
  assert.equal(
    isObserverNeighborsSnapshot({
      ...valid,
      neighbors: [{ ...valid.neighbors[0], heardSecsAgo: 0x1_0000_0000 }],
    }),
    false,
  );
});

test("bounds the dashboard snapshot to the firmware neighbor table size", () => {
  const neighbors = Array.from({ length: 52 }, (_, index) => ({
    pubkey: index.toString(16).padStart(64, "0"),
    snr: index / 10,
    heard_secs_ago: index,
    scopes: "Europe",
    status: "responded",
  }));
  const snapshot = parseNeighborsSnapshot(
    Buffer.from(JSON.stringify({ origin_id: ORIGIN, neighbors })),
    123,
    ORIGIN,
  );

  assert.equal(snapshot.neighbors.length, 50);
  assert.equal(snapshot.invalidEntryCount, 2);
});

test("converts firmware heard age into an absolute broker timestamp", () => {
  assert.equal(neighborLastHeardAt(1_800_000_000_000, 120), 1_799_999_880_000);
});
