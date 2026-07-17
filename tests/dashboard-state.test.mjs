import assert from "node:assert/strict";
import { test } from "@jest/globals";

import { createDashboardServer, DashboardState } from "../dist/dashboard.js";

const PUBLIC_KEY =
  "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";

function publishPacket(topic) {
  return {
    cmd: "publish",
    topic,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: "00" })),
    qos: 0,
    dup: false,
    retain: false,
  };
}

function publisherClient(id = "publisher-dashboard-state") {
  return {
    id,
    clientType: "publisher",
    publicKey: PUBLIC_KEY,
    nodeName: "LOCAL-ONLY",
    connectedAt: Date.now(),
  };
}

test("dashboard counts unique observers and keeps them active until their final connection closes", () => {
  const state = new DashboardState({
    instanceId: "Broker-MULTI",
    namespace: "meshcore-dashboard-multi-connection-test",
  });
  const first = publisherClient("publisher-first");
  const second = publisherClient("publisher-second");

  state.recordClientConnected(first);
  state.recordClientConnected(second);
  state.recordPublish(
    publishPacket(`meshcore/GOT/${PUBLIC_KEY}/packets`),
    first,
  );

  assert.equal(state.getLocalMetrics(0).connectedClients, 2);
  assert.equal(state.getLocalMetrics(0).publisherClients, 1);

  state.recordClientDisconnected(first);
  assert.equal(state.getLocalMetrics(0).connectedClients, 1);
  assert.equal(state.getLocalMetrics(0).publisherClients, 1);
  assert.equal(state.getObserverEntries().length, 1);
  assert.equal(state.getObserverEntries()[0].active, true);
  assert.equal(state.getObserverEntries()[0].messageCount, 1);

  state.recordClientDisconnected(second);
  assert.equal(state.getLocalMetrics(0).connectedClients, 0);
  assert.equal(state.getLocalMetrics(0).publisherClients, 0);
  assert.deepEqual(state.getObserverEntries(), []);
});

test("dashboard snapshot is built from Valkey reads, not local process fallback", async () => {
  const state = new DashboardState({
    instanceId: "Broker-LOCAL",
    namespace: "meshcore-dashboard-state-test",
  });
  const client = publisherClient();
  state.recordClientConnected(client);
  state.recordPublish(
    publishPacket(`meshcore/GOT/${PUBLIC_KEY}/packets`),
    client,
  );

  const writes = {
    metrics: null,
    observers: null,
  };
  const store = {
    async setInstanceMetrics(metrics) {
      writes.metrics = metrics;
    },
    async setInstanceObservers(observers) {
      writes.observers = observers;
    },
    async listInstanceReadiness() {
      return [
        {
          instanceId: "Broker-VALKEY",
          status: "ready",
          namespace: "meshcore-dashboard-state-test",
          lastUpdatedAt: Date.now(),
          lastUpdatedByInstance: "Broker-VALKEY",
        },
      ];
    },
    async listInstanceMetrics() {
      return [
        {
          instanceId: "Broker-VALKEY",
          connectedClients: 7,
          subscriberClients: 0,
          publisherClients: 7,
          messagesPerSecond: 1.5,
          messagesLastMinute: 90,
          activeBans: 0,
          localReady: true,
          startedAt: 1_800_000_000_000,
          lastUpdatedAt: Date.now(),
          lastUpdatedByInstance: "Broker-VALKEY",
        },
      ];
    },
    async listPublicBans() {
      return [];
    },
    async listDeniedPublishes() {
      return [];
    },
    async listInstanceObservers() {
      return [
        {
          label: "VALKEY-OBSERVER",
          publicKey: PUBLIC_KEY,
          broker: "Broker-VALKEY",
          region: "GOT",
          active: true,
          lastConnectedAt: 1_800_000_000_000,
          lastSeenAt: 1_800_000_001_000,
          messageCount: 3,
          messages: [
            {
              topic: `meshcore/GOT/${PUBLIC_KEY}/packets`,
              broker: "Broker-VALKEY",
              region: "GOT",
              observer: "VALKEY-OBSERVER",
              publicKey: PUBLIC_KEY,
              subtopic: "packets",
              bytes: 10,
              receivedAt: 1_800_000_001_000,
            },
          ],
        },
      ];
    },
    async getObserverClaims(publicKeys) {
      return new Map(
        publicKeys.map((publicKey) => [publicKey, "Broker-VALKEY"]),
      );
    },
    async getObserverNodeNames() {
      return new Map([[PUBLIC_KEY, "VALKEY-OBSERVER"]]);
    },
    async listSubscriberConnections() {
      return [];
    },
  };

  const snapshot = await state.getSnapshot(store, 0);

  assert.equal(writes.metrics.instanceId, "Broker-LOCAL");
  assert.equal(writes.observers.length, 1);
  assert.equal(snapshot.summary.connectedObservers, 7);
  assert.deepEqual(
    snapshot.brokers.map((broker) => broker.instanceId),
    ["Broker-VALKEY"],
  );
  assert.deepEqual(
    snapshot.observers.map((observer) => observer.broker),
    ["Broker-VALKEY"],
  );
  assert.equal(snapshot.observers[0].label, "VALKEY-OBSERVER");
  assert.equal(snapshot.recentPublishes.length, 1);
  assert.equal(snapshot.recentPublishes[0].broker, "Broker-VALKEY");
  assert.equal(snapshot.recentPublishes[0].observer, "VALKEY-OBSERVER");
});

