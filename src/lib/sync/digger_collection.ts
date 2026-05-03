import { getDb } from '../db';
import { getStoredAuth } from '../auth/store';
import { fetchDiggerProfile } from '../bandcamp/fetch_digger';
import { paginateCollection } from '../bandcamp/fanapi';
import type { BcCollectionItem, BcCollectionPage } from '../bandcamp/types';

export interface DiggerCrawlResult {
  diggerId: number;
  itemsCrawled: number;
  itemsTotalKnown: number | null;
  durationMs: number;
}

interface DiggerRow {
  id: number;
  bc_username: string;
  bc_fan_id: number | null;
}

function loadDigger(diggerId: number): DiggerRow | null {
  return (
    getDb()
      .prepare<[number], DiggerRow>(
        'SELECT id, bc_username, bc_fan_id FROM diggers WHERE id = ?',
      )
      .get(diggerId) ?? null
  );
}

function persistItems(
  diggerId: number,
  items: BcCollectionItem[],
  startPosition: number,
  stagedRunAt: string,
): number {
  if (items.length === 0) return startPosition;
  const stmt = getDb().prepare(
    `INSERT INTO digger_collection (
       digger_id, bc_item_id, bc_item_type, title, artist_name, cover_url, bc_url, purchased_at, position, staged_run_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (digger_id, bc_item_id, bc_item_type) DO UPDATE SET
       title = excluded.title,
       artist_name = excluded.artist_name,
       cover_url = excluded.cover_url,
       bc_url = excluded.bc_url,
       purchased_at = COALESCE(excluded.purchased_at, digger_collection.purchased_at),
       position = excluded.position,
       staged_run_at = excluded.staged_run_at`,
  );
  let pos = startPosition;
  const tx = getDb().transaction(() => {
    for (const it of items) {
      stmt.run(
        diggerId,
        it.bcItemId,
        it.bcItemType,
        it.title,
        it.artistName,
        it.coverUrl,
        it.bcUrl,
        it.purchasedAt,
        pos,
        stagedRunAt,
      );
      pos += 1;
    }
  });
  tx();
  return pos;
}

function startRun(diggerId: number): void {
  getDb()
    .prepare(
      `INSERT INTO digger_crawl_runs (digger_id, started_at, status, items_crawled)
       VALUES (?, datetime('now'), 'running', 0)
       ON CONFLICT (digger_id) DO UPDATE SET
         started_at = datetime('now'),
         finished_at = NULL,
         status = 'running',
         items_crawled = 0,
         error_message = NULL`,
    )
    .run(diggerId);
}

function finishRun(
  diggerId: number,
  status: 'success' | 'error',
  itemsCrawled: number,
  itemsTotalKnown: number | null,
  errorMessage: string | null,
): void {
  getDb()
    .prepare(
      `UPDATE digger_crawl_runs
         SET finished_at = datetime('now'), status = ?, items_crawled = ?,
             items_total_known = ?, error_message = ?
         WHERE digger_id = ?`,
    )
    .run(status, itemsCrawled, itemsTotalKnown, errorMessage, diggerId);
}

/**
 * Walk a curator's full Bandcamp collection (initial page + paginated rest)
 * and persist every item into digger_collection. Reusable for the curator
 * detail page, "best of supporters" deepening, and future overlap scoring.
 */
