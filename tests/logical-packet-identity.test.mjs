import assert from "node:assert/strict";
import { test } from "bun:test";
import { logicalPacketIdentity } from "../src/logical-packet-identity.js";

test("message identity is independent of decode depth", () => {
  const base = {
    packetType: "TXT_MSG",
    payloadType: "TXT_MSG",
    payloadRawHex: "AABB",
    rawSha256: "1".repeat(64),
  };
  const fullDecode = logicalPacketIdentity({
    ...base,
    payload: {
      sourceHash: "CCCCCCCC",
      destinationHash: "DDDDDDDD",
      ciphertext: "AABB",
      decrypted: { timestamp: 1_800_000_000, text: "hello" },
    },
  });
  const partialDecode = logicalPacketIdentity({
    ...base,
    payload: {
      sourceHash: "CCCCCCCC",
      destinationHash: "DDDDDDDD",
      ciphertext: "AABB",
    },
  });
  assert.equal(fullDecode.id, partialDecode.id);
});

test("acknowledgement identity is route-independent when payload bytes decode", () => {
  const first = logicalPacketIdentity({
    packetType: "ACK",
    payloadType: "ACK",
    payload: {},
    payloadRawHex: "0D00",
    rawSha256: "a".repeat(64),
  });
  const second = logicalPacketIdentity({
    packetType: "ACK",
    payloadType: "ACK",
    payload: {},
    payloadRawHex: "0D00",
    rawSha256: "b".repeat(64),
  });
  assert.equal(first.id, second.id);
});

test("undecodable packets keep the raw-hash fallback", () => {
  const first = logicalPacketIdentity({
    packetType: undefined,
    payloadType: undefined,
    rawSha256: "a".repeat(64),
  });
  const second = logicalPacketIdentity({
    packetType: undefined,
    payloadType: undefined,
    rawSha256: "b".repeat(64),
  });
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^lp_[0-9a-f]{64}$/);
});

test("trace and message identity keep full hash precision", () => {
  const traceA = logicalPacketIdentity({
    packetType: "TRACE",
    payload: {
      sourceHash: "AABBCCDDEEFF01",
      pathHashes: ["CC"],
      snrValues: [4],
    },
    rawSha256: "1".repeat(64),
  });
  const traceB = logicalPacketIdentity({
    packetType: "TRACE",
    payload: {
      sourceHash: "AABBCCDDEEFF02",
      pathHashes: ["CC"],
      snrValues: [4],
    },
    rawSha256: "2".repeat(64),
  });
  assert.notEqual(traceA.id, traceB.id);
});

test("distinct adverts stay distinct while flood copies merge", () => {
  const advert = (timestamp, signature) =>
    logicalPacketIdentity({
      packetType: "ADVERT",
      payload: {
        publicKey: "C".repeat(64),
        timestamp,
        signature,
        appData: { name: "node" },
      },
      rawSha256: "1".repeat(64),
    });
  const floodCopy = logicalPacketIdentity({
    packetType: "ADVERT",
    payload: {
      publicKey: "C".repeat(64),
      timestamp: 100,
      signature: "sig",
      appData: { name: "node" },
    },
    rawSha256: "2".repeat(64),
  });
  assert.equal(advert(100, "sig").id, floodCopy.id);
  assert.notEqual(advert(100, "sig").id, advert(101, "sig").id);
  assert.notEqual(advert(100, "sig").id, advert(100, "other").id);
});

test("response identity distinguishes different ciphertexts from the same source", () => {
  const first = logicalPacketIdentity({
    packetType: "RESPONSE",
    payloadType: "RESPONSE",
    payload: {
      sourceHash: "AABB",
      destinationHash: "CCDD",
      cipherMac: "0000",
      ciphertext: "DEADBEEF",
    },
    rawSha256: "1".repeat(64),
  });
  const second = logicalPacketIdentity({
    packetType: "RESPONSE",
    payloadType: "RESPONSE",
    payload: {
      sourceHash: "AABB",
      destinationHash: "CCDD",
      cipherMac: "0000",
      ciphertext: "CAFEF00D",
    },
    rawSha256: "2".repeat(64),
  });
  assert.notEqual(first.id, second.id);
});

test("response flood copies of identical bytes merge", () => {
  const payload = {
    sourceHash: "AABB",
    destinationHash: "CCDD",
    cipherMac: "0000",
    ciphertext: "DEADBEEF",
  };
  const first = logicalPacketIdentity({
    packetType: "RESPONSE",
    payloadType: "RESPONSE",
    payload,
    rawSha256: "1".repeat(64),
  });
  const floodCopy = logicalPacketIdentity({
    packetType: "RESPONSE",
    payloadType: "RESPONSE",
    payload,
    rawSha256: "2".repeat(64),
  });
  assert.equal(first.id, floodCopy.id);
});

test("trace identity is independent of reported SNR values", () => {
  const base = {
    packetType: "TRACE",
    payloadType: "TRACE",
    rawSha256: "2".repeat(64),
  };
  const withNumericSnr = logicalPacketIdentity({
    ...base,
    payload: {
      tag: "route",
      sourceHash: "CCCCCCCC",
      pathHashes: ["AAAAAAAA", "BBBBBBBB"],
      snrValues: [4, -1],
    },
  });
  const withOtherNumericSnr = logicalPacketIdentity({
    ...base,
    payload: {
      tag: "route",
      sourceHash: "CCCCCCCC",
      pathHashes: ["AAAAAAAA", "BBBBBBBB"],
      snrValues: [99, 99],
    },
  });
  const withoutSnr = logicalPacketIdentity({
    ...base,
    payload: {
      tag: "route",
      sourceHash: "CCCCCCCC",
      pathHashes: ["AAAAAAAA", "BBBBBBBB"],
    },
  });
  const withStringSnr = logicalPacketIdentity({
    ...base,
    payload: {
      tag: "route",
      sourceHash: "CCCCCCCC",
      pathHashes: ["AAAAAAAA", "BBBBBBBB"],
      snrValues: ["4", "-1"],
    },
  });
  assert.equal(withNumericSnr.id, withOtherNumericSnr.id);
  assert.equal(withNumericSnr.id, withoutSnr.id);
  assert.equal(withNumericSnr.id, withStringSnr.id);
});
