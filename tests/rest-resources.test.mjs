import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { MqttHistoryService } from "../dist/mqtt-history.js";
import { PublicMcpQueryService } from "../dist/mcp-public-query.js";
import { PublicMcpDataPolicy } from "../dist/mcp-public-policy.js";
import { createFastifyApp } from "../dist/rest/fastify-app.js";
import { temporaryDatabase } from "./test-database.mjs";

const OBSERVERS = ["A".repeat(64), "B".repeat(64)];
const NODE = "C".repeat(64);
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

function advertDecode(timestamp, latitude, path) {
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
      path: path ?? null,
      payload: {
        raw: "",
        decoded: {
          type: 4,
          isValid: true,
          publicKey: NODE,
          timestamp,
          signature: `signature-${timestamp}`,
          signatureValid: true,
          appData: {
            flags: 144,
            deviceRole: 2,
            hasLocation: true,
            hasName: true,
            location: { latitude, longitude: 18.1 },
            name: "Flooded repeater",
          },
        },
      },
    },
    isValid: true,
  };
}

function messageDecode() {
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

async function restFixture() {
  const fixture = await temporaryDatabase("rest-resources-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
  const decoder = {
    name: "rest-resources-fixture",
    version: "1",
    async decode(bytes) {
      const code = bytes[0];
      if (code === 0x51) return advertDecode(42, 59.3, ["AA"]);
      if (code === 0x52) return advertDecode(42, 59.3, ["BB"]);
      if (code === 0x53) return advertDecode(43, 59.4, ["AA"]);
      if (code === 0x31) return messageDecode();
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
    "rest-resources-test",
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
  await history.drain();

  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => clock.now,
  );
  const policy = new PublicMcpDataPolicy();
  const app = await createFastifyApp({
    query,
    policy,
    config,
    apiHandler: () => false,
    dashboardHandler: () => false,
  });
  return { fixture, query, app, history };
}

test("REST core resources reuse the shared query service and DTOs", async () => {
  const { fixture, query, app, history } = await restFixture();

  const regions = await app.inject({ method: "GET", url: "/api/v2/regions" });
  assert.equal(regions.statusCode, 200);
  assert.deepEqual(
    regions.json().data.map((entry) => entry.code),
    ["STO"],
  );
  assert.equal(regions.json().data[0].code_system, "IATA");

  const regionSummary = await app.inject({
    method: "GET",
    url: "/api/v2/regions/STO/summary",
  });
  assert.equal(regionSummary.statusCode, 200);
  assert.equal(regionSummary.json().data.code, "STO");
  assert.equal(regionSummary.json().data.observer_count, 2);
  assert.equal(regionSummary.json().data.logical_advert_count, 2);
  assert.equal(regionSummary.json().data.message_count, 1);

  const regionMissing = await app.inject({
    method: "GET",
    url: "/api/v2/regions/XXX",
  });
  assert.equal(regionMissing.statusCode, 404);
  assert.equal(regionMissing.json().status, "not_found");

  const observers = await app.inject({
    method: "GET",
    url: "/api/v2/observers",
  });
  assert.equal(observers.statusCode, 200);
  assert.equal(observers.json().data.length, 2);
  assert.equal(observers.json().data[0].has_neighbor_data, false);

  const observer = await app.inject({
    method: "GET",
    url: `/api/v2/observers/${OBSERVERS[0]}`,
  });
  assert.equal(observer.statusCode, 200);
  assert.equal(observer.json().data.public_key, OBSERVERS[0]);

  const observerMissing = await app.inject({
    method: "GET",
    url: `/api/v2/observers/${"F".repeat(64)}`,
  });
  assert.equal(observerMissing.statusCode, 404);
  assert.equal(observerMissing.json().status, "not_found");

  const neighborsMissing = await app.inject({
    method: "GET",
    url: `/api/v2/observers/${"F".repeat(64)}/neighbors`,
  });
  assert.equal(neighborsMissing.statusCode, 404);

  const nodes = await app.inject({ method: "GET", url: "/api/v2/nodes" });
  assert.equal(nodes.statusCode, 200);
  assert.equal(nodes.json().data.length, 1);
  assert.equal(nodes.json().data[0].public_key, NODE);
  assert.equal(nodes.json().data[0].latitude, 59.4);

  const nodesAsc = await app.inject({
    method: "GET",
    url: "/api/v2/nodes?sort=first_seen_at&order=asc",
  });
  assert.equal(nodesAsc.statusCode, 200);
  assert.equal(nodesAsc.json().data[0].public_key, NODE);

  const nodesBadSort = await app.inject({
    method: "GET",
    url: "/api/v2/nodes?sort=not_a_field",
  });
  assert.equal(nodesBadSort.statusCode, 400);
  assert.equal(nodesBadSort.json().status, "invalid_request");
  assert.equal(nodesBadSort.json().reason, "invalid_sort_field");

  const packetsSorted = await app.inject({
    method: "GET",
    url: "/api/v2/packets?sort=first_observed_at&order=asc",
  });
  assert.equal(packetsSorted.statusCode, 200);

  const node = await app.inject({
    method: "GET",
    url: `/api/v2/nodes/${NODE}`,
  });
  assert.equal(node.statusCode, 200);
  assert.equal(
    node.json().data.latest_advert.advert_timestamp_raw,
    "1970-01-01T00:00:43.000Z",
  );
  assert.equal(node.json().data.latest_advert.raw_packet_count, 1);

  const nodeAdverts = await app.inject({
    method: "GET",
    url: `/api/v2/nodes/${NODE}/adverts`,
  });
  assert.equal(nodeAdverts.statusCode, 200);
  assert.equal(nodeAdverts.json().data.length, 2);
  const flooded = nodeAdverts
    .json()
    .data.find((row) => row.raw_packet_count === 2);
  assert.ok(flooded);
  assert.equal(flooded.observation_count, 2);
  assert.equal(flooded.route_count, 2);
  assert.equal(flooded.raw_packet_hashes.length, 2);

  const packets = await app.inject({ method: "GET", url: "/api/v2/packets" });
  assert.equal(packets.statusCode, 200);
  const logicalAdvert = packets
    .json()
    .data.find(
      (row) => row.packet_type === "ADVERT" && row.raw_packet_count === 2,
    );
  assert.ok(logicalAdvert);
  const logicalId = logicalAdvert.logical_packet_id;

  const logicalPacket = await app.inject({
    method: "GET",
    url: `/api/v2/packets/${logicalId}`,
  });
  assert.equal(logicalPacket.statusCode, 200);
  assert.equal(logicalPacket.json().data.logical_packet_id, logicalId);

  const rawExpansion = await app.inject({
    method: "GET",
    url: `/api/v2/packets/${logicalId}/raw-packets`,
  });
  assert.equal(rawExpansion.statusCode, 200);
  assert.equal(rawExpansion.json().data.length, 2);
  const rawHashes = rawExpansion.json().data.map((row) => row.packet_hash);
  assert.equal(new Set(rawHashes).size, 2);

  const rawPacket = await app.inject({
    method: "GET",
    url: `/api/v2/raw-packets/${rawHashes[0]}`,
  });
  assert.equal(rawPacket.statusCode, 200);
  assert.equal(rawPacket.json().data.logical_packet_id, logicalId);

  const observations = await app.inject({
    method: "GET",
    url: `/api/v2/paths?packet_hash=${rawHashes[0]}`,
  });
  assert.equal(observations.statusCode, 200);
  assert.ok(observations.json().data.length >= 1);
  assert.equal(observations.json().data[0].region, "STO");

  const path = await app.inject({
    method: "GET",
    url: `/api/v2/paths?packet_hash=${rawHashes[0]}`,
  });
  assert.equal(path.statusCode, 200);
  assert.ok(path.json().data[0].hops.length >= 1);

  const pathPrefixes = await app.inject({
    method: "GET",
    url: "/api/v2/path-prefixes",
  });
  assert.equal(pathPrefixes.statusCode, 200);
  assert.ok(pathPrefixes.json().data.length >= 1);
  assert.ok(
    pathPrefixes
      .json()
      .data.every((row) => row.occurrence_count >= 1 && row.resolution_status),
  );

  const events = await app.inject({
    method: "GET",
    url: "/api/v2/events?limit=5",
  });
  assert.equal(events.statusCode, 200);
  assert.ok(events.json().data.length >= 1);
  assert.ok(
    events
      .json()
      .data.every((row) => row.event_type && row.payload && row.timestamp),
  );

  const messageEvents = await app.inject({
    method: "GET",
    url: "/api/v2/events?event_types=message",
  });
  assert.equal(messageEvents.statusCode, 200);
  assert.ok(
    messageEvents
      .json()
      .data.every(
        (row) => row.event_type === "message" && "message" in row.payload,
      ),
  );

  const removedObservations = await app.inject({
    method: "GET",
    url: `/api/v2/raw-packets/${rawHashes[0]}/observations`,
  });
  assert.equal(removedObservations.statusCode, 404);
  const removedPath = await app.inject({
    method: "GET",
    url: `/api/v2/raw-packets/${rawHashes[0]}/path`,
  });
  assert.equal(removedPath.statusCode, 404);

  const adverts = await app.inject({ method: "GET", url: "/api/v2/adverts" });
  assert.equal(adverts.statusCode, 200);
  assert.equal(adverts.json().data.length, 2);

  const advertById = await app.inject({
    method: "GET",
    url: `/api/v2/adverts/${logicalId}`,
  });
  assert.equal(advertById.statusCode, 200);
  assert.equal(advertById.json().data.logical_advert_id, logicalId);

  const advertRaw = await app.inject({
    method: "GET",
    url: `/api/v2/adverts/${logicalId}/raw-packets`,
  });
  assert.equal(advertRaw.statusCode, 200);
  assert.equal(advertRaw.json().data.length, 2);

  const messages = await app.inject({
    method: "GET",
    url: "/api/v2/messages",
  });
  assert.equal(messages.statusCode, 200);
  assert.equal(messages.json().data.length, 1);
  assert.equal(messages.json().data[0].observation_count, 2);
  assert.equal(messages.json().data[0].encrypted, true);
  const logicalMessageId = messages.json().data[0].logical_message_id;

  const rawMessages = await app.inject({
    method: "GET",
    url: "/api/v2/messages?view=raw",
  });
  assert.equal(rawMessages.statusCode, 200);
  assert.equal(rawMessages.json().data.length, 2);
  const messageId = rawMessages.json().data[0].message_id;

  const message = await app.inject({
    method: "GET",
    url: `/api/v2/messages/${messageId}`,
  });
  assert.equal(message.statusCode, 200);
  assert.equal(message.json().data.logical_message_id, logicalMessageId);
  assert.match(message.json().data.payload_hex, /^(?:[0-9A-F]{2})*$/);
  assert.equal(message.json().data.encrypted, true);

  const messagePayloads = await app.inject({
    method: "POST",
    url: "/api/v2/batch/message-payloads",
    payload: { message_ids: [messageId, 999_999_999] },
  });
  assert.equal(messagePayloads.statusCode, 200);
  assert.equal(messagePayloads.json().data.payloads.length, 1);
  assert.equal(
    messagePayloads.json().data.payloads[0].payload_hex,
    message.json().data.payload_hex,
  );
  assert.deepEqual(
    messagePayloads.json().data.missing_message_ids,
    [999_999_999],
  );

  const messagePayloadsTooMany = await app.inject({
    method: "POST",
    url: "/api/v2/batch/message-payloads",
    payload: { message_ids: Array.from({ length: 101 }, (_, i) => i + 1) },
  });
  assert.equal(messagePayloadsTooMany.statusCode, 400);

  const messageRaw = await app.inject({
    method: "GET",
    url: `/api/v2/messages/${messageId}/raw-packets`,
  });
  assert.equal(messageRaw.statusCode, 200);
  assert.equal(messageRaw.json().data.length, 1);

  const prefixResolved = await app.inject({
    method: "GET",
    url: "/api/v2/prefixes/CC/resolution",
  });
  assert.equal(prefixResolved.statusCode, 200);
  assert.equal(prefixResolved.json().data.resolution_status, "resolved");
  assert.equal(prefixResolved.json().data.ambiguous, false);
  assert.equal(prefixResolved.json().data.candidates[0].public_key, NODE);

  const prefixUnresolved = await app.inject({
    method: "GET",
    url: "/api/v2/prefixes/FF/resolution",
  });
  assert.equal(prefixUnresolved.statusCode, 200);
  assert.equal(prefixUnresolved.json().data.resolution_status, "unresolved");
  assert.equal(prefixUnresolved.json().data.ambiguous, false);

  // MCP/REST parity: the REST node detail must equal the shared query DTO.
  const mcpNode = await query.getNode(NODE);
  assert.deepEqual(JSON.parse(JSON.stringify(mcpNode.data)), node.json().data);
  const mcpAdverts = await query.getNodeAdverts({ publicKey: NODE });
  assert.deepEqual(
    JSON.parse(JSON.stringify(mcpAdverts.data)),
    nodeAdverts.json().data,
  );

  await app.close();
  await history.stop();
  await fixture.cleanup();
});

test("OpenAPI documents union item schemas and object-shaped detail routes", async () => {
  const fixture = await temporaryDatabase("rest-openapi-");
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
  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => Date.now(),
  );
  const policy = new PublicMcpDataPolicy();
  const app = await createFastifyApp({
    query,
    policy,
    config,
    apiHandler: () => false,
    dashboardHandler: () => false,
  });
  const spec = (
    await app.inject({ method: "GET", url: "/api/v2/openapi.json" })
  ).json();
  const responseSchema = (path) =>
    spec.paths[path].get.responses["200"].content["application/json"].schema;
  const messagesItems =
    responseSchema("/api/v2/messages").properties.data.items;
  assert.ok(Array.isArray(messagesItems.anyOf));
  assert.ok(messagesItems.anyOf.length >= 2);
  const packetItems = responseSchema("/api/v2/packets").properties.data.items;
  assert.ok(Array.isArray(packetItems.anyOf));
  const advertDetail = responseSchema("/api/v2/adverts/{logicalAdvertId}")
    .properties.data;
  assert.equal(advertDetail.type, "object");
  const packetDetail = responseSchema("/api/v2/packets/{logicalPacketId}")
    .properties.data;
  assert.equal(packetDetail.type, "object");
  await app.close();
  await fixture.cleanup();
});

test("REST page limits follow the configured max page size", async () => {
  const fixture = await temporaryDatabase("rest-limit-");
  fixtures.push(fixture);
  const storage = {
    retentionDays: 30,
    cleanupIntervalMinutes: 60,
    cleanupBatchSize: 100,
    storeInternal: false,
    storeSerial: false,
  };
  const lowerConfig = {
    enabled: true,
    path: "/mcp/v2",
    defaultLimit: 50,
    maxLimit: 3,
  };
  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    lowerConfig,
    () => Date.now(),
  );
  const app = await createFastifyApp({
    query,
    policy: new PublicMcpDataPolicy(),
    config: lowerConfig,
    apiHandler: () => false,
    dashboardHandler: () => false,
  });
  const rejected = await app.inject({
    method: "GET",
    url: "/api/v2/nodes?limit=10",
  });
  assert.equal(rejected.statusCode, 400);
  const accepted = await app.inject({
    method: "GET",
    url: "/api/v2/nodes?limit=3",
  });
  assert.equal(accepted.statusCode, 200);
  await app.close();
  await fixture.cleanup();
});
