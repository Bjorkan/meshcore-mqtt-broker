import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createWebServer } from "../dist/web-server.js";
import { createPublicMcpHttpRuntime } from "../dist/mcp-server.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
const servers = [];

afterEach(async () => {
  while (servers.length) await servers.pop().close();
  while (fixtures.length) await fixtures.pop().cleanup();
});

test("official MCP V2 client reaches the anonymous read-only endpoint", async () => {
  const fixture = await temporaryDatabase("mcp-foundation-");
  fixtures.push(fixture);
  const mcp = createPublicMcpHttpRuntime({
    database: fixture.database,
    storage: {
      retentionDays: 17,
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

  const client = new Client(
    { name: "anonymous-mcp-v2-test", version: "1.0.0" },
    { versionNegotiation: { mode: "required" } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp/v2`),
  );
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "get_capabilities"));
  const response = await client.callTool({
    name: "get_capabilities",
    arguments: {},
  });
  assert.equal(response.structuredContent.public_access, true);
  assert.equal(response.structuredContent.authentication_required, false);
  assert.equal(response.structuredContent.read_only, true);
  assert.equal(response.structuredContent.retention_days, 17);
  assert.equal(response.structuredContent.logical_packet_grouping, true);
  assert.equal(response.structuredContent.logical_message_grouping, true);
  assert.equal(response.structuredContent.geospatial, true);
  assert.equal(response.structuredContent.batch_lookup, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(response.structuredContent.supported_views)),
    ["logical", "raw"],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(response.structuredContent.supported_buckets)),
    ["minute", "hour", "day"],
  );
  assert.equal(response.structuredContent.max_timeseries_buckets, 1_440);
  assert.equal(
    response.structuredContent.default_summary_window_seconds,
    86_400,
  );
  assert.equal(response.structuredContent.supports_regions, true);
  assert.equal(response.structuredContent.stateless_queries, true);
  assert.equal(response.structuredContent.stateless_cursors, true);
  assert.equal(response.structuredContent.cursor_version, 1);
  assert.equal(response.structuredContent.cursor_integrity_protected, true);
  assert.equal(response.structuredContent.pagination_mode, "keyset");
  assert.equal(response.structuredContent.supports_snapshot_watermark, true);
  assert.equal(response.structuredContent.supports_event_stream, true);
  assert.equal(
    response.structuredContent.supports_path_prefix_aggregation,
    true,
  );
  assert.equal(response.structuredContent.supports_message_payload_batch, true);
  assert.equal(response.structuredContent.supports_channel_decryption, false);
  assert.equal(response.structuredContent.max_path_page_size, 100);
  assert.equal(response.structuredContent.max_message_payload_batch_size, 100);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(response.structuredContent.supported_event_types),
    ),
    ["packet", "advert", "message", "trace", "telemetry", "observer_status"],
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(response.structuredContent.supported_sort_fields.paths),
    ),
    ["received_at"],
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(response.structuredContent.supported_sort_fields.events),
    ),
    ["received_at"],
  );
  await client.close();
});
