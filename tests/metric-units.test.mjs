import assert from "node:assert/strict";
import { test } from "bun:test";
import { canonicalMetricUnit } from "../src/metric-units.js";

test("canonical metric units map exact metrics and reject ambiguous guesses", () => {
  assert.equal(canonicalMetricUnit("battery_mv"), "mV");
  assert.equal(canonicalMetricUnit("stats.battery_mv"), "mV");
  assert.equal(canonicalMetricUnit("stats.last_rssi"), "dBm");
  assert.equal(canonicalMetricUnit("noise_floor"), "dBm");
  assert.equal(canonicalMetricUnit("last_snr"), "dB");
  assert.equal(canonicalMetricUnit("tx_power"), "dBm");
  assert.equal(canonicalMetricUnit("tx_power_dbm"), "dBm");
  assert.equal(canonicalMetricUnit("frequency"), "MHz");
  assert.equal(canonicalMetricUnit("freq_mhz"), "MHz");
  assert.equal(canonicalMetricUnit("uptime"), "s");
  assert.equal(canonicalMetricUnit("rx_airtime"), "s");
  assert.equal(canonicalMetricUnit("temperature"), "°C");
  assert.equal(canonicalMetricUnit("battery_pct"), "%");
  assert.equal(canonicalMetricUnit("solar_power"), null);
  assert.equal(canonicalMetricUnit("power_w"), null);
  assert.equal(canonicalMetricUnit("output_power"), null);
  assert.equal(canonicalMetricUnit("custom_metric", "parsecs"), "parsecs");
});
