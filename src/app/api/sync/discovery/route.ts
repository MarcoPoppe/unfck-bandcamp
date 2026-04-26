import { NextResponse } from 'next/server';
import { syncFollowedArtistsDiscovery } from '@/lib/sync/discovery';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  try {
    const result = await syncFollowedArtistsDiscovery();
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'sync failed' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
