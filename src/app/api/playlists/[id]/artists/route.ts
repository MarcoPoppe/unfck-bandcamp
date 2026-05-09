import { NextResponse } from 'next/server';
import {
  addArtistToPlaylist,
  listPlaylistArtists,
  removeArtistFromPlaylist,
} from '@/lib/library/playlists';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const { id } = await params;
  const playlistId = Number(id);
  if (!Number.isInteger(playlistId) || playlistId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid playlist id' }, { status: 400 });
  }
  return NextResponse.json(
    { ok: true, artists: listPlaylistArtists(playlistId) },
    { headers: NO_STORE_HEADERS },
  );
}

interface MutateBody {
  artistId?: number;
  action?: 'add' | 'remove';
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const { id } = await params;
  const playlistId = Number(id);
  if (!Number.isInteger(playlistId) || playlistId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid playlist id' }, { status: 400 });
  }
  let body: MutateBody = {};
  try {
    body = (await req.json()) as MutateBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }
  const artistId = Number(body.artistId);
  if (!Number.isInteger(artistId) || artistId <= 0) {
    return NextResponse.json({ ok: false, error: 'artistId required' }, { status: 400 });
  }
  const action = body.action ?? 'add';
  const changed =
    action === 'remove'
      ? removeArtistFromPlaylist(playlistId, artistId)
      : addArtistToPlaylist(playlistId, artistId);
  return NextResponse.json({ ok: true, changed }, { headers: NO_STORE_HEADERS });
}
