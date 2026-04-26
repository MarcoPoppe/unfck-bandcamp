import { getDb } from '../db';
import { fetchReleasePage } from '../bandcamp/fetch_release';
import { getStoredAuth } from '../auth/store';
import type { BcReleaseInfo, BcTrackInfo } from '../bandcamp/parse_release';
import { upsertArtist, upsertLabel } from '../entities/store';
import { autoMatchOwnedToWishlist } from '../wishlist/store';

interface CollectionItemRow {
  id: number;
  bc_item_id: number;
  bc_item_type: 'a' | 't';
  bc_url: string;
  title: string;
  artist_name: string | null;
  album_title: string | null;
  cover_url: string | null;
  purchased_at: string | null;
}

const REQUEST_DELAY_MS = 350;

function getUnexpandedItems(): CollectionItemRow[] {
  return getDb()
    .prepare<[], CollectionItemRow>(
      `SELECT ci.id, ci.bc_item_id, ci.bc_item_type, ci.bc_url, ci.title,
              ci.artist_name, ci.album_title, ci.cover_url, ci.purchased_at
         FROM collection_items ci
         WHERE ci.removed_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM tracks t WHERE t.source_collection_item_id = ci.id
           )
         ORDER BY ci.id ASC`,
    )
    .all();
}

function upsertTrackStmt() {
  return getDb().prepare(
    `INSERT INTO tracks (
       bc_track_id, bc_album_id, title, artist_name, artist_url, artist_id,
       album_title, album_url, duration_seconds, track_number,
       cover_url, bc_url, stream_url, stream_url_fetched_at,
       source_collection_item_id, purchased_at, last_seen_run_id, removed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (bc_track_id) DO UPDATE SET
       bc_album_id = excluded.bc_album_id,
       title = excluded.title,
       artist_name = excluded.artist_name,
       artist_url = excluded.artist_url,
       artist_id = COALESCE(excluded.artist_id, tracks.artist_id),
       album_title = excluded.album_title,
       album_url = excluded.album_url,
       duration_seconds = excluded.duration_seconds,
       track_number = excluded.track_number,
       cover_url = excluded.cover_url,
       bc_url = excluded.bc_url,
       stream_url = COALESCE(excluded.stream_url, tracks.stream_url),
       stream_url_fetched_at = COALESCE(excluded.stream_url_fetched_at, tracks.stream_url_fetched_at),
       source_collection_item_id = COALESCE(excluded.source_collection_item_id, tracks.source_collection_item_id),
       purchased_at = COALESCE(excluded.purchased_at, tracks.purchased_at),
       last_seen_run_id = excluded.last_seen_run_id,
       removed_at = NULL`,
  );
}

function persistRelease(
  release: BcReleaseInfo,
  sourceItem: CollectionItemRow,
  runId: number | null,
): number {
  const stmt = upsertTrackStmt();
  const now = new Date().toISOString();
  // Upsert artist row (and label row when bandcamp gave us label_url; we
  // currently only have label_name so we skip the label here — Phase 3 manual
  // label-adds populate the labels table).
  let artistId: number | null = null;
  if (release.artistName && release.artistUrl) {
    artistId = upsertArtist({
      bcUrl: release.artistUrl,
      name: release.artistName,
    });
  }
  const tx = getDb().transaction((tracks: BcTrackInfo[]) => {
    for (const t of tracks) {
      const albumId = release.releaseType === 'a' ? release.bcReleaseId : null;
      stmt.run(
        t.bcTrackId,
        albumId,
        t.title,
        release.artistName,
        release.artistUrl,
        artistId,
        release.albumTitle,
        release.albumUrl,
        t.durationSeconds,
        t.trackNumber,
        release.coverUrl ?? sourceItem.cover_url,
        t.bcUrl,
        t.streamUrl,
        t.streamUrl ? now : null,
        sourceItem.id,
        sourceItem.purchased_at,
        runId,
      );
    }
  });
  tx(release.tracks);
  return release.tracks.length;
}

