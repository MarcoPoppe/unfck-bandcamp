import { getDb } from '../db';

export type WishlistStatus = 'open' | 'bought' | 'dismissed';
export type WishlistSource = 'discovery' | 'manual';
export type BcItemType = 't' | 'a';
export type WishlistMirrorState = 'local' | 'pushing' | 'synced' | 'push_failed';

export interface WishlistItem {
  id: number;
  bcItemType: BcItemType;
  bcTrackId?: number;
  bcAlbumId?: number;
  bcUrl: string;
  title: string;
  artistName?: string | null;
  albumTitle?: string | null;
  coverUrl?: string | null;
  status?: string | null;
  source?: string | null;
  addedAt?: string;
  boughtAt?: string | null;
  boughtVia?: string | null;
  dismissedAt?: string | null;
  bcSyncedAt?: string | null;
  mirrorState: WishlistMirrorState;
  mirrorError?: string | null;
  // Annotations added by list-query JOINs (not stored on the wishlist row
  // itself). Optional so single-row reads don't have to provide them.
  localTrackId?: number | null;
  hasStream?: boolean;
  hasBeenPlayed?: boolean;
  /** Playlists this track sits in. Annotated by the page loader, not stored
   * on the wishlist row itself. Empty array when the track is in no
   * playlists (or hasn't been resolved into the local tracks table yet). */
  playlists?: { id: number; name: string }[];
}

interface WishlistRow {
  id: number;
  bc_track_id: number | null;
  bc_album_id: number | null;
  bc_item_type: BcItemType;
  bc_url: string;
  title: string;
  artist_name: string | null;
  album_title: string | null;
  cover_url: string | null;
  status: WishlistStatus | null;
  source: WishlistSource | null;
  added_at: string | null;
  bought_at: string | null;
  bought_via: 'manual' | 'auto' | null;
  dismissed_at: string | null;
  bc_synced_at: string | null;
  mirror_state: WishlistMirrorState;
  mirror_error: string | null;
  local_track_id: number | null;
  local_stream_url: string | null;
}

function fromRow(r: WishlistRow): WishlistItem {
  return {
    id: r.id,
    bcItemType: r.bc_item_type,
    bcTrackId: r.bc_track_id ?? undefined,
    bcAlbumId: r.bc_album_id ?? undefined,
    bcUrl: r.bc_url,
    title: r.title,
    artistName: r.artist_name,
    albumTitle: r.album_title,
    coverUrl: r.cover_url,
    status: r.status,
    source: r.source,
    addedAt: r.added_at ?? undefined,
    boughtAt: r.bought_at,
    boughtVia: r.bought_via,
    dismissedAt: r.dismissed_at,
    bcSyncedAt: r.bc_synced_at,
    mirrorState: r.mirror_state,
    mirrorError: r.mirror_error,
    localTrackId: r.local_track_id,
    hasStream: !!r.local_stream_url,
  };
}

type AddInput =
  | {
      bcItemType: 't';
      bcTrackId: number;
      bcAlbumId?: never;
      bcUrl: string;
      title: string;
      artistName?: string | null;
      albumTitle?: string | null;
      coverUrl?: string | null;
      source?: string | null;
    }
  | {
      bcItemType: 'a';
      bcAlbumId: number;
      bcTrackId?: never;
      bcUrl: string;
      title: string;
      artistName?: string | null;
      albumTitle?: string | null;
      coverUrl?: string | null;
      source?: string | null;
    };

