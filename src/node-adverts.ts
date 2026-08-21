import { Advert, BufferUtils, Packet } from "@liamcottle/meshcore.js";
import { getModuleLogger } from "./logger.js";
import {
  buildMeshcoreIoPacketCandidate,
  getMeshcoreIoTopicType,
  sanitizeMeshcoreIoText,
} from "./meshcore-io-utils.js";
import {
  type BrokerStateStore,
  type HeardNodeAdvertInput,
} from "./state-store.js";

const log = getModuleLogger("NodeAdverts");

function advertCoordinates(
  advert: Advert,
): { latitude: number; longitude: number } | undefined {
  if (advert.parsed.lat === null || advert.parsed.lon === null) {
    return undefined;
  }
  const latitude = advert.parsed.lat / 1_000_000;
  const longitude = advert.parsed.lon / 1_000_000;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }
  return { latitude, longitude };
}

export async function decodeHeardNodeAdvert(
  topic: string,
  payload: Buffer,
  heardAt = Date.now(),
): Promise<HeardNodeAdvertInput | undefined> {
  const topicType = getMeshcoreIoTopicType(topic);
  if (topicType !== "packets") return undefined;

  const parts = topic.split("/");
  const region = parts[1]?.toUpperCase();
  if (!region || !/^(?:[A-Z]{3}|TEST)$/.test(region)) return undefined;

  const candidate = buildMeshcoreIoPacketCandidate(topic, payload, topicType);
  if (!candidate) return undefined;

  try {
    const packet = Packet.fromBytes(candidate.rawPacket);
    if (packet.payload_type_string !== "ADVERT") return undefined;
    const advert = Advert.fromBytes(packet.payload);
    if (!(await advert.isVerified())) return undefined;

    const coordinates = advertCoordinates(advert);
    return {
      publicKey: BufferUtils.bytesToHex(advert.publicKey).toUpperCase(),
      advertTimestamp: advert.timestamp,
      advertType: advert.parsed.type?.toUpperCase() ?? "UNKNOWN",
      name: sanitizeMeshcoreIoText(advert.parsed.name, 200),
      latitude: coordinates?.latitude,
      longitude: coordinates?.longitude,
      region,
      observerPublicKey: candidate.observerId.toUpperCase(),
      rawPacket: candidate.rawPacket,
      heardAt,
    };
  } catch {
    return undefined;
  }
}

export class NodeAdvertRecorder {
  private pending = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly stateStore: BrokerStateStore,
    private readonly now: () => number = Date.now,
  ) {}

  offerPublish(topic: string, payload: Buffer): void {
    if (this.stopped) return;
    this.pending = this.pending
      .then(async () => {
        const advert = await decodeHeardNodeAdvert(topic, payload, this.now());
        if (advert) await this.stateStore.recordHeardNodeAdvert(advert);
      })
      .catch((error) => {
        log.error(
          "Kunde inte lagra node-advert:",
          error instanceof Error ? error.message : String(error),
        );
      });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.pending;
  }
}
