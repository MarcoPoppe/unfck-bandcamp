import { NextResponse } from 'next/server';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';
import { getLatestSyncRunOfKind, getRecentSyncRuns } from '@/lib/sync/runs';
import { syncWishlistFromBandcamp } from '@/lib/sync/wishlist_sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const existing = getLatestSyncRunOfKind('wishlist');
  if (existing && existing.status === 'running') {
    return NextResponse.json(
      { ok: true, runId: existing.id, alreadyRunning: true },
      { headers: NO_STORE_HEADERS },
    );
  }

  // Fire-and-forget: client polls /api/sync/wishlist (GET) for status.
  // We intentionally swallow errors here — the sync function itself
  // persists a failure row in sync_runs that the poll will pick up.
  void syncWishlistFromBandcamp().catch(() => {});
  return NextResponse.json({ ok: true, started: true }, { headers: NO_STORE_HEADERS });
}

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const run = getLatestSyncRunOfKind('wishlist');
  const recent = getRecentSyncRuns('wishlist', 5);
  return NextResponse.json({ ok: true, run, recent }, { headers: NO_STORE_HEADERS });
}
