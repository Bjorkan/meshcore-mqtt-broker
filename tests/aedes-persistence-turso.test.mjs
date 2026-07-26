import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { serialize } from "node:v8";
import {
  TursoAedesPersistence,
  mqttTopicMatches,
} from "../dist/aedes-persistence-turso.js";
import { ApplicationDatabase } from "../dist/database.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

function packet(topic, payload, extra = {}) {
  return {
    cmd: "publish",
    topic,
    payload: Buffer.from(payload),
    qos: 1,
    retain: true,
    dup: false,
    brokerId: "broker",
    brokerCounter: 1,
    ...extra,
  };
}

async function collect(stream) {
  const values = [];
  for await (const value of stream) values.push(value);
  return values;
}

test("MQTT wildcard matching handles exact, plus, hash, and empty levels", () => {
  assert.equal(mqttTopicMatches("a/b", "a/b"), true);
  assert.equal(mqttTopicMatches("a/+", "a/"), true);
  assert.equal(mqttTopicMatches("a/#", "a/b/c"), true);
  assert.equal(mqttTopicMatches("a/+", "a/b/c"), false);
  assert.equal(mqttTopicMatches("a/#/bad", "a/b"), false);
});

test("retained insert, replacement, exact and per-filter wildcard lookup, deletion", async () => {
  const fixture = await temporaryDatabase("retained-");
  fixtures.push(fixture);
  const persistence = new TursoAedesPersistence(fixture.database);
  await persistence.setup({ id: "broker" });
  await persistence.storeRetained(packet("meshcore/STO/key/neighbors", "one"));
  await persistence.storeRetained(packet("meshcore/STO/key/neighbors", "two"));
  await persistence.storeRetained(packet("meshcore/GOT/key/neighbors", "got"));
  const exact = await collect(
    persistence.createRetainedStream("meshcore/STO/key/neighbors"),
  );
  assert.equal(exact.length, 1);
  assert.equal(exact[0].payload.toString(), "two");
  const wildcard = await collect(
    persistence.createRetainedStreamCombi(["meshcore/+/key/#", "meshcore/#"]),
  );
  assert.deepEqual(wildcard.map((value) => value.topic).sort(), [
    "meshcore/GOT/key/neighbors",
    "meshcore/GOT/key/neighbors",
    "meshcore/STO/key/neighbors",
    "meshcore/STO/key/neighbors",
  ]);
  await persistence.storeRetained(packet("meshcore/STO/key/neighbors", ""));
  assert.equal(
    (await collect(persistence.createRetainedStream("meshcore/STO/#"))).length,
    0,
  );
});

test("retained packets and subscriptions recover after reopening the file", async () => {
  const fixture = await temporaryDatabase("restart-");
  fixtures.push(fixture);
  let persistence = new TursoAedesPersistence(fixture.database);
  await persistence.setup({ id: "broker" });
  await persistence.storeRetained(
    packet("meshcore/STO/key/neighbors", "durable"),
  );
  await persistence.addSubscriptions({ id: "client" }, [
    { topic: "meshcore/#", qos: 1 },
  ]);
  await fixture.database.close();
  fixture.database = await ApplicationDatabase.open(fixture.file);
  persistence = new TursoAedesPersistence(fixture.database);
  await persistence.setup({ id: "broker" });
  assert.equal(
    (
      await collect(persistence.createRetainedStream("meshcore/#"))
    )[0].payload.toString(),
    "durable",
  );
  assert.deepEqual(await persistence.subscriptionsByClient({ id: "client" }), [
    {
      topic: "meshcore/#",
      qos: 1,
      rh: undefined,
      rap: undefined,
      nl: undefined,
      subscriptionIdentifier: undefined,
    },
  ]);
});

test("subscription persistence supports replacement, topic matching, removal, and cleanup", async () => {
  const fixture = await temporaryDatabase("subscriptions-");
  fixtures.push(fixture);
  const persistence = new TursoAedesPersistence(fixture.database);
  await persistence.addSubscriptions({ id: "client" }, [
    { topic: "meshcore/+/key/#", qos: 1 },
    { topic: "heartbeat/", qos: 0 },
  ]);
  await persistence.addSubscriptions({ id: "qos-zero-only" }, [
    { topic: "heartbeat/#", qos: 0 },
  ]);
  await persistence.addSubscriptions({ id: "client" }, [
    { topic: "meshcore/+/key/#", qos: 2 },
  ]);
  const matching = await persistence.subscriptionsByTopic(
    "meshcore/STO/key/neighbors",
  );
  assert.equal(matching.length, 1);
  assert.equal(matching[0].qos, 2);
  assert.deepEqual(await persistence.countOffline(), {
    subsCount: 1,
    clientsCount: 2,
  });
  await persistence.removeSubscriptions({ id: "client" }, ["meshcore/+/key/#"]);
  assert.equal(
    (await persistence.subscriptionsByTopic("meshcore/STO/key/raw")).length,
    0,
  );
  await persistence.cleanSubscriptions({ id: "client" });
  assert.deepEqual(
    await persistence.subscriptionsByClient({ id: "client" }),
    [],
  );
});

