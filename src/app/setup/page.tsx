import SetupClient from './SetupClient';
import {
  getCrawlTargetUsername,
  getStoredCrawlerAuth,
  getStoredMainAuth,
} from '@/lib/auth/store';
import { getLatestSyncRun, getOwnedItemCount } from '@/lib/sync/owned';

export const dynamic = 'force-dynamic';

interface AuthSummary {
  fanId: number;
  username: string;
  email: string | null;
  updatedAt: string;
}

function summarise(
  auth: ReturnType<typeof getStoredCrawlerAuth>,
): AuthSummary | null {
  if (!auth) return null;
  return {
    fanId: auth.fanId,
    username: auth.username,
    email: auth.email,
    updatedAt: auth.updatedAt,
  };
}

export default function SetupPage() {
  const initial = {
    crawler: summarise(getStoredCrawlerAuth()),
    main: summarise(getStoredMainAuth()),
    crawlTargetUsername: getCrawlTargetUsername(),
    ownedCount: getOwnedItemCount(),
    lastSync: getLatestSyncRun('owned'),
  };
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Setup</h1>
      <p className="mt-2 text-fg-secondary">
        Link a Bandcamp crawler account (used for all reads) and optionally a
        main account (used only to mirror follows back to bandcamp.com).
        Pick which profile&rsquo;s collection this instance pulls.
      </p>
      <div className="mt-8">
        <SetupClient initial={initial} />
      </div>
    </main>
  );
}
