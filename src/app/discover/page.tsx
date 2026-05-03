import DiscoverHub from './DiscoverHub';
import { getStoredAuth } from '@/lib/auth/store';
import { getDiscoveredTrackCount, listDiscoveredTracks } from '@/lib/sync/discovery';
import { getPlayedBcTrackIds } from '@/lib/library/plays';
import {
  listFollowedArtists,
  listFollowedDiggers,
  listFollowedLabels,
} from '@/lib/entities/store';
import { listDiggerCandidates } from '@/lib/sync/diggers';

export const dynamic = 'force-dynamic';

const VALID_TABS = new Set(['tracks', 'follows', 'diggers', 'lookup']);

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
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

  const sp = await searchParams;
  const tabRaw = typeof sp.tab === 'string' ? sp.tab : 'tracks';
  const tab = (VALID_TABS.has(tabRaw) ? tabRaw : 'tracks') as
    | 'tracks'
    | 'follows'
    | 'diggers'
    | 'lookup';

  const playedBcIds = getPlayedBcTrackIds();
  // Discover is for *new* tracks: filter out anything we already played at
  // the SQL level so the user doesn't have to scroll through their own
  // history. The "Hide played" toggle on the page becomes a no-op for the
  // initial page-load (server already excluded), but still kicks in for
  // tracks the user plays *during* the session via the live player store.
  const tracks = listDiscoveredTracks({ limit: 500, excludePlayed: true }).map((t) => ({
    ...t,
    hasBeenPlayed: playedBcIds.has(t.bcTrackId),
  }));
  const tracksTotal = getDiscoveredTrackCount();
  const followedArtists = listFollowedArtists();
  const followedLabels = listFollowedLabels();
  const followedDiggers = listFollowedDiggers();
  const curators = listDiggerCandidates({ limit: 100 });

  return (
    <main className="mx-auto max-w-5xl px-4 pb-32 pt-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
        <p className="text-fg-secondary">
          New tracks from artists you follow, plus the people whose taste overlaps with
          yours.
        </p>
      </header>
      <DiscoverHub
        tab={tab}
        tracks={tracks}
        tracksTotal={tracksTotal}
        followedArtists={followedArtists}
        followedLabels={followedLabels}
        followedDiggers={followedDiggers}
        curators={curators}
      />
    </main>
  );
}
