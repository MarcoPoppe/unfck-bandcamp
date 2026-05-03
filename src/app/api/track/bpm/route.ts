import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { lookupTrack } from '@/lib/track/lookup';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PostBody {
  trackId?: number;
  bcTrackId?: number;
  bcUrl?: string;
  bpm?: number;
}

async function resolveLocalTrackId(body: PostBody): Promise<number | null> {
  if (body.trackId && Number.isInteger(body.trackId) && body.trackId > 0) {
    return body.trackId;
  }
  const bcTrackId = body.bcTrackId;
  if (!bcTrackId || !Number.isInteger(bcTrackId) || bcTrackId <= 0) return null;
  const db = getDb();
  const existing = db
    .prepare<[number], { id: number }>(
      `SELECT id FROM tracks WHERE bc_track_id = ? AND removed_at IS NULL`,
    )
    .get(bcTrackId);
  if (existing) return existing.id;
  if (!body.bcUrl) return null;
  try {
    const result = await lookupTrack(body.bcUrl);
    return result.trackId;
  } catch {
    return null;
  }
}

/**
 * Persist a BPM reading detected client-side via realtime-bpm-analyzer.
 * Same caller-side ergonomics as /api/plays — caller can pass the local
 * trackId directly, or bcTrackId+bcUrl for discovered tracks where the
 * track might not be in the local `tracks` table yet.
 *
 * BPM stays as REAL on disk (`tracks.bpm`) so we keep detector precision
 * and round in the UI. The endpoint refuses obviously-bogus values.
 */
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
  const bpm = body.bpm;
  // Reject anything outside the plausible musical range so a noisy detector
  // doesn't poison the DB. 60-200 covers everything from slow blues to
  // hardcore.
  if (
    typeof bpm !== 'number' ||
    !Number.isFinite(bpm) ||
    bpm < 60 ||
    bpm > 220
  ) {
    return NextResponse.json(
      { ok: false, error: 'bpm must be a number between 60 and 220' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const trackId = await resolveLocalTrackId(body);
  if (!trackId) {
    return NextResponse.json(
      { ok: false, error: 'trackId or bcTrackId+bcUrl required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  getDb()
    .prepare(`UPDATE tracks SET bpm = ? WHERE id = ?`)
    .run(bpm, trackId);
  return NextResponse.json({ ok: true, trackId, bpm }, { headers: NO_STORE_HEADERS });
}
