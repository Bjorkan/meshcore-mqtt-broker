import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { createApiHandler } from "../dist/api.js";
import { createDashboardHandler } from "../dist/dashboard.js";
import { createPublicToolRegistry } from "../dist/mcp-server.js";
import { createPublicToolApiHandler } from "../dist/public-tool-api.js";
import { createWebServer } from "../dist/web-server.js";
import { temporaryDatabase } from "./test-database.mjs";

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
  servers.push(server);
  const port = await server.listen();
  return `http://127.0.0.1:${port}`;
}

async function publicApi() {
  const fixture = await temporaryDatabase("api-v2-");
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
  const registry = createPublicToolRegistry(options);
  const apiHandler = createApiHandler({
    publicTools: registry,
    getDashboardSnapshot: async () => ({
      generatedAt: 123,
      respondingBroker: "Broker-API",
      regionLookup: {},
    }),
  });
  return {
    registry,
    apiHandler,
    protocolHandler: createPublicToolApiHandler(registry),
  };
}

test("API and dashboard handlers retain separate route ownership", async () => {
  const dashboardOnly = await start({
    handlers: [createDashboardHandler({ instanceId: "Broker-DASHBOARD" })],
  });
  assert.equal((await fetch(`${dashboardOnly}/`)).status, 200);
  assert.equal((await fetch(`${dashboardOnly}/api/dashboard`)).status, 404);

  const api = await publicApi();
  const apiOnly = await start({ handlers: [api.apiHandler] });
  assert.equal((await fetch(`${apiOnly}/`)).status, 404);
  const response = await fetch(`${apiOnly}/api/dashboard`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).respondingBroker, "Broker-API");
});

test("Swagger UI publishes all exact V2 tool schemas and no V1 API", async () => {
  const api = await publicApi();
  const baseUrl = await start({
    handlers: [api.apiHandler],
    protocolHandlers: [api.protocolHandler],
  });
  const docs = await fetch(`${baseUrl}/api/docs`);
  const html = await docs.text();
  assert.equal(docs.status, 200);
  assert.match(
    docs.headers.get("content-security-policy"),
    /default-src 'self'/,
  );
  assert.match(html, /\/api\/docs\/swagger-ui\.css/);
  assert.doesNotMatch(html, /https?:\/\//);

  const initializer = await (
    await fetch(`${baseUrl}/api/docs/swagger-initializer.js`)
  ).text();
  assert.match(initializer, /supportedSubmitMethods: \["get", "post"\]/);

  const css = await fetch(`${baseUrl}/api/docs/swagger-ui.css`);
  assert.equal(css.status, 200);
  assert.ok((await css.text()).length > 100_000);

  const specification = await (
    await fetch(`${baseUrl}/api/openapi.json`)
  ).json();
  assert.equal(specification.openapi, "3.1.0");
  assert.equal(specification.info.version, "2.0.0");
  assert.ok(specification.paths["/api/v2"].get);
  assert.equal(
    Object.keys(specification.paths).filter((path) =>
      path.startsWith("/api/v2/tools/"),
    ).length,
    23,
  );
  assert.equal(
    Object.keys(specification.paths).some((path) => path.startsWith("/api/v1")),
    false,
  );
  const getObserver = specification.paths["/api/v2/tools/get_observer"].post;
  assert.equal(getObserver.operationId, "get_observer");
  assert.equal(
    getObserver.requestBody.content["application/json"].schema.required.join(
      ",",
    ),
    "public_key",
  );
  assert.equal(
    getObserver.requestBody.content["application/json"].schema
      .additionalProperties,
    false,
  );
  assert.equal(
    getObserver.responses["200"].content[
      "application/json"
    ].schema.required.join(","),
    "data,meta",
  );
  assert.equal(
    api.registry.names().join(","),
    Object.keys(specification.paths)
      .filter((path) => path.startsWith("/api/v2/tools/"))
      .map((path) => path.slice("/api/v2/tools/".length))
      .sort((left, right) => left.localeCompare(right))
      .join(","),
  );
});

test("V2 discovery is anonymous and V1 is gone", async () => {
  const api = await publicApi();
  const baseUrl = await start({ handlers: [api.apiHandler] });
  const response = await fetch(`${baseUrl}/api/v2`);
  assert.equal(response.status, 200);
  const index = await response.json();
  assert.equal(index.version, "v2");
  assert.equal(index.publicAccess, true);
  assert.equal(index.authenticationRequired, false);
  assert.equal(index.readOnly, true);
  assert.equal(index.tools.length, 23);
  assert.ok(
    index.tools.every(
      (tool) =>
        tool.method === "POST" && tool.path === `/api/v2/tools/${tool.name}`,
    ),
  );

  for (const path of [
    "/api/v1",
    "/api/v1/nodes",
    `/api/v1/observers/${"A".repeat(64)}/status`,
  ]) {
    const removed = await fetch(`${baseUrl}${path}`);
    assert.equal(removed.status, 410, path);
    assert.equal((await removed.json()).code, "gone", path);
  }
});
