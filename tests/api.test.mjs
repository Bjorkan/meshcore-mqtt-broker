import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { z } from "zod/v4";
import { createApiHandler } from "../dist/api.js";
import { createDashboardHandler } from "../dist/dashboard.js";
import { PublicToolRegistry } from "../dist/public-tool-registry.js";
import { createWebServer } from "../dist/web-server.js";

const fixtures = [];
const servers = [];

afterEach(async () => {
  while (servers.length) await servers.pop().close();
  while (fixtures.length) await fixtures.pop().cleanup();
});

async function start({ handlers, protocolHandlers = [] }) {
  const server = createWebServer({
    host: "127.0.0.1",
    port: 0,
    handlers,
    protocolHandlers,
  });
  assert.equal(server.server.requestTimeout, 30_000);
  assert.equal(server.server.headersTimeout, 15_000);
  assert.equal(server.server.keepAliveTimeout, 5_000);
  servers.push(server);
  const port = await server.listen();
  return `http://127.0.0.1:${port}`;
}

function apiHandler() {
  return createApiHandler({
    getDashboardSnapshot: async () => ({
      generatedAt: 123,
      respondingBroker: "Broker-API",
      regionLookup: {},
    }),
  });
}

test("API and dashboard handlers retain separate route ownership", async () => {
  const dashboardOnly = await start({
    handlers: [createDashboardHandler({ instanceId: "Broker-DASHBOARD" })],
  });
  const dashboard = await fetch(`${dashboardOnly}/`);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    dashboard.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  const worker = await fetch(`${dashboardOnly}/maplibre-gl-worker.js`);
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get("content-type"), /text\/javascript/);
  assert.ok((await worker.text()).length > 100_000);
  assert.equal((await fetch(`${dashboardOnly}/api/dashboard`)).status, 404);

  const apiOnly = await start({ handlers: [apiHandler()] });
  assert.equal((await fetch(`${apiOnly}/`)).status, 404);
  const response = await fetch(`${apiOnly}/api/dashboard`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).respondingBroker, "Broker-API");
});

test("tool registry rejects structured output that violates its schema", async () => {
  const registry = new PublicToolRegistry();
  registry.add({
    name: "invalid_output",
    inputSchema: z.object({}).strict(),
    outputSchema: z
      .object({
        data: z.object({ ok: z.literal(true) }).strict(),
        meta: z.object({}).strict(),
      })
      .strict(),
    invoke: async () => ({
      content: [{ type: "text", text: "should-not-be-returned" }],
      structuredContent: {
        data: { ok: false, leaked: "should-not-be-returned" },
        meta: {},
      },
    }),
  });
  await assert.rejects(registry.invoke("invalid_output", {}));
});

test("dashboard API remains and API v1 is gone", async () => {
  const baseUrl = await start({ handlers: [apiHandler()] });
  for (const path of [
    "/api/v1",
    "/api/v1/nodes",
    `/api/v1/observers/${"A".repeat(64)}/status`,
  ]) {
    const removed = await fetch(`${baseUrl}${path}`);
    assert.equal(removed.status, 410, path);
    assert.equal((await removed.json()).code, "gone", path);
  }
  const missing = await fetch(`${baseUrl}/api/unknown`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "not_found");
});
