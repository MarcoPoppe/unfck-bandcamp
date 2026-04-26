import { NextResponse } from 'next/server';
import {
  addToWishlist,
  dismissItem,
  getWishlistStatusCounts,
  listWishlist,
  markBoughtBatch,
  reopenItem,
  type WishlistStatus,
} from '@/lib/wishlist/store';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PostBody {
  bcTrackId?: number;
  bcUrl?: string;
  title?: string;
  artistName?: string | null;
  albumTitle?: string | null;
  coverUrl?: string | null;
}

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const status =
    statusParam === 'open' || statusParam === 'bought' || statusParam === 'dismissed'
      ? (statusParam as WishlistStatus)
      : undefined;
  return NextResponse.json(
    {
      ok: true,
      items: listWishlist(status),
      counts: getWishlistStatusCounts(),
    },
    { headers: NO_STORE_HEADERS },
  );
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
  const bcTrackId = Number(body.bcTrackId);
  if (!Number.isInteger(bcTrackId) || bcTrackId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'bcTrackId must be positive integer' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (!body.bcUrl || !body.title) {
    return NextResponse.json(
      { ok: false, error: 'bcUrl and title required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const result = addToWishlist({
    bcTrackId,
    bcUrl: body.bcUrl,
    title: body.title,
    artistName: body.artistName ?? null,
    albumTitle: body.albumTitle ?? null,
    coverUrl: body.coverUrl ?? null,
  });
  return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS });
}

interface PatchBody {
  ids?: number[];
  action?: 'mark_bought' | 'dismiss' | 'reopen';
}

export async function PATCH(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid json' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const ids = (body.ids ?? []).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'ids must be a non-empty array of positive integers' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (body.action === 'mark_bought') {
    return NextResponse.json(
      { ok: true, updated: markBoughtBatch(ids) },
      { headers: NO_STORE_HEADERS },
    );
  }
  if (body.action === 'dismiss') {
    let updated = 0;
    for (const id of ids) if (dismissItem(id)) updated += 1;
    return NextResponse.json({ ok: true, updated }, { headers: NO_STORE_HEADERS });
  }
  if (body.action === 'reopen') {
    let updated = 0;
    for (const id of ids) if (reopenItem(id)) updated += 1;
    return NextResponse.json({ ok: true, updated }, { headers: NO_STORE_HEADERS });
  }
  return NextResponse.json(
    { ok: false, error: 'action must be mark_bought / dismiss / reopen' },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}
