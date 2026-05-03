import TracksClient from './TracksClient';
import {
  annotatePlayedTracks,
  getTrackCount,
  listTracks,
  type TrackRatingFilter,
  type TrackSortMode,
} from '@/lib/sync/tracks';
import { getPlayedBcTrackIds } from '@/lib/library/plays';
import { getPlaylistMembershipForTrackIds } from '@/lib/library/playlists';
import { getStoredAuth } from '@/lib/auth/store';

export const dynamic = 'force-dynamic';

const VALID_RATINGS = new Set<TrackRatingFilter>(['all', 'liked', 'disliked', 'unrated']);
const VALID_SORT = new Set<TrackSortMode>(['artist', 'recent', 'rating']);

export default async function TracksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Tracks</h1>
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
  const ratingRaw = typeof sp.rating === 'string' ? (sp.rating as TrackRatingFilter) : 'all';
  const sortRaw = typeof sp.sort === 'string' ? (sp.sort as TrackSortMode) : 'artist';
  const rating: TrackRatingFilter = VALID_RATINGS.has(ratingRaw) ? ratingRaw : 'all';
  const sort: TrackSortMode = VALID_SORT.has(sortRaw) ? sortRaw : 'artist';
  const search = typeof sp.q === 'string' ? sp.q : '';
  const archivedView = sp.archived === '1';

  const baseTracks = annotatePlayedTracks(
    listTracks({
      limit: 1000,
      rating,
      sort,
      search,
      includeArchived: archivedView,
      archivedOnly: archivedView,
    }),
    getPlayedBcTrackIds(),
  );
  const playlistMap = getPlaylistMembershipForTrackIds(baseTracks.map((t) => t.id));
  const tracks = baseTracks.map((t) => ({
    ...t,
    playlists: playlistMap.get(t.id) ?? [],
  }));
  const activeCount = getTrackCount();
  const totalIncludingArchived = getTrackCount({ includeArchived: true });
  const archivedCount = totalIncludingArchived - activeCount;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-32 pt-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {archivedView ? 'Archived tracks' : 'Library'}
          </h1>
          <p className="text-fg-secondary">
            {tracks.length} of{' '}
            {archivedView ? archivedCount : activeCount} tracks
            {!archivedView && archivedCount > 0 && ` · ${archivedCount} archived`}
            {search && (
              <>
                {' · search '}
                <code className="font-mono text-fg-primary">{search}</code>
              </>
            )}
          </p>
        </div>
      </header>
      <TracksClient
        initialTracks={tracks}
        initialRating={rating}
        initialSort={sort}
        initialSearch={search}
        archivedView={archivedView}
        archivedCount={archivedCount}
        libraryEmpty={totalIncludingArchived === 0}
      />
    </main>
  );
}
