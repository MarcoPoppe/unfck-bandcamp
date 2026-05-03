import { NextResponse } from 'next/server';
import {
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  getAllPlaylistMemberships,
  listPlaylists,
  listPlaylistsWithMembership,
  removeTrackFromPlaylist,
  reorderPlaylist,
} from '@/lib/library/playlists';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const url = new URL(req.url);
  // ?as=memberships — returns the full track→playlists map for live store
  // hydration. Compact: only tracks with at least one membership appear.
  if (url.searchParams.get('as') === 'memberships') {
    const map = getAllPlaylistMemberships();
    const memberships: Record<string, { id: number; name: string }[]> = {};
    for (const [trackId, list] of map) {
      memberships[String(trackId)] = list;
    }
    return NextResponse.json(
      { ok: true, memberships },
      { headers: NO_STORE_HEADERS },
    );
  }
  // ?trackId=N — returns each playlist annotated with whether the track is
  // already in it. Used by the per-row playlist dropdown to render checkbox
  // state. Without the param, returns the plain list.
  const trackIdRaw = url.searchParams.get('trackId');
  if (trackIdRaw != null) {
    const n = Number(trackIdRaw);
    if (!Number.isInteger(n) || n <= 0) {
      return NextResponse.json(
        { ok: false, error: 'trackId must be a positive integer' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { ok: true, playlists: listPlaylistsWithMembership(n) },
      { headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { ok: true, playlists: listPlaylists() },
    { headers: NO_STORE_HEADERS },
  );
}

interface PostBody {
  action?: 'create' | 'add_track' | 'remove_track' | 'reorder' | 'delete';
  playlistId?: number;
  trackId?: number;
  name?: string;
  description?: string | null;
  orderedTrackIds?: number[];
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
  function posInt(v: unknown): number {
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      throw new Error('id must be a positive integer');
    }
    return v;
  }
  try {
    if (body.action === 'create') {
      if (!body.name) throw new Error('name required');
      const id = createPlaylist(body.name, body.description ?? null);
      return NextResponse.json({ ok: true, id }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'add_track') {
      const playlistId = posInt(body.playlistId);
      const trackId = posInt(body.trackId);
      const added = addTrackToPlaylist(playlistId, trackId);
      return NextResponse.json({ ok: true, added }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'remove_track') {
      const playlistId = posInt(body.playlistId);
      const trackId = posInt(body.trackId);
      const removed = removeTrackFromPlaylist(playlistId, trackId);
      return NextResponse.json({ ok: true, removed }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'reorder') {
      const playlistId = posInt(body.playlistId);
      if (!Array.isArray(body.orderedTrackIds)) {
        throw new Error('orderedTrackIds required');
      }
      const ordered = body.orderedTrackIds.map((v) => posInt(v));
      reorderPlaylist(playlistId, ordered);
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'delete') {
      const playlistId = posInt(body.playlistId);
      const removed = deletePlaylist(playlistId);
      return NextResponse.json({ ok: true, removed }, { headers: NO_STORE_HEADERS });
    }
    throw new Error('unknown action');
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'playlist op failed' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
