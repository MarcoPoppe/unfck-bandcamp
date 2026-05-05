import { getDb } from '../db';
import { getStoredAuth, getStoredMainAuth } from '../auth/store';
import { fetchCollectorsPage } from '../bandcamp/fetch_collectors';
import { upsertDigger } from '../entities/store';
import { recordSyncError } from './errors_store';

const REQUEST_DELAY_MS = 350;
const COLLECTORS_PER_TRALBUM = 80;

export interface DiggerCrawlResult {
  itemsCrawled: number;
  collectorsSeen: number;
  diggersWritten: number;
  errors: { tralbumType: 'a' | 't'; tralbumId: number; error: string }[];
  durationMs: number;
}

interface OwnedTralbum {
  bcItemType: 'a' | 't';
  bcItemId: number;
  title: string;
}

function listOwnedTralbums(limit: number): OwnedTralbum[] {
  // Skip releases whose every expanded track is archived. Releases without
  // expanded tracks pass through unchanged so the curators scan still works
  // for newly synced collections that haven't been track-expanded yet.
  return getDb()
    .prepare<[number], { bc_item_type: 'a' | 't'; bc_item_id: number; title: string }>(
      `SELECT ci.bc_item_type, ci.bc_item_id, ci.title
         FROM collection_items ci
         WHERE ci.removed_at IS NULL
           AND (
             NOT EXISTS (
               SELECT 1 FROM tracks t
                 WHERE t.source_collection_item_id = ci.id
                   AND t.removed_at IS NULL
             )
             OR EXISTS (
               SELECT 1 FROM tracks t
                 LEFT JOIN track_curation c ON c.track_id = t.id
                 WHERE t.source_collection_item_id = ci.id
                   AND t.removed_at IS NULL
                   AND (c.archived_at IS NULL OR c.track_id IS NULL)
             )
           )
         ORDER BY ci.purchased_at DESC NULLS LAST
         LIMIT ?`,
    )
    .all(limit)
    .map((r) => ({
      bcItemType: r.bc_item_type,
      bcItemId: r.bc_item_id,
      title: r.title,
    }));
}

function listWishlistTralbums(limit: number): OwnedTralbum[] {
  // Open wishlist items only — bought items live in collection_items, and
  // dismissed ones are explicitly "not my taste". Each wishlist row is
  // track-granular on Bandcamp's side, so we always scan as type 't'.
  return getDb()
    .prepare<[number], { bc_track_id: number; title: string }>(
      `SELECT bc_track_id, title FROM wishlist
         WHERE status = 'open'
         ORDER BY added_at DESC
         LIMIT ?`,
    )
    .all(limit)
    .map((r) => ({ bcItemType: 't' as const, bcItemId: r.bc_track_id, title: r.title }));
}

function listPlaylistTralbums(playlistId: number, limit: number): OwnedTralbum[] {
  return getDb()
    .prepare<[number, number], { bc_track_id: number; title: string }>(
      `SELECT t.bc_track_id, t.title
         FROM playlist_tracks pt
         INNER JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ? AND t.removed_at IS NULL
         ORDER BY pt.position ASC
         LIMIT ?`,
    )
    .all(playlistId, limit)
    .map((r) => ({ bcItemType: 't' as const, bcItemId: r.bc_track_id, title: r.title }));
}

export type DiggerSource = 'owned' | 'wishlist' | 'playlist';

interface DiggerAggregate {
  fanId: number;
  username: string;
  displayName: string | null;
  imageUrl: string | null;
  imageId: number | null;
  releases: Set<string>;
  sampleTitles: string[];
}

/**
 * Build a "diggers" overlap index: scan the supporters list of each owned
 * release and count how many of them also support N other owned releases.
 * Top supporters by overlap are inserted into the curators table with their
 * overlap_count cached for `/curators`.
 */
