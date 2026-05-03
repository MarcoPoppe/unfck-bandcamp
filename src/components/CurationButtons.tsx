'use client';

import { useState } from 'react';
import Tooltip from './Tooltip';

type Rating = -1 | 0 | 1;

interface Props {
  trackId: number;
  /** Kept in props for backwards compat with callers — currently unused
   * since like/dislike was removed from the UI. The DB column stays so the
   * setting can be revived later without a migration. */
  initialRating?: Rating;
  initialArchived?: boolean;
  showArchive?: boolean;
}

export default function CurationButtons({
  trackId,
  initialArchived = false,
  showArchive = false,
}: Props) {
  const [archived, setArchived] = useState(initialArchived);
  const [busy, setBusy] = useState(false);

  async function toggleArchive() {
    if (busy) return;
    const next = !archived;
    setArchived(next);
    setBusy(true);
    try {
      const res = await fetch('/api/tracks/curation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackId,
          action: next ? 'archive' : 'unarchive',
        }),
      });
      if (!res.ok) setArchived(!next);
    } catch {
      setArchived(!next);
    } finally {
      setBusy(false);
    }
  }

  if (!showArchive) return null;

  return (
    <Tooltip text={archived ? 'Unarchive' : 'Archive (hide from library)'} position="top">
      <button
        type="button"
        onClick={toggleArchive}
        disabled={busy}
        aria-label={archived ? 'Unarchive track' : 'Archive track'}
        aria-pressed={archived}
        className={`flex h-9 w-9 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          archived
            ? 'text-fg-warning'
            : 'text-fg-muted hover:bg-bg-hover hover:text-fg-warning'
        }`}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="20" height="5" rx="1" />
          <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4" />
        </svg>
      </button>
    </Tooltip>
  );
}
