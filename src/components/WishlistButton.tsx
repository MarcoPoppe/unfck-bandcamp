'use client';

import { useState } from 'react';
import { usePlayerStore } from '@/lib/store/player';
import Tooltip from './Tooltip';

interface Props {
  bcTrackId: number;
  bcUrl: string;
  title: string;
  artistName: string | null;
  albumTitle: string | null;
  coverUrl: string | null;
  initialOnWishlist?: boolean;
}

export default function WishlistButton(props: Props) {
  // Live wishlist state lives in the player store so a heart filled in
  // one place (e.g. the player bar) lights up everywhere this button is
  // rendered for the same bcTrackId — without each instance fetching its
  // own status. Falls back to the server-provided initialOnWishlist for
  // the first paint before the store is hydrated.
  const liveOnWishlist = usePlayerStore((s) =>
    s.wishlistedBcTrackIds.has(props.bcTrackId),
  );
  const markOnWishlist = usePlayerStore((s) => s.markOnWishlist);
  const markOffWishlist = usePlayerStore((s) => s.markOffWishlist);
  const onWishlist = liveOnWishlist || (props.initialOnWishlist ?? false);
  const [busy, setBusy] = useState(false);
  // Bumped on every successful toggle to remount the heart + ring nodes
  // and re-trigger the CSS pop/ring animation. Tracking last-direction
  // so we can suppress the radial ring on "off"-toggles (Twitter only
  // bursts on-add, never on-remove).
  const [pulseKey, setPulseKey] = useState(0);
  const [pulseDir, setPulseDir] = useState<'on' | 'off' | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      if (onWishlist) {
        // Toggle off: find the wishlist row id by bc_track_id and dismiss
        // it. Dismiss flips status to 'dismissed' so the heart goes off
        // everywhere via the live store. Same effect as multi-select →
        // Dismiss on /wishlist, just one-click.
        const list = await fetch('/api/wishlist?status=open').then(
          (r) => r.json() as Promise<{ items?: { id: number; bcTrackId: number }[] }>,
        );
        const row = list.items?.find((i) => i.bcTrackId === props.bcTrackId);
        if (!row) {
          // Already off (race / bought / dismissed) — just sync local state.
          markOffWishlist(props.bcTrackId);
          return;
        }
        const res = await fetch('/api/wishlist', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [row.id], action: 'dismiss' }),
        });
        if (res.ok) {
          markOffWishlist(props.bcTrackId);
          setPulseDir('off');
          setPulseKey((k) => k + 1);
        }
        return;
      }
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
      if (res.ok) {
        markOnWishlist(props.bcTrackId);
        setPulseDir('on');
        setPulseKey((k) => k + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  const filled = onWishlist;

  return (
    <Tooltip text={onWishlist ? 'Remove from wishlist' : 'Add to wishlist'} position="top">
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-label={onWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
      aria-pressed={onWishlist}
      className={`relative flex h-9 w-9 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        filled
          ? 'text-accent hover:bg-bg-hover hover:text-fg-muted'
          : busy
            ? 'cursor-wait text-fg-muted'
            : 'text-fg-muted hover:bg-bg-hover hover:text-accent'
      }`}
    >
      {/* Radial ring overlay. Only fires on the "on" toggle direction
          and only when the user actually performed an action this
          render — pulseKey > 0 keeps it idle on first paint. */}
      {pulseDir === 'on' && pulseKey > 0 && (
        <span
          key={`ring-${pulseKey}`}
          aria-hidden
          className="anim-ring pointer-events-none absolute inset-1 rounded-full border-2 border-accent"
        />
      )}
      <svg
        // The key remount restarts the pop animation on each click. Off
        // toggles get a softer animation; on-toggles use the springy pop.
        key={`heart-${pulseKey}`}
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={
          pulseKey === 0
            ? ''
            : pulseDir === 'on'
              ? 'anim-pop'
              : 'anim-pop-soft'
        }
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
    </Tooltip>
  );
}
