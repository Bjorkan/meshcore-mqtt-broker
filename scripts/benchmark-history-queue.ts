#!/usr/bin/env bun
import {
  HISTORY_FRESH_CLAIMS_PER_BACKFILL,
  MqttEventRepository,
} from "../src/mqtt-history-repositories.js";
import { temporaryDatabase } from "../tests/test-database.mjs";

const confirmation = "run-isolated-history-queue-benchmark";
const connectionString = process.env.POSTGRES_TEST_URL?.trim();
if (!connectionString)
  throw new Error("POSTGRES_TEST_URL must name an isolated test database");
const databaseName = new URL(connectionString).pathname.slice(1).toLowerCase();
if (!databaseName.includes("test") && !databaseName.includes("bench"))
  throw new Error("benchmark database name must contain test or bench");
if (process.env.POSTGRES_HISTORY_QUEUE_BENCHMARK_CONFIRM !== confirmation)
  throw new Error(
    `POSTGRES_HISTORY_QUEUE_BENCHMARK_CONFIRM must equal ${confirmation}`,
  );

const fixture = await temporaryDatabase("history-queue-benchmark-");
const database = fixture.database;
try {
  await database.run("TRUNCATE mqtt_events RESTART IDENTITY CASCADE");
  const seedStartedAt = performance.now();
  for (let start = 1; start <= 1_000_000; start += 100_000) {
    await database.run(
      `INSERT INTO mqtt_events(
        topic, payload_blob, payload_text, payload_sha256, qos, retain, dup,
        received_at_ms, payload_format, parse_status, processing_status,
        processing_attempts, parser_name, parser_version, collector_instance_id,
        created_at_ms, updated_at_ms
      )
      SELECT
        'meshcore/STO/' || repeat('A', 64) || '/benchmark',
        '\\x7b7d'::bytea, '{}', repeat('0', 64), 0, false, false,
        1700000000000 + value, 'json', 'parsed',
        CASE WHEN value <= 990000 THEN 'processed' ELSE 'pending' END,
        CASE WHEN value <= 990000 THEN 1 ELSE 0 END,
        'benchmark', '1', 'benchmark', 1700000000000 + value,
        1700000000000 + value
      FROM generate_series($1, $2) AS value`,
      start,
      start + 99_999,
    );
  }
  const seedDurationMs = performance.now() - seedStartedAt;

  const plans = {};
  for (const direction of ["ASC", "DESC"]) {
    plans[direction.toLowerCase()] = await database.all(
      direction === "ASC"
        ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
           SELECT id FROM mqtt_events WHERE processing_status = 'pending'
           ORDER BY id ASC LIMIT 1`
        : `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
           SELECT id FROM mqtt_events WHERE processing_status = 'pending'
           ORDER BY id DESC LIMIT 1`,
    );
  }

  const repository = new MqttEventRepository(database);
  const claimStartedAt = performance.now();
  const claims = [];
  for (let index = 0; index <= HISTORY_FRESH_CLAIMS_PER_BACKFILL; index += 1) {
    claims.push(await repository.claimNext(0));
    await repository.insertReceived({
      topic: `meshcore/STO/${"A".repeat(64)}/benchmark`,
      payload: Buffer.from("{}"),
      qos: 0,
      retain: false,
      dup: false,
      receivedAtMs: 1_900_000_000_000 + index,
      collectorInstanceId: "benchmark",
      parserName: "benchmark",
      parserVersion: "1",
    });
  }
  const claimDurationMs = performance.now() - claimStartedAt;
  if (claims.at(-1)?.lane !== "backfill")
    throw new Error("weighted claim policy did not select the backfill lane");

  console.log(
    JSON.stringify(
      {
        rows: 1_000_000,
        initialPendingRows: 10_000,
        freshClaimsPerBackfill: HISTORY_FRESH_CLAIMS_PER_BACKFILL,
        seedDurationMs,
        fiveClaimsWithContinuousIngressMs: claimDurationMs,
        claimed: claims,
        plans,
      },
      null,
      2,
    ),
  );
} finally {
  await fixture.cleanup();
}
