import SetupClient from './SetupClient';
import { getStoredAuth } from '@/lib/auth/store';
import { getLatestSyncRun, getOwnedItemCount } from '@/lib/sync/owned';

export const dynamic = 'force-dynamic';

export default function SetupPage() {
  const auth = getStoredAuth();
  const lastSync = getLatestSyncRun('owned');
  const ownedCount = getOwnedItemCount();
  const initial = auth
    ? {
        configured: true as const,
        auth: {
          fanId: auth.fanId,
          username: auth.username,
          email: auth.email,
          updatedAt: auth.updatedAt,
        },
        ownedCount,
        lastSync,
      }
    : { configured: false as const };
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Setup</h1>
      <p className="mt-2 text-fg-secondary">
        Cookies einpasten, validieren, dann initialen Owned-Sync starten.
      </p>
      <div className="mt-8">
        <SetupClient initial={initial} />
      </div>
    </main>
  );
}