test("overlapping offline subscriptions collapse to one effective client delivery", async () => {
  const fixture = await temporaryDatabase("overlapping-subscriptions-");
  fixtures.push(fixture);
  const persistence = new TursoAedesPersistence(fixture.database);
  await persistence.addSubscriptions({ id: "client" }, [
    { topic: "meshcore/#", qos: 1 },
    { topic: "meshcore/+/key/#", qos: 2 },
  ]);
  assert.deepEqual(
    await persistence.subscriptionsByTopic("meshcore/STO/key/raw"),
    [
      {
        clientId: "client",
        topic: "meshcore/+/key/#",
        qos: 2,
        rh: undefined,
        rap: undefined,
        nl: undefined,
      },
    ],
  );
});

test("clean sessions remove subscriptions and both QoS queues atomically", async () => {
  const fixture = await temporaryDatabase("clean-session-");
  fixtures.push(fixture);
  const persistence = new TursoAedesPersistence(fixture.database);
  const client = { id: "clean-client" };
  const value = packet("meshcore/STO/key/raw", "queued", {
    messageId: 7,
    qos: 2,
  });
  await persistence.addSubscriptions(client, [{ topic: "meshcore/#", qos: 2 }]);
  await persistence.outgoingEnqueue({ clientId: client.id }, value);
  await persistence.incomingStorePacket(client, value);
  await persistence.cleanSubscriptions(client);
  for (const table of [
    "mqtt_subscriptions",
    "mqtt_outgoing",
    "mqtt_incoming",
  ]) {
    const row = await fixture.database.get(
      `SELECT COUNT(*) AS count FROM ${table} WHERE client_id = ?`,
      client.id,
    );
    assert.equal(Number(row.count), 0, table);
  }
});

test("outgoing queue supports enqueue, replay, message update, acknowledgement, and client isolation", async () => {
  const fixture = await temporaryDatabase("outgoing-");
  fixtures.push(fixture);
  const persistence = new TursoAedesPersistence(fixture.database);
  const original = packet("meshcore/STO/key/raw", "queued", { retain: false });
  await persistence.outgoingEnqueueCombi(
    [{ clientId: "one" }, { clientId: "two" }],
    original,
  );
  assert.equal(
    (await collect(persistence.outgoingStream({ id: "one" }))).length,
    1,
  );
  await persistence.outgoingUpdate(
    { id: "one" },
    { ...original, messageId: 42 },
  );
  const cleared = await persistence.outgoingClearMessageId(
    { id: "one" },
    { messageId: 42 },
  );
  assert.equal(cleared.payload.toString(), "queued");
  assert.equal(
    await persistence.outgoingClearMessageId({ id: "one" }, { messageId: 42 }),
    undefined,
  );
  assert.equal(
    (await collect(persistence.outgoingStream({ id: "two" }))).length,
    1,
  );
});

test("outgoing queue clears unassigned packets and resumes persisted PUBREL packets", async () => {
  const fixture = await temporaryDatabase("outgoing-pubrel-");
  fixtures.push(fixture);
  const persistence = new TursoAedesPersistence(fixture.database);
  const original = packet("meshcore/STO/key/raw", "queued", { retain: false });

  await persistence.outgoingEnqueue({ clientId: "unassigned" }, original);
  assert.equal(
    (
      await persistence.outgoingClearMessageId(
        { id: "unassigned" },
        { cmd: "publish" },
      )
    ).payload.toString(),
    "queued",
  );

  await persistence.outgoingEnqueue({ clientId: "qos2" }, original);
  await persistence.outgoingUpdate(
    { id: "qos2" },
    { ...original, messageId: 91 },
  );
  await persistence.outgoingUpdate(
    { id: "qos2" },
    { cmd: "pubrel", messageId: 91 },
  );
  const [pubrel] = await collect(persistence.outgoingStream({ id: "qos2" }));
  assert.equal(pubrel.cmd, "pubrel");
  await persistence.outgoingUpdate(
    { id: "qos2" },
    {
      ...pubrel,
      brokerId: "replacement-runtime",
      brokerCounter: 1,
      writeCallback: () => undefined,
    },
  );
  assert.equal(
    (
      await persistence.outgoingClearMessageId(
        { id: "qos2" },
        { messageId: 91 },
      )
    ).cmd,
    "pubrel",
  );
});

