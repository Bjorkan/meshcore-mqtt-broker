import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  createPublicMcpHttpRuntime,
  createPublicToolRegistry,
} from "../dist/mcp-server.js";
import { createPublicToolApiHandler } from "../dist/public-tool-api.js";
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
  const registry = createPublicToolRegistry(options);
  const web = createWebServer({
    host: "127.0.0.1",
    port: 0,
    protocolHandlers: [createPublicToolApiHandler(registry), mcp.routeHandler],
    handlers: [
      createApiHandler({
        publicTools: registry,
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
  const apiBase = `http://127.0.0.1:${port}/api/v2`;

  const oversized = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: `"${"x".repeat(1_048_576)}"`,
  });
  assert.equal(oversized.status, 413);
  assert.doesNotMatch(await oversized.text(), /stack|sql|\/home\//i);

  const apiIndex = await (await fetch(apiBase)).json();
  assert.equal(apiIndex.publicAccess, true);
  assert.equal(apiIndex.authenticationRequired, false);
  assert.equal(apiIndex.readOnly, true);

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
    "get_nodes",
    "get_observer",
    "get_observer_status_history",
    "get_observers",
    "get_packet",
    "get_packet_observations",
    "get_packet_path",
    "get_packets",
    "get_region_summary",
    "get_schema",
    "get_signal_history",
    "get_storage_info",
    "get_telemetry",
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
  assert.equal(
    apiIndex.tools
      .map((tool) => tool.name)
      .sort()
      .join(","),
    expectedTools.join(","),
  );
  assert.ok(
    apiIndex.tools.every(
      (tool) =>
        tool.method === "POST" &&
        tool.path ===
          `${apiBase.replace(/^https?:\/\/[^/]+/, "")}/tools/${tool.name}`,
    ),
  );
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
    const httpResponse = await fetch(`${apiBase}/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(arguments_),
    });
    assert.equal(httpResponse.status, 200, name);
    assert.deepEqual(
      structuredWithoutGenerationTime(await httpResponse.json()),
      structuredWithoutGenerationTime(response.structuredContent),
      name,
    );
  }

  const invalidLimit = await client.callTool({
    name: "list_nodes",
    arguments: { limit: 251 },
  });
  assert.equal(invalidLimit.isError, true);
  const invalidHttpLimit = await fetch(`${apiBase}/tools/list_nodes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ limit: 251 }),
  });
  assert.equal(invalidHttpLimit.status, 400);
  assert.equal((await invalidHttpLimit.json()).code, "invalid_request");

  const oversizedHttp = await fetch(`${apiBase}/tools/list_nodes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: `{"padding":"${"x".repeat(1_048_576)}"}`,
  });
  assert.equal(oversizedHttp.status, 413);
  assert.equal((await oversizedHttp.json()).code, "request_too_large");

  const unknownHttpTool = await fetch(`${apiBase}/tools/query_database`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(unknownHttpTool.status, 404);
  const wrongHttpMethod = await fetch(`${apiBase}/tools/list_nodes`);
  assert.equal(wrongHttpMethod.status, 405);
  assert.equal(wrongHttpMethod.headers.get("allow"), "POST");
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

function structuredWithoutGenerationTime(value) {
  const copy = structuredClone(value);
  if (copy.meta) delete copy.meta.generated_at;
  return copy;
}
