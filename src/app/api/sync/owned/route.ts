import { NextResponse } from 'next/server';
import { syncOwnedCollection } from '@/lib/sync/owned';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

interface SyncBody {
  maxItems?: number;
}

export async function POST(req: Request) {
  let body: SyncBody = {};
  try {
    body = (await req.json()) as SyncBody;
  } catch {
    // empty body is fine
  }

  try {
    const result = await syncOwnedCollection(body.maxItems);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
