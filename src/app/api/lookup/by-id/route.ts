import { NextResponse } from 'next/server';
import { getStoredAuth } from '@/lib/auth/store';
import { bcGet } from '@/lib/bandcamp/http';
import { lookupTrack } from '@/lib/track/lookup';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  itemId?: number;
  itemType?: 'album' | 'track';
}

/**
 * Resolve a numeric Bandcamp item (album or track) into a permalink and
 * import it locally. Used by the artist-page release rows that only
 * have a bc item id from the band_details Mobile API — those rows
 * weren't on the HTML tile grid (BC's lazy-loaded discography), so we
 * call tralbum_details to get the canonical URL, then push it through
 * lookupTrack so the row appears in the local DB just like an
 * HTML-tile-known release.
 */
export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid json' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const itemId = body.itemId;
  const itemType = body.itemType;
  if (
    !itemId ||
    !Number.isInteger(itemId) ||
    itemId <= 0 ||
    (itemType !== 'album' && itemType !== 'track')
  ) {
    return NextResponse.json(
      { ok: false, error: 'itemId (positive int) and itemType (album|track) required' },
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

  // Step 1: ask BC for the canonical URL of this album / track id.
  const tralbumType = itemType === 'album' ? 'a' : 't';
  const apiUrl = `https://bandcamp.com/api/mobile/24/tralbum_details?tralbum_type=${tralbumType}&tralbum_id=${itemId}`;
  let bcUrl: string | null = null;
  try {
    const res = await bcGet(apiUrl, { cookieString: auth.cookieString });
    if (res.status === 200) {
      const json = (await res.json()) as { bandcamp_url?: string; tralbum_url?: string };
      bcUrl = json.bandcamp_url ?? json.tralbum_url ?? null;
    }
  } catch {
    // fall through
  }
  if (!bcUrl) {
    return NextResponse.json(
      { ok: false, error: `tralbum_details did not return a URL for ${itemType}/${itemId}` },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }

  // Step 2: feed the URL through the regular lookup pipeline so the
  // release lands in `tracks` with all its sibling tracks.
  try {
    const result = await lookupTrack(bcUrl);
    return NextResponse.json(
      {
        ok: true,
        bcUrl,
        bcTrackId: result.bcTrackId,
        trackId: result.trackId,
        releaseTralbumType: result.releaseTralbumType,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        bcUrl,
        error: err instanceof Error ? err.message : 'lookup failed',
      },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
