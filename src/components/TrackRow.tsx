'use client';

import Link from 'next/link';
import { usePlayerStore } from '@/lib/store/player';
import WishlistButton from './WishlistButton';
import AddToPlaylistButton from './AddToPlaylistButton';
import CurationButtons from './CurationButtons';
import FollowButton from './FollowButton';
import PlayedCheck from './PlayedCheck';
import PlaylistMembershipBadge from './PlaylistMembershipBadge';
import Tooltip from './Tooltip';

export interface TrackRowData {
  /**
   * Stable identifier inside the player queue. For tracks already imported
   * locally this is `tracks.id` (a small positive integer). For lazy items
   * coming from a curator collection / best-of / wishlist that haven't been
   * imported yet, this is a synthetic negative id (`-bcItemId`) so the
   * player can keep them in queue order; before playback they are resolved
   * by StickyPlayerBar via /api/track/lookup which then calls replaceTrack
   * to swap the synthetic entry with a real local id.
   */
  id: number;
  title: string;
  artistName: string | null;
  albumTitle: string | null;
  durationSeconds: number | null;
  trackNumber: number | null;
  coverUrl: string | null;
  bcUrl: string;
  hasStream: boolean;
  bcTrackId?: number;
  source?: 'owned' | 'discovered';
  rating?: -1 | 0 | 1;
  archivedAt?: string | null;
  hasBeenPlayed?: boolean;
  /** True when this entry needs a /api/track/lookup before it can stream. */
  needsResolve?: boolean;
  /** Discover-only: who surfaced this track ("via leonlicht"). */
  discoveredVia?: string | null;
  discoveredViaName?: string | null;
  /** When the surfacing source is a curator, their bc_fan_id so the UI
   * can link the "via Leon Licht" tag to /digger/[id]. */
  discoveredViaBcFanId?: number | null;
  /** True for album/EP queue entries: StickyPlayerBar fetches the tracklist
   * on demand and replaces this entry with all tracks of the release. */
  albumExpand?: boolean;
  /** When set, the track originated from an expanded album/EP. UI lists
   * use this to auto-expand the parent row when the player advances into
   * its tracks. */
  parentBcAlbumId?: number | null;
  labelName?: string | null;
  labelId?: number | null;
  labelBcUrl?: string | null;
  /** Detected BPM if known (from prior playback). null until the analyzer
   * has produced a stable reading for this track. */
  bpm?: number | null;
  /** Original release date as Bandcamp reports it. ISO 8601 string or
   * RFC-1123 — we render leniently. Only set on tracks imported after
   * migration 16, older rows stay null until they pass through a fresh
   * lookup. */
  releasedAt?: string | null;
  /** Playlists this track sits in. Annotated by page loaders, not stored
   * on the track row itself. Empty array when none. */
  playlists?: { id: number; name: string }[];
}

