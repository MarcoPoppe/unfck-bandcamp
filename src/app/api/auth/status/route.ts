import { NextResponse } from 'next/server';
import { getStoredAuth } from '@/lib/auth/store';
import { getLatestSyncRun, getOwnedItemCount } from '@/lib/sync/owned';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = getStoredAuth();
  if (!auth) {
    return NextResponse.json({ ok: true, configured: false });
  }
  return NextResponse.json({
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
  });
}
