import { getDb } from '../db';
import { getStoredAuth } from '../auth/store';
import { fetchReleasePage } from '../bandcamp/fetch_release';
import { bcGet } from '../bandcamp/http';
import { upsertArtist } from '../entities/store';
import type { BcReleaseInfo } from '../bandcamp/parse_release';

export interface LookupResult {
  trackId: number;
  bcTrackId: number;
  title: string;
  artistName: string | null;
  albumTitle: string | null;
  bcUrl: string;
  coverUrl: string | null;
  releaseTralbumType: 'a' | 't';
  releaseBcId: number;
  releaseBcUrl: string;
  isOwned: boolean;
  siblingsInRelease: number;
}

interface ExistingTrackRow {
  id: number;
  bc_track_id: number;
  title: string;
  artist_name: string | null;
  album_title: string | null;
  bc_url: string;
  cover_url: string | null;
  bc_album_id: number | null;
  source_collection_item_id: number | null;
}

function findExistingByBcTrackId(bcTrackId: number): ExistingTrackRow | null {
  return (
    getDb()
      .prepare<[number], ExistingTrackRow>(
        `SELECT id, bc_track_id, title, artist_name, album_title, bc_url,
                cover_url, bc_album_id, source_collection_item_id
           FROM tracks WHERE bc_track_id = ?`,
      )
      .get(bcTrackId) ?? null
  );
}

function findExistingByBcUrl(bcUrl: string): ExistingTrackRow | null {
  // Normalisation is JS-side because SQLite's string functions can't strip
  // query/fragment cleanly. At current scale (a few thousand tracks max), a
  // sequential scan is fine; if this ever shows up in profiles we'll add a
  // bc_url_normalized column with an index.
  const target = normalizeUrl(bcUrl);
  const rows = getDb()
    .prepare<[], ExistingTrackRow>(
      `SELECT id, bc_track_id, title, artist_name, album_title, bc_url,
              cover_url, bc_album_id, source_collection_item_id
         FROM tracks
         WHERE removed_at IS NULL`,
    )
    .all();
  for (const r of rows) {
    if (normalizeUrl(r.bc_url) === target) return r;
  }
  return null;
}

