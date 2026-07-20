import assert from "node:assert/strict";
import { test } from "@jest/globals";

import { createDashboardServer, DashboardState } from "../dist/dashboard.js";
import { mergeInstanceObserverEntries } from "../dist/orchestration.js";

const PUBLIC_KEY =
  "4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E";
const NEIGHBOR_PUBLIC_KEY =
  "7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400";

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

function publicKeyFor(index) {
  return index.toString(16).toUpperCase().padStart(64, "0");
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

test("dashboard never evicts active observers when more than 200 are connected", () => {
  const state = new DashboardState({
    instanceId: "Broker-LARGE",
    namespace: "meshcore-dashboard-large-active-test",
  });

  for (let index = 1; index <= 250; index += 1) {
    state.recordClientConnected({
      ...publisherClient(`publisher-${index}`),
      publicKey: publicKeyFor(index),
      nodeName: `Observer ${index}`,
    });
  }

  assert.equal(state.getLocalMetrics(0).publisherClients, 250);
  assert.equal(state.getObserverEntries().length, 250);
});

test("observer entries are deduplicated per broker, not across a handover", () => {
  const entries = mergeInstanceObserverEntries([
    {
      label: "old owner",
      publicKey: PUBLIC_KEY,
      broker: "Broker-OLD",
      active: true,
      lastConnectedAt: 100,
      lastSeenAt: 300,
      messageCount: 3,
      messages: [],
    },
    {
      label: "current owner",
      publicKey: PUBLIC_KEY,
      broker: "Broker-CURRENT",
      active: true,
      lastConnectedAt: 200,
      lastSeenAt: 250,
      messageCount: 1,
      messages: [],
    },
  ]);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.broker).sort(), [
    "Broker-CURRENT",
    "Broker-OLD",
  ]);
});

