import PlaylistsClient from './PlaylistsClient';
import { listPlaylists } from '@/lib/library/playlists';
import { getStoredAuth } from '@/lib/auth/store';

export const dynamic = 'force-dynamic';

export default function PlaylistsPage() {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Playlists</h1>
        <p className="mt-2 text-fg-secondary">
          Setup is not complete.{' '}
          <a className="text-accent underline" href="/setup">
            Open setup
          </a>
          .
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl px-4 pb-32 pt-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Playlists</h1>
        <p className="text-fg-secondary">Hand-curated set lists.</p>
      </header>
      <PlaylistsClient initialPlaylists={listPlaylists()} />
    </main>
  );
}
