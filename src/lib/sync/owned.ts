import { getDb } from '../db';
import { getStoredAuth } from '../auth/store';
import { fetchInitialCollection, paginateCollection } from '../bandcamp/fanapi';
import { validateCookies } from '../bandcamp/auth';
import type { BcCollectionItem, BcCollectionPage } from '../bandcamp/types';
import { autoMatchOwnedToWishlist } from '../wishlist/store';

export interface SyncResult {
  runId: number;
  itemsSynced: number;
  totalKnown: number | null;
  itemsRemoved: number;
  wishlistAutoMarked: number;
  durationMs: number;
}

function upsertItemStmt() {
  return getDb().prepare(
    `INSERT INTO collection_items (
       bc_item_id, bc_item_type, bc_url, title, artist_name, artist_url,
       album_title, label_name, band_id, cover_url, purchased_at, raw_json,
       last_seen_run_id, removed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (bc_item_id, bc_item_type) DO UPDATE SET
       bc_url = excluded.bc_url,
       title = excluded.title,
       artist_name = excluded.artist_name,
       artist_url = excluded.artist_url,
       album_title = excluded.album_title,
       label_name = excluded.label_name,
       band_id = excluded.band_id,
       cover_url = excluded.cover_url,
       purchased_at = COALESCE(excluded.purchased_at, collection_items.purchased_at),
       raw_json = excluded.raw_json,
       last_seen_run_id = excluded.last_seen_run_id,
       removed_at = NULL`,
  );
}

function persistItems(items: BcCollectionItem[], runId: number): void {
  const stmt = upsertItemStmt();
  const tx = getDb().transaction((batch: BcCollectionItem[]) => {
    for (const it of batch) {
      stmt.run(
        it.bcItemId,
        it.bcItemType,
        it.bcUrl,
        it.title,
        it.artistName,
        it.artistUrl,
        it.albumTitle,
        it.labelName,
        it.bandId,
        it.coverUrl,
        it.purchasedAt,
        it.rawJson,
        runId,
      );
    }
  });
  tx(items);
}

/**
 * Mark stale `running` rows from earlier crashes as `error` so a fresh
 * sync starts from clean state and "is sync active?" guards in later
 * phases can rely on the table.
 */
export function reapStaleSyncRuns(): number {
  const info = getDb()
    .prepare(
      `UPDATE sync_runs SET status = 'error',
         finished_at = datetime('now'),
         error_message = COALESCE(error_message, 'process restarted before sync completed')
       WHERE status = 'running'`,
    )
    .run();
  return info.changes;
}

function startRun(kind: string): number {
  const info = getDb()
    .prepare(`INSERT INTO sync_runs (kind, status) VALUES (?, 'running')`)
    .run(kind);
  return Number(info.lastInsertRowid);
}

function finishRun(
  runId: number,
  status: 'success' | 'error',
  itemsSynced: number,
  totalKnown: number | null,
  errorMessage: string | null,
): void {
  getDb()
    .prepare(
      `UPDATE sync_runs SET
         status = ?, finished_at = datetime('now'),
         items_synced = ?, items_total_known = ?, error_message = ?
       WHERE id = ?`,
    )
    .run(status, itemsSynced, totalKnown, errorMessage, runId);
}

/**
 * Tombstone rows that were not seen during this run (item must have been
 * removed from the user's bandcamp collection). We never DELETE because
 * later phases will reference these rows from playlists and tags; instead
 * we set `removed_at` so callers can filter via `WHERE removed_at IS NULL`.
 *
 * Cascades to child tracks: any track whose source_collection_item_id points
 * at a now-tombstoned item gets its own `removed_at` set.
 */
function tombstoneMissing(runId: number): number {
  const db = getDb();
  let itemChanges = 0;
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `UPDATE collection_items
           SET removed_at = datetime('now')
           WHERE removed_at IS NULL
             AND (last_seen_run_id IS NULL OR last_seen_run_id < ?)`,
      )
      .run(runId);
    itemChanges = info.changes;
    db.prepare(
      `UPDATE tracks
         SET removed_at = datetime('now')
         WHERE removed_at IS NULL
           AND source_collection_item_id IN (
             SELECT id FROM collection_items WHERE removed_at IS NOT NULL
           )`,
    ).run();
  });
  tx.immediate();
  return itemChanges;
}

