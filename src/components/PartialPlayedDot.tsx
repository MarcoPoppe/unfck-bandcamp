'use client';

import Tooltip from './Tooltip';

interface Props {
  played: number;
  total: number;
}

/**
 * Half-filled circle indicating that some-but-not-all tracks of an album
 * have been played. Sits in the same slot as PlayedCheck so albums can
 * show one or the other. Tooltip is plain "N/M played" per Marco's spec.
 */
export default function PartialPlayedDot({ played, total }: Props) {
  return (
    <Tooltip text={`${played}/${total} played`} position="top">
    <span
      className="flex h-4 w-4 flex-none items-center justify-center text-fg-success"
      aria-label={`${played} of ${total} tracks played`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        {/* Full circle outline so the unplayed half stays visible. */}
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {/* Filled left half = played portion. Half-circle path keeps the
            shape resolution-independent (no stroke-dasharray hacks). */}
        <path
          d="M12 3 a9 9 0 0 0 0 18 z"
          fill="currentColor"
        />
      </svg>
    </span>
    </Tooltip>
  );
}
