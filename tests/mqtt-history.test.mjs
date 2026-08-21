import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, jest, test } from "@jest/globals";
import { DefaultMeshCorePacketDecoder } from "../dist/meshcore-packet-decoder.js";
import { MqttHistoryService } from "../dist/mqtt-history.js";
import { temporaryDatabase } from "./test-database.mjs";

const OBSERVER_A = "A".repeat(64);
const OBSERVER_B = "B".repeat(64);
const NODE = "C".repeat(64);
const NODE_2 = "D".repeat(64);
const DAY = 86_400_000;
const VALID_ADVERT_PACKET =
  "11007E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C94006CE7CF682E58408DD8FCC51906ECA98EBF94A037886BDADE7ECD09FD92B839491DF3809C9454F5286D1D3370AC31A34593D569E9A042A3B41FD331DFFB7E18599CE1E60992A076D50238C5B8F85757375354522F50756765744D65736820436F75676172";
const fixtures = [];

afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

const storage = (overrides = {}) => ({
  retentionDays: 30,
  cleanupIntervalMinutes: 60,
  cleanupBatchSize: 2,
  storeInternal: false,
  storeSerial: false,
  ...overrides,
});

function packet(topic, body, options = {}) {
  const payload = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return {
    cmd: "publish",
    topic,
    payload,
    qos: options.qos ?? 0,
    retain: options.retain ?? false,
    dup: options.dup ?? false,
  };
}

function topic(observer, subtopic, region = "STO") {
  return `meshcore/${region}/${observer}/${subtopic}`;
}

function decoded(type, typeCode, payload, overrides = {}) {
  return {
    status: "decoded",
    packetType: type,
    packetTypeCode: typeCode,
    payloadType: type,
    payloadTypeCode: typeCode,
    routeType: "FLOOD",
    decoded: {
      messageHash: "00000000",
      routeType: 1,
      payloadType: typeCode,
      payloadVersion: 0,
      pathLength: overrides.path?.length ?? 0,
      pathHashSize: 1,
      path: overrides.path ?? null,
      payload: { raw: overrides.rawPayload ?? "", decoded: payload },
      totalBytes: 2,
      isValid: true,
    },
  };
}

async function historyFixture(options = {}) {
  const fixture = await temporaryDatabase("mqtt-history-");
  fixtures.push(fixture);
  const clock = { now: options.now ?? 1_800_000_000_000 };
  const service = new MqttHistoryService(
    fixture.database,
    storage(options.storage),
    "collector-test",
    {
      decoder: options.decoder,
      now: () => clock.now,
      startLoops: false,
    },
  );
  await service.start();
  return { fixture, service, clock };
}

test("stores the authoritative MQTT bytes before malformed data is processed", async () => {
  const { fixture, service } = await historyFixture();
  const payload = Buffer.from([0xff, 0xfe, 0x00]);
  await service.capturePublish(packet("meshcore/STO/bad/packets", payload));
  await service.drain();
  const row = await fixture.database.get(
    "SELECT payload_blob, payload_text, parse_status, processing_status FROM mqtt_events",
  );
  assert.deepEqual(Buffer.from(row.payload_blob), payload);
  assert.equal(row.payload_text, null);
  assert.equal(row.parse_status, "topic_error");
  assert.equal(row.processing_status, "processed_with_warnings");
  assert.equal(
    Number(
      (
        await fixture.database.get(
          "SELECT COUNT(*) AS count FROM processing_errors",
        )
      ).count,
    ),
    1,
  );
  await service.stop();
});

test("realistic MQTT fixtures cover public history without a raw subtopic", async () => {
  const document = JSON.parse(
    await readFile(
      new URL("./fixtures/mqtt-history.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(document.cases.every((entry) => entry.subtopic !== "raw"));
  const { fixture, service, clock } = await historyFixture({
    decoder: new DefaultMeshCorePacketDecoder(),
  });
  for (const entry of document.cases) {
    const body = entry.payload_text
      ? entry.payload_text
      : {
          origin_id: document.observer_a,
          ...entry.payload,
        };
    await service.capturePublish(
      packet(topic(document.observer_a, entry.subtopic), body, {
        retain: entry.retain,
      }),
    );
    clock.now += 1;
  }
  const neighbor = document.cases.find((entry) => entry.name === "neighbors");
  await service.capturePublish(
    packet(
      topic(document.observer_a, neighbor.subtopic),
      { origin_id: document.observer_a, ...neighbor.payload },
      { retain: true },
    ),
  );
  const advert = document.cases.find((entry) => entry.name === "advert_packet");
  await service.capturePublish(
    packet(topic(document.observer_b, advert.subtopic), {
      origin_id: document.observer_b,
      ...advert.payload,
    }),
  );
  await service.drain();
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM mqtt_events"))
        .count,
    ),
    document.cases.length + 2,
  );
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM messages"))
        .count,
    ),
    1,
  );
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM trace_events"))
        .count,
    ),
    1,
  );
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM packets"))
        .count,
    ),
    6,
  );
  assert.deepEqual(
    (
      await fixture.database.all(
        "SELECT suspected_replay FROM neighbor_snapshots ORDER BY id",
      )
    ).map((row) => Number(row.suspected_replay)),
    [0, 1],
  );
  await service.stop();
});

