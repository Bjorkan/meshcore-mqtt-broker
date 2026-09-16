import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  encodeMqttConnectPacket,
  encodeMqttPublishPacket,
  encodeMqttSubscribePacket,
  parseFirstMqttPacket,
  readMqttPublish,
} from "../src/healthcheck.js";

test("healthcheck packet codec retains real MQTT loopback behavior", () => {
  assert.equal(
    encodeMqttConnectPacket({ username: "u", password: "p" }, "c")[0],
    0x10,
  );
  assert.equal(encodeMqttSubscribePacket("healthcheck/docker_health")[0], 0x82);
  const encoded = encodeMqttPublishPacket("healthcheck/docker_health", "ok");
  const parsed = parseFirstMqttPacket(encoded);
  assert.equal(readMqttPublish(parsed.packet).payload.toString(), "ok");
});
