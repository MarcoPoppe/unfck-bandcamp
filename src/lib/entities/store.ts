import { getDb } from '../db';

export interface ArtistRow {
  id: number;
  bcUrl: string;
  name: string;
  bcBandId: number | null;
  imageUrl: string | null;
  addedAt: string;
  lastCrawledAt: string | null;
  isFollowed: boolean;
}

export interface LabelRow {
  id: number;
  bcUrl: string;
  name: string;
  imageUrl: string | null;
  addedAt: string;
  lastCrawledAt: string | null;
  isFollowed: boolean;
}

export interface DiggerRow {
  id: number;
  bcUsername: string;
  bcFanId: number | null;
  displayName: string | null;
  imageUrl: string | null;
  addedAt: string;
  lastCrawledAt: string | null;
  isFollowed: boolean;
}

export type EntityType = 'artist' | 'label' | 'digger';

export function normalizeBcUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return url.replace(/\/+$/, '').replace(/[?#].*$/, '').toLowerCase();
  }
}

export function upsertArtist(input: {
  bcUrl: string;
  name: string;
  bcBandId?: number | null;
  imageUrl?: string | null;
}): number {
  const bcUrl = normalizeBcUrl(input.bcUrl);
  const db = getDb();

  // Resolution priority: bc_band_id is the most stable identifier (custom
  // domain + bandcamp.com subdomain share it), fall back to bc_url. Guard
  // against poisoned ids (negative, zero, non-integer) — only positive ints
  // are valid bandcamp band ids.
  if (
    typeof input.bcBandId === 'number' &&
    Number.isInteger(input.bcBandId) &&
    input.bcBandId > 0
  ) {
    const byBandId = db
      .prepare<[number], { id: number }>(
        'SELECT id FROM artists WHERE bc_band_id = ?',
      )
      .get(input.bcBandId);
    if (byBandId) {
      db.prepare(
        `UPDATE artists SET
           name = COALESCE(?, name),
           image_url = COALESCE(?, image_url)
         WHERE id = ?`,
      ).run(input.name, input.imageUrl ?? null, byBandId.id);
      return byBandId.id;
    }
  }
  const existing = db
    .prepare<[string], { id: number }>('SELECT id FROM artists WHERE bc_url = ?')
    .get(bcUrl);
  if (existing) {
    db.prepare(
      `UPDATE artists SET
         name = COALESCE(?, name),
         bc_band_id = COALESCE(?, bc_band_id),
         image_url = COALESCE(?, image_url)
       WHERE id = ?`,
    ).run(input.name, input.bcBandId ?? null, input.imageUrl ?? null, existing.id);
    return existing.id;
  }
  const info = db
    .prepare(
      'INSERT INTO artists (bc_url, name, bc_band_id, image_url) VALUES (?, ?, ?, ?)',
    )
    .run(bcUrl, input.name, input.bcBandId ?? null, input.imageUrl ?? null);
  return Number(info.lastInsertRowid);
}

/**
 * Resolve a label by name only (case-insensitive). Returns the existing
 * label id when one was previously inserted via a real URL-based add,
 * otherwise null. Used during track expansion where the Bandcamp fan API
 * gives us the label name but not the label URL.
 */
export function findLabelIdByName(name: string): number | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const row = getDb()
    .prepare<[string], { id: number }>(
      'SELECT id FROM labels WHERE LOWER(name) = LOWER(?) LIMIT 1',
    )
    .get(trimmed);
  return row ? row.id : null;
}

export function upsertLabel(input: {
  bcUrl: string;
  name: string;
  imageUrl?: string | null;
}): number {
  const bcUrl = normalizeBcUrl(input.bcUrl);
  const db = getDb();
  const existing = db
    .prepare<[string], { id: number }>('SELECT id FROM labels WHERE bc_url = ?')
    .get(bcUrl);
  if (existing) {
    db.prepare(
      `UPDATE labels SET name = COALESCE(?, name), image_url = COALESCE(?, image_url) WHERE id = ?`,
    ).run(input.name, input.imageUrl ?? null, existing.id);
    return existing.id;
  }
  const info = db
    .prepare('INSERT INTO labels (bc_url, name, image_url) VALUES (?, ?, ?)')
    .run(bcUrl, input.name, input.imageUrl ?? null);
  return Number(info.lastInsertRowid);
}