test("dashboard reports temporary state failures without crashing the process", async () => {
  const dashboard = createDashboardServer({
    host: "127.0.0.1",
    port: 0,
    clusterStateStore: {},
    state: {
      async getSnapshot() {
        throw new Error("Valkey unavailable");
      },
    },
    instanceId: "Broker-ERROR",
    namespace: "meshcore-dashboard-error-test",
    activeBans: () => 0,
  });

  const port = await dashboard.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.status, "error");
    assert.equal(body.message, "Dashboard data is temporarily unavailable.");
  } finally {
    await dashboard.close();
  }
});

function emptyClusterStore() {
  return {
    async setInstanceMetrics() {},
    async setInstanceObservers() {},
    async listInstanceReadiness() {
      return [];
    },
    async listInstanceMetrics() {
      return [];
    },
    async listPublicBans() {
      return [];
    },
    async listDeniedPublishes() {
      return [];
    },
    async listInstanceObservers() {
      return [];
    },
    async getObserverClaims() {
      return new Map();
    },
    async getObserverNodeNames() {
      return new Map();
    },
    async listSubscriberConnections() {
      return [];
    },
  };
}

test("dashboard includes shared Meshcore.io queue and worker state", async () => {
  const meshcoreIo = {
    enabled: true,
    producer: {
      instanceId: "Broker-A",
      respondingBrokerIsProducer: true,
      leaseRemainingMs: 12000,
      status: "healthy",
    },
    queue: {
      ingressPending: 2,
      queued: 4,
      active: 1,
      total: 5,
      maxQueuedUploads: 250,
    },
    totals: { enqueued: 10, uploaded: 5, dropped: 1, invalid: 2, retries: 3 },
    workers: [],
    history: [],
  };
  const state = new DashboardState({
    instanceId: "Broker-A",
    namespace: "meshcore-dashboard-map-test",
    meshcoreIoStatus: async () => meshcoreIo,
  });

  const snapshot = await state.getSnapshot(emptyClusterStore(), 0);
  assert.deepEqual(snapshot.meshcoreIo, meshcoreIo);
});

test("Meshcore.io dashboard failure does not make the whole dashboard unavailable", async () => {
  const state = new DashboardState({
    instanceId: "Broker-A",
    namespace: "meshcore-dashboard-map-error-test",
    meshcoreIoStatus: async () => {
      throw new Error("map Valkey failure");
    },
  });

  const snapshot = await state.getSnapshot(emptyClusterStore(), 0);
  assert.equal(snapshot.error, undefined);
  assert.equal(snapshot.meshcoreIo, undefined);
});