test("normalizes status history, generic metrics and radio settings", async () => {
  const { fixture, service, clock } = await historyFixture();
  await service.capturePublish(
    packet(topic(OBSERVER_A, "status"), {
      origin_id: OBSERVER_A,
      timestamp: new Date(clock.now - 5_000).toISOString(),
      origin: "Observer alpha",
      model: "T-Deck",
      firmware_version: "1.2.3",
      battery: 4.1,
      stats: { uptime: 123, healthy: true },
      params: { freq: 869.525, bw: 125, sf: 11, cr: 5 },
      tx_power_dbm: 22,
      future_field: { preserved: true },
    }),
  );
  await service.drain();
  const status = await fixture.database.get(
    "SELECT model, firmware_version, raw_json FROM observer_status_events",
  );
  assert.equal(status.model, "T-Deck");
  assert.equal(status.firmware_version, "1.2.3");
  assert.equal(JSON.parse(status.raw_json).future_field.preserved, true);
  assert.deepEqual(
    (
      await fixture.database.all(
        "SELECT metric_name FROM observer_metrics ORDER BY metric_name",
      )
    ).map((row) => row.metric_name),
    ["battery", "stats.healthy", "stats.uptime", "tx_power_dbm"],
  );
  const radio = await fixture.database.get(
    "SELECT frequency_mhz, bandwidth_khz, spreading_factor, coding_rate, tx_power_dbm FROM observer_radio_history",
  );
  assert.deepEqual(Object.values(radio).map(Number), [869.525, 125, 11, 5, 22]);
  await service.stop();
});

test("retained neighbor replay does not refresh calculated RF time", async () => {
  const { fixture, service, clock } = await historyFixture();
  const body = {
    origin_id: OBSERVER_A,
    timestamp: new Date(clock.now - 10_000).toISOString(),
    total_neighbors: 2,
    queried_neighbors: 1,
    truncated: true,
    self: { scopes: "Europe, UK,Europe", default_scope: "Europe" },
    neighbors: [
      {
        pubkey: NODE,
        snr: 8.5,
        rssi: -90,
        heard_secs_ago: 120,
        scopes: "*,Europe",
        status: "future_status",
      },
    ],
  };
  await service.capturePublish(
    packet(topic(OBSERVER_A, "neighbors"), body, { retain: true }),
  );
  await service.drain();
  const first = await fixture.database.get(
    "SELECT calculated_last_heard_at_ms FROM neighbor_entries",
  );
  clock.now += 60_000;
  await service.capturePublish(
    packet(topic(OBSERVER_A, "neighbors"), body, { retain: true }),
  );
  await service.drain();
  const snapshots = await fixture.database.all(
    "SELECT suspected_replay FROM neighbor_snapshots ORDER BY id",
  );
  const entries = await fixture.database.all(
    "SELECT calculated_last_heard_at_ms FROM neighbor_entries ORDER BY id",
  );
  assert.deepEqual(
    snapshots.map((row) => Number(row.suspected_replay)),
    [0, 1],
  );
  assert.equal(
    entries[1].calculated_last_heard_at_ms,
    first.calculated_last_heard_at_ms,
  );
  const privateSnapshot = await fixture.database.get(
    "SELECT self_default_scope, reported_total_neighbors, reported_queried_neighbors, reported_truncated FROM neighbor_snapshots LIMIT 1",
  );
  assert.deepEqual(privateSnapshot, {
    self_default_scope: "Europe",
    reported_total_neighbors: 2,
    reported_queried_neighbors: 1,
    reported_truncated: true,
  });
  const publicSnapshot = await fixture.database.get(
    "SELECT self_scopes_json, self_default_scope, reported_total_neighbors, reported_queried_neighbors, reported_truncated FROM meshcore_public.neighbor_snapshots LIMIT 1",
  );
  assert.deepEqual(publicSnapshot, {
    self_scopes_json: '["Europe","UK"]',
    self_default_scope: "Europe",
    reported_total_neighbors: 2,
    reported_queried_neighbors: 1,
    reported_truncated: true,
  });
  const publicEntry = await fixture.database.get(
    "SELECT scopes_json FROM meshcore_public.neighbor_entries LIMIT 1",
  );
  assert.equal(publicEntry.scopes_json, '["*","Europe"]');
  assert.deepEqual(
    (
      await fixture.database.all(
        "SELECT DISTINCT scope FROM meshcore_public.neighbor_snapshot_scopes ORDER BY scope",
      )
    ).map((row) => row.scope),
    ["Europe", "UK"],
  );
  const scopedNode = await fixture.database.get(
    `SELECT entry.neighbor_public_key
     FROM meshcore_public.neighbor_entry_scopes scope
     JOIN meshcore_public.neighbor_entries entry ON entry.id = scope.entry_id
     WHERE scope.scope = $1`,
    "Europe",
  );
  assert.equal(scopedNode.neighbor_public_key, NODE);
  await service.stop();
});

test("packet identity is shared while every observer receipt remains an observation", async () => {
  const decoder = {
    name: "fixture-decoder",
    version: "1",
    decode: async () => decoded("ACK", 3, { checksum: "00" }),
  };
  const { fixture, service, clock } = await historyFixture({ decoder });
  const raw = "0xAABBcc";
  await Promise.all([
    service.capturePublish(
      packet(topic(OBSERVER_A, "packets"), {
        origin_id: OBSERVER_A,
        raw,
        RSSI: -80,
        SNR: 4,
      }),
    ),
    service.capturePublish(
      packet(topic(OBSERVER_B, "packets"), {
        origin_id: OBSERVER_B,
        raw: "AABBCC",
        score: 0.75,
      }),
    ),
  ]);
  clock.now += 1;
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: "aabbcc",
      rssi: -94,
      snr: 1,
    }),
  );
  await service.drain();
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM packets"))
        .count,
    ),
    1,
  );
  assert.equal(
    Number(
      (
        await fixture.database.get(
          "SELECT COUNT(*) AS count FROM packet_observations",
        )
      ).count,
    ),
    3,
  );
  assert.deepEqual(
    Buffer.from(
      (await fixture.database.get("SELECT raw_packet_blob FROM packets"))
        .raw_packet_blob,
    ),
    Buffer.from("aabbcc", "hex"),
  );
  await service.stop();
});

