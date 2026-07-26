import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  encodeMqttConnectPacket,
  encodeMqttPublishPacket,
  encodeMqttSubscribePacket,
  parseFirstMqttPacket,
  readMqttPublish,
  runDatabaseHealthcheck,
} from "../dist/healthcheck.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

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

test("database readiness executes a bounded query on the initialized connection", async () => {
  const fixture = await temporaryDatabase("health-");
  fixtures.push(fixture);
  await runDatabaseHealthcheck(fixture.database);
  await fixture.database.run("DELETE FROM application_metadata");
  await assert.rejects(
    runDatabaseHealthcheck(fixture.database),
    /hälsokontroll/,
  );
});
