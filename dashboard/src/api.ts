import type { DashboardSnapshot } from "./types.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isObserverMessage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.topic === "string" &&
    typeof value.broker === "string" &&
    isOptionalString(value.region) &&
    isOptionalString(value.observer) &&
    isOptionalString(value.publicKey) &&
    isOptionalString(value.subtopic) &&
    isFiniteNumber(value.bytes) &&
    isFiniteNumber(value.receivedAt)
  );
}

function isNeighborsSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.receivedAt) &&
    isOptionalNumber(value.reportedAt) &&
    isStringArray(value.selfScopes) &&
    isFiniteNumber(value.invalidEntryCount) &&
    Array.isArray(value.neighbors) &&
    value.neighbors.every(
      (neighbor) =>
        isRecord(neighbor) &&
        typeof neighbor.publicKey === "string" &&
        isFiniteNumber(neighbor.snr) &&
        isFiniteNumber(neighbor.heardSecsAgo) &&
        isStringArray(neighbor.scopes) &&
        ["responded", "timeout", "send_failed"].includes(
          String(neighbor.status),
        ),
    )
  );
}

function isObserver(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const abuse = value.abuse;
  return (
    typeof value.label === "string" &&
    typeof value.publicKey === "string" &&
    typeof value.broker === "string" &&
    isOptionalString(value.region) &&
    typeof value.active === "boolean" &&
    isFiniteNumber(value.lastConnectedAt) &&
    isFiniteNumber(value.lastSeenAt) &&
    isFiniteNumber(value.messageCount) &&
    Array.isArray(value.messages) &&
    value.messages.every(isObserverMessage) &&
    (value.neighbors === undefined || isNeighborsSnapshot(value.neighbors)) &&
    (abuse === undefined ||
      (isRecord(abuse) &&
        ["muted", "would_mute", "denied"].includes(String(abuse.status)) &&
        typeof abuse.reason === "string" &&
        isFiniteNumber(abuse.blockCount) &&
        isOptionalNumber(abuse.mutedUntil) &&
        typeof abuse.broker === "string" &&
        isOptionalString(abuse.deniedUntilText)))
  );
}

function isBan(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isOptionalString(value.eventId) &&
    typeof value.node === "string" &&
    isOptionalString(value.label) &&
    typeof value.broker === "string" &&
    typeof value.reason === "string" &&
    isFiniteNumber(value.blockCount) &&
    isOptionalNumber(value.mutedUntil) &&
    ["muted", "would_mute", "denied"].includes(String(value.status)) &&
    isOptionalNumber(value.lastUpdatedAt) &&
    isOptionalString(value.topic) &&
    isOptionalString(value.region) &&
    isOptionalString(value.deniedUntilText)
  );
}

function isSubscriber(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.username === "string" &&
    isFiniteNumber(value.connectionCount) &&
    isFiniteNumber(value.lastSeenAt) &&
    isStringArray(value.subscriptions) &&
    typeof value.subscriptionsTruncated === "boolean" &&
    Array.isArray(value.brokers) &&
    value.brokers.every(
      (broker) =>
        isRecord(broker) &&
        typeof broker.brokerId === "string" &&
        isFiniteNumber(broker.connectionCount) &&
        isFiniteNumber(broker.lastSeenAt) &&
        isStringArray(broker.subscriptions) &&
        typeof broker.subscriptionsTruncated === "boolean",
    ) &&
    Array.isArray(value.connections) &&
    value.connections.every(
      (connection) =>
        isRecord(connection) &&
        typeof connection.clientId === "string" &&
        typeof connection.brokerId === "string" &&
        isFiniteNumber(connection.lastSeenAt) &&
        isStringArray(connection.subscriptions) &&
        typeof connection.subscriptionsTruncated === "boolean",
    )
  );
}

function isBroker(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const bridge = value.targetBridge;
  return (
    typeof value.instanceId === "string" &&
    isFiniteNumber(value.startedAt) &&
    isFiniteNumber(value.connectedClients) &&
    isFiniteNumber(value.publisherClients) &&
    isFiniteNumber(value.claimedObservers) &&
    isFiniteNumber(value.messagesPerSecond) &&
    isFiniteNumber(value.messagesLastMinute) &&
    typeof value.ready === "boolean" &&
    ["healthy", "stale"].includes(String(value.status)) &&
    isFiniteNumber(value.lastUpdateAgeMs) &&
    (bridge === undefined ||
      (isRecord(bridge) &&
        typeof bridge.enabled === "boolean" &&
        typeof bridge.connected === "boolean" &&
        isOptionalString(bridge.targetUrl) &&
        isOptionalString(bridge.targetHost) &&
        isOptionalString(bridge.clientId) &&
        isFiniteNumber(bridge.droppedMessages) &&
        isFiniteNumber(bridge.successfulMessages)))
  );
}

function isMeshcoreIoSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const processor = value.processor;
  const queue = value.queue;
  const totals = value.totals;
  const map = value.map;
  return (
    typeof value.enabled === "boolean" &&
    isRecord(processor) &&
    isOptionalString(processor.instanceId) &&
    ["disabled", "healthy"].includes(String(processor.status)) &&
    isRecord(queue) &&
    [
      "ingressPending",
      "queued",
      "claimed",
      "active",
      "claimedNotActive",
      "total",
      "maxQueuedUploads",
    ].every((key) => isFiniteNumber(queue[key])) &&
    isRecord(totals) &&
    ["enqueued", "uploaded", "dropped", "invalid", "retries"].every((key) =>
      isFiniteNumber(totals[key]),
    ) &&
    Array.isArray(value.workers) &&
    value.workers.every(
      (worker) =>
        isRecord(worker) &&
        typeof worker.instanceId === "string" &&
        [
          "configuredWorkers",
          "activeUploads",
          "uploadsSucceeded",
          "uploadsFailed",
          "updatedAt",
        ].every((key) => isFiniteNumber(worker[key])) &&
        isOptionalNumber(worker.lastUploadAt) &&
        isOptionalString(worker.lastError),
    ) &&
    Array.isArray(value.history) &&
    value.history.every(
      (entry) =>
        isRecord(entry) &&
        isFiniteNumber(entry.at) &&
        ["uploaded", "dropped"].includes(String(entry.status)) &&
        [
          "requestId",
          "nodeName",
          "nodePublicKey",
          "advertType",
          "workerInstanceId",
        ].every((key) => typeof entry[key] === "string") &&
        isOptionalString(entry.observerName) &&
        isOptionalString(entry.detail),
    ) &&
    (map === undefined ||
      (isRecord(map) &&
        Array.isArray(map.advertsLast7Days) &&
        map.advertsLast7Days.every(
          (advert) =>
            isRecord(advert) &&
            ["at", "latitude", "longitude"].every((key) =>
              isFiniteNumber(advert[key]),
            ) &&
            [
              "requestId",
              "nodeName",
              "nodePublicKey",
              "advertType",
              "workerInstanceId",
            ].every((key) => typeof advert[key] === "string") &&
            isOptionalString(advert.observerName),
        ))) &&
    isOptionalString(value.lastError)
  );
}

function isDashboardSnapshot(value: unknown): value is DashboardSnapshot {
  if (!isRecord(value) || !isRecord(value.summary)) return false;
  const summary = value.summary;
  return (
    isFiniteNumber(value.generatedAt) &&
    typeof value.respondingBroker === "string" &&
    [
      "connectedClients",
      "connectedObservers",
      "activeBrokers",
      "totalBrokers",
      "messagesPerSecond",
      "publishesLastMinute",
      "activeBans",
      "protectionEventsShown",
      "protectionEventsTotal",
    ].every((key) => isFiniteNumber(summary[key])) &&
    typeof summary.protectionEventsTruncated === "boolean" &&
    Array.isArray(value.brokers) &&
    value.brokers.every(isBroker) &&
    Array.isArray(value.observers) &&
    value.observers.every(isObserver) &&
    Array.isArray(value.recentPublishes) &&
    value.recentPublishes.every(isObserverMessage) &&
    Array.isArray(value.bans) &&
    value.bans.every(isBan) &&
    Array.isArray(value.subscribers) &&
    value.subscribers.every(isSubscriber) &&
    (value.countyLookup === undefined ||
      (isRecord(value.countyLookup) &&
        Object.values(value.countyLookup).every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.countyName === "string" &&
            typeof entry.primaryIata === "string" &&
            typeof entry.isPrimary === "boolean",
        ))) &&
    (value.meshcoreIo === undefined ||
      isMeshcoreIoSnapshot(value.meshcoreIo)) &&
    isOptionalString(value.error)
  );
}

export async function fetchDashboard(
  signal?: AbortSignal,
): Promise<DashboardSnapshot> {
  const response = await fetch("/api/dashboard", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Dashboard API returned HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!isDashboardSnapshot(payload)) {
    throw new Error("Dashboard API returned an invalid snapshot");
  }
  return payload;
}
