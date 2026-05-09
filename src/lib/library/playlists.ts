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
  hasBeenPlayed?: boolean;
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

export interface PlaylistMembership {
  id: number;
  name: string;
}

export interface PlaylistWithMembership extends PlaylistRow {
  /** True when the queried track is currently in this playlist. */
  contains: boolean;
}

/**
 * Like listPlaylists() but each row also carries `contains: bool` indicating
 * whether the given local track id is already in the playlist. Used by the
 * track-row playlist dropdown to render checkboxes the user can toggle.
 */
export function listPlaylistsWithMembership(trackId: number): PlaylistWithMembership[] {
  const rows = getDb()
    .prepare<[number], {
      id: number;
      name: string;
      description: string | null;
      track_count: number;
      created_at: string;
      updated_at: string;
      contains: number;
    }>(
      `SELECT p.id, p.name, p.description,
              COUNT(CASE WHEN tr.removed_at IS NULL THEN 1 END) AS track_count,
              p.created_at, p.updated_at,
              EXISTS (
                SELECT 1 FROM playlist_tracks pt2
                 WHERE pt2.playlist_id = p.id AND pt2.track_id = ?
              ) AS contains
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         LEFT JOIN tracks tr ON tr.id = pt.track_id
         GROUP BY p.id ORDER BY p.updated_at DESC`,
    )
    .all(trackId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    trackCount: r.track_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    contains: r.contains === 1,
  }));
}

/**
 * For each given local track id, return the list of playlists it sits in.
 * Returns a Map keyed by track_id; tracks with zero memberships are absent.
 * Used to render an "in N playlists" badge on track rows.
 */
export function getPlaylistMembershipForTrackIds(
  trackIds: number[],
): Map<number, PlaylistMembership[]> {
  const map = new Map<number, PlaylistMembership[]>();
  if (trackIds.length === 0) return map;
  const placeholders = trackIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare<number[], { track_id: number; id: number; name: string }>(
      `SELECT pt.track_id, p.id, p.name
         FROM playlist_tracks pt
         INNER JOIN playlists p ON p.id = pt.playlist_id
         WHERE pt.track_id IN (${placeholders})
         ORDER BY p.name ASC`,
    )
    .all(...trackIds);
  for (const r of rows) {
    const list = map.get(r.track_id) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.track_id, list);
  }
  return map;
}

/**
 * Full membership map keyed by local tracks.id. Used by AppShell to hydrate
 * the live store on first mount so per-row badges across the app reflect
 * accurate state without each page refetching. Compact: only tracks with
 * at least one playlist appear.
 */
export function getAllPlaylistMemberships(): Map<number, PlaylistMembership[]> {
  const map = new Map<number, PlaylistMembership[]>();
  const rows = getDb()
    .prepare<[], { track_id: number; id: number; name: string }>(
      `SELECT pt.track_id, p.id, p.name
         FROM playlist_tracks pt
         INNER JOIN playlists p ON p.id = pt.playlist_id
         INNER JOIN tracks t ON t.id = pt.track_id
         WHERE t.removed_at IS NULL
         ORDER BY p.name ASC`,
    )
    .all();
  for (const r of rows) {
    const list = map.get(r.track_id) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.track_id, list);
  }
  return map;
}

/**
 * Same lookup but keyed by bc_track_id, useful where the caller has
 * wishlist/discover rows that may not yet have a local tracks.id resolved.
 * Items without a matching local track row are simply absent from the map.
 */
