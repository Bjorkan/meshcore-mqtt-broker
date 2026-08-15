import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { MqttHistoryService } from "../dist/mqtt-history.js";
import {
  PublicMcpDataPolicy,
  publicMcpToolResult,
} from "../dist/mcp-public-policy.js";
import { createPublicMcpHttpRuntime } from "../dist/mcp-server.js";
import { createWebServer } from "../dist/web-server.js";
import { temporaryDatabase } from "./test-database.mjs";

const OBSERVER = "A".repeat(64);
const NODE = "C".repeat(64);
const fixtures = [];
const servers = [];

afterEach(async () => {
  while (servers.length) await servers.pop().close();
  while (fixtures.length) await fixtures.pop().cleanup();
});

test("public policy preserves allowed MeshCore fields", () => {
  const policy = new PublicMcpDataPolicy();
  const input = {
    public_key: NODE,
    observer_public_key: OBSERVER,
    node_name: "Public repeater",
    latitude: 59.3293,
    longitude: 18.0686,
    rssi: -91,
    snr: 8.5,
    score: 42,
    firmware_version: "1.2.3",
    model: "T-Deck",
    radio_configuration: {
      frequency_mhz: 869.525,
      bandwidth_khz: 125,
      spreading_factor: 11,
      coding_rate: 5,
      tx_power_dbm: 22,
    },
    packet_hash: "D".repeat(64),
    raw_packet_hex: "AABBCCDD",
    path: ["CC", "CCCC"],
    neighbor_public_key: "E".repeat(64),
    trace: { tag: "public-trace", hop_snr: [4.5, -1] },
    telemetry: { temperature: 21.5 },
  };
  assert.deepEqual(policy.sanitize(input), input);
});

test("public policy recursively redacts values and blocks sensitive fields", () => {
  const policy = new PublicMcpDataPolicy();
  const sanitized = policy.sanitize({
    node: {
      metadata: {
        contact: "Node operator: test@example.com",
        gateway: "IPv4 192.168.1.10 and 203.0.113.50",
        ipv6: "gateway 2001:db8::1",
        bearer: "Bearer abcdef123456",
        encoded:
          "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dummysignaturevalue",
        credential: "Turso token: turso-secret-value",
        topic: "meshcore/STO/key/internal/private",
        serial: "/serial/responses/device",
        system: "$SYS/broker/clients/connected",
      },
      email_address: "blocked@example.org",
      remote_ip: "10.0.0.4",
      password: "mqtt-secret",
      private_key: "private-material",
      api_key: "api-secret",
      public_key: NODE,
    },
    data: [{ nested: { ip: "192.168.1.2", safe: "still public" } }],
  });
  const serialized = JSON.stringify(sanitized);
  for (const forbidden of [
    "test@example.com",
    "blocked@example.org",
    "192.168.1.10",
    "203.0.113.50",
    "2001:db8::1",
    "abcdef123456",
    "dummysignaturevalue",
    "turso-secret-value",
    "mqtt-secret",
    "private-material",
    "api-secret",
    "/internal/private",
    "/serial/responses",
    "$SYS/broker",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.match(serialized, /\[REDACTED_EMAIL\]/);
  assert.match(serialized, /\[REDACTED_IP\]/);
  assert.match(serialized, /\[REDACTED_SECRET\]/);
  assert.equal(sanitized.node.public_key, NODE);
  assert.equal("email_address" in sanitized.node, false);
  assert.equal("remote_ip" in sanitized.node, false);
  assert.equal("password" in sanitized.node, false);
  assert.equal("private_key" in sanitized.node, false);
  assert.equal("api_key" in sanitized.node, false);
  assert.equal("ip" in sanitized.data[0].nested, false);
  assert.equal(sanitized.data[0].nested.safe, "still public");
  assert.deepEqual(policy.getMetrics(), {
    redactedEmailsTotal: 1,
    redactedIpsTotal: 3,
    redactedSecretsTotal: 3,
    blockedSensitiveFieldsTotal: 6,
    sanitizationFailuresTotal: 0,
  });
});

test("sanitizer failures return only a safe MCP error", async () => {
  const policy = new PublicMcpDataPolicy();
  const cyclic = { data: {}, meta: {} };
  cyclic.data.self = cyclic;
  const result = await publicMcpToolResult(policy, "cyclic_test", cyclic);
  assert.equal(result.isError, true);
  assert.equal("structuredContent" in result, false);
  const serialized = JSON.stringify(result);
  assert.match(serialized, /safe_internal_error/);
  assert.doesNotMatch(serialized, /self/);
  assert.equal(policy.getMetrics().sanitizationFailuresTotal, 1);
});

test("query failures return only a safe MCP error", async () => {
  const policy = new PublicMcpDataPolicy();
  const result = await publicMcpToolResult(
    policy,
    "query_failure_test",
    Promise.reject(
      new Error(
        "SQL failed at /data/meshcore-mqtt-broker/meshcore-mqtt-broker.db",
      ),
    ),
  );
  assert.equal(result.isError, true);
  assert.equal("structuredContent" in result, false);
  const serialized = JSON.stringify(result);
  assert.match(serialized, /safe_internal_error/);
  assert.doesNotMatch(serialized, /SQL|\/data\/|\.db/);
});

test("serialized MCP V2 response bodies contain redactions and no credentials", async () => {
  const fixture = await temporaryDatabase("mcp-policy-http-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
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
  const decoder = {
    name: "mcp-policy-fixture",
    version: "1",
    async decode() {
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
          path: null,
          payload: {
            raw: "",
            decoded: {
              publicKey: NODE,
              timestamp: 1_800_000_000,
              signatureValid: true,
              isValid: true,
              appData: {
                flags: 128,
                deviceRole: 2,
                hasName: true,
                hasLocation: false,
                name: "foo@example.com gateway 10.0.0.4 2001:db8::1",
              },
            },
          },
          isValid: true,
        },
      };
    },
  };
  const history = new MqttHistoryService(
    fixture.database,
    storage,
    "mcp-policy-test",
    { decoder, now: () => clock.now, startLoops: false },
  );
  await history.start();
  await history.capturePublish({
    cmd: "publish",
    topic: `meshcore/STO/${OBSERVER}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: OBSERVER, raw: "0100" })),
    qos: 0,
    retain: false,
    dup: false,
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

  const responseBodies = [];
  const capturedFetch = async (input, init) => {
    const response = await fetch(input, init);
    responseBodies.push(await response.clone().text());
    return response;
  };
  const client = new Client(
    { name: "anonymous-public-policy-test", version: "1.0.0" },
    { versionNegotiation: { mode: "required" } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp/v2`),
      { fetch: capturedFetch },
    ),
  );
  const response = await client.callTool({
    name: "list_nodes",
    arguments: { limit: 10 },
  });
  assert.equal(response.isError, undefined);
  assert.equal(response.structuredContent.data[0].public_key, NODE);
  const serializedBodies = responseBodies.join("\n");
  assert.doesNotMatch(serializedBodies, /foo@example\.com/);
  assert.doesNotMatch(serializedBodies, /10\.0\.0\.4/);
  assert.doesNotMatch(serializedBodies, /2001:db8::1/);
  assert.match(serializedBodies, /REDACTED_EMAIL/);
  assert.match(serializedBodies, /REDACTED_IP/);
  assert.doesNotMatch(serializedBodies, /Authorization|Cookie|api[_-]?key/i);
  await client.close();
});
