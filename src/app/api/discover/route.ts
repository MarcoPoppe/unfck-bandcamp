import { NextResponse } from 'next/server';
import { getDiscoveredTrackCount, listDiscoveredTracks } from '@/lib/sync/discovery';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? '200');
  const tracks = listDiscoveredTracks({ limit: Number.isFinite(limit) ? limit : 200 });
  return NextResponse.json({ ok: true, total: getDiscoveredTrackCount(), tracks });
}
