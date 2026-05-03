import { getDb } from '../db';
import { fetchReleasePage } from '../bandcamp/fetch_release';
import { getStoredAuth } from '../auth/store';
import type { BcReleaseInfo, BcTrackInfo } from '../bandcamp/parse_release';
import { findLabelIdByName, upsertArtist } from '../entities/store';
import { recordSyncError } from './errors_store';

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
  label_name: string | null;
}

const REQUEST_DELAY_MS = 350;

function getUnexpandedItems(): CollectionItemRow[] {
  return getDb()
    .prepare<[], CollectionItemRow>(
      `SELECT ci.id, ci.bc_item_id, ci.bc_item_type, ci.bc_url, ci.title,
              ci.artist_name, ci.album_title, ci.cover_url, ci.purchased_at,
              ci.label_name
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
       label_id,
       album_title, album_url, duration_seconds, track_number,
       cover_url, bc_url, stream_url, stream_url_fetched_at, released_at,
       source_collection_item_id, purchased_at, last_seen_run_id, removed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (bc_track_id) DO UPDATE SET
       bc_album_id = excluded.bc_album_id,
       title = excluded.title,
       artist_name = excluded.artist_name,
       artist_url = excluded.artist_url,
       artist_id = COALESCE(excluded.artist_id, tracks.artist_id),
       label_id = COALESCE(excluded.label_id, tracks.label_id),
       album_title = excluded.album_title,
       album_url = excluded.album_url,
       duration_seconds = excluded.duration_seconds,
       track_number = excluded.track_number,
       cover_url = excluded.cover_url,
       bc_url = excluded.bc_url,
       stream_url = COALESCE(excluded.stream_url, tracks.stream_url),
       stream_url_fetched_at = COALESCE(excluded.stream_url_fetched_at, tracks.stream_url_fetched_at),
       released_at = COALESCE(excluded.released_at, tracks.released_at),
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
  let artistId: number | null = null;
  if (release.artistName && release.artistUrl) {
    artistId = upsertArtist({
      bcUrl: release.artistUrl,
      name: release.artistName,
      bcBandId: release.artistBandId,
    });
  }
  // Resolve label_id by matching against existing labels by name. Bandcamp's
  // fan API gives us label_name on the collection_item but rarely a label
  // URL, so we don't auto-create label rows here — that would risk
  // duplicates against URL-based follows. If the user has explicitly added
  // the label via /follows, the name match wires the FK now.
  let labelId: number | null = null;
  if (sourceItem.label_name) {
    labelId = findLabelIdByName(sourceItem.label_name);
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
        labelId,
        release.albumTitle,
        release.albumUrl,
        t.durationSeconds,
        t.trackNumber,
        release.coverUrl ?? sourceItem.cover_url,
        t.bcUrl,
        t.streamUrl,
        t.streamUrl ? now : null,
        release.releaseDate ?? null,
        sourceItem.id,
        sourceItem.purchased_at,
        runId,
      );
    }
  });
  tx(release.tracks);
  return release.tracks.length;
}


export interface TrackExpansionResult {
  itemsExpanded: number;
  tracksWritten: number;
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
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ collectionItemId: item.id, bcUrl: item.bc_url, error: message });
      recordSyncError({
        kind: 'tracks',
        runId: runId ?? null,
        itemUrl: item.bc_url,
        itemTitle: item.title,
        message,
      });
    }
    if (i < targets.length - 1 && REQUEST_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
  }

  return {
    itemsExpanded: targets.length,
    tracksWritten,
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
  labelId: number | null;
  labelName: string | null;
  labelBcUrl: string | null;
  bpm: number | null;
}

export type TrackRatingFilter = 'all' | 'liked' | 'disliked' | 'unrated';
export type TrackSortMode = 'artist' | 'recent' | 'rating';

export interface ListTracksOpts {
  limit?: number;
  ownedOnly?: boolean;
  includeArchived?: boolean;
  archivedOnly?: boolean;
  rating?: TrackRatingFilter;
  search?: string;
  sort?: TrackSortMode;
}

interface ListedTrackDbRow {
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
  rating: number;
  archived_at: string | null;
  source_collection_item_id: number | null;
  purchased_at: string | null;
  label_id: number | null;
  label_resolved_name: string | null;
  label_bc_url: string | null;
  bpm: number | null;
}

export interface TrackRowExtended extends TrackRow {
  rating: -1 | 0 | 1;
  archivedAt: string | null;
  isOwned: boolean;
  hasBeenPlayed: boolean;
}

function annotatePlayed<T extends { bcTrackId: number }>(
  rows: T[],
  played: Set<number>,
): Array<T & { hasBeenPlayed: boolean }> {
  return rows.map((r) => ({ ...r, hasBeenPlayed: played.has(r.bcTrackId) }));
}

function buildListWhere(opts: ListTracksOpts): { where: string; params: (string | number)[] } {
  const conds: string[] = ['t.removed_at IS NULL'];
  const params: (string | number)[] = [];

  if (opts.ownedOnly !== false) {
    conds.push('t.source_collection_item_id IS NOT NULL');
  }
  if (opts.archivedOnly) {
    conds.push('c.archived_at IS NOT NULL');
  } else if (!opts.includeArchived) {
    conds.push('c.archived_at IS NULL');
  }
  if (opts.rating === 'liked') conds.push('COALESCE(c.rating, 0) = 1');
  else if (opts.rating === 'disliked') conds.push('COALESCE(c.rating, 0) = -1');
  else if (opts.rating === 'unrated') conds.push('COALESCE(c.rating, 0) = 0');

  if (opts.search && opts.search.trim()) {
    const term = `%${opts.search.trim().toLowerCase()}%`;
    conds.push(
      '(LOWER(t.title) LIKE ? OR LOWER(t.artist_name) LIKE ? OR LOWER(t.album_title) LIKE ?)',
    );
    params.push(term, term, term);
  }

  return {
    where: conds.length ? `WHERE ${conds.join(' AND ')}` : '',
    params,
  };
}

function buildOrderBy(sort: TrackSortMode | undefined): string {
  switch (sort) {
    case 'recent':
      return 'ORDER BY COALESCE(t.purchased_at, t.bc_url) DESC';
    case 'rating':
      return 'ORDER BY COALESCE(c.rating, 0) DESC, t.artist_name ASC, t.album_title ASC, t.track_number ASC';
    case 'artist':
    default:
      return 'ORDER BY t.artist_name ASC, t.album_title ASC, t.track_number ASC';
  }
}

export function listTracks(opts: ListTracksOpts = {}): TrackRowExtended[] {
  const limit = opts.limit ?? 200;
  const { where, params } = buildListWhere(opts);
  const orderBy = buildOrderBy(opts.sort);
  // has_been_played is derived at the page level via getPlayedBcTrackIds()
  // and applied by the page loader. Keeping it out of this query removes a
  // correlated EXISTS subquery that doesn't scale at 10k+ plays.
  const sql = `SELECT t.id, t.bc_track_id, t.title, t.artist_name, t.artist_url,
                      t.album_title, t.album_url, t.duration_seconds, t.track_number,
                      t.cover_url, t.bc_url, t.stream_url,
                      COALESCE(c.rating, 0) AS rating, c.archived_at,
                      t.source_collection_item_id, t.purchased_at,
                      t.label_id, t.bpm,
                      l.name AS label_resolved_name,
                      l.bc_url AS label_bc_url
                 FROM tracks t
                 LEFT JOIN track_curation c ON c.track_id = t.id
                 LEFT JOIN labels l ON l.id = t.label_id
                 ${where}
                 ${orderBy}
                 LIMIT ?`;
  const rows = getDb()
    .prepare<(string | number)[], ListedTrackDbRow>(sql)
    .all(...params, limit);
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
    labelId: r.label_id,
    labelName: r.label_resolved_name,
    labelBcUrl: r.label_bc_url,
    bpm: r.bpm,
    rating: (r.rating === -1 || r.rating === 1 ? r.rating : 0) as -1 | 0 | 1,
    archivedAt: r.archived_at,
    isOwned: r.source_collection_item_id !== null,
    hasBeenPlayed: false, // populated by the page loader via annotatePlayedTracks
  }));
}

export function annotatePlayedTracks(
  tracks: TrackRowExtended[],
  played: Set<number>,
): TrackRowExtended[] {
  if (played.size === 0) return tracks;
  return annotatePlayed(tracks, played);
}

export function getTrackCount(opts: { ownedOnly?: boolean; includeArchived?: boolean } = {}): number {
  const conds: string[] = ['t.removed_at IS NULL'];
  if (opts.ownedOnly !== false) conds.push('t.source_collection_item_id IS NOT NULL');
  if (!opts.includeArchived) conds.push('c.archived_at IS NULL');
  const sql = `SELECT COUNT(*) AS c
                 FROM tracks t LEFT JOIN track_curation c ON c.track_id = t.id
                 WHERE ${conds.join(' AND ')}`;
  const row = getDb().prepare<[], { c: number }>(sql).get();
  return row?.c ?? 0;
}
