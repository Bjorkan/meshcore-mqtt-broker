import type { PublishPacket } from "aedes";

const MAX_DIAGNOSTIC_FIELD_LENGTH = 512;

interface PersistedWillMetadata {
  clientId?: unknown;
  brokerId?: unknown;
}

export interface QuarantinedPublishDetails {
  originalTopic: string;
  clientId?: string;
  brokerId?: string;
  quarantineTopic: string;
}

export type QuarantinedWillDetails = QuarantinedPublishDetails;

function diagnosticString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value.slice(0, MAX_DIAGNOSTIC_FIELD_LENGTH);
}

function safeInstanceId(instanceId: string): string {
  return instanceId.replace(/[^A-Za-z0-9._-]/g, "_");
}

function quarantinePublish(
  packet: PublishPacket,
  instanceId: string,
  category: "discarded-wills" | "discarded-status",
  reason: string,
  metadata: Record<string, unknown> = {},
): QuarantinedPublishDetails {
  const persisted = packet as PublishPacket & PersistedWillMetadata;
  const originalTopic = diagnosticString(packet.topic) ?? "<invalid>";
  const clientId =
    diagnosticString(metadata.clientId) ?? diagnosticString(persisted.clientId);
  const brokerId = diagnosticString(persisted.brokerId);
  const quarantineTopic = `$SYS/${safeInstanceId(instanceId)}/${category}`;

  const diagnosticMetadata = Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) => {
      if (key === "clientId") return [];
      const sanitized = diagnosticString(value);
      return sanitized ? [[key, sanitized]] : [];
    }),
  );

  packet.topic = quarantineTopic;
  packet.payload = Buffer.from(
    JSON.stringify({
      reason,
      originalTopic,
      ...(clientId ? { clientId } : {}),
      ...(brokerId ? { brokerId } : {}),
      ...diagnosticMetadata,
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
  return quarantinePublish(
    packet,
    instanceId,
    "discarded-wills",
    "orphaned-will-without-authenticated-client",
  );
}

/**
 * Stale status packets are intentionally discarded. Returning an authorization
 * error is unsafe for persisted Last Wills because Aedes' heartbeat cleanup
 * promisifies authorizePublish and lets the rejection escape its timer. A
 * broker-owned $SYS packet preserves a bounded diagnostic while ensuring the
 * stale client payload is never delivered on its original MeshCore topic.
 */
export function quarantineStaleStatus(
  packet: PublishPacket,
  instanceId: string,
  metadata: { clientId?: string; statusTimestamp?: string } = {},
): QuarantinedPublishDetails {
  return quarantinePublish(
    packet,
    instanceId,
    "discarded-status",
    "stale-status-message",
    metadata,
  );
}
