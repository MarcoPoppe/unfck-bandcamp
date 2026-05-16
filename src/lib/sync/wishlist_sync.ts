import { getStoredMainAuth } from '../auth/store';
import { fetchInitialWishlist, fetchWishlistPage } from '../bandcamp/fan_wishlist';
import { runCollectionSyncForWishlistPrereq } from './collection_prereq';
import { isOwned } from '../wishlist/store';
import { getDb } from '../db';
import { createSyncRun, markSyncRun, updateSyncRun } from './runs';
import type { BcCollectionItem } from '../bandcamp/types';

export interface WishlistSyncResult {
  runId: number;
  ok: boolean;
  error?:
    | 'main_auth_missing'
    | 'collection_prereq_failed'
    | 'collection_prereq_partial'
    | 'fetch_failed'
    | 'size_mismatch';
  itemsSynced?: number;
}

const POLL_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Pull the user's Bandcamp wishlist into the local store. Strict ordering:
 *
 *   1. main-auth pre-flight (fail closed if missing).
 *   2. `runCollectionSyncForWishlistPrereq` — refresh `collection_items`
 *      so the bought/dismissed split has accurate ownership data.
 *   3. Pull the entire wishlist into memory via paginated API calls,
 *      accumulating a Set of `<type>:<id>` keys.
 *   4. Refresh the wishlist count once more and confirm we got everything.
 *      Aborts with `size_mismatch` if not — never destructive on partial.
 *   5. Reconcile inside one transaction:
 *        - new items: INSERT with mirror_state='synced'
 *        - existing items with mirror_state local/synced: refresh bc_synced_at
 *        - missing-on-BC items: split bought vs dismissed via isOwned join
 *        - dismissed items still missing on BC: promote to bought if isOwned
 *          (handles the documented purchase race)
 *
 * Push-mirror state is honoured throughout: rows in `pushing` or
 * `push_failed` are skipped so an in-flight push never gets clobbered.
 */
