import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createPublicMcpHttpRuntime } from "../dist/mcp-server.js";
import { MqttHistoryService } from "../dist/mqtt-history.js";
import { createApiHandler } from "../dist/api.js";
import { createWebServer } from "../dist/web-server.js";
import { temporaryDatabase } from "./test-database.mjs";

const PUBLIC_KEY = "A".repeat(64);
const PACKET_HASH = "d".repeat(64);
const fixtures = [];
const servers = [];

afterEach(async () => {
  while (servers.length) await servers.pop().close();
  while (fixtures.length) await fixtures.pop().cleanup();
});

test("anonymous official MCP V2 client validates every read-only tool contract", async () => {
  const fixture = await temporaryDatabase("mcp-integration-");
  fixtures.push(fixture);
  const options = {
    database: fixture.database,
    storage: {
      retentionDays: 30,
      cleanupIntervalMinutes: 60,
      cleanupBatchSize: 1_000,
      storeInternal: false,
      storeSerial: false,
    },
    config: {
      enabled: true,
      path: "/mcp/v2",
      defaultLimit: 50,
      maxLimit: 250,
    },
  };
  const mcp = createPublicMcpHttpRuntime(options);
  const web = createWebServer({
    host: "127.0.0.1",
    port: 0,
    protocolHandlers: [mcp.routeHandler],
    handlers: [
      createApiHandler({
        getDashboardSnapshot: async () => ({ regionLookup: {} }),
      }),
    ],
  });
  const port = await web.listen();
  servers.push({
    close: async () => {
      await mcp.close();
      await web.close();
    },
  });
  const endpoint = `http://127.0.0.1:${port}/mcp/v2`;

  const oversized = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: `"${"x".repeat(1_048_576)}"`,
  });
  assert.equal(oversized.status, 413);
  assert.doesNotMatch(await oversized.text(), /stack|sql|\/home\//i);

  const requestHeaders = [];
  const responseBodies = [];
  const anonymousFetch = async (input, init) => {
    const request = new Request(input, init);
    requestHeaders.push(Object.fromEntries(request.headers.entries()));
    const response = await fetch(request);
    responseBodies.push(await response.clone().text());
    return response;
  };
  const client = new Client(
    { name: "anonymous-contract-test", version: "1.0.0" },
    { versionNegotiation: { mode: "required" } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint), {
      fetch: anonymousFetch,
    }),
  );
  const listed = await client.listTools();
  const expectedTools = [
    "get_activity_timeseries",
    "get_capabilities",
    "get_data_quality_summary",
    "get_message",
    "get_neighbor_history",
    "get_neighbors",
    "get_network_summary",
    "get_node",
    "get_node_adverts",
    "get_node_position_history",
    "get_node_sightings",
    "get_node_signal_summary",
    "get_node_summary",
    "get_nodes",
    "get_observer",
    "get_observer_status_history",
    "get_observer_summary",
    "get_observers",
    "get_packet",
    "get_packet_observations",
    "get_packet_path",
    "get_packet_type_summary",
    "get_packets",
    "get_region_summary",
    "get_schema",
    "get_signal_history",
    "get_storage_info",
    "get_telemetry",
    "get_topology",
    "get_trace",
    "list_nodes",
    "list_observers",
    "list_regions",
    "resolve_node_prefix",
    "search_adverts",
    "search_messages",
    "search_neighbors",
    "search_packets",
    "search_processing_errors",
    "search_telemetry",
    "search_traces",
  ];
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), expectedTools);
  assert.ok(
    listed.tools.every(
      (tool) =>
        tool.annotations?.readOnlyHint === true &&
        tool.annotations?.destructiveHint === false,
    ),
  );

  const now = Date.now();
  const from = new Date(now - 3_600_000).toISOString();
  const to = new Date(now).toISOString();
  const calls = [
    ["get_capabilities", {}],
    ["get_storage_info", {}],
    ["get_network_summary", { from, to }],
    ["list_observers", {}],
    ["get_observer", { public_key: PUBLIC_KEY }],
    ["get_observer_status_history", { observer_public_key: PUBLIC_KEY }],
    ["list_nodes", {}],
    ["get_node", { public_key: PUBLIC_KEY }],
    ["get_node_adverts", { public_key: PUBLIC_KEY }],
    ["get_node_sightings", { node_public_key: PUBLIC_KEY }],
    ["resolve_node_prefix", { prefix_hex: "AA" }],
    ["search_packets", {}],
    ["get_packet", { packet_hash: PACKET_HASH }],
    ["get_packet_observations", { packet_hash: PACKET_HASH }],
    ["get_neighbors", { observer_public_key: PUBLIC_KEY }],
    ["get_neighbor_history", { observer_public_key: PUBLIC_KEY }],
    ["get_packet_path", { packet_hash: PACKET_HASH }],
    ["list_regions", {}],
    ["get_region_summary", { region: "STO", from, to }],
    ["get_message", { message_id: 1 }],
    ["get_schema", {}],
    ["get_nodes", { public_keys: [PUBLIC_KEY] }],
    ["get_observers", { public_keys: [PUBLIC_KEY] }],
    ["get_packets", { packet_hashes: [PACKET_HASH] }],
    ["search_adverts", {}],
    ["search_neighbors", {}],
    ["search_telemetry", {}],
    ["get_node_signal_summary", { node_public_key: PUBLIC_KEY, from, to }],
    ["get_node_position_history", { node_public_key: PUBLIC_KEY }],
    ["search_processing_errors", {}],
    ["get_data_quality_summary", { from, to }],
    ["get_packet_type_summary", { from, to }],
    ["get_observer_summary", { from, to }],
    ["get_node_summary", { from, to }],
    ["get_topology", { from, to }],
    [
      "get_signal_history",
      {
        observer_public_key: PUBLIC_KEY,
        from,
        to,
        bucket: "minute",
      },
    ],
    ["search_traces", {}],
    ["get_trace", { trace_id: 1 }],
    ["get_telemetry", { node_public_key: PUBLIC_KEY }],
    ["search_messages", {}],
    ["get_activity_timeseries", { from, to, bucket: "hour" }],
  ];
  for (const [name, arguments_] of calls) {
    const response = await client.callTool({ name, arguments: arguments_ });
    assert.notEqual(response.isError, true, name);
    assert.ok(response.structuredContent, name);
  }

  const invalidLimit = await client.callTool({
    name: "list_nodes",
    arguments: { limit: 251 },
  });
  assert.equal(invalidLimit.isError, true);
  const invalidSort = await client.callTool({
    name: "search_packets",
    arguments: { sort: "not_a_field" },
  });
  assert.equal(invalidSort.isError, true);
  for (const headers of requestHeaders) {
    assert.equal(headers.authorization, undefined);
    assert.equal(headers.cookie, undefined);
    assert.equal(headers["x-api-key"], undefined);
  }
  const serialized = responseBodies.join("\n");
  assert.doesNotMatch(serialized, /safe_internal_error/);
  assert.doesNotMatch(serialized, /\/data\/meshcore-mqtt-broker|\.db\b/);
  await client.close();
});

