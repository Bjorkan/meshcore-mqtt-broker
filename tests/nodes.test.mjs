import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { afterEach, test } from "@jest/globals";
import {
  decodeHeardNodeAdvert,
  NodeAdvertRecorder,
} from "../dist/node-adverts.js";
import { BrokerStateStore } from "../dist/state-store.js";
import { isPointInSweden } from "../dist/sweden-geofence.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];

afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value);
  return buffer;
}

function signedAdvertPacket({
  timestamp,
  type = 2,
  name,
  latitude,
  longitude,
}) {
  const secretKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const publicKey = Buffer.from(ed25519.getPublicKey(secretKey));
  let flags = type;
  const appData = [];
  if (latitude !== undefined && longitude !== undefined) {
    flags |= 0x10;
  }
  if (name) flags |= 0x80;
  appData.push(Buffer.from([flags]));
  if (latitude !== undefined && longitude !== undefined) {
    appData.push(int32(Math.round(latitude * 1_000_000)));
    appData.push(int32(Math.round(longitude * 1_000_000)));
  }
  if (name) appData.push(Buffer.from(name));
  const advertAppData = Buffer.concat(appData);
  const signed = Buffer.concat([publicKey, uint32(timestamp), advertAppData]);
  const signature = Buffer.from(ed25519.sign(signed, secretKey));
  const advert = Buffer.concat([
    publicKey,
    uint32(timestamp),
    signature,
    advertAppData,
  ]);
  return {
    nodePublicKey: publicKey.toString("hex").toUpperCase(),
    packet: Buffer.concat([Buffer.from([0x11, 0x00]), advert]),
  };
}

async function storeFixture(prefix = "nodes-") {
  const fixture = await temporaryDatabase(prefix);
  fixtures.push(fixture);
  return {
    fixture,
    store: new BrokerStateStore(fixture.database, "Broker-NODES"),
  };
}

function advertInput(publicKey, overrides = {}) {
  const heardAt = overrides.heardAt ?? Date.now();
  return {
    publicKey,
    advertTimestamp: overrides.advertTimestamp ?? 100,
    advertType: overrides.advertType ?? "REPEATER",
    name: overrides.name ?? `Node ${publicKey[0]}`,
    latitude: overrides.latitude,
    longitude: overrides.longitude,
    region: overrides.region ?? "STO",
    observerPublicKey: overrides.observerPublicKey ?? "F".repeat(64),
    rawPacket: overrides.rawPacket ?? Buffer.from(publicKey[0]),
    heardAt,
  };
}

test("valid signed adverts are decoded and recorded independently of MeshCore.io", async () => {
  const { store } = await storeFixture("nodes-decode-");
  const observer = "A".repeat(64);
  const value = signedAdvertPacket({
    timestamp: 1_765_000_000,
    type: 1,
    name: "Stockholm chat",
    latitude: 59.3293,
    longitude: 18.0686,
  });
  const topic = `meshcore/STO/${observer}/packets`;
  const payload = Buffer.from(
    JSON.stringify({ origin_id: observer, raw: value.packet.toString("hex") }),
  );

  const heardAt = Date.now();
  const decoded = await decodeHeardNodeAdvert(topic, payload, heardAt);
  assert.equal(decoded.publicKey, value.nodePublicKey);
  assert.equal(decoded.advertType, "CHAT");
  assert.equal(decoded.name, "Stockholm chat");
  assert.equal(decoded.latitude, 59.3293);
  assert.equal(decoded.longitude, 18.0686);

  const recorder = new NodeAdvertRecorder(store, () => heardAt);
  recorder.offerPublish(topic, payload);
  await recorder.stop();
  const rows = await store.listHeardNodeAdverts();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rawPacketHex, value.packet.toString("hex"));
});

test("only the newest observed advert per node is retained and expired rows disappear", async () => {
  const { fixture, store } = await storeFixture("nodes-latest-");
  const key = "B".repeat(64);
  const base = Date.now();
  assert.equal(
    await store.recordHeardNodeAdvert(
      advertInput(key, {
        advertTimestamp: 200,
        name: "Current",
        heardAt: base,
      }),
    ),
    true,
  );
  assert.equal(
    await store.recordHeardNodeAdvert(
      advertInput(key, {
        advertTimestamp: 199,
        name: "Older",
        region: "GOT",
        observerPublicKey: "E".repeat(64),
        heardAt: base + 1,
      }),
    ),
    true,
  );
  const afterOlderAdvert = (await store.listHeardNodeAdverts())[0];
  assert.equal(afterOlderAdvert.name, "Older");
  assert.equal(Number(afterOlderAdvert.advertTimestamp), 199);
  assert.deepEqual(afterOlderAdvert.regions, ["GOT", "STO"]);
  assert.equal(afterOlderAdvert.heardAt, base + 1);
  assert.equal(afterOlderAdvert.advertHeardAt, base + 1);

  assert.equal(
    await store.recordHeardNodeAdvert(
      advertInput(key, {
        advertTimestamp: 201,
        name: "Newest",
        region: "MMX",
        heardAt: base + 2,
      }),
    ),
    true,
  );
  const newest = await store.listHeardNodeAdverts();
  assert.equal(newest.length, 1);
  assert.equal(newest[0].name, "Newest");
  assert.deepEqual(newest[0].regions, ["GOT", "MMX", "STO"]);
  assert.deepEqual(
    newest[0].regionHearings.map((hearing) => hearing.region),
    ["GOT", "MMX", "STO"],
  );

  await fixture.database.run(
    "UPDATE heard_node_regions SET expires_at_ms = 1 WHERE region = 'STO'",
  );
  const withoutExpiredRegion = await store.listHeardNodeAdverts();
  assert.deepEqual(withoutExpiredRegion[0].regions, ["GOT", "MMX"]);
  assert.deepEqual(await store.listHeardNodeAdverts("STO"), []);
  assert.equal((await store.listHeardNodeAdverts("MMX")).length, 1);

  await fixture.database.run("UPDATE heard_node_adverts SET expires_at_ms = 1");
  await fixture.database.run("UPDATE heard_node_regions SET expires_at_ms = 1");
  assert.deepEqual(await store.listHeardNodeAdverts(), []);
  await store.cleanupExpired();
  assert.equal(
    Number(
      (
        await fixture.database.get(
          "SELECT COUNT(*) AS count FROM heard_node_adverts",
        )
      ).count,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        await fixture.database.get(
          "SELECT COUNT(*) AS count FROM heard_node_regions",
        )
      ).count,
    ),
    0,
  );
});

test("Sweden geofence includes mainland and islands but excludes nearby countries", () => {
  assert.equal(isPointInSweden(59.3293, 18.0686), true); // Stockholm
  assert.equal(isPointInSweden(57.6348, 18.2948), true); // Visby
  assert.equal(isPointInSweden(59.9139, 10.7522), false); // Oslo
  assert.equal(isPointInSweden(60.0973, 19.9348), false); // Mariehamn
  assert.equal(isPointInSweden(55.6761, 12.5683), false); // Copenhagen
});
