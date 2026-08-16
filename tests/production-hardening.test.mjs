import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { MqttHistoryService } from "../dist/mqtt-history.js";
import { PublicMcpQueryService } from "../dist/mcp-public-query.js";
import { createPublicMcpHttpRuntime } from "../dist/mcp-server.js";
import { createWebServer } from "../dist/web-server.js";
import { temporaryDatabase } from "./test-database.mjs";

const OBSERVERS = ["A".repeat(64), "B".repeat(64)];
const NODES = ["C".repeat(64), "D".repeat(64)];
const fixtures = [];
const servers = [];

afterEach(async () => {
  while (servers.length) await servers.pop().close();
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

const CURSOR_MAX_LENGTH = 4096;

function decode(type, typeCode, payload, overrides = {}) {
  return {
    status: "decoded",
    packetType: type,
    packetTypeCode: typeCode,
    payloadType: type,
    payloadTypeCode: typeCode,
    routeType: "FLOOD",
    decoded: {
      routeType: 1,
      payloadType: typeCode,
      pathHashSize: 1,
      path: overrides.path ?? null,
      payload: { raw: overrides.rawPayload ?? "", decoded: payload },
      isValid: true,
    },
  };
}

function advertDecode(publicKey, timestamp, latitude, path = ["AA"]) {
  return decode(
    "ADVERT",
    4,
    {
      type: 4,
      isValid: true,
      publicKey,
      timestamp,
      signature: `signature-${publicKey}-${timestamp}`,
      signatureValid: true,
      appData: {
        flags: 144,
        deviceRole: 2,
        hasLocation: true,
        hasName: true,
        location: { latitude, longitude: 18.1 },
        name: `Node ${publicKey.slice(0, 4)}`,
      },
    },
    { path },
  );
}

async function hardeningFixture() {
  const fixture = await temporaryDatabase("production-hardening-");
  fixtures.push(fixture);
  const clock = { now: Date.now() - 3_600_000 };
  const decoder = {
    name: "hardening-fixture",
    version: "1",
    async decode(bytes) {
      switch (bytes[0]) {
        case 0x01:
          return advertDecode(NODES[0], 1_800_000_000, 59.3);
        case 0x02:
          return advertDecode(NODES[1], 1_800_000_000, 59.4, ["BB"]);
        case 0x11:
          return advertDecode(NODES[0], 1_800_000_001, 59.31);
        case 0x21:
          return advertDecode(NODES[0], 1_800_000_000, 59.3);
        case 0x13:
          return decode(
            "TXT_MSG",
            2,
            {
              sourceHash: "CC",
              destinationHash: "DD",
              ciphertext: "AABB",
            },
            { rawPayload: "AABB" },
          );
        case 0x03:
          return decode(
            "TXT_MSG",
            2,
            {
              sourceHash: "CC",
              destinationHash: "DD",
              ciphertext: "AABB",
            },
            { rawPayload: "AABB" },
          );
        default:
          return decode("ACK", 3, { checksum: "00" }, { path: ["CC", "CCCC"] });
      }
    },
  };
  const history = new MqttHistoryService(fixture.database, storage, "test", {
    decoder,
    now: () => clock.now,
    startLoops: false,
  });
  await history.start();
  const publish = async (region, observer, subtopic, body, retain = false) => {
    clock.now += 1;
    await history.capturePublish({
      cmd: "publish",
      topic: `meshcore/${region}/${observer}/${subtopic}`,
      payload: Buffer.from(JSON.stringify({ origin_id: observer, ...body })),
      qos: 0,
      retain,
      dup: false,
    });
  };
  const status = async (observer, _minute) => {
    clock.now += 60_000;
    await publish("STO", observer, "status", {
      timestamp: new Date(clock.now - 1_000).toISOString(),
      origin: "Observer",
      model: "T-Deck",
      firmware_version: "1.0.0",
    });
  };
  await status(OBSERVERS[0], 1);
  await status(OBSERVERS[0], 2);
  await status(OBSERVERS[1], 1);
  await publish(
    "STO",
    OBSERVERS[0],
    "neighbors",
    {
      neighbors: [
        { public_key: NODES[0], snr: 8.5, rssi: -90, heard_secs_ago: 1 },
      ],
    },
    true,
  );
  clock.now += 60_000;
  await publish(
    "STO",
    OBSERVERS[0],
    "neighbors",
    {
      neighbors: [
        { public_key: NODES[0], snr: 9, rssi: -91, heard_secs_ago: 2 },
      ],
    },
    true,
  );
  for (let i = 0; i < 10; i += 1) {
    clock.now += 60_000;
    await publish("STO", OBSERVERS[0], "packets", {
      raw: `${(0x50 + i).toString(16).padStart(2, "0")}00`,
      RSSI: -80,
      SNR: 7,
    });
  }
  await publish("STO", OBSERVERS[0], "packets", {
    raw: "0100",
    RSSI: -80,
    SNR: 7,
  });
  await publish("STO", OBSERVERS[1], "packets", {
    raw: "2100",
    RSSI: -80,
    SNR: 7,
  });
  await publish("JKG", OBSERVERS[1], "packets", {
    raw: "1100",
    RSSI: -80,
    SNR: 7,
  });
  await publish("STO", OBSERVERS[0], "packets", {
    raw: "0200",
    RSSI: -80,
    SNR: 7,
  });
  await publish("STO", OBSERVERS[0], "packets", {
    raw: "0300",
    RSSI: -80,
    SNR: 7,
  });
  await publish("STO", OBSERVERS[0], "packets", {
    raw: "1300",
    RSSI: -80,
    SNR: 7,
  });
  await history.drain();

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
    { name: "production-hardening-test", version: "1.0.0" },
    { versionNegotiation: { mode: "required" } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp/v2`),
    ),
  );
  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => clock.now,
  );
  return { fixture, clock, client, query, history };
}

test("server-generated cursors never exceed the input schema max length", async () => {
  const state = await hardeningFixture();
  const now = Date.now();
  const from = new Date(now - 3_600_000).toISOString();
  const to = new Date(now).toISOString();

  const maximal = [
    [
      "search_packets",
      {
        view: "raw",
        region: "STO",
        packet_type: "ACK",
        payload_type: "ACK",
        route_type: "FLOOD",
        min_rssi: -300,
        max_rssi: 100,
        min_snr: -100,
        max_snr: 100,
        min_score: -1_000_000,
        max_score: 1_000_000,
        min_hops: 0,
        max_hops: 64,
        decode_status: "decoded",
        sort: "last_observed_at",
        order: "asc",
        from,
        to,
        limit: 1,
      },
    ],
    [
      "search_events",
      {
        region: "STO",
        event_types: [
          "packet",
          "advert",
          "message",
          "trace",
          "telemetry",
          "observer_status",
        ],
        order: "asc",
        from,
        to,
        limit: 1,
      },
    ],
    [
      "search_messages",
      {
        view: "raw",
        message_type: "TXT_MSG",
        encrypted: true,
        region: "STO",
        from,
        to,
        limit: 1,
      },
    ],
    [
      "search_paths",
      {
        region: "STO",
        contains_prefix_hex: "CC",
        min_hops: 1,
        max_hops: 64,
        order: "asc",
        from,
        to,
        limit: 1,
      },
    ],
    [
      "search_adverts",
      {
        region: "STO",
        signature_valid: true,
        has_location: true,
        from,
        to,
        limit: 1,
      },
    ],
    [
      "list_nodes",
      {
        region: "STO",
        sort: "last_seen_at",
        order: "asc",
        limit: 1,
      },
    ],
    [
      "list_observers",
      {
        region: "STO",
        sort: "last_seen_at",
        order: "asc",
        limit: 1,
      },
    ],
  ];

  let cursorsChecked = 0;
  for (const [tool, args] of maximal) {
    const response = await state.client.callTool({
      name: tool,
      arguments: args,
    });
    assert.equal(response.isError, undefined, tool);
    const nextCursor = response.structuredContent?.meta?.next_cursor;
    if (typeof nextCursor !== "string") continue;
    cursorsChecked += 1;
    assert.ok(
      Buffer.byteLength(nextCursor, "utf8") <= CURSOR_MAX_LENGTH,
      `${tool} cursor of ${Buffer.byteLength(nextCursor, "utf8")} bytes exceeds schema max ${CURSOR_MAX_LENGTH}`,
    );
    const resubmitted = await state.client.callTool({
      name: tool,
      arguments: { ...args, cursor: nextCursor },
    });
    assert.equal(
      resubmitted.isError,
      undefined,
      `${tool} must re-accept its own maximal cursor through its input schema`,
    );
  }
  assert.ok(
    cursorsChecked >= 5,
    `expected most maximal filter sets to produce cursors, got ${cursorsChecked}`,
  );
});

test("required-argument endpoints accept cursor-only continuation through MCP", async () => {
  const state = await hardeningFixture();
  const now = Date.now();
  const from = new Date(now - 3_600_000).toISOString();
  const to = new Date(now).toISOString();

  const chains = [
    [
      "get_observer_status_history",
      { observer_public_key: OBSERVERS[0], limit: 1 },
    ],
    ["get_neighbor_history", { observer_public_key: OBSERVERS[0], limit: 1 }],
    ["get_node_position_history", { node_public_key: NODES[0], limit: 1 }],
    ["get_node_sightings", { node_public_key: NODES[0], limit: 1 }],
    ["get_node_adverts", { public_key: NODES[0], limit: 1 }],
    [
      "get_signal_history",
      {
        observer_public_key: OBSERVERS[0],
        from,
        to,
        bucket: "minute",
        limit: 1,
      },
    ],
    ["get_activity_timeseries", { from, to, bucket: "minute", limit: 1 }],
  ];

  for (const [tool, page1Args] of chains) {
    const page1 = await state.client.callTool({
      name: tool,
      arguments: page1Args,
    });
    assert.equal(page1.isError, undefined, tool);
    const cursor = page1.structuredContent?.meta?.next_cursor;
    assert.equal(
      typeof cursor,
      "string",
      `${tool} page 1 must produce a next_cursor`,
    );
    const page2 = await state.client.callTool({
      name: tool,
      arguments: { cursor, limit: 1 },
    });
    assert.equal(page2.isError, undefined, `${tool} cursor-only page 2`);
    const repeated = await state.client.callTool({
      name: tool,
      arguments: { ...page1Args, cursor },
    });
    assert.equal(repeated.isError, undefined, `${tool} repeated filters`);
  }
});

test("search_adverts raw_packet_hashes matches the query-scoped count", async () => {
  const state = await hardeningFixture();
  const adverts = await state.query.searchAdverts({ region: "STO", limit: 10 });
  for (const row of adverts.data) {
    assert.equal(
      new Set(row.raw_packet_hashes).size,
      row.raw_packet_count,
      "distinct hashes must equal raw_packet_count",
    );
  }
  const all = await state.query.searchAdverts({ limit: 10 });
  for (const row of all.data) {
    assert.equal(new Set(row.raw_packet_hashes).size, row.raw_packet_count);
  }
});

test("observation-scoped events carry the observation's observer, rssi, and snr", async () => {
  const state = await hardeningFixture();
  const adverts = await state.query.searchEvents({
    eventTypes: ["advert"],
    limit: 10,
  });
  assert.ok(adverts.data.length >= 1);
  for (const row of adverts.data) {
    assert.ok(row.observer_public_key, "advert events must carry the observer");
    assert.equal(typeof row.rssi, "number");
    assert.equal(typeof row.snr, "number");
  }
  const packets = await state.query.searchEvents({
    eventTypes: ["packet"],
    limit: 10,
  });
  assert.ok(packets.data.length >= 1);
  for (const row of packets.data) {
    assert.equal(row.observer_public_key, null);
    assert.equal(row.rssi, null);
    assert.equal(row.snr, null);
  }
});

test("search_messages raw view has at most one row per packet hash", async () => {
  const state = await hardeningFixture();
  const raw = await state.query.searchMessages({ view: "raw", limit: 250 });
  const seen = new Set();
  for (const row of raw.data) {
    assert.ok(
      !seen.has(row.packet_hash),
      `duplicate raw row for ${row.packet_hash}`,
    );
    seen.add(row.packet_hash);
    assert.ok(row.observation_count >= 1);
  }
});

test("mutable-sort list tools snapshot their ordering across pages", async () => {
  const state = await hardeningFixture();
  const page1 = await state.query.listNodes({
    sort: { field: "last_seen_at", order: "desc" },
    limit: 1,
  });
  assert.ok(page1.meta.next_cursor);
  const topKey = page1.data[0].public_key;

  state.clock.now += 60_000;
  await state.history.capturePublish({
    cmd: "publish",
    topic: `meshcore/STO/${OBSERVERS[0]}/packets`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: OBSERVERS[0],
        raw: "1100",
        RSSI: -80,
        SNR: 7,
      }),
    ),
    qos: 0,
    retain: false,
    dup: false,
  });
  await state.history.drain();

  const page2 = await state.query.listNodes({
    limit: 10,
    cursor: page1.meta.next_cursor,
  });
  const page2Keys = new Set(page2.data.map((row) => row.public_key));
  assert.ok(!page2Keys.has(topKey), "snapshot must not re-emit the moved node");

  const full = await state.query.listNodes({ limit: 250 });
  const fullKeys = full.data.map((row) => row.public_key);
  assert.equal(
    new Set([topKey, ...page2.data.map((r) => r.public_key)]).size,
    new Set(fullKeys).size,
  );
});

test("resolution snapshots are frozen inside a pagination chain", async () => {
  const state = await hardeningFixture();
  const page1 = await state.query.searchPaths({
    containsResolutionStatus: "unresolved",
    limit: 1,
  });
  assert.ok(page1.data.length >= 1);
  assert.ok(page1.meta.next_cursor);
  const cursorPayload = JSON.parse(
    Buffer.from(
      page1.meta.next_cursor.slice(0, page1.meta.next_cursor.lastIndexOf(".")),
      "base64url",
    ).toString("utf8"),
  );
  assert.ok(
    Number.isSafeInteger(cursorPayload.resolution_as_of),
    "page-1 cursor must carry resolution_as_of",
  );

  state.clock.now += 60_000;
  const page2 = await state.query.searchPaths({
    limit: 1,
    cursor: page1.meta.next_cursor,
  });
  if (page2.meta.next_cursor) {
    const page2Payload = JSON.parse(
      Buffer.from(
        page2.meta.next_cursor.slice(
          0,
          page2.meta.next_cursor.lastIndexOf("."),
        ),
        "base64url",
      ).toString("utf8"),
    );
    assert.equal(
      page2Payload.resolution_as_of,
      cursorPayload.resolution_as_of,
      "resolution_as_of must be identical across the pagination chain",
    );
  }

  const freshPage1 = await state.query.searchPaths({
    containsResolutionStatus: "unresolved",
    limit: 1,
  });
  const freshPayload = JSON.parse(
    Buffer.from(
      freshPage1.meta.next_cursor.slice(
        0,
        freshPage1.meta.next_cursor.lastIndexOf("."),
      ),
      "base64url",
    ).toString("utf8"),
  );
  assert.ok(
    freshPayload.resolution_as_of >= cursorPayload.resolution_as_of,
    "a new query gets a fresh resolution snapshot",
  );

  const prefixPage1 = await state.query.searchPathPrefixes({
    resolutionStatus: "unresolved",
    limit: 1,
  });
  assert.ok(prefixPage1.meta.next_cursor);
  const prefixPayload = JSON.parse(
    Buffer.from(
      prefixPage1.meta.next_cursor.slice(
        0,
        prefixPage1.meta.next_cursor.lastIndexOf("."),
      ),
      "base64url",
    ).toString("utf8"),
  );
  assert.ok(Number.isSafeInteger(prefixPayload.resolution_as_of));
});