test("dashboard understands and stores the latest /neighbors snapshot", () => {
  const state = new DashboardState({
    instanceId: "Broker-NEIGHBORS",
    namespace: "meshcore-dashboard-neighbors-test",
  });
  const client = publisherClient("publisher-neighbors");
  state.recordClientConnected(client);

  state.recordPublish(
    {
      cmd: "publish",
      topic: `meshcore/GOT/${PUBLIC_KEY}/neighbors`,
      payload: Buffer.from(
        JSON.stringify({
          timestamp: "2026-06-07T12:00:00.000000+00:00",
          origin: "LOCAL-ONLY",
          origin_id: PUBLIC_KEY,
          self: { scopes: "Europe,Sweden" },
          neighbors: [
            {
              pubkey: NEIGHBOR_PUBLIC_KEY,
              snr: 8.5,
              heard_secs_ago: 120,
              scopes: "*,Europe",
              status: "responded",
            },
          ],
        }),
      ),
      qos: 1,
      dup: false,
      retain: false,
    },
    client,
  );

  const [observer] = state.getObserverEntries();
  assert.equal(observer.messages[0].subtopic, "neighbors");
  assert.deepEqual(observer.neighbors.selfScopes, ["Europe", "Sweden"]);
  assert.deepEqual(observer.neighbors.neighbors[0], {
    publicKey: NEIGHBOR_PUBLIC_KEY,
    snr: 8.5,
    heardSecsAgo: 120,
    scopes: ["*", "Europe"],
    status: "responded",
  });
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
  assert.equal(snapshot.summary.connectedObservers, 1);
  assert.equal(snapshot.brokers[0].claimedObservers, 1);
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

test("cluster messages per second is derived after summing exact minute counts", async () => {
  const timestamp = Date.now();
  const state = new DashboardState({
    instanceId: "Broker-LOCAL",
    namespace: "meshcore-dashboard-rate-rounding-test",
  });
  const store = {
    ...emptyClusterStore(),
    async listInstanceReadiness() {
      return ["Broker-A", "Broker-B"].map((instanceId) => ({
        instanceId,
        status: "ready",
        lastUpdatedAt: timestamp,
        lastUpdatedByInstance: instanceId,
      }));
    },
    async listInstanceMetrics() {
      return ["Broker-A", "Broker-B"].map((instanceId) => ({
        instanceId,
        connectedClients: 0,
        subscriberClients: 0,
        publisherClients: 0,
        messagesPerSecond: 0.02,
        messagesLastMinute: 1,
        activeBans: 0,
        localReady: true,
        startedAt: timestamp - 10_000,
        lastUpdatedAt: timestamp,
        lastUpdatedByInstance: instanceId,
      }));
    },
  };

  const snapshot = await state.getSnapshot(store, 0);
  assert.equal(snapshot.summary.publishesLastMinute, 2);
  assert.equal(snapshot.summary.messagesPerSecond, 0.03);
});

test("dashboard keeps the current claim owner visible during broker handover", async () => {
  const timestamp = Date.now();
  const state = new DashboardState({
    instanceId: "Broker-LOCAL",
    namespace: "meshcore-dashboard-handover-test",
  });
  const store = {
    ...emptyClusterStore(),
    async listInstanceReadiness() {
      return ["Broker-OLD", "Broker-CURRENT"].map((instanceId) => ({
        instanceId,
        status: "ready",
        lastUpdatedAt: timestamp,
        lastUpdatedByInstance: instanceId,
      }));
    },
    async listInstanceMetrics() {
      return ["Broker-OLD", "Broker-CURRENT"].map((instanceId) => ({
        instanceId,
        connectedClients: 1,
        subscriberClients: 0,
        publisherClients: 1,
        messagesPerSecond: 0,
        messagesLastMinute: 0,
        activeBans: 0,
        localReady: true,
        startedAt: timestamp - 10_000,
        lastUpdatedAt: timestamp,
        lastUpdatedByInstance: instanceId,
      }));
    },
    async listInstanceObservers() {
      return [
        {
          label: "stale owner",
          publicKey: PUBLIC_KEY,
          broker: "Broker-OLD",
          active: true,
          lastConnectedAt: timestamp - 2_000,
          lastSeenAt: timestamp,
          messageCount: 2,
          messages: [
            {
              topic: `meshcore/GOT/${PUBLIC_KEY}/packets`,
              broker: "Broker-OLD",
              region: "GOT",
              observer: "stale owner",
              publicKey: PUBLIC_KEY,
              subtopic: "packets",
              bytes: 10,
              receivedAt: timestamp - 750,
            },
          ],
        },
        {
          label: "current owner",
          publicKey: PUBLIC_KEY,
          broker: "Broker-CURRENT",
          active: true,
          lastConnectedAt: timestamp - 1_000,
          lastSeenAt: timestamp - 500,
          messageCount: 1,
          messages: [],
        },
      ];
    },
    async getObserverClaims() {
      return new Map([[PUBLIC_KEY, "Broker-CURRENT"]]);
    },
  };

  const snapshot = await state.getSnapshot(store, 0);
  assert.equal(snapshot.summary.connectedObservers, 1);
  assert.equal(snapshot.observers[0].broker, "Broker-CURRENT");
  assert.equal(snapshot.brokers[0].claimedObservers, 1);
  assert.equal(snapshot.brokers[1].claimedObservers, 0);
  assert.equal(snapshot.recentPublishes[0].broker, "Broker-OLD");
});

test("dashboard marks protection event totals as limited instead of presenting 50 as the full count", async () => {
  const state = new DashboardState({
    instanceId: "Broker-PROTECTION",
    namespace: "meshcore-dashboard-protection-limit-test",
  });
  const store = {
    ...emptyClusterStore(),
    async listPublicBans(limit) {
      assert.equal(limit, 51);
      return Array.from({ length: 51 }, (_, index) => ({
        node: publicKeyFor(index + 1),
        broker: "Broker-PROTECTION",
        reason: "rate limit",
        blockCount: index + 1,
        status: "muted",
        lastUpdatedAt: Date.now() - index,
      }));
    },
  };

  const snapshot = await state.getSnapshot(store, 0);
  assert.equal(snapshot.bans.length, 50);
  assert.equal(snapshot.summary.protectionEventsShown, 50);
  assert.equal(snapshot.summary.protectionEventsTruncated, true);
});

test("dashboard excludes subscriber connections left behind by stale brokers", async () => {
  const timestamp = Date.now();
  const state = new DashboardState({
    instanceId: "Broker-LOCAL",
    namespace: "meshcore-dashboard-stale-subscriber-test",
  });
  const store = {
    ...emptyClusterStore(),
    async listInstanceReadiness() {
      return [
        {
          instanceId: "Broker-HEALTHY",
          status: "ready",
          lastUpdatedAt: timestamp,
          lastUpdatedByInstance: "Broker-HEALTHY",
        },
      ];
    },
    async listInstanceMetrics() {
      return [
        {
          instanceId: "Broker-HEALTHY",
          connectedClients: 1,
          subscriberClients: 1,
          publisherClients: 0,
          messagesPerSecond: 0,
          messagesLastMinute: 0,
          activeBans: 0,
          localReady: true,
          startedAt: timestamp - 10_000,
          lastUpdatedAt: timestamp,
          lastUpdatedByInstance: "Broker-HEALTHY",
        },
        {
          instanceId: "Broker-STALE",
          connectedClients: 1,
          subscriberClients: 1,
          publisherClients: 0,
          messagesPerSecond: 0,
          messagesLastMinute: 0,
          activeBans: 0,
          localReady: true,
          startedAt: timestamp - 10_000,
          lastUpdatedAt: timestamp - 130_000,
          lastUpdatedByInstance: "Broker-STALE",
        },
      ];
    },
    async listSubscriberConnections() {
      return [
        {
          username: "viewer",
          connectionCount: 2,
          lastSeenAt: timestamp,
          brokers: [],
          subscriptions: ["meshcore/#", "status/#"],
          subscriptionsTruncated: false,
          connections: [
            {
              clientId: "healthy-client",
              brokerId: "Broker-HEALTHY",
              lastSeenAt: timestamp,
              subscriptions: ["meshcore/#"],
              subscriptionsTruncated: false,
            },
            {
              clientId: "stale-client",
              brokerId: "Broker-STALE",
              lastSeenAt: timestamp - 30_000,
              subscriptions: ["status/#"],
              subscriptionsTruncated: false,
            },
          ],
        },
      ];
    },
  };

  const snapshot = await state.getSnapshot(store, 0);
  assert.equal(snapshot.subscribers.length, 1);
  assert.equal(snapshot.subscribers[0].connectionCount, 1);
  assert.deepEqual(snapshot.subscribers[0].subscriptions, ["meshcore/#"]);
  assert.deepEqual(
    snapshot.subscribers[0].brokers.map((broker) => broker.brokerId),
    ["Broker-HEALTHY"],
  );
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
  const timestamp = Date.now();
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
      claimed: 1,
      active: 1,
      claimedNotActive: 0,
      total: 5,
      maxQueuedUploads: 250,
    },
    totals: { enqueued: 10, uploaded: 5, dropped: 1, invalid: 2, retries: 3 },
    workers: [
      {
        instanceId: "Broker-A",
        configuredWorkers: 1,
        activeUploads: 1,
        uploadsSucceeded: 5,
        uploadsFailed: 0,
        updatedAt: timestamp,
      },
    ],
    history: [],
    map: { advertsLast7Days: [] },
  };
  const state = new DashboardState({
    instanceId: "Broker-A",
    namespace: "meshcore-dashboard-map-test",
    meshcoreIoStatus: async () => meshcoreIo,
  });
  const store = {
    ...emptyClusterStore(),
    async listInstanceReadiness() {
      return [
        {
          instanceId: "Broker-A",
          status: "ready",
          lastUpdatedAt: timestamp,
          lastUpdatedByInstance: "Broker-A",
        },
      ];
    },
    async listInstanceMetrics() {
      return [
        {
          instanceId: "Broker-A",
          connectedClients: 0,
          subscriberClients: 0,
          publisherClients: 0,
          messagesPerSecond: 0,
          messagesLastMinute: 0,
          activeBans: 0,
          localReady: true,
          startedAt: timestamp - 10_000,
          lastUpdatedAt: timestamp,
          lastUpdatedByInstance: "Broker-A",
        },
      ];
    },
  };

  const snapshot = await state.getSnapshot(store, 0);
  assert.deepEqual(snapshot.meshcoreIo, meshcoreIo);
});

