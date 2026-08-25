import assert from "node:assert/strict";
import { afterEach, test } from "bun:test";
import { Buffer } from "node:buffer";
import {
  decodeStoredPacket,
  encodeStoredPacket,
} from "../src/stored-packet-codec.js";
import { temporaryDatabase } from "./test-database.mjs";
import { PostgresAedesPersistence } from "../src/aedes-persistence-postgres.js";

const fixtures = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

// Legacy rows persisted by the previous Node-only V8 format, captured from a
// real Node runtime and frozen here so the transitional reader stays verified
// on every runtime (including Bun, whose node:v8 uses a different wire
// format and can never regenerate these bytes).
const LEGACY_V8_FIXTURES = {
  publishWithBinaryPayload:
    "/w9vIgNjbWQiB3B1Ymxpc2giBXRvcGljIhttZXNoY29yZS9KS0cvYWFiYi9uZWlnaGJvcnMiB3BheWxvYWRcCgUAobLD/yIDcW9zSQIiBnJldGFpblQiA2R1cEYiCGJyb2tlcklkIghicm9rZXItMSINYnJva2VyQ291bnRlckkOewg=",
  willWithClientId:
    "/w9vIgNjbWQiB3B1Ymxpc2giBXRvcGljIhZtZXNoY29yZS9HT1QvY2NkZC93aWxsIgdwYXlsb2FkXAoDYnllIgNxb3NJACIGcmV0YWluRiIDZHVwRiIIY2xpZW50SWQiCGNsaWVudC05Ighicm9rZXJJZCIIYnJva2VyLTF7CA==",
  pubrel: "/w9vIgNjbWQiBnB1YnJlbCIJbWVzc2FnZUlkSVR7Ag==",
};

function publishPacket(extra = {}) {
  return {
    cmd: "publish",
    topic: "meshcore/JKG/aabb/neighbors",
    payload: Buffer.from([0x00, 0xa1, 0xb2, 0xc3, 0xff]),
    qos: 1,
    retain: true,
    dup: false,
    brokerId: "broker-1",
    brokerCounter: 7,
    ...extra,
  };
}

test("portable format round-trips binary payloads and packet fields", () => {
  const decoded = decodeStoredPacket(encodeStoredPacket(publishPacket()));
  assert.equal(decoded.cmd, "publish");
  assert.equal(decoded.topic, "meshcore/JKG/aabb/neighbors");
  assert.ok(Buffer.isBuffer(decoded.payload));
  assert.deepEqual([...decoded.payload], [0x00, 0xa1, 0xb2, 0xc3, 0xff]);
  assert.equal(decoded.qos, 1);
  assert.equal(decoded.retain, true);
  assert.equal(decoded.dup, false);
  assert.equal(decoded.brokerId, "broker-1");
  assert.equal(decoded.brokerCounter, 7);
});

test("portable format round-trips MQTT v5 binary properties", () => {
  const packet = publishPacket({
    properties: {
      correlationData: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
      userProperties: { trace: "abc" },
    },
  });
  const decoded = decodeStoredPacket(encodeStoredPacket(packet));
  assert.ok(Buffer.isBuffer(decoded.properties.correlationData));
  assert.deepEqual(
    [...decoded.properties.correlationData],
    [0xde, 0xad, 0xbe, 0xef],
  );
  assert.deepEqual(decoded.properties.userProperties, { trace: "abc" });
});

test("encode removes function-valued properties before persistence", () => {
  const packet = publishPacket({ writeCallback: () => {} });
  const decoded = decodeStoredPacket(encodeStoredPacket(packet));
  assert.equal("writeCallback" in decoded, false);
});

test("encoding is deterministic for identical packets", () => {
  const first = encodeStoredPacket(publishPacket());
  const second = encodeStoredPacket(publishPacket());
  assert.deepEqual([...first], [...second]);
});

test("stored bytes carry the MESHMQTT1 magic prefix", () => {
  const stored = encodeStoredPacket(publishPacket());
  assert.equal(stored.subarray(0, 9).toString("ascii"), "MESHMQTT1");
});

for (const [name, base64] of Object.entries(LEGACY_V8_FIXTURES)) {
  test(`retired Node V8 rows are rejected loudly, never guessed (${name})`, () => {
    const legacyBytes = new Uint8Array(Buffer.from(base64, "base64"));
    assert.throws(
      () => decodeStoredPacket(legacyBytes),
      /migrate-stored-packets/,
    );
  });
}

test("persistence writes portable rows and reads back identical packets", async () => {
  const fixture = await temporaryDatabase("packet-format-");
  fixtures.push(fixture);
  const persistence = new PostgresAedesPersistence(fixture.database);
  await persistence.setup({ id: "broker" });
  await persistence.storeRetained(publishPacket());
  const storedRow = await fixture.database.get(
    "SELECT packet FROM retained_packets WHERE topic = $1",
    "meshcore/JKG/aabb/neighbors",
  );
  const storedBytes = Buffer.from(storedRow.packet);
  assert.equal(storedBytes.subarray(0, 9).toString("ascii"), "MESHMQTT1");
  const stream = persistence.createRetainedStream(
    "meshcore/JKG/aabb/neighbors",
  );
  const values = [];
  for await (const value of stream) values.push(value);
  assert.equal(values.length, 1);
  assert.ok(Buffer.isBuffer(values[0].payload));
  assert.equal(values[0].payload[4], 0xff);
});
