import { Pool } from "pg";
import { openTestDatabase } from "../dist/database.js";
import { MqttHistoryService } from "../dist/mqtt-history.js";

const RECEIPTS_PER_DAY = 101_633;
const DEDUPLICATED_TRANSMISSIONS_PER_DAY = 22_222;
const CONCURRENCY = 8;
// These exceed the expected daily rates (1.18 receipts and 0.26 transmissions/sec).
const MIN_RECEIPTS_PER_SECOND = 2;
const MIN_DEDUPLICATED_TRANSMISSIONS_PER_SECOND = 1;
const CONFIRMATION = "run-isolated-ingest-benchmark";
const OBSERVER_PUBLIC_KEY = "A".repeat(64);
// Keep the fixed benchmark clock before real claim timestamps to avoid stale-claim recovery.
const RECEIVED_AT_MS = 1_700_000_000_000;

function benchmarkConnectionString() {
  const connectionString = process.env.POSTGRES_TEST_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "POSTGRES_TEST_URL must name a dedicated PostgreSQL test database",
    );
  }
  if (process.env.POSTGRES_INGEST_BENCHMARK_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `Set POSTGRES_INGEST_BENCHMARK_CONFIRM=${CONFIRMATION} to run this destructive benchmark setup`,
    );
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("POSTGRES_TEST_URL must be a PostgreSQL URL");
  }
  if (!/^postgres(?:ql)?:$/.test(url.protocol)) {
    throw new Error("POSTGRES_TEST_URL must use postgres:// or postgresql://");
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!/(?:test|bench)/i.test(database)) {
    throw new Error(
      "POSTGRES_TEST_URL must name a database containing 'test' or 'bench'",
    );
  }
  return connectionString;
}

function packetHex(index) {
  return index.toString(16).padStart(64, "0");
}

function packet(index) {
  return {
    cmd: "publish",
    topic: `meshcore/STO/${OBSERVER_PUBLIC_KEY}/packets`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: OBSERVER_PUBLIC_KEY,
        raw: packetHex(index % DEDUPLICATED_TRANSMISSIONS_PER_DAY),
        timestamp: RECEIVED_AT_MS + index,
        rssi: -90,
        snr: 5,
      }),
    ),
    qos: 0,
    retain: false,
    dup: false,
  };
}

const deterministicDecoder = {
  name: "benchmark-deterministic",
  version: "1",
  async decode() {
    return {
      status: "decoded",
      packetType: "RAW_CUSTOM",
      packetTypeCode: 15,
      payloadType: "RAW_CUSTOM",
      payloadTypeCode: 15,
      routeType: "FLOOD",
    };
  },
};

async function resetSchemas(connectionString) {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    // The benchmark is destructive only within the broker's test schemas.
    await pool.query("DROP SCHEMA IF EXISTS meshcore_public CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS meshcore_private CASCADE");
  } finally {
    await pool.end();
  }
}

async function count(database, table) {
  const row = await database.get(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(row?.count);
}

async function main() {
  const connectionString = benchmarkConnectionString();
  let database;
  let histories = [];

  try {
    await resetSchemas(connectionString);
    database = await openTestDatabase({
      connectionString,
      schema: "meshcore_private",
      poolMax: CONCURRENCY,
    });
    histories = Array.from(
      { length: CONCURRENCY },
      (_, worker) =>
        new MqttHistoryService(
          database,
          {
            retentionDays: 30,
            cleanupIntervalMinutes: 60,
            cleanupBatchSize: 200,
            storeInternal: false,
            storeSerial: false,
          },
          `postgres-ingest-benchmark-${worker}`,
          {
            decoder: deterministicDecoder,
            now: () => RECEIVED_AT_MS,
            startLoops: false,
          },
        ),
    );
    await Promise.all(histories.map((history) => history.start()));

    const startedAt = performance.now();
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async (_, worker) => {
        for (
          let observation = worker;
          observation < RECEIPTS_PER_DAY;
          observation += CONCURRENCY
        ) {
          await histories[worker].capturePublish(packet(observation));
        }
      }),
    );
    await Promise.all(histories.map((history) => history.stop()));
    const elapsedSeconds = (performance.now() - startedAt) / 1_000;

    const counts = await Promise.all([
      count(database, "meshcore_private.mqtt_events"),
      count(database, "meshcore_private.packets"),
      count(database, "meshcore_private.packet_observations"),
      count(database, "meshcore_public.packets"),
      count(database, "meshcore_public.packet_observations"),
    ]);
    const expected = [
      RECEIPTS_PER_DAY,
      DEDUPLICATED_TRANSMISSIONS_PER_DAY,
      RECEIPTS_PER_DAY,
      DEDUPLICATED_TRANSMISSIONS_PER_DAY,
      RECEIPTS_PER_DAY,
    ];
    if (counts.some((value, index) => value !== expected[index])) {
      throw new Error(
        `Unexpected private receipt/packet/observation and public packet/observation counts: ${counts.join(", ")}`,
      );
    }

    const receiptRate = RECEIPTS_PER_DAY / elapsedSeconds;
    const packetRate = DEDUPLICATED_TRANSMISSIONS_PER_DAY / elapsedSeconds;
    console.log(
      `PostgreSQL ingest benchmark: ${receiptRate.toFixed(1)} receipts/observations/s, ${packetRate.toFixed(1)} deduplicated transmissions/s (${elapsedSeconds.toFixed(2)}s)`,
    );
    if (
      receiptRate < MIN_RECEIPTS_PER_SECOND ||
      packetRate < MIN_DEDUPLICATED_TRANSMISSIONS_PER_SECOND
    ) {
      throw new Error(
        `Throughput below minimum: require ${MIN_RECEIPTS_PER_SECOND} receipts/observations/s and ${MIN_DEDUPLICATED_TRANSMISSIONS_PER_SECOND} deduplicated transmissions/s`,
      );
    }
  } finally {
    await Promise.all(
      histories.map((history) => history.stop().catch(() => undefined)),
    );
    await database?.close().catch(() => undefined);
    await resetSchemas(connectionString);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
