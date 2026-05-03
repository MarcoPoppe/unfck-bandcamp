'use client';

import { useState } from 'react';
import CurationButtons from './CurationButtons';
import WishlistButton from './WishlistButton';
import AddToPlaylistButton from './AddToPlaylistButton';
import FollowButton from './FollowButton';

interface Props {
  bcUrl: string;
  /** Bandcamp track id when known. null for album items. */
  bcTrackId: number | null;
  /** Local tracks.id when the track is already imported. */
  localTrackId: number | null;
  /** Track / album metadata used by the wishlist insertion API. */
  title: string;
  artistName: string | null;
  albumTitle: string | null;
  coverUrl: string | null;
  initialRating?: -1 | 0 | 1;
  initialArchived?: boolean;
  showArchive?: boolean;
  /** Show the add-to-playlist plus button. Best-of and curator lists set
   * this to false because curation there is overkill. */
  showPlaylist?: boolean;
  /** Show inline follow buttons for the artist (and label, if known). */
  showFollow?: boolean;
  labelBcUrl?: string | null;
}

/**
 * Unified action bar that exposes the same like / dislike / wishlist /
 * tag+playlist controls everywhere a track row appears. If the track isn't
 * yet imported into the local DB, the first action click runs a lookup to
 * resolve a localTrackId, then performs the action. Subsequent actions on
 * the same row reuse the resolved id.
 *
 * This replaces the previous pattern of building parallel action subsets in
 * each list (curator collection, best-of, wishlist, etc.) and gives the user
 * the same set of affordances on every track everywhere.
 */
export default function TrackActionsBar(props: Props) {
  const [localTrackId, setLocalTrackId] = useState<number | null>(props.localTrackId);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ensureResolved(): Promise<number | null> {
    if (localTrackId != null) return localTrackId;
    if (resolving) return null;
    setResolving(true);
    setError(null);
    try {
      // bcUrl resolves more reliably than the numeric BC track-id (which
      // goes through Bandcamp's mobile tralbum_details endpoint and 404s on
      // some tracks). Fall back to id only when no URL is known.
      const res = await fetch('/api/track/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input:
            props.bcUrl && props.bcUrl.length > 0
              ? props.bcUrl
              : String(props.bcTrackId ?? ''),
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
      setLocalTrackId(json.result.trackId);
      return json.result.trackId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
      return null;
    } finally {
      setResolving(false);
    }
  }

  const showPlaylist = props.showPlaylist ?? true;
  const showFollow = props.showFollow ?? false;

  return (
    <div className="flex items-center gap-1.5">
      {/* Order: Like (Heart) → Playlist (Music note) → Follow (Person+) → Archive.
          Marco's rule: the three primary curation actions are like / playlist /
          follow, in that visual sequence. Archive is secondary and trails. */}

      {/* Like / wishlist: works without local resolution because it stores by bcTrackId. */}
      {props.bcTrackId != null && (
        <WishlistButton
          bcTrackId={props.bcTrackId}
          bcUrl={props.bcUrl}
          title={props.title}
          artistName={props.artistName}
          albumTitle={props.albumTitle}
          coverUrl={props.coverUrl}
        />
      )}

      {/* Add-to-playlist: needs a local trackId; lazy-resolve same as curation.
          Hidden in best-of / curator lists where it's overkill. */}
      {showPlaylist &&
        (localTrackId != null ? (
          <AddToPlaylistButton trackId={localTrackId} />
        ) : (
          <LazyPlaylistStub onResolve={ensureResolved} resolving={resolving} />
        ))}

      {/* Follow artist + (optional) label. Both buttons hit /api/follow which
          accepts a bcUrl directly and resolves the entity server-side. */}
      {showFollow && <FollowButton entityType="artist" bcUrl={props.bcUrl} />}
      {showFollow && props.labelBcUrl && (
        <FollowButton entityType="label" bcUrl={props.labelBcUrl} />
      )}

      {/* Archive (secondary). */}
      {localTrackId != null ? (
        <CurationButtons
          trackId={localTrackId}
          initialRating={props.initialRating ?? 0}
          initialArchived={props.initialArchived ?? false}
          showArchive={props.showArchive}
        />
      ) : props.showArchive ? (
        <LazyArchiveStub onResolve={ensureResolved} resolving={resolving} />
      ) : null}

      {error && (
        <span
          className="ml-2 truncate text-xs text-fg-danger"
          title={error}
          style={{ maxWidth: 140 }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

function LazyArchiveStub({
  onResolve,
  resolving,
}: {
  onResolve: () => Promise<number | null>;
  resolving: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onResolve}
      disabled={resolving}
      title="Archive (imports the track first)"
      aria-label="Archive"
      className="flex h-9 w-9 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="5" rx="1" />
        <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4" />
      </svg>
    </button>
  );
}

function LazyPlaylistStub({
  onResolve,
  resolving,
}: {
  onResolve: () => Promise<number | null>;
  resolving: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onResolve}
      disabled={resolving}
      title="Manage playlists (imports the track first)"
      aria-label="Manage playlists"
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
  );
}
