export interface MeshcoreIoConfig {
  enabled: boolean;
  apiUrl: string;
  dryRun: boolean;
  minReuploadIntervalSeconds: number;
  requestTimeoutMs: number;
  workersPerBroker: number;
  maxQueuedUploads: number;
  retriesAllowed: number;
  retryDelayMs: number;
  producerLeaseMs: number;
  producerPollMs: number;
  ingressDedupMs: number;
  workerClaimTimeoutMs: number;
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

export interface MeshcoreIoIngressMessage {
  topic: string;
  payloadBase64: string;
  receivedAt: number;
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

export interface MeshcoreIoWorkerStatus {
  instanceId: string;
  configuredWorkers: number;
  activeUploads: number;
  uploadsSucceeded: number;
  uploadsFailed: number;
  lastUploadAt?: number;
  lastError?: string;
  updatedAt: number;
}

export interface MeshcoreIoHistoryEntry {
  at: number;
  status: "uploaded" | "dropped";
  requestId: string;
  nodeName: string;
  nodePublicKey: string;
  advertType: string;
  observerName?: string;
  workerInstanceId: string;
  detail?: string;
}

export interface MeshcoreIoMapAdvert {
  at: number;
  requestId: string;
  nodeName: string;
  nodePublicKey: string;
  advertType: string;
  observerName?: string;
  workerInstanceId: string;
  latitude: number;
  longitude: number;
}

export interface MeshcoreIoDashboardSnapshot {
  enabled: boolean;
  producer: {
    instanceId?: string;
    respondingBrokerIsProducer: boolean;
    leaseRemainingMs: number;
    status: "disabled" | "healthy" | "electing" | "stale";
  };
  queue: {
    ingressPending: number;
    queued: number;
    active: number;
    total: number;
    maxQueuedUploads: number;
  };
  totals: {
    enqueued: number;
    uploaded: number;
    dropped: number;
    invalid: number;
    retries: number;
  };
  workers: MeshcoreIoWorkerStatus[];
  history: MeshcoreIoHistoryEntry[];
  map: {
    advertsLast7Days: MeshcoreIoMapAdvert[];
  };
  lastError?: string;
}
