import { NextResponse } from 'next/server';
import { getCrawlTargetUsername, getStoredAuth } from '@/lib/auth/store';
import { fetchDiggerProfile } from '@/lib/bandcamp/fetch_digger';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Avatar URL of the configured crawl target's Bandcamp profile. Used by
 * the top-nav account pill to render a real picture instead of the
 * initial-letter fallback. Cheap call: one HTML GET to bandcamp.com,
 * the page blob already carries the avatar URL alongside the fan_id we
 * use elsewhere.
 *
 * The endpoint never persists the URL to disk — a 6h client-side
 * localStorage cache is enough to keep the network cost low without
 * letting a BC profile change go unnoticed for too long.
 */
export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const auth = getStoredAuth();
  const username = getCrawlTargetUsername();
  if (!auth || !username) {
    return NextResponse.json(
      { ok: true, url: null, username: null },
      { headers: NO_STORE_HEADERS },
    );
  }

  try {
    const profile = await fetchDiggerProfile(username, auth.cookieString);
    return NextResponse.json(
      { ok: true, url: profile.imageUrl, username: profile.username },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    // Best-effort: a missing avatar is not worth surfacing as an error;
    // the UI falls back to the initial.
    return NextResponse.json(
      { ok: true, url: null, username },
      { headers: NO_STORE_HEADERS },
    );
  }
}
