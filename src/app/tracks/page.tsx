import TracksClient from './TracksClient';
import { getTrackCount, listTracks } from '@/lib/sync/tracks';
import { getStoredAuth } from '@/lib/auth/store';

export const dynamic = 'force-dynamic';

export default function TracksPage() {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Tracks</h1>
        <p className="mt-2 text-fg-secondary">
          Setup ist noch nicht abgeschlossen. <a className="text-accent underline" href="/setup">/setup</a>
        </p>
      </main>
    );
  }
  const tracks = listTracks({ limit: 500 });
  const total = getTrackCount();
  return (
    <main className="mx-auto max-w-5xl px-4 pb-32 pt-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tracks</h1>
          <p className="text-fg-secondary">{total} Tracks expanded aus deiner Collection</p>
        </div>
        <a
          href="/"
          className="text-sm text-fg-muted transition-colors hover:text-accent"
        >
          ← home
        </a>
      </header>
      <TracksClient initialTracks={tracks} />
    </main>
  );
}
