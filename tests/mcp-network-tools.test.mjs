import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { MqttHistoryService } from "../dist/mqtt-history.js";
import { PublicMcpQueryService } from "../dist/mcp-public-query.js";
import { temporaryDatabase } from "./test-database.mjs";

const OBSERVER = "A".repeat(64);
const NODE = "C".repeat(64);
const fixtures = [];

afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

function packet(subtopic, body, retain = false) {
  return {
    cmd: "publish",
    topic: `meshcore/STO/${OBSERVER}/${subtopic}`,
    payload: Buffer.from(JSON.stringify({ origin_id: OBSERVER, ...body })),
    qos: 0,
    retain,
    dup: false,
  };
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
      routeType: 1,
      payloadType: typeCode,
      pathHashSize: 1,
      path: overrides.path ?? null,
      payload: { raw: overrides.rawPayload ?? "", decoded: payload },
      isValid: true,
    },
  };
}

test("network tools query normalized neighbor, path, trace, telemetry, and message data", async () => {
  const fixture = await temporaryDatabase("mcp-network-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
  const decoder = {
    name: "mcp-network-fixture",
    version: "1",
    async decode(bytes) {
      switch (bytes[0]) {
        case 1:
          return decoded("ADVERT", 4, {
            type: 4,
            isValid: true,
            publicKey: NODE,
            timestamp: 1_800_000_000,
            signature: "valid",
            signatureValid: true,
            appData: {
              flags: 128,
              deviceRole: 4,
              hasLocation: false,
              hasName: true,
              name: "Public sensor",
            },
          });
        case 2:
          return decoded("TRACE", 9, {
            traceTag: "trace-public",
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
    defaultLimit: 10,
    maxLimit: 100,
  };
  const history = new MqttHistoryService(
    fixture.database,
    storage,
    "mcp-network-test",
    { decoder, now: () => clock.now, startLoops: false },
  );
  await history.start();

  const neighborBody = {
    timestamp: new Date(clock.now - 5_000).toISOString(),
    self: { scopes: ["Europe", "Sweden"] },
    neighbors: [
      {
        pubkey: NODE,
        snr: 8.5,
        rssi: -90,
        heard_secs_ago: 120,
        status: "responded",
        scopes: ["Europe"],
      },
    ],
  };
  await history.capturePublish(packet("neighbors", neighborBody, true));
  clock.now += 1_000;
  await history.capturePublish(packet("neighbors", neighborBody, true));
  clock.now += 1_000;
  for (const value of [1, 2, 3, 4, 5]) {
    await history.capturePublish(
      packet("packets", {
        raw: `${value.toString(16).padStart(2, "0")}00`,
        RSSI: -100 + value,
        SNR: value,
        score: 40 + value,
      }),
    );
    clock.now += 1_000;
  }
  await history.drain();

  const collisionNode = `CC${"D".repeat(62)}`;
  await fixture.database.run(
    `INSERT INTO nodes(
       public_key, first_seen_at_ms, last_seen_at_ms, latest_name, latest_role,
       latest_latitude, latest_longitude, latest_advert_timestamp,
       created_at_ms, updated_at_ms
     ) VALUES (?, ?, ?, 'Collision repeater', 'REPEATER', 59.5, 18.5, NULL, ?, ?)`,
    collisionNode,
    clock.now,
    clock.now,
    clock.now,
    clock.now,
  );
  await fixture.database.run(
    `INSERT INTO node_prefix_candidates(
       prefix_hex, prefix_length_bytes, node_id, first_seen_at_ms,
       last_seen_at_ms, evidence_count, confidence
     ) SELECT 'CC', 1, id, ?, ?, 1, 1 FROM nodes WHERE public_key = ?`,
    clock.now,
    clock.now,
    collisionNode,
  );

  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => clock.now,
  );
  const neighbors = await query.getNeighbors({ observerPublicKey: OBSERVER });
  assert.equal(neighbors.data.observer_public_key, OBSERVER);
  assert.deepEqual(neighbors.data.observer_scopes, ["Europe", "Sweden"]);
  assert.equal(neighbors.data.neighbors[0].public_key, NODE);
  assert.equal(neighbors.data.neighbors[0].snr, 8.5);
  const observer = await query.getObserver(OBSERVER);
  assert.equal(
    observer.data.latest_neighbor_snapshot.neighbors[0].public_key,
    NODE,
  );
  assert.equal(observer.data.latest_neighbor_snapshot.neighbors[0].snr, 8.5);

  const neighborHistory = await query.getNeighborHistory({
    observerPublicKey: OBSERVER,
    neighborPublicKey: NODE,
    limit: 10,
  });
  assert.equal(neighborHistory.data.length, 2);
  assert.ok(neighborHistory.data.every((row) => row.rssi === -90));

  const ack = await query.searchPackets({
    packetType: "ACK",
    view: "raw",
    limit: 10,
  });
  const packetPaths = await query.searchPaths({
    packetHash: ack.data[0].packet_hash,
    limit: 10,
  });
  const packetPath = packetPaths.data[0];
  assert.equal(packetPath.hop_count, 2);
  assert.deepEqual(
    packetPath.hops.map((hop) => hop.prefix),
    ["CC", "CCCC"],
  );
  assert.equal(packetPath.hops[0].resolution_status, "ambiguous");
  assert.equal(packetPath.hops[0].resolved_public_key, null);
  assert.deepEqual(
    new Set(
      packetPath.hops[0].candidates.map((candidate) => candidate.public_key),
    ),
    new Set([NODE, collisionNode]),
  );
  assert.equal(packetPath.hops[1].resolution_status, "resolved");
  assert.equal(packetPath.hops[1].resolved_public_key, NODE);

  const signal = await query.getSignalHistory({
    observerPublicKey: OBSERVER,
    from: clock.now - 60_000,
    to: clock.now,
    bucketMs: 1_000,
    limit: 2,
  });
  assert.equal(signal.data.length, 2);
  assert.equal(signal.meta.has_more, true);
  assert.ok(signal.meta.next_cursor);
  const signalPage2 = await query.getSignalHistory({
    observerPublicKey: OBSERVER,
    from: clock.now - 60_000,
    to: clock.now,
    bucketMs: 1_000,
    limit: 2,
    cursor: signal.meta.next_cursor,
  });
  assert.equal(signalPage2.data.length, 2);
  assert.notEqual(signalPage2.data[0].timestamp, signal.data[0].timestamp);

  const activityPage1 = await query.getActivityTimeseries({
    from: clock.now - 1_000,
    to: clock.now,
    bucketMs: 1,
    limit: 2,
  });
  assert.ok(activityPage1.data.length >= 1);
  await assert.rejects(
    query.getActivityTimeseries({
      from: clock.now - 1_000,
      to: clock.now,
      bucketMs: 1,
      limit: 2,
      cursor: signal.meta.next_cursor,
    }),
    (error) => error.reason === "invalid_pagination_cursor",
  );

  const traces = await query.searchTraces({ limit: 10 });
  assert.equal(traces.data.length, 1);
  assert.equal(traces.data[0].tag, "trace-public");
  const trace = await query.getTrace(traces.data[0].trace_id);
  assert.deepEqual(
    trace.data.hops.map((hop) => hop.snr),
    [4.5, -1],
  );
  assert.equal(trace.data.hops[0].resolution_status, "ambiguous");
  assert.equal(trace.data.hops[0].resolved_public_key, null);

  const telemetry = await query.getTelemetry({
    nodePublicKey: NODE,
    limit: 10,
  });
  assert.deepEqual(
    new Set(telemetry.data.map((row) => row.metric_name)),
    new Set(["online", "temperature"]),
  );
  assert.ok(telemetry.data.every((row) => row.packet_hash.length === 64));

  const messages = await query.searchMessages({ limit: 10 });
  assert.equal(messages.data.length, 1);
  assert.equal(messages.data[0].encrypted, true);
  assert.equal(messages.data[0].text, null);
  assert.equal(messages.data[0].sender_public_key, NODE);
  assert.equal("payload_blob" in messages.data[0], false);

  const activity = await query.getActivityTimeseries({
    from: clock.now - 60_000,
    to: clock.now,
    bucketMs: 60_000,
  });
  assert.equal(activity.data.length, 1);
  assert.equal(activity.data[0].unique_packets, 5);
  assert.equal(activity.data[0].packet_observations, 5);
  assert.equal(activity.data[0].adverts, 1);
  assert.equal(activity.data[0].traces, 1);
  assert.equal(activity.data[0].telemetry, 1);
  assert.equal(activity.data[0].messages, 1);
  await assert.rejects(
    query.getActivityTimeseries({
      from: clock.now - 30 * 86_400_000,
      to: clock.now,
      bucketMs: 60_000,
    }),
    (error) => error.reason === "too_many_time_buckets",
  );

  const telemetrySearch = await query.searchTelemetry({
    nodePublicKey: NODE,
    limit: 10,
  });
  assert.ok(telemetrySearch.data.length >= 1);
  assert.ok(
    telemetrySearch.data.some((row) => row.metric_name === "temperature"),
  );
  assert.ok(
    telemetrySearch.data.every((row) => row.observer_public_key === OBSERVER),
  );
  assert.ok(telemetrySearch.data.every((row) => row.region === "STO"));

  const neighborSearch = await query.searchNeighbors({
    observerPublicKey: OBSERVER,
    limit: 10,
  });
  assert.ok(neighborSearch.data.length >= 1);
  assert.equal(neighborSearch.data[0].region, "STO");
  assert.equal(neighborSearch.data[0].neighbor_public_key, NODE);
  const neighborBySnr = await query.searchNeighbors({ minSnr: 9, limit: 10 });
  assert.equal(neighborBySnr.data.length, 0);

  const observersWithNeighbors = await query.listObservers({
    hasNeighborData: true,
    limit: 10,
  });
  assert.equal(observersWithNeighbors.data.length, 1);
  assert.equal(observersWithNeighbors.data[0].has_neighbor_data, true);
  assert.ok(observersWithNeighbors.data[0].neighbor_count_latest >= 1);
  const observersWithoutNeighbors = await query.listObservers({
    hasNeighborData: false,
    limit: 10,
  });
  assert.equal(observersWithoutNeighbors.data.length, 0);

  const signalSummary = await query.getNodeSignalSummary({
    nodePublicKey: NODE,
    from: clock.now - 60_000,
    to: clock.now,
  });
  assert.ok(signalSummary.data.length >= 1);
  const observerRow = signalSummary.data.find(
    (row) => row.observer_public_key === OBSERVER,
  );
  assert.ok(observerRow);
  assert.equal(observerRow.packet_count, 4);
  assert.equal(observerRow.median_rssi, -97.5);

  const topology = await query.getTopology({
    from: clock.now - 60_000,
    to: clock.now,
  });
  assert.equal(topology.data.edges.length, 1);
  assert.equal(topology.data.edges[0].from_node, OBSERVER);
  assert.equal(topology.data.edges[0].to_node, NODE);
  assert.deepEqual(topology.data.edges[0].evidence, ["neighbor"]);
  assert.equal(topology.data.edges[0].avg_snr_db, 8.5);
  assert.equal(topology.data.edges[0].confidence, 0.2);
  const topologyPathsOnly = await query.getTopology({
    from: clock.now - 60_000,
    to: clock.now,
    evidenceTypes: ["path"],
  });
  assert.equal(topologyPathsOnly.data.edges.length, 0);

  await history.stop();
});

test("search_paths, search_path_prefixes, and search_events stay stateless and bounded", async () => {
  const fixture = await temporaryDatabase("mcp-path-events-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
  const decoder = {
    name: "mcp-path-events-fixture",
    version: "1",
    async decode(bytes) {
      switch (bytes[0]) {
        case 1:
          return decoded("ADVERT", 4, {
            type: 4,
            isValid: true,
            publicKey: NODE,
            timestamp: 1_800_000_000,
            signature: "valid",
            signatureValid: true,
            appData: {
              flags: 128,
              deviceRole: 4,
              hasLocation: false,
              hasName: true,
              name: "Public sensor",
            },
          });
        case 2:
          return decoded("TRACE", 9, {
            traceTag: "trace-public",
            sourceHash: "CC",
            pathHashes: ["CC", "CCCC"],
            snrValues: [4.5, -1],
          });
        case 3:
          return decoded(
            "TXT_MSG",
            2,
            { sourceHash: "CC", destinationHash: "DD", ciphertext: "AABB" },
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
  const history = new MqttHistoryService(fixture.database, storage, "test", {
    decoder,
    now: () => clock.now,
    startLoops: false,
  });
  await history.start();
  const publish = async (raw) => {
    clock.now += 1;
    await history.capturePublish(packet("packets", { raw, RSSI: -80, SNR: 7 }));
  };
  await publish("0100");
  await publish("0500");
  await publish("0500");
  await publish("0500");
  await publish("0300");
  await publish("0400");
  await publish("0200");
  await history.drain();

  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => clock.now,
  );

  const paths = await query.searchPaths({ limit: 10 });
  assert.ok(paths.data.length >= 4);
  const pathRows = paths.data.filter((row) => row.raw_path !== null);
  assert.equal(pathRows.length, 3);
  assert.ok(
    pathRows.every((row) => row.raw_path === "CCCCCC" && row.hop_count === 2),
  );
  assert.ok(
    pathRows.every(
      (row) => row.hops.length === 2 && row.hops[0].prefix === "CC",
    ),
  );
  assert.ok(
    paths.data.some((row) => row.raw_path === null && row.hops.length === 0),
  );
  assert.ok(paths.data.every((row) => row.observer_public_key === OBSERVER));
  assert.ok(paths.data.every((row) => row.region === "STO"));

  const pathPage1 = await query.searchPaths({ limit: 2 });
  assert.equal(pathPage1.data.length, 2);
  assert.equal(pathPage1.meta.has_more, true);
  assert.ok(pathPage1.meta.next_cursor);
  const pathPage2 = await query.searchPaths({
    limit: 2,
    cursor: pathPage1.meta.next_cursor,
  });
  assert.equal(pathPage2.data.length, 2);
  assert.notEqual(
    pathPage2.data[0].observation_id,
    pathPage1.data[0].observation_id,
  );
  const prefixCursor = (await query.searchPathPrefixes({ limit: 1 })).meta
    .next_cursor;
  await assert.rejects(
    query.searchPaths({ cursor: prefixCursor ?? "" }),
    (error) => error.reason === "invalid_pagination_cursor",
  );

  const byPrefix = await query.searchPaths({
    containsPrefixHex: "CC",
    limit: 10,
  });
  assert.ok(byPrefix.data.length >= 1);
  const byNode = await query.searchPaths({
    containsNodePublicKey: NODE,
    limit: 10,
  });
  assert.ok(byNode.data.length >= 1);
  const byStatus = await query.searchPaths({
    resolutionStatus: "resolved",
    limit: 10,
  });
  assert.ok(byStatus.data.length >= 1);
  const byHops = await query.searchPaths({ minHops: 2, maxHops: 2, limit: 10 });
  assert.ok(byHops.data.length >= 1);
  await assert.rejects(
    query.searchPaths({ minHops: 5, maxHops: 1 }),
    (error) => error.reason === "inconsistent_filter_range",
  );
  await assert.rejects(
    query.searchPaths({ containsPrefixHex: "C" }),
    (error) => error.reason === "invalid_prefix_hex",
  );

  const prefixes = await query.searchPathPrefixes({ limit: 10 });
  assert.equal(prefixes.data.length, 2);
  const ccRow = prefixes.data.find((row) => row.prefix_hex === "CC");
  const ccccRow = prefixes.data.find((row) => row.prefix_hex === "CCCC");
  assert.ok(ccRow && ccccRow);
  assert.equal(ccRow.occurrence_count, 3);
  assert.equal(ccccRow.occurrence_count, 3);
  assert.equal(ccRow.resolution_status, "resolved");
  assert.equal(ccRow.resolved_public_key, NODE);
  assert.equal(ccccRow.resolution_status, "resolved");
  assert.equal(ccccRow.resolved_public_key, NODE);
  assert.equal(ccRow.observer_count, 1);
  assert.ok(ccRow.first_seen_at <= ccRow.last_seen_at);
  const byMinOccurrences = await query.searchPathPrefixes({
    minOccurrences: 3,
    limit: 10,
  });
  assert.equal(byMinOccurrences.data.length, 2);
  const unresolved = await query.searchPathPrefixes({
    resolutionStatus: "unresolved",
    limit: 10,
  });
  assert.equal(unresolved.data.length, 0);
  const prefixPage1 = await query.searchPathPrefixes({
    sort: { field: "occurrence_count", order: "asc" },
    limit: 1,
  });
  assert.equal(prefixPage1.data.length, 1);
  assert.ok(prefixPage1.meta.has_more);
  const prefixPage2 = await query.searchPathPrefixes({
    sort: { field: "occurrence_count", order: "asc" },
    limit: 1,
    cursor: prefixPage1.meta.next_cursor,
  });
  assert.equal(prefixPage2.data.length, 1);
  assert.notEqual(
    prefixPage2.data[0].prefix_hex,
    prefixPage1.data[0].prefix_hex,
  );

  const events = await query.searchEvents({ limit: 3 });
  assert.equal(events.data.length, 3);
  assert.equal(events.meta.has_more, true);
  assert.ok(
    events.data.every(
      (row) => row.event_type && row.event_id > 0 && row.payload,
    ),
  );
  const allEvents = await query.searchEvents({ limit: 20 });
  const eventTypes = new Set(allEvents.data.map((row) => row.event_type));
  for (const expectedType of [
    "packet",
    "advert",
    "message",
    "trace",
    "telemetry",
  ]) {
    assert.ok(eventTypes.has(expectedType), expectedType);
  }

  const eventPage2 = await query.searchEvents({
    limit: 3,
    cursor: events.meta.next_cursor,
  });
  assert.ok(eventPage2.data.length >= 1);
  assert.notDeepEqual(eventPage2.data, events.data);

  const messageEvents = await query.searchEvents({
    eventTypes: ["message"],
    limit: 10,
  });
  assert.ok(messageEvents.data.length >= 1);
  assert.ok(
    messageEvents.data.every(
      (row) => row.event_type === "message" && "message" in row.payload,
    ),
  );
  assert.equal(messageEvents.data[0].payload.message.encrypted, 1);

  const packetEvents = await query.searchEvents({
    eventTypes: ["packet"],
    limit: 10,
  });
  assert.ok(packetEvents.data.length >= 1);
  assert.ok(packetEvents.data.every((row) => "packet" in row.payload));

  const nodePacketEvents = await query.searchEvents({
    nodePublicKey: NODE,
    eventTypes: ["packet"],
    limit: 20,
  });
  assert.equal(nodePacketEvents.data.length, 4);
  assert.ok(nodePacketEvents.data.every((row) => row.node_public_key === NODE));
  const observerPacketEvents = await query.searchEvents({
    observerPublicKey: OBSERVER,
    eventTypes: ["packet"],
    limit: 20,
  });
  assert.equal(observerPacketEvents.data.length, 5);
  assert.ok(
    observerPacketEvents.data.every(
      (row) => row.observer_public_key === OBSERVER,
    ),
  );
  const nodeMessages = await query.searchEvents({
    nodePublicKey: NODE,
    eventTypes: ["message"],
    limit: 20,
  });
  assert.equal(nodeMessages.data.length, 1);
  const advertEvents = await query.searchEvents({
    eventTypes: ["advert"],
    limit: 20,
  });
  assert.equal(advertEvents.data.length, 1);
  assert.ok(Date.parse(advertEvents.data[0].reported_at) >= 1e12);

  const ascending = await query.searchEvents({
    order: "asc",
    limit: 10,
  });
  assert.ok(ascending.data.length >= 1);
  const times = ascending.data.map((row) => Date.parse(row.timestamp));
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
  );

  await assert.rejects(
    query.searchEvents({ cursor: "not-a-valid-cursor" }),
    (error) => error.reason === "invalid_pagination_cursor",
  );

  await history.stop();
});

test("search_paths caps pages at 100 observations to stay inside output bounds", async () => {
  const fixture = await temporaryDatabase("mcp-path-cap-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
  const decoder = {
    name: "mcp-path-cap-fixture",
    version: "1",
    async decode() {
      return decoded("ACK", 3, { checksum: "00" }, { path: ["CC", "CCCC"] });
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
  const history = new MqttHistoryService(fixture.database, storage, "test", {
    decoder,
    now: () => clock.now,
    startLoops: false,
  });
  await history.start();
  for (let i = 0; i < 105; i += 1) {
    clock.now += 1;
    await history.capturePublish(
      packet("packets", { raw: "0500", RSSI: -80, SNR: 7 }),
    );
  }
  await history.drain();

  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => clock.now,
  );
  const page1 = await query.searchPaths({ limit: 250 });
  assert.equal(page1.data.length, 100);
  assert.equal(page1.meta.has_more, true);
  assert.ok(page1.meta.next_cursor);
  const page2 = await query.searchPaths({
    limit: 250,
    cursor: page1.meta.next_cursor,
  });
  assert.equal(page2.data.length, 5);
  assert.equal(page2.meta.has_more, false);
  await history.stop();
});
