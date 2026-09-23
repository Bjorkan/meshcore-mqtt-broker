import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  jsonPublishLimitForSubtopic,
  stripNeighborSnrForLimitedSubscriber,
} from "../src/neighbors.js";

const ORIGIN =
  "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";
const NEIGHBOR =
  "7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400";

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
