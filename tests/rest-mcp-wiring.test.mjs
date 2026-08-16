import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { createFastifyApp } from "../dist/rest/fastify-app.js";
import { PublicMcpQueryService } from "../dist/mcp-public-query.js";
import { PublicMcpDataPolicy } from "../dist/mcp-public-policy.js";
import { createPublicMcpHttpRuntime } from "../dist/mcp-server.js";
import { createApiHandler } from "../dist/api.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
const runtimes = [];

afterEach(async () => {
  while (runtimes.length) await runtimes.pop().close();
  while (fixtures.length) await fixtures.pop().cleanup();
});

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

test("the production Fastify wiring serves the MCP endpoint with pre-parsed bodies", async () => {
  const fixture = await temporaryDatabase("mcp-production-");
  fixtures.push(fixture);
  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => Date.now(),
  );
  const mcp = createPublicMcpHttpRuntime({
    database: fixture.database,
    storage,
    config,
  });
  runtimes.push(mcp);
  const app = await createFastifyApp({
    query,
    policy: new PublicMcpDataPolicy(),
    config,
    mcpHandler: mcp.routeHandler,
    apiHandler: createApiHandler({
      getDashboardSnapshot: async () => ({ regionLookup: {} }),
    }),
    dashboardHandler: async () => false,
  });

  const { Client, StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/client");
  const injectFetch = async (input, init) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : String(input);
    const url = new URL(rawUrl, "http://127.0.0.1");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(
      (init?.headers instanceof Headers
        ? init.headers.entries()
        : Object.entries(init?.headers ?? {})) || [],
    );
    const payload = typeof init?.body === "string" ? init.body : undefined;
    const response = await app.inject({
      method,
      url: url.pathname + url.search,
      headers,
      payload,
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers,
    });
  };
  const client = new Client(
    { name: "production-wiring-test", version: "1.0.0" },
    { versionNegotiation: { mode: "required" } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://127.0.0.1/mcp/v2"), {
      fetch: injectFetch,
    }),
  );
  const listed = await client.listTools();
  assert.ok(Array.isArray(listed.tools));
  assert.ok(listed.tools.length >= 40);

  const malformed = await app.inject({
    method: "POST",
    url: "/mcp/v2",
    headers: { "content-type": "application/json" },
    payload: "{broken",
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().status, "invalid_request");

  await client.close();
  await app.close();
  await fixture.cleanup();
});
