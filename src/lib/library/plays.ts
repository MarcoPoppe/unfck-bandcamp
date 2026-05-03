import { getDb } from '../db';

export function recordPlay(
  trackId: number,
  completedPct: number | null,
  source: string | null,
): number {
  const info = getDb()
    .prepare(
      `INSERT INTO track_plays (track_id, completed_pct, source) VALUES (?, ?, ?)`,
    )
    .run(trackId, completedPct, source);
  return Number(info.lastInsertRowid);
}

/**
 * Mark a track as unplayed by deleting all its track_plays rows. Returns
 * how many plays were removed and the bc_track_id (so the client can
 * purge it from the live played-set).
 */
export function deletePlaysForTrack(trackId: number): {
  deleted: number;
  bcTrackId: number | null;
} {
  const db = getDb();
  const trackRow = db
    .prepare<[number], { bc_track_id: number }>(
      `SELECT bc_track_id FROM tracks WHERE id = ?`,
    )
    .get(trackId);
  const info = db
    .prepare(`DELETE FROM track_plays WHERE track_id = ?`)
    .run(trackId);
  return {
    deleted: Number(info.changes),
    bcTrackId: trackRow?.bc_track_id ?? null,
  };
}

export interface PlayCounts {
  totalPlays: number;
  completedPlays: number;
  lastPlayedAt: string | null;
}

const COMPLETED_THRESHOLD = 0.5;

export function getPlayCountsForTracks(trackIds: number[]): Map<number, PlayCounts> {
  const map = new Map<number, PlayCounts>();
  if (trackIds.length === 0) return map;
  const placeholders = trackIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare<(number | string)[], {
      track_id: number;
      total: number;
      completed: number;
      last_played_at: string | null;
    }>(
      `SELECT track_id,
              COUNT(*) AS total,
              SUM(CASE WHEN completed_pct >= ? THEN 1 ELSE 0 END) AS completed,
              MAX(played_at) AS last_played_at
         FROM track_plays
         WHERE track_id IN (${placeholders})
         GROUP BY track_id`,
    )
    .all(COMPLETED_THRESHOLD, ...trackIds);
  for (const r of rows) {
    map.set(r.track_id, {
      totalPlays: r.total,
      completedPlays: r.completed,
      lastPlayedAt: r.last_played_at,
    });
  }
  return map;
}

export interface PlayHistoryEntry {
  id: number;
  trackId: number;
  playedAt: string;
  completedPct: number | null;
  source: string | null;
  title: string;
  artistName: string | null;
  albumTitle: string | null;
  coverUrl: string | null;
  bcUrl: string;
  bcTrackId: number;
  hasStream: boolean;
  durationSeconds: number | null;
}

export function getTotalPlayCount(): number {
  const row = getDb()
    .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM track_plays')
    .get();
  return row?.c ?? 0;
}

/**
 * Page-level helper. Returns the set of bc_track_ids the user has played
 * (any duration counts — the recording threshold is enforced when plays are
 * inserted). Single O(P) query, then O(1) `Set.has()` per row, replacing the
 * old per-row EXISTS subquery in listTracks.
 *
 * Use it once per page-level loader and pass it down to every list that
 * displays tracks, so the green "listened" check is consistent everywhere.
 */
export function getPlayedBcTrackIds(): Set<number> {
  const rows = getDb()
    .prepare<[], { bc_track_id: number }>(
      `SELECT DISTINCT t.bc_track_id
         FROM track_plays tp
         INNER JOIN tracks t ON t.id = tp.track_id
         WHERE t.removed_at IS NULL`,
    )
    .all();
  return new Set(rows.map((r) => r.bc_track_id));
}

/**
 * Per-album play stats: how many tracks of each bc_album_id we have locally
 * vs. how many of those have at least one play. Used to mark an EP/Album as
 * "fully heard" in lists where rows are at album granularity (e.g. Best-of
 * supporters).
 *
 * Caveat: this only knows about tracks in our local DB. If an EP has 5
 * tracks on Bandcamp and we only imported 3, we'll mark it heard once those
 * 3 are played. Acceptable trade-off: validating against BCs full tracklist
 * would mean an HTTP request per album row.
 */