export function addToWishlist(input: AddInput): number {
  if (input.bcItemType === 't' && (!('bcTrackId' in input) || input.bcTrackId == null)) {
    throw new Error('addToWishlist: bcTrackId required for itemType=t');
  }
  if (input.bcItemType === 'a' && (!('bcAlbumId' in input) || input.bcAlbumId == null)) {
    throw new Error('addToWishlist: bcAlbumId required for itemType=a');
  }
  // Runtime XOR: reject if BOTH ids passed (caller bypassed TypeScript union)
  if (
    'bcTrackId' in input &&
    'bcAlbumId' in input &&
    (input as { bcTrackId?: number }).bcTrackId != null &&
    (input as { bcAlbumId?: number }).bcAlbumId != null
  ) {
    throw new Error('addToWishlist: cannot set both bcTrackId and bcAlbumId');
  }
  const info = getDb()
    .prepare(
      `
      INSERT INTO wishlist
        (bc_item_type, bc_track_id, bc_album_id, bc_url, title, artist_name, album_title, cover_url, source, added_at, mirror_state, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'local', 'open')
    `,
    )
    .run(
      input.bcItemType,
      input.bcItemType === 't' ? input.bcTrackId : null,
      input.bcItemType === 'a' ? input.bcAlbumId : null,
      input.bcUrl,
      input.title,
      input.artistName ?? null,
      input.albumTitle ?? null,
      input.coverUrl ?? null,
      input.source ?? 'local',
    );
  return Number(info.lastInsertRowid);
}

export function removeFromWishlist(itemType: BcItemType, itemId: number): boolean {
  const sql =
    itemType === 't'
      ? 'DELETE FROM wishlist WHERE bc_track_id = ?'
      : 'DELETE FROM wishlist WHERE bc_album_id = ?';
  const info = getDb().prepare(sql).run(itemId);
  return info.changes > 0;
}

export function reopenWishlistItem(itemType: BcItemType, itemId: number): void {
  const sql =
    itemType === 't'
      ? `UPDATE wishlist SET dismissed_at=NULL, bought_at=NULL, bought_via=NULL, bc_synced_at=NULL, mirror_state='local' WHERE bc_track_id = ?`
      : `UPDATE wishlist SET dismissed_at=NULL, bought_at=NULL, bought_via=NULL, bc_synced_at=NULL, mirror_state='local' WHERE bc_album_id = ?`;
  getDb().prepare(sql).run(itemId);
}

export function isOwned(itemType: BcItemType, itemId: number): boolean {
  const row = getDb()
    .prepare(
      `
      SELECT 1 AS hit FROM collection_items
      WHERE bc_item_type = ? AND bc_item_id = ? AND removed_at IS NULL
    `,
    )
    .get(itemType, itemId);
  return row != null;
}

export function setMirrorState(
  itemType: BcItemType,
  itemId: number,
  state: WishlistMirrorState,
  error?: string | null,
): void {
  const where = itemType === 't' ? 'bc_track_id = ?' : 'bc_album_id = ?';
  getDb()
    .prepare(`UPDATE wishlist SET mirror_state = ?, mirror_error = ? WHERE ${where}`)
    .run(state, error ?? null, itemId);
}

export function setBcSyncedAt(itemType: BcItemType, itemId: number, at: string): void {
  const where = itemType === 't' ? 'bc_track_id = ?' : 'bc_album_id = ?';
  getDb().prepare(`UPDATE wishlist SET bc_synced_at = ? WHERE ${where}`).run(at, itemId);
}

