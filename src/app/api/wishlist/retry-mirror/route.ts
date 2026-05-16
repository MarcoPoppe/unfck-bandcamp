import { NextResponse } from 'next/server';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';
import { getDb } from '@/lib/db';
import { setBcSyncedAt, setMirrorState } from '@/lib/wishlist/store';
import { addToBcWishlist, removeFromBcWishlist } from '@/lib/bandcamp/bc_wishlist_write';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RetryBody {
  itemType?: 't' | 'a';
  itemId?: number;
}

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: RetryBody;
  try {
    body = (await req.json()) as RetryBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid json' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (body.itemType !== 't' && body.itemType !== 'a') {
    return NextResponse.json(
      { ok: false, error: 'invalid itemType' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const itemId = Number(body.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'itemId required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const row = getDb()
    .prepare<
      [number],
      { bc_url: string; mirror_state: string; dismissed_at: string | null }
    >(
      body.itemType === 't'
        ? 'SELECT bc_url, mirror_state, dismissed_at FROM wishlist WHERE bc_track_id = ?'
        : 'SELECT bc_url, mirror_state, dismissed_at FROM wishlist WHERE bc_album_id = ?',
    )
    .get(itemId);

  if (!row) {
    return NextResponse.json(
      { ok: false, error: 'not_found' },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  if (row.mirror_state === 'pushing') {
    return NextResponse.json(
      { ok: false, error: 'already_pushing' },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  setMirrorState(body.itemType, itemId, 'pushing');
  const result = row.dismissed_at
    ? await removeFromBcWishlist(row.bc_url)
    : await addToBcWishlist(row.bc_url);

  if (result.ok) {
    setMirrorState(body.itemType, itemId, 'synced');
    setBcSyncedAt(body.itemType, itemId, new Date().toISOString());
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  }
  setMirrorState(body.itemType, itemId, 'push_failed', result.error ?? 'unknown_error');
  return NextResponse.json(
    { ok: false, error: result.error ?? 'unknown_error' },
    { headers: NO_STORE_HEADERS },
  );
}
