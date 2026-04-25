import { NextResponse } from 'next/server';
import { getTrackCount, listTracks } from '@/lib/sync/tracks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? '200');
  const tracks = listTracks({ limit: Number.isFinite(limit) ? limit : 200 });
  return NextResponse.json({ ok: true, total: getTrackCount(), tracks });
}
