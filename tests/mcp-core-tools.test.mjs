import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { MqttHistoryService } from "../dist/mqtt-history.js";
import { PublicMcpQueryService } from "../dist/mcp-public-query.js";
import { temporaryDatabase } from "./test-database.mjs";

const OBSERVERS = ["A".repeat(64), "B".repeat(64), "F".repeat(64)];
const NODES = ["C".repeat(64), "D".repeat(64), "E".repeat(64)];
const fixtures = [];

afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

function packet(topic, body) {
  return {
    cmd: "publish",
    topic,
    payload: Buffer.from(JSON.stringify(body)),
    qos: 0,
    retain: false,
    dup: false,
  };
}

function decodedAdvert(index) {
  return {
    status: "decoded",
    packetType: "ADVERT",
    packetTypeCode: 4,
    payloadType: "ADVERT",
    payloadTypeCode: 4,
    routeType: "FLOOD",
    decoded: {
      routeType: 1,
      payloadType: 4,
      pathHashSize: 1,
      path: null,
      payload: {
        raw: "",
        decoded: {
          type: 4,
          isValid: true,
          publicKey: NODES[index],
          timestamp: index === 0 ? 2 : 1_800_000_000 + index,
          signature: `signature-${index}`,
          signatureValid: true,
          appData: {
            flags: 144,
            deviceRole: index === 0 ? 2 : 1,
            hasLocation: true,
            hasName: true,
            location: {
              latitude: index === 1 ? 0 : 59.3 + index,
              longitude: index === 1 ? 0 : 18.1 + index,
            },
            name: `Public node ${index}`,
          },
        },
      },
      isValid: true,
    },
  };
}

