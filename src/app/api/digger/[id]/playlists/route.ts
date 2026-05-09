import { NextResponse } from 'next/server';
import {
  addCuratorToPlaylist,
  listPlaylistsWithCuratorMembership,
  removeCuratorFromPlaylist,
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
  const diggerId = Number(id);
  if (!Number.isInteger(diggerId) || diggerId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid digger id' }, { status: 400 });
  }
  return NextResponse.json(
    { ok: true, playlists: listPlaylistsWithCuratorMembership(diggerId) },
    { headers: NO_STORE_HEADERS },
  );
}

interface MutateBody {
  playlistId?: number;
  action?: 'add' | 'remove';
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const { id } = await params;
  const diggerId = Number(id);
  if (!Number.isInteger(diggerId) || diggerId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid digger id' }, { status: 400 });
  }
  let body: MutateBody = {};
  try {
    body = (await req.json()) as MutateBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }
  const playlistId = Number(body.playlistId);
  if (!Number.isInteger(playlistId) || playlistId <= 0) {
    return NextResponse.json({ ok: false, error: 'playlistId required' }, { status: 400 });
  }
  const action = body.action ?? 'add';
  const changed =
    action === 'remove'
      ? removeCuratorFromPlaylist(playlistId, diggerId)
      : addCuratorToPlaylist(playlistId, diggerId);
  return NextResponse.json({ ok: true, changed }, { headers: NO_STORE_HEADERS });
}
