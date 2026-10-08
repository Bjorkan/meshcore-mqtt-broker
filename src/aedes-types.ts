import type { Client } from "aedes";

export interface MeshAedesClient extends Client {
  publicKey?: string;
  nodeName?: string;
  clientType?: "subscriber" | "publisher";
  username?: string;
  role?: number;
  connectedAt?: number;
  /** Aedes' packet-completion hook; wrapped to consume fork-local nonfatal denials. */
  _nextBatch?: (error?: Error | null) => void;
}