test("dashboard excludes MeshCore.io workers from stale broker instances", async () => {
  const timestamp = Date.now();
  const meshcoreIo = {
    enabled: true,
    producer: {
      instanceId: "Broker-STALE",
      respondingBrokerIsProducer: false,
      leaseRemainingMs: 5000,
      status: "healthy",
    },
    queue: {
      ingressPending: 0,
      queued: 0,
      claimed: 2,
      active: 2,
      claimedNotActive: 0,
      total: 2,
      maxQueuedUploads: 250,
    },
    totals: { enqueued: 2, uploaded: 0, dropped: 0, invalid: 0, retries: 0 },
    workers: [
      {
        instanceId: "Broker-HEALTHY",
        configuredWorkers: 1,
        activeUploads: 1,
        uploadsSucceeded: 0,
        uploadsFailed: 0,
        updatedAt: timestamp,
      },
      {
        instanceId: "Broker-STALE",
        configuredWorkers: 1,
        activeUploads: 1,
        uploadsSucceeded: 0,
        uploadsFailed: 0,
        updatedAt: timestamp,
      },
    ],
    history: [],
    map: { advertsLast7Days: [] },
  };
  const state = new DashboardState({
    instanceId: "Broker-HEALTHY",
    namespace: "meshcore-dashboard-worker-health-test",
    meshcoreIoStatus: async () => meshcoreIo,
  });
  const store = {
    ...emptyClusterStore(),
    async listInstanceReadiness() {
      return [
        {
          instanceId: "Broker-HEALTHY",
          status: "ready",
          lastUpdatedAt: timestamp,
          lastUpdatedByInstance: "Broker-HEALTHY",
        },
      ];
    },
    async listInstanceMetrics() {
      return [
        {
          instanceId: "Broker-HEALTHY",
          connectedClients: 0,
          subscriberClients: 0,
          publisherClients: 0,
          messagesPerSecond: 0,
          messagesLastMinute: 0,
          activeBans: 0,
          localReady: true,
          startedAt: timestamp - 10_000,
          lastUpdatedAt: timestamp,
          lastUpdatedByInstance: "Broker-HEALTHY",
        },
        {
          instanceId: "Broker-STALE",
          connectedClients: 0,
          subscriberClients: 0,
          publisherClients: 0,
          messagesPerSecond: 0,
          messagesLastMinute: 0,
          activeBans: 0,
          localReady: true,
          startedAt: timestamp - 10_000,
          lastUpdatedAt: timestamp - 130_000,
          lastUpdatedByInstance: "Broker-STALE",
        },
      ];
    },
  };

  const snapshot = await state.getSnapshot(store, 0);
  assert.deepEqual(
    snapshot.meshcoreIo.workers.map((worker) => worker.instanceId),
    ["Broker-HEALTHY"],
  );
  assert.equal(snapshot.meshcoreIo.queue.active, 1);
  assert.equal(snapshot.meshcoreIo.queue.claimedNotActive, 1);
  assert.equal(snapshot.meshcoreIo.producer.status, "stale");
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

test("dashboard serves the bundled MapLibre stylesheet without a CDN dependency", async () => {
  const dashboard = createDashboardServer({
    host: "127.0.0.1",
    port: 0,
    clusterStateStore: emptyClusterStore(),
    state: {
      async getSnapshot() {
        return {};
      },
    },
    instanceId: "Broker-ASSETS",
    namespace: "meshcore-dashboard-assets-test",
    activeBans: () => 0,
  });

  const port = await dashboard.listen();
  try {
    const htmlResponse = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    assert.match(html, /\/dashboard-client\.css/);
    assert.doesNotMatch(html, /unpkg\.com|maplibre-gl\.js/);

    const cssResponse = await fetch(
      `http://127.0.0.1:${port}/dashboard-client.css`,
    );
    assert.equal(cssResponse.status, 200);
    assert.match(cssResponse.headers.get("content-type") ?? "", /text\/css/);
    assert.match(await cssResponse.text(), /maplibregl-map/);
  } finally {
    await dashboard.close();
  }
});

test("dashboard counts subscriber connections separately", () => {
  const state = new DashboardState({
    instanceId: "Broker-SUBSCRIBERS",
    namespace: "meshcore-dashboard-subscriber-test",
  });
  const publisher = publisherClient("publisher-1");
  const subscriber = {
    id: "subscriber-1",
    clientType: "subscriber",
    username: "viewer",
    connectedAt: Date.now(),
  };

  state.recordClientConnected(publisher);
  state.recordClientAuthenticated(subscriber);

  assert.equal(state.getLocalMetrics(0).connectedClients, 2);
  assert.equal(state.getLocalMetrics(0).publisherClients, 1);
  assert.equal(state.getLocalMetrics(0).subscriberClients, 1);

  state.recordClientDisconnected(subscriber);
  assert.equal(state.getLocalMetrics(0).connectedClients, 1);
  assert.equal(state.getLocalMetrics(0).subscriberClients, 0);
});

test("stale disconnect cannot remove a replacement connection with the same client id", () => {
  const state = new DashboardState({
    instanceId: "Broker-RECONNECT",
    namespace: "meshcore-dashboard-reconnect-test",
  });
  const previous = publisherClient("shared-client-id");
  const replacement = {
    ...publisherClient("shared-client-id"),
    connectedAt: previous.connectedAt + 1,
    nodeName: "REPLACEMENT",
  };

  state.recordClientConnected(previous);
  state.recordClientConnected(replacement);
  state.recordClientDisconnected(previous);

  assert.equal(state.getLocalMetrics(0).connectedClients, 1);
  assert.equal(state.getLocalMetrics(0).publisherClients, 1);
  assert.equal(state.getObserverEntries()[0].label, "REPLACEMENT");

  state.recordClientDisconnected(replacement);
  assert.equal(state.getLocalMetrics(0).connectedClients, 0);
});

test("stale subscriber disconnect cannot remove its replacement", () => {
  const state = new DashboardState({
    instanceId: "Broker-SUB-RECONNECT",
    namespace: "meshcore-dashboard-subscriber-reconnect-test",
  });
  const previous = {
    id: "shared-subscriber-id",
    clientType: "subscriber",
    username: "viewer",
  };
  const replacement = { ...previous };

  state.recordClientConnected(previous);
  state.recordClientConnected(replacement);
  state.recordClientDisconnected(previous);
  assert.equal(state.getLocalMetrics(0).subscriberClients, 1);

  state.recordClientDisconnected(replacement);
  assert.equal(state.getLocalMetrics(0).subscriberClients, 0);
});
