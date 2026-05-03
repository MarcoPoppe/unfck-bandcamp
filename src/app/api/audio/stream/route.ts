import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { getDb } from '@/lib/db';
import { getStoredAuth } from '@/lib/auth/store';
import { fetchReleasePage } from '@/lib/bandcamp/fetch_release';
import { assertLocalRequest } from '@/lib/http/local_only';
import { cacheStream, isCached, serveCachedFile } from '@/lib/audio/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RANGE_RE = /^bytes=\d{1,19}-(?:\d{1,19})?$/;
function sanitizeRange(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return RANGE_RE.test(trimmed) ? trimmed : null;
}

interface StreamSourceRow {
  bcTrackId: number;
  bcUrl: string;
  streamUrl: string | null;
  streamUrlFetchedAt: string | null;
}

const STREAM_URL_TTL_MS = 30 * 60 * 1000;

function loadOwned(id: number): StreamSourceRow | null {
  const row = getDb()
    .prepare<[number], {
      bc_track_id: number;
      bc_url: string;
      stream_url: string | null;
      stream_url_fetched_at: string | null;
    }>(
      `SELECT bc_track_id, bc_url, stream_url, stream_url_fetched_at
         FROM tracks WHERE id = ?`,
    )
    .get(id);
  if (!row) return null;
  return {
    bcTrackId: row.bc_track_id,
    bcUrl: row.bc_url,
    streamUrl: row.stream_url,
    streamUrlFetchedAt: row.stream_url_fetched_at,
  };
}

function loadDiscovered(id: number): StreamSourceRow | null {
  const row = getDb()
    .prepare<[number], {
      bc_track_id: number;
      bc_url: string;
      stream_url: string | null;
      stream_url_fetched_at: string | null;
    }>(
      `SELECT bc_track_id, bc_url, stream_url, stream_url_fetched_at
         FROM discovered_tracks WHERE id = ?`,
    )
    .get(id);
  if (!row) return null;
  return {
    bcTrackId: row.bc_track_id,
    bcUrl: row.bc_url,
    streamUrl: row.stream_url,
    streamUrlFetchedAt: row.stream_url_fetched_at,
  };
}

async function refreshStream(
  source: 'owned' | 'discovered',
  id: number,
  current: StreamSourceRow,
  cookieString: string,
): Promise<string | null> {
  try {
    const release = await fetchReleasePage(current.bcUrl, cookieString);
    const match = release.tracks.find((t) => t.bcTrackId === current.bcTrackId);
    const stream = match?.streamUrl ?? null;
    if (stream) {
      const table = source === 'owned' ? 'tracks' : 'discovered_tracks';
      getDb()
        .prepare(
          `UPDATE ${table} SET stream_url = ?, stream_url_fetched_at = ? WHERE id = ?`,
        )
        .run(stream, new Date().toISOString(), id);
    }
    return stream;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const url = new URL(req.url);
  const idParam = url.searchParams.get('id');
  if (!idParam) {
    return NextResponse.json({ ok: false, error: 'id query param required' }, { status: 400 });
  }
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }
  const sourceParam = url.searchParams.get('source');
  const source: 'owned' | 'discovered' =
    sourceParam === 'discovered' ? 'discovered' : 'owned';
  const cacheKey = source === 'owned' ? `track_${id}` : `disc_${id}`;

  const range = sanitizeRange(req.headers.get('range'));

  if (isCached(cacheKey)) {
    const served = serveCachedFile(cacheKey, range);
    if (served) {
      return new NextResponse(Readable.toWeb(served.stream as Readable) as never, {
        status: served.status,
        headers: served.headers,
      });
    }
  }

  const row = source === 'owned' ? loadOwned(id) : loadDiscovered(id);
  if (!row) {
    return NextResponse.json({ ok: false, error: 'track not found' }, { status: 404 });
  }

  const auth = getStoredAuth();

  let streamUrl = row.streamUrl;
  const cachedAge = row.streamUrlFetchedAt
    ? Date.now() - new Date(row.streamUrlFetchedAt).getTime()
    : Number.POSITIVE_INFINITY;

  if ((!streamUrl || cachedAge > STREAM_URL_TTL_MS) && auth) {
    streamUrl = await refreshStream(source, id, row, auth.cookieString);
  }
  if (!streamUrl) {
    return NextResponse.json(
      { ok: false, error: 'no stream url available for this track' },
      { status: 502 },
    );
  }

  // Cache-miss path: wait for cacheStream to fetch the full MP3 from
  // Bandcamp once, then serve from disk. Previously we ran cacheStream in
  // the background AND streamed a parallel `fetch(streamUrl)` to the
  // client — two connections to BC for the same file, which got us
  // rate-limited (91s stalls in dev logs). One fetch costs a few seconds
  // of upfront wait but ends rate-limit issues and gives clean range
  // support immediately afterwards.
  try {
    await cacheStream(cacheKey, streamUrl);
  } catch {
    // First attempt failed (often: stream URL expired). Try refreshing
    // and retry the cache once.
    if (auth) {
      const refreshed = await refreshStream(source, id, row, auth.cookieString);
      if (refreshed && refreshed !== streamUrl) {
        try {
          await cacheStream(cacheKey, refreshed);
        } catch {
          // fall through to error response
        }
      }
    }
  }

  if (isCached(cacheKey)) {
    const served = serveCachedFile(cacheKey, range);
    if (served) {
      return new NextResponse(Readable.toWeb(served.stream as Readable) as never, {
        status: served.status,
        headers: served.headers,
      });
    }
  }

  return NextResponse.json(
    { ok: false, error: 'upstream stream not available' },
    { status: 502 },
  );
}

function passthroughHeaders(src: Headers): Headers {
  const out = new Headers();
  const fwd = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified'];
  for (const k of fwd) {
    const v = src.get(k);
    if (v) out.set(k, v);
  }
  out.set('Cache-Control', 'no-store');
  return out;
}
