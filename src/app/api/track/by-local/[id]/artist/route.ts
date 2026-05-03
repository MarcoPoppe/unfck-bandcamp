import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const { id } = await ctx.params;
  const trackDbId = Number(id);
  if (!Number.isInteger(trackDbId) || trackDbId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'invalid track id' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const row = getDb()
    .prepare<[number], { bc_band_id: number | null }>(
      `SELECT a.bc_band_id
         FROM tracks t
         LEFT JOIN artists a ON a.id = t.artist_id
         WHERE t.id = ?`,
    )
    .get(trackDbId);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: 'track not found' },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { ok: true, bcBandId: row.bc_band_id },
    { headers: NO_STORE_HEADERS },
  );
}