export function upsertDigger(input: {
  bcUsername: string;
  bcFanId?: number | null;
  displayName?: string | null;
  imageUrl?: string | null;
}): number {
  const username = input.bcUsername.trim();
  const db = getDb();
  const existing = db
    .prepare<[string], { id: number }>('SELECT id FROM diggers WHERE bc_username = ?')
    .get(username);
  if (existing) {
    db.prepare(
      `UPDATE diggers SET
         bc_fan_id = COALESCE(?, bc_fan_id),
         display_name = COALESCE(?, display_name),
         image_url = COALESCE(?, image_url)
       WHERE id = ?`,
    ).run(
      input.bcFanId ?? null,
      input.displayName ?? null,
      input.imageUrl ?? null,
      existing.id,
    );
    return existing.id;
  }
  const info = db
    .prepare(
      'INSERT INTO diggers (bc_username, bc_fan_id, display_name, image_url) VALUES (?, ?, ?, ?)',
    )
    .run(
      username,
      input.bcFanId ?? null,
      input.displayName ?? null,
      input.imageUrl ?? null,
    );
  return Number(info.lastInsertRowid);
}

export function follow(entityType: EntityType, entityId: number): boolean {
  const info = getDb()
    .prepare(
      `INSERT INTO following (entity_type, entity_id) VALUES (?, ?)
       ON CONFLICT (entity_type, entity_id) DO NOTHING`,
    )
    .run(entityType, entityId);
  return info.changes > 0;
}

export function unfollow(entityType: EntityType, entityId: number): boolean {
  const info = getDb()
    .prepare('DELETE FROM following WHERE entity_type = ? AND entity_id = ?')
    .run(entityType, entityId);
  return info.changes > 0;
}

export function listFollowedArtists(): ArtistRow[] {
  const rows = getDb()
    .prepare<
      [],
      {
        id: number;
        bc_url: string;
        name: string;
        bc_band_id: number | null;
        image_url: string | null;
        added_at: string;
        last_crawled_at: string | null;
      }
    >(
      `SELECT a.id, a.bc_url, a.name, a.bc_band_id, a.image_url, a.added_at, a.last_crawled_at
         FROM artists a INNER JOIN following f
           ON f.entity_type = 'artist' AND f.entity_id = a.id
         ORDER BY f.followed_at DESC`,
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    bcUrl: r.bc_url,
    name: r.name,
    bcBandId: r.bc_band_id,
    imageUrl: r.image_url,
    addedAt: r.added_at,
    lastCrawledAt: r.last_crawled_at,
    isFollowed: true,
  }));
}

/**
 * Like listFollowedArtists, but scoped to a specific playlist's tagged
 * artists (Mig 20 / Pfad A: playlists are genre buckets that carry
 * artists too). Used by the Discover crawl when the user picks
 * "Source: playlist X" — only the artists tagged into that bucket get
 * crawled, not the user's whole follow list. Followed-status is
 * irrelevant here; tag membership is the criterion.
 */
export function listArtistsTaggedToPlaylist(playlistId: number): ArtistRow[] {
  const rows = getDb()
    .prepare<
      [number],
      {
        id: number;
        bc_url: string;
        name: string;
        bc_band_id: number | null;
        image_url: string | null;
        added_at: string;
        last_crawled_at: string | null;
        followed: number;
      }
    >(
      `SELECT a.id, a.bc_url, a.name, a.bc_band_id, a.image_url, a.added_at, a.last_crawled_at,
              CASE WHEN f.entity_id IS NULL THEN 0 ELSE 1 END AS followed
         FROM artists a
         INNER JOIN playlist_artists pa ON pa.artist_id = a.id
         LEFT JOIN following f
           ON f.entity_type = 'artist' AND f.entity_id = a.id
         WHERE pa.playlist_id = ?
         ORDER BY pa.added_at DESC`,
    )
    .all(playlistId);
  return rows.map((r) => ({
    id: r.id,
    bcUrl: r.bc_url,
    name: r.name,
    bcBandId: r.bc_band_id,
    imageUrl: r.image_url,
    addedAt: r.added_at,
    lastCrawledAt: r.last_crawled_at,
    isFollowed: r.followed === 1,
  }));
}

