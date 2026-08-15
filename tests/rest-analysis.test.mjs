import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { MqttHistoryService } from "../dist/mqtt-history.js";
import { PublicMcpQueryService } from "../dist/mcp-public-query.js";
import { PublicMcpDataPolicy } from "../dist/mcp-public-policy.js";
import { createFastifyApp } from "../dist/rest/fastify-app.js";
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

test("REST analysis and discovery routes reuse the shared query service", async () => {
  const fixture = await temporaryDatabase("rest-analysis-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
  const decoder = {
    name: "rest-analysis-fixture",
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
              deviceRole: 2,
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
          return decoded("TXT_MSG", 2, {
            sourceHash: "CC",
            destinationHash: "DD",
            ciphertext: "AABB",
          });
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
    "rest-analysis-test",
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

  const traces = await app.inject({ method: "GET", url: "/api/v2/traces" });
  assert.equal(traces.statusCode, 200);
  assert.equal(traces.json().data.length, 1);
  assert.equal(traces.json().data[0].tag, "trace-1");
  const traceId = traces.json().data[0].trace_id;

  const trace = await app.inject({
    method: "GET",
    url: `/api/v2/traces/${traceId}`,
  });
  assert.equal(trace.statusCode, 200);
  assert.equal(trace.json().data.hops.length, 2);

  const telemetry = await app.inject({
    method: "GET",
    url: `/api/v2/telemetry?node_public_key=${NODE}`,
  });
  assert.equal(telemetry.statusCode, 200);
  assert.ok(
    telemetry.json().data.some((row) => row.metric_name === "temperature"),
  );
  assert.ok(telemetry.json().data.every((row) => row.region === "STO"));

  const neighbors = await app.inject({
    method: "GET",
    url: `/api/v2/neighbors?observer_public_key=${OBSERVER}`,
  });
  assert.equal(neighbors.statusCode, 200);
  assert.ok(neighbors.json().data.length >= 1);
  assert.equal(neighbors.json().data[0].neighbor_public_key, NODE);

  const nodeSignals = await app.inject({
    method: "GET",
    url: `/api/v2/nodes/${NODE}/signals`,
  });
  assert.equal(nodeSignals.statusCode, 200);
  assert.equal(nodeSignals.json().data[0].observer_public_key, OBSERVER);
  assert.equal(nodeSignals.json().data[0].packet_count, 4);

  const fromIso = new Date(clock.now - 3_600_000).toISOString();
  const toIso = new Date(clock.now).toISOString();
  const activity = await app.inject({
    method: "GET",
    url: `/api/v2/activity?from=${fromIso}&to=${toIso}&bucket=minute`,
  });
  assert.equal(activity.statusCode, 200);
  assert.equal(activity.json().data.length, 1);
  assert.equal(activity.json().data[0].adverts, 1);
  assert.equal(activity.json().data[0].traces, 1);
  assert.equal(activity.json().data[0].messages, 1);

  const bounded = await app.inject({
    method: "GET",
    url: `/api/v2/activity?from=${fromIso}&to=${toIso}&bucket=minute&limit=100`,
  });
  assert.equal(bounded.statusCode, 200);

  const tooMany = await app.inject({
    method: "GET",
    url: "/api/v2/activity?from=2026-08-15T00:00:00Z&to=2027-08-15T00:00:00Z&bucket=minute",
  });
  assert.equal(tooMany.statusCode, 400);
  assert.equal(tooMany.json().status, "invalid_request");
  assert.equal(tooMany.json().reason, "too_many_time_buckets");

  const topology = await app.inject({
    method: "GET",
    url: "/api/v2/network/topology",
  });
  assert.equal(topology.statusCode, 200);
  assert.equal(topology.json().data.edges.length, 1);
  assert.deepEqual(topology.json().data.edges[0].evidence, ["neighbor"]);
  assert.equal(topology.json().data.edges[0].from_node, OBSERVER);
  assert.equal(topology.json().data.edges[0].to_node, NODE);

  const packetTypes = await app.inject({
    method: "GET",
    url: "/api/v2/network/packet-types",
  });
  assert.equal(packetTypes.statusCode, 200);
  assert.ok(
    packetTypes.json().data.some((row) => row.packet_type === "ADVERT"),
  );

  const observerSummary = await app.inject({
    method: "GET",
    url: "/api/v2/observers/summary",
  });
  assert.equal(observerSummary.statusCode, 200);
  assert.equal(observerSummary.json().data[0].observer_public_key, OBSERVER);
  assert.equal(observerSummary.json().data[0].node_count, 1);

  const nodeSummary = await app.inject({
    method: "GET",
    url: "/api/v2/nodes/summary",
  });
  assert.equal(nodeSummary.statusCode, 200);
  assert.equal(nodeSummary.json().data[0].public_key, NODE);

  const quality = await app.inject({
    method: "GET",
    url: "/api/v2/data-quality",
  });
  assert.equal(quality.statusCode, 200);
  assert.equal(quality.json().data.processing_errors, 0);

  const batchNodes = await app.inject({
    method: "POST",
    url: "/api/v2/batch/nodes",
    payload: { public_keys: [NODE, "F".repeat(64)] },
  });
  assert.equal(batchNodes.statusCode, 200);
  assert.equal(batchNodes.json().data.nodes.length, 1);
  assert.deepEqual(batchNodes.json().data.missing_public_keys, [
    "F".repeat(64),
  ]);

  const batchPrefix = await app.inject({
    method: "POST",
    url: "/api/v2/batch/prefix-resolution",
    payload: { prefixes: ["CC", "FF"] },
  });
  assert.equal(batchPrefix.statusCode, 200);
  assert.equal(batchPrefix.json().data.resolutions.length, 2);
  assert.equal(
    batchPrefix.json().data.resolutions[0].resolution_status,
    "resolved",
  );
  assert.equal(
    batchPrefix.json().data.resolutions[1].resolution_status,
    "unresolved",
  );

  const batchTraces = await app.inject({
    method: "POST",
    url: "/api/v2/batch/traces",
    payload: { trace_ids: [traceId, 999_999] },
  });
  assert.equal(batchTraces.statusCode, 200);
  assert.equal(batchTraces.json().data.traces.length, 1);
  assert.deepEqual(batchTraces.json().data.missing_trace_ids, [999_999]);

  const batchTooLarge = await app.inject({
    method: "POST",
    url: "/api/v2/batch/nodes",
    payload: { public_keys: Array.from({ length: 51 }, () => NODE) },
  });
  assert.equal(batchTooLarge.statusCode, 400);
  assert.equal(batchTooLarge.json().status, "invalid_request");

  await app.close();
  await history.stop();
  await fixture.cleanup();
});
