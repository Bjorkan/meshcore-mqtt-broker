import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Advert, BufferUtils, Packet } from "@liamcottle/meshcore.js";
import { Utils } from "@michaelhart/meshcore-decoder";

export interface MapUploaderConfig {
  enabled: boolean;
  publicKey: string;
  privateKey: string;
  apiUrl: string;
  minReuploadIntervalSeconds: number;
  requestTimeoutMs: number;
  retryCooldownMs: number;
  requireCompleteRadioParams: boolean;
}

export interface MapUploaderDependencies {
  fetch?: typeof fetch;
  now?: () => number;
}

interface RadioParams {
  freq?: number;
  cr?: number;
  sf?: number;
  bw?: number;
}

interface ObserverState {
  origin?: string;
  originId?: string;
  model?: string;
  firmwareVersion?: string;
  clientVersion?: string;
  radio?: string;
  params: RadioParams;
  updatedAt: number;
}

interface PacketCandidate {
  rawPacket: Buffer;
  observerId?: string;
}

interface SignedRequest {
  data: string;
  signature: string;
  publicKey: string;
}

type SigningMode = "seed" | "meshcore-private-key";

const HEX_RE = /^[0-9a-f]+$/i;
const PUBLIC_KEY_HEX_RE = /^[0-9a-f]{64}$/i;
const MQTT_MESSAGE_TYPES = new Set(["status", "raw", "packets"]);
const UPLOADABLE_ADVERT_TYPES = new Set(["REPEATER", "ROOM", "SENSOR"]);
const MAX_MQTT_PAYLOAD_BYTES = 16 * 1024;
const MAX_PACKET_HEX_CHARS = 1024;
const MAX_LOG_BODY_CHARS = 500;
const OBSERVER_TTL_MS = 24 * 60 * 60 * 1000;
const SEEN_ADVERT_TTL_SECONDS = 72 * 60 * 60;

function normalizeHex(value: string): string {
  return value.trim().replace(/^0x/i, "").replace(/\s+/g, "").toLowerCase();
}

