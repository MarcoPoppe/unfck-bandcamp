import { NextResponse } from 'next/server';
import { syncDiggers, type DiggerSource } from '@/lib/sync/diggers';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

interface Body {
  maxItems?: number;
  topN?: number;
  source?: DiggerSource;
  playlistId?: number;
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

  const source: DiggerSource =
    body.source === 'wishlist' || body.source === 'playlist' ? body.source : 'owned';
  if (source === 'playlist' && (!body.playlistId || body.playlistId <= 0)) {
    return NextResponse.json(
      { ok: false, error: 'playlistId required when source=playlist' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const result = await syncDiggers({
      maxItems: body.maxItems,
      topN: body.topN,
      source,
      playlistId: body.playlistId,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'curators sync failed';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
