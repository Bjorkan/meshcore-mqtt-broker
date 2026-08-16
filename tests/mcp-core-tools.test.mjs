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

  const zeroZeroAdverts = await query.getNodeAdverts({ publicKey: NODES[1] });
  assert.equal(zeroZeroAdverts.data[0].latitude, null);
  assert.equal(zeroZeroAdverts.data[0].longitude, null);
  assert.equal(zeroZeroAdverts.data[0].position_quality, "zero_zero_sentinel");
  const zeroZeroPosition = await query.getNodePositionHistory({
    publicKey: NODES[1],
    limit: 10,
  });
  assert.equal(zeroZeroPosition.data.length, 1);
  assert.equal(zeroZeroPosition.data[0].latitude, null);
  assert.equal(zeroZeroPosition.data[0].longitude, null);
  assert.equal(zeroZeroPosition.data[0].position_quality, "zero_zero_sentinel");

  const prefix = await query.resolveNodePrefix("CC");
  assert.equal(prefix.data.ambiguous, false);
  assert.equal(prefix.data.resolution_status, "resolved");
  assert.equal(prefix.data.candidates[0].public_key, NODES[0]);
  const oneByteEvidence = await fixture.database.get(
    `SELECT count(*) AS count FROM node_prefix_candidates
     WHERE prefix_hex = 'CC' AND prefix_length_bytes = 1`,
  );
  assert.equal(
    prefix.data.candidates[0].evidence_count,
    Number(oneByteEvidence.count),
  );
  const unresolvedPrefix = await query.resolveNodePrefix("FF");
  assert.equal(unresolvedPrefix.data.ambiguous, false);
  assert.equal(unresolvedPrefix.data.resolution_status, "unresolved");

  const packets = await query.searchPackets({
    minRssi: -95,
    view: "raw",
    limit: 3,
  });
  assert.equal(packets.data.length, 3);
  assert.ok(packets.data.every((row) => !("topic" in row)));
  const packetHash = packets.data.find(
    (row) => row.observation_count_total === 1,
  ).packet_hash;
  const repeatedOnly = await query.searchPackets({
    from: repeatedPacketAt,
    to: repeatedPacketAt,
    view: "raw",
  });
  const repeatedPacketHash = repeatedOnly.data[0].packet_hash;
  const windowedPacket = await query.searchPackets({
    packetHash: repeatedPacketHash,
    view: "raw",
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

  const observations = await query.searchPaths({
    packetHash,
    limit: 3,
  });
  assert.equal(observations.data.length, 1);
  assert.equal(observations.data[0].region, "STO");
  assert.equal(observations.data[0].observer_public_key.length, 64);

  await history.stop();
});

