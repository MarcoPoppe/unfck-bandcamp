import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getStoredAuth } from '@/lib/auth/store';
import { fetchReleasePage } from '@/lib/bandcamp/fetch_release';
import { assertLocalRequest } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Single-tenant-self-host invariant: audio playback is only intended for the
// owner of the bandcamp account, on the same machine. The stream endpoint
// effectively rebroadcasts purchased streams via signed bandcamp URLs, which
// must NOT be relayable off-box.
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

const STREAM_URL_TTL_MS = 30 * 60 * 1000; // 30 minutes — bandcamp signs for ~hours

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
 * Range-aware streaming proxy. Resolves the bandcamp signed mp3-128 URL
 * for the given track id, refreshing it lazily when the cached URL is
 * older than `STREAM_URL_TTL_MS`. The actual byte stream is fetched from
 * bandcamp's CDN and forwarded with the upstream Content-Length and
 * Content-Range so HTML5 audio scrubbing works.
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

  // Forward Range header so seek works, but only after sanitizing it: bandcamp
  // doesn't support multi-range, and a malformed Range header would otherwise
  // cause unpredictable upstream behaviour.
  const range = sanitizeRange(req.headers.get('range'));
  const upstream = await fetch(streamUrl, {
    headers: range ? { Range: range } : {},
  });
  if (!upstream.ok && upstream.status !== 206) {
    // If signed url expired between fetch and now, refresh once.
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
  // Stream URLs are short-lived signed URLs; never cache them on intermediaries.
  out.set('Cache-Control', 'no-store');
  return out;
}