test("packet reprocessing replaces decoder-derived advert identity and trust", async () => {
  const state = { node: NODE, signatureValid: true };
  const decoder = {
    name: "upgradeable-advert-fixture",
    version: "2",
    async decode() {
      return decoded("ADVERT", 4, {
        type: 4,
        isValid: state.signatureValid,
        publicKey: state.node,
        timestamp: 100,
        signature: "fixture",
        signatureValid: state.signatureValid,
        appData: {
          flags: 128,
          deviceRole: 2,
          hasLocation: false,
          hasName: true,
          name: state.node === NODE ? "Old decode" : "New decode",
        },
      });
    },
  };
  const { fixture, service } = await historyFixture({ decoder });
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: "0100",
    }),
  );
  await service.drain();

  state.node = NODE_2;
  assert.equal(await service.reprocessPackets({ limit: 10 }), 1);
  await service.drain();
  let advert = await fixture.database.get(
    `SELECT a.node_public_key, a.verified, n.latest_name
     FROM node_adverts a JOIN nodes n ON n.id = a.node_id`,
  );
  assert.equal(advert.node_public_key, NODE_2);
  assert.equal(Number(advert.verified), 1);
  assert.equal(advert.latest_name, "New decode");
  assert.deepEqual(
    (
      await fixture.database.all(
        "SELECT public_key FROM nodes ORDER BY public_key",
      )
    ).map((row) => row.public_key),
    [NODE_2],
  );
  assert.deepEqual(
    (
      await fixture.database.all(
        "SELECT public_key FROM meshcore_public.nodes ORDER BY public_key",
      )
    ).map((row) => row.public_key),
    [NODE_2],
  );

  state.signatureValid = false;
  assert.equal(await service.reprocessPackets({ limit: 10 }), 1);
  await service.drain();
  advert = await fixture.database.get(
    `SELECT a.node_public_key, a.verified, n.latest_name
     FROM node_adverts a JOIN nodes n ON n.id = a.node_id`,
  );
  assert.equal(advert.node_public_key, NODE_2);
  assert.equal(Number(advert.verified), 0);
  assert.equal(advert.latest_name, null);
  await service.stop();
});

test("advert MQTT owner keys are validated, stored privately, and projected publicly", async () => {
  const owner = "E".repeat(64);
  let ownerField = "payload";
  const decoder = {
    name: "advert-owner-fixture",
    version: "1",
    async decode() {
      return decoded("ADVERT", 4, {
        isValid: true,
        publicKey: NODE,
        timestamp: 100,
        signatureValid: true,
        mqtt:
          ownerField === "payload"
            ? { owner }
            : ownerField === "appData"
              ? { owner: "not-a-public-key" }
              : undefined,
        appData:
          ownerField === "appData"
            ? { mqtt: { owner } }
            : ownerField === "missing"
              ? {}
              : { mqtt: { owner: "not-a-public-key" } },
      });
    },
  };
  const { fixture, service } = await historyFixture({ decoder });
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: "0100",
    }),
  );
  await service.drain();
  assert.equal(
    (await fixture.database.get("SELECT owner_public_key FROM nodes"))
      .owner_public_key,
    owner,
  );
  assert.equal(
    (
      await fixture.database.get(
        "SELECT owner_public_key FROM meshcore_public.nodes",
      )
    ).owner_public_key,
    owner,
  );
  ownerField = "appData";
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: "0200",
    }),
  );
  await service.drain();
  assert.equal(
    (await fixture.database.get("SELECT owner_public_key FROM nodes"))
      .owner_public_key,
    owner,
  );
  ownerField = "missing";
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: "0300",
    }),
  );
  await service.drain();
  assert.equal(
    (await fixture.database.get("SELECT owner_public_key FROM nodes"))
      .owner_public_key,
    null,
  );
  assert.equal(
    (
      await fixture.database.get(
        "SELECT owner_public_key FROM meshcore_public.nodes",
      )
    ).owner_public_key,
    null,
  );
  await service.stop();
});

test.each([
  ["corrupt", "00", "invalid_packet"],
  ["unknown", "3100", "unknown_type"],
  ["partial", "190000", "partially_decoded"],
])(
  "real decoder preserves %s packet bytes with status %s",
  async (_name, raw, expected) => {
    const { fixture, service } = await historyFixture({
      decoder: new DefaultMeshCorePacketDecoder(),
    });
    await service.capturePublish(
      packet(topic(OBSERVER_A, "packets"), {
        origin_id: OBSERVER_A,
        raw,
      }),
    );
    await service.drain();
    const stored = await fixture.database.get(
      "SELECT raw_packet_hex, decode_status FROM packets",
    );
    assert.equal(stored.raw_packet_hex, raw.toUpperCase());
    assert.equal(stored.decode_status, expected);
    await service.stop();
  },
);

test("real decoder verifies and stores a valid MeshCore advertisement", async () => {
  const { fixture, service } = await historyFixture({
    decoder: new DefaultMeshCorePacketDecoder(),
  });
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: VALID_ADVERT_PACKET,
    }),
  );
  await service.drain();
  const stored = await fixture.database.get(
    "SELECT raw_packet_hex, decode_status, packet_type FROM packets",
  );
  assert.equal(stored.raw_packet_hex, VALID_ADVERT_PACKET);
  assert.equal(stored.decode_status, "decoded");
  assert.equal(stored.packet_type, "ADVERT");
  assert.equal(
    Number(
      (await fixture.database.get("SELECT verified FROM node_adverts"))
        .verified,
    ),
    1,
  );
  await service.stop();
});

