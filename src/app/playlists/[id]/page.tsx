import { notFound } from 'next/navigation';
import PlaylistDetailClient from './PlaylistDetailClient';
import { getPlaylist, getPlaylistTracks } from '@/lib/library/playlists';
import { getStoredAuth } from '@/lib/auth/store';

export const dynamic = 'force-dynamic';

export default async function PlaylistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <p className="text-fg-secondary">
          Setup nicht abgeschlossen. <a className="text-accent underline" href="/setup">/setup</a>
        </p>
      </main>
    );
  }
  const { id } = await params;
  const playlistId = Number(id);
  if (!Number.isInteger(playlistId)) notFound();
  const playlist = getPlaylist(playlistId);
  if (!playlist) notFound();
  const tracks = getPlaylistTracks(playlistId);
  return (
    <main className="mx-auto max-w-5xl px-4 pb-32 pt-8">
      <header className="mb-6">
        <a href="/playlists" className="text-sm text-fg-muted transition-colors hover:text-accent">
          ← alle Playlists
        </a>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{playlist.name}</h1>
        <p className="text-fg-secondary">{playlist.trackCount} Tracks</p>
      </header>
      <PlaylistDetailClient playlistId={playlistId} initialTracks={tracks} />
    </main>
  );
}
