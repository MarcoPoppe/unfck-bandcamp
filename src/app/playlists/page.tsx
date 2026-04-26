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
          Setup ist noch nicht abgeschlossen.{' '}
          <a className="text-accent underline" href="/setup">
            /setup
          </a>
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Playlists</h1>
          <p className="text-fg-secondary">Eigene Set-Sammlungen, manuell zusammengestellt.</p>
        </div>
        <a href="/" className="text-sm text-fg-muted transition-colors hover:text-accent">
          ← home
        </a>
      </header>
      <PlaylistsClient initialPlaylists={listPlaylists()} />
    </main>
  );
}
