'use client';

import { useState } from 'react';

interface Props {
  bcTrackId: number;
  bcUrl: string;
  title: string;
  artistName: string | null;
  albumTitle: string | null;
  coverUrl: string | null;
  initialOnWishlist?: boolean;
}

/**
 * Button to add a track to the wishlist. Optimistic-update locally,
 * server is source of truth on next page load. Used in TrackRow on
 * /discover and /tracks.
 */
export default function WishlistButton(props: Props) {
  const [onWishlist, setOnWishlist] = useState(props.initialOnWishlist ?? false);
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (onWishlist || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bcTrackId: props.bcTrackId,
          bcUrl: props.bcUrl,
          title: props.title,
          artistName: props.artistName,
          albumTitle: props.albumTitle,
          coverUrl: props.coverUrl,
        }),
      });
      if (res.ok) setOnWishlist(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || onWishlist}
      title={onWishlist ? 'auf Wishlist' : 'zur Wishlist hinzufuegen'}
      className={`text-xs transition-colors ${
        onWishlist
          ? 'cursor-default text-accent'
          : busy
            ? 'cursor-wait text-fg-muted'
            : 'text-fg-muted hover:text-accent'
      }`}
    >
      {onWishlist ? '♥' : '♡'}
    </button>
  );
}