test("decoder errors preserve packet identity and observation", async () => {
  const decoder = {
    name: "throwing-decoder-adapter",
    version: "2",
    decode: async () => ({ status: "decoder_error", error: "boom" }),
  };
  const { fixture, service } = await historyFixture({ decoder });
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: "ABCD",
    }),
  );
  await service.drain();
  const stored = await fixture.database.get(
    `SELECT p.raw_packet_hex, p.decode_status, po.id AS observation_id
     FROM packets p JOIN packet_observations po ON po.packet_id = p.id`,
  );
  assert.equal(stored.raw_packet_hex, "ABCD");
  assert.equal(stored.decode_status, "decoder_error");
  assert.ok(Number(stored.observation_id) > 0);
  await service.stop();
});

test("verified adverts update latest node state by observation order, not embedded clock", async () => {
  const decoder = {
    name: "advert-fixture",
    version: "1",
    async decode(bytes) {
      const newer = bytes[0] === 2;
      return decoded("ADVERT", 4, {
        type: 4,
        isValid: true,
        publicKey: NODE,
        timestamp: newer ? 200 : 100,
        signature: "signature",
        signatureValid: true,
        appData: {
          flags: 144,
          deviceRole: 2,
          hasLocation: true,
          hasName: true,
          location: { latitude: newer ? 59.3 : 58, longitude: 18.1 },
          name: newer ? "New name" : "Old name",
        },
      });
    },
  };
  const { fixture, service, clock } = await historyFixture({ decoder });
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: "0200",
    }),
  );
  clock.now += 1;
  await service.capturePublish(
    packet(topic(OBSERVER_B, "packets"), {
      origin_id: OBSERVER_B,
      raw: "0100",
    }),
  );
  await service.drain();
  const node = await fixture.database.get(
    "SELECT latest_name, latest_advert_timestamp, latest_latitude FROM nodes",
  );
  assert.equal(node.latest_name, "Old name");
  assert.equal(Number(node.latest_advert_timestamp), 100);
  assert.equal(Number(node.latest_latitude), 58);
  const location = await fixture.database.get(
    "SELECT public.ST_Y(location::public.geometry) AS latitude, public.ST_X(location::public.geometry) AS longitude FROM meshcore_public.nodes",
  );
  assert.deepEqual(
    {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
    },
    { latitude: 58, longitude: 18.1 },
  );
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM node_adverts"))
        .count,
    ),
    2,
  );
  await service.stop();
});

test("far-future embedded advert timestamps never pin latest node state", async () => {
  const decoder = {
    name: "far-future-advert-fixture",
    version: "1",
    async decode(bytes) {
      return decoded("ADVERT", 4, {
        type: 4,
        isValid: true,
        publicKey: NODE,
        timestamp: bytes[0] === 1 ? 410_000_000_000 : 100,
        signature: "signature",
        signatureValid: true,
        appData: {
          flags: 144,
          deviceRole: 2,
          hasLocation: false,
          hasName: true,
          name: bytes[0] === 1 ? "Skewed clock name" : "Later observation name",
        },
      });
    },
  };
  const { fixture, service, clock } = await historyFixture({ decoder });
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: "0100",
    }),
  );
  clock.now += 1;
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: "0200",
    }),
  );
  await service.drain();
  const node = await fixture.database.get(
    "SELECT latest_name, latest_advert_timestamp FROM nodes",
  );
  assert.equal(node.latest_name, "Later observation name");
  assert.equal(Number(node.latest_advert_timestamp), 100);
  await service.stop();
});

test("invalid adverts remain historical but never become trusted latest node state", async () => {
  const decoder = {
    name: "invalid-advert-fixture",
    version: "1",
    decode: async () =>
      decoded("ADVERT", 4, {
        type: 4,
        isValid: true,
        publicKey: NODE,
        timestamp: 300,
        signature: "bad",
        signatureValid: false,
        signatureError: "signature mismatch",
        appData: {
          flags: 128,
          deviceRole: 1,
          hasLocation: false,
          hasName: true,
          name: "Untrusted",
        },
      }),
  };
  const { fixture, service } = await historyFixture({ decoder });
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: "0101",
    }),
  );
  await service.drain();
  const node = await fixture.database.get(
    "SELECT latest_name, latest_advert_timestamp FROM nodes",
  );
  const advert = await fixture.database.get(
    "SELECT verified, verification_error FROM node_adverts",
  );
  const event = await fixture.database.get(
    "SELECT processing_status FROM mqtt_events",
  );
  assert.equal(node.latest_name, null);
  assert.equal(node.latest_advert_timestamp, null);
  assert.equal(Number(advert.verified), 0);
  assert.match(advert.verification_error, /signature/i);
  assert.equal(event.processing_status, "processed_with_warnings");
  await service.stop();
});

