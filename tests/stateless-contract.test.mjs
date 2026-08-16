import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "@jest/globals";
import { MqttHistoryService } from "../dist/mqtt-history.js";
import { PublicMcpQueryService } from "../dist/mcp-public-query.js";
import { temporaryDatabase } from "./test-database.mjs";

const OBSERVER = "A".repeat(64);
const fixtures = [];

afterEach(async () => {
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
          path: ["CC", "CCCC"],
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
  assert.equal(page1.data[0].occurrence_count, 40);
  assert.ok(page1.meta.next_cursor);

  for (let i = 0; i < 5; i += 1) await state.publish();
  await state.history.drain();

  const page2 = await state.query.searchPathPrefixes({
    limit: 1,
    cursor: page1.meta.next_cursor,
  });
  assert.equal(page2.data.length, 1);
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
    filters: { sort: { field: "received_at", order: "desc" }, order: "desc" },
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
