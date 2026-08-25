import { deserialize as legacyV8Deserialize } from "node:v8";
import {
  decode as messagePackDecode,
  encode as messagePackEncode,
} from "@msgpack/msgpack";
import type { AedesPacket } from "aedes-packet";

// Portable, versioned persistence format for Aedes packets stored in
// PostgreSQL. Layout: ASCII magic "MESHMQTT1" followed by one MessagePack
// document. The MessagePack payload is the packet object with function-valued
// properties removed; binary values (Buffer/Uint8Array) use MessagePack's bin
// format. The magic prefix lets readers distinguish this format forever and
// keeps the transition-time Node V8 reader strictly bounded to old rows.
const MAGIC = Buffer.from("MESHMQTT1", "ascii");

export function encodeStoredPacket(packet: unknown): Buffer {
  const payload = messagePackEncode(stripFunctions(packet));
  return Buffer.concat([MAGIC, Buffer.from(payload)]);
}

export function decodeStoredPacket(bytes: Uint8Array): AedesPacket {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (
    buffer.length >= MAGIC.length &&
    buffer.subarray(0, MAGIC.length).equals(MAGIC)
  ) {
    return normalizeBinary(
      messagePackDecode(buffer.subarray(MAGIC.length)),
    ) as AedesPacket;
  }
  // Transitional reader for rows persisted by the previous Node V8 format.
  // This path exists only so the transition release can read pre-migration
  // state; new writes always use the portable format above.
  return legacyV8Deserialize(buffer) as AedesPacket;
}

function stripFunctions(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const copy = { ...(value as Record<string, unknown>) };
  for (const key of Object.keys(copy)) {
    if (typeof copy[key] === "function") delete copy[key];
  }
  return copy;
}

// MessagePack decodes bin-format values as plain Uint8Array. MQTT packet
// handling expects Buffer instances (payload bytes, v5 binary properties),
// so every decoded Uint8Array is restored to Buffer before it leaves the
// codec boundary.
function normalizeBinary(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    if (Buffer.isBuffer(value)) return value;
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = normalizeBinary(value[index]);
    }
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      record[key] = normalizeBinary(record[key]);
    }
    return record;
  }
  return value;
}