test("normalizes paths, traces, encrypted messages and telemetry idempotently", async () => {
  const decoder = {
    name: "normalization-fixture",
    version: "1",
    async decode(bytes) {
      switch (bytes[0]) {
        case 1:
          return decoded("ADVERT", 4, {
            type: 4,
            isValid: true,
            publicKey: NODE,
            timestamp: 100,
            signature: "valid",
            signatureValid: true,
            appData: {
              flags: 128,
              deviceRole: 4,
              hasLocation: false,
              hasName: true,
              name: "Sensor",
            },
          });
        case 2:
          return decoded("TRACE", 9, {
            traceTag: "trace-1",
            sourceHash: "CC",
            pathHashes: ["CC", "CCCC"],
            snrValues: [4.5, -1],
          });
        case 3:
          return decoded(
            "TXT_MSG",
            2,
            {
              sourceHash: "CC",
              destinationHash: "DD",
              ciphertext: "AABB",
            },
            { rawPayload: "AABB" },
          );
        case 4:
          return decoded("RESPONSE", 1, {
            sourceHash: "CC",
            telemetry: [
              {
                metric_name: "temperature",
                value: 21.5,
                unit: "celsius",
                channel: 1,
              },
              { metric_name: "online", value: true },
            ],
          });
        default:
          return decoded(
            "ACK",
            3,
            { checksum: "00" },
            { path: ["CC", "CCCC"] },
          );
      }
    },
  };
  const { fixture, service, clock } = await historyFixture({ decoder });
  for (const value of [1, 2, 3, 4, 5]) {
    await service.capturePublish(
      packet(topic(OBSERVER_A, "packets"), {
        origin_id: OBSERVER_A,
        raw: `${value.toString(16).padStart(2, "0")}00`,
      }),
    );
    clock.now += 1;
  }
  await service.drain();
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM packet_paths"))
        .count,
    ),
    1,
  );
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM trace_hops"))
        .count,
    ),
    2,
  );
  const message = await fixture.database.get(
    "SELECT encrypted, text, payload_blob FROM messages",
  );
  assert.equal(Number(message.encrypted), 1);
  assert.equal(message.text, null);
  assert.deepEqual(
    Buffer.from(message.payload_blob),
    Buffer.from("aabb", "hex"),
  );
  assert.deepEqual(
    (
      await fixture.database.all(
        "SELECT metric_name FROM telemetry_values ORDER BY metric_name",
      )
    ).map((row) => row.metric_name),
    ["online", "temperature"],
  );
  assert.equal(
    Number(
      (
        await fixture.database.get(
          "SELECT COUNT(*) AS count FROM node_sightings",
        )
      ).count,
    ),
    4,
  );

  assert.equal(await service.reprocessMqttEvents({ limit: 10 }), 5);
  await service.drain();
  assert.equal(
    Number(
      (
        await fixture.database.get(
          "SELECT observation_count FROM observer_region_history",
        )
      ).observation_count,
    ),
    5,
  );
  assert.deepEqual(
    (
      await fixture.database.all(
        "SELECT evidence_count FROM node_prefix_candidates ORDER BY prefix_length_bytes",
      )
    ).map((row) => Number(row.evidence_count)),
    [1, 1, 1],
  );
  assert.deepEqual(
    (
      await fixture.database.all(
        `SELECT p.prefix_hex, p.prefix_length_bytes, p.evidence_count, n.public_key
         FROM meshcore_public.node_prefix_candidates p
         JOIN meshcore_public.nodes n ON n.public_key = p.node_public_key
         ORDER BY p.prefix_length_bytes, p.prefix_hex`,
      )
    ).map((row) => [
      row.prefix_hex,
      Number(row.prefix_length_bytes),
      Number(row.evidence_count),
      row.public_key,
    ]),
    (
      await fixture.database.all(
        `SELECT c.prefix_hex, c.prefix_length_bytes, c.evidence_count, n.public_key
         FROM node_prefix_candidates c JOIN nodes n ON n.id = c.node_id
         ORDER BY c.prefix_length_bytes, c.prefix_hex`,
      )
    ).map((row) => [
      row.prefix_hex,
      Number(row.prefix_length_bytes),
      Number(row.evidence_count),
      row.public_key,
    ]),
  );
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM messages"))
        .count,
    ),
    1,
  );
  await service.stop();
});

test("lists every supported packet type and its public projections", async () => {
  const types = [
    [0x00, "REQUEST", {}],
    [0x01, "RESPONSE", { telemetry: [{ metric_name: "battery", value: 4.1 }] }],
    [
      0x02,
      "TXT_MSG",
      { sourceHash: "CC", destinationHash: "DD", ciphertext: "AABB" },
    ],
    [0x03, "ACK", { checksum: "00" }],
    [
      0x04,
      "ADVERT",
      {
        publicKey: NODE,
        timestamp: 100,
        signatureValid: true,
        appData: { name: "Sensor" },
      },
    ],
    [
      0x05,
      "GRP_TXT",
      { sourceHash: "CC", destinationHash: "DD", ciphertext: "CCDD" },
    ],
    [
      0x06,
      "GRP_DATA",
      { sourceHash: "CC", destinationHash: "DD", ciphertext: "EEFF" },
    ],
    [0x07, "ANON_REQ", {}],
    [0x08, "PATH", {}],
    [0x09, "TRACE", { traceTag: "trace", pathHashes: ["CC"] }],
    [0x0a, "MULTIPART", {}],
    [0x0b, "CONTROL", {}],
    [0x0f, "RAW_CUSTOM", {}],
  ];
  const decoder = {
    name: "supported-packet-types-fixture",
    version: "1",
    async decode(bytes) {
      const entry = types.find(([code]) => code === bytes[0]);
      assert.ok(entry, `unexpected packet type ${bytes[0]}`);
      const [code, type, payload] = entry;
      return decoded(type, code, payload, {
        path: type === "ACK" ? ["CC"] : undefined,
      });
    },
  };
  const { fixture, service, clock } = await historyFixture({ decoder });
  for (const [code] of types) {
    await service.capturePublish(
      packet(topic(OBSERVER_A, "packets"), {
        origin_id: OBSERVER_A,
        raw: `${code.toString(16).padStart(2, "0")}00`,
      }),
    );
    clock.now += 1;
  }
  await service.drain();

  const expectedTypes = types.map(([, type]) => type).sort();
  for (const schema of ["meshcore_private", "meshcore_public"]) {
    const rows = await fixture.database.all(
      `SELECT packet_type FROM ${schema}.packets ORDER BY packet_type`,
    );
    assert.deepEqual(
      rows.map((row) => row.packet_type),
      expectedTypes,
    );
    assert.equal(
      Number(
        (
          await fixture.database.get(
            `SELECT COUNT(*) AS count FROM ${schema}.packet_observations`,
          )
        ).count,
      ),
      types.length,
    );
  }
  for (const [privateTable, publicTable, expected] of [
    ["node_adverts", "node_adverts", 1],
    ["node_sightings", "node_sightings", 3],
    ["packet_paths", "packet_paths", 1],
    ["packet_path_hops", "packet_path_hops", 1],
    ["trace_events", "traces", 1],
    ["trace_hops", "trace_hops", 1],
    ["messages", "messages", 3],
    ["telemetry_values", "telemetry", 1],
  ]) {
    assert.equal(
      Number(
        (
          await fixture.database.get(
            `SELECT COUNT(*) AS count FROM ${privateTable}`,
          )
        ).count,
      ),
      expected,
    );
    assert.equal(
      Number(
        (
          await fixture.database.get(
            `SELECT COUNT(*) AS count FROM meshcore_public.${publicTable}`,
          )
        ).count,
      ),
      expected,
    );
  }
  await service.stop();
});

