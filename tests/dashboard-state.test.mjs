import assert from "node:assert/strict";
import { test } from "@jest/globals";

import { DashboardState } from "../dist/dashboard.js";

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

function publisherClient() {
  return {
    id: "publisher-dashboard-state",
    clientType: "publisher",
    publicKey: PUBLIC_KEY,
    nodeName: "LOCAL-ONLY",
    connectedAt: Date.now(),
  };
}

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
