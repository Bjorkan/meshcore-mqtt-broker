import assert from "node:assert/strict";
import { test } from "@jest/globals";

import { quarantineOrphanedWill } from "../dist/orphaned-will.js";

test("quarantines an obsolete persisted will without publishing its original payload", () => {
  const originalPayload = Buffer.from('{"origin_id":"UNVERIFIED"}');
  const packet = {
    cmd: "publish",
    topic: "meshcore/STO/UNVERIFIED/status",
    payload: originalPayload,
    qos: 1,
    retain: true,
    dup: true,
    clientId: "old-client",
    brokerId: "dead-broker",
  };

  const result = quarantineOrphanedWill(packet, "Broker instance/one");

  assert.deepEqual(result, {
    originalTopic: "meshcore/STO/UNVERIFIED/status",
    clientId: "old-client",
    brokerId: "dead-broker",
    quarantineTopic: "$SYS/Broker_instance_one/discarded-wills",
  });
  assert.equal(packet.topic, "$SYS/Broker_instance_one/discarded-wills");
  assert.equal(packet.qos, 0);
  assert.equal(packet.retain, false);
  assert.equal(packet.dup, false);
  assert.notDeepEqual(packet.payload, originalPayload);

  const diagnostic = JSON.parse(packet.payload.toString("utf8"));
  assert.deepEqual(diagnostic, {
    reason: "orphaned-will-without-authenticated-client",
    originalTopic: "meshcore/STO/UNVERIFIED/status",
    clientId: "old-client",
    brokerId: "dead-broker",
  });
});

test("bounds diagnostic metadata from malformed persistence records", () => {
  const packet = {
    cmd: "publish",
    topic: "x".repeat(2048),
    payload: Buffer.alloc(1024 * 1024, 1),
    qos: 2,
    retain: true,
    dup: true,
    clientId: "c".repeat(2048),
    brokerId: 42,
  };

  const result = quarantineOrphanedWill(packet, "bad/id with spaces");
  const diagnostic = JSON.parse(packet.payload.toString("utf8"));

  assert.equal(result.originalTopic.length, 512);
  assert.equal(result.clientId.length, 512);
  assert.equal(result.brokerId, undefined);
  assert.equal(packet.topic, "$SYS/bad_id_with_spaces/discarded-wills");
  assert.ok(packet.payload.length < 2048);
  assert.equal(diagnostic.originalTopic.length, 512);
  assert.equal(diagnostic.clientId.length, 512);
  assert.equal("brokerId" in diagnostic, false);
});

test("lets Aedes delete a stale shared-persistence will without emitting an error", async () => {
  const { Aedes } = await import("aedes");
  const { default: createMemoryPersistence } =
    await import("aedes-persistence");

  const persistence = createMemoryPersistence();
  await persistence.setup({ id: "dead-broker" });
  await persistence.putWill(
    { id: "old-client" },
    {
      cmd: "publish",
      topic: "meshcore/STO/UNVERIFIED/status",
      payload: Buffer.from("unverified stale will"),
      qos: 1,
      retain: true,
      dup: false,
    },
  );

  const broker = new Aedes({
    id: "replacement-broker",
    persistence,
    heartbeatInterval: 10,
    authorizePublish(client, packet, callback) {
      assert.equal(client, null);
      quarantineOrphanedWill(packet, "replacement-broker");
      callback(null);
    },
  });
  const runtimeErrors = [];
  const published = [];
  broker.on("error", (error) => runtimeErrors.push(error));
  broker.on("publish", (packet, client) => {
    if (!client && packet.topic.endsWith("/discarded-wills")) {
      published.push(packet);
    }
  });

  try {
    await broker.listen();
    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.equal(runtimeErrors.length, 0);
    assert.equal(published.length, 1);
    assert.equal(published[0].topic, "$SYS/replacement-broker/discarded-wills");
    assert.equal(await persistence.getWill({ id: "old-client" }), undefined);
  } finally {
    await new Promise((resolve) => broker.close(resolve));
  }
});
