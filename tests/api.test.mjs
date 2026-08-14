import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { createApiHandler } from "../dist/api.js";
import { createDashboardHandler } from "../dist/dashboard.js";
import { BrokerStateStore } from "../dist/state-store.js";
import { createWebServer } from "../dist/web-server.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
const servers = [];

afterEach(async () => {
  while (servers.length) await servers.pop().close();
  while (fixtures.length) await fixtures.pop().cleanup();
});

async function start(handlers) {
  const server = createWebServer({
    host: "127.0.0.1",
    port: 0,
    handlers,
  });
  servers.push(server);
  const port = await server.listen();
  return `http://127.0.0.1:${port}`;
}

async function apiHandler() {
  const fixture = await temporaryDatabase("api-");
  fixtures.push(fixture);
  const stateStore = new BrokerStateStore(fixture.database, "Broker-API");
  return createApiHandler({
    stateStore,
    getDashboardSnapshot: async () => ({
      generatedAt: 123,
      respondingBroker: "Broker-API",
    }),
  });
}

test("API and dashboard handlers own separate route sets", async () => {
  const dashboardOnly = await start([
    createDashboardHandler({ instanceId: "Broker-DASHBOARD" }),
  ]);
  assert.equal((await fetch(`${dashboardOnly}/`)).status, 200);
  assert.equal((await fetch(`${dashboardOnly}/api/dashboard`)).status, 404);

  const apiOnly = await start([await apiHandler()]);
  assert.equal((await fetch(`${apiOnly}/`)).status, 404);
  const response = await fetch(`${apiOnly}/api/dashboard`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).respondingBroker, "Broker-API");
});

test("Swagger UI and OpenAPI document are served locally by the API", async () => {
  const baseUrl = await start([await apiHandler()]);
  const docs = await fetch(`${baseUrl}/api/docs`);
  const html = await docs.text();
  assert.equal(docs.status, 200);
  assert.match(
    docs.headers.get("content-security-policy"),
    /default-src 'self'/,
  );
  assert.match(html, /\/api\/docs\/swagger-ui\.css/);
  assert.match(html, /\/api\/docs\/swagger-ui-bundle\.js/);
  assert.doesNotMatch(html, /https?:\/\//);

  const css = await fetch(`${baseUrl}/api/docs/swagger-ui.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /^text\/css/);
  assert.ok((await css.text()).length > 100_000);

  const specification = await (
    await fetch(`${baseUrl}/api/openapi.json`)
  ).json();
  assert.equal(specification.openapi, "3.1.0");
  assert.ok(specification.paths["/api/dashboard"]);
  assert.ok(specification.paths["/api/v1/nodes"]);
  assert.ok(specification.paths["/api/v1/observers/{publicKey}/status"]);
  assert.equal(
    specification.paths["/api/v1/nodes"].get.parameters[0].name,
    "region",
  );
});
