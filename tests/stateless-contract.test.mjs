import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "@jest/globals";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { MqttHistoryService } from "../dist/mqtt-history.js";
import { createPublicMcpHttpRuntime } from "../dist/mcp-server.js";
import { createFastifyApp } from "../dist/rest/fastify-app.js";
import { PublicMcpDataPolicy } from "../dist/mcp-public-policy.js";
import { createWebServer } from "../dist/web-server.js";
import { PublicMcpQueryService } from "../dist/mcp-public-query.js";
import { temporaryDatabase } from "./test-database.mjs";

const OBSERVER = "A".repeat(64);
const fixtures = [];
const servers = [];

afterEach(async () => {
  while (servers.length) await servers.pop().close();
  while (fixtures.length) await fixtures.pop().cleanup();
});

function b64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

async function signedCursor(fixture, payload) {
  let row = await fixture.database.get(
    "SELECT secret FROM cursor_signing_secret WHERE id = 1",
  );
  if (!row || typeof row.secret !== "string") {
    const secret = Buffer.from("t".repeat(64)).toString("hex");
    await fixture.database.run(
      "INSERT INTO cursor_signing_secret(id, secret) VALUES (1, ?)",
      secret,
    );
    row = { secret };
  }
  const encoded = b64url(JSON.stringify(payload));
  const signature = createHmac("sha256", row.secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function payloadOf(cursor) {
  const dot = cursor.lastIndexOf(".");
  return JSON.parse(
    Buffer.from(cursor.slice(0, dot), "base64url").toString("utf8"),
  );
}

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

async function statelessFixture() {
  const fixture = await temporaryDatabase("stateless-contract-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
  const decoder = {
    name: "stateless-fixture",
    version: "1",
    async decode(bytes) {
      const path = bytes[0] === 0x06 ? ["CC", "DDDD"] : ["CC", "CCCC"];
      return {
        status: "decoded",
        packetType: "ACK",
        packetTypeCode: 3,
        payloadType: "ACK",
        payloadTypeCode: 3,
        routeType: "FLOOD",
        decoded: {
          routeType: 1,
          payloadType: 3,
          pathHashSize: 1,
          path,
          payload: { raw: "", decoded: { checksum: "00" } },
          isValid: true,
        },
      };
    },
  };
  const history = new MqttHistoryService(fixture.database, storage, "test", {
    decoder,
    now: () => clock.now,
    startLoops: false,
  });
  await history.start();
  const publish = async () => {
    clock.now += 1;
    await history.capturePublish({
      cmd: "publish",
      topic: `meshcore/STO/${OBSERVER}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: OBSERVER, raw: "0500", RSSI: -80, SNR: 7 }),
      ),
      qos: 0,
      retain: false,
      dup: false,
    });
  };
  for (let i = 0; i < 40; i += 1) await publish();
  clock.now += 1;
  await history.capturePublish({
    cmd: "publish",
    topic: `meshcore/STO/${OBSERVER}/packets`,
    payload: Buffer.from(
      JSON.stringify({ origin_id: OBSERVER, raw: "0600", RSSI: -80, SNR: 7 }),
    ),
    qos: 0,
    retain: false,
    dup: false,
  });
  await history.drain();
  const query = (() =>
    new PublicMcpQueryService(
      fixture.database,
      storage,
      config,
      () => clock.now,
    ))();
  return { fixture, clock, history, query, publish };
}

test("cursors survive restart and work across independent service instances", async () => {
  const state = await statelessFixture();
  const queryA = state.query;
  const page1 = await queryA.searchPaths({ limit: 10 });
  assert.equal(page1.data.length, 10);
  assert.ok(page1.meta.next_cursor);

  const queryB = new PublicMcpQueryService(
    state.fixture.database,
    storage,
    config,
    () => state.clock.now,
  );
  const page2 = await queryB.searchPaths({
    limit: 10,
    cursor: page1.meta.next_cursor,
  });
  assert.equal(page2.data.length, 10);
  const page1Ids = new Set(page1.data.map((row) => row.observation_id));
  assert.ok(page2.data.every((row) => !page1Ids.has(row.observation_id)));

  const page3 = await queryA.searchPaths({
    limit: 10,
    cursor: page2.meta.next_cursor,
  });
  assert.equal(page3.data.length, 10);
  const allIds = new Set([
    ...page1Ids,
    ...page2.data.map((row) => row.observation_id),
  ]);
  assert.ok(page3.data.every((row) => !allIds.has(row.observation_id)));

  const singleInstance = new PublicMcpQueryService(
    state.fixture.database,
    storage,
    config,
    () => state.clock.now,
  );
  const controlPage2 = await singleInstance.searchPaths({
    limit: 10,
    cursor: page1.meta.next_cursor,
  });
  assert.deepEqual(
    page2.data.map((row) => row.observation_id),
    controlPage2.data.map((row) => row.observation_id),
  );

  await state.history.stop();
});

test("cursors are self-contained: continuation needs only cursor and limit", async () => {
  const state = await statelessFixture();
  const page1 = await state.query.searchPaths({
    region: "STO",
    minHops: 2,
    limit: 10,
  });
  assert.ok(page1.meta.next_cursor);

  const cursorOnly = await state.query.searchPaths({
    limit: 10,
    cursor: page1.meta.next_cursor,
  });
  const withFilters = await state.query.searchPaths({
    region: "STO",
    minHops: 2,
    limit: 10,
    cursor: page1.meta.next_cursor,
  });
  assert.deepEqual(
    cursorOnly.data.map((row) => row.observation_id),
    withFilters.data.map((row) => row.observation_id),
  );
  assert.ok(cursorOnly.data.length > 0);

  await assert.rejects(
    state.query.searchPaths({
      region: "JKG",
      minHops: 2,
      limit: 10,
      cursor: page1.meta.next_cursor,
    }),
    (error) => error.reason === "invalid_pagination_cursor",
  );

  await state.history.stop();
});

test("replaying the same cursor yields the same continuation", async () => {
  const state = await statelessFixture();
  const page1 = await state.query.searchPaths({ limit: 10 });
  assert.ok(page1.meta.next_cursor);
  const first = await state.query.searchPaths({
    limit: 10,
    cursor: page1.meta.next_cursor,
  });
  const replay = await state.query.searchPaths({
    limit: 10,
    cursor: page1.meta.next_cursor,
  });
  assert.deepEqual(
    first.data.map((row) => row.observation_id),
    replay.data.map((row) => row.observation_id),
  );
  await state.history.stop();
});

test("live ingest does not disturb in-flight pagination of mutable aggregates", async () => {
  const state = await statelessFixture();
  const page1 = await state.query.searchPathPrefixes({
    sort: { field: "occurrence_count", order: "asc" },
    limit: 1,
  });
  assert.equal(page1.data.length, 1);
  assert.equal(page1.data[0].prefix_hex, "DDDD");
  assert.equal(page1.data[0].occurrence_count, 1);
  assert.ok(page1.meta.next_cursor);

  for (let i = 0; i < 5; i += 1) await state.publish();
  await state.history.drain();

  const page2 = await state.query.searchPathPrefixes({
    limit: 1,
    cursor: page1.meta.next_cursor,
  });
  assert.equal(page2.data.length, 1);
  assert.equal(page2.data[0].prefix_hex, "CCCC");
  assert.equal(page2.data[0].occurrence_count, 40);
  assert.notEqual(page2.data[0].prefix_hex, page1.data[0].prefix_hex);

  await state.history.stop();
});

test("tampered cursors are rejected before any cursor field is used", async () => {
  const state = await statelessFixture();
  const page1 = await state.query.searchPaths({ limit: 10 });
  assert.ok(page1.meta.next_cursor);

  const modifiedPayload = payloadOf(page1.meta.next_cursor);
  modifiedPayload.timestamp = 1;
  const unsigned = b64url(JSON.stringify(modifiedPayload));
  await assert.rejects(
    state.query.searchPaths({ limit: 10, cursor: `${unsigned}.AAAA` }),
    (error) => error.reason === "invalid_pagination_cursor",
  );

  const [encoded, signature] = page1.meta.next_cursor.split(".");
  const corruptedPayload = Buffer.from(
    JSON.stringify({ ...payloadOf(page1.meta.next_cursor), id: 999_999 }),
    "utf8",
  ).toString("base64url");
  await assert.rejects(
    state.query.searchPaths({
      limit: 10,
      cursor: `${corruptedPayload}.${signature}`,
    }),
    (error) => error.reason === "invalid_pagination_cursor",
  );

  const flipped = encoded.replace(encoded[0], encoded[0] === "A" ? "B" : "A");
  await assert.rejects(
    state.query.searchPaths({ limit: 10, cursor: `${flipped}.${signature}` }),
    (error) => error.reason === "invalid_pagination_cursor",
  );

  await state.history.stop();
});

test("unknown cursor versions get a stable machine-readable error", async () => {
  const state = await statelessFixture();
  const page1 = await state.query.searchPaths({ limit: 10 });
  assert.ok(page1.meta.next_cursor);
  const payload = payloadOf(page1.meta.next_cursor);
  payload.version = 2;
  const cursorV2 = await signedCursor(state.fixture, payload);
  await assert.rejects(
    state.query.searchPaths({ limit: 10, cursor: cursorV2 }),
    (error) => error.reason === "unsupported_cursor_version",
  );
  await state.history.stop();
});

test("cursors pointing outside retention fail with a stable error", async () => {
  const state = await statelessFixture();
  const expired = await signedCursor(state.fixture, {
    version: 1,
    query: "search_paths",
    filters: { sort: { field: "received_at", order: "desc" } },
    timestamp: 1,
    id: 1,
    from: state.clock.now - 60 * 86_400_000,
    to: state.clock.now - 45 * 86_400_000,
  });
  await assert.rejects(
    state.query.searchPaths({ limit: 10, cursor: expired }),
    (error) => error.reason === "cursor_outside_retention_window",
  );
  await state.history.stop();
});

test("sorted and ascending continuations work cursor-only", async () => {
  const state = await statelessFixture();

  const ascPage1 = await state.query.searchPaths({ order: "asc", limit: 10 });
  assert.ok(ascPage1.meta.next_cursor);
  const ascPage2 = await state.query.searchPaths({
    limit: 10,
    cursor: ascPage1.meta.next_cursor,
  });
  assert.ok(ascPage2.data.length > 0);
  const ascTimes = [...ascPage1.data, ...ascPage2.data].map((row) =>
    Date.parse(row.received_at),
  );
  assert.deepEqual(
    ascTimes,
    [...ascTimes].sort((a, b) => a - b),
  );

  await state.history.stop();
});

test("event streams and packet views continue cursor-only with non-default order", async () => {
  const fixture = await temporaryDatabase("stateless-events-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
  const decoder = {
    name: "stateless-events-fixture",
    version: "1",
    async decode() {
      return {
        status: "decoded",
        packetType: "ACK",
        packetTypeCode: 3,
        payloadType: "ACK",
        payloadTypeCode: 3,
        routeType: "FLOOD",
        decoded: {
          routeType: 1,
          payloadType: 3,
          pathHashSize: 1,
          path: null,
          payload: { raw: "", decoded: { checksum: "00" } },
          isValid: true,
        },
      };
    },
  };
  const history = new MqttHistoryService(fixture.database, storage, "test", {
    decoder,
    now: () => clock.now,
    startLoops: false,
  });
  await history.start();
  for (let i = 0; i < 30; i += 1) {
    clock.now += 1;
    const raw = `${(i + 1).toString(16).padStart(2, "0")}00`;
    await history.capturePublish({
      cmd: "publish",
      topic: `meshcore/STO/${OBSERVER}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: OBSERVER, raw, RSSI: -80, SNR: 7 }),
      ),
      qos: 0,
      retain: false,
      dup: false,
    });
  }
  await history.drain();
  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => clock.now,
  );

  const page1 = await query.searchEvents({ order: "asc", limit: 5 });
  assert.equal(page1.data.length, 5);
  assert.ok(page1.meta.next_cursor);
  const page2 = await query.searchEvents({
    limit: 5,
    cursor: page1.meta.next_cursor,
  });
  assert.ok(page2.data.length > 0);
  const timestamps = [...page1.data, ...page2.data].map((row) =>
    Date.parse(row.timestamp),
  );
  assert.deepEqual(
    timestamps,
    [...timestamps].sort((a, b) => a - b),
  );

  const packetsPage1 = await query.searchPackets({ view: "raw", limit: 5 });
  assert.equal(packetsPage1.data.length, 5);
  assert.ok(packetsPage1.meta.next_cursor);
  const packetsPage2 = await query.searchPackets({
    limit: 5,
    cursor: packetsPage1.meta.next_cursor,
  });
  assert.ok(packetsPage2.data.length > 0);
  const reference = await query.searchPackets({ view: "raw", limit: 100 });
  const combined = [...packetsPage1.data, ...packetsPage2.data].map(
    (row) => row.packet_hash,
  );
  assert.deepEqual(
    combined,
    reference.data.slice(0, combined.length).map((row) => row.packet_hash),
  );

  await history.stop();
});

