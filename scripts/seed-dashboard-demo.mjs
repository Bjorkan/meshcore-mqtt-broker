import { ClusterStateStore } from '../dist/orchestration.js';

const kvUrl = process.env.BROKER_KV_URL || 'redis://127.0.0.1:6379';
const namespace = process.env.BROKER_KV_NAMESPACE || 'meshcore-dashboard-review';

const brokers = [
  {
    instanceId: 'ReviewBroker-STO',
    connectedClients: 3,
    publisherClients: 3,
    messagesPerSecond: 0.85,
    messagesLastMinute: 51,
    targetBridge: {
      enabled: true,
      connected: true,
      targetUrl: 'mqtts://uplink.meshat.example:8883',
      targetHost: 'uplink.meshat.example',
      clientId: 'review-uplink-sto',
      droppedMessages: 1,
      successfulMessages: 1842,
    },
  },
  {
    instanceId: 'ReviewBroker-GOT',
    connectedClients: 2,
    publisherClients: 2,
    messagesPerSecond: 0.35,
    messagesLastMinute: 21,
    targetBridge: {
      enabled: true,
      connected: false,
      targetUrl: 'mqtts://backup.meshat.example:8883',
      targetHost: 'backup.meshat.example',
      clientId: 'review-uplink-got',
      droppedMessages: 7,
      successfulMessages: 128,
    },
  },
];

const observers = [
  {
    label: 'Stockholm Taknod',
    publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    broker: 'ReviewBroker-STO',
    region: 'STO',
    messageCount: 438,
    subtopics: ['packets', 'status', 'telemetry'],
  },
  {
    label: 'Göteborg Ridge',
    publicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    broker: 'ReviewBroker-GOT',
    region: 'GOT',
    messageCount: 204,
    subtopics: ['status', 'packets', 'environment'],
  },
  {
    label: 'Jönköping Relay',
    publicKey: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    broker: 'ReviewBroker-STO',
    region: 'JKG',
    messageCount: 97,
    subtopics: ['packets', 'status'],
  },
  {
    label: 'Malmö Shadow Mode',
    publicKey: 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    broker: 'ReviewBroker-GOT',
    region: 'MMX',
    messageCount: 16,
    subtopics: ['packets', 'diagnostics'],
  },
];

function messagesFor(observer, now) {
  return observer.subtopics.map((subtopic, index) => ({
    topic: `meshcore/${observer.region}/${observer.publicKey}/${subtopic}`,
    broker: observer.broker,
    region: observer.region,
    observer: observer.label,
    publicKey: observer.publicKey,
    subtopic,
    bytes: 96 + index * 37,
    receivedAt: now - (index + 1) * 45_000,
  }));
}

async function seed() {
  const resetStore = new ClusterStateStore({
    kvUrl,
    namespace,
    instanceId: 'DashboardSeeder',
    backgroundRefresh: false,
  });
  await resetStore.resetNamespace();
  await resetStore.disconnect();

  const now = Date.now();
  const stores = new Map();

  try {
    for (const broker of brokers) {
      const store = new ClusterStateStore({
        kvUrl,
        namespace,
        instanceId: broker.instanceId,
        backgroundRefresh: false,
      });
      stores.set(broker.instanceId, store);

      await store.setInstanceMetrics({
        ...broker,
        subscriberClients: 1,
        activeBans: 2,
        localReady: true,
        startedAt: now - 2 * 60 * 60 * 1000,
        lastUpdatedAt: now,
        lastUpdatedByInstance: broker.instanceId,
      });
    }

    for (const broker of brokers) {
      const store = stores.get(broker.instanceId);
      const entries = observers
        .filter((observer) => observer.broker === broker.instanceId)
        .map((observer, index) => ({
          label: observer.label,
          publicKey: observer.publicKey,
          broker: observer.broker,
          region: observer.region,
          active: true,
          lastConnectedAt: now - (index + 10) * 60_000,
          lastSeenAt: now - (index + 1) * 45_000,
          messageCount: observer.messageCount,
          messages: messagesFor(observer, now),
        }));

      await store.setInstanceObservers(entries);
      for (const entry of entries) {
        await store.claimObserver(entry.publicKey);
        await store.setObserverNodeName(entry.publicKey, entry.label, 150_000);
      }
    }

    const mutedStore = stores.get('ReviewBroker-GOT');
    await mutedStore.setTrustState(observers[1].publicKey, JSON.stringify({
      status: 'muted',
      muteReason: 'anomaly:packet_size',
      abuseBlockCount: 3,
      mutedAt: now - 12 * 60_000,
      mutedUntil: now + 48 * 60 * 60_000,
      username: observers[1].label,
    }));

    await mutedStore.setTrustState(observers[3].publicKey, JSON.stringify({
      status: 'would_mute',
      muteReason: 'rate_limit_exceeded',
      abuseBlockCount: 1,
      mutedAt: now - 3 * 60_000,
      mutedUntil: now + 15 * 60_000,
      username: observers[3].label,
    }));

    await mutedStore.recordDeniedPublish({
      node: 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
      label: 'Ogiltig IATA-demo',
      reason: 'invalid_iata',
      topic: 'meshcore/XYZ/EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE/status',
      region: 'XYZ',
    });

    console.log(`Seeded dashboard review data in ${namespace} at ${kvUrl}`);
  } finally {
    await Promise.all(Array.from(stores.values()).map((store) => store.disconnect()));
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