export function listWishlist(status?: WishlistStatus): WishlistItem[] {
  const db = getDb();
  const rows = status
    ? db
        .prepare<[WishlistStatus], WishlistRow>(
          `SELECT w.id, w.bc_track_id, w.bc_album_id, w.bc_item_type, w.bc_url, w.title,
                  w.artist_name, w.album_title, w.cover_url, w.status, w.source,
                  w.added_at, w.bought_at, w.bought_via, w.dismissed_at,
                  w.bc_synced_at, w.mirror_state, w.mirror_error,
                  t.id AS local_track_id, t.stream_url AS local_stream_url
             FROM wishlist w
             LEFT JOIN tracks t
               ON t.bc_track_id = w.bc_track_id AND t.removed_at IS NULL
            WHERE w.status = ?
            ORDER BY w.added_at DESC`,
        )
        .all(status)
    : db
        .prepare<[], WishlistRow>(
          `SELECT w.id, w.bc_track_id, w.bc_album_id, w.bc_item_type, w.bc_url, w.title,
                  w.artist_name, w.album_title, w.cover_url, w.status, w.source,
                  w.added_at, w.bought_at, w.bought_via, w.dismissed_at,
                  w.bc_synced_at, w.mirror_state, w.mirror_error,
                  t.id AS local_track_id, t.stream_url AS local_stream_url
             FROM wishlist w
             LEFT JOIN tracks t
               ON t.bc_track_id = w.bc_track_id AND t.removed_at IS NULL
            ORDER BY w.added_at DESC`,
        )
        .all();
  return rows.map(fromRow);
}

export function getWishlistStatusCounts(): Record<WishlistStatus, number> {
  const rows = getDb()
    .prepare<[], { status: WishlistStatus; c: number }>(
      'SELECT status, COUNT(*) AS c FROM wishlist GROUP BY status',
    )
    .all();
  const counts: Record<WishlistStatus, number> = { open: 0, bought: 0, dismissed: 0 };
  for (const r of rows) counts[r.status] = r.c;
  return counts;
}

export function markBoughtBatch(ids: number[]): number {
  if (ids.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE wishlist SET status = 'bought', bought_at = datetime('now'), bought_via = 'manual'
       WHERE id = ? AND status = 'open'`,
  );
  let updated = 0;
  const tx = db.transaction(() => {
    for (const id of ids) {
      const info = stmt.run(id);
      if (info.changes > 0) updated += 1;
    }
  });
  tx();
  return updated;
}

export function dismissItem(id: number): boolean {
  const info = getDb()
    .prepare(
      `UPDATE wishlist
         SET status = 'dismissed', dismissed_at = datetime('now')
         WHERE id = ? AND status = 'open'`,
    )
    .run(id);
  return info.changes > 0;
}

export function reopenItem(id: number): boolean {
  const info = getDb()
    .prepare(
      `UPDATE wishlist
         SET status = 'open',
             bought_at = CASE WHEN status = 'bought' THEN NULL ELSE bought_at END,
             bought_via = CASE WHEN status = 'bought' THEN NULL ELSE bought_via END,
             dismissed_at = NULL
         WHERE id = ? AND status != 'open'`,
    )
    .run(id);
  return info.changes > 0;
}

// Mark wishlist items as bought when their bc_track_id appears in
// collection_items — i.e. the user actually purchased them on Bandcamp.
// Important: we match ONLY against collection_items, never against `tracks`.
// `tracks` contains every track the app has ever resolved (lookup, player,
// EP-expand, discovery), so matching there would mark wishlist items as
// bought just because the user listened to them once.
export function autoMarkBoughtFromCollection(): {
  matchedCount: number;
  matched: { id: number; title: string }[];
} {
  const db = getDb();
  const candidates = db
    .prepare<[], { id: number; title: string }>(
      `SELECT w.id, w.title FROM wishlist w
         WHERE w.status = 'open'
           AND EXISTS (
             SELECT 1 FROM collection_items ci
              WHERE ci.bc_item_id = w.bc_track_id
                AND ci.removed_at IS NULL
           )`,
    )
    .all();
  if (candidates.length === 0) return { matchedCount: 0, matched: [] };
  const stmt = db.prepare(
    `UPDATE wishlist SET status = 'bought', bought_at = datetime('now'), bought_via = 'auto'
       WHERE id = ? AND status = 'open'`,
  );
  const matched: { id: number; title: string }[] = [];
  const tx = db.transaction(() => {
    for (const r of candidates) {
      const info = stmt.run(r.id);
      if (info.changes > 0) matched.push(r);
    }
  });
  tx();
  return { matchedCount: matched.length, matched };
}
