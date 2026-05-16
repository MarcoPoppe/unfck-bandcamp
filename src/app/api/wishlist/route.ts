import { NextResponse } from 'next/server';
import {
  addToWishlist,
  type BcItemType,
  dismissItem,
  getWishlistStatusCounts,
  listWishlist,
  markBoughtBatch,
  removeFromWishlist,
  reopenItem,
  setBcSyncedAt,
  setMirrorState,
  type WishlistStatus,
} from '@/lib/wishlist/store';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';
import { getDb } from '@/lib/db';
import { addToBcWishlist, removeFromBcWishlist } from '@/lib/bandcamp/bc_wishlist_write';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PostBody {
  itemType?: BcItemType | string;
  bcTrackId?: number;
  bcAlbumId?: number;
  bcUrl?: string;
  title?: string;
  artistName?: string | null;
  albumTitle?: string | null;
  coverUrl?: string | null;
  mirrorToBandcamp?: boolean;
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

function err400(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

function fireAndForgetMirrorAdd(itemType: BcItemType, itemId: number, bcUrl: string): void {
  setMirrorState(itemType, itemId, 'pushing');
  void (async () => {
    const result = await addToBcWishlist(bcUrl);
    if (result.ok) {
      setMirrorState(itemType, itemId, 'synced');
      setBcSyncedAt(itemType, itemId, new Date().toISOString());
    } else {
      setMirrorState(itemType, itemId, 'push_failed', result.error ?? 'unknown_error');
    }
  })();
}

function fireAndForgetMirrorRemove(bcUrl: string): void {
  void (async () => {
    const result = await removeFromBcWishlist(bcUrl);
    if (!result.ok) {
      // Local row is already gone, so we can't bookkeep failure on it. Log
      // and move on; the next pull-sync will reconcile.
      console.warn('mirror remove failed:', result.error);
    }
  })();
}

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return err400('invalid json');
  }

  // Legacy compatibility: pre-polymorphic callers send only bcTrackId
  // without itemType. Default to 't' so existing UI keeps working until
  // every call site is migrated.
  const itemType: BcItemType =
    body.itemType === 'a' || body.itemType === 't'
      ? body.itemType
      : 't';

  if (!body.bcUrl || !body.title) {
    return err400('bcUrl and title required');
  }

  if (itemType === 't') {
    const bcTrackId = Number(body.bcTrackId);
    if (!Number.isInteger(bcTrackId) || bcTrackId <= 0) {
      return err400('bcTrackId must be positive integer for itemType=t');
    }
    if (body.bcAlbumId != null) {
      return err400('cannot set both bcTrackId and bcAlbumId');
    }
    const id = addToWishlist({
      bcItemType: 't',
      bcTrackId,
      bcUrl: body.bcUrl,
      title: body.title,
      artistName: body.artistName ?? null,
      albumTitle: body.albumTitle ?? null,
      coverUrl: body.coverUrl ?? null,
    });
    if (body.mirrorToBandcamp) {
      fireAndForgetMirrorAdd('t', bcTrackId, body.bcUrl);
    }
    return NextResponse.json({ ok: true, id }, { headers: NO_STORE_HEADERS });
  }

  const bcAlbumId = Number(body.bcAlbumId);
  if (!Number.isInteger(bcAlbumId) || bcAlbumId <= 0) {
    return err400('bcAlbumId must be positive integer for itemType=a');
  }
  if (body.bcTrackId != null) {
    return err400('cannot set both bcTrackId and bcAlbumId');
  }
  const id = addToWishlist({
    bcItemType: 'a',
    bcAlbumId,
    bcUrl: body.bcUrl,
    title: body.title,
    artistName: body.artistName ?? null,
    albumTitle: body.albumTitle ?? null,
    coverUrl: body.coverUrl ?? null,
  });
  if (body.mirrorToBandcamp) {
    fireAndForgetMirrorAdd('a', bcAlbumId, body.bcUrl);
  }
  return NextResponse.json({ ok: true, id }, { headers: NO_STORE_HEADERS });
}

export async function DELETE(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const url = new URL(req.url);
  const itemTypeParam = url.searchParams.get('itemType');
  const itemType: BcItemType =
    itemTypeParam === 'a' || itemTypeParam === 't' ? itemTypeParam : 't';
  const itemId =
    itemType === 't'
      ? Number(url.searchParams.get('bcTrackId'))
      : Number(url.searchParams.get('bcAlbumId'));

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return err400('valid bcTrackId or bcAlbumId required');
  }

  const bcUrlRow = getDb()
    .prepare<[number], { bc_url: string }>(
      itemType === 't'
        ? 'SELECT bc_url FROM wishlist WHERE bc_track_id = ?'
        : 'SELECT bc_url FROM wishlist WHERE bc_album_id = ?',
    )
    .get(itemId);

  const removed = removeFromWishlist(itemType, itemId);

  if (removed && bcUrlRow && url.searchParams.get('mirrorToBandcamp') === '1') {
    fireAndForgetMirrorRemove(bcUrlRow.bc_url);
  }

  return NextResponse.json({ ok: true, removed }, { headers: NO_STORE_HEADERS });
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
    return err400('invalid json');
  }
  const ids = (body.ids ?? []).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) {
    return err400('ids must be a non-empty array of positive integers');
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
  return err400('action must be mark_bought / dismiss / reopen');
}
