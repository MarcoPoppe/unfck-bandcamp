'use client';

import { useState } from 'react';
import { usePlayerStore } from '@/lib/store/player';
import Tooltip from './Tooltip';

interface Props {
  /** Local tracks.id when known. Required to delete plays server-side.
   * If null, the user can still see the check but can't unmark it. */
  trackId: number | null;
  /** BC track id used to update the live played-set in the player store. */
  bcTrackId: number | null;
  /** Tooltip override (e.g. "All N tracks heard" for albums). */
  tooltip?: string;
}

/**
 * Green "you've heard this" checkmark. Clicking it deletes all track_plays
 * for the track (server-side) and removes the bc_track_id from the live
 * played-set so the check disappears immediately. Marco's WhatsApp-style
 * "mark as unread" pattern: the user reclaims a track they want to revisit.
 */
export default function PlayedCheck({ trackId, bcTrackId, tooltip }: Props) {
  const markUnplayed = usePlayerStore((s) => s.markUnplayed);
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || trackId == null || trackId <= 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/plays?trackId=${trackId}`, { method: 'DELETE' });
      if (res.ok && bcTrackId != null) markUnplayed(bcTrackId);
    } finally {
      setBusy(false);
    }
  }

  const canUnmark = trackId != null && trackId > 0;
  const finalTitle = canUnmark
    ? `${tooltip ?? "You've listened to this one"} — click to mark as unplayed`
    : (tooltip ?? "You've listened to this one");

  return (
    <Tooltip text={finalTitle} position="top">
      <button
        type="button"
        onClick={handleClick}
        disabled={!canUnmark || busy}
        className="flex h-4 w-4 flex-none items-center justify-center text-fg-success transition-opacity hover:opacity-60 disabled:cursor-default disabled:hover:opacity-100 anim-pop-in"
        aria-label={canUnmark ? 'Mark as unplayed' : 'Listened'}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* anim-stroke-draw rolls the dashoffset from 30 → 0 so the
              check draws itself left-to-right. The dasharray sticks to
              30 after the animation, which is fine because the path
              length is much shorter than that, so the line stays solid. */}
          <path d="M20 6 9 17l-5-5" className="anim-stroke-draw" />
        </svg>
      </button>
    </Tooltip>
  );
}