export async function crawlDiggerCollection(
  diggerId: number,
): Promise<DiggerCrawlResult> {
  const auth = getStoredAuth();
  if (!auth) throw new Error('no auth stored');

  const curator = loadDigger(diggerId);
  if (!curator) throw new Error('curator not found');

  startRun(diggerId);
  const startedAt = Date.now();
  let itemsCrawled = 0;
  let itemsTotalKnown: number | null = null;
  // Stage-and-swap: tag every row written by this run with `stagedRunAt`,
  // then on success delete every row whose tag is anything else. A
  // mid-run failure leaves prior data untouched (Codex pass-2 finding).
  const stagedRunAt = new Date().toISOString();

  try {
    const profile = await fetchDiggerProfile(curator.bc_username, auth.cookieString);
    itemsTotalKnown = profile.itemCount;
    let position = 0;
    if (profile.initialItems.length > 0) {
      position = persistItems(diggerId, profile.initialItems, position, stagedRunAt);
      itemsCrawled += profile.initialItems.length;
    }

    const fanId = profile.fanId ?? curator.bc_fan_id;
    if (fanId) {
      const { fetchInitialCollection } = await import('../bandcamp/fanapi');
      const initial = await fetchInitialCollection(curator.bc_username, auth.cookieString);
      if (initial.lastToken) {
        await paginateCollection({
          fanId,
          initialLastToken: initial.lastToken,
          cookieString: auth.cookieString,
          onPage: (page: BcCollectionPage) => {
            if (page.items.length === 0) return;
            position = persistItems(diggerId, page.items, position, stagedRunAt);
            itemsCrawled += page.items.length;
          },
        });
      }
    }

    // Swap: drop everything we did NOT just write. Stale rows from a prior
    // crawl whose items have since disappeared from the curator's BC
    // collection get cleaned up here. Pre-migration rows have NULL tag
    // and get pruned on the first successful crawl too.
    getDb()
      .prepare(
        'DELETE FROM digger_collection WHERE digger_id = ? AND (staged_run_at IS NULL OR staged_run_at != ?)',
      )
      .run(diggerId, stagedRunAt);

    finishRun(diggerId, 'success', itemsCrawled, itemsTotalKnown, null);
    return {
      diggerId,
      itemsCrawled,
      itemsTotalKnown,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'crawl failed';
    finishRun(diggerId, 'error', itemsCrawled, itemsTotalKnown, message);
    const { recordSyncError } = await import('./errors_store');
    recordSyncError({
      kind: 'digger_collection',
      itemUrl: `https://bandcamp.com/${curator.bc_username}`,
      itemTitle: curator.bc_username,
      message,
    });
    throw err;
  }
}

export interface DiggerCrawlStatus {
  diggerId: number;
  startedAt: string | null;
  finishedAt: string | null;
  status: 'running' | 'success' | 'error' | null;
  itemsCrawled: number;
  itemsTotalKnown: number | null;
  errorMessage: string | null;
}

export function getDiggerCrawlStatus(diggerId: number): DiggerCrawlStatus {
  const row = getDb()
    .prepare<[number], {
      started_at: string;
      finished_at: string | null;
      status: 'running' | 'success' | 'error';
      items_crawled: number;
      items_total_known: number | null;
      error_message: string | null;
    }>(
      `SELECT started_at, finished_at, status, items_crawled, items_total_known, error_message
         FROM digger_crawl_runs WHERE digger_id = ?`,
    )
    .get(diggerId);
  if (!row) {
    return {
      diggerId,
      startedAt: null,
      finishedAt: null,
      status: null,
      itemsCrawled: 0,
      itemsTotalKnown: null,
      errorMessage: null,
    };
  }
  return {
    diggerId,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    itemsCrawled: row.items_crawled,
    itemsTotalKnown: row.items_total_known,
    errorMessage: row.error_message,
  };
}

export interface DiggerCollectionItem {
  bcItemId: number;
  bcItemType: 'a' | 't';
  title: string | null;
  artistName: string | null;
  coverUrl: string | null;
  bcUrl: string | null;
  purchasedAt: string | null;
  isOwnedByYou: boolean;
  /** Original release date if we happen to know it (i.e. the track or
   * album sits in our local `tracks` table from a prior sync / lookup).
   * Otherwise null — we don't BC-roundtrip just to fill it in here. */
  releasedAt: string | null;
  /** Local tracks.id when the item maps to a row we already have, so the
   * UI can hand it to TrackRow / TrackActionsBar without a re-resolve. */
  localTrackId: number | null;
  bcTrackId: number | null;
}

export function listDiggerCollection(diggerId: number, limit = 200): DiggerCollectionItem[] {
  const ownedRows = getDb()
    .prepare<[], { bc_item_id: number }>(
      'SELECT bc_item_id FROM collection_items WHERE removed_at IS NULL',
    )
    .all();
  const owned = new Set(ownedRows.map((r) => r.bc_item_id));
  const rows = getDb()
    .prepare<[number, number], {
      bc_item_id: number;
      bc_item_type: 'a' | 't';
      title: string | null;
      artist_name: string | null;
      cover_url: string | null;
      bc_url: string | null;
      purchased_at: string | null;
      track_id: number | null;
      track_bc_track_id: number | null;
      track_released_at: string | null;
    }>(
      // LEFT JOIN tracks on bc_track_id (for 't' items) OR bc_album_id
      // (for 'a' items) to surface release_at + local id when we have it.
      // GROUP BY collapses the album-case where multiple tracks share the
      // album id (we just take the MAX release date; they're all the
      // same release).
      `SELECT dc.bc_item_id, dc.bc_item_type, dc.title, dc.artist_name,
              dc.cover_url, dc.bc_url, dc.purchased_at,
              MAX(t.id) AS track_id,
              MAX(t.bc_track_id) AS track_bc_track_id,
              MAX(t.released_at) AS track_released_at
         FROM digger_collection dc
         LEFT JOIN tracks t
           ON t.removed_at IS NULL
          AND ((dc.bc_item_type = 't' AND t.bc_track_id = dc.bc_item_id)
               OR (dc.bc_item_type = 'a' AND t.bc_album_id = dc.bc_item_id))
         WHERE dc.digger_id = ?
         GROUP BY dc.bc_item_id, dc.bc_item_type
         ORDER BY MAX(dc.position) ASC NULLS LAST,
                  MAX(dc.purchased_at) DESC NULLS LAST
         LIMIT ?`,
    )
    .all(diggerId, limit);
  return rows.map((r) => ({
    bcItemId: r.bc_item_id,
    bcItemType: r.bc_item_type,
    title: r.title,
    artistName: r.artist_name,
    coverUrl: r.cover_url,
    bcUrl: r.bc_url,
    purchasedAt: r.purchased_at,
    isOwnedByYou: owned.has(r.bc_item_id),
    releasedAt: r.track_released_at,
    localTrackId: r.track_id,
    bcTrackId: r.track_bc_track_id ?? (r.bc_item_type === 't' ? r.bc_item_id : null),
  }));
}