test.each([
  [30, 29, 31],
  [7, 6, 8],
  [60, 31, 61],
])(
  "retention_days=%s uses received_at and current config",
  async (days, keptAge, deletedAge) => {
    const now = 1_900_000_000_000;
    const { fixture, service, clock } = await historyFixture({
      now: now - deletedAge * DAY,
      storage: { retentionDays: days },
    });
    await service.capturePublish(
      packet(topic(OBSERVER_A, "vendor/example"), {
        origin_id: OBSERVER_A,
        timestamp: now,
        value: "expired by receipt",
      }),
    );
    await service.drain();
    clock.now = now - keptAge * DAY;
    await service.capturePublish(
      packet(topic(OBSERVER_A, "vendor/example"), {
        origin_id: OBSERVER_A,
        timestamp: 1,
        value: "kept by receipt",
      }),
    );
    await service.drain();
    clock.now = now;
    await service.runRetention();
    const rows = await fixture.database.all(
      "SELECT payload_text FROM mqtt_events ORDER BY received_at_ms",
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0].payload_text, /kept by receipt/);
    await service.stop();
  },
);

test("retention commits and drains more than one configured cleanup batch", async () => {
  const now = 1_900_000_000_000;
  const { fixture, service, clock } = await historyFixture({
    now: now - 40 * DAY,
    storage: { cleanupBatchSize: 2 },
  });
  for (let index = 0; index < 5; index += 1) {
    await service.capturePublish(
      packet(topic(OBSERVER_A, "vendor/example"), {
        origin_id: OBSERVER_A,
        index,
      }),
    );
    await service.drain();
    clock.now += 1;
  }

  clock.now = now;
  assert.equal(await service.runRetention(), 5);
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM mqtt_events"))
        .count,
    ),
    0,
  );
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM observers"))
        .count,
    ),
    0,
  );
  assert.equal(service.getMetrics().retentionRowsDeletedTotal, 5);
  await service.stop();
});

test("shared packet survives until its last unexpired observation is removed", async () => {
  const decoder = {
    name: "fixture-decoder",
    version: "1",
    decode: async () => decoded("ACK", 3, { checksum: "00" }),
  };
  const now = 1_900_000_000_000;
  const { fixture, service, clock } = await historyFixture({
    decoder,
    now: now - 40 * DAY,
  });
  const body = { origin_id: OBSERVER_A, raw: "0d00" };
  await service.capturePublish(packet(topic(OBSERVER_A, "packets"), body));
  await service.drain();
  clock.now = now - 5 * DAY;
  await service.capturePublish(packet(topic(OBSERVER_A, "packets"), body));
  await service.drain();
  clock.now = now;
  await service.runRetention();
  assert.equal(
    Number(
      (
        await fixture.database.get(
          "SELECT COUNT(*) AS count FROM packet_observations",
        )
      ).count,
    ),
    1,
  );
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM packets"))
        .count,
    ),
    1,
  );
  clock.now = now + 26 * DAY;
  await service.runRetention();
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM packets"))
        .count,
    ),
    0,
  );
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM observers"))
        .count,
    ),
    0,
  );
  for (const table of ["packets", "packet_observations", "observers"]) {
    assert.equal(
      Number(
        (
          await fixture.database.get(
            `SELECT COUNT(*) AS count FROM meshcore_public.${table}`,
          )
        ).count,
      ),
      0,
      `retention must remove public ${table} projections`,
    );
  }
  await service.stop();
});

test("node latest state follows observation order and is recomputed from retained adverts", async () => {
  const decoder = {
    name: "retention-advert-fixture",
    version: "1",
    async decode(bytes) {
      const newer = bytes[0] === 1;
      return decoded("ADVERT", 4, {
        type: 4,
        isValid: true,
        publicKey: NODE,
        timestamp: newer ? 200 : 100,
        signature: "valid",
        signatureValid: true,
        appData: {
          flags: 128,
          deviceRole: 2,
          hasLocation: false,
          hasName: true,
          name: newer ? "New retained state" : "Old retained state",
        },
      });
    },
  };
  const now = 1_900_000_000_000;
  const { fixture, service, clock } = await historyFixture({
    decoder,
    now: now - 40 * DAY,
  });
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: "0100",
    }),
  );
  await service.drain();
  clock.now = now - 5 * DAY;
  await service.capturePublish(
    packet(topic(OBSERVER_A, "packets"), {
      origin_id: OBSERVER_A,
      raw: "0200",
    }),
  );
  await service.drain();
  assert.equal(
    (await fixture.database.get("SELECT latest_name FROM nodes")).latest_name,
    "Old retained state",
  );
  clock.now = now;
  await service.runRetention();
  const retained = await fixture.database.get(
    "SELECT latest_name, latest_advert_timestamp FROM nodes",
  );
  assert.equal(retained.latest_name, "Old retained state");
  assert.equal(Number(retained.latest_advert_timestamp), 100);
  clock.now = now + 26 * DAY;
  await service.runRetention();
  assert.equal(
    Number(
      (await fixture.database.get("SELECT COUNT(*) AS count FROM nodes")).count,
    ),
    0,
  );
  await service.stop();
});

