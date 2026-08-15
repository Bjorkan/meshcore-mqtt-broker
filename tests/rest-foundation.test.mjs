import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { createFastifyApp } from "../dist/rest/fastify-app.js";
import { PublicMcpQueryService } from "../dist/mcp-public-query.js";
import { PublicMcpDataPolicy } from "../dist/mcp-public-policy.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];

afterEach(async () => {
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

test("REST system endpoints are public, anonymous, and read-only", async () => {
  const fixture = await temporaryDatabase("rest-foundation-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
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

  const root = await app.inject({ method: "GET", url: "/api/v2" });
  assert.equal(root.statusCode, 200);
  assert.equal(root.json().public_access, true);
  assert.equal(root.json().authentication_required, false);
  assert.equal(root.json().read_only, true);
  assert.equal(root.json().mcp.endpoint, "/mcp/v2");

  const capabilities = await app.inject({
    method: "GET",
    url: "/api/v2/capabilities",
  });
  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.json().data.retention_days, 30);
  assert.deepEqual(capabilities.json().data.supported_views, [
    "logical",
    "raw",
  ]);
  assert.deepEqual(capabilities.json().data.supported_count_modes, [
    "logical",
    "raw_packet",
    "observation",
  ]);
  assert.equal(capabilities.json().data.logical_packet_grouping, true);
  assert.equal(capabilities.json().data.logical_message_grouping, true);
  assert.equal(capabilities.json().data.geospatial, true);
  assert.equal(capabilities.json().data.batch_lookup, true);
  assert.equal(capabilities.json().data.max_timeseries_buckets, 1_440);

  const storageInfo = await app.inject({
    method: "GET",
    url: "/api/v2/storage",
  });
  assert.equal(storageInfo.statusCode, 200);
  assert.equal(storageInfo.json().data.database_available, true);
  assert.equal(storageInfo.json().data.schema_version, 2);

  const schema = await app.inject({ method: "GET", url: "/api/v2/schema" });
  assert.equal(schema.statusCode, 200);
  assert.equal(schema.json().data.region_code_system, "IATA");
  assert.ok(schema.json().data.count_semantics.logical_packet);

  const summary = await app.inject({
    method: "GET",
    url: "/api/v2/network/summary",
  });
  assert.equal(summary.statusCode, 200);
  assert.ok(summary.json().data.window_from);
  assert.equal(summary.json().data.advert_count, 0);

  const invertedRange = await app.inject({
    method: "GET",
    url: "/api/v2/network/summary?from=2026-08-15T10:00:00Z&to=2026-08-14T10:00:00Z",
  });
  assert.equal(invertedRange.statusCode, 400);
  assert.equal(invertedRange.json().status, "invalid_request");
  assert.equal(invertedRange.json().reason, "invalid_time_range");

  const malformed = await app.inject({
    method: "GET",
    url: "/api/v2/network/summary?from=not-a-date",
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().status, "invalid_request");
  assert.equal(malformed.json().reason, "invalid_arguments");

  const openapi = await app.inject({
    method: "GET",
    url: "/api/v2/openapi.json",
  });
  assert.equal(openapi.statusCode, 200);
  assert.ok(openapi.json().paths["/api/v2/network/summary"]);
  assert.ok(openapi.json().paths["/api/v2/capabilities"]);

  const docs = await app.inject({ method: "GET", url: "/api/v2/docs/" });
  assert.equal(docs.statusCode, 200);
  assert.match(docs.body, /swagger-ui/i);

  const missing = await app.inject({ method: "GET", url: "/api/v2/nodes" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().status, "not_found");

  const wrongMethod = await app.inject({
    method: "POST",
    url: "/api/v2/storage",
  });
  assert.equal(wrongMethod.statusCode, 405);

  await app.close();
  await fixture.cleanup();
});
