export interface MeshcoreIoConfig {
  enabled: boolean;
  apiUrl: string;
  dryRun: boolean;
  minReuploadIntervalSeconds: number;
  requestTimeoutMs: number;
  workers: number;
  maxQueuedUploads: number;
  retriesAllowed: number;
  retryDelayMs: number;
  ingressDedupMs: number;
}

export interface RadioParams {
  freq?: number;
  cr?: number;
  sf?: number;
  bw?: number;
}

export interface ObserverRadioState {
  origin?: string;
  originId: string;
  params: RadioParams;
  updatedAt: number;
}

export interface MeshcoreIoUploadJob {
  requestId: string;
  retriesAllowed: number;
  advertKey: string;
  advertTimestamp: number;
  advertType: string;
  nodeName: string;
  nodePublicKey: string;
  rawPacketHex: string;
  observerId: string;
  observerName?: string;
  latitude?: number;
  longitude?: number;
  radioParams: Required<RadioParams>;
  enqueuedAt: number;
}

export type MeshcoreIoPosterResult =
  | {
      status: "handled";
      responseFromMeshcoreIO?: string;
    }
  | { status: "retry"; error: unknown };
