import { NextResponse } from 'next/server';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';
import { bulkAddToCart, type BulkAddItem } from '@/lib/sync/cart_bulk_add';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

interface PostBody {
  items?: Array<{ itemType?: string; itemId?: number; bcUrl?: string }>;
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
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'items required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const items: BulkAddItem[] = [];
  for (const raw of body.items) {
    if (raw.itemType !== 't' && raw.itemType !== 'a') {
      return NextResponse.json(
        { ok: false, error: `invalid itemType ${String(raw.itemType)}` },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const itemId = Number(raw.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json(
        { ok: false, error: 'itemId must be a positive integer' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (!raw.bcUrl) {
      return NextResponse.json(
        { ok: false, error: 'bcUrl required for every item' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    items.push({ itemType: raw.itemType, itemId, bcUrl: raw.bcUrl });
  }

  const result = await bulkAddToCart({ items });
  return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS });
}