test("incoming QoS2 packets and wills persist and clean up", async () => {
  const fixture = await temporaryDatabase("incoming-will-");
  fixtures.push(fixture);
  const persistence = new TursoAedesPersistence(fixture.database);
  await persistence.setup({ id: "local-broker" });
  const incoming = packet("meshcore/STO/key/raw", "qos2", {
    messageId: 9,
    qos: 2,
  });
  await persistence.incomingStorePacket({ id: "publisher" }, incoming);
  assert.equal(
    (
      await persistence.incomingGetPacket({ id: "publisher" }, { messageId: 9 })
    ).payload.toString(),
    "qos2",
  );
  await persistence.incomingDelPacket({ id: "publisher" }, { messageId: 9 });
  await assert.rejects(
    persistence.incomingGetPacket({ id: "publisher" }, { messageId: 9 }),
    /no such packet/,
  );
  await persistence.putWill({ id: "publisher" }, packet("will/topic", "bye"));
  assert.equal(
    (await collect(persistence.streamWill({})))[0].brokerId,
    "local-broker",
  );
  assert.equal(
    (await persistence.delWill({ id: "publisher" })).payload.toString(),
    "bye",
  );
  assert.equal(await persistence.getWill({ id: "publisher" }), undefined);
});

test("replacement process sees wills from the previous runtime identity", async () => {
  const fixture = await temporaryDatabase("will-restart-");
  fixtures.push(fixture);
  const previous = new TursoAedesPersistence(fixture.database);
  await previous.setup({ id: "display-id-old-runtime" });
  await previous.putWill({ id: "publisher" }, packet("will/topic", "bye"));

  const replacement = new TursoAedesPersistence(fixture.database);
  await replacement.setup({ id: "display-id-new-runtime" });
  const wills = await collect(
    replacement.streamWill({ "display-id-new-runtime": Date.now() }),
  );
  assert.equal(wills.length, 1);
  assert.equal(wills[0].brokerId, "display-id-old-runtime");
});

test("persistence streams page through more than one bounded query", async () => {
  const fixture = await temporaryDatabase("persistence-pages-");
  fixtures.push(fixture);
  const persistence = new TursoAedesPersistence(fixture.database);
  const insert = fixture.database.transaction(async (transaction) => {
    const retained = await transaction.prepare(
      `INSERT INTO retained_packets(topic, packet, stored_at_ms)
       VALUES (?, ?, ?)`,
    );
    const outgoing = await transaction.prepare(
      `INSERT INTO mqtt_outgoing(
         client_id, packet, broker_id, broker_counter, message_id, created_at_ms
       ) VALUES (?, ?, ?, ?, NULL, ?)`,
    );
    for (let index = 0; index <= 500; index += 1) {
      const topic = `page/${String(index).padStart(3, "0")}`;
      const value = packet(topic, String(index), {
        brokerCounter: index + 1,
      });
      await retained.run(topic, serialize(value), Date.now());
      await outgoing.run(
        "paged-client",
        serialize({ ...value, messageId: undefined }),
        value.brokerId,
        value.brokerCounter,
        Date.now(),
      );
    }
  });
  await insert.immediate();

  assert.equal(
    (await collect(persistence.createRetainedStream("page/#"))).length,
    501,
  );
  assert.equal(
    (await collect(persistence.outgoingStream({ id: "paged-client" }))).length,
    501,
  );
});

test("expired retained neighbors are removed in bounded cleanup", async () => {
  const fixture = await temporaryDatabase("expiration-");
  fixtures.push(fixture);
  const persistence = new TursoAedesPersistence(fixture.database);
  await persistence.storeRetained(packet("meshcore/STO/key/neighbors", "old"));
  await fixture.database.run("UPDATE retained_packets SET expires_at_ms = 0");
  assert.equal(await persistence.cleanup(1), 1);
  assert.equal(
    (await collect(persistence.createRetainedStream("meshcore/#"))).length,
    0,
  );
});
