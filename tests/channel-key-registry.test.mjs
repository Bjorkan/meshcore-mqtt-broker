import assert from "node:assert/strict";
import { createCipheriv, createHmac } from "node:crypto";
import { test } from "@jest/globals";
import {
  buildChannelKeyRegistry,
  channelHashForKey,
  deriveHashtagChannelKey,
} from "../dist/channel-key-registry.js";

function encryptGroupText(key) {
  const plaintext = Buffer.alloc(16);
  plaintext.writeUInt32LE(1_700_000_000, 0);
  plaintext[4] = 0;
  plaintext.write("test", 5, "utf8");
  const cipher = createCipheriv("aes-128-ecb", Buffer.from(key, "hex"), null);
  cipher.setAutoPadding(false);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const channelSecret = Buffer.concat([
    Buffer.from(key, "hex"),
    Buffer.alloc(16),
  ]);
  const cipherMac = createHmac("sha256", channelSecret)
    .update(ciphertext)
    .digest("hex")
    .slice(0, 4);
  return { cipherMac, ciphertext: ciphertext.toString("hex") };
}

test("resolves a colliding channel hash using the key that authenticates the group text", () => {
  const testKey = deriveHashtagChannelKey("#test");
  const hassleholmKey = deriveHashtagChannelKey("#hassleholm");
  const hash = channelHashForKey(testKey);
  assert.equal(hash, channelHashForKey(hassleholmKey));

  const registry = buildChannelKeyRegistry({
    enabled: true,
    hashtagChannels: ["#test", "#hassleholm"],
    channels: [],
  });
  assert.ok(registry);
  const encrypted = encryptGroupText(testKey);

  assert.equal(registry.resolveEntry(hash)?.name, undefined);
  assert.equal(
    registry.resolveEntry(hash, encrypted.cipherMac, encrypted.ciphertext)
      ?.name,
    "#test",
  );
});

test("server resolver adapter forwards the authentication context", () => {
  const registry = buildChannelKeyRegistry({
    enabled: true,
    hashtagChannels: ["#test", "#hassleholm"],
    channels: [],
  });
  assert.ok(registry);
  const encrypted = encryptGroupText(deriveHashtagChannelKey("#test"));
  const serverAdapter = (channelHashHex, cipherMac, ciphertext) =>
    registry.resolveEntry(channelHashHex, cipherMac, ciphertext)?.name;

  assert.equal(serverAdapter("d9"), undefined);
  assert.equal(
    serverAdapter("d9", encrypted.cipherMac, encrypted.ciphertext),
    "#test",
  );
});
