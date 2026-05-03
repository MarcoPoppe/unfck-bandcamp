import { getDb } from '../db';
import { getStoredAuth } from '../auth/store';
import { fetchCollectorsPage } from '../bandcamp/fetch_collectors';
import { fetchDiggerProfile } from '../bandcamp/fetch_digger';
import { recordSyncError } from './errors_store';

const REQUEST_DELAY_MS = 350;
// "All supporters" by default. Practical safety cap: at 350ms per profile
// fetch, 5000 supporters is ~30min. Tracks with more than that are extremely
// rare; cap protects us from runaway crawls.
const DEFAULT_MAX_SUPPORTERS = 5000;

export interface BestOfTrackItem {
  bcItemId: number;
  bcItemType: 'a' | 't';
  bcUrl: string;
  title: string;
  artistName: string | null;
  coverUrl: string | null;
  /** How many supporters of the seed track also have this item. */
  matchCount: number;
  /** True if you also own this item. */
  ownedByYou: boolean;
  /** Populated by the API route at read time, not stored. */
  hasBeenPlayed?: boolean;
}

export interface BestOfRunStatus {
  trackId: number;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'error';
  supportersScanned: number;
  supportersTotal: number | null;
  itemsAggregated: number;
  topItems: BestOfTrackItem[];
  errorMessage: string | null;
}

interface RunRow {
  track_id: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'error';
  supporters_scanned: number;
  supporters_total: number | null;
  items_aggregated: number;
  top_items_json: string | null;
  error_message: string | null;
}

function rowToStatus(row: RunRow): BestOfRunStatus {
  let topItems: BestOfTrackItem[] = [];
  if (row.top_items_json) {
    try {
      const parsed = JSON.parse(row.top_items_json) as unknown;
      if (Array.isArray(parsed)) topItems = parsed as BestOfTrackItem[];
    } catch {
      // ignore
    }
  }
  return {
    trackId: row.track_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    supportersScanned: row.supporters_scanned,
    supportersTotal: row.supporters_total,
    itemsAggregated: row.items_aggregated,
    topItems,
    errorMessage: row.error_message,
  };
}

export function getBestOfStatus(trackId: number): BestOfRunStatus | null {
  const row = getDb()
    .prepare<[number], RunRow>(
      `SELECT track_id, started_at, finished_at, status, supporters_scanned,
              supporters_total, items_aggregated, top_items_json, error_message
         FROM best_of_supporters_runs WHERE track_id = ?`,
    )
    .get(trackId);
  return row ? rowToStatus(row) : null;
}

function upsertRunStart(trackId: number): void {
  getDb()
    .prepare(
      `INSERT INTO best_of_supporters_runs (
         track_id, started_at, status, supporters_scanned, items_aggregated
       ) VALUES (?, datetime('now'), 'running', 0, 0)
       ON CONFLICT (track_id) DO UPDATE SET
         started_at = datetime('now'),
         finished_at = NULL,
         status = 'running',
         supporters_scanned = 0,
         supporters_total = NULL,
         items_aggregated = 0,
         top_items_json = NULL,
         error_message = NULL`,
    )
    .run(trackId);
}

function updateRunProgress(
  trackId: number,
  supportersScanned: number,
  supportersTotal: number | null,
): void {
  getDb()
    .prepare(
      `UPDATE best_of_supporters_runs
         SET supporters_scanned = ?, supporters_total = ?
         WHERE track_id = ?`,
    )
    .run(supportersScanned, supportersTotal, trackId);
}

function finishRun(
  trackId: number,
  status: 'success' | 'error',
  supportersScanned: number,
  itemsAggregated: number,
  topItems: BestOfTrackItem[],
  errorMessage: string | null,
): void {
  getDb()
    .prepare(
      `UPDATE best_of_supporters_runs
         SET finished_at = datetime('now'),
             status = ?,
             supporters_scanned = ?,
             items_aggregated = ?,
             top_items_json = ?,
             error_message = ?
         WHERE track_id = ?`,
    )
    .run(
      status,
      supportersScanned,
      itemsAggregated,
      JSON.stringify(topItems),
      errorMessage,
      trackId,
    );
}

interface SeedTrack {
  trackId: number;
  bcTrackId: number;
  bcAlbumId: number | null;
}

function loadSeedTrack(trackId: number): SeedTrack | null {
  const row = getDb()
    .prepare<[number], { id: number; bc_track_id: number; bc_album_id: number | null }>(
      `SELECT id, bc_track_id, bc_album_id FROM tracks WHERE id = ?`,
    )
    .get(trackId);
  if (!row) return null;
  return {
    trackId: row.id,
    bcTrackId: row.bc_track_id,
    bcAlbumId: row.bc_album_id,
  };
}

function getOwnedBcItemIds(): Set<number> {
  const rows = getDb()
    .prepare<[], { bc_item_id: number }>(
      'SELECT bc_item_id FROM collection_items WHERE removed_at IS NULL',
    )
    .all();
  return new Set(rows.map((r) => r.bc_item_id));
}

export interface BestOfRunOptions {
  trackId: number;
  maxSupporters?: number;
}

interface AggregateEntry {
  bcItemId: number;
  bcItemType: 'a' | 't';
  bcUrl: string;
  title: string;
  artistName: string | null;
  coverUrl: string | null;
  /** Counter only — we never need the actual usernames downstream. */
  supporterCount: number;
}

