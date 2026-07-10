import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { getDb } from '@/lib/db';
import { getStoredAuth } from '@/lib/auth/store';
import { fetchReleasePage } from '@/lib/bandcamp/fetch_release';
import { assertLocalRequest } from '@/lib/http/local_only';
import {
  cacheStream,
  isCached,
  serveCachedFile,
  getInflight,
  beginProgressiveStream,
} from '@/lib/audio/cache';

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

  // Single-flight: if this file is already downloading (e.g. the audio
  // element opened the progressive stream and the peak-backfill fetch
  // arrived just after), don't open a second Bandcamp connection — wait for
  // the in-flight download and serve from disk. Two connections to BC for
  // the same file is what got us rate-limited historically (91s stalls).
  const pending = getInflight(cacheKey);
  if (pending) {
    try {
      await pending;
    } catch {
      // in-flight download failed; fall through to a fresh attempt below
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
  }

  // A byte-range request on an uncached file means the client wants to seek
  // into a file we don't have yet. We can't range-serve a stream that isn't
  // on disk, so fall back to the classic full-download-then-serve path.
  // This is rare: the first play requests the whole file; seeks happen once
  // it's cached (and take the isCached branch far above).
  if (range) {
    try {
      await cacheStream(cacheKey, streamUrl);
    } catch {
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

  // No range: stream progressively. First byte reaches the client as soon
  // as Bandcamp answers, while the same bytes are teed onto disk. Under CDN
  // throttling the throttled bandwidth still exceeds real-time playback
  // bitrate, so the track starts in ~1-2s and plays through instead of
  // waiting 20-50s for the whole file. On a stale/expired stream URL the
  // fetch fails; refresh once and retry before surfacing a genuine 502.
  try {
    return progressiveResponse(await beginProgressiveStream(cacheKey, streamUrl));
  } catch {
    if (auth) {
      const refreshed = await refreshStream(source, id, row, auth.cookieString);
      if (refreshed && refreshed !== streamUrl) {
        try {
          return progressiveResponse(await beginProgressiveStream(cacheKey, refreshed));
        } catch {
          // fall through to 502
        }
      }
    }
    return NextResponse.json(
      { ok: false, error: 'upstream stream not available' },
      { status: 502 },
    );
  }
}

function progressiveResponse(prog: {
  webStream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: string | null;
}): NextResponse {
  const headers: Record<string, string> = {
    'content-type': prog.contentType,
    // No accept-ranges: the file isn't on disk yet, so we can't honour a
    // seek. Once cached, the range branch above serves seeks with 206.
    'cache-control': 'no-store',
  };
  if (prog.contentLength) headers['content-length'] = prog.contentLength;
  return new NextResponse(prog.webStream as never, { status: 200, headers });
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