export function listFollowedLabels(): LabelRow[] {
  const rows = getDb()
    .prepare<
      [],
      {
        id: number;
        bc_url: string;
        name: string;
        image_url: string | null;
        added_at: string;
        last_crawled_at: string | null;
      }
    >(
      `SELECT l.id, l.bc_url, l.name, l.image_url, l.added_at, l.last_crawled_at
         FROM labels l INNER JOIN following f
           ON f.entity_type = 'label' AND f.entity_id = l.id
         ORDER BY f.followed_at DESC`,
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    bcUrl: r.bc_url,
    name: r.name,
    imageUrl: r.image_url,
    addedAt: r.added_at,
    lastCrawledAt: r.last_crawled_at,
    isFollowed: true,
  }));
}

export function listFollowedDiggers(): DiggerRow[] {
  const rows = getDb()
    .prepare<
      [],
      {
        id: number;
        bc_username: string;
        bc_fan_id: number | null;
        display_name: string | null;
        image_url: string | null;
        added_at: string;
        last_crawled_at: string | null;
      }
    >(
      `SELECT d.id, d.bc_username, d.bc_fan_id, d.display_name, d.image_url, d.added_at, d.last_crawled_at
         FROM diggers d INNER JOIN following f
           ON f.entity_type = 'digger' AND f.entity_id = d.id
         ORDER BY f.followed_at DESC`,
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    bcUsername: r.bc_username,
    bcFanId: r.bc_fan_id,
    displayName: r.display_name,
    imageUrl: r.image_url,
    addedAt: r.added_at,
    lastCrawledAt: r.last_crawled_at,
    isFollowed: true,
  }));
}

/** Curators tagged into a specific playlist — the digger-side
 * counterpart to listArtistsTaggedToPlaylist. */
export function listDiggersTaggedToPlaylist(playlistId: number): DiggerRow[] {
  const rows = getDb()
    .prepare<
      [number],
      {
        id: number;
        bc_username: string;
        bc_fan_id: number | null;
        display_name: string | null;
        image_url: string | null;
        added_at: string;
        last_crawled_at: string | null;
        followed: number;
      }
    >(
      `SELECT d.id, d.bc_username, d.bc_fan_id, d.display_name, d.image_url, d.added_at, d.last_crawled_at,
              CASE WHEN f.entity_id IS NULL THEN 0 ELSE 1 END AS followed
         FROM diggers d
         INNER JOIN playlist_curators pc ON pc.digger_id = d.id
         LEFT JOIN following f
           ON f.entity_type = 'digger' AND f.entity_id = d.id
         WHERE pc.playlist_id = ?
         ORDER BY pc.added_at DESC`,
    )
    .all(playlistId);
  return rows.map((r) => ({
    id: r.id,
    bcUsername: r.bc_username,
    bcFanId: r.bc_fan_id,
    displayName: r.display_name,
    imageUrl: r.image_url,
    addedAt: r.added_at,
    lastCrawledAt: r.last_crawled_at,
    isFollowed: r.followed === 1,
  }));
}

export function attachArtistAndLabelToTracks(): { updated: number } {
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE tracks
         SET artist_id = (
           SELECT a.id FROM artists a WHERE a.bc_url = LOWER(tracks.artist_url)
           LIMIT 1
         )
         WHERE artist_id IS NULL AND artist_url IS NOT NULL`,
    )
    .run();
  return { updated: info.changes };
}
