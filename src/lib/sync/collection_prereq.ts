import type { StoredAuth } from '../auth/store';
import { fetchInitialCollection, fetchCollectionPage } from '../bandcamp/fanapi';
import { getDb } from '../db';
import type { BcCollectionItem } from '../bandcamp/types';

/**
 * Wishlist-specific prerequisite: refresh the local `collection_items`
 * mirror against the main account's Bandcamp collection BEFORE the
 * wishlist sync makes any tombstone decisions. Without this, the
 * bought/dismissed split would mis-classify newly purchased items as
 * dismissed because they're not yet in our local collection table.
 *
 * Strict by design: any non-200 page, partial pagination, or count
 * mismatch returns `ok: false` and leaves the local DB untouched. The
 * wishlist sync aborts on that and surfaces the error to the UI rather
 * than risk dismissing legitimately-bought rows.
 *
 * This wrapper uses MAIN-auth, not crawler-auth — the spec's strict
 * boundary rule. `getStoredAuth()` (which falls back to main) is
 * forbidden in this code path; callers must pass `getStoredMainAuth()`.
 */
export interface PrereqResult {
  ok: boolean;
  errorCode?: 'collection_prereq_failed' | 'collection_prereq_partial';
  errorMessage?: string;
  itemsSynced?: number;
  totalKnown?: number;
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

function persistItems(items: BcCollectionItem[]): void {
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
        // No new run id needed — this is a side-channel refresh, not a
        // full sync. Existing owned-sync runs continue to tombstone via
        // their own run_id; we just keep the rows fresh for the wishlist
        // bought-detection join.
        null,
      );
    }
  });
  tx(items);
}

export async function runCollectionSyncForWishlistPrereq(
  main: StoredAuth,
): Promise<PrereqResult> {
  try {
    const initial = await fetchInitialCollection(main.username, main.cookieString);
    const totalKnown = initial.collectionTotal;
    let itemsSynced = initial.items.length;
    persistItems(initial.items);

    const targetFanId = initial.fanId ?? main.fanId;
    let token = initial.lastToken;
    while (token) {
      const page = await fetchCollectionPage(targetFanId, token, main.cookieString);
      persistItems(page.items);
      itemsSynced += page.items.length;
      if (!page.moreAvailable || !page.lastToken || page.lastToken === token) break;
      token = page.lastToken;
    }

    if (totalKnown != null && itemsSynced !== totalKnown) {
      return {
        ok: false,
        errorCode: 'collection_prereq_partial',
        errorMessage: `collection_prereq_partial: got ${itemsSynced} of ${totalKnown}`,
        itemsSynced,
        totalKnown,
      };
    }

    return { ok: true, itemsSynced, totalKnown: totalKnown ?? undefined };
  } catch (err) {
    return {
      ok: false,
      errorCode: 'collection_prereq_failed',
      errorMessage:
        err instanceof Error
          ? `collection_prereq_failed: ${err.message}`
          : 'collection_prereq_failed: unknown',
    };
  }
}
