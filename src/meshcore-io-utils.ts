import type {
  RadioParams,
  MeshcoreIoIngressMessage,
  MeshcoreIoUploadJob,
  ObserverRadioState,
} from "./meshcore-io-types.js";

const HEX_RE = /^[0-9a-f]+$/i;
const PUBLIC_KEY_HEX_RE = /^[0-9a-f]{64}$/i;
const MQTT_MESSAGE_TYPES = new Set(["status", "raw", "packets"]);
const MAX_MQTT_PAYLOAD_BYTES = 16 * 1024;
const MAX_PACKET_HEX_CHARS = 1024;

export const MESHCORE_IO_UPLOADABLE_ADVERT_TYPES = new Set([
  "REPEATER",
  "ROOM",
  "SENSOR",
]);
export const MESHCORE_IO_OBSERVER_TTL_MS = 24 * 60 * 60 * 1000;
export const MESHCORE_IO_SEEN_ADVERT_TTL_SECONDS = 72 * 60 * 60;
export const MESHCORE_IO_VALID_ADVERT_COOLDOWN_MS = 60 * 60 * 1000;

function normalizeHex(value: string): string {
  return value.trim().replace(/^0x/i, "").replace(/\s+/g, "").toLowerCase();
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function meshcoreIoReadString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

export function sanitizeMeshcoreIoText(
  value: unknown,
  maxLength = 200,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return sanitized || undefined;
}

function isHexPublicKey(value: string): boolean {
  return PUBLIC_KEY_HEX_RE.test(value);
}

export function parseMeshcoreIoJson(payload: Buffer): unknown {
  try {
    return JSON.parse(payload.toString("utf8"));
  } catch {
    return null;
  }
}

function normalizeFrequencyToMHz(value: number): number {
  if (value > 10_000_000) {
    return value / 1_000_000;
  }

  if (value > 10_000) {
    return value / 1_000;
  }

  return value;
}

function normalizeBandwidthToKHz(value: number): number {
  return value > 1_000 ? value / 1_000 : value;
}

function parseRadioString(radio: string | undefined): RadioParams {
  if (!radio) {
    return {};
  }

  const commaSeparated = radio.match(
    /^\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*$/,
  );
  if (commaSeparated) {
    return {
      freq: normalizeFrequencyToMHz(Number(commaSeparated[1])),
      bw: normalizeBandwidthToKHz(Number(commaSeparated[2])),
      sf: Number(commaSeparated[3]),
      cr: Number(commaSeparated[4]),
    };
  }

  const params: RadioParams = {};
  const freq = radio.match(/([0-9]+(?:\.[0-9]+)?)\s*MHz/i);
  const bw = radio.match(/\bBW\s*([0-9]+(?:\.[0-9]+)?)/i);
  const sf = radio.match(/\bSF\s*([0-9]+)/i);
  const cr = radio.match(/\bCR\s*([0-9]+)/i);

  if (freq) params.freq = Number(freq[1]);
  if (bw) params.bw = Number(bw[1]);
  if (sf) params.sf = Number(sf[1]);
  if (cr) params.cr = Number(cr[1]);

  return params;
}

export function parseMeshcoreIoRadioParams(
  data: Record<string, unknown>,
): RadioParams {
  const directParams =
    typeof data.params === "object" && data.params !== null
      ? (data.params as Record<string, unknown>)
      : data;

  const radioFromFields: RadioParams = {
    freq: toNumber(
      directParams.freq ?? directParams.frequency ?? directParams.radioFreq,
    ),
    cr: toNumber(
      directParams.cr ?? directParams.codingRate ?? directParams.radioCr,
    ),
    sf: toNumber(
      directParams.sf ?? directParams.spreadingFactor ?? directParams.radioSf,
    ),
    bw: toNumber(
      directParams.bw ?? directParams.bandwidth ?? directParams.radioBw,
    ),
  };

  if (radioFromFields.freq !== undefined) {
    radioFromFields.freq = normalizeFrequencyToMHz(radioFromFields.freq);
  }

  if (radioFromFields.bw !== undefined) {
    radioFromFields.bw = normalizeBandwidthToKHz(radioFromFields.bw);
  }

  return {
    ...parseRadioString(meshcoreIoReadString(data.radio)),
    ...Object.fromEntries(
      Object.entries(radioFromFields).filter(
        ([, value]) => value !== undefined,
      ),
    ),
  };
}

function roundToDecimalPlaces(value: number, decimalPlaces: number): number {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function buildMeshcoreIoUploadParams(params: RadioParams): RadioParams {
  const result = Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && Number.isFinite(value),
    ),
  ) as RadioParams;

  if (result.freq !== undefined) {
    result.freq = roundToDecimalPlaces(result.freq, 3);
  }

  return result;
}