test("node lists continue cursor-only with sort and geospatial filters", async () => {
  const fixture = await temporaryDatabase("stateless-nodes-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
  const decoder = {
    name: "stateless-nodes-fixture",
    version: "1",
    async decode(bytes) {
      const index = bytes[0] - 1;
      return {
        status: "decoded",
        packetType: "ADVERT",
        packetTypeCode: 4,
        payloadType: "ADVERT",
        payloadTypeCode: 4,
        routeType: "FLOOD",
        decoded: {
          routeType: 1,
          payloadType: 4,
          pathHashSize: 1,
          path: ["AA"],
          payload: {
            raw: "",
            decoded: {
              type: 4,
              isValid: true,
              publicKey: (index + 10).toString(16).padStart(2, "0").repeat(32),
              timestamp: 1_800_000_000 + index,
              signature: `signature-${index}`,
              signatureValid: true,
              appData: {
                flags: 144,
                deviceRole: 2,
                hasLocation: true,
                hasName: true,
                location: { latitude: 59 + index * 0.1, longitude: 18 },
                name: `Node ${index}`,
              },
            },
          },
        },
        isValid: true,
      };
    },
  };
  const history = new MqttHistoryService(fixture.database, storage, "test", {
    decoder,
    now: () => clock.now,
    startLoops: false,
  });
  await history.start();
  for (let i = 0; i < 12; i += 1) {
    clock.now += 1;
    const raw = `${(i + 1).toString(16).padStart(2, "0")}00`;
    await history.capturePublish({
      cmd: "publish",
      topic: `meshcore/STO/${OBSERVER}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: OBSERVER, raw, RSSI: -80, SNR: 7 }),
      ),
      qos: 0,
      retain: false,
      dup: false,
    });
  }
  await history.drain();
  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => clock.now,
  );

  const filters = {
    sort: { field: "first_seen_at", order: "asc" },
    geo: { maxLatitude: 60.1 },
  };
  const page1 = await query.listNodes({ ...filters, limit: 4 });
  assert.equal(page1.data.length, 4);
  assert.ok(page1.meta.next_cursor);
  const page2 = await query.listNodes({
    limit: 4,
    cursor: page1.meta.next_cursor,
  });
  assert.ok(page2.data.length > 0);

  const reference = await query.listNodes({ ...filters, limit: 100 });
  const combinedKeys = [...page1.data, ...page2.data].map(
    (row) => row.public_key,
  );
  assert.deepEqual(
    combinedKeys,
    reference.data.slice(0, combinedKeys.length).map((row) => row.public_key),
  );
  assert.ok(
    reference.data.every(
      (row) => row.latitude === null || row.latitude <= 60.1,
    ),
  );

  await assert.rejects(
    query.listNodes({
      sort: { field: "first_seen_at", order: "asc" },
      geo: { maxLatitude: 59.1 },
      limit: 4,
      cursor: page1.meta.next_cursor,
    }),
    (error) => error.reason === "invalid_pagination_cursor",
  );

  await history.stop();
});

async function mcpLayerFixture() {
  const fixture = await temporaryDatabase("stateless-mcp-layer-");
  fixtures.push(fixture);
  const clock = { now: Date.now() };
  const decoder = {
    name: "stateless-mcp-layer-fixture",
    version: "1",
    async decode(bytes) {
      switch (bytes[0]) {
        case 2:
          return {
            status: "decoded",
            packetType: "TRACE",
            packetTypeCode: 9,
            payloadType: "TRACE",
            payloadTypeCode: 9,
            routeType: "FLOOD",
            decoded: {
              routeType: 1,
              payloadType: 9,
              pathHashSize: 1,
              path: null,
              payload: {
                raw: "",
                decoded: {
                  traceTag: "trace-public",
                  sourceHash: "CC",
                  pathHashes: ["CC"],
                  snrValues: [4.5],
                },
              },
              isValid: true,
            },
          };
        case 3:
          return {
            status: "decoded",
            packetType: "TXT_MSG",
            packetTypeCode: 2,
            payloadType: "TXT_MSG",
            payloadTypeCode: 2,
            routeType: "FLOOD",
            decoded: {
              routeType: 1,
              payloadType: 2,
              pathHashSize: 1,
              path: null,
              payload: {
                raw: "AABB",
                decoded: {
                  sourceHash: "CC",
                  destinationHash: "DD",
                  ciphertext: "AABB",
                },
              },
              isValid: true,
            },
          };
        default:
          return {
            status: "decoded",
            packetType: "ACK",
            packetTypeCode: 3,
            payloadType: "ACK",
            payloadTypeCode: 3,
            routeType: "FLOOD",
            decoded: {
              routeType: 1,
              payloadType: 3,
              pathHashSize: 1,
              path: ["CC", "CCCC"],
              payload: { raw: "", decoded: { checksum: "00" } },
              isValid: true,
            },
          };
      }
    },
  };
  const history = new MqttHistoryService(fixture.database, storage, "test", {
    decoder,
    now: () => clock.now,
    startLoops: false,
  });
  await history.start();
  const publish = async (raw) => {
    clock.now += 1;
    await history.capturePublish({
      cmd: "publish",
      topic: `meshcore/KSD/${OBSERVER}/packets`,
      payload: Buffer.from(
        JSON.stringify({ origin_id: OBSERVER, raw, RSSI: -80, SNR: 7 }),
      ),
      qos: 0,
      retain: false,
      dup: false,
    });
  };
  for (let i = 0; i < 30; i += 1) await publish("0500");
  await publish("0200");
  await publish("0200");
  await publish("0300");
  await history.drain();

  const policy = new PublicMcpDataPolicy();
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
      await history.stop();
      await mcp.close();
      await web.close();
    },
  });
  const client = new Client(
    { name: "stateless-mcp-layer-test", version: "1.0.0" },
    { versionNegotiation: { mode: "required" } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp/v2`),
    ),
  );
  const rest = await createFastifyApp({
    query: new PublicMcpQueryService(
      fixture.database,
      storage,
      config,
      () => clock.now,
    ),
    policy,
    config,
    apiHandler: () => false,
    dashboardHandler: () => false,
  });
  servers.push({ close: async () => rest.close() });
  return { fixture, clock, client, rest, publish };
}

test("MCP search_paths/search_events/search_path_prefixes honor self-contained cursors", async () => {
  const state = await mcpLayerFixture();

  const page1 = await state.client.callTool({
    name: "search_paths",
    arguments: {
      region: "KSD",
      min_hops: 1,
      sort: "received_at",
      order: "asc",
      limit: 2,
    },
  });
  assert.equal(page1.isError, undefined);
  assert.equal(page1.structuredContent.data.length, 2);
  assert.ok(page1.structuredContent.meta.next_cursor);

  const page2 = await state.client.callTool({
    name: "search_paths",
    arguments: { cursor: page1.structuredContent.meta.next_cursor, limit: 2 },
  });
  assert.equal(page2.isError, undefined);
  assert.equal(page2.structuredContent.data.length, 2);
  assert.notEqual(
    page2.structuredContent.data[0].observation_id,
    page1.structuredContent.data[0].observation_id,
  );

  const repeated = await state.client.callTool({
    name: "search_paths",
    arguments: {
      region: "KSD",
      min_hops: 1,
      sort: "received_at",
      order: "asc",
      limit: 2,
      cursor: page1.structuredContent.meta.next_cursor,
    },
  });
  assert.equal(repeated.isError, undefined);
  assert.deepEqual(
    repeated.structuredContent.data,
    page2.structuredContent.data,
  );

  const conflicting = await state.client.callTool({
    name: "search_paths",
    arguments: {
      region: "JKG",
      min_hops: 1,
      sort: "received_at",
      order: "asc",
      limit: 2,
      cursor: page1.structuredContent.meta.next_cursor,
    },
  });
  assert.equal(conflicting.isError, true);
  const conflictingText = conflicting.content[0].text;
  assert.match(conflictingText, /invalid_pagination_cursor/);

  const conflictingSort = await state.client.callTool({
    name: "search_paths",
    arguments: {
      region: "KSD",
      min_hops: 1,
      sort: "received_at",
      order: "desc",
      limit: 2,
      cursor: page1.structuredContent.meta.next_cursor,
    },
  });
  assert.equal(conflictingSort.isError, true);
  assert.match(conflictingSort.content[0].text, /invalid_pagination_cursor/);

  const eventsPage1 = await state.client.callTool({
    name: "search_events",
    arguments: {
      event_types: ["packet", "trace"],
      order: "asc",
      limit: 2,
    },
  });
  assert.equal(eventsPage1.isError, undefined);
  assert.equal(eventsPage1.structuredContent.data.length, 2);
  assert.ok(eventsPage1.structuredContent.meta.next_cursor);
  const eventsPage2 = await state.client.callTool({
    name: "search_events",
    arguments: {
      cursor: eventsPage1.structuredContent.meta.next_cursor,
      limit: 2,
    },
  });
  assert.equal(eventsPage2.isError, undefined);
  assert.ok(eventsPage2.structuredContent.data.length >= 1);
  const eventsPage2Repeated = await state.client.callTool({
    name: "search_events",
    arguments: {
      event_types: ["packet", "trace"],
      order: "asc",
      limit: 2,
      cursor: eventsPage1.structuredContent.meta.next_cursor,
    },
  });
  assert.equal(eventsPage2Repeated.isError, undefined);
  assert.deepEqual(
    eventsPage2.structuredContent.data,
    eventsPage2Repeated.structuredContent.data,
  );
  const eventsConflicting = await state.client.callTool({
    name: "search_events",
    arguments: {
      event_types: ["message"],
      order: "asc",
      limit: 2,
      cursor: eventsPage1.structuredContent.meta.next_cursor,
    },
  });
  assert.equal(eventsConflicting.isError, true);
  assert.match(eventsConflicting.content[0].text, /invalid_pagination_cursor/);

  const prefixesPage1 = await state.client.callTool({
    name: "search_path_prefixes",
    arguments: {
      sort: "occurrence_count",
      order: "asc",
      limit: 1,
    },
  });
  assert.equal(prefixesPage1.isError, undefined);
  assert.ok(prefixesPage1.structuredContent.meta.next_cursor);
  const prefixesPage2 = await state.client.callTool({
    name: "search_path_prefixes",
    arguments: {
      cursor: prefixesPage1.structuredContent.meta.next_cursor,
      limit: 1,
    },
  });
  assert.equal(prefixesPage2.isError, undefined);
  assert.notEqual(
    prefixesPage2.structuredContent.data[0].prefix_hex,
    prefixesPage1.structuredContent.data[0].prefix_hex,
  );

  const tampered = `${page1.structuredContent.meta.next_cursor.replace(
    page1.structuredContent.meta.next_cursor[0],
    page1.structuredContent.meta.next_cursor[0] === "A" ? "B" : "A",
  )}`;
  const tamperedCall = await state.client.callTool({
    name: "search_paths",
    arguments: { cursor: tampered, limit: 2 },
  });
  assert.equal(tamperedCall.isError, true);
  assert.match(tamperedCall.content[0].text, /invalid_pagination_cursor/);
});

test("REST path and event resources honor self-contained cursors", async () => {
  const state = await mcpLayerFixture();

  const page1 = await state.rest.inject({
    method: "GET",
    url: "/api/v2/paths?region=KSD&min_hops=1&sort=received_at&order=asc&limit=2",
  });
  assert.equal(page1.statusCode, 200);
  assert.equal(page1.json().data.length, 2);
  const cursor = page1.json().meta.next_cursor;
  assert.ok(cursor);

  const page2 = await state.rest.inject({
    method: "GET",
    url: `/api/v2/paths?limit=2&cursor=${encodeURIComponent(cursor)}`,
  });
  assert.equal(page2.statusCode, 200);
  assert.equal(page2.json().data.length, 2);
  assert.notEqual(
    page2.json().data[0].observation_id,
    page1.json().data[0].observation_id,
  );

  const conflicting = await state.rest.inject({
    method: "GET",
    url: `/api/v2/paths?region=JKG&min_hops=1&sort=received_at&order=asc&limit=2&cursor=${encodeURIComponent(cursor)}`,
  });
  assert.equal(conflicting.statusCode, 400);
  assert.equal(conflicting.json().reason, "invalid_pagination_cursor");

  const eventsPage1 = await state.rest.inject({
    method: "GET",
    url: "/api/v2/events?event_types=packet,trace&order=asc&limit=2",
  });
  assert.equal(eventsPage1.statusCode, 200);
  assert.equal(eventsPage1.json().data.length, 2);
  const eventsCursor = eventsPage1.json().meta.next_cursor;
  assert.ok(eventsCursor);
  const eventsPage2 = await state.rest.inject({
    method: "GET",
    url: `/api/v2/events?limit=2&cursor=${encodeURIComponent(eventsCursor)}`,
  });
  assert.equal(eventsPage2.statusCode, 200);
  assert.ok(eventsPage2.json().data.length >= 1);

  const eventsConflicting = await state.rest.inject({
    method: "GET",
    url: `/api/v2/events?event_types=message&order=asc&limit=2&cursor=${encodeURIComponent(eventsCursor)}`,
  });
  assert.equal(eventsConflicting.statusCode, 400);
  assert.equal(eventsConflicting.json().reason, "invalid_pagination_cursor");
});

test("implicit from/to stay frozen byte-for-byte across continuation pages", async () => {
  const state = await statelessFixture();

  const page1 = await state.query.searchPaths({ limit: 2 });
  assert.ok(page1.meta.next_cursor);
  const windows = [payloadOf(page1.meta.next_cursor)];
  let cursor = page1.meta.next_cursor;
  for (let i = 0; i < 3; i += 1) {
    state.clock.now += 60_000;
    await state.publish();
    await state.publish();
    await state.history.drain();
    const page = await state.query.searchPaths({ limit: 2, cursor });
    assert.ok(page.meta.next_cursor);
    windows.push(payloadOf(page.meta.next_cursor));
    cursor = page.meta.next_cursor;
  }
  assert.equal(windows.length, 4);
  assert.equal(new Set(windows.map((w) => w.from)).size, 1);
  assert.equal(new Set(windows.map((w) => w.to)).size, 1);

  const prefixPage1 = await state.query.searchPathPrefixes({
    sort: { field: "occurrence_count", order: "asc" },
    limit: 1,
  });
  assert.ok(prefixPage1.meta.next_cursor);
  state.clock.now += 60_000;
  await state.publish();
  await state.publish();
  await state.history.drain();
  const prefixPage2 = await state.query.searchPathPrefixes({
    limit: 1,
    cursor: prefixPage1.meta.next_cursor,
  });
  assert.ok(prefixPage2.meta.next_cursor);
  const prefixWindows = [
    payloadOf(prefixPage1.meta.next_cursor),
    payloadOf(prefixPage2.meta.next_cursor),
  ];
  assert.equal(new Set(prefixWindows.map((w) => w.from)).size, 1);
  assert.equal(new Set(prefixWindows.map((w) => w.to)).size, 1);

  const explicitFrom = state.clock.now - 600_000;
  const explicitPage1 = await state.query.searchPaths({
    from: explicitFrom,
    limit: 2,
  });
  assert.ok(explicitPage1.meta.next_cursor);
  const explicitPage2 = await state.query.searchPaths({
    limit: 2,
    cursor: explicitPage1.meta.next_cursor,
  });
  assert.equal(payloadOf(explicitPage1.meta.next_cursor).from, explicitFrom);
  assert.equal(payloadOf(explicitPage2.meta.next_cursor).from, explicitFrom);
  assert.equal(
    payloadOf(explicitPage1.meta.next_cursor).to,
    payloadOf(explicitPage2.meta.next_cursor).to,
  );

  await state.history.stop();
});

test("search_events freezes implicit from/to across continuation pages", async () => {
  const fixture = await temporaryDatabase("stateless-freeze-events-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
  const decoder = {
    name: "stateless-freeze-events-fixture",
    version: "1",
    async decode() {
      return {
        status: "decoded",
        packetType: "ACK",
        packetTypeCode: 3,
        payloadType: "ACK",
        payloadTypeCode: 3,
        routeType: "FLOOD",
        decoded: {
          routeType: 1,
          payloadType: 3,
          pathHashSize: 1,
          path: null,
          payload: { raw: "", decoded: { checksum: "00" } },
          isValid: true,
        },
      };
    },
  };
  const history = new MqttHistoryService(fixture.database, storage, "test", {
    decoder,
    now: () => clock.now,
    startLoops: false,
  });
  await history.start();
  const publish = async () => {
    clock.now += 1;
    await history.capturePublish({
      cmd: "publish",
      topic: `meshcore/STO/${OBSERVER}/packets`,
      payload: Buffer.from(
        JSON.stringify({
          origin_id: OBSERVER,
          raw: `${Math.floor(clock.now % 60)
            .toString(16)
            .padStart(2, "0")}00`,
          RSSI: -80,
          SNR: 7,
        }),
      ),
      qos: 0,
      retain: false,
      dup: false,
    });
  };
  for (let i = 0; i < 40; i += 1) await publish();
  await history.drain();
  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => clock.now,
  );

  const page1 = await query.searchEvents({ limit: 2 });
  assert.ok(page1.meta.next_cursor);
  const windows = [payloadOf(page1.meta.next_cursor)];
  let cursor = page1.meta.next_cursor;
  for (let i = 0; i < 3; i += 1) {
    clock.now += 60_000;
    await publish();
    await publish();
    await history.drain();
    const page = await query.searchEvents({ limit: 2, cursor });
    assert.ok(page.meta.next_cursor);
    windows.push(payloadOf(page.meta.next_cursor));
    cursor = page.meta.next_cursor;
  }
  assert.equal(windows.length, 4);
  assert.equal(new Set(windows.map((w) => w.from)).size, 1);
  assert.equal(new Set(windows.map((w) => w.to)).size, 1);

  await history.stop();
});
