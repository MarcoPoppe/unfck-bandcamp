import { NextResponse } from 'next/server';
import { listRecentPlays, recordPlay } from '@/lib/library/plays';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PostBody {
  trackId?: number;
  completedPct?: number;
  source?: string;
}

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid json' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (!body.trackId || !Number.isInteger(body.trackId) || body.trackId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'trackId required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const id = recordPlay(
    body.trackId,
    body.completedPct ?? null,
    body.source ?? null,
  );
  return NextResponse.json({ ok: true, id }, { headers: NO_STORE_HEADERS });
}

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? '100');
  return NextResponse.json(
    { ok: true, plays: listRecentPlays(Number.isFinite(limit) ? limit : 100) },
    { headers: NO_STORE_HEADERS },
  );
}
