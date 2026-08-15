import { createHash } from "node:crypto";

export const LOGICAL_PACKET_ID_PREFIX = "lp_";

type JsonRecord = Record<string, unknown>;

function text(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.slice(0, limit);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "bigint") return value.toString(10);
  return "";
}

function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return scalar(value);
  }
}

function join(parts: unknown[]): string {
  return parts
    .map((value) => {
      if (value === undefined || value === null) return "";
      if (Array.isArray(value)) return `[${value.map(scalar).join(",")}]`;
      return scalar(value);
    })
    .join("|");
}

function stringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.toUpperCase())
    .slice(0, limit);
}

export interface LogicalPacketIdentityInput {
  packetType?: string;
  payloadType?: string;
  payload?: JsonRecord;
  payloadRawHex?: string;
  rawSha256: string;
}

export interface LogicalPacketIdentity {
  id: string;
  packetType: string | null;
  payloadType: string | null;
}

export function logicalPacketIdentity(
  input: LogicalPacketIdentityInput,
): LogicalPacketIdentity {
  const packetType = input.packetType?.toUpperCase() ?? null;
  const payloadType = input.payloadType?.toUpperCase() ?? null;
  const payload = input.payload ?? {};
  let key: string;
  switch (packetType) {
    case "ADVERT":
      key = join([
        "advert",
        text(payload.publicKey, 64).toUpperCase(),
        payload.timestamp,
        text(payload.signature, 500),
        hash(canonicalJson(payload.appData)),
      ]);
      break;
    case "TRACE":
      key = join([
        "trace",
        text(payload.traceTag ?? payload.tag, 100),
        text(payload.sourceHash, 64).toUpperCase(),
        stringArray(payload.pathHashes, 64),
        stringArray(payload.snrValues, 64),
      ]);
      break;
    case "TXT_MSG":
    case "GRP_TXT":
    case "GRP_DATA": {
      key = join([
        "msg",
        packetType,
        text(payload.sourceHash, 64).toUpperCase(),
        text(payload.destinationHash, 64).toUpperCase(),
        text(payload.channelHash, 100),
        payload.channelIndex,
        text(payload.ciphertext, 10_000).toUpperCase() ||
          text(input.payloadRawHex, 10_000).toUpperCase(),
      ]);
      break;
    }
    case "RESPONSE":
      key = join([
        "resp",
        text(payload.sourceHash, 64).toUpperCase(),
        text(payload.destinationHash, 64).toUpperCase(),
        text(payload.cipherMac, 100).toUpperCase(),
        text(payload.ciphertext, 10_000).toUpperCase() ||
          text(input.payloadRawHex, 10_000).toUpperCase() ||
          hash(canonicalJson(payload.telemetry ?? payload.values)),
      ]);
      break;
    default:
      key =
        typeof input.payloadRawHex === "string" &&
        input.payloadRawHex.length > 0
          ? join([
              "payload",
              packetType ?? payloadType ?? "unknown",
              input.payloadRawHex.toUpperCase(),
            ])
          : join(["raw", input.rawSha256]);
      break;
  }
  return {
    id: `${LOGICAL_PACKET_ID_PREFIX}${hash(key)}`,
    packetType,
    payloadType,
  };
}
