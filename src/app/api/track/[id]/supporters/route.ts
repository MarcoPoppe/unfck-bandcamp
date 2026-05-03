import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getStoredAuth } from '@/lib/auth/store';
import { fetchCollectorsPage } from '@/lib/bandcamp/fetch_collectors';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

interface TrackRow {
  bc_track_id: number;
  bc_album_id: number | null;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const { id } = await ctx.params;
  const trackDbId = Number(id);
  if (!Number.isInteger(trackDbId) || trackDbId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'invalid track id' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const auth = getStoredAuth();
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: 'not authenticated — open /setup' },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  const row = getDb()
    .prepare<[number], TrackRow>(
      `SELECT bc_track_id, bc_album_id FROM tracks WHERE id = ?`,
    )
    .get(trackDbId);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: 'track not found locally' },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const countParam = url.searchParams.get('count');
  const count = countParam ? Math.max(1, Math.min(160, Number(countParam))) : 80;

  // Bandcamp scopes supporters per album for album tracks. We use the album
  // id when available so single tracks within an album show the album's
  // collectors. Standalone single-track releases use the track id directly.
  const tralbumType: 'a' | 't' = row.bc_album_id ? 'a' : 't';
  const tralbumId = row.bc_album_id ?? row.bc_track_id;

  try {
    const page = await fetchCollectorsPage({
      tralbumType,
      tralbumId,
      cookieString: auth.cookieString,
      count,
      token: token ?? null,
    });
    return NextResponse.json(
      { ok: true, ...page, tralbumType, tralbumId },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'supporters fetch failed';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