/**
 * For each bc_album_id, the list of bc_track_ids we have locally for that
 * album. Used by list pages (best-of, curator collection) to pass the
 * track ids down to the client so the live `playedBcTrackIds` set can
 * answer "is this album fully heard?" without a reload.
 */
export function getKnownTrackBcIdsByAlbum(): Map<number, number[]> {
  const rows = getDb()
    .prepare<[], { bc_album_id: number; bc_track_id: number }>(
      `SELECT bc_album_id, bc_track_id
         FROM tracks
         WHERE removed_at IS NULL AND bc_album_id IS NOT NULL`,
    )
    .all();
  const map = new Map<number, number[]>();
  for (const r of rows) {
    const arr = map.get(r.bc_album_id);
    if (arr) arr.push(r.bc_track_id);
    else map.set(r.bc_album_id, [r.bc_track_id]);
  }
  return map;
}

/**
 * Same data, but keyed by normalised album_url instead of bc_album_id.
 * Companion to getAlbumPlayedStatsByUrl: BC's collection-item id quirks
 * sometimes mean the bc_album_id doesn't match between the curator-
 * collection row and the tracks-table row, but the URLs do.
 */
export function getKnownTrackBcIdsByAlbumUrl(): Map<string, number[]> {
  const rows = getDb()
    .prepare<[], { album_url: string; bc_track_id: number }>(
      `SELECT album_url, bc_track_id
         FROM tracks
         WHERE removed_at IS NULL AND album_url IS NOT NULL`,
    )
    .all();
  const map = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.album_url) continue;
    const key = normalizeAlbumUrl(r.album_url);
    const arr = map.get(key);
    if (arr) arr.push(r.bc_track_id);
    else map.set(key, [r.bc_track_id]);
  }
  return map;
}

export function getAlbumPlayedStats(): Map<number, { played: number; total: number }> {
  const rows = getDb()
    .prepare<[], { bc_album_id: number; total: number; played: number }>(
      `SELECT t.bc_album_id,
              COUNT(*) AS total,
              SUM(
                CASE WHEN EXISTS (
                  SELECT 1 FROM track_plays tp WHERE tp.track_id = t.id
                ) THEN 1 ELSE 0 END
              ) AS played
         FROM tracks t
         WHERE t.removed_at IS NULL AND t.bc_album_id IS NOT NULL
         GROUP BY t.bc_album_id`,
    )
    .all();
  const map = new Map<number, { played: number; total: number }>();
  for (const r of rows) {
    map.set(r.bc_album_id, { played: r.played, total: r.total });
  }
  return map;
}

/**
 * Heal existing tracks rows whose `bc_album_id` is NULL but whose
 * `album_url` matches one of the supplied album items' bcUrl. Older imports
 * (from owned-sync paths that recorded the release as type='t', or from
 * /track/lookup before the album was known) sometimes left bc_album_id
 * NULL even though we now know the matching album id from the curator
 * collection. Running this opportunistically at page-load time fixes the
 * data so getAlbumPlayedStats() can find these tracks without the user
 * having to manually re-expand each EP.
 *
 * Idempotent: when there's nothing to fix, the only cost is one tiny
 * SELECT to find candidates.
 */