test("seeded data flows through every MCP output schema without validation errors", async () => {
  const fixture = await temporaryDatabase("mcp-seeded-");
  fixtures.push(fixture);
  const OBSERVER = "B".repeat(64);
  const clock = { now: Date.now() };
  const decoder = {
    name: "seeded-fixture",
    version: "1",
    decode: async () => ({
      status: "decoded",
      packetType: "ACK",
      packetTypeCode: 3,
      payloadType: "ACK",
      payloadTypeCode: 3,
      routeType: "FLOOD",
      decoded: {
        routeType: 1,
        payloadType: 3,
        path: null,
        payload: { raw: "0d00", decoded: {} },
        isValid: true,
      },
    }),
  };
  const storage = {
    retentionDays: 30,
    cleanupIntervalMinutes: 60,
    cleanupBatchSize: 1_000,
    storeInternal: false,
    storeSerial: false,
  };
  const history = new MqttHistoryService(
    fixture.database,
    storage,
    "mcp-seeded-test",
    { decoder, now: () => clock.now, startLoops: false },
  );
  await history.start();
  await history.capturePublish({
    cmd: "publish",
    topic: `meshcore/STO/${OBSERVER}/status`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: OBSERVER, tx_power_dbm: 20 }),
    ),
    qos: 0,
    retain: false,
    dup: false,
  });
  await history.capturePublish({
    cmd: "publish",
    topic: `meshcore/STO/${OBSERVER}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: OBSERVER, raw: "0100", RSSI: -80, SNR: 7 }),
    ),
    qos: 0,
    retain: false,
    dup: false,
  });
  await history.drain();

  const config = {
    enabled: true,
    path: "/mcp/v2",
    defaultLimit: 50,
    maxLimit: 250,
  };
  const mcp = createPublicMcpHttpRuntime({
    database: fixture.database,
    storage,
    config,
  });
  const web = createWebServer({
    host: "127.0.0.1",
    port: 0,
    protocolHandlers: [mcp.routeHandler],
    handlers: [],
  });
  const port = await web.listen();
  servers.push({
    close: async () => {
      await mcp.close();
      await web.close();
    },
  });
  const endpoint = `http://127.0.0.1:${port}/mcp/v2`;
  const client = new Client(
    { name: "seeded-contract-test", version: "1.0.0" },
    { versionNegotiation: { mode: "required" } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));

  const listed = await client.listTools();
  for (const name of ["get_signal_history", "get_activity_timeseries"]) {
    const tool = listed.tools.find((entry) => entry.name === name);
    const itemProperties = tool.outputSchema.properties.data.items.properties;
    assert.ok(itemProperties.timestamp, name);
    assert.equal(itemProperties.timestampSchema, undefined, name);
  }

  const from = new Date(clock.now - 3_600_000).toISOString();
  const to = new Date(clock.now).toISOString();

  const signal = await client.callTool({
    name: "get_signal_history",
    arguments: { observer_public_key: OBSERVER, from, to, bucket: "hour" },
  });
  assert.notEqual(signal.isError, true);
  assert.ok(signal.structuredContent.data.length >= 1);
  assert.match(signal.structuredContent.data[0].timestamp, /^\d{4}-/);

  const activity = await client.callTool({
    name: "get_activity_timeseries",
    arguments: { from, to, bucket: "hour" },
  });
  assert.notEqual(activity.isError, true);
  assert.ok(activity.structuredContent.data.length >= 1);
  assert.match(activity.structuredContent.data[0].timestamp, /^\d{4}-/);

  const observers = await client.callTool({
    name: "list_observers",
    arguments: {},
  });
  assert.notEqual(observers.isError, true);
  const seededObserver = observers.structuredContent.data.find(
    (row) => row.public_key === OBSERVER,
  );
  assert.ok(seededObserver);
  assert.equal(seededObserver.latest_radio_config.frequency_mhz, null);
  assert.equal(seededObserver.latest_radio_config.tx_power_dbm, 20);

  const OBSERVER2 = "C".repeat(64);
  clock.now += 3_600_000;
  await history.capturePublish({
    cmd: "publish",
    topic: `meshcore/STO/${OBSERVER2}/status`,
    payload: Buffer.from(JSON.stringify({ origin_id: OBSERVER2 })),
    qos: 0,
    retain: false,
    dup: false,
  });
  await history.drain();
  const sortedObservers = await client.callTool({
    name: "list_observers",
    arguments: { sort: "first_seen_at", order: "asc" },
  });
  assert.notEqual(sortedObservers.isError, true);
  const sortedKeys = sortedObservers.structuredContent.data.map(
    (row) => row.public_key,
  );
  assert.ok(sortedKeys.indexOf(OBSERVER) < sortedKeys.indexOf(OBSERVER2));

  const invalidNeighbors = await client.callTool({
    name: "get_neighbors",
    arguments: { observer_public_key: OBSERVER, latest: false },
  });
  assert.equal(invalidNeighbors.isError, true);
  assert.match(JSON.stringify(invalidNeighbors.content), /invalid_request/);

  const signalCap = await client.callTool({
    name: "get_signal_history",
    arguments: {
      observer_public_key: OBSERVER,
      from: new Date(clock.now - 2 * 86_400_000).toISOString(),
      to,
      bucket: "minute",
    },
  });
  assert.equal(signalCap.isError, true);
  assert.match(JSON.stringify(signalCap.content), /too_many_time_buckets/);

  await client.close();
});
