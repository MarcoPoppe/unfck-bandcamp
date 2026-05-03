import { getDb } from '../db';

export type Rating = -1 | 0 | 1;

export interface CurationRow {
  rating: Rating;
  archivedAt: string | null;
  updatedAt: string;
}

interface DbRow {
  rating: number;
  archived_at: string | null;
  updated_at: string;
}

function toRow(r: DbRow): CurationRow {
  const rating = (r.rating === -1 || r.rating === 1 ? r.rating : 0) as Rating;
  return {
    rating,
    archivedAt: r.archived_at,
    updatedAt: r.updated_at,
  };
}

export function getCuration(trackId: number): CurationRow {
  const r = getDb()
    .prepare<[number], DbRow>(
      'SELECT rating, archived_at, updated_at FROM track_curation WHERE track_id = ?',
    )
    .get(trackId);
  if (!r) {
    return { rating: 0, archivedAt: null, updatedAt: '' };
  }
  return toRow(r);
}

export function getCurationForTracks(trackIds: number[]): Map<number, CurationRow> {
  const map = new Map<number, CurationRow>();
  if (trackIds.length === 0) return map;
  const placeholders = trackIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare<number[], DbRow & { track_id: number }>(
      `SELECT track_id, rating, archived_at, updated_at
         FROM track_curation
         WHERE track_id IN (${placeholders})`,
    )
    .all(...trackIds);
  for (const r of rows) {
    map.set(r.track_id, toRow(r));
  }
  return map;
}

export function setRating(trackId: number, rating: Rating): void {
  if (rating !== -1 && rating !== 0 && rating !== 1) {
    throw new Error(`invalid rating: ${rating}`);
  }
  getDb()
    .prepare(
      `INSERT INTO track_curation (track_id, rating, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT (track_id) DO UPDATE SET
         rating = excluded.rating,
         updated_at = excluded.updated_at`,
    )
    .run(trackId, rating);
}

export function setArchived(trackId: number, archived: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO track_curation (track_id, archived_at, updated_at)
       VALUES (?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, datetime('now'))
       ON CONFLICT (track_id) DO UPDATE SET
         archived_at = CASE WHEN excluded.archived_at IS NULL THEN NULL ELSE COALESCE(track_curation.archived_at, excluded.archived_at) END,
         updated_at = excluded.updated_at`,
    )
    .run(trackId, archived ? 1 : 0);
}