interface Props {
  track: TrackRowData;
  /**
   * Optional override for the play button. When set, the row calls this
   * instead of `toggle(track.id)`. Used when the row sits inside a
   * release-tracklist that needs to swap the player queue to the album's
   * own tracks before toggling, instead of using whatever queue the page
   * shell pre-set.
   */
  onPlayOverride?: () => void;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** dd.mm.yyyy if the date parses, raw string otherwise. Compact enough
 * to fit the row's metadata stack alongside artist + label. */
function formatReleasedShort(s: string): string {
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return s;
  const d = new Date(ts);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export default function TrackRow({ track, onPlayOverride }: Props) {
  const isCurrent = usePlayerStore((s) => s.currentId === track.id);
  const isPlaying = usePlayerStore((s) => s.currentId === track.id && s.isPlaying);
  const toggle = usePlayerStore((s) => s.toggle);
  // Combine server-side hasBeenPlayed (from page load) with the live in-store
  // set so the green checkmark lights up the moment a track passes the 1s
  // threshold during the current session, without waiting for a reload.
  const hasBeenPlayedLive = usePlayerStore((s) =>
    track.bcTrackId != null ? s.playedBcTrackIds.has(track.bcTrackId) : false,
  );
  const showPlayed = track.hasBeenPlayed === true || hasBeenPlayedLive;

  return (
    <div
      className={`group grid grid-cols-[40px_48px_minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-2 py-3 transition-colors hover:bg-bg-hover sm:grid-cols-[44px_56px_minmax(0,1fr)_minmax(0,180px)_60px_auto] sm:gap-3 sm:px-4 ${
        isCurrent ? 'bg-bg-elevated' : 'bg-bg-surface'
      }`}
    >
      <Tooltip
        text={
          !track.hasStream && (track.needsResolve || track.albumExpand || track.bcUrl)
            ? 'Resolves on play (one BC roundtrip)'
            : isPlaying
              ? 'Pause (Space)'
              : 'Play (Space)'
        }
        position="top"
      >
        <button
          type="button"
          onClick={() => (onPlayOverride ? onPlayOverride() : toggle(track.id))}
          disabled={
            !track.hasStream
            && !track.needsResolve
            && !track.albumExpand
            && !track.bcUrl
          }
          className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30 ${
            isCurrent
              ? 'border-accent bg-accent text-fg-on-accent hover:bg-accent-hover'
              : 'border-border text-fg-secondary hover:border-accent hover:text-accent'
          }`}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </Tooltip>
      {track.bcTrackId ? (
        <Link
          href={`/track/${track.bcTrackId}`}
          className="flex-none"
          title="Open track page (middle-click for new tab)"
        >
          {track.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={track.coverUrl}
              alt=""
              className="h-12 w-12 rounded object-cover sm:h-14 sm:w-14"
              loading="lazy"
            />
          ) : (
            <div className="h-12 w-12 rounded bg-bg-elevated sm:h-14 sm:w-14" />
          )}
        </Link>
      ) : track.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={track.coverUrl}
          alt=""
          className="h-12 w-12 rounded object-cover sm:h-14 sm:w-14"
          loading="lazy"
        />
      ) : (
        <div className="h-12 w-12 rounded bg-bg-elevated sm:h-14 sm:w-14" />
      )}
      <div className="min-w-0">
        <div
          className={`flex items-center gap-2 truncate text-base font-semibold ${
            isCurrent ? 'text-accent' : 'text-fg-primary'
          }`}
        >
          {showPlayed && (
            <PlayedCheck
              trackId={track.source !== 'discovered' ? track.id : null}
              bcTrackId={track.bcTrackId ?? null}
            />
          )}
          {track.bcTrackId ? (
            <Link
              href={`/track/${track.bcTrackId}`}
              className="truncate hover:underline"
              title="Open track page (middle-click for new tab)"
            >
              {track.title}
            </Link>
          ) : (
            <span className="truncate">{track.title}</span>
          )}
          <PlaylistMembershipBadge
            trackId={track.source !== 'discovered' ? track.id : null}
            playlists={track.playlists}
          />
        </div>
        {track.artistName ? (
          track.bcUrl ? (
            <a
              href={`/artist/go?url=${encodeURIComponent(track.bcUrl)}`}
              className="block truncate text-sm text-fg-secondary hover:text-accent hover:underline"
              title="Open artist page (middle-click for new tab)"
            >
              {track.artistName}
            </a>
          ) : (
            <div className="truncate text-sm text-fg-secondary">{track.artistName}</div>
          )
        ) : (
          <div className="truncate text-sm text-fg-muted">unknown artist</div>
        )}
        {track.discoveredViaName && (
          <div className="truncate text-xs text-fg-secondary" title={`Discovered via ${track.discoveredViaName}`}>
            <span className="text-fg-muted">via</span>{' '}
            {track.discoveredViaBcFanId ? (
              <Link
                href={`/digger/${track.discoveredViaBcFanId}`}
                className="hover:text-accent hover:underline"
              >
                {track.discoveredViaName}
              </Link>
            ) : (
              track.discoveredViaName
            )}
          </div>
        )}
        {track.labelName &&
          (track.labelId != null ? (
            <a
              href={`/label/${track.labelId}`}
              className="block truncate text-xs text-fg-muted hover:text-accent hover:underline"
              title={`Label: ${track.labelName} (middle-click for new tab)`}
            >
              <span className="opacity-60">on</span> {track.labelName}
            </a>
          ) : (
            <div className="truncate text-xs text-fg-muted" title={`Label: ${track.labelName}`}>
              <span className="opacity-60">on</span> {track.labelName}
            </div>
          ))}
        {track.releasedAt && (
          <div className="truncate text-xs text-fg-muted" title={`Released ${track.releasedAt}`}>
            <span className="opacity-60">released</span> {formatReleasedShort(track.releasedAt)}
          </div>
        )}
      </div>
      <div className="hidden truncate text-sm text-fg-muted sm:block">
        {track.albumTitle ?? ''}
      </div>
      <div className="hidden text-right font-mono text-xs text-fg-muted tabular-nums sm:block">
        {formatDuration(track.durationSeconds)}
      </div>
      <div className="flex items-center justify-end gap-1.5">
        {/* Order: Like (Heart) → Playlist (Music note) → Follow (Person+) → Archive. */}
        {track.bcTrackId ? (
          <WishlistButton
            bcTrackId={track.bcTrackId}
            bcUrl={track.bcUrl}
            title={track.title}
            artistName={track.artistName}
            albumTitle={track.albumTitle}
            coverUrl={track.coverUrl}
          />
        ) : (
          <span
            className="flex h-9 w-9 items-center justify-center text-fg-muted opacity-30"
            aria-hidden="true"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </span>
        )}
        {/* Add-to-playlist only targets the local `tracks` table; for
            discovered rows track.id is a discovered_tracks id, so passing it
            would write to the wrong record. Hide for discovered. */}
        {track.source !== 'discovered' && <AddToPlaylistButton trackId={track.id} />}
        {track.bcUrl && <FollowButton entityType="artist" bcUrl={track.bcUrl} />}
        {track.labelBcUrl && (
          <FollowButton entityType="label" bcUrl={track.labelBcUrl} />
        )}
        {track.source !== 'discovered' && (
          <CurationButtons
            trackId={track.id}
            initialRating={track.rating ?? 0}
            initialArchived={!!track.archivedAt}
            showArchive
          />
        )}
        <Tooltip text="Open on bandcamp.com" position="top">
        <a
          href={track.bcUrl}
          target="_blank"
          rel="noreferrer"
          className="flex h-9 w-9 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Open on bandcamp.com"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 3h7v7M10 14L21 3M21 14v7H3V3h7" />
          </svg>
        </a>
        </Tooltip>
      </div>
    </div>
  );
}
