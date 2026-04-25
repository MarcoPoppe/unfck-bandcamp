import { NextResponse } from 'next/server';
import { expandCollectionToTracks } from '@/lib/sync/tracks';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

interface SyncBody {
  limit?: number;
}

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: SyncBody = {};
  try {
    body = (await req.json()) as SyncBody;
  } catch {
    // empty body is fine
  }

  try {
    const result = await expandCollectionToTracks({ limit: body.limit });
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
