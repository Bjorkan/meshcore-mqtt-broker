import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  formatBrokerInstanceId,
  generateBrokerCode,
  INSTANCE_ID_PATTERN,
  normalizeBrokerName,
  resolveBrokerInstanceId,
} from "../src/instance-id.js";

test("broker instance id is fresh per process and stateless", () => {
  const first = resolveBrokerInstanceId({ brokerName: "Broker" });
  const second = resolveBrokerInstanceId({ brokerName: "Broker" });
  assert.match(first, INSTANCE_ID_PATTERN);
  assert.match(second, INSTANCE_ID_PATTERN);
  // No persistence: ids must not be stable across calls.
  assert.notEqual(first, second);
});

test("runtime_id_file is accepted for compatibility but ignored", () => {
  const resolved = resolveBrokerInstanceId({
    brokerName: "Broker",
    runtimeIdFile: "/data/meshcore-mqtt-broker/broker-id",
  });
  assert.match(resolved, /^Broker-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
});

test("broker name normalization and code alphabet hold", () => {
  assert.equal(normalizeBrokerName("  KSD Obs!  "), "KSD-Obs");
  assert.equal(normalizeBrokerName(undefined), "Broker");
  assert.match(generateBrokerCode(), /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  assert.match(formatBrokerInstanceId("ABCD", "Broker"), /^Broker-ABCD$/);
});