export function hasCompleteMeshcoreIoParams(
  params: RadioParams,
): params is Required<RadioParams> {
  return [params.freq, params.bw, params.sf, params.cr].every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
}

export function hasValidMeshcoreIoParams(
  params: RadioParams,
): params is Required<RadioParams> {
  return (
    hasCompleteMeshcoreIoParams(params) &&
    params.freq >= 100 &&
    params.freq <= 1000 &&
    params.bw > 0 &&
    params.bw <= 1000 &&
    params.sf >= 5 &&
    params.sf <= 12 &&
    params.cr >= 4 &&
    params.cr <= 8
  );
}

export function getMeshcoreIoTopicType(topic: string): string | undefined {
  const parts = topic.split("/");
  if (parts[0] !== "meshcore" || parts.length < 4) {
    return undefined;
  }

  return MQTT_MESSAGE_TYPES.has(parts[3]) ? parts[3] : undefined;
}

function findObserverIdInTopic(topic: string): string | undefined {
  return topic.split("/").find(isHexPublicKey);
}

export function readMeshcoreIoObserverId(
  data: Record<string, unknown>,
  topic: string,
): string | undefined {
  const originId = meshcoreIoReadString(data.origin_id);
  if (originId && isHexPublicKey(originId)) {
    return originId.toLowerCase();
  }

  return findObserverIdInTopic(topic)?.toLowerCase();
}

function getPayloadHex(
  data: unknown,
  type: "raw" | "packets",
): string | undefined {
  if (typeof data === "string") {
    return normalizeHex(data);
  }

  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const obj = data as Record<string, unknown>;
  const value =
    type === "packets"
      ? (obj.raw ?? obj.packet ?? obj.payload ?? obj.data)
      : (obj.data ?? obj.raw ?? obj.packet ?? obj.payload);
  return typeof value === "string" ? normalizeHex(value) : undefined;
}

export function buildMeshcoreIoPacketCandidate(
  topic: string,
  payload: Buffer,
  type: "raw" | "packets",
): { rawPacket: Buffer; observerId: string } | null {
  if (payload.length > MAX_MQTT_PAYLOAD_BYTES) {
    return null;
  }

  const parsed = parseMeshcoreIoJson(payload);
  const hex = getPayloadHex(parsed ?? payload.toString("utf8"), type);
  if (
    !hex ||
    hex.length < 2 ||
    hex.length % 2 !== 0 ||
    !HEX_RE.test(hex) ||
    hex.length > MAX_PACKET_HEX_CHARS
  ) {
    return null;
  }

  const observerId =
    typeof parsed === "object" && parsed !== null
      ? readMeshcoreIoObserverId(parsed as Record<string, unknown>, topic)
      : findObserverIdInTopic(topic)?.toLowerCase();

  if (!observerId) {
    return null;
  }

  return { rawPacket: Buffer.from(hex, "hex"), observerId };
}

