import { NextResponse } from 'next/server';
import {
  getCrawlTargetUsername,
  getStoredCrawlerAuth,
  getStoredMainAuth,
} from '@/lib/auth/store';
import { getLatestSyncRun, getOwnedItemCount } from '@/lib/sync/owned';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface AccountSummary {
  fanId: number;
  username: string;
  email: string | null;
  updatedAt: string;
}

function summarise(
  auth: ReturnType<typeof getStoredCrawlerAuth>,
): AccountSummary | null {
  if (!auth) return null;
  return {
    fanId: auth.fanId,
    username: auth.username,
    email: auth.email,
    updatedAt: auth.updatedAt,
  };
}

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const crawler = getStoredCrawlerAuth();
  const main = getStoredMainAuth();
  // "configured" means at least one auth row exists. Old setups (only main
  // populated, no crawler yet) still report configured=true so the rest of
  // the app keeps working until the user adds a throwaway.
  const configured = crawler != null || main != null;
  return NextResponse.json(
    {
      ok: true,
      configured,
      crawler: summarise(crawler),
      main: summarise(main),
      crawlTargetUsername: getCrawlTargetUsername(),
      ownedCount: getOwnedItemCount(),
      lastSync: getLatestSyncRun('owned'),
    },
    { headers: NO_STORE_HEADERS },
  );
}
