import { getPlayedBcTrackIds, listRecentPlays } from '@/lib/library/plays';
import { getPlaylistMembershipForTrackIds } from '@/lib/library/playlists';
import { getStoredAuth } from '@/lib/auth/store';
import HistoryClient from './HistoryClient';

export const dynamic = 'force-dynamic';

export default function HistoryPage() {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">History</h1>
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
  const played = getPlayedBcTrackIds();
  const recent = listRecentPlays(200);
  const playlistMap = getPlaylistMembershipForTrackIds(recent.map((p) => p.trackId));
  const plays = recent.map((p) => ({
    ...p,
    hasBeenPlayed: played.has(p.bcTrackId),
    playlists: playlistMap.get(p.trackId) ?? [],
  }));
  return (
    <main className="mx-auto max-w-4xl px-4 pb-32 pt-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">History</h1>
        <p className="text-fg-secondary">
          {plays.length} most recent plays. Anything you listened to for at least a second
          shows up here. The bar shows how much of the track played before you skipped or it
          ended.
        </p>
      </header>
      <HistoryClient plays={plays} />
    </main>
  );
}