export function parseMeshcoreIoIngressMessage(
  fields: Record<string, string>,
): MeshcoreIoIngressMessage | undefined {
  const topic = fields.topic;
  const payloadBase64 = fields.payload;
  const receivedAt = Number(fields.receivedAt);
  if (!topic || !payloadBase64 || !Number.isFinite(receivedAt)) {
    return undefined;
  }

  return { topic, payloadBase64, receivedAt };
}

export function parseObserverRadioState(
  value: string | null,
): ObserverRadioState | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as ObserverRadioState;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.originId !== "string" ||
      typeof parsed.updatedAt !== "number" ||
      !hasValidMeshcoreIoParams(parsed.params)
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function parseMeshcoreIoUploadJob(
  value: string | undefined,
): MeshcoreIoUploadJob | undefined {
  if (!value) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const job = parsed as Record<string, unknown>;
  const requestId = meshcoreIoReadString(job.requestId);
  const advertKey = meshcoreIoReadString(job.advertKey);
  const advertType = meshcoreIoReadString(job.advertType)?.toUpperCase();
  const nodeName = sanitizeMeshcoreIoText(job.nodeName);
  const nodePublicKey = meshcoreIoReadString(job.nodePublicKey)?.toLowerCase();
  const rawPacketHex = meshcoreIoReadString(job.rawPacketHex)?.toLowerCase();
  const observerId = meshcoreIoReadString(job.observerId)?.toLowerCase();
  const observerName = sanitizeMeshcoreIoText(job.observerName);
  const latitude = toNumber(job.latitude);
  const longitude = toNumber(job.longitude);
  const retriesAllowed = toNumber(job.retriesAllowed);
  const advertTimestamp = toNumber(job.advertTimestamp);
  const enqueuedAt = toNumber(job.enqueuedAt);
  const radioParams =
    typeof job.radioParams === "object" && job.radioParams !== null
      ? buildMeshcoreIoUploadParams(job.radioParams)
      : {};

  if (
    !requestId ||
    requestId.length > 200 ||
    !advertKey ||
    !advertType ||
    !MESHCORE_IO_UPLOADABLE_ADVERT_TYPES.has(advertType) ||
    !nodeName ||
    nodeName.length > 200 ||
    !nodePublicKey ||
    !PUBLIC_KEY_HEX_RE.test(nodePublicKey) ||
    !rawPacketHex ||
    rawPacketHex.length > MAX_PACKET_HEX_CHARS ||
    rawPacketHex.length % 2 !== 0 ||
    !HEX_RE.test(rawPacketHex) ||
    !observerId ||
    !PUBLIC_KEY_HEX_RE.test(observerId) ||
    retriesAllowed === undefined ||
    !Number.isInteger(retriesAllowed) ||
    retriesAllowed < 1 ||
    retriesAllowed > 100 ||
    advertTimestamp === undefined ||
    !Number.isInteger(advertTimestamp) ||
    advertTimestamp < 0 ||
    enqueuedAt === undefined ||
    !Number.isFinite(enqueuedAt) ||
    enqueuedAt < 0 ||
    (latitude !== undefined &&
      (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
    (longitude !== undefined &&
      (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) ||
    (latitude === undefined) !== (longitude === undefined) ||
    !hasValidMeshcoreIoParams(radioParams) ||
    advertKey !== `${nodePublicKey}:${advertTimestamp}`
  ) {
    return undefined;
  }

  return {
    requestId,
    retriesAllowed,
    advertKey,
    advertTimestamp,
    advertType,
    nodeName,
    nodePublicKey,
    rawPacketHex,
    observerId,
    observerName,
    ...(latitude !== undefined && longitude !== undefined
      ? { latitude, longitude }
      : {}),
    radioParams,
    enqueuedAt,
  };
}

export function formatMeshcoreIoError(error: unknown): string {
  const value =
    error instanceof Error ? error.message || error.name : String(error);
  return (
    value
      .replace(/[\r\n\t]+/g, " ")
      .trim()
      .slice(0, 500) || "okänt fel"
  );
}
