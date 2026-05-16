'use client';

import { useState } from 'react';
import { usePlayerStore } from '@/lib/store/player';
import { useIsWishlisted } from '@/lib/hooks/useIsWishlisted';
import { loadPreferences } from '@/lib/settings/preferences';
import Tooltip from './Tooltip';

interface Props {
  bcAlbumId: number;
  bcUrl: string;
  title: string;
  artistName?: string | null;
  coverUrl?: string | null;
  initialOnWishlist?: boolean;
}

/**
 * EP / album heart button. Polymorphic counterpart of WishlistButton —
 * same UX, same store, different itemType. The mirror push and the
 * pull-sync both already understand `itemType: 'a'`; this component
 * sends the album variant of the polymorphic /api/wishlist call.
 */
export default function WishlistAlbumButton(props: Props) {
  const liveOnWishlist = useIsWishlisted('a', props.bcAlbumId);
  const markOnWishlist = usePlayerStore((s) => s.markOnWishlist);
  const markOffWishlist = usePlayerStore((s) => s.markOffWishlist);
  const onWishlist = liveOnWishlist || (props.initialOnWishlist ?? false);
  const [busy, setBusy] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const [pulseDir, setPulseDir] = useState<'on' | 'off' | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    const prefs = loadPreferences();
    try {
      if (onWishlist) {
        const qs = new URLSearchParams({
          itemType: 'a',
          bcAlbumId: String(props.bcAlbumId),
        });
        if (prefs.mirrorWishlistToBandcamp) qs.set('mirrorToBandcamp', '1');
        const res = await fetch(`/api/wishlist?${qs.toString()}`, { method: 'DELETE' });
        if (res.ok) {
          markOffWishlist('a', props.bcAlbumId);
          setPulseDir('off');
          setPulseKey((k) => k + 1);
        }
        return;
      }
      const res = await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemType: 'a',
          bcAlbumId: props.bcAlbumId,
          bcUrl: props.bcUrl,
          title: props.title,
          artistName: props.artistName,
          coverUrl: props.coverUrl,
          mirrorToBandcamp: prefs.mirrorWishlistToBandcamp,
        }),
      });
      if (res.ok) {
        markOnWishlist('a', props.bcAlbumId);
        setPulseDir('on');
        setPulseKey((k) => k + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  const filled = onWishlist;

  return (
    <Tooltip text={onWishlist ? 'Remove EP from wishlist' : 'Add EP to wishlist'} position="top">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label={onWishlist ? 'Remove EP from wishlist' : 'Add EP to wishlist'}
        aria-pressed={onWishlist}
        className={`relative flex h-9 w-9 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          filled
            ? 'text-accent hover:bg-bg-hover hover:text-fg-muted'
            : busy
              ? 'cursor-wait text-fg-muted'
              : 'text-fg-muted hover:bg-bg-hover hover:text-accent'
        }`}
      >
        {pulseDir === 'on' && pulseKey > 0 && (
          <span
            key={`ring-${pulseKey}`}
            aria-hidden
            className="anim-ring pointer-events-none absolute inset-1 rounded-full border-2 border-accent"
          />
        )}
        <svg
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
