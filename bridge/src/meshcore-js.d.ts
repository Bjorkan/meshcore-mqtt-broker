declare module "@liamcottle/meshcore.js" {
  export const BufferUtils: {
    bytesToHex(bytes: Uint8Array | Buffer): string;
    hexToBytes(hex: string): Uint8Array;
  };

  export class Packet {
    static fromBytes(bytes: Uint8Array | Buffer): Packet;
    payload_type_string: string | null;
    payload: Uint8Array;
  }

  export class Advert {
    static fromBytes(bytes: Uint8Array | Buffer): Advert;
    publicKey: Uint8Array;
    timestamp: number;
    parsed: {
      type: string | null;
      name: string | null;
      lat: number | null;
      lon: number | null;
      feat1: number | null;
      feat2: number | null;
    };
    isVerified(): Promise<boolean>;
  }
}
