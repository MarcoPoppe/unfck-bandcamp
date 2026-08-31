import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getStoredAuth } from '@/lib/auth/store';
import { fetchCollectorsPage } from '@/lib/bandcamp/fetch_collectors';
import {
  buildSupporterVariants,
  parseSupporterCursor,
  nextSupporterCursor,
} from '@/lib/bandcamp/supporter_variants';
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

  // Collectors attach to the tralbum a buyer actually purchased, so the
  // release and the track permalink each carry their own list and either one
  // can be empty. Walk both (album first) behind one cursor instead of
  // picking a single variant — see supporter_variants.ts.
  const variants = buildSupporterVariants({
    bcTrackId: row.bc_track_id,
    bcAlbumId: row.bc_album_id,
  });
  if (variants.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'track has neither a bandcamp track id nor an album id' },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  const cursor = parseSupporterCursor(token, variants.length);
  if (!cursor) {
    // Cursor points past the last variant: hand back a final empty page so
    // the client's auto-pagination stops instead of looping.
    return NextResponse.json(
      { ok: true, collectors: [], moreAvailable: false, nextToken: null },
      { headers: NO_STORE_HEADERS },
    );
  }
  const variant = variants[cursor.variantIndex];

  try {
    const page = await fetchCollectorsPage({
      tralbumType: variant.tralbumType,
      tralbumId: variant.tralbumId,
      cookieString: auth.cookieString,
      count,
      token: cursor.bcToken,
    });
    const next = nextSupporterCursor({
      variantIndex: cursor.variantIndex,
      variantCount: variants.length,
      moreAvailable: page.moreAvailable,
      nextToken: page.nextToken,
    });
    return NextResponse.json(
      {
        ok: true,
        collectors: page.collectors,
        moreAvailable: next.moreAvailable,
        nextToken: next.nextToken,
        tralbumType: variant.tralbumType,
        tralbumId: variant.tralbumId,
      },
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
