import { NextResponse } from 'next/server';
import {
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  removeTrackFromPlaylist,
  reorderPlaylist,
} from '@/lib/library/playlists';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
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
  try {
    if (body.action === 'create') {
      if (!body.name) throw new Error('name required');
      const id = createPlaylist(body.name, body.description ?? null);
      return NextResponse.json({ ok: true, id }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'add_track') {
      if (!body.playlistId || !body.trackId) throw new Error('playlistId+trackId required');
      const added = addTrackToPlaylist(body.playlistId, body.trackId);
      return NextResponse.json({ ok: true, added }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'remove_track') {
      if (!body.playlistId || !body.trackId) throw new Error('playlistId+trackId required');
      const removed = removeTrackFromPlaylist(body.playlistId, body.trackId);
      return NextResponse.json({ ok: true, removed }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'reorder') {
      if (!body.playlistId || !Array.isArray(body.orderedTrackIds)) {
        throw new Error('playlistId+orderedTrackIds required');
      }
      reorderPlaylist(body.playlistId, body.orderedTrackIds);
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'delete') {
      if (!body.playlistId) throw new Error('playlistId required');
      const removed = deletePlaylist(body.playlistId);
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
