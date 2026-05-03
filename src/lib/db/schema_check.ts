import { getDb } from '.';

/**
 * A list of columns the running code currently reads or writes. If any of
 * these are missing from the live database, we have a schema drift —
 * exactly the failure mode that produced the `tracks.label_name` bug
 * earlier. Used as a startup smoke test so an out-of-date instance fails
 * loudly with "missing column X on Y" instead of "no such column" at the
 * first sync attempt.
 *
 * Keep this in sync with the most recent migration. Adding a new column
 * to migrations.ts? Add it here too.
 */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  auth: [
    'id',
    'role',
    'cookie_string',
    'fan_id',
    'username',
    'email',
    'crawl_target_username',
    'updated_at',
  ],
  collection_items: [
    'id',
    'bc_item_id',
    'bc_item_type',
    'bc_url',
    'title',
    'artist_name',
    'artist_url',
    'album_title',
    'label_name',
    'band_id',
    'cover_url',
    'purchased_at',
    'last_seen_run_id',
    'removed_at',
    'raw_json',
  ],
  tracks: [
    'id',
    'bc_track_id',
    'bc_album_id',
    'title',
    'artist_name',
    'artist_url',
    'artist_id',
    'label_id',
    'album_title',
    'album_url',
    'duration_seconds',
    'track_number',
    'cover_url',
    'bc_url',
    'stream_url',
    'stream_url_fetched_at',
    'released_at',
    'source_collection_item_id',
    'purchased_at',
    'last_seen_run_id',
    'removed_at',
    'bpm',
  ],
  sync_runs: [
    'id',
    'kind',
    'started_at',
    'finished_at',
    'status',
    'items_synced',
    'items_total_known',
    'error_message',
  ],
  wishlist: [
    'id',
    'bc_track_id',
    'status',
    'source',
    'added_at',
    'bought_at',
    'bought_via',
    'dismissed_at',
  ],
  digger_overlap: ['digger_id', 'overlap_count', 'sample_titles', 'last_computed_at', 'ignored_at'],
  digger_collection: ['digger_id', 'bc_item_id', 'bc_item_type', 'position', 'staged_run_at'],
  track_curation: ['track_id', 'rating', 'archived_at', 'updated_at'],
  sync_errors: ['id', 'run_kind', 'run_id', 'item_url', 'item_title', 'error_message', 'created_at'],
};

export interface SchemaIssue {
  table: string;
  column: string;
  reason: 'missing-table' | 'missing-column';
}

/**
 * Verify every required column exists. Returns a list of drifts; an empty
 * list means the running code matches the schema. The check is purely
 * read-only — no auto-repair, because a half-applied migration is a
 * support-conversation moment, not something to silently paper over.
 */
export function checkSchema(): SchemaIssue[] {
  const db = getDb();
  const issues: SchemaIssue[] = [];
  const tableExists = db.prepare<[string], { c: number }>(
    `SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?`,
  );
  for (const [table, requiredCols] of Object.entries(REQUIRED_COLUMNS)) {
    const found = tableExists.get(table);
    if (!found || found.c === 0) {
      issues.push({ table, column: '*', reason: 'missing-table' });
      continue;
    }
    const cols = db.pragma(`table_info(${table})`) as { name: string }[];
    const present = new Set(cols.map((c) => c.name));
    for (const col of requiredCols) {
      if (!present.has(col)) {
        issues.push({ table, column: col, reason: 'missing-column' });
      }
    }
  }
  return issues;
}
