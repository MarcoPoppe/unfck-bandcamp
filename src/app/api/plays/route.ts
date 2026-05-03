import { NextResponse } from 'next/server';
import { listRecentPlays, recordPlay, deletePlaysForTrack } from '@/lib/library/plays';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';
import { getDb } from '@/lib/db';
import { lookupTrack } from '@/lib/track/lookup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PostBody {
  trackId?: number;
  /** Optional: caller doesn't know the local tracks.id (e.g. when playing
   * a discovered track whose only stable id is the BC track id). The server
   * resolves bcTrackId -> tracks.id, importing the release on the fly if
   * the track isn't in the local DB yet. */
  bcTrackId?: number;
  /** Required when bcTrackId triggers a lookupTrack import. */
  bcUrl?: string;
  completedPct?: number;
  source?: string;
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
  // Track is in discovered_tracks but not yet in tracks. Import via the
  // standard lookup flow so the release is fully resolved (artist + label
  // wired up, album_url set, etc).
  try {
    const result = await lookupTrack(body.bcUrl);
    return result.trackId;
  } catch {
    return null;
  }
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
  const trackId = await resolveLocalTrackId(body);
  if (!trackId) {
    return NextResponse.json(
      { ok: false, error: 'trackId or bcTrackId+bcUrl required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  // Clamp completedPct so a stray NaN, Infinity, or out-of-range value can't
  // poison the history rendering layer (CSS width %, label percentages).
  const rawPct = body.completedPct;
  const completedPct =
    rawPct == null
      ? null
      : Number.isFinite(rawPct)
        ? Math.max(0, Math.min(1, rawPct))
        : null;
  const id = recordPlay(trackId, completedPct, body.source ?? null);
  return NextResponse.json({ ok: true, id, trackId }, { headers: NO_STORE_HEADERS });
}

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const url = new URL(req.url);
  // `?as=set` returns just the distinct bc_track_ids that have at least
  // one play. AppShell uses this to hydrate the live playedBcTrackIds
  // set on first mount so green checks stay visible across navigations,
  // not just during the session that produced them.
  if (url.searchParams.get('as') === 'set') {
    const rows = getDb()
      .prepare<[], { bc_track_id: number }>(
        `SELECT DISTINCT t.bc_track_id
           FROM track_plays p
           JOIN tracks t ON t.id = p.track_id`,
      )
      .all();
    return NextResponse.json(
      { ok: true, bcTrackIds: rows.map((r) => r.bc_track_id) },
      { headers: NO_STORE_HEADERS },
    );
  }
  const limitRaw = Number(url.searchParams.get('limit') ?? '100');
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), 1000)
      : 100;
  return NextResponse.json(
    { ok: true, plays: listRecentPlays(limit) },
    { headers: NO_STORE_HEADERS },
  );
}

/**
 * Mark a track as "unplayed" by removing all its track_plays rows. Same
 * idea as WhatsApp's "mark as unread": the user clears the played-state so
 * the track resurfaces in Hide-played-filtered lists and loses its green
 * checkmark. The bc_track_id is also returned so the client can purge it
 * from the live `playedBcTrackIds` store.
 */
export async function DELETE(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const url = new URL(req.url);
  const idRaw = Number(url.searchParams.get('trackId'));
  if (!Number.isInteger(idRaw) || idRaw <= 0) {
    return NextResponse.json(
      { ok: false, error: 'trackId required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const result = deletePlaysForTrack(idRaw);
  return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS });
}
