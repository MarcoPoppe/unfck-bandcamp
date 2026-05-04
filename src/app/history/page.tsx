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
  // 0 = unlimited. Virtuoso on the client side virtualises the DOM so
  // 10k+ rows render fine; loading them all in one shot keeps the page
  // simple (no pagination/cursor) and matches Marco's mental model:
  // "everything I have ever played should be here, the DB has it."
  const all = listRecentPlays(0);
  const playlistMap = getPlaylistMembershipForTrackIds(all.map((p) => p.trackId));
  const plays = all.map((p) => ({
    ...p,
    hasBeenPlayed: played.has(p.bcTrackId),
    playlists: playlistMap.get(p.trackId) ?? [],
  }));
  return (
    <main className="mx-auto max-w-4xl px-4 pb-32 pt-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">History</h1>
        <p className="text-fg-secondary">
          {plays.length.toLocaleString('de-DE')} plays total. Every track you listened to for
          at least a second shows up here. The bar shows how much of the track played before
          you skipped or it ended.
        </p>
      </header>
      <HistoryClient plays={plays} />
    </main>
  );
}
