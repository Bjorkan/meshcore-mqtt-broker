import Redis from "ioredis";
import { ClusterStateStore } from "../dist/orchestration.js";

const kvUrl = process.env.BROKER_KV_URL || "redis://127.0.0.1:6379";
const namespace =
  process.env.BROKER_KV_NAMESPACE || "meshcore-dashboard-review";

const brokers = [
  {
    instanceId: "ReviewBroker-STO",
    connectedClients: 3,
    publisherClients: 3,
    messagesPerSecond: 0.85,
    messagesLastMinute: 51,
    targetBridge: {
      enabled: true,
      connected: true,
      targetUrl: "mqtts://uplink.meshat.example:8883",
      targetHost: "uplink.meshat.example",
      clientId: "review-uplink-sto",
      droppedMessages: 1,
      successfulMessages: 1842,
    },
  },
  {
    instanceId: "ReviewBroker-GOT",
    connectedClients: 2,
    publisherClients: 2,
    messagesPerSecond: 0.35,
    messagesLastMinute: 21,
    targetBridge: {
      enabled: true,
      connected: false,
      targetUrl: "mqtts://backup.meshat.example:8883",
      targetHost: "backup.meshat.example",
      clientId: "review-uplink-got",
      droppedMessages: 7,
      successfulMessages: 128,
    },
  },
];

const observers = [
  {
    label: "Stockholm Taknod",
    publicKey:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    broker: "ReviewBroker-STO",
    region: "STO",
    messageCount: 438,
    subtopics: ["packets", "status", "telemetry"],
  },
  {
    label: "Göteborg Ridge",
    publicKey:
      "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    broker: "ReviewBroker-GOT",
    region: "GOT",
    messageCount: 204,
    subtopics: ["status", "packets", "environment"],
  },
  {
    label: "Jönköping Relay",
    publicKey:
      "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    broker: "ReviewBroker-STO",
    region: "JKG",
    messageCount: 97,
    subtopics: ["packets", "status"],
  },
  {
    label: "Malmö Shadow Mode",
    publicKey:
      "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    broker: "ReviewBroker-GOT",
    region: "MMX",
    messageCount: 16,
    subtopics: ["packets", "diagnostics"],
  },
];

async function ensureStreamGroup(redis, stream, group) {
  try {
    await redis.xgroup("CREATE", stream, group, "0", "MKSTREAM");
  } catch (error) {
    if (!/BUSYGROUP/i.test(String(error))) throw error;
  }
}