function hexToBuffer(value: string, expectedBytes: number, label: string): Buffer {
  const hex = normalizeHex(value);
  if (hex.length !== expectedBytes * 2 || !HEX_RE.test(hex)) {
    throw new Error(`${label} måste vara ${expectedBytes} byte hex`);
  }

  return Buffer.from(hex, "hex");
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isHexPublicKey(value: string): boolean {
  return PUBLIC_KEY_HEX_RE.test(value);
}

function parseJsonPayload(payload: Buffer): unknown | null {
  try {
    return JSON.parse(payload.toString("utf8"));
  } catch {
    return null;
  }
}

function parseRadioString(radio: string | undefined): RadioParams {
  if (!radio) {
    return {};
  }

  const commaSeparated = radio.match(
    /^\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*$/
  );
  if (commaSeparated) {
    return {
      freq: Number(commaSeparated[1]),
      bw: Number(commaSeparated[2]),
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

function parseRadioParams(data: Record<string, unknown>): RadioParams {
  const directParams = typeof data.params === "object" && data.params !== null
    ? data.params as Record<string, unknown>
    : data;

  const radioFromFields: RadioParams = {
    freq: toNumber(directParams.freq ?? directParams.frequency ?? directParams.radioFreq),
    cr: toNumber(directParams.cr ?? directParams.codingRate ?? directParams.radioCr),
    sf: toNumber(directParams.sf ?? directParams.spreadingFactor ?? directParams.radioSf),
    bw: toNumber(directParams.bw ?? directParams.bandwidth ?? directParams.radioBw),
  };

  // Observer-firmwaren kan rapportera Hz/kHz/MHz. Kartuppladdaren skickar MHz/kHz.
  if (radioFromFields.freq !== undefined) {
    radioFromFields.freq = normalizeFrequencyToMHz(radioFromFields.freq);
  }

  if (radioFromFields.bw !== undefined && radioFromFields.bw > 1_000) {
    radioFromFields.bw = normalizeBandwidthToKHz(radioFromFields.bw);
  }

  return {
    ...parseRadioString(readString(data.radio)),
    ...Object.fromEntries(
      Object.entries(radioFromFields).filter(([, value]) => value !== undefined)
    ),
  };
}

function getTopicType(topic: string): string | undefined {
  const parts = topic.split("/");
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (MQTT_MESSAGE_TYPES.has(parts[index])) {
      return parts[index];
    }
  }

  return undefined;
}

function findObserverIdInTopic(topic: string): string | undefined {
  return topic.split("/").find(isHexPublicKey);
}

function readObserverId(data: Record<string, unknown>, topic: string): string | undefined {
  const originId = readString(data.origin_id);
  if (originId) {
    if (isHexPublicKey(originId)) {
      return originId.toLowerCase();
    }

    console.warn(`Kartuppladdning: ignorerar ogiltigt origin_id ${originId}`);
  }

  return findObserverIdInTopic(topic)?.toLowerCase();
}

function getPayloadHex(data: unknown, type: "raw" | "packets"): string | undefined {
  if (typeof data === "string") {
    return normalizeHex(data);
  }

  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const obj = data as Record<string, unknown>;
  const value = type === "packets"
    ? obj.raw ?? obj.packet ?? obj.payload ?? obj.data
    : obj.data ?? obj.raw ?? obj.packet ?? obj.payload;
  return typeof value === "string" ? normalizeHex(value) : undefined;
}

function isLikelyHexPacket(hex: string | undefined): hex is string {
  return Boolean(hex && hex.length >= 2 && hex.length % 2 === 0 && HEX_RE.test(hex));
}

function buildPacketCandidate(
  topic: string,
  payload: Buffer,
  type: "raw" | "packets"
): PacketCandidate | null {
  if (payload.length > MAX_MQTT_PAYLOAD_BYTES) {
    console.warn("Kartuppladdning: MQTT-meddelandet är orimligt stort, hoppar över");
    return null;
  }

  const parsed = parseJsonPayload(payload);
  const hex = getPayloadHex(parsed ?? payload.toString("utf8"), type);
  if (!isLikelyHexPacket(hex)) {
    return null;
  }

  if (hex.length > MAX_PACKET_HEX_CHARS) {
    console.warn("Kartuppladdning: pakethex är orimligt långt, hoppar över");
    return null;
  }

  const observerId = typeof parsed === "object" && parsed !== null
    ? readObserverId(parsed as Record<string, unknown>, topic)
    : findObserverIdInTopic(topic)?.toLowerCase();

  if (!observerId) {
    console.warn("Kartuppladdning: MQTT-paket saknar giltigt observer-ID, hoppar över");
    return null;
  }

  return {
    rawPacket: Buffer.from(hex, "hex"),
    observerId,
  };
}

function buildParams(params: RadioParams): RadioParams {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && Number.isFinite(value))
  ) as RadioParams;
}

function hasCompleteParams(params: RadioParams): params is Required<RadioParams> {
  return [params.freq, params.bw, params.sf, params.cr].every(
    (value) => typeof value === "number" && Number.isFinite(value)
  );
}

function hasValidParams(params: RadioParams): params is Required<RadioParams> {
  return hasCompleteParams(params)
    && params.freq >= 100
    && params.freq <= 1000
    && params.bw > 0
    && params.bw <= 1000
    && params.sf >= 5
    && params.sf <= 12
    && params.cr >= 4
    && params.cr <= 8;
}

function trimLogBody(value: string): string {
  return value.length > MAX_LOG_BODY_CHARS
    ? `${value.slice(0, MAX_LOG_BODY_CHARS)}...`
    : value;
}

export class MeshcoreMapUploader {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly publicKey: Buffer;
  private readonly publicKeyHex: string;
  private readonly privateKeyHex: string;
  private readonly privateSeed?: Buffer;
  private readonly signingMode: SigningMode;
  private readonly inFlightAdverts = new Set<string>();
  private readonly lastAttemptByAdvert = new Map<string, number>();
  private readonly seenAdverts = new Map<string, number>();
  private readonly observers = new Map<string, ObserverState>();
  readonly ready: Promise<void>;

  constructor(
    private readonly config: MapUploaderConfig,
    dependencies: MapUploaderDependencies = {}
  ) {
    this.fetchImpl = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.publicKey = hexToBuffer(config.publicKey, 32, "MESHCOREIO_PUBKEY");
    this.publicKeyHex = this.publicKey.toString("hex");

    const privateHex = normalizeHex(config.privateKey);
    if (![64, 128].includes(privateHex.length) || !HEX_RE.test(privateHex)) {
      throw new Error("MESHCOREIO_PRIVATEKEY måste vara 32 eller 64 byte hex");
    }

    this.privateKeyHex = privateHex;
    if (privateHex.length === 64) {
      // 32 byte används som vanlig Ed25519-seed i tester och enklare integrationer.
      this.signingMode = "seed";
      this.privateSeed = Buffer.from(privateHex, "hex");
      const derivedPublicKey = Buffer.from(ed25519.getPublicKey(this.privateSeed));
      if (!derivedPublicKey.equals(this.publicKey)) {
        throw new Error("MESHCOREIO_PUBKEY matchar inte MESHCOREIO_PRIVATEKEY");
      }
      this.ready = Promise.resolve();
    } else {
      // MeshCore exporterar 64 byte i orlp/ed25519-format, inte seed+pubkey.
      // Därför måste vi härleda och signera med samma MeshCore-kompatibla WASM-kod som brokern använder.
      this.signingMode = "meshcore-private-key";
      this.ready = this.verifyMeshcorePrivateKey();
    }
  }

  private async verifyMeshcorePrivateKey(): Promise<void> {
    const derivedPublicKey = normalizeHex(await Utils.derivePublicKey(this.privateKeyHex));
    if (derivedPublicKey !== this.publicKeyHex) {
      throw new Error("MESHCOREIO_PUBKEY matchar inte MESHCOREIO_PRIVATEKEY");
    }
  }

  handleMqttMessage(topic: string, payload: Buffer): void {
    this.processMqttMessage(topic, payload).catch((err: Error) => {
      console.error("Kartuppladdning misslyckades:", err.message);
    });
  }

  async processMqttMessage(topic: string, payload: Buffer): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    this.cleanupState();

    const type = getTopicType(topic);
    if (type === "status") {
      this.rememberStatus(topic, payload);
      return;
    }

    if (type !== "raw" && type !== "packets") {
      return;
    }

    const candidate = buildPacketCandidate(topic, payload, type);
    if (!candidate) {
      return;
    }

    await this.processPacket(candidate);
  }

  private rememberStatus(topic: string, payload: Buffer): void {
    const parsed = parseJsonPayload(payload);
    if (typeof parsed !== "object" || parsed === null) {
      console.warn(`Kartuppladdning: status på ${topic} är inte JSON, hoppar över`);
      return;
    }

    const data = parsed as Record<string, unknown>;
    const originId = readObserverId(data, topic);
    if (!originId) {
      console.warn("Kartuppladdning: status saknar giltigt observer-ID, kan inte spara radiodata");
      return;
    }

    const previous = this.observers.get(originId);
    const parsedParams = parseRadioParams(data);
    const parsedComplete = hasCompleteParams(parsedParams);
    const parsedValid = hasValidParams(parsedParams);
    const status = readString(data.status)?.toLowerCase();
    if (status === "offline" && !parsedValid && previous) {
      this.observers.set(originId, {
        ...previous,
        origin: readString(data.origin) ?? previous.origin,
        model: readString(data.model) ?? previous.model,
        firmwareVersion: readString(data.firmware_version) ?? previous.firmwareVersion,
        clientVersion: readString(data.client_version) ?? previous.clientVersion,
        radio: readString(data.radio) ?? previous.radio,
      });
      console.log(`Kartuppladdning: offline-status utan radiodata för ${previous.origin ?? originId}, behåller tidigare radio`);
      return;
    }

    if (parsedComplete && !parsedValid) {
      const state: ObserverState = {
        origin: readString(data.origin) ?? previous?.origin,
        originId,
        model: readString(data.model) ?? previous?.model,
        firmwareVersion: readString(data.firmware_version) ?? previous?.firmwareVersion,
        clientVersion: readString(data.client_version) ?? previous?.clientVersion,
        radio: readString(data.radio) ?? previous?.radio,
        params: parsedParams,
        updatedAt: this.now(),
      };

      this.observers.set(originId, state);
      console.warn(
        `Kartuppladdning: ogiltig komplett radio för ${state.origin ?? originId}, blockerar uppladdning tills ny giltig status kommer`
      );
      return;
    }

    const params = parsedValid
      ? parsedParams
      : previous?.params ?? parsedParams;

    const state: ObserverState = {
      origin: readString(data.origin) ?? previous?.origin,
      originId,
      model: readString(data.model) ?? previous?.model,
      firmwareVersion: readString(data.firmware_version) ?? previous?.firmwareVersion,
      clientVersion: readString(data.client_version) ?? previous?.clientVersion,
      radio: readString(data.radio) ?? previous?.radio,
      params,
      updatedAt: this.now(),
    };

    this.observers.set(originId, state);
    console.log(
      `Kartuppladdning: sparade status för ${state.origin ?? originId} med radio ${state.radio ?? "okänd"}`
    );
  }

  private async processPacket(candidate: PacketCandidate): Promise<void> {
    let packet: Packet;
    try {
      packet = Packet.fromBytes(candidate.rawPacket);
    } catch (err) {
      console.warn("Kartuppladdning: kunde inte tolka MQTT-paket som MeshCore-paket");
      return;
    }

    if (packet.payload_type_string !== "ADVERT") {
      return;
    }

    let advert: Advert;
    try {
      advert = Advert.fromBytes(packet.payload);
    } catch {
      console.warn("Kartuppladdning: ADVERT-payload kunde inte tolkas");
      return;
    }

    const pubKey = BufferUtils.bytesToHex(advert.publicKey).toLowerCase();
    const advertType = advert.parsed.type?.toUpperCase() ?? "UNKNOWN";
    const nodeName = advert.parsed.name ?? pubKey.slice(0, 8);

    if (!UPLOADABLE_ADVERT_TYPES.has(advertType)) {
      console.log(`Kartuppladdning: hoppar över ${advertType.toLowerCase()}-advert från ${nodeName}`);
      return;
    }

    const advertKey = this.makeAdvertKey(pubKey, advert.timestamp);
    const previousTimestamp = this.seenAdverts.get(pubKey);
    if (previousTimestamp !== undefined) {
      if (previousTimestamp >= advert.timestamp) {
        console.warn(`Kartuppladdning: ignorerar gammal eller återspelad advert från ${nodeName}`);
        return;
      }

      if (advert.timestamp < previousTimestamp + this.config.minReuploadIntervalSeconds) {
        console.log(`Kartuppladdning: ${nodeName} är redan uppladdad nyligen`);
        return;
      }
    }

    if (!(await advert.isVerified())) {
      console.warn(`Kartuppladdning: ignorerar ${nodeName}, advert-signaturen är ogiltig`);
      return;
    }

    if (this.inFlightAdverts.has(advertKey)) {
      console.log(`Kartuppladdning: ${nodeName} behandlas redan`);
      return;
    }

    this.inFlightAdverts.add(advertKey);
    try {
      const observer = candidate.observerId ? this.observers.get(candidate.observerId) : undefined;
      const params = buildParams(observer?.params ?? {});
      if (this.config.requireCompleteRadioParams && !hasValidParams(params)) {
        console.warn(
          `Kartuppladdning: saknar giltiga radioparametrar för ${candidate.observerId ?? "okänd observer"}, hoppar över ${nodeName}`
        );
        return;
      }

      const now = this.now();
      const lastAttempt = this.lastAttemptByAdvert.get(advertKey);
      if (lastAttempt !== undefined && now - lastAttempt < this.config.retryCooldownMs) {
        console.log(`Kartuppladdning: väntar med retry för ${nodeName}`);
        return;
      }
      this.lastAttemptByAdvert.set(advertKey, now);

      const data = {
        params,
        links: [`meshcore://${BufferUtils.bytesToHex(candidate.rawPacket)}`],
      };

      const requestData = await this.signData(data);
      console.log(
        `Kartuppladdning: skickar ${advertType.toLowerCase()}-advert för ${nodeName} via ${observer?.origin ?? candidate.observerId ?? "okänd observer"}`
      );

      const response = await this.postWithTimeout(requestData);

      if (!response.ok) {
        const responseText = trimLogBody(await response.text().catch(() => ""));
        throw new Error(`map.meshcore.io svarade ${response.status}: ${responseText}`);
      }

      const responseText = trimLogBody(await response.text().catch(() => ""));
      console.log(`Kartuppladdning: map.meshcore.io tog emot ${nodeName}${responseText ? ` (${responseText})` : ""}`);
      this.seenAdverts.set(pubKey, advert.timestamp);
    } finally {
      this.inFlightAdverts.delete(advertKey);
    }
  }

  private async signData(data: unknown): Promise<SignedRequest> {
    await this.ready;

    const json = JSON.stringify(data);
    const hashHex = createHash("sha256").update(json).digest("hex");
    const signature = this.signingMode === "seed"
      ? Buffer.from(ed25519.sign(Buffer.from(hashHex, "hex"), this.privateSeed!)).toString("hex")
      : await Utils.sign(hashHex, this.privateKeyHex, this.publicKeyHex);

    return {
      data: json,
      signature,
      publicKey: this.publicKeyHex,
    };
  }

  private async postWithTimeout(body: SignedRequest): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      return await this.fetchImpl(this.config.apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private makeAdvertKey(pubKey: string, timestamp: number): string {
    return `${pubKey}:${timestamp}`;
  }

  private cleanupState(): void {
    const now = this.now();

    for (const [observerId, observer] of this.observers) {
      if (now - observer.updatedAt > OBSERVER_TTL_MS) {
        this.observers.delete(observerId);
      }
    }

    const oldestAdvertTimestamp = Math.floor(now / 1000) - SEEN_ADVERT_TTL_SECONDS;
    for (const [pubKey, timestamp] of this.seenAdverts) {
      if (timestamp < oldestAdvertTimestamp) {
        this.seenAdverts.delete(pubKey);
      }
    }

    const oldestAttempt = now - Math.max(this.config.retryCooldownMs * 2, 60_000);
    for (const [advertKey, attemptedAt] of this.lastAttemptByAdvert) {
      if (attemptedAt < oldestAttempt) {
        this.lastAttemptByAdvert.delete(advertKey);
      }
    }
  }
}
