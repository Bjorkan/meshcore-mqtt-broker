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
      summary: {
        connectedClients: 5,
        connectedObservers: 2,
        activeBrokers: 1,
        totalBrokers: 1,
        messagesPerSecond: 1.5,
        publishesLastMinute: 90,
        activeBans: 1,
        blockedObservers: 2,
        protectionEventsShown: 3,
        protectionEventsTruncated: false,
        protectionEventsTotal: 3,
      },
      brokers: [
        {
          instanceId: "Broker-API",
          startedAt: 23,
          connectedClients: 5,
          publisherClients: 2,
          claimedObservers: 2,
          messagesPerSecond: 1.5,
          messagesLastMinute: 90,
          ready: true,
          status: "healthy",
          lastUpdateAgeMs: 0,
          targetBridge: { enabled: true, connected: true },
        },
      ],
      observers: [],
      recentPublishes: [],
      bans: [],
      subscribers: [{ connectionCount: 3 }],
      regionLookup: {
        STO: {
          friendlyName: "Stockholm",
          primaryRegion: "STO",
          isPrimary: true,
          isAllowed: true,
        },
      },
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
  assert.equal(specification.info.version, "1.2.0");
  assert.ok(specification.paths["/api/dashboard"]);
  assert.ok(specification.paths["/api/v1"]);
  assert.ok(specification.paths["/api/v1/regions"]);
  assert.ok(specification.paths["/api/v1/nodes"]);
  assert.ok(specification.paths["/api/v1/nodes/{publicKey}"]);
  assert.ok(specification.paths["/api/v1/observers"]);
  assert.ok(specification.paths["/api/v1/observers/{publicKey}/status"]);
  assert.equal(
    specification.paths["/api/v1/nodes"].get.parameters[0].name,
    "region",
  );
  assert.equal(
    specification.components.schemas.NodesResponse.properties.nodes.items.$ref,
    "#/components/schemas/NodeSummary",
  );
  assert.equal(
    specification.components.schemas.NodeResponse.properties.node.$ref,
    "#/components/schemas/NodeDetail",
  );
  assert.equal(
    specification.components.schemas.ErrorResponse.required.includes("status"),
    false,
  );
});

test("versioned API index returns only public resource links", async () => {
  const baseUrl = await start([await apiHandler()]);

  const index = await (await fetch(`${baseUrl}/api/v1`)).json();
  assert.equal(index.name, "MeshCore MQTT Broker API");
  assert.equal(index.version, "v1");
  assert.equal(index.documentation, "/api/docs");
  assert.equal(index.resources.nodes, "/api/v1/nodes");
  assert.equal(index.resources.observers, "/api/v1/observers");
  assert.equal(index.resources.status, undefined);
  assert.equal(index.generatedAt, undefined);
});

test("observer list supports bounded active and region filters", async () => {
  const fixture = await temporaryDatabase("api-observers-");
  fixtures.push(fixture);
  const stateStore = new BrokerStateStore(fixture.database, "Broker-API");
  const activeKey = "A".repeat(64);
  const inactiveKey = "B".repeat(64);
  await stateStore.setObserverEntries([
    {
      label: "fallback active",
      publicKey: activeKey,
      broker: "Broker-API",
      region: "STO",
      active: true,
      lastConnectedAt: 100,
      lastSeenAt: 200,
      messageCount: 4,
      messages: [],
    },
    {
      label: "fallback inactive",
      publicKey: inactiveKey,
      broker: "Broker-API",
      region: "STO",
      active: false,
      lastConnectedAt: 50,
      lastSeenAt: 75,
      messageCount: 2,
      messages: [],
    },
  ]);
  await stateStore.setObserverNodeName(activeKey, "Friendly active", 60_000);
  const baseUrl = await start([
    createApiHandler({
      stateStore,
      getDashboardSnapshot: async () => ({ regionLookup: {} }),
    }),
  ]);

  const active = await (await fetch(`${baseUrl}/api/v1/observers`)).json();
  assert.equal(active.filters.active, true);
  assert.equal(active.count, 1);
  assert.equal(active.observers[0].publicKey, activeKey);
  assert.equal(active.observers[0].name, "Friendly active");
  assert.equal(
    Object.keys(active.observers[0]).sort().join(","),
    "active,lastSeenAt,name,publicKey,region",
  );

  const observerStatus = await (
    await fetch(`${baseUrl}/api/v1/observers/${activeKey}/status`)
  ).json();
  assert.equal(observerStatus.status, "known");
  assert.equal(observerStatus.publicKey, activeKey);
  assert.equal(observerStatus.name, "Friendly active");
  assert.equal(observerStatus.region, "STO");
  assert.equal(observerStatus.active, true);
  assert.equal(observerStatus.lastSeenAt, 200);
  assert.equal(observerStatus.observer, undefined);
  assert.equal(observerStatus.brokerId, undefined);

  await stateStore.recordDeniedPublish({
    node: activeKey,
    reason: "region mismatch",
    topic: "meshcore/STO/test",
    region: "STO",
  });
  const blockedStatus = await (
    await fetch(`${baseUrl}/api/v1/observers/${activeKey}/status`)
  ).json();
  assert.equal(blockedStatus.status, "blocked");
  assert.equal(blockedStatus.name, "Friendly active");
  assert.equal(blockedStatus.block.action, "denied");
  assert.equal(blockedStatus.block.reason, "region mismatch");
  assert.equal(blockedStatus.block.status, undefined);
  assert.equal(blockedStatus.observer, undefined);

  const unknownStatus = await (
    await fetch(`${baseUrl}/api/v1/observers/${"C".repeat(64)}/status`)
  ).json();
  assert.equal(unknownStatus.status, "unknown");
  assert.equal(unknownStatus.name, undefined);

  const all = await (
    await fetch(`${baseUrl}/api/v1/observers?active=all&region=sto&limit=10`)
  ).json();
  assert.equal(all.filters.region, "STO");
  assert.equal(all.filters.active, "all");
  assert.equal(all.count, 2);

  const invalid = await fetch(`${baseUrl}/api/v1/observers?active=sometimes`);
  assert.equal(invalid.status, 400);
  const invalidBody = await invalid.json();
  assert.equal(invalidBody.code, "invalid_request");
  assert.equal(invalidBody.status, undefined);

  const missingRoute = await fetch(`${baseUrl}/api/v1/not-a-resource`);
  assert.equal(missingRoute.status, 404);
  assert.equal((await missingRoute.json()).code, "not_found");

  const wrongMethod = await fetch(`${baseUrl}/api/v1/observers`, {
    method: "POST",
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET, HEAD");
  assert.equal((await wrongMethod.json()).code, "method_not_allowed");
});