/**
 * Full owned-collection sync. Re-validates the stored cookies up-front so
 * an expired session fails the sync explicitly, instead of persisting a
 * partial collection scraped from the public profile.
 */
export async function syncOwnedCollection(maxItems?: number): Promise<SyncResult> {
  const auth = getStoredAuth();
  if (!auth) throw new Error('no auth stored — run /setup first');

  // Pre-flight cookie validation: if cookies expired, fail before persisting
  // anything. The resolved fan_id+username must match what we stored to make
  // sure the cookies still belong to the same account.
  const reauth = await validateCookies(auth.cookieString);
  if (reauth.fanId !== auth.fanId || reauth.username !== auth.username) {
    throw new Error(
      `stored auth resolves to a different fan now (was ${auth.username}/${auth.fanId}, ` +
        `now ${reauth.username}/${reauth.fanId})`,
    );
  }

  const startedAt = Date.now();
  const runId = startRun('owned');
  let itemsSynced = 0;
  let totalKnown: number | null = null;

  try {
    const initial = await fetchInitialCollection(auth.username, auth.cookieString);
    totalKnown = initial.collectionTotal;
    if (initial.items.length) {
      persistItems(initial.items, runId);
      itemsSynced += initial.items.length;
    }
    if (initial.lastToken) {
      await paginateCollection({
        fanId: auth.fanId,
        initialLastToken: initial.lastToken,
        cookieString: auth.cookieString,
        maxItems,
        onPage: (page: BcCollectionPage) => {
          if (page.items.length) {
            persistItems(page.items, runId);
            itemsSynced += page.items.length;
          }
        },
      });
    }

    // Only tombstone when this run actually saw the full collection. We
    // require both: no maxItems cap AND itemsSynced reaches the
    // bandcamp-reported totalKnown. If totalKnown is unknown or the sync
    // ended short (parser glitch, dropped page, etc.), we skip tombstoning
    // so a transient partial sync cannot wipe legitimately owned rows.
    let itemsRemoved = 0;
    const fullSync =
      maxItems == null && totalKnown != null && itemsSynced >= totalKnown;
    if (fullSync) {
      itemsRemoved = tombstoneMissing(runId);
    }

    // After persisting fresh owned items, sweep the wishlist: any open row
    // whose bc_track_id is now in tracks/collection_items has been bought.
    let wishlistAutoMarked = 0;
    try {
      wishlistAutoMarked = autoMatchOwnedToWishlist().matchedCount;
    } catch {
      // wishlist sweep is best-effort; sync result remains successful.
    }

    finishRun(runId, 'success', itemsSynced, totalKnown, null);
    return {
      runId,
      itemsSynced,
      totalKnown,
      itemsRemoved,
      wishlistAutoMarked,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    finishRun(
      runId,
      'error',
      itemsSynced,
      totalKnown,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

export interface SyncRunSummary {
  id: number;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'error';
  itemsSynced: number;
  itemsTotalKnown: number | null;
  errorMessage: string | null;
}

export function getLatestSyncRun(kind = 'owned'): SyncRunSummary | null {
  const row = getDb()
    .prepare<
      [string],
      {
        id: number;
        kind: string;
        started_at: string;
        finished_at: string | null;
        status: 'running' | 'success' | 'error';
        items_synced: number;
        items_total_known: number | null;
        error_message: string | null;
      }
    >(
      `SELECT id, kind, started_at, finished_at, status, items_synced, items_total_known, error_message
       FROM sync_runs WHERE kind = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(kind);
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    itemsSynced: row.items_synced,
    itemsTotalKnown: row.items_total_known,
    errorMessage: row.error_message,
  };
}

export function getOwnedItemCount(): number {
  return (
    getDb()
      .prepare<
        [],
        { c: number }
      >('SELECT COUNT(*) AS c FROM collection_items WHERE removed_at IS NULL')
      .get() as { c: number }
  ).c;
}
