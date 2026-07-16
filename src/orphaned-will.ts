import type { PublishPacket } from "aedes";

const MAX_DIAGNOSTIC_FIELD_LENGTH = 512;

interface PersistedWillMetadata {
  clientId?: unknown;
  brokerId?: unknown;
}

export interface QuarantinedWillDetails {
  originalTopic: string;
  clientId?: string;
  brokerId?: string;
  quarantineTopic: string;
}

function diagnosticString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value.slice(0, MAX_DIAGNOSTIC_FIELD_LENGTH);
}

/**
 * Aedes invokes authorizePublish with client=null when recovering an obsolete
 * Last Will from shared persistence after the originating broker disappeared.
 * Without the authenticated client, the original topic and payload cannot be
 * authorized safely. Replace the packet with a small broker-owned diagnostic
 * event so Aedes can finish its recovery flow and delete the persisted will
 * without publishing the unverified client payload.
 */
export function quarantineOrphanedWill(
  packet: PublishPacket,
  instanceId: string,
): QuarantinedWillDetails {
  const persisted = packet as PublishPacket & PersistedWillMetadata;
  const originalTopic = diagnosticString(packet.topic) ?? "<invalid>";
  const clientId = diagnosticString(persisted.clientId);
  const brokerId = diagnosticString(persisted.brokerId);
  const safeInstanceId = instanceId.replace(/[^A-Za-z0-9._-]/g, "_");
  const quarantineTopic = `$SYS/${safeInstanceId}/discarded-wills`;

  packet.topic = quarantineTopic;
  packet.payload = Buffer.from(
    JSON.stringify({
      reason: "orphaned-will-without-authenticated-client",
      originalTopic,
      ...(clientId ? { clientId } : {}),
      ...(brokerId ? { brokerId } : {}),
    }),
  );
  packet.qos = 0;
  packet.retain = false;
  packet.dup = false;

  return {
    originalTopic,
    clientId,
    brokerId,
    quarantineTopic,
  };
}
