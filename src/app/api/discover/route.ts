import { NextResponse } from 'next/server';
import { getDiscoveredTrackCount, listDiscoveredTracks } from '@/lib/sync/discovery';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? '200');
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), 5000)
      : 200;
  const tracks = listDiscoveredTracks({ limit });
  return NextResponse.json(
    { ok: true, total: getDiscoveredTrackCount(), tracks },
    { headers: NO_STORE_HEADERS },
  );
}
