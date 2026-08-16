import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  bytesToHex,
  calcRegionKey,
  ChannelCrypto,
} from "@michaelhart/meshcore-decoder";
import { MqttHistoryService } from "../dist/mqtt-history.js";
import { PublicMcpQueryService } from "../dist/mcp-public-query.js";
import { DefaultMeshCorePacketDecoder } from "../dist/meshcore-packet-decoder.js";
import {
  buildChannelKeyRegistry,
  channelHashForKey,
  deriveHashtagChannelKey,
} from "../dist/channel-key-registry.js";
import { temporaryDatabase } from "./test-database.mjs";

const BOT_CHANNEL_KEY = "eb50a1bcb3e4e5d7bf69a57c9dada211";
const BOT_PACKET_HEX =
  "15833fa002860ccae0eed9ca78b9ab0775d477c1f6490a398bf4edc75240";
const OBSERVER = "A".repeat(64);
const fixtures = [];

afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

function packet(body) {
  return {
    cmd: "publish",
    topic: `meshcore/STO/${OBSERVER}/packets`,
    payload: Buffer.from(JSON.stringify(body)),
    qos: 0,
    retain: false,
    dup: false,
  };
}

test("channel key registry derives hashtag keys and prefers named channels", () => {
  const registry = buildChannelKeyRegistry({
    enabled: true,
    hashtagChannels: ["test", "#slay"],
    channels: [{ name: "bot", key: BOT_CHANNEL_KEY }],
  });
  assert.ok(registry);
  assert.equal(registry.entryCount, 3);
  assert.equal(registry.hashtagCount, 2);
  assert.equal(registry.pskCount, 1);

  const expectedHashtagKey = bytesToHex(calcRegionKey("#test")).toLowerCase();
  assert.equal(deriveHashtagChannelKey("#test"), expectedHashtagKey);
  assert.equal(
    registry.resolveEntry(channelHashForKey(expectedHashtagKey)).name,
    "#test",
  );
  assert.equal(
    registry.resolveEntry(channelHashForKey(expectedHashtagKey)).kind,
    "hashtag",
  );

  const botHash =
    ChannelCrypto.calculateChannelHash(BOT_CHANNEL_KEY).toLowerCase();
  assert.deepEqual(registry.resolveEntry(botHash), {
    name: "bot",
    key: BOT_CHANNEL_KEY,
    kind: "psk",
  });

  const disabled = buildChannelKeyRegistry({
    enabled: false,
    hashtagChannels: ["#test"],
    channels: [],
  });
  assert.equal(disabled, undefined);
});

test("default packet decoder decrypts configured group text channels", async () => {
  const registry = buildChannelKeyRegistry({
    enabled: true,
    hashtagChannels: [],
    channels: [{ name: "bot", key: BOT_CHANNEL_KEY }],
  });
  const decoder = new DefaultMeshCorePacketDecoder(registry.buildKeyStore());
  const result = await decoder.decode(Buffer.from(BOT_PACKET_HEX, "hex"));
  assert.equal(result.status, "decoded");
  assert.equal(result.packetType, "GRP_TXT");
  assert.equal(result.decoded.payload.decoded.decrypted.sender, "Roy B V4");
  assert.equal(result.decoded.payload.decoded.decrypted.message, "P");

  const plain = new DefaultMeshCorePacketDecoder();
  const withoutKeys = await plain.decode(Buffer.from(BOT_PACKET_HEX, "hex"));
  assert.equal(withoutKeys.decoded.payload.decoded.decrypted, undefined);
});

