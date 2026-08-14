import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { afterEach, test } from "@jest/globals";
import { createApiHandler } from "../dist/api.js";
import {
  decodeHeardNodeAdvert,
  NodeAdvertRecorder,
} from "../dist/node-adverts.js";
import { BrokerStateStore } from "../dist/state-store.js";
import { isPointInSweden } from "../dist/sweden-geofence.js";
import { createWebServer } from "../dist/web-server.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
const servers = [];

afterEach(async () => {
  while (servers.length) await servers.pop().close();
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

test("only the newest advert per node is retained and expired rows disappear", async () => {
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
    false,
  );
  const afterOlderAdvert = (await store.listHeardNodeAdverts())[0];
  assert.equal(afterOlderAdvert.name, "Current");
  assert.deepEqual(afterOlderAdvert.regions, ["GOT", "STO"]);
  assert.equal(afterOlderAdvert.heardAt, base + 1);
  assert.equal(afterOlderAdvert.advertHeardAt, base);

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

test("nodes API lists all nodes and filters by MQTT region or SWE boundary", async () => {
  const { store } = await storeFixture("nodes-api-");
  await store.recordHeardNodeAdvert(
    advertInput("C".repeat(64), {
      latitude: 59.3293,
      longitude: 18.0686,
      region: "STO",
    }),
  );
  await store.recordHeardNodeAdvert(
    advertInput("D".repeat(64), {
      advertType: "CHAT",
      latitude: 55.605,
      longitude: 13.0038,
      region: "MMX",
    }),
  );
  await store.recordHeardNodeAdvert(
    advertInput("E".repeat(64), {
      latitude: 59.9139,
      longitude: 10.7522,
      region: "STO",
    }),
  );
  await store.recordHeardNodeAdvert(
    advertInput("C".repeat(64), {
      advertTimestamp: 99,
      region: "MMX",
      observerPublicKey: "A".repeat(64),
    }),
  );

  const dashboard = createWebServer({
    host: "127.0.0.1",
    port: 0,
    handlers: [
      createApiHandler({
        stateStore: store,
        getRegionLookup: () => ({
          STO: {
            friendlyName: "Stockholm",
            primaryRegion: "STO",
            isPrimary: true,
            isAllowed: true,
          },
          MMX: {
            friendlyName: "Malmö",
            primaryRegion: "MMX",
            isPrimary: true,
            isAllowed: true,
          },
        }),
        getDashboardSnapshot: async () => ({
          generatedAt: Date.now(),
          regionLookup: {
            STO: {
              friendlyName: "Stockholm",
              primaryRegion: "STO",
              isPrimary: true,
              isAllowed: true,
            },
            MMX: {
              friendlyName: "Malmö",
              primaryRegion: "MMX",
              isPrimary: true,
              isAllowed: true,
            },
          },
        }),
      }),
    ],
  });
  servers.push(dashboard);
  const port = await dashboard.listen();

  const all = await fetch(`http://127.0.0.1:${port}/api/v1/nodes`);
  assert.equal(all.status, 200);
  const allBody = await all.json();
  assert.equal(allBody.count, 3);
  assert.equal(allBody.nodes[0].rawPacketHex, undefined);
  assert.equal(allBody.nodes[0].advertHeardAt, undefined);
  assert.equal(allBody.nodes[0].regionHearings, undefined);

  const sto = await fetch(`http://127.0.0.1:${port}/api/v1/nodes?region=sto`);
  const stoBody = await sto.json();
  assert.equal(stoBody.filters.region, "STO");
  assert.equal(stoBody.count, 2);
  assert.ok(stoBody.nodes.every((node) => node.regions.includes("STO")));
  assert.equal(
    stoBody.nodes
      .find((node) => node.publicKey === "C".repeat(64))
      .regions.join(","),
    "MMX,STO",
  );

  const mmx = await fetch(`http://127.0.0.1:${port}/api/v1/nodes?region=mmx`);
  const mmxBody = await mmx.json();
  assert.equal(mmxBody.count, 2);
  assert.ok(mmxBody.nodes.every((node) => node.regions.includes("MMX")));

  const sweden = await fetch(
    `http://127.0.0.1:${port}/api/v1/nodes?region=swe`,
  );
  const swedenBody = await sweden.json();
  assert.equal(swedenBody.filters.region, "SWE");
  assert.equal(swedenBody.count, 2);
  assert.equal(
    swedenBody.nodes
      .map((node) => node.publicKey)
      .sort()
      .join(","),
    ["C".repeat(64), "D".repeat(64)].join(","),
  );

  const mapRepeaters = await (
    await fetch(
      `http://127.0.0.1:${port}/api/v1/nodes?type=repeater&hasLocation=true`,
    )
  ).json();
  assert.equal(mapRepeaters.filters.type, "REPEATER");
  assert.equal(mapRepeaters.filters.hasLocation, true);
  assert.equal(mapRepeaters.count, 2);
  assert.ok(
    mapRepeaters.nodes.every(
      (node) =>
        node.advertType === "REPEATER" &&
        node.latitude !== undefined &&
        node.longitude !== undefined,
    ),
  );

  const invalid = await fetch(
    `http://127.0.0.1:${port}/api/v1/nodes?region=sweden`,
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "invalid_request");

  const invalidLocation = await fetch(
    `http://127.0.0.1:${port}/api/v1/nodes?hasLocation=yes`,
  );
  assert.equal(invalidLocation.status, 400);

  const node = await (
    await fetch(`http://127.0.0.1:${port}/api/v1/nodes/${"c".repeat(64)}`)
  ).json();
  assert.equal(node.node.publicKey, "C".repeat(64));
  assert.equal(node.node.regions.join(","), "MMX,STO");
  assert.equal(typeof node.node.rawPacketHex, "string");
  assert.equal(typeof node.node.advertHeardAt, "number");
  assert.equal(node.node.regionHearings.length, 2);

  const missing = await fetch(
    `http://127.0.0.1:${port}/api/v1/nodes/${"9".repeat(64)}`,
  );
  assert.equal(missing.status, 404);
  const missingBody = await missing.json();
  assert.equal(missingBody.status, undefined);
  assert.equal(missingBody.code, "not_found");
  assert.equal(
    missingBody.message,
    "No unexpired advert was found for this node.",
  );

  const regions = await (
    await fetch(`http://127.0.0.1:${port}/api/v1/regions`)
  ).json();
  assert.equal(regions.geographicFilters.join(","), "SWE");
  assert.equal(regions.count, 2);
  assert.equal(
    regions.regions.find((region) => region.code === "STO").nodeCount,
    2,
  );
  assert.equal(
    regions.regions.find((region) => region.code === "MMX").nodeCount,
    2,
  );
  assert.equal(regions.regions[0].isAllowed, undefined);
  assert.equal(regions.regions[0].configured, undefined);
  assert.equal(regions.regions[0].isPrimary, undefined);
});
