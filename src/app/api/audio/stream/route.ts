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

interface TrackRow {
  bc_track_id: number;
  bc_url: string;
  stream_url: string | null;
  stream_url_fetched_at: string | null;
}

const STREAM_URL_TTL_MS = 30 * 60 * 1000;

async function refreshStreamUrl(trackId: number): Promise<string | null> {
  const auth = getStoredAuth();
  if (!auth) return null;
  const row = getDb()
    .prepare<[number], TrackRow>(
      'SELECT bc_track_id, bc_url, stream_url, stream_url_fetched_at FROM tracks WHERE id = ?',
    )
    .get(trackId);
  if (!row) return null;

  try {
    const release = await fetchReleasePage(row.bc_url, auth.cookieString);
    const match = release.tracks.find((t) => t.bcTrackId === row.bc_track_id);
    const stream = match?.streamUrl ?? null;
    if (stream) {
      getDb()
        .prepare(
          'UPDATE tracks SET stream_url = ?, stream_url_fetched_at = ? WHERE id = ?',
        )
        .run(stream, new Date().toISOString(), trackId);
    }
    return stream;
  } catch {
    return null;
  }
}

/**
 * Audio streaming endpoint. Cache-first: if `data/audio_cache/track_<id>.mp3`
 * exists, serve it directly with Range support. Otherwise proxy the bandcamp
 * signed URL and fire a background cache write so the next play is local.
 */
export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const url = new URL(req.url);
  const idParam = url.searchParams.get('id');
  if (!idParam) {
    return NextResponse.json({ ok: false, error: 'id query param required' }, { status: 400 });
  }
  const trackId = Number(idParam);
  if (!Number.isInteger(trackId) || trackId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid track id' }, { status: 400 });
  }

  const range = sanitizeRange(req.headers.get('range'));

  if (isCached(trackId)) {
    const served = serveCachedFile(trackId, range);
    if (served) {
      return new NextResponse(Readable.toWeb(served.stream as Readable) as never, {
        status: served.status,
        headers: served.headers,
      });
    }
  }

  const row = getDb()
    .prepare<[number], TrackRow>(
      'SELECT bc_track_id, bc_url, stream_url, stream_url_fetched_at FROM tracks WHERE id = ?',
    )
    .get(trackId);
  if (!row) {
    return NextResponse.json({ ok: false, error: 'track not found' }, { status: 404 });
  }

  let streamUrl = row.stream_url;
  const cachedAge = row.stream_url_fetched_at
    ? Date.now() - new Date(row.stream_url_fetched_at).getTime()
    : Number.POSITIVE_INFINITY;

  if (!streamUrl || cachedAge > STREAM_URL_TTL_MS) {
    streamUrl = await refreshStreamUrl(trackId);
  }
  if (!streamUrl) {
    return NextResponse.json(
      { ok: false, error: 'no stream url available for this track' },
      { status: 502 },
    );
  }

  // Background cache, fire-and-forget. Failure here is non-fatal because the
  // proxy still serves the current request.
  cacheStream(trackId, streamUrl).catch(() => {
    // logged-and-ignore by design
  });

  const upstream = await fetch(streamUrl, {
    headers: range ? { Range: range } : {},
  });
  if (!upstream.ok && upstream.status !== 206) {
    const refreshed = await refreshStreamUrl(trackId);
    if (refreshed && refreshed !== streamUrl) {
      const retry = await fetch(refreshed, {
        headers: range ? { Range: range } : {},
      });
      if (retry.ok || retry.status === 206) {
        return new NextResponse(retry.body, {
          status: retry.status,
          headers: passthroughHeaders(retry.headers),
        });
      }
    }
    return NextResponse.json(
      { ok: false, error: `upstream returned ${upstream.status}` },
      { status: 502 },
    );
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: passthroughHeaders(upstream.headers),
  });
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
