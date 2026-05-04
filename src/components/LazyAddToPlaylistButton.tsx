'use client';

import { useState } from 'react';
import AddToPlaylistButton from './AddToPlaylistButton';
import Tooltip from './Tooltip';

interface Props {
  /** Library track id when known (positive int). null/undefined means
   * the track has to be looked up + imported on first click. */
  trackId: number | null;
  bcTrackId?: number;
  bcUrl: string;
}

/**
 * Wraps AddToPlaylistButton with a lazy-resolve fallback. When the
 * caller doesn't know a localTrackId (synthetic queue rows from a
 * curator collection, discovered feed, sticky player playing a
 * not-yet-imported track), the first click runs /api/track/lookup,
 * caches the resolved id, then renders the real button so subsequent
 * clicks skip the lookup. Mirrors the pattern in TrackActionsBar but
 * usable standalone outside an action-bar.
 */
export default function LazyAddToPlaylistButton({
  trackId,
  bcTrackId,
  bcUrl,
}: Props) {
  const [resolved, setResolved] = useState<number | null>(trackId);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ensure(): Promise<number | null> {
    if (resolved != null) return resolved;
    if (resolving) return null;
    setResolving(true);
    setError(null);
    try {
      const res = await fetch('/api/track/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: bcUrl && bcUrl.length > 0 ? bcUrl : String(bcTrackId ?? ''),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        result?: { trackId: number };
        error?: string;
      };
      if (!res.ok || !json.ok || !json.result) {
        setError(json.error ?? 'Could not import track');
        return null;
      }
      setResolved(json.result.trackId);
      return json.result.trackId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
      return null;
    } finally {
      setResolving(false);
    }
  }

  if (resolved != null) {
    return <AddToPlaylistButton trackId={resolved} />;
  }

  return (
    <Tooltip
      text={error ?? 'Add to playlist (imports the track first)'}
      position="top"
    >
      <button
        type="button"
        onClick={ensure}
        disabled={resolving}
        aria-label="Add to playlist"
        className="flex h-9 w-9 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path
            d="M9 17V5l10-2v12"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="6" cy="17" r="3" />
          <circle cx="16" cy="15" r="3" />
        </svg>
      </button>
    </Tooltip>
  );
}