test("startup recovers stale processing and reprocessing preserves received_at", async () => {
  const fixture = await temporaryDatabase("mqtt-recovery-");
  fixtures.push(fixture);
  const now = 1_900_000_000_000;
  const payload = Buffer.from(
    JSON.stringify({ origin_id: OBSERVER_A, value: "recover" }),
  );
  await fixture.database.run(
    `INSERT INTO mqtt_events(
       topic, payload_blob, payload_text, payload_sha256, qos, retain, dup,
       received_at_ms, payload_format, parse_status, processing_status,
       processing_started_at_ms, parser_name, parser_version,
       collector_instance_id, created_at_ms, updated_at_ms
       ) VALUES ($1, $2, $3, $4, 0, false, false, $5, 'json', 'pending', 'processing', $6,
        'old-parser', '0', 'old-collector', $7, $8)`,
    topic(OBSERVER_A, "vendor/example"),
    payload,
    payload.toString(),
    "digest",
    now - DAY,
    now - 10 * 60_000,
    now - DAY,
    now - DAY,
  );
  const service = new MqttHistoryService(
    fixture.database,
    storage(),
    "collector-restarted",
    { now: () => now, startLoops: false },
  );
  await service.start();
  await service.drain();
  const original = await fixture.database.get(
    "SELECT id, received_at_ms, processing_status FROM mqtt_events",
  );
  assert.equal(original.processing_status, "processed");
  assert.equal(await service.reprocessMqttEvents({ limit: 10 }), 1);
  await service.drain();
  const reprocessed = await fixture.database.get(
    "SELECT received_at_ms, processing_status FROM mqtt_events WHERE id = $1",
    original.id,
  );
  assert.equal(reprocessed.received_at_ms, original.received_at_ms);
  assert.equal(reprocessed.processing_status, "processed");
  await service.stop();
});

test("retention never deletes events that are being processed", async () => {
  const now = 1_900_000_000_000;
  const { fixture, service, clock } = await historyFixture({
    now: now - 40 * DAY,
  });
  const payload = Buffer.from(JSON.stringify({ origin_id: OBSERVER_A }));
  await fixture.database.run(
    `INSERT INTO mqtt_events(
       topic, payload_blob, payload_text, payload_sha256, qos, retain, dup,
       received_at_ms, payload_format, parse_status, processing_status,
       processing_started_at_ms, parser_name, parser_version,
       collector_instance_id, created_at_ms, updated_at_ms
       ) VALUES ($1, $2, $3, 'digest', 0, false, false, $4, 'json', 'pending', 'processing', $5,
        'fixture', '0', 'fixture', $6, $7)`,
    topic(OBSERVER_A, "vendor/example"),
    payload,
    payload.toString(),
    now - 40 * DAY,
    now - 40 * DAY,
    now - 40 * DAY,
    now - 40 * DAY,
  );
  clock.now = now;
  assert.equal(await service.runRetention(), 0);
  const event = await fixture.database.get(
    "SELECT processing_status FROM mqtt_events",
  );
  assert.equal(event.processing_status, "processing");
  await fixture.database.run(
    "UPDATE mqtt_events SET processing_status = 'pending'",
  );
  await service.drain();
  await service.stop();
});

test("observer region history stays exact across ingestion, reprocessing, and retention", async () => {
  const now = 1_900_000_000_000;
  const { fixture, service, clock } = await historyFixture({
    now: now - 40 * DAY,
  });
  for (let index = 0; index < 5; index += 1) {
    await service.capturePublish(
      packet(topic(OBSERVER_A, "vendor/example"), { origin_id: OBSERVER_A }),
    );
    await service.drain();
    clock.now += 1;
  }
  const expectExact = async () => {
    const current = await fixture.database.get(
      "SELECT first_seen_at_ms, last_seen_at_ms, observation_count FROM observer_region_history",
    );
    const recomputed = await fixture.database.get(
      `SELECT min(received_at_ms) AS first_seen_at_ms, max(received_at_ms) AS last_seen_at_ms,
              count(*) AS observation_count FROM mqtt_events WHERE observer_id IS NOT NULL AND region IS NOT NULL`,
    );
    if (!recomputed || Number(recomputed.observation_count ?? 0) === 0) {
      assert.equal(current, undefined);
      return;
    }
    assert.deepEqual(
      {
        first: Number(current.first_seen_at_ms),
        last: Number(current.last_seen_at_ms),
        count: Number(current.observation_count),
      },
      {
        first: Number(recomputed.first_seen_at_ms),
        last: Number(recomputed.last_seen_at_ms),
        count: Number(recomputed.observation_count),
      },
    );
  };
  await expectExact();
  assert.equal(await service.reprocessMqttEvents({ limit: 10 }), 5);
  await service.drain();
  await expectExact();
  clock.now = now;
  assert.equal(await service.runRetention(), 5);
  await expectExact();
  await service.stop();
});

