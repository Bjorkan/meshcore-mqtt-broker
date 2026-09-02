#!/usr/bin/env bun
import { createSqlInstance, reserveSession } from "../src/database.js";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required");
const sql = createSqlInstance(
  { connectionString, max: 1, query_timeout: 15_000 },
  { searchPath: false },
);
const client = await reserveSession(sql);
const unavailableSections = [];

async function all(query, parameters = []) {
  return client.unsafe(query, parameters);
}
async function optionalAll(section, query, parameters = []) {
  try {
    return await all(query, parameters);
  } catch (error) {
    unavailableSections.push({
      section,
      reason: error instanceof Error ? error.message : "query unavailable",
    });
    return null;
  }
}
async function installed(extension) {
  const rows = await all(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = $1) AS found",
    [extension],
  );
  return rows[0]?.found === true;
}
function stringify(value) {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}

try {
  const hasPgStatStatements = await installed("pg_stat_statements");
  const hasTimescale = await installed("timescaledb");
  const report = {
    sampledAt: new Date().toISOString(),
    extensions: await all(
      "SELECT extname, extversion FROM pg_extension ORDER BY extname",
    ),
    settings: await all(
      `SELECT name, setting, unit FROM pg_settings
       WHERE name = ANY($1::text[]) ORDER BY name`,
      [
        "{shared_buffers,effective_cache_size,work_mem,maintenance_work_mem,max_connections,max_worker_processes,max_parallel_workers,shared_preload_libraries,track_io_timing,track_wal_io_timing}",
      ],
    ),
    database: await all(
      `SELECT datname, numbackends, xact_commit, xact_rollback, blks_read, blks_hit,
              tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted,
              temp_files, temp_bytes, deadlocks
       FROM pg_stat_database WHERE datname = current_database()`,
    ),
    sessions: await all(
      `SELECT state, wait_event_type, wait_event, count(*) AS sessions
       FROM pg_stat_activity WHERE datname = current_database()
       GROUP BY state, wait_event_type, wait_event
       ORDER BY count(*) DESC`,
    ),
    blockedSessions: await all(
      `SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocking_pids,
              xact_start, query_start
       FROM pg_stat_activity
       WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0
       ORDER BY query_start NULLS LAST`,
    ),
    lockWaitDetails: await all(
      `SELECT waiting.pid AS waiting_pid, blocker.pid AS blocking_pid,
              waiting.state AS waiting_state, waiting.wait_event_type, waiting.wait_event,
              waiting.xact_start AS waiting_xact_start,
              blocking.xact_start AS blocking_xact_start,
              lock_row.locktype, lock_row.relation::regclass::text AS relation,
              lock_row.page, lock_row.tuple, lock_row.transactionid::text AS transaction_id,
              lock_row.virtualxid, lock_row.mode AS waiting_mode, lock_row.waitstart
       FROM pg_stat_activity waiting
       CROSS JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) AS blocker(pid)
       LEFT JOIN pg_stat_activity blocking ON blocking.pid = blocker.pid
       LEFT JOIN pg_locks lock_row ON lock_row.pid = waiting.pid AND NOT lock_row.granted
       WHERE waiting.datname = current_database()
       ORDER BY waiting.xact_start NULLS LAST, waiting.pid, blocker.pid
       LIMIT 200`,
    ),
    relations: await all(
      `SELECT schemaname, relname, n_live_tup, n_dead_tup,
              pg_total_relation_size(relid) AS total_bytes,
              pg_relation_size(relid) AS heap_bytes,
              pg_indexes_size(relid) AS index_bytes,
              autovacuum_count, autoanalyze_count
       FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 50`,
    ),
    indexes: await all(
      `SELECT schemaname, relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch,
              pg_relation_size(indexrelid) AS bytes
       FROM pg_stat_user_indexes ORDER BY pg_relation_size(indexrelid) DESC LIMIT 100`,
    ),
    locks: await all(
      `SELECT locktype, mode, granted, count(*) AS count
       FROM pg_locks GROUP BY locktype, mode, granted ORDER BY granted, count(*) DESC`,
    ),
    topQueriesByTotalTime: hasPgStatStatements
      ? await optionalAll(
          "pg_stat_statements_by_total_time",
          `SELECT queryid, calls, total_exec_time, mean_exec_time, max_exec_time, rows,
                  shared_blks_hit, shared_blks_read, shared_blks_dirtied, shared_blks_written,
                  temp_blks_read, temp_blks_written,
                  COALESCE((to_jsonb(s)->>'wal_bytes')::numeric, 0) AS wal_bytes
           FROM pg_stat_statements s
           ORDER BY total_exec_time DESC LIMIT 30`,
        )
      : null,
    topQueriesByCalls: hasPgStatStatements
      ? await optionalAll(
          "pg_stat_statements_by_calls",
          `SELECT queryid, calls, total_exec_time, mean_exec_time, rows,
                  shared_blks_hit, shared_blks_read,
                  COALESCE((to_jsonb(s)->>'wal_bytes')::numeric, 0) AS wal_bytes
           FROM pg_stat_statements s
           ORDER BY calls DESC LIMIT 30`,
        )
      : null,
    timescaleHypertables: hasTimescale
      ? await optionalAll(
          "timescale_hypertables",
          `SELECT hypertable_schema, hypertable_name, num_dimensions, num_chunks,
                  compression_enabled
           FROM timescaledb_information.hypertables
           ORDER BY hypertable_schema, hypertable_name`,
        )
      : null,
    timescaleChunks: hasTimescale
      ? await optionalAll(
          "timescale_chunks",
          `SELECT hypertable_schema, hypertable_name, count(*) AS chunks,
                  min(range_start_integer) AS oldest_start,
                  max(range_end_integer) AS newest_end
           FROM timescaledb_information.chunks
           GROUP BY hypertable_schema, hypertable_name
           ORDER BY hypertable_schema, hypertable_name`,
        )
      : null,
    unavailableSections,
  };
  console.log(stringify(report));
} finally {
  client.release();
  await sql.close({ timeout: 1 }).catch(() => undefined);
}