test("decrypted channel messages store plaintext and expose it via MCP DTOs", async () => {
  const fixture = await temporaryDatabase("channel-decryption-");
  fixtures.push(fixture);
  const clock = { now: 1_800_000_000_000 };
  const registry = buildChannelKeyRegistry({
    enabled: true,
    hashtagChannels: [],
    channels: [{ name: "bot", key: BOT_CHANNEL_KEY }],
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
  const history = new MqttHistoryService(fixture.database, storage, "test", {
    decoder: new DefaultMeshCorePacketDecoder(registry.buildKeyStore()),
    channelNameResolver: (hash) => registry.resolveEntry(hash)?.name,
    now: () => clock.now,
    startLoops: false,
  });
  await history.start();
  await history.capturePublish(
    packet({ origin_id: OBSERVER, raw: BOT_PACKET_HEX, RSSI: -80, SNR: 7 }),
  );
  await history.drain();

  const rows = await fixture.database.all(
    "SELECT encrypted, text, channel, channel_name, decrypted_sender, decrypted_flags FROM messages",
  );
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].encrypted), 0);
  assert.equal(rows[0].text, "P");
  assert.equal(rows[0].channel_name, "bot");
  assert.equal(rows[0].decrypted_sender, "Roy B V4");
  assert.equal(Number(rows[0].decrypted_flags), 0);

  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => clock.now,
    undefined,
    (hash) => registry.resolveEntry(hash),
  );
  const messages = await query.searchMessages({ view: "raw", limit: 10 });
  assert.equal(messages.data.length, 1);
  assert.equal(messages.data[0].encrypted, false);
  assert.equal(messages.data[0].text, "P");
  assert.equal(messages.data[0].channel_name, "bot");
  assert.equal(messages.data[0].channel_key, BOT_CHANNEL_KEY);
  assert.equal(messages.data[0].decrypted_sender, "Roy B V4");

  const logicalMessages = await query.searchMessages({ limit: 10 });
  assert.equal(logicalMessages.data[0].channel_name, "bot");
  assert.equal(logicalMessages.data[0].channel_key, BOT_CHANNEL_KEY);

  const message = await query.getMessage(messages.data[0].message_id);
  assert.equal(message.data.text, "P");
  assert.match(message.data.payload_hex, /^[0-9A-F]+$/);
  assert.equal(message.data.channel_key, BOT_CHANNEL_KEY);

  const payloads = await query.getMessagePayloads([
    message.data.message_id,
    123456,
  ]);
  assert.equal(payloads.data.payloads.length, 1);
  assert.equal(payloads.data.payloads[0].payload_hex, message.data.payload_hex);
  assert.equal(payloads.data.payloads[0].encrypted, false);
  assert.deepEqual(payloads.data.missing_message_ids, [123456]);
  await assert.rejects(
    query.getMessagePayloads([]),
    (error) => error.reason === "invalid_message_payload_batch",
  );
  await assert.rejects(
    query.getMessagePayloads(Array.from({ length: 101 }, (_, i) => i + 1)),
    (error) => error.reason === "invalid_message_payload_batch",
  );

  await history.stop();
});

test("encrypted channels without configured keys stay ciphertext-only", async () => {
  const fixture = await temporaryDatabase("channel-undecrypted-");
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
  const history = new MqttHistoryService(fixture.database, storage, "test", {
    now: () => clock.now,
    startLoops: false,
  });
  await history.start();
  await history.capturePublish(
    packet({ origin_id: OBSERVER, raw: BOT_PACKET_HEX, RSSI: -80, SNR: 7 }),
  );
  await history.drain();

  const query = new PublicMcpQueryService(
    fixture.database,
    storage,
    config,
    () => clock.now,
  );
  const messages = await query.searchMessages({ view: "raw", limit: 10 });
  assert.equal(messages.data[0].encrypted, true);
  assert.equal(messages.data[0].text, null);
  assert.equal(messages.data[0].channel_name, null);
  assert.equal(messages.data[0].channel_key, null);
  const message = await query.getMessage(messages.data[0].message_id);
  assert.match(message.data.payload_hex, /^[0-9A-F]+$/);
  assert.equal(message.data.decrypted_sender, null);
  await history.stop();
});
