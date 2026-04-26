import { NextResponse } from 'next/server';
import { addTagToTrack, createTag, deleteTag, listTags, removeTagFromTrack } from '@/lib/library/tags';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  return NextResponse.json({ ok: true, tags: listTags() }, { headers: NO_STORE_HEADERS });
}

interface PostBody {
  action?: 'create' | 'attach' | 'detach' | 'delete';
  name?: string;
  color?: string;
  trackId?: number;
  tagId?: number;
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
      const id = createTag(body.name, body.color);
      return NextResponse.json({ ok: true, id }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'attach') {
      if (!body.trackId || !body.tagId) throw new Error('trackId and tagId required');
      addTagToTrack(body.trackId, body.tagId);
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'detach') {
      if (!body.trackId || !body.tagId) throw new Error('trackId and tagId required');
      const removed = removeTagFromTrack(body.trackId, body.tagId);
      return NextResponse.json({ ok: true, removed }, { headers: NO_STORE_HEADERS });
    }
    if (body.action === 'delete') {
      if (!body.tagId) throw new Error('tagId required');
      const removed = deleteTag(body.tagId);
      return NextResponse.json({ ok: true, removed }, { headers: NO_STORE_HEADERS });
    }
    throw new Error('action must be create / attach / detach / delete');
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'tag op failed' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