export function reconcileAlbumIdsByUrl(
  albumItems: { bcItemId: number; bcUrl: string }[],
): number {
  if (albumItems.length === 0) return 0;
  const targetByUrl = new Map<string, number>();
  for (const item of albumItems) {
    if (!item.bcUrl) continue;
    targetByUrl.set(normalizeAlbumUrl(item.bcUrl), item.bcItemId);
  }
  if (targetByUrl.size === 0) return 0;
  const candidates = getDb()
    .prepare<[], { id: number; album_url: string }>(
      `SELECT id, album_url FROM tracks
         WHERE bc_album_id IS NULL
           AND album_url IS NOT NULL
           AND removed_at IS NULL`,
    )
    .all();
  if (candidates.length === 0) return 0;
  const upd = getDb().prepare(`UPDATE tracks SET bc_album_id = ? WHERE id = ?`);
  let healed = 0;
  const tx = getDb().transaction(() => {
    for (const c of candidates) {
      const targetId = targetByUrl.get(normalizeAlbumUrl(c.album_url));
      if (targetId) {
        upd.run(targetId, c.id);
        healed += 1;
      }
    }
  });
  tx();
  return healed;
}

/**
 * Normalise a Bandcamp URL for keying: strip query/fragment, drop trailing
 * slashes, lower-case host+path. Subtle differences (query params from
 * sharing, trailing slash, host case) would otherwise prevent matches
 * between digger_collection.bc_url and tracks.album_url.
 */
export function normalizeAlbumUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `${u.protocol.toLowerCase()}//${host}${path}`;
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Same as getAlbumPlayedStats but keyed by a normalised album URL. BC's
 * collection items reference albums by URL more reliably than by tralbum_id
 * (the bc_album_id we persist sometimes differs from BC's collection-item
 * tralbum_id quirks), so list pages match against BOTH this map and the
 * id-keyed map to catch fully-heard EPs regardless of which join wins.
 *
 * Normalisation happens JS-side rather than in SQL so we can use the
 * full URL parser (handles query params, fragments, trailing slash, host
 * case) instead of fragile LOWER()/REPLACE() chains.
 */
export function getAlbumPlayedStatsByUrl(): Map<string, { played: number; total: number }> {
  const rows = getDb()
    .prepare<[], { album_url: string; total: number; played: number }>(
      `SELECT t.album_url AS album_url,
              COUNT(*) AS total,
              SUM(
                CASE WHEN EXISTS (
                  SELECT 1 FROM track_plays tp WHERE tp.track_id = t.id
                ) THEN 1 ELSE 0 END
              ) AS played
         FROM tracks t
         WHERE t.removed_at IS NULL AND t.album_url IS NOT NULL
         GROUP BY t.album_url`,
    )
    .all();
  const map = new Map<string, { played: number; total: number }>();
  for (const r of rows) {
    if (!r.album_url) continue;
    const key = normalizeAlbumUrl(r.album_url);
    const existing = map.get(key);
    if (existing) {
      existing.played += r.played;
      existing.total += r.total;
    } else {
      map.set(key, { played: r.played, total: r.total });
    }
  }
  return map;
}

export function listRecentPlays(limit = 100): PlayHistoryEntry[] {
  const rows = getDb()
    .prepare<[number], {
      id: number;
      track_id: number;
      played_at: string;
      completed_pct: number | null;
      source: string | null;
      title: string;
      artist_name: string | null;
      album_title: string | null;
      cover_url: string | null;
      bc_url: string;
      bc_track_id: number;
      stream_url: string | null;
      duration_seconds: number | null;
    }>(
      `SELECT tp.id, tp.track_id, tp.played_at, tp.completed_pct, tp.source,
              t.title, t.artist_name, t.album_title, t.cover_url, t.bc_url,
              t.bc_track_id, t.stream_url, t.duration_seconds
         FROM track_plays tp INNER JOIN tracks t ON t.id = tp.track_id
         WHERE t.removed_at IS NULL
         ORDER BY tp.played_at DESC LIMIT ?`,
    )
    .all(limit);
  return rows.map((r) => ({
    id: r.id,
    trackId: r.track_id,
    playedAt: r.played_at,
    completedPct: r.completed_pct,
    source: r.source,
    title: r.title,
    artistName: r.artist_name,
    albumTitle: r.album_title,
    coverUrl: r.cover_url,
    bcUrl: r.bc_url,
    bcTrackId: r.bc_track_id,
    hasStream: r.stream_url !== null,
    durationSeconds: r.duration_seconds,
  }));
}
