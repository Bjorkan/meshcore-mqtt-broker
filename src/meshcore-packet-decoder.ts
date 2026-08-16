import {
  MeshCoreDecoder as LibraryMeshCoreDecoder,
  Utils,
  type CryptoKeyStore,
  type DecodedPacket,
} from "@michaelhart/meshcore-decoder";
import decoderPackage from "@michaelhart/meshcore-decoder/package.json" with { type: "json" };

export type DecodeStatus =
  | "not_attempted"
  | "decoded"
  | "partially_decoded"
  | "unknown_type"
  | "invalid_packet"
  | "decoder_error";

export interface MeshCoreDecodeResult {
  status: DecodeStatus;
  error?: string;
  packetType?: string;
  packetTypeCode?: number;
  payloadType?: string;
  payloadTypeCode?: number;
  routeType?: string;
  decoded?: DecodedPacket;
}

export interface MeshCorePacketDecoder {
  readonly name: string;
  readonly version: string;
  decode(packet: Buffer): Promise<MeshCoreDecodeResult>;
}

const PACKET_TYPES = new Map<number, string>([
  [0x00, "REQUEST"],
  [0x01, "RESPONSE"],
  [0x02, "TXT_MSG"],
  [0x03, "ACK"],
  [0x04, "ADVERT"],
  [0x05, "GRP_TXT"],
  [0x06, "GRP_DATA"],
  [0x07, "ANON_REQ"],
  [0x08, "PATH"],
  [0x09, "TRACE"],
  [0x0a, "MULTIPART"],
  [0x0b, "CONTROL"],
  [0x0f, "RAW_CUSTOM"],
]);

function cleanError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 1_000);
}

export class DefaultMeshCorePacketDecoder implements MeshCorePacketDecoder {
  readonly name = "@michaelhart/meshcore-decoder";
  readonly version = decoderPackage.version;
  private readonly keyStore?: CryptoKeyStore;

  constructor(keyStore?: CryptoKeyStore) {
    this.keyStore = keyStore;
  }

  async decode(packet: Buffer): Promise<MeshCoreDecodeResult> {
    try {
      const decoded = await LibraryMeshCoreDecoder.decodeWithVerification(
        packet.toString("hex"),
        this.keyStore ? { keyStore: this.keyStore } : undefined,
      );
      const packetType = PACKET_TYPES.get(decoded.payloadType);
      const routeType = Utils.getRouteTypeName(decoded.routeType).toUpperCase();
      const payloadType = Utils.getPayloadTypeName(
        decoded.payloadType,
      ).toUpperCase();
      const errors = decoded.errors?.join("; ");

      if (!decoded.isValid) {
        return {
          status: "invalid_packet",
          error: errors || "Decoder marked packet invalid",
          packetType: packetType ?? "UNKNOWN",
          packetTypeCode: decoded.payloadType,
          payloadType,
          payloadTypeCode: decoded.payloadType,
          routeType,
          decoded,
        };
      }
      if (!packetType) {
        return {
          status: "unknown_type",
          error: `Unknown MeshCore packet type ${decoded.payloadType}`,
          packetType: "UNKNOWN",
          packetTypeCode: decoded.payloadType,
          payloadType,
          payloadTypeCode: decoded.payloadType,
          routeType,
          decoded,
        };
      }

      return {
        status:
          decoded.payload.decoded === null || errors
            ? "partially_decoded"
            : "decoded",
        ...(errors ? { error: errors } : {}),
        packetType,
        packetTypeCode: decoded.payloadType,
        payloadType,
        payloadTypeCode: decoded.payloadType,
        routeType,
        decoded,
      };
    } catch (error) {
      return { status: "decoder_error", error: cleanError(error) };
    }
  }
}
