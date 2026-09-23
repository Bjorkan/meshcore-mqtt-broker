import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  formatBrokerInstanceId,
  generateBrokerCode,
  normalizeBrokerName,
} from "../src/instance-id.js";

test("broker name normalization and code alphabet hold", () => {
  assert.equal(normalizeBrokerName("  KSD Obs!  "), "KSD-Obs");
  assert.equal(normalizeBrokerName(undefined), "Broker");
  assert.match(generateBrokerCode(), /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  assert.match(formatBrokerInstanceId("ABCD", "Broker"), /^Broker-ABCD$/);
});