test("failed events with recorded processing errors are not requeued on every boot", async () => {
  const now = 1_900_000_000_000;
  const fixture = await temporaryDatabase("mqtt-poison-");
  fixtures.push(fixture);
  await fixture.database.run(
    `INSERT INTO mqtt_events(
       topic, payload_blob, payload_text, payload_sha256, qos, retain, dup,
       received_at_ms, payload_format, parse_status, processing_status,
       processing_started_at_ms, parser_name, parser_version,
       collector_instance_id, created_at_ms, updated_at_ms
       ) VALUES ($1, $2, $3, 'digest', 0, false, false, $4, 'binary', 'failed', 'failed',
        NULL, 'old-parser', '0', 'old-collector', $5, $6)`,
    topic(OBSERVER_A, "packets"),
    Buffer.from("00"),
    null,
    now - DAY,
    now - DAY,
    now - DAY,
  );
  const eventRow = await fixture.database.get(
    "SELECT id FROM mqtt_events LIMIT 1",
  );
  await fixture.database.run(
    `INSERT INTO processing_errors(
       mqtt_event_id, packet_id, stage, error_code, error_message,
       processor_name, processor_version, received_at_ms, created_at_ms
      ) VALUES ($1, NULL, 'normalize', 'poison', 'poison payload', 'fixture', '1', $2, $3)`,
    eventRow.id,
    now - DAY,
    now - DAY,
  );
  const service = new MqttHistoryService(
    fixture.database,
    storage(),
    "collector-poison",
    { now: () => now, startLoops: false },
  );
  await service.start();
  const status = await fixture.database.get(
    "SELECT processing_status FROM mqtt_events WHERE id = $1",
    eventRow.id,
  );
  assert.equal(status.processing_status, "failed");
  await service.stop();
});

test("targeted reprocessing of old events never regresses observer latest_region", async () => {
  const now = 1_900_000_000_000;
  const { fixture, service, clock } = await historyFixture({
    now: now - 40 * DAY,
  });
  await service.capturePublish(
    packet(topic(OBSERVER_A, "status"), { origin_id: OBSERVER_A }),
  );
  await service.drain();
  clock.now = now - DAY;
  await service.capturePublish(
    packet(topic(OBSERVER_A, "status", "GOT"), { origin_id: OBSERVER_A }),
  );
  await service.drain();
  const before = await fixture.database.get(
    "SELECT latest_region FROM observers",
  );
  assert.equal(before.latest_region, "GOT");
  assert.equal(
    await service.reprocessMqttEvents({ from: 0, to: now - 9 * DAY }),
    1,
  );
  await service.drain();
  const after = await fixture.database.get(
    "SELECT latest_region FROM observers",
  );
  assert.equal(after.latest_region, "GOT");
  await service.stop();
});

test("retained neighbor re-delivery of a live snapshot is suspected replay without new RF activity", async () => {
  const { fixture, service, clock } = await historyFixture();
  const body = {
    origin_id: OBSERVER_A,
    timestamp: new Date(clock.now - 10_000).toISOString(),
    self: { scopes: "Europe, UK,Europe" },
    neighbors: [
      {
        pubkey: NODE,
        snr: 8.5,
        rssi: -90,
        heard_secs_ago: 120,
        scopes: "*,Europe",
        status: "future_status",
      },
    ],
  };
  await service.capturePublish(
    packet(topic(OBSERVER_A, "neighbors"), body, { retain: false }),
  );
  await service.drain();
  clock.now += 60_000;
  await service.capturePublish(
    packet(topic(OBSERVER_A, "neighbors"), body, { retain: true }),
  );
  await service.drain();
  const snapshots = await fixture.database.all(
    "SELECT suspected_replay, mqtt_retained FROM neighbor_snapshots ORDER BY id",
  );
  assert.deepEqual(
    snapshots.map((row) => Number(row.suspected_replay)),
    [0, 1],
  );
  assert.equal(snapshots[1].mqtt_retained, true);
  await service.stop();
});

test("neighbor calculated last heard time anchors on server receipt, not embedded clocks", async () => {
  const { fixture, service, clock } = await historyFixture();
  const body = {
    origin_id: OBSERVER_A,
    timestamp: new Date(clock.now + 90 * DAY).toISOString(),
    self: { scopes: "Europe, UK,Europe" },
    neighbors: [
      {
        pubkey: NODE,
        snr: 8.5,
        rssi: -90,
        heard_secs_ago: 120,
        scopes: "*,Europe",
        status: "future_status",
      },
    ],
  };
  await service.capturePublish(packet(topic(OBSERVER_A, "neighbors"), body));
  await service.drain();
  const entry = await fixture.database.get(
    "SELECT calculated_last_heard_at_ms FROM neighbor_entries",
  );
  assert.equal(Number(entry.calculated_last_heard_at_ms), clock.now - 120_000);

  await service.stop();
});

test("retention survives an interrupted expired-event batch and skips orphan cleanup", async () => {
  const { service } = await historyFixture();
  const original = service.retention.deleteExpiredEvents.bind(
    service.retention,
  );
  service.retention.deleteExpiredEvents = async () => {
    throw new Error("statement was interrupted");
  };
  const orphanSpy = jest.spyOn(service.retention, "deleteOrphans");

  assert.equal(await service.runRetention(), 0);
  assert.equal(orphanSpy.mock.calls.length, 0);
  assert.equal(service.getMetrics().retentionFailuresTotal, 1);

  service.retention.deleteExpiredEvents = original;
  await service.stop();
});

test("orphan cleanup does not run when no event batch deleted rows", async () => {
  const { service } = await historyFixture();
  const orphanSpy = jest.spyOn(service.retention, "deleteOrphans");

  assert.equal(await service.runRetention(), 0);
  assert.equal(orphanSpy.mock.calls.length, 0);
  await service.stop();
});
