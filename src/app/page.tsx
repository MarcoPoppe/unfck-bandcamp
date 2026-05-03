import Link from 'next/link';
import { getStoredAuth } from '@/lib/auth/store';
import { getLatestSyncRun, getOwnedItemCount } from '@/lib/sync/owned';
import { getTrackCount } from '@/lib/sync/tracks';
import { getDiscoveredTrackCount } from '@/lib/sync/discovery';
import { getWishlistStatusCounts } from '@/lib/wishlist/store';
import {
  listFollowedArtists,
  listFollowedDiggers,
  listFollowedLabels,
} from '@/lib/entities/store';
import { getTotalPlayCount, listRecentPlays } from '@/lib/library/plays';
import RecentlyPlayedList from '@/components/RecentlyPlayedList';
import { formatDateTime } from '@/lib/util/datetime';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const auth = getStoredAuth();

  if (!auth) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-24">
        <div className="rounded-2xl border border-border bg-bg-surface p-10">
          <h1 className="text-5xl font-bold tracking-tight">
            Unfck <span className="text-accent">Bandcamp</span>
          </h1>
          <p className="mt-4 max-w-xl text-lg text-fg-secondary">
            A Beatport-style discovery UI for your Bandcamp collection. Self-hosted,
            single-tenant, your account, your data.
          </p>
          <Link
            href="/setup"
            className="mt-10 inline-block rounded bg-accent px-6 py-3 font-medium text-fg-on-accent transition-colors hover:bg-accent-hover"
          >
            Start setup
          </Link>
        </div>
      </main>
    );
  }

  const ownedCount = getOwnedItemCount();
  const trackCount = getTrackCount();
  const discoveredCount = getDiscoveredTrackCount();
  const wishlistCounts = getWishlistStatusCounts();
  const followsCount =
    listFollowedArtists().length + listFollowedLabels().length + listFollowedDiggers().length;
  const playsTotal = getTotalPlayCount();
  const lastOwnedSync = getLatestSyncRun('owned');
  const lastDiscoverySync = getLatestSyncRun('discovery');
  const recentPlays = listRecentPlays(5);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-32 pt-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Hi <span className="text-accent">{auth.username}</span>
          </h1>
          <p className="mt-1 text-fg-secondary">
            {trackCount} tracks · {ownedCount} releases · last sync {formatDateTime(lastOwnedSync?.startedAt) || '—'}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Tracks" value={trackCount} href="/tracks" />
        <StatCard label="Releases" value={ownedCount} href="/tracks" />
        <StatCard label="Discoveries" value={discoveredCount} href="/discover" accent={discoveredCount > 0} />
        <StatCard label="Wishlist" value={wishlistCounts.open} href="/wishlist" accent={wishlistCounts.open > 0} />
        <StatCard label="Follows" value={followsCount} href="/follows" />
        <StatCard label="Plays" value={playsTotal} href="/history" />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <SyncCard
          title="Collection sync"
          run={lastOwnedSync}
          actionHref="/tracks"
          actionLabel="Manage tracks"
        />
        <SyncCard
          title="Discovery sync"
          run={lastDiscoverySync}
          actionHref="/follows"
          actionLabel="Manage follows"
          empty="Follow artists or labels to start discovering."
        />
        <div className="rounded-xl border border-border bg-bg-surface p-5">
          <div className="text-sm font-semibold">Quick actions</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/tracks"
              className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm transition-colors hover:bg-bg-hover"
            >
              Tracks
            </Link>
            <Link
              href="/discover"
              className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm transition-colors hover:bg-bg-hover"
            >
              Discover
            </Link>
            <Link
              href="/wishlist"
              className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm transition-colors hover:bg-bg-hover"
            >
              Wishlist
            </Link>
            <Link
              href="/playlists"
              className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm transition-colors hover:bg-bg-hover"
            >
              Playlists
            </Link>
            <Link
              href="/history"
              className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm transition-colors hover:bg-bg-hover"
            >
              History
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Recently played</div>
          <Link href="/history" className="text-xs text-fg-muted hover:text-accent">
            All history →
          </Link>
        </div>
        <RecentlyPlayedList plays={recentPlays} />
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  value: number;
  href: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group rounded-xl border bg-bg-surface p-4 transition-colors hover:bg-bg-elevated ${
        accent ? 'border-accent/40' : 'border-border'
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          accent ? 'text-accent' : 'text-fg-primary'
        }`}
      >
        {value}
      </div>
    </Link>
  );
}

interface SyncCardRun {
  status: 'running' | 'success' | 'error';
  startedAt: string;
  itemsSynced: number;
  errorMessage: string | null;
}

function SyncCard({
  title,
  run,
  actionHref,
  actionLabel,
  empty,
}: {
  title: string;
  run: SyncCardRun | null;
  actionHref: string;
  actionLabel: string;
  empty?: string;
}) {
  const statusColor =
    run?.status === 'success'
      ? 'text-fg-success'
      : run?.status === 'error'
        ? 'text-fg-danger'
        : run?.status === 'running'
          ? 'text-accent'
          : 'text-fg-muted';
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        <Link href={actionHref} className="text-xs text-fg-muted hover:text-accent">
          {actionLabel} →
        </Link>
      </div>
      {run ? (
        <div className="mt-3 space-y-1 text-sm">
          <div className={`font-medium ${statusColor}`}>
            {run.status === 'success'
              ? 'Healthy'
              : run.status === 'error'
                ? 'Last run failed'
                : run.status === 'running'
                  ? 'Running…'
                  : 'Idle'}
          </div>
          <div className="font-mono text-xs text-fg-muted">
            {formatDateTime(run.startedAt)} · {run.itemsSynced} items
          </div>
          {run.errorMessage && (
            <div className="truncate text-xs text-fg-danger" title={run.errorMessage}>
              {run.errorMessage}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 text-sm text-fg-muted">{empty ?? 'Never run.'}</div>
      )}
    </div>
  );
}
