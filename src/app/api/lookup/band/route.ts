import { NextResponse } from 'next/server';
import { getStoredAuth } from '@/lib/auth/store';
import { fetchArtistOverview } from '@/lib/bandcamp/fetch_artist';
import { upsertArtist } from '@/lib/entities/store';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Resolve a Bandcamp band root URL ( "https://artist.bandcamp.com" or a
 * custom domain that fronts a Bandcamp page) into a local artists.id and
 * its bc_band_id. Used by the everything-lookup affordance on /discover:
 * the user pastes any BC link, we route by type, and band-root inputs
 * land here so the discover hub can navigate to /artist/[bcBandId].
 *
 * The route fetches the artist's /music page once, parses the band_id
 * out of the embedded pagedata blob, and upserts the artists row so
 * subsequent navigations resolve from the local DB.
 */
export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: { bcUrl?: string };
  try {
    body = (await req.json()) as { bcUrl?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid json' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const bcUrl = body.bcUrl?.trim();
  if (!bcUrl) {
    return NextResponse.json(
      { ok: false, error: 'bcUrl required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const auth = getStoredAuth();
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: 'auth not configured — open Setup' },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  let overview;
  try {
    overview = await fetchArtistOverview(bcUrl, auth.cookieString);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'fetch failed',
      },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }

  if (!overview.bcBandId) {
    return NextResponse.json(
      { ok: false, error: 'no band_id found on the page' },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const localId = upsertArtist({
    bcUrl: overview.bcUrl,
    name: overview.name,
    bcBandId: overview.bcBandId,
    imageUrl: overview.imageUrl,
  });

  return NextResponse.json(
    {
      ok: true,
      localId,
      bcBandId: overview.bcBandId,
      name: overview.name,
      releaseCount: overview.releases.length,
    },
    { headers: NO_STORE_HEADERS },
  );
}