export async function syncDiggers(opts?: {
  maxItems?: number;
  topN?: number;
  ownFanId?: number;
  /** Which set of tralbums to scan supporters for. Default: 'owned'. */
  source?: DiggerSource;
  /** Required when source === 'playlist'. */
  playlistId?: number;
}): Promise<DiggerCrawlResult & { source: DiggerSource; playlistId?: number }> {
  const auth = getStoredAuth();
  if (!auth) throw new Error('no auth stored');

  const startedAt = Date.now();
  const source: DiggerSource = opts?.source ?? 'owned';
  const limit = opts?.maxItems ?? 25;
  let items: OwnedTralbum[];
  if (source === 'wishlist') {
    items = listWishlistTralbums(limit);
  } else if (source === 'playlist') {
    if (!opts?.playlistId) throw new Error('playlistId required when source=playlist');
    items = listPlaylistTralbums(opts.playlistId, limit);
  } else {
    items = listOwnedTralbums(limit);
  }
  const errors: DiggerCrawlResult['errors'] = [];
  const aggregate = new Map<number, DiggerAggregate>();
  // Self-exclude: skip the user's own fan_id from the supporters list,
  // otherwise the linked main account dominates the overlap chart with
  // 100% match (it owns every release we scan). Prefer main when
  // linked — the burner is a fresh throwaway and never appears in
  // other tralbums' supporters anyway.
  const ownFanId = opts?.ownFanId ?? getStoredMainAuth()?.fanId ?? auth.fanId;
  let collectorsSeen = 0;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    try {
      const page = await fetchCollectorsPage({
        tralbumType: item.bcItemType,
        tralbumId: item.bcItemId,
        cookieString: auth.cookieString,
        count: COLLECTORS_PER_TRALBUM,
      });
      for (const c of page.collectors) {
        if (c.fanId === ownFanId) continue;
        collectorsSeen += 1;
        const key = `${item.bcItemType}_${item.bcItemId}`;
        const existing = aggregate.get(c.fanId);
        if (existing) {
          existing.releases.add(key);
          if (existing.sampleTitles.length < 5 && !existing.sampleTitles.includes(item.title)) {
            existing.sampleTitles.push(item.title);
          }
          // Prefer richer metadata if discovered later.
          if (!existing.imageUrl && c.imageUrl) existing.imageUrl = c.imageUrl;
          if (!existing.imageId && c.imageId) existing.imageId = c.imageId;
          if (!existing.displayName && c.displayName) existing.displayName = c.displayName;
        } else {
          aggregate.set(c.fanId, {
            fanId: c.fanId,
            username: c.username,
            displayName: c.displayName,
            imageUrl: c.imageUrl,
            imageId: c.imageId,
            releases: new Set([key]),
            sampleTitles: [item.title],
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({
        tralbumType: item.bcItemType,
        tralbumId: item.bcItemId,
        error: message,
      });
      recordSyncError({
        kind: 'diggers',
        itemUrl: `${item.bcItemType}:${item.bcItemId}`,
        itemTitle: item.title,
        message,
      });
    }
    if (i < items.length - 1) {
      await new Promise((res) => setTimeout(res, REQUEST_DELAY_MS));
    }
  }

  // Filter: at least 2 overlapping releases. Single overlap is noise.
  const sorted = [...aggregate.values()]
    .filter((d) => d.releases.size >= 2)
    .sort((a, b) => b.releases.size - a.releases.size)
    .slice(0, opts?.topN ?? 100);

  const db = getDb();
  let diggersWritten = 0;
  const tx = db.transaction(() => {
    const upsertOverlap = db.prepare(
      `INSERT INTO digger_overlap (digger_id, overlap_count, sample_titles, last_computed_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (digger_id) DO UPDATE SET
         overlap_count = excluded.overlap_count,
         sample_titles = excluded.sample_titles,
         last_computed_at = excluded.last_computed_at`,
    );
    for (const d of sorted) {
      const diggerId = upsertDigger({
        bcUsername: d.username,
        bcFanId: d.fanId,
        displayName: d.displayName,
        imageUrl: d.imageUrl,
      });
      upsertOverlap.run(
        diggerId,
        d.releases.size,
        JSON.stringify(d.sampleTitles),
      );
      diggersWritten += 1;
    }
  });
  tx.immediate();

  return {
    itemsCrawled: items.length,
    collectorsSeen,
    diggersWritten,
    errors,
    durationMs: Date.now() - startedAt,
    source,
    playlistId: opts?.playlistId,
  };
}

export interface DiggerCandidate {
  diggerId: number;
  bcUsername: string;
  bcFanId: number | null;
  displayName: string | null;
  imageUrl: string | null;
  overlapCount: number;
  sampleTitles: string[];
  lastComputedAt: string;
  isFollowed: boolean;
  isIgnored: boolean;
}

export function listDiggerCandidates(opts: {
  limit?: number;
  includeIgnored?: boolean;
  ignoredOnly?: boolean;
} = {}): DiggerCandidate[] {
  const limit = opts.limit ?? 100;
  const conds: string[] = [];
  if (opts.ignoredOnly) conds.push('do.ignored_at IS NOT NULL');
  else if (!opts.includeIgnored) conds.push('do.ignored_at IS NULL');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = getDb()
    .prepare<[number], {
      digger_id: number;
      bc_username: string;
      bc_fan_id: number | null;
      display_name: string | null;
      image_url: string | null;
      overlap_count: number;
      sample_titles: string | null;
      last_computed_at: string;
      ignored_at: string | null;
      followed: number;
    }>(
      `SELECT do.digger_id, d.bc_username, d.bc_fan_id, d.display_name, d.image_url,
              do.overlap_count, do.sample_titles, do.last_computed_at, do.ignored_at,
              CASE WHEN f.entity_id IS NULL THEN 0 ELSE 1 END AS followed
         FROM digger_overlap do
         INNER JOIN diggers d ON d.id = do.digger_id
         LEFT JOIN following f
           ON f.entity_type = 'digger' AND f.entity_id = d.id
         ${where}
         ORDER BY do.overlap_count DESC, do.last_computed_at DESC
         LIMIT ?`,
    )
    .all(limit);
  return rows.map((r) => {
    let sample: string[] = [];
    if (r.sample_titles) {
      try {
        const parsed = JSON.parse(r.sample_titles) as unknown;
        if (Array.isArray(parsed)) {
          sample = parsed.filter((x): x is string => typeof x === 'string');
        }
      } catch {
        // ignore
      }
    }
    return {
      diggerId: r.digger_id,
      bcUsername: r.bc_username,
      bcFanId: r.bc_fan_id,
      displayName: r.display_name,
      imageUrl: r.image_url,
      overlapCount: r.overlap_count,
      sampleTitles: sample,
      lastComputedAt: r.last_computed_at,
      isFollowed: r.followed === 1,
      isIgnored: r.ignored_at !== null,
    };
  });
}

export function getDiggerCandidateCount(): number {
  const row = getDb()
    .prepare<[], { c: number }>(
      'SELECT COUNT(*) AS c FROM digger_overlap WHERE ignored_at IS NULL',
    )
    .get();
  return row?.c ?? 0;
}

export function setDiggerIgnored(diggerId: number, ignored: boolean): void {
  getDb()
    .prepare(
      `UPDATE digger_overlap
         SET ignored_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END
         WHERE digger_id = ?`,
    )
    .run(ignored ? 1 : 0, diggerId);
}

export interface DiggerDetail {
  diggerId: number;
  bcUsername: string;
  bcFanId: number | null;
  displayName: string | null;
  imageUrl: string | null;
  overlapCount: number;
  sampleTitles: string[];
  lastComputedAt: string;
  isFollowed: boolean;
  isIgnored: boolean;
}

export function getDiggerDetail(diggerId: number): DiggerDetail | null {
  // LEFT JOIN digger_overlap so a curator you've followed but never scanned
  // for overlap (e.g. added by URL or via Bandcamp import) still gets a
  // detail page, just without the overlap stats.
  const row = getDb()
    .prepare<[number], {
      digger_id: number;
      bc_username: string;
      bc_fan_id: number | null;
      display_name: string | null;
      image_url: string | null;
      overlap_count: number | null;
      sample_titles: string | null;
      last_computed_at: string | null;
      ignored_at: string | null;
      followed: number;
    }>(
      `SELECT d.id AS digger_id, d.bc_username, d.bc_fan_id, d.display_name, d.image_url,
              do.overlap_count, do.sample_titles, do.last_computed_at, do.ignored_at,
              CASE WHEN f.entity_id IS NULL THEN 0 ELSE 1 END AS followed
         FROM diggers d
         LEFT JOIN digger_overlap do ON do.digger_id = d.id
         LEFT JOIN following f
           ON f.entity_type = 'digger' AND f.entity_id = d.id
         WHERE d.id = ?`,
    )
    .get(diggerId);
  if (!row) return null;
  let sample: string[] = [];
  if (row.sample_titles) {
    try {
      const parsed = JSON.parse(row.sample_titles) as unknown;
      if (Array.isArray(parsed)) {
        sample = parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      // ignore
    }
  }
  return {
    diggerId: row.digger_id,
    bcUsername: row.bc_username,
    bcFanId: row.bc_fan_id,
    displayName: row.display_name,
    imageUrl: row.image_url,
    overlapCount: row.overlap_count ?? 0,
    sampleTitles: sample,
    lastComputedAt: row.last_computed_at ?? '',
    isFollowed: row.followed === 1,
    isIgnored: row.ignored_at !== null,
  };
}
