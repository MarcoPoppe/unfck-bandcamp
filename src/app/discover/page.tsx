import DiscoverClient from './DiscoverClient';
import { getDiscoveredTrackCount, listDiscoveredTracks } from '@/lib/sync/discovery';
import { getStoredAuth } from '@/lib/auth/store';

export const dynamic = 'force-dynamic';

export default function DiscoverPage() {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
        <p className="mt-2 text-fg-secondary">
          Setup ist noch nicht abgeschlossen.{' '}
          <a className="text-accent underline" href="/setup">
            /setup
          </a>
        </p>
      </main>
    );
  }
  const tracks = listDiscoveredTracks({ limit: 500 });
  const total = getDiscoveredTrackCount();
  return (
    <main className="mx-auto max-w-5xl px-4 pb-32 pt-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
          <p className="text-fg-secondary">
            {total} neue Tracks aus deinen Follows. Owned-Items sind ausgeblendet.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <a href="/follows" className="text-fg-muted transition-colors hover:text-accent">
            Follows verwalten
          </a>
          <a href="/" className="text-fg-muted transition-colors hover:text-accent">
            ← home
          </a>
        </div>
      </header>
      <DiscoverClient initialTracks={tracks} />
    </main>
  );
}
