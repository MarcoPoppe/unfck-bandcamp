import { NextResponse } from 'next/server';
import { setArchived, setRating, type Rating } from '@/lib/library/curation';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  trackId?: number;
  action?: 'rate' | 'archive' | 'unarchive';
  rating?: number;
}

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // empty
  }

  if (!body.trackId || !Number.isInteger(body.trackId) || body.trackId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'trackId required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    if (body.action === 'rate') {
      const r = body.rating;
      if (r !== -1 && r !== 0 && r !== 1) {
        return NextResponse.json(
          { ok: false, error: 'rating must be -1, 0, or 1' },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      setRating(body.trackId, r as Rating);
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'archive') {
      setArchived(body.trackId, true);
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'unarchive') {
      setArchived(body.trackId, false);
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      { ok: false, error: 'unknown action' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'curation failed';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