export async function syncWishlistFromBandcamp(): Promise<WishlistSyncResult> {
  const main = getStoredMainAuth();
  if (!main) {
    return { runId: 0, ok: false, error: 'main_auth_missing' };
  }

  const runId = createSyncRun({ kind: 'wishlist' });

  const prereq = await runCollectionSyncForWishlistPrereq(main);
  if (!prereq.ok) {
    markSyncRun(runId, {
      status: 'error',
      error_message: prereq.errorMessage ?? prereq.errorCode ?? 'prereq_failed',
    });
    return {
      runId,
      ok: false,
      error: prereq.errorCode ?? 'collection_prereq_failed',
    };
  }

  const accumulator = new Set<string>();
  const itemRecords: BcCollectionItem[] = [];
  let totalKnown: number | null = null;

  try {
    const initial = await fetchInitialWishlist(main.username, main.cookieString);
    totalKnown = initial.collectionTotal;
    for (const item of initial.items) {
      const key = `${item.bcItemType}:${item.bcItemId}`;
      if (accumulator.has(key)) continue;
      accumulator.add(key);
      itemRecords.push(item);
    }
    updateSyncRun(runId, {
      items_synced: accumulator.size,
      items_total_known: totalKnown ?? null,
    });

    const fanId = initial.fanId ?? main.fanId;
    let token = initial.lastToken;
    while (token) {
      const page = await fetchWishlistPage(fanId, token, main.cookieString);
      for (const item of page.items) {
        const key = `${item.bcItemType}:${item.bcItemId}`;
        if (accumulator.has(key)) continue;
        accumulator.add(key);
        itemRecords.push(item);
      }
      updateSyncRun(runId, { items_synced: accumulator.size });
      if (!page.moreAvailable || !page.lastToken || page.lastToken === token) break;
      token = page.lastToken;
      await sleep(POLL_DELAY_MS);
    }
  } catch (err) {
    markSyncRun(runId, {
      status: 'error',
      error_message: err instanceof Error ? err.message : String(err),
    });
    return { runId, ok: false, error: 'fetch_failed' };
  }

  // Refresh total once more so we can detect mid-pagination drift.
  let totalRemote = totalKnown ?? 0;
  try {
    const refresh = await fetchInitialWishlist(main.username, main.cookieString);
    if (refresh.collectionTotal != null) totalRemote = refresh.collectionTotal;
  } catch {
    // Tolerate; we'll use the earlier total. Strict check below still applies.
  }

  if (totalRemote > 0 && accumulator.size !== totalRemote) {
    markSyncRun(runId, {
      status: 'error',
      error_message: `size_mismatch: got ${accumulator.size} of ${totalRemote}`,
    });
    return { runId, ok: false, error: 'size_mismatch', itemsSynced: accumulator.size };
  }

  // Reconcile inside one transaction so concurrent reads see either the
  // old or the new state, never a half-applied snapshot.
  const db = getDb();
  const tx = db.transaction(() => {
    const now = new Date().toISOString();

    const insertStmt = db.prepare(`
      INSERT INTO wishlist
        (bc_item_type, bc_track_id, bc_album_id, bc_url, title, artist_name, album_title, cover_url,
         added_at, source, mirror_state, bc_synced_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'bc_pull', 'synced', ?, 'open')
    `);
    const refreshStmt = db.prepare(`
      UPDATE wishlist SET mirror_state='synced', bc_synced_at=? WHERE id = ?
    `);
    const buyStmt = db.prepare(`
      UPDATE wishlist SET bought_at=?, bought_via='bc_mirror', bc_synced_at=?,
             status='bought' WHERE id = ?
    `);
    const dismissStmt = db.prepare(`
      UPDATE wishlist SET dismissed_at=?, bc_synced_at=?, status='dismissed' WHERE id = ?
    `);
    const promoteStmt = db.prepare(`
      UPDATE wishlist SET bought_at=?, bought_via='bc_mirror_promoted',
             dismissed_at=NULL, bc_synced_at=?, status='bought' WHERE id = ?
    `);

    const selectExistingTrack = db.prepare<[number], { id: number; mirror_state: string }>(
      'SELECT id, mirror_state FROM wishlist WHERE bc_track_id = ?',
    );
    const selectExistingAlbum = db.prepare<[number], { id: number; mirror_state: string }>(
      'SELECT id, mirror_state FROM wishlist WHERE bc_album_id = ?',
    );

    for (const item of itemRecords) {
      const existing =
        item.bcItemType === 't'
          ? selectExistingTrack.get(item.bcItemId)
          : selectExistingAlbum.get(item.bcItemId);

      if (!existing) {
        insertStmt.run(
          item.bcItemType,
          item.bcItemType === 't' ? item.bcItemId : null,
          item.bcItemType === 'a' ? item.bcItemId : null,
          item.bcUrl,
          item.title,
          item.artistName,
          item.albumTitle,
          item.coverUrl,
          now,
          now,
        );
      } else if (existing.mirror_state === 'local' || existing.mirror_state === 'synced') {
        refreshStmt.run(now, existing.id);
      }
      // mirror_state IN ('pushing','push_failed'): leave alone so an
      // in-flight push doesn't get clobbered by the pull-sync.
    }

    // Missing-on-BC: split bought vs dismissed.
    const localRows = db
      .prepare<
        [],
        { id: number; bc_item_type: 't' | 'a'; bc_track_id: number | null; bc_album_id: number | null }
      >(
        `SELECT id, bc_item_type, bc_track_id, bc_album_id
           FROM wishlist
          WHERE mirror_state='synced'
            AND dismissed_at IS NULL
            AND bought_at IS NULL`,
      )
      .all();

    for (const r of localRows) {
      const itemId = r.bc_item_type === 't' ? r.bc_track_id! : r.bc_album_id!;
      const key = `${r.bc_item_type}:${itemId}`;
      if (accumulator.has(key)) continue;

      if (isOwned(r.bc_item_type, itemId)) {
        buyStmt.run(now, now, r.id);
      } else {
        dismissStmt.run(now, now, r.id);
      }
    }

    // Promotion path: previously-dismissed rows that are now owned (purchase
    // race race: heart -> dismiss while pull-sync was running -> later buy).
    const dismissedRows = db
      .prepare<
        [],
        { id: number; bc_item_type: 't' | 'a'; bc_track_id: number | null; bc_album_id: number | null }
      >(
        `SELECT id, bc_item_type, bc_track_id, bc_album_id
           FROM wishlist
          WHERE mirror_state='synced'
            AND dismissed_at IS NOT NULL
            AND bought_at IS NULL`,
      )
      .all();

    for (const r of dismissedRows) {
      const itemId = r.bc_item_type === 't' ? r.bc_track_id! : r.bc_album_id!;
      const key = `${r.bc_item_type}:${itemId}`;
      if (accumulator.has(key)) continue;
      if (isOwned(r.bc_item_type, itemId)) {
        promoteStmt.run(now, now, r.id);
      }
    }
  });
  tx();

  markSyncRun(runId, { status: 'success', items_synced: accumulator.size });
  return { runId, ok: true, itemsSynced: accumulator.size };
}