function buildResultFromRow(
  stored: ExistingTrackRow,
  releaseTralbumType: 'a' | 't',
  siblingsInRelease: number,
): LookupResult {
  return {
    trackId: stored.id,
    bcTrackId: stored.bc_track_id,
    title: stored.title,
    artistName: stored.artist_name,
    albumTitle: stored.album_title,
    bcUrl: stored.bc_url,
    coverUrl: stored.cover_url,
    releaseTralbumType,
    releaseBcId: stored.bc_album_id ?? stored.bc_track_id,
    releaseBcUrl: stored.bc_url,
    isOwned: stored.source_collection_item_id != null,
    siblingsInRelease,
  };
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

function isNumericId(input: string): boolean {
  return /^\d{1,19}$/.test(input.trim());
}

/**
 * Resolve a numeric Bandcamp track id to its canonical track URL via the
 * mobile tralbum_details endpoint. Returns null if the id can't be resolved.
 */
async function resolveTrackIdToUrl(
  bcTrackId: number,
  cookieString: string,
): Promise<string | null> {
  const url = `https://bandcamp.com/api/mobile/24/tralbum_details?tralbum_type=t&tralbum_id=${bcTrackId}`;
  try {
    const res = await bcGet(url, { cookieString });
    if (res.status !== 200) return null;
    const json = (await res.json()) as { bandcamp_url?: string; tralbum_url?: string };
    return json.bandcamp_url ?? json.tralbum_url ?? null;
  } catch {
    return null;
  }
}

interface PersistOpts {
  release: BcReleaseInfo;
  cookieString: string;
}

function persistLookupRelease({ release }: PersistOpts): number[] {
  const db = getDb();
  let artistId: number | null = null;
  if (release.artistName && release.artistUrl) {
    artistId = upsertArtist({
      bcUrl: release.artistUrl,
      name: release.artistName,
      bcBandId: release.artistBandId,
    });
  }

  const insert = db.prepare(
    `INSERT INTO tracks (
       bc_track_id, bc_album_id, title, artist_name, artist_url, artist_id,
       album_title, album_url, duration_seconds, track_number,
       cover_url, bc_url, stream_url, stream_url_fetched_at, released_at,
       source_collection_item_id, purchased_at, last_seen_run_id, removed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
     ON CONFLICT (bc_track_id) DO UPDATE SET
       title = excluded.title,
       artist_name = excluded.artist_name,
       artist_url = excluded.artist_url,
       artist_id = COALESCE(excluded.artist_id, tracks.artist_id),
       -- Backfill bc_album_id and album_url: an earlier import path (owned
       -- sync of a single-track release, or a /track/lookup before the EP
       -- was known to be an album) may have stored these as NULL. When we
       -- now re-import via /api/album/by-url with releaseType='a', take
       -- the new value over the stored NULL so the album-played joins can
       -- find these tracks.
       bc_album_id = COALESCE(excluded.bc_album_id, tracks.bc_album_id),
       album_title = COALESCE(excluded.album_title, tracks.album_title),
       album_url = COALESCE(excluded.album_url, tracks.album_url),
       duration_seconds = COALESCE(excluded.duration_seconds, tracks.duration_seconds),
       track_number = COALESCE(excluded.track_number, tracks.track_number),
       cover_url = COALESCE(excluded.cover_url, tracks.cover_url),
       bc_url = excluded.bc_url,
       stream_url = COALESCE(excluded.stream_url, tracks.stream_url),
       stream_url_fetched_at = COALESCE(excluded.stream_url_fetched_at, tracks.stream_url_fetched_at),
       released_at = COALESCE(excluded.released_at, tracks.released_at),
       removed_at = NULL
     RETURNING id`,
  );

  const now = new Date().toISOString();
  const ids: number[] = [];
  const tx = db.transaction(() => {
    for (const t of release.tracks) {
      const albumId = release.releaseType === 'a' ? release.bcReleaseId : null;
      const result = insert.get(
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
        release.coverUrl ?? null,
        t.bcUrl,
        t.streamUrl,
        t.streamUrl ? now : null,
        release.releaseDate ?? null,
      ) as { id: number } | undefined;
      if (result) ids.push(result.id);
    }
  });
  tx();
  return ids;
}

/**
 * Resolve a Bandcamp track URL or numeric track id to a canonical local
 * track row. Persists the release if we don't have it yet.
 */
export async function lookupTrack(rawInput: string): Promise<LookupResult> {
  const input = rawInput.trim();
  if (!input) throw new Error('input is empty');

  const auth = getStoredAuth();
  if (!auth) throw new Error('no auth stored — run /setup first');

  let bcUrl: string;
  let preferredBcTrackId: number | null = null;

  if (isHttpUrl(input)) {
    bcUrl = input;
    // Local cache fast path: a previous lookup for this URL already wrote
    // the track row, so we don't need to re-hit Bandcamp.
    const cached = findExistingByBcUrl(bcUrl);
    if (cached) {
      // Count siblings if it was an album page
      let siblings = 1;
      if (cached.bc_album_id) {
        const sib = getDb()
          .prepare<[number], { c: number }>(
            `SELECT COUNT(*) AS c FROM tracks WHERE bc_album_id = ? AND removed_at IS NULL`,
          )
          .get(cached.bc_album_id);
        siblings = sib?.c ?? 1;
      }
      return buildResultFromRow(cached, cached.bc_album_id ? 'a' : 't', siblings);
    }
  } else if (isNumericId(input)) {
    preferredBcTrackId = Number(input);
    const existing = findExistingByBcTrackId(preferredBcTrackId);
    if (existing) {
      const sibCountRow = existing.bc_album_id
        ? (getDb()
            .prepare<[number], { c: number }>(
              `SELECT COUNT(*) AS c FROM tracks WHERE bc_album_id = ?`,
            )
            .get(existing.bc_album_id) as { c: number } | undefined)
        : undefined;
      return {
        trackId: existing.id,
        bcTrackId: existing.bc_track_id,
        title: existing.title,
        artistName: existing.artist_name,
        albumTitle: existing.album_title,
        bcUrl: existing.bc_url,
        coverUrl: existing.cover_url,
        releaseTralbumType: existing.bc_album_id ? 'a' : 't',
        releaseBcId: existing.bc_album_id ?? existing.bc_track_id,
        releaseBcUrl: existing.bc_url,
        isOwned: existing.source_collection_item_id != null,
        siblingsInRelease: sibCountRow?.c ?? 1,
      };
    }
    const resolved = await resolveTrackIdToUrl(preferredBcTrackId, auth.cookieString);
    if (!resolved) {
      throw new Error(
        `track id ${preferredBcTrackId} could not be resolved to a Bandcamp URL`,
      );
    }
    bcUrl = resolved;
  } else {
    throw new Error('input must be a Bandcamp URL or a numeric track id');
  }

  const release = await fetchReleasePage(bcUrl, auth.cookieString);
  if (release.tracks.length === 0) {
    throw new Error('release page contained no tracks');
  }

  persistLookupRelease({ release, cookieString: auth.cookieString });

  const target =
    (preferredBcTrackId &&
      release.tracks.find((t) => t.bcTrackId === preferredBcTrackId)) ||
    release.tracks.find((t) => normalizeUrl(t.bcUrl) === normalizeUrl(bcUrl)) ||
    release.tracks[0];

  const stored = findExistingByBcTrackId(target.bcTrackId);
  if (!stored) {
    throw new Error('lookup persisted but track row missing');
  }

  return {
    trackId: stored.id,
    bcTrackId: stored.bc_track_id,
    title: stored.title,
    artistName: stored.artist_name,
    albumTitle: stored.album_title,
    bcUrl: stored.bc_url,
    coverUrl: stored.cover_url,
    releaseTralbumType: release.releaseType,
    releaseBcId: release.bcReleaseId,
    releaseBcUrl: release.albumUrl ?? bcUrl,
    isOwned: stored.source_collection_item_id != null,
    siblingsInRelease: release.tracks.length,
  };
}

function normalizeUrl(u: string): string {
  return u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
}

export interface TrackPermalinkData {
  track: {
    id: number;
    bcTrackId: number;
    title: string;
    artistName: string | null;
    artistUrl: string | null;
    artistLocalId: number | null;
    artistBcBandId: number | null;
    albumTitle: string | null;
    albumUrl: string | null;
    bcUrl: string;
    coverUrl: string | null;
    durationSeconds: number | null;
    streamAvailable: boolean;
    isOwned: boolean;
    labelId: number | null;
    labelName: string | null;
    releasedAt: string | null;
    hasBeenPlayed?: boolean;
  };
  releaseTralbumType: 'a' | 't';
  releaseBcId: number;
  siblings: Array<{
    id: number;
    bcTrackId: number;
    title: string;
    trackNumber: number | null;
    durationSeconds: number | null;
    bcUrl: string;
    coverUrl: string | null;
    artistName: string | null;
    albumTitle: string | null;
    hasStream: boolean;
    hasBeenPlayed?: boolean;
  }>;
}

export function getTrackPermalink(trackDbId: number): TrackPermalinkData | null {
  interface Row {
    id: number;
    bc_track_id: number;
    title: string;
    artist_name: string | null;
    artist_url: string | null;
    album_title: string | null;
    album_url: string | null;
    bc_album_id: number | null;
    bc_url: string;
    cover_url: string | null;
    duration_seconds: number | null;
    stream_url: string | null;
    source_collection_item_id: number | null;
    track_number: number | null;
  }
  const row = getDb()
    .prepare<
      [number],
      Row & {
        artist_id: number | null;
        artist_bc_band_id: number | null;
        label_id: number | null;
        label_name: string | null;
        released_at: string | null;
      }
    >(
      `SELECT t.id, t.bc_track_id, t.title, t.artist_name, t.artist_url, t.album_title,
              t.album_url, t.bc_album_id, t.bc_url, t.cover_url, t.duration_seconds,
              t.stream_url, t.source_collection_item_id, t.track_number, t.artist_id,
              a.bc_band_id AS artist_bc_band_id,
              t.label_id, l.name AS label_name, t.released_at
         FROM tracks t
         LEFT JOIN artists a ON a.id = t.artist_id
         LEFT JOIN labels l ON l.id = t.label_id
         WHERE t.id = ?`,
    )
    .get(trackDbId);
  if (!row) return null;

  let siblings: TrackPermalinkData['siblings'] = [];
  if (row.bc_album_id) {
    const sibs = getDb()
      .prepare<
        [number],
        Row
      >(
        `SELECT id, bc_track_id, title, artist_name, artist_url, album_title,
                bc_album_id, bc_url, cover_url, duration_seconds, stream_url,
                source_collection_item_id, track_number
           FROM tracks WHERE bc_album_id = ? AND removed_at IS NULL
           ORDER BY track_number IS NULL, track_number ASC`,
      )
      .all(row.bc_album_id);
    siblings = sibs.map((s) => ({
      id: s.id,
      bcTrackId: s.bc_track_id,
      title: s.title,
      trackNumber: s.track_number,
      durationSeconds: s.duration_seconds,
      bcUrl: s.bc_url,
      coverUrl: s.cover_url,
      artistName: s.artist_name,
      albumTitle: s.album_title,
      hasStream: !!s.stream_url,
    }));
  }

  return {
    track: {
      id: row.id,
      bcTrackId: row.bc_track_id,
      title: row.title,
      artistName: row.artist_name,
      artistUrl: row.artist_url,
      artistLocalId: row.artist_id,
      artistBcBandId: row.artist_bc_band_id,
      albumTitle: row.album_title,
      albumUrl: row.album_url,
      bcUrl: row.bc_url,
      coverUrl: row.cover_url,
      durationSeconds: row.duration_seconds,
      streamAvailable: !!row.stream_url,
      isOwned: row.source_collection_item_id != null,
      labelId: row.label_id,
      labelName: row.label_name,
      releasedAt: row.released_at,
    },
    releaseTralbumType: row.bc_album_id ? 'a' : 't',
    releaseBcId: row.bc_album_id ?? row.bc_track_id,
    siblings,
  };
}
