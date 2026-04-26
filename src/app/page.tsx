import Link from 'next/link';
import { getStoredAuth } from '@/lib/auth/store';
import { getLatestSyncRun, getOwnedItemCount } from '@/lib/sync/owned';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const auth = getStoredAuth();

  if (!auth) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-5xl font-bold tracking-tight">Unfck Bandcamp</h1>
        <p className="mt-4 text-fg-secondary">
          Beatport-style discovery for your Bandcamp collection. Self-hosted, single-tenant.
        </p>
        <Link
          href="/setup"
          className="mt-12 inline-block rounded bg-accent px-6 py-3 font-medium text-fg-primary transition-colors hover:bg-accent-hover"
        >
          Setup starten
        </Link>
      </main>
    );
  }

  const ownedCount = getOwnedItemCount();
  const lastSync = getLatestSyncRun('owned');

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Unfck Bandcamp</h1>
      <p className="mt-1 text-fg-secondary">eingeloggt als {auth.username}</p>
      <div className="mt-8 grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-bg-surface p-6">
          <div className="text-fg-muted text-sm">Owned items</div>
          <div className="mt-1 text-3xl font-semibold">{ownedCount}</div>
        </div>
        <div className="rounded-lg border border-border bg-bg-surface p-6">
          <div className="text-fg-muted text-sm">Letzter Sync</div>
          <div className="mt-1 text-sm font-mono">
            {lastSync ? `${lastSync.status} ${lastSync.startedAt}` : 'noch nie gelaufen'}
          </div>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/tracks"
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-fg-primary transition-colors hover:bg-accent-hover"
        >
          Tracks
        </Link>
        <Link
          href="/discover"
          className="rounded border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover"
        >
          Discover
        </Link>
        <Link
          href="/follows"
          className="rounded border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover"
        >
          Follows
        </Link>
        <Link
          href="/wishlist"
          className="rounded border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover"
        >
          Wishlist
        </Link>
        <Link
          href="/playlists"
          className="rounded border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover"
        >
          Playlists
        </Link>
        <Link
          href="/tags"
          className="rounded border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover"
        >
          Tags
        </Link>
        <Link
          href="/history"
          className="rounded border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover"
        >
          History
        </Link>
        <Link
          href="/setup"
          className="rounded border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover"
        >
          Setup
        </Link>
      </div>
    </main>
  );
}
