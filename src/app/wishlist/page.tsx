import WishlistClient from './WishlistClient';
import { getWishlistStatusCounts, listWishlist } from '@/lib/wishlist/store';
import { getStoredAuth } from '@/lib/auth/store';
import { getPlayedBcTrackIds } from '@/lib/library/plays';
import { getPlaylistMembershipForBcTrackIds } from '@/lib/library/playlists';

export const dynamic = 'force-dynamic';

export default function WishlistPage() {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Wishlist</h1>
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
  const counts = getWishlistStatusCounts();
  const played = getPlayedBcTrackIds();
  const allItems = [
    ...listWishlist('open'),
    ...listWishlist('bought'),
    ...listWishlist('dismissed'),
  ];
  const playlistMap = getPlaylistMembershipForBcTrackIds(
    allItems.map((i) => i.bcTrackId),
  );
  const annotate = (items: ReturnType<typeof listWishlist>) =>
    items.map((i) => ({
      ...i,
      hasBeenPlayed: played.has(i.bcTrackId),
      playlists: playlistMap.get(i.bcTrackId) ?? [],
    }));
  return (
    <main className="mx-auto max-w-4xl px-4 pb-32 pt-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Wishlist</h1>
        <p className="text-fg-secondary">
          Tracks you want to buy on Bandcamp. After your next library sync,
          anything that has actually arrived in your collection is marked as
          bought automatically. You can also mark items manually with
          &ldquo;Mark as bought&rdquo;, or move them back to Open at any time.
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          The wishlist is the full pool of tracks you&rsquo;re interested in.
          Sort them further into{' '}
          <a className="text-accent underline" href="/playlists">
            Playlists
          </a>{' '}
          for sets, mood crates, or other groupings.
        </p>
      </header>
      <WishlistClient
        initialOpen={annotate(listWishlist('open'))}
        initialBought={annotate(listWishlist('bought'))}
        initialDismissed={annotate(listWishlist('dismissed'))}
        initialCounts={counts}
      />
    </main>
  );
}
