import { NextResponse } from 'next/server';
import { lookupTrack } from '@/lib/track/lookup';
import { assertLocalRequest } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Redirect-style lookup: takes a Bandcamp track or album URL via the `url`
 * query param, resolves it to a local track via lookupTrack, and 302s to
 * the track permalink. Exists so middle-click and Cmd+click on best-of /
 * curator / wishlist titles can open the resolved permalink in a new tab —
 * something we can't do with a button onClick handler. For album URLs the
 * lookup returns the first track of the release; the user lands on a page
 * that shows all siblings.
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
    const dest = `/track/${result.bcTrackId ?? result.trackId}`;
    return NextResponse.redirect(new URL(dest, url.origin), 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'lookup failed';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
