import type { Transaction } from "./database.js";
import { regionScopeEntry } from "./region-scopes.js";

/**
 * Derived region scope aggregate over retained neighbor evidence.
 *
 * `meshcore_public.region_scopes` is a derived aggregate, not append-only
 * history. Counts and boundaries are always rebuilt from retained
 * `neighbor_snapshot_scopes`/`neighbor_entry_scopes` evidence so that
 * reprocessing is idempotent and retention removes evidence correctly.
 *
 * Every region row keeps its catalog metadata (`region`, `name`,
 * `manually_added`); rows with no retained evidence are reset to
 * observation_count 0 and NULL boundaries instead of being deleted.
 */

const EVIDENCE_SQL = `(
  SELECT nes.scope AS scope, snapshot.received_at_ms AS received_at_ms
  FROM neighbor_snapshot_scopes nes
  JOIN neighbor_snapshots snapshot ON snapshot.id = nes.snapshot_id
  UNION ALL
  SELECT nese.scope AS scope, snapshot.received_at_ms AS received_at_ms
  FROM neighbor_entry_scopes nese
  JOIN neighbor_entries entry ON entry.id = nese.entry_id
  JOIN neighbor_snapshots snapshot ON snapshot.id = entry.snapshot_id
)`;

export async function ensureRegionScopeRow(
  transaction: Transaction,
  scope: string,
): Promise<void> {
  await transaction.run(
    `INSERT INTO meshcore_public.region_scopes(region, name)
     VALUES ($1, $2)
     ON CONFLICT(region) DO UPDATE SET name = EXCLUDED.name
     WHERE meshcore_public.region_scopes.name IS DISTINCT FROM EXCLUDED.name`,
    scope,
    regionScopeEntry(scope).name,
  );
}

/**
 * Recomputes the registry rows for the given scopes (or every scope with
 * evidence when `scopes` is empty) from retained neighbor evidence.
 */
export async function rebuildRegionScopes(
  transaction: Transaction,
  scopes?: string[],
): Promise<void> {
  const filter =
    scopes !== undefined && scopes.length > 0
      ? "WHERE evidence.scope = ANY($1::text[])"
      : "";
  await transaction.run(
    `WITH evidence AS (
       SELECT scope, received_at_ms FROM ${EVIDENCE_SQL}
     ), aggregates AS (
       SELECT evidence.scope,
         count(*) AS observation_count,
         min(evidence.received_at_ms) AS first_seen_at_ms,
         max(evidence.received_at_ms) AS last_seen_at_ms
       FROM evidence
       ${filter}
       GROUP BY evidence.scope
     )
     UPDATE meshcore_public.region_scopes registry SET
       first_seen_at_ms = aggregates.first_seen_at_ms,
       last_seen_at_ms = aggregates.last_seen_at_ms,
       observation_count = aggregates.observation_count
     FROM aggregates
     WHERE registry.region = aggregates.scope
       AND (registry.first_seen_at_ms, registry.last_seen_at_ms, registry.observation_count)
         IS DISTINCT FROM
           (aggregates.first_seen_at_ms, aggregates.last_seen_at_ms, aggregates.observation_count)`,
    ...(scopes !== undefined && scopes.length > 0 ? [scopes] : []),
  );
  if (scopes === undefined || scopes.length === 0) return;
  await transaction.run(
    `UPDATE meshcore_public.region_scopes registry SET
       first_seen_at_ms = NULL, last_seen_at_ms = NULL, observation_count = 0
     WHERE registry.region = ANY($1::text[])
       AND (registry.first_seen_at_ms IS NOT NULL
         OR registry.last_seen_at_ms IS NOT NULL
         OR registry.observation_count <> 0)
       AND NOT EXISTS (
         SELECT 1 FROM ${EVIDENCE_SQL} evidence
         WHERE evidence.scope = registry.region
       )`,
    scopes,
  );
}

/** Returns every region scope evidenced by the given mqtt events. */
export async function regionScopesForEvents(
  transaction: Transaction,
  eventIds: number[],
): Promise<string[]> {
  if (eventIds.length === 0) return [];
  const placeholders = eventIds.map((_, index) => `$${index + 1}`).join(",");
  const rows = await transaction.all<{ scope: string }>(
    `SELECT nes.scope FROM neighbor_snapshot_scopes nes
     JOIN neighbor_snapshots snapshot ON snapshot.id = nes.snapshot_id
     WHERE snapshot.mqtt_event_id IN (${placeholders})
     UNION
     SELECT nese.scope FROM neighbor_entry_scopes nese
     JOIN neighbor_entries entry ON entry.id = nese.entry_id
     JOIN neighbor_snapshots snapshot ON snapshot.id = entry.snapshot_id
     WHERE snapshot.mqtt_event_id IN (${eventIds.map((_, index) => `$${eventIds.length + index + 1}`).join(",")})`,
    ...eventIds,
    ...eventIds,
  );
  return [...new Set(rows.map((row) => row.scope))];
}
