import type { Client } from "aedes";

export interface MeshAedesClient extends Client {
  publicKey?: string;
  nodeName?: string;
  clientType?: "subscriber" | "publisher";
  username?: string;
  role?: number;
  connectedAt?: number;
}