export function getPlaylistMembershipForBcTrackIds(
  bcTrackIds: number[],
): Map<number, PlaylistMembership[]> {
  const map = new Map<number, PlaylistMembership[]>();
  if (bcTrackIds.length === 0) return map;
  const placeholders = bcTrackIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare<number[], { bc_track_id: number; id: number; name: string }>(
      `SELECT t.bc_track_id, p.id, p.name
         FROM tracks t
         INNER JOIN playlist_tracks pt ON pt.track_id = t.id
         INNER JOIN playlists p ON p.id = pt.playlist_id
         WHERE t.bc_track_id IN (${placeholders}) AND t.removed_at IS NULL
         ORDER BY p.name ASC`,
    )
    .all(...bcTrackIds);
  for (const r of rows) {
    const list = map.get(r.bc_track_id) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.bc_track_id, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Playlist membership for artists + curators (Mig 20)
//
// Pfad A from the design discussion: a playlist is a genre bucket, not just
// a track list. Artists and curators get attached to a playlist so Discover
// can scope a crawl to just the followings tagged into that bucket. An
// entity can sit in multiple playlists.
// ---------------------------------------------------------------------------

export interface PlaylistArtistRow {
  artistId: number;
  name: string;
  imageUrl: string | null;
  bcUrl: string;
  addedAt: string;
}

export interface PlaylistCuratorRow {
  diggerId: number;
  bcUsername: string;
  displayName: string | null;
  imageUrl: string | null;
  bcFanId: number | null;
  addedAt: string;
}

export function listPlaylistArtists(playlistId: number): PlaylistArtistRow[] {
  const rows = getDb()
    .prepare<[number], {
      artist_id: number;
      name: string;
      image_url: string | null;
      bc_url: string;
      added_at: string;
    }>(
      `SELECT pa.artist_id, a.name, a.image_url, a.bc_url, pa.added_at
         FROM playlist_artists pa
         INNER JOIN artists a ON a.id = pa.artist_id
         WHERE pa.playlist_id = ?
         ORDER BY a.name ASC`,
    )
    .all(playlistId);
  return rows.map((r) => ({
    artistId: r.artist_id,
    name: r.name,
    imageUrl: r.image_url,
    bcUrl: r.bc_url,
    addedAt: r.added_at,
  }));
}

export function listPlaylistCurators(playlistId: number): PlaylistCuratorRow[] {
  const rows = getDb()
    .prepare<[number], {
      digger_id: number;
      bc_username: string;
      display_name: string | null;
      image_url: string | null;
      bc_fan_id: number | null;
      added_at: string;
    }>(
      `SELECT pc.digger_id, d.bc_username, d.display_name, d.image_url, d.bc_fan_id, pc.added_at
         FROM playlist_curators pc
         INNER JOIN diggers d ON d.id = pc.digger_id
         WHERE pc.playlist_id = ?
         ORDER BY d.bc_username ASC`,
    )
    .all(playlistId);
  return rows.map((r) => ({
    diggerId: r.digger_id,
    bcUsername: r.bc_username,
    displayName: r.display_name,
    imageUrl: r.image_url,
    bcFanId: r.bc_fan_id,
    addedAt: r.added_at,
  }));
}

export function addArtistToPlaylist(playlistId: number, artistId: number): boolean {
  const db = getDb();
  const info = db
    .prepare(
      'INSERT OR IGNORE INTO playlist_artists (playlist_id, artist_id) VALUES (?, ?)',
    )
    .run(playlistId, artistId);
  if (info.changes > 0) {
    db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
    return true;
  }
  return false;
}

export function removeArtistFromPlaylist(playlistId: number, artistId: number): boolean {
  const db = getDb();
  const info = db
    .prepare('DELETE FROM playlist_artists WHERE playlist_id = ? AND artist_id = ?')
    .run(playlistId, artistId);
  if (info.changes > 0) {
    db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
  }
  return info.changes > 0;
}

export function addCuratorToPlaylist(playlistId: number, diggerId: number): boolean {
  const db = getDb();
  const info = db
    .prepare(
      'INSERT OR IGNORE INTO playlist_curators (playlist_id, digger_id) VALUES (?, ?)',
    )
    .run(playlistId, diggerId);
  if (info.changes > 0) {
    db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
    return true;
  }
  return false;
}

export function removeCuratorFromPlaylist(playlistId: number, diggerId: number): boolean {
  const db = getDb();
  const info = db
    .prepare('DELETE FROM playlist_curators WHERE playlist_id = ? AND digger_id = ?')
    .run(playlistId, diggerId);
  if (info.changes > 0) {
    db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
  }
  return info.changes > 0;
}

/** For the "Add to playlist" dropdown on an artist or curator profile:
 * each playlist row is annotated with whether the entity is already in it. */
export function listPlaylistsWithArtistMembership(
  artistId: number,
): { id: number; name: string; contains: boolean }[] {
  return getDb()
    .prepare<[number], { id: number; name: string; contains: number }>(
      `SELECT p.id, p.name,
              EXISTS (
                SELECT 1 FROM playlist_artists pa
                 WHERE pa.playlist_id = p.id AND pa.artist_id = ?
              ) AS contains
         FROM playlists p ORDER BY p.updated_at DESC`,
    )
    .all(artistId)
    .map((r) => ({ id: r.id, name: r.name, contains: r.contains === 1 }));
}

export function listPlaylistsWithCuratorMembership(
  diggerId: number,
): { id: number; name: string; contains: boolean }[] {
  return getDb()
    .prepare<[number], { id: number; name: string; contains: number }>(
      `SELECT p.id, p.name,
              EXISTS (
                SELECT 1 FROM playlist_curators pc
                 WHERE pc.playlist_id = p.id AND pc.digger_id = ?
              ) AS contains
         FROM playlists p ORDER BY p.updated_at DESC`,
    )
    .all(diggerId)
    .map((r) => ({ id: r.id, name: r.name, contains: r.contains === 1 }));
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