test("logical packet identity groups advert flood copies and message observations", async () => {
  const fixture = await temporaryDatabase("mcp-logical-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
  const decoder = {
    name: "mcp-logical-fixture",
    version: "1",
    async decode(bytes) {
      const code = bytes[0];
      if (code === 0x51 || code === 0x52) {
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
            path: code === 0x51 ? ["AA"] : ["BB"],
            payload: {
              raw: "",
              decoded: {
                type: 4,
                isValid: true,
                publicKey: NODES[0],
                timestamp: 42,
                signature: "signature-42",
                signatureValid: true,
                appData: {
                  flags: 144,
                  deviceRole: 2,
                  hasLocation: true,
                  hasName: true,
                  location: { latitude: 59.3, longitude: 18.1 },
                  name: "Flooded repeater",
                },
              },
            },
          },
          isValid: true,
        };
      }
      if (code === 0x53) {
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
            path: ["AA"],
            payload: {
              raw: "",
              decoded: {
                type: 4,
                isValid: true,
                publicKey: NODES[0],
                timestamp: 43,
                signature: "signature-43",
                signatureValid: true,
                appData: {
                  flags: 144,
                  deviceRole: 2,
                  hasLocation: true,
                  hasName: true,
                  location: { latitude: 59.4, longitude: 18.2 },
                  name: "Flooded repeater",
                },
              },
            },
          },
          isValid: true,
        };
      }
      if (code === 0x31) {
        return {
          status: "decoded",
          packetType: "TXT_MSG",
          packetTypeCode: 2,
          payloadType: "TXT_MSG",
          payloadTypeCode: 2,
          routeType: "FLOOD",
          decoded: {
            routeType: 1,
            payloadType: 2,
            pathHashSize: 1,
            path: null,
            payload: {
              raw: "AABB",
              decoded: {
                sourceHash: "CC",
                destinationHash: "DD",
                ciphertext: "AABB",
              },
            },
          },
          isValid: true,
        };
      }
      return { status: "decoder_error", error: "boom" };
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
    defaultLimit: 50,
    maxLimit: 250,
  };
  const history = new MqttHistoryService(
    fixture.database,
    storage,
    "mcp-logical-test",
    { decoder, now: () => clock.now, startLoops: false },
  );
  await history.start();
  const publish = async (observer, raw) => {
    clock.now += 1;
    await history.capturePublish(
      packet(`meshcore/STO/${observer}/packets`, {
        origin_id: observer,
        raw,
        RSSI: -80,
        SNR: 7,
        score: 60,
      }),
    );
  };
  await publish(OBSERVERS[0], "5100");
  await publish(OBSERVERS[1], "5200");
  await publish(OBSERVERS[0], "5300");
  await publish(OBSERVERS[0], "3100");
  await publish(OBSERVERS[1], "3100");
  await publish(OBSERVERS[0], "9900");
  await history.drain();

  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => clock.now,
  );

  const logicalAdverts = await query.searchPackets({
    packetType: "ADVERT",
    view: "logical",
    limit: 10,
  });
  const flooded = logicalAdverts.data.find((row) => row.raw_packet_count === 2);
  assert.ok(flooded, "flood copies share one logical packet");
  assert.equal(logicalAdverts.data.length, 2);
  assert.equal(flooded.observation_count, 2);
  assert.equal(flooded.raw_packet_count_total, 2);
  assert.equal(flooded.observation_count_total, 2);
  assert.match(flooded.logical_packet_id, /^lp_[0-9a-f]{64}$/);

  const advertPage1 = await query.searchAdverts({ limit: 1 });
  assert.equal(advertPage1.data.length, 1);
  assert.equal(advertPage1.meta.has_more, true);
  assert.ok(advertPage1.meta.next_cursor);
  const advertPage2 = await query.searchAdverts({
    limit: 1,
    cursor: advertPage1.meta.next_cursor,
  });
  assert.equal(advertPage2.data.length, 1);
  assert.notEqual(
    advertPage2.data[0].logical_advert_id,
    advertPage1.data[0].logical_advert_id,
  );

  const positionPage1 = await query.getNodePositionHistory({
    publicKey: NODES[0],
    limit: 1,
  });
  assert.equal(positionPage1.data.length, 1);
  if (positionPage1.meta.has_more) {
    const positionPage2 = await query.getNodePositionHistory({
      publicKey: NODES[0],
      limit: 1,
      cursor: positionPage1.meta.next_cursor,
    });
    assert.ok(positionPage2.data.length >= 1);
    assert.notEqual(
      positionPage2.data[0].logical_advert_id,
      positionPage1.data[0].logical_advert_id,
    );
  }

  const rawExpansion = await query.searchPackets({
    logicalPacketId: flooded.logical_packet_id,
    view: "raw",
    limit: 10,
  });
  assert.equal(rawExpansion.data.length, 2);
  assert.equal(
    new Set(rawExpansion.data.map((row) => row.packet_hash)).size,
    2,
  );

  const adverts = await query.getNodeAdverts({
    publicKey: NODES[0],
    limit: 10,
  });
  assert.equal(adverts.data.length, 2);
  const logicalAdvert = adverts.data.find((row) => row.raw_packet_count === 2);
  assert.ok(logicalAdvert);
  assert.equal(logicalAdvert.logical_advert_id, flooded.logical_packet_id);
  assert.equal(logicalAdvert.route_count, 2);
  assert.equal(logicalAdvert.raw_packet_hashes.length, 2);
  assert.equal(new Set(logicalAdvert.raw_packet_hashes).size, 2);
  assert.equal(logicalAdvert.advert_timestamp_raw, "1970-01-01T00:00:42.000Z");

  const node = await query.getNode(NODES[0]);
  assert.equal(node.data.latest_advert.raw_packet_count, 1);
  assert.equal(
    node.data.latest_advert.advert_timestamp_raw,
    "1970-01-01T00:00:43.000Z",
  );
  assert.match(node.data.latest_advert.logical_advert_id, /^lp_[0-9a-f]{64}$/);

  const summary = await query.getNetworkSummary({});
  assert.equal(summary.data.advert_count, 2);
  assert.equal(summary.data.advert_raw_packet_count, 3);
  assert.equal(summary.data.advert_observation_count, 3);
  assert.equal(summary.data.message_count, 1);
  assert.equal(summary.data.message_observation_count, 2);
  assert.equal(summary.data.logical_packet_count, 4);

  const logicalMessages = await query.searchMessages({
    view: "logical",
    limit: 10,
  });
  assert.equal(logicalMessages.data.length, 1);
  assert.equal(logicalMessages.data[0].observation_count, 2);
  assert.equal(logicalMessages.data[0].raw_packet_count, 1);
  assert.equal(logicalMessages.data[0].encrypted, true);
  assert.match(logicalMessages.data[0].logical_message_id, /^lp_[0-9a-f]{64}$/);

  const rawMessages = await query.searchMessages({
    view: "raw",
    limit: 10,
  });
  assert.equal(rawMessages.data.length, 2);

  const activity = await query.getActivityTimeseries({
    from: clock.now - 60_000,
    to: clock.now,
    bucketMs: 60_000,
  });
  assert.equal(
    activity.data.reduce((sum, row) => sum + row.adverts, 0),
    2,
  );
  assert.equal(
    activity.data.reduce((sum, row) => sum + row.messages, 0),
    1,
  );
  assert.equal(
    activity.data.reduce((sum, row) => sum + row.logical_packets, 0),
    4,
  );

  const activityPage1 = await query.getActivityTimeseries({
    from: clock.now - 1_000,
    to: clock.now,
    bucketMs: 1,
    limit: 3,
  });
  assert.equal(activityPage1.data.length, 3);
  assert.equal(activityPage1.meta.has_more, true);
  assert.ok(activityPage1.meta.next_cursor);
  const activityPage2 = await query.getActivityTimeseries({
    from: clock.now - 1_000,
    to: clock.now,
    bucketMs: 1,
    limit: 3,
    cursor: activityPage1.meta.next_cursor,
  });
  assert.ok(activityPage2.data.length >= 1);
  assert.ok(activityPage2.data[0].timestamp > activityPage1.data[2].timestamp);

  const rawMessage = rawMessages.data[0];
  const message = await query.getMessage(rawMessage.message_id);
  assert.equal(
    message.data.logical_message_id,
    logicalMessages.data[0].logical_message_id,
  );
  assert.equal(message.data.packet_hash, rawMessage.packet_hash);
  assert.equal(message.data.observation_count, 2);
  assert.equal(message.data.raw_packet_count, 1);

  const regions = await query.listRegions();
  assert.deepEqual(
    regions.data.map((region) => region.code),
    ["STO"],
  );
  assert.equal(regions.data[0].is_allowed, true);
  assert.equal(regions.data[0].code_system, "IATA");
  assert.equal(regions.data[0].type, "region");

  const regionSummary = await query.getRegionSummary({ region: "STO" });
  assert.equal(regionSummary.data.code, "STO");
  assert.equal(regionSummary.data.code_system, "IATA");
  assert.equal(regionSummary.data.observer_count, 2);
  assert.equal(regionSummary.data.active_observers, 2);
  assert.equal(regionSummary.data.node_count, 1);
  assert.equal(regionSummary.data.repeater_count, 1);
  assert.equal(regionSummary.data.unique_packets, 5);
  assert.equal(regionSummary.data.logical_packet_count, 4);
  assert.equal(regionSummary.data.logical_advert_count, 2);
  assert.equal(regionSummary.data.message_count, 1);
  await assert.rejects(
    query.getRegionSummary({ region: "STOCKHOLM" }),
    (error) => error.reason === "invalid_region",
  );

  const advertsSearch = await query.searchAdverts({
    verified: true,
    limit: 10,
  });
  assert.equal(advertsSearch.data.length, 2);
  const advertsNear = await query.searchAdverts({
    geo: { latitude: 59.3, longitude: 18.1, radiusKm: 5 },
    limit: 10,
  });
  assert.equal(advertsNear.data.length, 1);
  const advertsWide = await query.searchAdverts({
    geo: { latitude: 59.3, longitude: 18.1, radiusKm: 50 },
    limit: 10,
  });
  assert.equal(advertsWide.data.length, 2);
  await assert.rejects(
    query.searchAdverts({ geo: { radiusKm: 5 } }),
    (error) => error.reason === "invalid_geo_filter",
  );

  const nodesRadius = await query.listNodes({
    geo: { latitude: 59.3, longitude: 18.1, radiusKm: 50 },
  });
  assert.deepEqual(
    nodesRadius.data.map((row) => row.public_key),
    [NODES[0]],
  );
  const nodesFar = await query.listNodes({
    geo: { latitude: 59.3, longitude: 18.1, radiusKm: 5 },
  });
  assert.deepEqual(nodesFar.data, []);

  const batchNodes = await query.getNodesBatch([NODES[0], "F".repeat(64)]);
  assert.equal(batchNodes.data.nodes.length, 1);
  assert.deepEqual(batchNodes.data.missing_public_keys, ["F".repeat(64)]);
  const batchObservers = await query.getObserversBatch([
    OBSERVERS[0],
    "E".repeat(64),
  ]);
  assert.equal(batchObservers.data.observers.length, 1);
  assert.deepEqual(batchObservers.data.missing_public_keys, ["E".repeat(64)]);
  const batchPackets = await query.getPacketsBatch([
    rawMessages.data[0].packet_hash,
    "0".repeat(64),
  ]);
  assert.equal(batchPackets.data.packets.length, 1);
  assert.deepEqual(batchPackets.data.missing_packet_hashes, ["0".repeat(64)]);

  const positionHistory = await query.getNodePositionHistory({
    publicKey: NODES[0],
    limit: 10,
  });
  assert.equal(positionHistory.data.length, 2);
  assert.equal(positionHistory.data[0].latitude, 59.4);
  assert.equal(
    positionHistory.data.find((row) => row.observation_count === 2).latitude,
    59.3,
  );
  assert.ok(positionHistory.data.every((row) => row.position_quality === null));

  const encryptedMessages = await query.searchMessages({
    encrypted: true,
    limit: 10,
  });
  assert.equal(encryptedMessages.data.length, 1);
  const plainMessages = await query.searchMessages({
    encrypted: false,
    limit: 10,
  });
  assert.equal(plainMessages.data.length, 0);
  const messagesByRegion = await query.searchMessages({
    region: "STO",
    limit: 10,
  });
  assert.equal(messagesByRegion.data.length, 1);
  const messagesByObserver = await query.searchMessages({
    observerPublicKey: OBSERVERS[1],
    limit: 10,
  });
  assert.equal(messagesByObserver.data.length, 1);

  const processingErrors = await query.searchProcessingErrors({ limit: 10 });
  assert.equal(processingErrors.data.length, 1);
  assert.equal(processingErrors.data[0].error_code, "decoder_error");
  assert.equal(processingErrors.data[0].region, "STO");
  assert.equal(processingErrors.data[0].observer_public_key, OBSERVERS[0]);

  const quality = await query.getDataQualitySummary({});
  assert.equal(quality.data.decoder_errors, 1);
  assert.equal(quality.data.implausible_embedded_timestamps, 3);
  assert.equal(quality.data.future_timestamps, 0);
  assert.equal(quality.data.logical_packets_with_multiple_routes, 1);
  assert.equal(quality.data.processing_errors, 1);
  assert.equal(quality.data.invalid_signatures, 0);
  assert.equal(quality.data.missing_rssi_snr, 0);

  const packetTypeSummary = await query.getPacketTypeSummary({});
  const advertRow = packetTypeSummary.data.find(
    (row) => row.packet_type === "ADVERT",
  );
  assert.equal(advertRow.logical_packet_count, 2);
  assert.equal(advertRow.raw_packet_count, 3);
  assert.equal(advertRow.observation_count, 3);
  const messageRow = packetTypeSummary.data.find(
    (row) => row.packet_type === "TXT_MSG",
  );
  assert.equal(messageRow.logical_packet_count, 1);
  assert.equal(messageRow.observation_count, 2);

  const observerSummary = await query.getObserverSummary({});
  const observer0 = observerSummary.data.find(
    (row) => row.observer_public_key === OBSERVERS[0],
  );
  assert.equal(observer0.observation_count, 4);
  assert.equal(observer0.node_count, 1);
  assert.equal(observer0.median_rssi, -80);

  const nodeSummary = await query.getNodeSummary({});
  const nodeRow = nodeSummary.data.find((row) => row.public_key === NODES[0]);
  assert.equal(nodeRow.observation_count, 5);
  assert.equal(nodeRow.observer_count, 2);
  assert.equal(nodeRow.logical_packet_count, 3);
  assert.equal(nodeRow.role, "REPEATER");
  assert.equal(nodeRow.median_rssi, -80);
  const nodeMin = await query.getNodeSummary({ minObservations: 6 });
  assert.equal(nodeMin.data.length, 0);

  await history.stop();
});

test("list regions reports truncation without a misleading cursor", async () => {
  const fixture = await temporaryDatabase("mcp-regions-");
  fixtures.push(fixture);
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
    defaultLimit: 50,
    maxLimit: 250,
  };
  await fixture.database.run(
    `INSERT INTO observers(id, public_key, first_seen_at_ms, last_seen_at_ms,
       latest_region, created_at_ms, updated_at_ms)
     VALUES (1, ?, 0, 0, 'AAA', 0, 0)`,
    "A".repeat(64),
  );
  for (let index = 0; index < 251; index += 1) {
    const code = `R${String(index).padStart(2, "0")}`;
    await fixture.database.run(
      `INSERT INTO observer_region_history(
         observer_id, region, first_seen_at_ms, last_seen_at_ms, observation_count
       ) VALUES (1, ?, 0, 0, 1)`,
      code,
    );
  }
  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => Date.now(),
  );
  const regions = await query.listRegions();
  assert.equal(regions.data.length, 250);
  assert.equal(regions.meta.has_more, false);
  assert.equal(regions.meta.next_cursor, null);
  assert.equal(regions.meta.truncated, true);
});
