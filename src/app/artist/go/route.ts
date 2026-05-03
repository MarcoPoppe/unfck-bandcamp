import { NextResponse } from 'next/server';
import { lookupTrack } from '@/lib/track/lookup';
import { getDb } from '@/lib/db';
import { assertLocalRequest } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Redirect-style artist resolver. Takes a Bandcamp track or album URL via
 * the `url` query param, runs lookupTrack to import the release (which also
 * upserts the artist row with its bc_band_id), and 302s to /artist/[id].
 *
 * Used by lists where we render an artist link without knowing the band id
 * up-front — the user can middle-click to open the artist page in a new tab.
 */
export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const url = new URL(req.url);
  const target = url.searchParams.get('url');
  if (!target) {
    return NextResponse.json(
      { ok: false, error: 'url query param required' },
      { status: 400 },
    );
  }
  try {
    const result = await lookupTrack(target);
    // After lookupTrack, the artist row exists. Pull bc_band_id off it.
    const row = getDb()
      .prepare<[number], { bc_band_id: number | null }>(
        `SELECT a.bc_band_id
           FROM tracks t
           LEFT JOIN artists a ON a.id = t.artist_id
           WHERE t.id = ?`,
      )
      .get(result.trackId);
    const bcBandId = row?.bc_band_id ?? null;
    if (!bcBandId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Could not resolve artist: no Bandcamp band id available for this release.',
        },
        { status: 404 },
      );
    }
    return NextResponse.redirect(new URL(`/artist/${bcBandId}`, url.origin), 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'lookup failed';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
