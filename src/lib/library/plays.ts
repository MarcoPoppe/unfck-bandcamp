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
    }>(
      `SELECT tp.id, tp.track_id, tp.played_at, tp.completed_pct, tp.source,
              t.title, t.artist_name, t.album_title, t.cover_url, t.bc_url
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
  }));
}
