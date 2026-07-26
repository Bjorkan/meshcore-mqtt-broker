import type { Client } from "aedes";

export interface MeshAedesClient extends Client {
  publicKey?: string;
  nodeName?: string;
  tokenPayload?: Record<string, unknown>;
  clientType?: "subscriber" | "publisher";
  username?: string;
  role?: number;
  observerClaimed?: boolean;
  connectionLimitScope?: "local";
  subscriberConnectionId?: string;
  subscriberReservationCleanup?: () => void;
  lastRegion?: string;
  connectedAt?: number;
  stream?: unknown;
}
