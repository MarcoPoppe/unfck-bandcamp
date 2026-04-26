import WishlistClient from './WishlistClient';
import { getWishlistStatusCounts, listWishlist } from '@/lib/wishlist/store';
import { getStoredAuth } from '@/lib/auth/store';

export const dynamic = 'force-dynamic';

export default function WishlistPage() {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Wishlist</h1>
        <p className="mt-2 text-fg-secondary">
          Setup ist noch nicht abgeschlossen.{' '}
          <a className="text-accent underline" href="/setup">
            /setup
          </a>
        </p>
      </main>
    );
  }
  const counts = getWishlistStatusCounts();
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Wishlist</h1>
          <p className="text-fg-secondary">
            Tracks die du auf Bandcamp kaufen willst. Nach dem naechsten Owned-Sync werden
            gekaufte Tracks automatisch markiert.
          </p>
        </div>
        <a href="/" className="text-sm text-fg-muted transition-colors hover:text-accent">
          ← home
        </a>
      </header>
      <WishlistClient
        initialOpen={listWishlist('open')}
        initialBought={listWishlist('bought')}
        initialDismissed={listWishlist('dismissed')}
        initialCounts={counts}
      />
    </main>
  );
}
