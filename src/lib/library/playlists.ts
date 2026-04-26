import { getDb } from '../db';

export interface PlaylistRow {
  id: number;
  name: string;
  description: string | null;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistTrack {
  id: number;
  trackId: number;
  position: number;
  title: string;
  artistName: string | null;
  albumTitle: string | null;
  coverUrl: string | null;
  bcUrl: string;
  durationSeconds: number | null;
  hasStream: boolean;
  bcTrackId: number;
}

export function listPlaylists(): PlaylistRow[] {
  // JOIN through tracks filtered by removed_at IS NULL so the overview
  // count matches the detail-view count (Codex pass-1 finding 2).
  const rows = getDb()
    .prepare<[], { id: number; name: string; description: string | null; track_count: number; created_at: string; updated_at: string }>(
      `SELECT p.id, p.name, p.description,
              COUNT(CASE WHEN tr.removed_at IS NULL THEN 1 END) AS track_count,
              p.created_at, p.updated_at
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         LEFT JOIN tracks tr ON tr.id = pt.track_id
         GROUP BY p.id ORDER BY p.updated_at DESC`,
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    trackCount: r.track_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function createPlaylist(name: string, description: string | null = null): number {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('playlist name must not be empty');
  const info = getDb()
    .prepare('INSERT INTO playlists (name, description) VALUES (?, ?)')
    .run(trimmed, description);
  return Number(info.lastInsertRowid);
}

export function deletePlaylist(id: number): boolean {
  const info = getDb().prepare('DELETE FROM playlists WHERE id = ?').run(id);
  return info.changes > 0;
}

export function addTrackToPlaylist(playlistId: number, trackId: number): boolean {
  // SELECT MAX(position) + INSERT inside an IMMEDIATE transaction so two
  // concurrent calls cannot read the same MAX and write twin positions
  // (Codex pass-1 finding 3).
  const db = getDb();
  let added = false;
  const tx = db.transaction(() => {
    const existing = db
      .prepare<[number, number], { id: number }>(
        'SELECT id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
      )
      .get(playlistId, trackId);
    if (existing) return;
    const next = db
      .prepare<[number], { p: number | null }>(
        'SELECT MAX(position) AS p FROM playlist_tracks WHERE playlist_id = ?',
      )
      .get(playlistId);
    const position = (next?.p ?? -1) + 1;
    db.prepare(
      'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
    ).run(playlistId, trackId, position);
    db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
    added = true;
  });
  tx.immediate();
  return added;
}

export function removeTrackFromPlaylist(playlistId: number, trackId: number): boolean {
  const db = getDb();
  const info = db
    .prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?')
    .run(playlistId, trackId);
  if (info.changes > 0) {
    db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
  }
  return info.changes > 0;
}

/**
 * Reorder all tracks in a playlist atomically.
 */
export function reorderPlaylist(playlistId: number, orderedTrackIds: number[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const updateStmt = db.prepare(
      'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?',
    );
    for (let i = 0; i < orderedTrackIds.length; i += 1) {
      updateStmt.run(i, playlistId, orderedTrackIds[i]);
    }
    db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
  });
  tx();
}

export function getPlaylistTracks(playlistId: number): PlaylistTrack[] {
  const rows = getDb()
    .prepare<[number], {
      id: number;
      track_id: number;
      position: number;
      title: string;
      artist_name: string | null;
      album_title: string | null;
      cover_url: string | null;
      bc_url: string;
      duration_seconds: number | null;
      stream_url: string | null;
      bc_track_id: number;
    }>(
      `SELECT pt.id, pt.track_id, pt.position, t.title, t.artist_name, t.album_title,
              t.cover_url, t.bc_url, t.duration_seconds, t.stream_url, t.bc_track_id
         FROM playlist_tracks pt INNER JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ? AND t.removed_at IS NULL
         ORDER BY pt.position ASC`,
    )
    .all(playlistId);
  return rows.map((r) => ({
    id: r.id,
    trackId: r.track_id,
    position: r.position,
    title: r.title,
    artistName: r.artist_name,
    albumTitle: r.album_title,
    coverUrl: r.cover_url,
    bcUrl: r.bc_url,
    durationSeconds: r.duration_seconds,
    hasStream: r.stream_url !== null,
    bcTrackId: r.bc_track_id,
  }));
}

export function getPlaylist(id: number): PlaylistRow | null {
  // Same JOIN-through-tracks filter as listPlaylists so a single playlist
  // detail page never reports a higher track count than it actually shows
  // (Codex pass-2 finding 1).
  const row = getDb()
    .prepare<[number], { id: number; name: string; description: string | null; track_count: number; created_at: string; updated_at: string }>(
      `SELECT p.id, p.name, p.description,
              COUNT(CASE WHEN tr.removed_at IS NULL THEN 1 END) AS track_count,
              p.created_at, p.updated_at
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         LEFT JOIN tracks tr ON tr.id = pt.track_id
         WHERE p.id = ? GROUP BY p.id`,
    )
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trackCount: row.track_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
