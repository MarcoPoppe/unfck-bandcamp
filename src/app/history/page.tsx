import { getPlayedBcTrackIds, listPlaysAggregated } from '@/lib/library/plays';
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
  // Aggregate by track: one row per track with play_count, last-played
  // timestamp, best completion. Marco: "doppelte Eintraege aggregieren."
  const all = listPlaysAggregated();
  const playlistMap = getPlaylistMembershipForTrackIds(all.map((p) => p.trackId));
  const plays = all.map((p) => ({
    ...p,
    hasBeenPlayed: played.has(p.bcTrackId),
    playlists: playlistMap.get(p.trackId) ?? [],
  }));
  const totalPlays = plays.reduce((sum, p) => sum + p.playCount, 0);
  return (
    <main className="mx-auto max-w-4xl px-4 pb-32 pt-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">History</h1>
        <p className="text-fg-secondary">
          {plays.length.toLocaleString('de-DE')} unique tracks ·{' '}
          {totalPlays.toLocaleString('de-DE')} plays total. Every track you listened to for at
          least a second shows up here. The bar shows the best completion you reached on this
          track across all plays.
        </p>
      </header>
      <HistoryClient plays={plays} />
    </main>
  );
}
