import { NextResponse } from 'next/server';
import { getBestOfStatus, runBestOfSupporters } from '@/lib/sync/best_of_supporters';
import {
  getPlayedBcTrackIds,
  getAlbumPlayedStats,
  getAlbumPlayedStatsByUrl,
  normalizeAlbumUrl,
} from '@/lib/library/plays';
import { getDb } from '@/lib/db';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

/** Pull "https://artistname.bandcamp.com" off any track or album URL on
 * Bandcamp. Returns null for custom domains we don't recognize as bandcamp
 * (the artists table can still match them via bc_url). */
function extractArtistBase(bcUrl: string): string | null {
  try {
    const u = new URL(bcUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** For each artist-base url present in `items`, look up the matching local
 * artist row and return a Map(base → bc_band_id). */
function loadArtistBandIds(items: { bcUrl: string }[]): Map<string, number> {
  const bases = new Set<string>();
  for (const it of items) {
    const b = extractArtistBase(it.bcUrl);
    if (b) bases.add(b);
  }
  if (bases.size === 0) return new Map();
  const placeholders = Array.from(bases).map(() => '?').join(',');
  const rows = getDb()
    .prepare<string[], { bc_url: string; bc_band_id: number | null }>(
      `SELECT bc_url, bc_band_id FROM artists WHERE bc_url IN (${placeholders})`,
    )
    .all(...bases);
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.bc_band_id != null) map.set(r.bc_url, r.bc_band_id);
  }
  return map;
}

interface LabelInfo {
  labelId: number;
  labelName: string;
  labelBcUrl: string | null;
}

/** For each item, find a matching local track and pull the label info off it.
 * Returns a Map keyed by `${bcItemType}:${bcItemId}`. */
/** Released-at lookup for best-of items. Track-rows match by bc_track_id,
 * album-rows pick any of the album's tracks (all tracks share the
 * release date of their parent release). Items without a local row stay
 * absent from the map and render without a date. */
function loadReleasedAtForItems(
  items: { bcItemId: number; bcItemType: 'a' | 't' }[],
): Map<string, string> {
  const trackIds = items.filter((i) => i.bcItemType === 't').map((i) => i.bcItemId);
  const albumIds = items.filter((i) => i.bcItemType === 'a').map((i) => i.bcItemId);
  const map = new Map<string, string>();
  const db = getDb();
  if (trackIds.length > 0) {
    const ph = trackIds.map(() => '?').join(',');
    const rows = db
      .prepare<number[], { bc_track_id: number; released_at: string | null }>(
        `SELECT bc_track_id, released_at
           FROM tracks
           WHERE bc_track_id IN (${ph}) AND released_at IS NOT NULL
             AND removed_at IS NULL`,
      )
      .all(...trackIds);
    for (const r of rows) {
      if (r.released_at) map.set(`t:${r.bc_track_id}`, r.released_at);
    }
  }
  if (albumIds.length > 0) {
    const ph = albumIds.map(() => '?').join(',');
    const rows = db
      .prepare<number[], { bc_album_id: number; released_at: string | null }>(
        `SELECT bc_album_id, MAX(released_at) AS released_at
           FROM tracks
           WHERE bc_album_id IN (${ph}) AND released_at IS NOT NULL
             AND removed_at IS NULL
           GROUP BY bc_album_id`,
      )
      .all(...albumIds);
    for (const r of rows) {
      if (r.released_at) map.set(`a:${r.bc_album_id}`, r.released_at);
    }
  }
  return map;
}

function loadLabelsForItems(
  items: { bcItemId: number; bcItemType: 'a' | 't' }[],
): Map<string, LabelInfo> {
  const trackIds = items.filter((i) => i.bcItemType === 't').map((i) => i.bcItemId);
  const albumIds = items.filter((i) => i.bcItemType === 'a').map((i) => i.bcItemId);
  const map = new Map<string, LabelInfo>();
  const db = getDb();
  if (trackIds.length > 0) {
    const ph = trackIds.map(() => '?').join(',');
    const rows = db
      .prepare<number[], {
        bc_track_id: number;
        label_id: number | null;
        label_name: string | null;
        label_bc_url: string | null;
      }>(
        `SELECT t.bc_track_id, t.label_id,
                l.name AS label_name,
                l.bc_url AS label_bc_url
           FROM tracks t
           LEFT JOIN labels l ON l.id = t.label_id
           WHERE t.bc_track_id IN (${ph}) AND t.removed_at IS NULL`,
      )
      .all(...trackIds);
    for (const r of rows) {
      if (r.label_id != null && r.label_name) {
        map.set(`t:${r.bc_track_id}`, {
          labelId: r.label_id,
          labelName: r.label_name,
          labelBcUrl: r.label_bc_url,
        });
      }
    }
  }
  if (albumIds.length > 0) {
    const ph = albumIds.map(() => '?').join(',');
    // For album rows pick any track of that album; the label is the same.
    const rows = db
      .prepare<number[], {
        bc_album_id: number;
        label_id: number | null;
        label_name: string | null;
        label_bc_url: string | null;
      }>(
        `SELECT t.bc_album_id, t.label_id,
                l.name AS label_name,
                l.bc_url AS label_bc_url
           FROM tracks t
           LEFT JOIN labels l ON l.id = t.label_id
           WHERE t.bc_album_id IN (${ph}) AND t.removed_at IS NULL
           GROUP BY t.bc_album_id`,
      )
      .all(...albumIds);
    for (const r of rows) {
      if (r.label_id != null && r.label_name) {
        map.set(`a:${r.bc_album_id}`, {
          labelId: r.label_id,
          labelName: r.label_name,
          labelBcUrl: r.label_bc_url,
        });
      }
    }
  }
  return map;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

interface Body {
  maxSupporters?: number;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const { id } = await ctx.params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId) || trackId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'invalid track id' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const status = getBestOfStatus(trackId);
  if (status) {
    const played = getPlayedBcTrackIds();
    const albumStats = getAlbumPlayedStats();
    const albumStatsByUrl = getAlbumPlayedStatsByUrl();
    const artistBandIds = loadArtistBandIds(status.topItems);
    const labelByItem = loadLabelsForItems(status.topItems);
    const releasedByItem = loadReleasedAtForItems(status.topItems);
    status.topItems = status.topItems.map((it) => {
      const base = extractArtistBase(it.bcUrl);
      const artistBcBandId = base ? (artistBandIds.get(base) ?? null) : null;
      const label = labelByItem.get(`${it.bcItemType}:${it.bcItemId}`) ?? null;
      const labelFields = label
        ? {
            labelId: label.labelId,
            labelName: label.labelName,
            labelBcUrl: label.labelBcUrl,
          }
        : { labelId: null, labelName: null, labelBcUrl: null };
      const releasedAt =
        releasedByItem.get(`${it.bcItemType}:${it.bcItemId}`) ?? null;
      if (it.bcItemType === 't') {
        return {
          ...it,
          hasBeenPlayed: played.has(it.bcItemId),
          artistBcBandId,
          releasedAt,
          ...labelFields,
        };
      }
      // Album row: heard when every locally-known track of this album has
      // at least one play. We try matching by both bc_album_id and album
      // URL (BC sometimes uses a different id at the collection-item level
      // than the one we extract off the album page).
      const byId = albumStats.get(it.bcItemId);
      const byUrl = albumStatsByUrl.get(normalizeAlbumUrl(it.bcUrl));
      const pickedStats =
        byId && byId.total > 0
          ? byId
          : byUrl && byUrl.total > 0
            ? byUrl
            : null;
      const total = pickedStats?.total ?? 0;
      const playedCount = pickedStats?.played ?? 0;
      return {
        ...it,
        hasBeenPlayed: total > 0 && playedCount === total,
        albumPlayedCount: playedCount,
        albumTotalCount: total,
        artistBcBandId,
        releasedAt,
        ...labelFields,
      };
    });
  }
  return NextResponse.json({ ok: true, status }, { headers: NO_STORE_HEADERS });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const { id } = await ctx.params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId) || trackId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'invalid track id' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // empty
  }

  // Fire-and-forget: kick the crawl off and return immediately so the
  // browser can poll GET for progress instead of holding a 30+ minute HTTP
  // connection open.
  void runBestOfSupporters({ trackId, maxSupporters: body.maxSupporters }).catch(() => {
    // Errors are persisted on the run row; nothing to do here.
  });

  return NextResponse.json(
    { ok: true, started: true, status: getBestOfStatus(trackId) },
    { headers: NO_STORE_HEADERS },
  );
}
