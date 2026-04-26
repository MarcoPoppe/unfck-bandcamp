import { getDb } from '../db';

export interface TagRow {
  id: number;
  name: string;
  color: string;
  trackCount?: number;
}

export function listTags(): TagRow[] {
  // JOIN through tracks with removed_at IS NULL so tombstoned tracks no
  // longer inflate the per-tag count (Codex pass-1 finding 1).
  const rows = getDb()
    .prepare<[], { id: number; name: string; color: string; track_count: number }>(
      `SELECT t.id, t.name, t.color,
              COUNT(CASE WHEN tr.removed_at IS NULL THEN 1 END) AS track_count
         FROM tags t
         LEFT JOIN track_tags tt ON tt.tag_id = t.id
         LEFT JOIN tracks tr ON tr.id = tt.track_id
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE ASC`,
    )
    .all();
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, trackCount: r.track_count }));
}

export function createTag(name: string, color = '#7c5cff'): number {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('tag name must not be empty');
  const db = getDb();
  // Case-insensitive dedupe (Codex pass-1 finding 5): "Sommer 26" and
  // "sommer 26" must collapse onto one tag id.
  const existing = db
    .prepare<[string], { id: number }>(
      'SELECT id FROM tags WHERE LOWER(name) = LOWER(?)',
    )
    .get(trimmed);
  if (existing) return existing.id;
  const info = db
    .prepare('INSERT INTO tags (name, color) VALUES (?, ?)')
    .run(trimmed, color);
  return Number(info.lastInsertRowid);
}

export function deleteTag(id: number): boolean {
  const info = getDb().prepare('DELETE FROM tags WHERE id = ?').run(id);
  return info.changes > 0;
}

export function addTagToTrack(trackId: number, tagId: number): void {
  getDb()
    .prepare(
      `INSERT INTO track_tags (track_id, tag_id) VALUES (?, ?)
         ON CONFLICT (track_id, tag_id) DO NOTHING`,
    )
    .run(trackId, tagId);
}

export function removeTagFromTrack(trackId: number, tagId: number): boolean {
  const info = getDb()
    .prepare('DELETE FROM track_tags WHERE track_id = ? AND tag_id = ?')
    .run(trackId, tagId);
  return info.changes > 0;
}

export function getTagsForTrack(trackId: number): TagRow[] {
  const rows = getDb()
    .prepare<[number], { id: number; name: string; color: string }>(
      `SELECT t.id, t.name, t.color FROM tags t INNER JOIN track_tags tt
         ON tt.tag_id = t.id WHERE tt.track_id = ? ORDER BY t.name COLLATE NOCASE ASC`,
    )
    .all(trackId);
  return rows;
}

export function getTagsForTracks(trackIds: number[]): Map<number, TagRow[]> {
  const map = new Map<number, TagRow[]>();
  if (trackIds.length === 0) return map;
  const placeholders = trackIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare<number[], { track_id: number; id: number; name: string; color: string }>(
      `SELECT tt.track_id, t.id, t.name, t.color
         FROM track_tags tt INNER JOIN tags t ON t.id = tt.tag_id
         WHERE tt.track_id IN (${placeholders})
         ORDER BY t.name COLLATE NOCASE ASC`,
    )
    .all(...trackIds);
  for (const r of rows) {
    const arr = map.get(r.track_id) ?? [];
    arr.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.track_id, arr);
  }
  return map;
}