test("core public queries expose normalized data with stable bounded cursors", async () => {
  const fixture = await temporaryDatabase("mcp-core-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
  const decoder = {
    name: "mcp-core-fixture",
    version: "1",
    async decode(bytes) {
      return decodedAdvert(bytes[0] - 1);
    },
  };
  const storage = {
    retentionDays: 30,
    cleanupIntervalMinutes: 60,
    cleanupBatchSize: 100,
    storeInternal: false,
    storeSerial: false,
  };
  const config = {
    enabled: true,
    path: "/mcp/v2",
    defaultLimit: 2,
    maxLimit: 3,
  };
  const history = new MqttHistoryService(
    fixture.database,
    storage,
    "mcp-core-test",
    { decoder, now: () => clock.now, startLoops: false },
  );
  await history.start();

  for (const [index, observer] of OBSERVERS.entries()) {
    await history.capturePublish(
      packet(`meshcore/STO/${observer}/status`, {
        origin_id: observer,
        timestamp: new Date(clock.now - 1_000).toISOString(),
        origin: `Observer ${index}`,
        model: `Model ${index}`,
        firmware_version: `1.0.${index}`,
        battery: 4 + index / 10,
        stats:
          index === 0
            ? {
                battery_mv: 4036,
                last_rssi: -107,
                noise_floor: -120,
                last_snr: 5,
                uptime: 42,
              }
            : undefined,
        params: { freq: 869.525, bw: 125, sf: 11, cr: 5 },
        tx_power_dbm: 22,
      }),
    );
    clock.now += 1;
    await history.capturePublish(
      packet(`meshcore/STO/${observer}/packets`, {
        origin_id: observer,
        raw: `${(index + 1).toString(16).padStart(2, "0")}00`,
        RSSI: -100 + index * 10,
        SNR: index + 1,
        score: 50 + index,
      }),
    );
    clock.now += 1;
  }
  const repeatedPacketAt = clock.now + 10_000;
  clock.now = repeatedPacketAt;
  await history.capturePublish(
    packet(`meshcore/STO/${OBSERVERS[0]}/packets`, {
      origin_id: OBSERVERS[0],
      raw: "0100",
      RSSI: -80,
      SNR: 7,
      score: 60,
    }),
  );
  await history.capturePublish(
    packet(`meshcore/STO/${OBSERVERS[0]}/vendor/private`, {
      origin_id: OBSERVERS[0],
      future_secret: "must-not-be-queryable",
    }),
  );
  await history.drain();

  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => clock.now,
  );
  const storageInfo = await query.getStorageInfo();
  assert.equal(storageInfo.data.packet_count, 3);
  assert.equal(storageInfo.data.observer_count, 3);
  assert.equal(storageInfo.data.node_count, 3);
  assert.equal(storageInfo.data.retention_days, 30);
  assert.equal("database_url" in storageInfo.data, false);

  const summary = await query.getNetworkSummary({});
  assert.equal(summary.data.active_observers, 3);
  assert.equal(summary.data.active_nodes, 3);
  assert.equal(summary.data.active_repeaters, 1);
  assert.equal(summary.data.unique_packets, 3);
  assert.equal(summary.data.median_rssi, -85);
  assert.equal(summary.data.median_snr, 2.5);

  const observersPage1 = await query.listObservers({ limit: 2 });
  assert.equal(observersPage1.data.length, 2);
  assert.equal(observersPage1.meta.has_more, true);
  assert.ok(observersPage1.meta.next_cursor);
  const observersPage2 = await query.listObservers({
    limit: 2,
    cursor: observersPage1.meta.next_cursor,
  });
  assert.equal(observersPage2.data.length, 1);
  assert.equal(observersPage2.meta.has_more, false);
  assert.equal(
    new Set(
      [...observersPage1.data, ...observersPage2.data].map(
        (row) => row.public_key,
      ),
    ).size,
    3,
  );

  const observer = await query.getObserver(OBSERVERS[0]);
  assert.equal(observer.data.model, "Model 0");
  assert.equal(observer.data.firmware, "1.0.0");
  assert.equal(observer.data.radio_configuration.frequency_mhz, 869.525);
  assert.equal(observer.data.packet_observation_count, 2);
  assert.equal(observer.data.latest_neighbor_snapshot, null);
  assert.equal(
    observer.data.public_status_metrics.find(
      (metric) => metric.metric_name === "stats.battery_mv",
    ).unit,
    "mV",
  );
  assert.equal(
    observer.data.public_status_metrics.find(
      (metric) => metric.metric_name === "stats.last_rssi",
    ).unit,
    "dBm",
  );

  const historyPage1 = await query.getObserverStatusHistory({
    observerPublicKey: OBSERVERS[0],
    limit: 1,
  });
  assert.equal(historyPage1.data.length, 1);
  assert.equal(historyPage1.data[0].metrics[0].metric_name, "battery");

  const nodes = await query.listNodes({ limit: 3, region: "STO" });
  assert.deepEqual(
    new Set(nodes.data.map((node) => node.public_key)),
    new Set(NODES),
  );
  assert.equal(
    nodes.data.find((candidate) => candidate.public_key === NODES[1]).latitude,
    null,
  );

  const node = await query.getNode(NODES[0]);
  assert.equal(node.data.name, "Public node 0");
  assert.equal(node.data.role, "REPEATER");
  assert.deepEqual(node.data.latest_position, {
    latitude: 59.3,
    longitude: 18.1,
  });
  assert.equal(node.data.latest_advert.packet_hash.length, 64);
  assert.equal(
    node.data.latest_advert.advert_timestamp_raw,
    "1970-01-01T00:00:02.000Z",
  );
  assert.equal(
    nodes.data.find((candidate) => candidate.public_key === NODES[0])
      .latest_advert_at,
    node.data.latest_advert.last_observed_at,
  );

  const adverts = await query.getNodeAdverts({ publicKey: NODES[0] });
  assert.equal(adverts.data[0].verified, true);
  assert.equal(adverts.data[0].public_key, NODES[0]);
  assert.equal(adverts.data[0].capabilities.has_location, true);

  const prefix = await query.resolveNodePrefix("CC");
  assert.equal(prefix.data.ambiguous, false);
  assert.equal(prefix.data.resolution_status, "resolved");
  assert.equal(prefix.data.candidates[0].public_key, NODES[0]);
  const unresolvedPrefix = await query.resolveNodePrefix("FF");
  assert.equal(unresolvedPrefix.data.ambiguous, false);
  assert.equal(unresolvedPrefix.data.resolution_status, "unresolved");

  const packets = await query.searchPackets({ minRssi: -95, limit: 3 });
  assert.equal(packets.data.length, 3);
  assert.ok(packets.data.every((row) => !("topic" in row)));
  const packetHash = packets.data.find(
    (row) => row.observation_count_total === 1,
  ).packet_hash;
  const repeatedOnly = await query.searchPackets({
    from: repeatedPacketAt,
    to: repeatedPacketAt,
  });
  const repeatedPacketHash = repeatedOnly.data[0].packet_hash;
  const windowedPacket = await query.searchPackets({
    packetHash: repeatedPacketHash,
    from: repeatedPacketAt,
    to: repeatedPacketAt,
  });
  assert.equal(
    windowedPacket.data[0].first_seen_at,
    new Date(repeatedPacketAt).toISOString(),
  );
  assert.equal(
    windowedPacket.data[0].last_seen_at,
    windowedPacket.data[0].first_seen_at,
  );
  assert.equal(windowedPacket.data[0].observation_count, 1);
  assert.equal(windowedPacket.data[0].observation_count_total, 2);
  await assert.rejects(
    query.searchPackets({ minRssi: -50, maxRssi: -100 }),
    (error) => error.reason === "inconsistent_filter_range",
  );
  await assert.rejects(
    query.searchPackets({ cursor: observersPage1.meta.next_cursor }),
    (error) => error.reason === "invalid_pagination_cursor",
  );
  const storedPacket = await query.getPacket(packetHash);
  assert.match(storedPacket.data.raw_packet_hex, /^[0-9A-F]+$/);
  assert.equal(
    storedPacket.data.decoded_data.payload.decoded.publicKey.length,
    64,
  );
  assert.equal("decode_error" in storedPacket.data, false);

  const observations = await query.getPacketObservations({
    packetHash,
    limit: 3,
  });
  assert.equal(observations.data.length, 1);
  assert.equal(observations.data[0].region, "STO");
  assert.equal(observations.data[0].observer_public_key.length, 64);

  await history.stop();
});