/**
 * Walk the supporters of a track, fetch each supporter's recent collection
 * page, and aggregate every item by how many supporters have it. The result
 * is the "best of all supporters" — releases that this track's audience
 * collectively rates.
 */
export async function runBestOfSupporters(
  opts: BestOfRunOptions,
): Promise<BestOfRunStatus> {
  const auth = getStoredAuth();
  if (!auth) throw new Error('no auth stored');

  const seed = loadSeedTrack(opts.trackId);
  if (!seed) throw new Error('seed track not found');

  upsertRunStart(seed.trackId);

  // Bandcamp can ship the same audio twice: once as a single-track album
  // (tralbum_type='a', uses bc_album_id) and once as a standalone track
  // permalink (tralbum_type='t', uses bc_track_id). Each tralbum has its
  // own collectors list — buyers usually pick one or the other, so a
  // best-of crawl that only hits one variant misses half the audience
  // (often the bigger half, because BC's algorithm favours album-form
  // releases). When both variants exist for our seed row, crawl both and
  // dedup the resulting username list.
  const variants: { tralbumType: 'a' | 't'; tralbumId: number }[] = [];
  if (seed.bcAlbumId) variants.push({ tralbumType: 'a', tralbumId: seed.bcAlbumId });
  if (seed.bcTrackId) variants.push({ tralbumType: 't', tralbumId: seed.bcTrackId });
  if (variants.length === 0) {
    throw new Error('seed track has neither bc_album_id nor bc_track_id');
  }
  const maxSupporters = opts.maxSupporters ?? DEFAULT_MAX_SUPPORTERS;

  try {
    // 1) collect supporter usernames across all tralbum variants. Each
    // variant is paginated independently; we bail out as soon as the
    // unique union hits the cap so we don't burn requests on duplicates.
    const seenUsernames = new Set<string>();
    const usernames: string[] = [];
    for (const variant of variants) {
      if (usernames.length >= maxSupporters) break;
      let cursor: string | null = null;
      while (usernames.length < maxSupporters) {
        const page = await fetchCollectorsPage({
          tralbumType: variant.tralbumType,
          tralbumId: variant.tralbumId,
          cookieString: auth.cookieString,
          count: Math.min(80, maxSupporters - usernames.length),
          token: cursor,
        });
        for (const c of page.collectors) {
          if (seenUsernames.has(c.username)) continue;
          seenUsernames.add(c.username);
          usernames.push(c.username);
        }
        if (!page.moreAvailable || !page.nextToken) break;
        cursor = page.nextToken;
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      }
    }
    const supportersTotal = usernames.length;
    updateRunProgress(seed.trackId, 0, supportersTotal);

    // 2) for each supporter, pull their recent collection, aggregate items
    const aggregate = new Map<string, AggregateEntry>();
    const errors: string[] = [];
    for (let i = 0; i < usernames.length; i += 1) {
      const username = usernames[i];
      try {
        const profile = await fetchDiggerProfile(username, auth.cookieString);
        const seenInThisProfile = new Set<string>();
        for (const item of profile.initialItems) {
          const key = `${item.bcItemType}_${item.bcItemId}`;
          if (seenInThisProfile.has(key)) continue;
          seenInThisProfile.add(key);
          const existing = aggregate.get(key);
          if (existing) {
            existing.supporterCount += 1;
            if (!existing.coverUrl && item.coverUrl) existing.coverUrl = item.coverUrl;
          } else {
            aggregate.set(key, {
              bcItemId: item.bcItemId,
              bcItemType: item.bcItemType,
              bcUrl: item.bcUrl,
              title: item.title,
              artistName: item.artistName,
              coverUrl: item.coverUrl,
              supporterCount: 1,
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'fetch failed';
        errors.push(`${username}: ${msg}`);
        recordSyncError({
          kind: 'best_of_supporters',
          itemUrl: `https://bandcamp.com/${username}`,
          itemTitle: username,
          message: msg,
        });
      }
      updateRunProgress(seed.trackId, i + 1, supportersTotal);
      if (i < usernames.length - 1) {
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      }
    }

    // 3) drop the seed item itself from the aggregate. Everyone we crawled
    // owns at least one of the variants by definition, so both keys would
    // pollute the rankings.
    for (const v of variants) {
      aggregate.delete(`${v.tralbumType}_${v.tralbumId}`);
    }

    // 4) rank by support count, keep the ones with at least 2 matches
    const owned = getOwnedBcItemIds();
    const ranked: BestOfTrackItem[] = [...aggregate.values()]
      .filter((e) => e.supporterCount >= 2)
      .sort((a, b) => b.supporterCount - a.supporterCount)
      .slice(0, 80)
      .map((e) => ({
        bcItemId: e.bcItemId,
        bcItemType: e.bcItemType,
        bcUrl: e.bcUrl,
        title: e.title,
        artistName: e.artistName,
        coverUrl: e.coverUrl,
        matchCount: e.supporterCount,
        ownedByYou: owned.has(e.bcItemId),
      }));

    finishRun(
      seed.trackId,
      'success',
      usernames.length,
      ranked.length,
      ranked,
      errors.length > 0 ? errors.slice(0, 3).join(' · ') : null,
    );
    return getBestOfStatus(seed.trackId)!;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'best-of crawl failed';
    finishRun(seed.trackId, 'error', 0, 0, [], message);
    recordSyncError({
      kind: 'best_of_supporters',
      itemTitle: `track_id=${seed.trackId}`,
      message,
    });
    throw err;
  }
}
