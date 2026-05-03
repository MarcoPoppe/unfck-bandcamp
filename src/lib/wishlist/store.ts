import { getDb } from '../db';

export type WishlistStatus = 'open' | 'bought' | 'dismissed';
export type WishlistSource = 'discovery' | 'manual';

export interface WishlistItem {
  id: number;
  bcTrackId: number;
  bcUrl: string;
  title: string;
  artistName: string | null;
  albumTitle: string | null;
  coverUrl: string | null;
  status: WishlistStatus;
  source: WishlistSource;
  addedAt: string;
  boughtAt: string | null;
  boughtVia: 'manual' | 'auto' | null;
  dismissedAt: string | null;
  localTrackId: number | null;
  hasStream: boolean;
  hasBeenPlayed?: boolean;
  /** Playlists this track sits in. Annotated by the page loader, not stored
   * on the wishlist row itself. Empty array when the track is in no
   * playlists (or hasn't been resolved into the local tracks table yet). */
  playlists?: { id: number; name: string }[];
}

interface WishlistRow {
  id: number;
  bc_track_id: number;
  bc_url: string;
  title: string;
  artist_name: string | null;
  album_title: string | null;
  cover_url: string | null;
  status: WishlistStatus;
  source: WishlistSource;
  added_at: string;
  bought_at: string | null;
  bought_via: 'manual' | 'auto' | null;
  dismissed_at: string | null;
  local_track_id: number | null;
  local_stream_url: string | null;
}

function fromRow(r: WishlistRow): WishlistItem {
  return {
    id: r.id,
    bcTrackId: r.bc_track_id,
    bcUrl: r.bc_url,
    title: r.title,
    artistName: r.artist_name,
    albumTitle: r.album_title,
    coverUrl: r.cover_url,
    status: r.status,
    source: r.source,
    addedAt: r.added_at,
    boughtAt: r.bought_at,
    boughtVia: r.bought_via,
    dismissedAt: r.dismissed_at,
    localTrackId: r.local_track_id,
    hasStream: !!r.local_stream_url,
  };
}

export interface AddToWishlistInput {
  bcTrackId: number;
  bcUrl: string;
  title: string;
  artistName?: string | null;
  albumTitle?: string | null;
  coverUrl?: string | null;
  source?: WishlistSource;
}

export function addToWishlist(input: AddToWishlistInput): { id: number; created: boolean } {
  const db = getDb();
  const existing = db
    .prepare<[number], { id: number; status: WishlistStatus }>(
      'SELECT id, status FROM wishlist WHERE bc_track_id = ?',
    )
    .get(input.bcTrackId);
  if (existing) {
    if (existing.status !== 'open') {
      // Reopen wipes the terminal-state bookkeeping fully (Codex pass-1 A2):
      // a track that was previously 'bought' or 'dismissed' must not retain
      // stale bought_at/bought_via/dismissed_at after the user re-adds it.
      db.prepare(
        `UPDATE wishlist
           SET status = 'open',
               bought_at = NULL,
               bought_via = NULL,
               dismissed_at = NULL
           WHERE id = ?`,
      ).run(existing.id);
    }
    return { id: existing.id, created: false };
  }
  const info = db
    .prepare(
      `INSERT INTO wishlist (
         bc_track_id, bc_url, title, artist_name, album_title, cover_url, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.bcTrackId,
      input.bcUrl,
      input.title,
      input.artistName ?? null,
      input.albumTitle ?? null,
      input.coverUrl ?? null,
      input.source ?? 'discovery',
    );
  return { id: Number(info.lastInsertRowid), created: true };
}

export function listWishlist(status?: WishlistStatus): WishlistItem[] {
  const db = getDb();
  const rows = status
    ? db
        .prepare<[WishlistStatus], WishlistRow>(
          `SELECT w.id, w.bc_track_id, w.bc_url, w.title, w.artist_name, w.album_title,
                  w.cover_url, w.status, w.source, w.added_at, w.bought_at, w.bought_via,
                  w.dismissed_at,
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
          `SELECT w.id, w.bc_track_id, w.bc_url, w.title, w.artist_name, w.album_title,
                  w.cover_url, w.status, w.source, w.added_at, w.bought_at, w.bought_via,
                  w.dismissed_at,
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
