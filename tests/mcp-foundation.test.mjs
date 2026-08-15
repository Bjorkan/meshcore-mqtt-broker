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
  await client.close();
});
