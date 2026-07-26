import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixturePublicKey(index) {
  return index.toString(16).toUpperCase().padStart(64, "0");
}

function buildMessages(baseTime, count, topicBase) {
  const msgs = [];
  for (let i = 0; i < count; i++) {
    msgs.push({
      topic: `${topicBase}/${String.fromCharCode(97 + (i % 26))}${i}`,
      bytes: 30 + ((i * 7) % 200),
      receivedAt: baseTime - i * 45_000,
    });
  }
  return msgs;
}

function buildNeighbors(count) {
  const neighbors = [];
  for (let i = 0; i < count; i++) {
    neighbors.push({
      publicKey: fixturePublicKey(100 + i),
      snr: 15 - i * 1.5 + (Math.random() * 2 - 1),
      heardSecsAgo: i * 45 + Math.floor(Math.random() * 30),
      scopes: [`ch${i % 4}`],
      status: i < 6 ? "responded" : i < 12 ? "timeout" : "send_failed",
    });
  }
  return neighbors;
}

async function main() {
  const distDatabase = path.resolve(__dirname, "../dist/database.js");
  const { openTestDatabase, DATABASE_DIRECTORY } = await import(distDatabase);
  const distInstanceId = path.resolve(__dirname, "../dist/instance-id.js");
  const { resolveBrokerInstanceId } = await import(distInstanceId);

  const brokerId = resolveBrokerInstanceId({
    brokerName: "ReviewBroker",
    persist: true,
    runtimeIdFile: process.env.BROKER_RUNTIME_ID_FILE || undefined,
  });

  await mkdir(DATABASE_DIRECTORY, { recursive: true });
  const dbFile = path.join(DATABASE_DIRECTORY, "meshcore-mqtt-broker.db");
  const db = await openTestDatabase(dbFile);

  let observerKeyPairs = [];
  try {
    const raw = await readFile("/tmp/dashboard-observer-keys.json", "utf-8");
    observerKeyPairs = JSON.parse(raw);
    console.log(`Read ${observerKeyPairs.length} observer keys from file`);
  } catch {
    console.warn("No observer key file found, using generated keys");
  }

  function getObserverKey(index) {
    if (observerKeyPairs[index]) return observerKeyPairs[index].publicKey;
    return fixturePublicKey(index + 1);
  }

  try {
    const now = Date.now();
    const day = 86_400_000;
    const far = now + 365 * day;

    const observerDefs = [
      {
        suffix: "A",
        label: "Stockholm Rooftop",
        region: "STO",
        messageCount: 438,
        hasNeighbors: true,
      },
      {
        suffix: "B",
        label: "Gothenburg Ridge",
        region: "GOT",
        messageCount: 204,
        hasNeighbors: false,
      },
      {
        suffix: "C",
        label: "Jönköping Relay",
        region: "JKG",
        messageCount: 97,
        hasNeighbors: false,
      },
      {
        suffix: "D",
        label: "Malmö Shadow Mode",
        region: "MMX",
        messageCount: 16,
        hasNeighbors: false,
      },
      {
        suffix: "E",
        label: "Silent Umeå",
        region: null,
        messageCount: 0,
        hasNeighbors: false,
      },
      {
        suffix: "LONGOBS",
        label:
          "Very Long Observer Name That Might Overflow Table Cells In Some Viewports",
        region: "STO",
        messageCount: 1250,
        hasNeighbors: true,
      },
      {
        suffix: "MANYMSG",
        label: "Chatty Node",
        region: "STO",
        messageCount: 50,
        hasNeighbors: false,
        maxMessages: 50,
      },
    ];

    for (const [idx, def] of observerDefs.entries()) {
      const pk = getObserverKey(idx);
      const maxMsgs = def.maxMessages || 5;
      const messages = buildMessages(
        now,
        Math.min(def.messageCount, maxMsgs),
        `meshcore/${def.region || "TEST"}/${pk}`,
      );
      const neighbors = def.hasNeighbors ? buildNeighbors(15) : undefined;

      await db.run(
        `INSERT OR REPLACE INTO observer_profiles (public_key, node_name, node_name_expires_at_ms, latest_status_at_ms, status_expires_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [pk, def.label, far, now, far],
      );
      await db.run(
        `INSERT OR REPLACE INTO observer_state (public_key, label, broker, region, active, last_connected_at_ms, last_seen_at_ms, message_count, messages_json, neighbors_json, neighbors_expires_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pk,
          def.label,
          brokerId,
          def.region || null,
          def.messageCount > 0 ? 1 : 0,
          now - 120_000,
          def.messageCount > 0 ? now - 30_000 : now - 3_600_000,
          def.messageCount,
          JSON.stringify(messages),
          neighbors
            ? JSON.stringify({
                receivedAt: now - 120_000,
                reportedAt: now - 150_000,
                selfScopes: ["ch0", "ch1", "ch2"],
                invalidEntryCount: 2,
                neighbors,
              })
            : null,
          neighbors ? far : null,
          now,
        ],
      );
    }

    const bans = [
      {
        suffix: "BAD01",
        label: "Bad Observer Alpha",
        reason: "invalid_iata",
        deniedUntilText: "Korrigera IATA",
        topic: "meshcore/BAD/BAD01/packets",
        region: "STO",
      },
      {
        suffix: "BAD02",
        label: "Spammy Node",
        reason: "rate_limit_exceeded",
        deniedUntilText: null,
        topic: "meshcore/STO/BAD02/status",
        region: "STO",
      },
      {
        suffix: "BAD03",
        label: "Drifting Node",
        reason: "iata_changes_exceeded",
        deniedUntilText: "Change to STO or GOT",
        topic: "meshcore/BAD/BAD03/telemetry",
        region: "MMX",
      },
    ];

    for (const [i, ban] of bans.entries()) {
      const pk = getObserverKey(6 + i);
      await db.run(
        `INSERT OR REPLACE INTO observer_profiles (public_key, node_name, node_name_expires_at_ms, latest_status_at_ms, status_expires_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [pk, ban.label, far, now, far],
      );
      await db.run(
        `INSERT OR REPLACE INTO observer_state (public_key, label, broker, region, active, last_connected_at_ms, last_seen_at_ms, message_count, messages_json, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pk,
          ban.label,
          brokerId,
          ban.region,
          1,
          now - 60_000,
          now - 20_000,
          42,
          JSON.stringify([]),
          now,
        ],
      );
      await db.run(
        `INSERT OR REPLACE INTO trust_state (public_key, state_json, status, muted_until_ms, updated_at_ms, expires_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [pk, JSON.stringify({}), "denied", far, now, far],
      );
      await db.run(
        `INSERT OR REPLACE INTO denied_publish_events (id, public_key, label, broker, reason, topic, region, denied_until_text, created_at_ms, expires_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          pk,
          ban.label,
          brokerId,
          ban.reason,
          ban.topic,
          ban.region,
          ban.deniedUntilText,
          now - (bans.indexOf(ban) + 1) * 3_600_000,
          far,
        ],
      );
    }

    const meshcoreIoAdverts = [
      {
        nodeName: "Uppsala Field Sensor",
        nodePublicKey: fixturePublicKey(300),
        advertType: "sensor",
        latitude: 59.8586,
        longitude: 17.6389,
        observerName: "Stockholm Rooftop",
        at: now - 300_000,
      },
      {
        nodeName: "Vasastan Rooftop",
        nodePublicKey: fixturePublicKey(301),
        advertType: "repeater",
        latitude: 59.3434,
        longitude: 18.0492,
        observerName: "Stockholm Rooftop",
        at: now - 600_000,
      },
      {
        nodeName: "Gothenburg Harbor",
        nodePublicKey: fixturePublicKey(302),
        advertType: "room",
        latitude: 57.7089,
        longitude: 11.9746,
        observerName: "Gothenburg Ridge",
        at: now - 900_000,
      },
      {
        nodeName: "Malmö Gateway",
        nodePublicKey: fixturePublicKey(303),
        advertType: "repeater",
        latitude: 55.605,
        longitude: 13.0038,
        observerName: "Malmö Shadow Mode",
        at: now - 1_200_000,
      },
      {
        nodeName: "Jönköping Tower",
        nodePublicKey: fixturePublicKey(304),
        advertType: "sensor",
        latitude: 57.7826,
        longitude: 14.1618,
        observerName: "Jönköping Relay",
        at: now - 1_500_000,
      },
      {
        nodeName: "Umeå Arctic Station",
        nodePublicKey: fixturePublicKey(305),
        advertType: "room",
        latitude: 63.8258,
        longitude: 20.263,
        observerName: "Silent Umeå",
        at: now - 1_800_000,
      },
    ];

    for (const advert of meshcoreIoAdverts) {
      const requestId = randomUUID();
      await db.run(
        `INSERT OR REPLACE INTO meshcore_io_jobs (request_id, deduplication_key, node_public_key, job_json, status, created_at_ms, next_attempt_at_ms, attempt_count, processing_started_at_ms, completed_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          requestId,
          `node:${advert.nodePublicKey}`,
          advert.nodePublicKey,
          JSON.stringify(advert),
          "completed",
          advert.at - 1000,
          advert.at - 1000,
          1 + (meshcoreIoAdverts.indexOf(advert) % 3),
          advert.at,
          advert.at,
        ],
      );
      await db.run(
        `INSERT OR REPLACE INTO meshcore_io_map (node_public_key, advert_json, at_ms)
         VALUES (?, ?, ?)`,
        [advert.nodePublicKey, JSON.stringify(advert), advert.at],
      );
      const statuses = [
        "uploaded",
        "uploaded",
        "uploaded",
        "uploaded",
        "dropped",
        "uploaded",
      ];
      await db.run(
        `INSERT OR REPLACE INTO meshcore_io_history (at_ms, request_id, node_name, node_public_key, advert_type, observer_name, worker_instance_id, status, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          advert.at,
          requestId,
          advert.nodeName,
          advert.nodePublicKey,
          advert.advertType,
          advert.observerName,
          brokerId,
          statuses[meshcoreIoAdverts.indexOf(advert)],
          statuses[meshcoreIoAdverts.indexOf(advert)] === "dropped"
            ? "Network timeout"
            : null,
        ],
      );
    }

    await db.run(
      `INSERT OR REPLACE INTO meshcore_io_stats (singleton, enqueued, uploaded, dropped, invalid, retries, last_error)
       VALUES (1, 8, 6, 1, 1, 2, NULL)`,
    );

    console.log(
      `Seeded ${observerDefs.length} observers + ${bans.length} bans + ${meshcoreIoAdverts.length} map adverts into ${DATABASE_DIRECTORY}`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