// Suppress unused-import lint when label is referenced indirectly.
void upsertLabel;

export interface TrackExpansionResult {
  itemsExpanded: number;
  tracksWritten: number;
  wishlistAutoMarked: number;
  errors: { collectionItemId: number; bcUrl: string; error: string }[];
  durationMs: number;
}

/**
 * Expands every owned collection_item that has no tracks yet by fetching
 * its release page and persisting the trackinfo array (with mp3-128 stream
 * URLs when present). Honours a small per-request delay so we don't burst
 * bandcamp.com.
 *
 * Stream URLs are ephemeral signed; the schema records `stream_url_fetched_at`
 * so a later "refresh stale streams" job can re-fetch when they expire.
 */
export async function expandCollectionToTracks(opts?: {
  limit?: number;
  runId?: number | null;
}): Promise<TrackExpansionResult> {
  const auth = getStoredAuth();
  if (!auth) throw new Error('no auth stored');

  const startedAt = Date.now();
  const items = getUnexpandedItems();
  const limit = opts?.limit ?? items.length;
  const targets = items.slice(0, limit);
  const runId = opts?.runId ?? null;

  let tracksWritten = 0;
  const errors: TrackExpansionResult['errors'] = [];

  for (let i = 0; i < targets.length; i += 1) {
    const item = targets[i];
    try {
      const release = await fetchReleasePage(item.bc_url, auth.cookieString);
      tracksWritten += persistRelease(release, item, runId);
    } catch (err) {
      errors.push({
        collectionItemId: item.id,
        bcUrl: item.bc_url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (i < targets.length - 1 && REQUEST_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
  }

  // After expansion the tracks-table contains rows for albums that were
  // collected as albums. Sweep the wishlist: any open row whose bc_track_id
  // is now in tracks (or in collection_items as a track-purchase) has
  // effectively been bought.
  let wishlistAutoMarked = 0;
  try {
    wishlistAutoMarked = autoMatchOwnedToWishlist().matchedCount;
  } catch {
    // wishlist sweep is best-effort
  }

  return {
    itemsExpanded: targets.length,
    tracksWritten,
    wishlistAutoMarked,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

export interface TrackRow {
  id: number;
  bcTrackId: number;
  title: string;
  artistName: string | null;
  artistUrl: string | null;
  albumTitle: string | null;
  albumUrl: string | null;
  durationSeconds: number | null;
  trackNumber: number | null;
  coverUrl: string | null;
  bcUrl: string;
  hasStream: boolean;
}

export function listTracks(opts?: { limit?: number }): TrackRow[] {
  const limit = opts?.limit ?? 200;
  const rows = getDb()
    .prepare<
      [number],
      {
        id: number;
        bc_track_id: number;
        title: string;
        artist_name: string | null;
        artist_url: string | null;
        album_title: string | null;
        album_url: string | null;
        duration_seconds: number | null;
        track_number: number | null;
        cover_url: string | null;
        bc_url: string;
        stream_url: string | null;
      }
    >(
      `SELECT id, bc_track_id, title, artist_name, artist_url, album_title, album_url,
              duration_seconds, track_number, cover_url, bc_url, stream_url
         FROM tracks
         WHERE removed_at IS NULL
         ORDER BY artist_name ASC, album_title ASC, track_number ASC
         LIMIT ?`,
    )
    .all(limit);
  return rows.map((r) => ({
    id: r.id,
    bcTrackId: r.bc_track_id,
    title: r.title,
    artistName: r.artist_name,
    artistUrl: r.artist_url,
    albumTitle: r.album_title,
    albumUrl: r.album_url,
    durationSeconds: r.duration_seconds,
    trackNumber: r.track_number,
    coverUrl: r.cover_url,
    bcUrl: r.bc_url,
    hasStream: r.stream_url !== null,
  }));
}

export function getTrackCount(): number {
  return (
    getDb().prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM tracks WHERE removed_at IS NULL').get() as {
      c: number;
    }
  ).c;
}
