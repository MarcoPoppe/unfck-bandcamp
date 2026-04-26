import { NextResponse } from 'next/server';
import { getStoredAuth } from '@/lib/auth/store';
import { getLatestSyncRun, getOwnedItemCount } from '@/lib/sync/owned';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const auth = getStoredAuth();
  if (!auth) {
    return NextResponse.json({ ok: true, configured: false }, { headers: NO_STORE_HEADERS });
  }
  return NextResponse.json(
    {
      ok: true,
      configured: true,
      auth: {
        fanId: auth.fanId,
        username: auth.username,
        email: auth.email,
        updatedAt: auth.updatedAt,
      },
      ownedCount: getOwnedItemCount(),
      lastSync: getLatestSyncRun('owned'),
    },
    { headers: NO_STORE_HEADERS },
  );
}