async function seedMeshcoreIoDemo(now) {
  const redis = new Redis(kvUrl, {
    connectTimeout: 5_000,
    commandTimeout: 5_000,
    maxRetriesPerRequest: 2,
  });
  const prefix = `${namespace}:meshcoreio`;
  const queue = `${prefix}:queue`;
  const stats = `${prefix}:stats`;
  const history = `${prefix}:history`;

  const queueJobs = [
    {
      requestId: "visual-review-active-1",
      retriesAllowed: 3,
      advertKey: `${"1".repeat(64)}:1784234000`,
      advertTimestamp: 1784234000,
      advertType: "REPEATER",
      nodeName: "Taknod Vasastan",
      nodePublicKey: "1".repeat(64),
      rawPacketHex: "01020304",
      observerId: observers[0].publicKey,
      observerName: observers[0].label,
      radioParams: { freq: 869.525, bw: 125, sf: 11, cr: 5 },
      enqueuedAt: now - 18_000,
    },
    {
      requestId: "visual-review-active-2",
      retriesAllowed: 3,
      advertKey: `${"2".repeat(64)}:1784233990`,
      advertTimestamp: 1784233990,
      advertType: "ROOM",
      nodeName: "Samlingsrum Jönköping",
      nodePublicKey: "2".repeat(64),
      rawPacketHex: "05060708",
      observerId: observers[2].publicKey,
      observerName: observers[2].label,
      radioParams: { freq: 869.525, bw: 125, sf: 10, cr: 5 },
      enqueuedAt: now - 11_000,
    },
  ];

  try {
    await ensureStreamGroup(redis, queue, "uploaders");
    for (const job of queueJobs) {
      await redis.xadd(
        queue,
        "*",
        "nodePublicKey",
        job.nodePublicKey,
        "job",
        JSON.stringify(job),
      );
    }
    await redis.xreadgroup(
      "GROUP",
      "uploaders",
      "visual-review-active-worker",
      "COUNT",
      queueJobs.length,
      "STREAMS",
      queue,
      ">",
    );

    await redis.hset(stats, {
      enqueued: "143",
      uploaded: "127",
      dropped: "4",
      invalid: "9",
      retries: "6",
    });

    const workers = [
      {
        instanceId: "ReviewBroker-STO",
        configuredWorkers: 2,
        activeUploads: 1,
        uploadsSucceeded: 83,
        uploadsFailed: 2,
        lastUploadAt: now - 28_000,
        updatedAt: now,
      },
      {
        instanceId: "ReviewBroker-GOT",
        configuredWorkers: 2,
        activeUploads: 1,
        uploadsSucceeded: 44,
        uploadsFailed: 1,
        lastUploadAt: now - 51_000,
        updatedAt: now,
      },
    ];
    for (const worker of workers) {
      await redis.set(
        `${prefix}:workers:${encodeURIComponent(worker.instanceId)}`,
        JSON.stringify(worker),
        "PX",
        10 * 60 * 1000,
      );
    }

    const completed = [
      {
        at: now - 28_000,
        status: "uploaded",
        requestId: "visual-review-history-1",
        nodeName: "Taknod Vasastan",
        nodePublicKey: "3".repeat(64),
        advertType: "REPEATER",
        observerName: observers[0].label,
        workerInstanceId: "ReviewBroker-STO",
        detail: "NODES_INSERTED",
      },
      {
        at: now - 74_000,
        status: "uploaded",
        requestId: "visual-review-history-2",
        nodeName: "Göteborg Hamn",
        nodePublicKey: "4".repeat(64),
        advertType: "SENSOR",
        observerName: observers[1].label,
        workerInstanceId: "ReviewBroker-GOT",
        detail: "ERR_ADVERT_DUPLICATE",
      },
      {
        at: now - 132_000,
        status: "dropped",
        requestId: "visual-review-history-3",
        nodeName: "Äldre testnod",
        nodePublicKey: "5".repeat(64),
        advertType: "ROOM",
        observerName: observers[2].label,
        workerInstanceId: "ReviewBroker-STO",
        detail: "Maximalt antal uppladdningsförsök uppnått",
      },
    ];
    await redis.del(history);
    if (completed.length > 0) {
      await redis.rpush(
        history,
        ...completed.map((entry) => JSON.stringify(entry)),
      );
    }

    console.log(
      `Seeded Meshcore.io dashboard data (${queueJobs.length} active jobs, ${workers.length} broker workers)`,
    );
  } finally {
    redis.disconnect(false);
  }
}

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
    instanceId: "DashboardSeeder",
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

    const mutedStore = stores.get("ReviewBroker-GOT");
    await mutedStore.setTrustState(
      observers[1].publicKey,
      JSON.stringify({
        status: "muted",
        muteReason: "anomaly:packet_size",
        abuseBlockCount: 3,
        mutedAt: now - 12 * 60_000,
        mutedUntil: now + 48 * 60 * 60_000,
        username: observers[1].label,
      }),
    );

    await mutedStore.setTrustState(
      observers[3].publicKey,
      JSON.stringify({
        status: "would_mute",
        muteReason: "rate_limit_exceeded",
        abuseBlockCount: 1,
        mutedAt: now - 3 * 60_000,
        mutedUntil: now + 15 * 60_000,
        username: observers[3].label,
      }),
    );

    await mutedStore.recordDeniedPublish({
      node: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
      label: "Ogiltig IATA-demo",
      reason: "Fel IATA-kod",
      topic:
        "meshcore/XYZ/EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE/status",
      region: "XYZ",
      deniedUntilText: "Ändra till STO eller GOT",
    });

    console.log(`Seeded dashboard review data in ${namespace} at ${kvUrl}`);

    const stoStore = stores.get("ReviewBroker-STO");
    const gotStore = stores.get("ReviewBroker-GOT");
    await stoStore.tryRegisterSubscriberConnection(
      "visual-review",
      "seed-sub-sto-1",
      10,
    );
    await stoStore.tryRegisterSubscriberConnection(
      "visual-review",
      "seed-sub-sto-2",
      10,
    );
    await gotStore.tryRegisterSubscriberConnection(
      "visual-review",
      "seed-sub-got-1",
      10,
    );
    console.log(
      "Seeded subscriber connections for visual-review (STO:2, GOT:1)",
    );
    await seedMeshcoreIoDemo(now);
  } finally {
    await Promise.all(
      Array.from(stores.values()).map((store) => store.disconnect()),
    );
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
