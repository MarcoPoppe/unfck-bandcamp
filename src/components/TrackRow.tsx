'use client';

import type { ReactNode, CSSProperties } from 'react';
import Link from 'next/link';
import { usePlayerStore } from '@/lib/store/player';
import TrackActionsBar from './TrackActionsBar';
import PlayedCheck from './PlayedCheck';
import PartialPlayedDot from './PartialPlayedDot';
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
  discoveredViaBcFanId?: number | null;
  /** True for album/EP queue entries: StickyPlayerBar fetches the tracklist
   * on demand and replaces this entry with all tracks of the release.
   * Album-rows render minimal: no action-bar, only the trailing
   * tracks-expand toggle. Heart/playlist on a whole EP is parked as a
   * future feature (see project_unfck_bandcamp_ep_actions_idea memory). */
  albumExpand?: boolean;
  parentBcAlbumId?: number | null;
  labelName?: string | null;
  labelId?: number | null;
  labelBcUrl?: string | null;
  bpm?: number | null;
  releasedAt?: string | null;
  playlists?: { id: number; name: string }[];
  bcItemType?: 't' | 'a';
  partialPlayedFraction?: { played: number; total: number };
}

interface ReorderControls {
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

interface SelectableConfig {
  selected: boolean;
  onToggle: () => void;
  label?: string;
}

export interface TrackRowBadge {
  label: string;
  tone: 'accent' | 'success' | 'muted';
}

interface Props {
  track: TrackRowData;
  variant?: 'full' | 'compact';
  position?: number | null;
  reorderControls?: ReorderControls;
  selectable?: SelectableConfig;
  trailing?: ReactNode;
  expandedContent?: ReactNode;

  /** Action-bar gating. Defaults: Wishlist + Playlist + Follow are on,
   * Archive is on but auto-suppressed for non-library entries (see
   * `effectiveShowArchive` below). The BC external-link is always off
   * inside a row — it only lives on detail-page headers now. */
  showPlaylist?: boolean;
  showFollow?: boolean;
  showArchive?: boolean;

  hideAlbumColumn?: boolean;
  hideDuration?: boolean;
  titleHref?: string;
  badges?: TrackRowBadge[];
  onPlayOverride?: () => void;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatReleasedShort(s: string): string {
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return s;
  const d = new Date(ts);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

const BADGE_TONE_CLASSES: Record<TrackRowBadge['tone'], string> = {
  accent: 'bg-accent/15 text-accent border border-accent/40',
  success: 'bg-success/15 text-success border border-success/40',
  muted: 'bg-bg-elevated text-fg-secondary border border-border',
};

export default function TrackRow({
  track,
  variant = 'full',
  position = null,
  reorderControls,
  selectable,
  trailing,
  expandedContent,
  showPlaylist = true,
  showFollow = true,
  showArchive = true,
  hideAlbumColumn = false,
  hideDuration = false,
  titleHref,
  badges,
  onPlayOverride,
}: Props) {
  const isCurrent = usePlayerStore((s) => s.currentId === track.id);
  const isPlaying = usePlayerStore((s) => s.currentId === track.id && s.isPlaying);
  const toggle = usePlayerStore((s) => s.toggle);
  const hasBeenPlayedLive = usePlayerStore((s) =>
    track.bcTrackId != null ? s.playedBcTrackIds.has(track.bcTrackId) : false,
  );
  const showPlayed = track.hasBeenPlayed === true || hasBeenPlayedLive;

  const isCompact = variant === 'compact';
  const isAlbumRow = track.albumExpand === true;
  // Selectable always sits to the LEFT of the play button (matches the
  // Wishlist pattern Marco picked as the reference). Reorder arrows and
  // position numbers stay between play and cover.
  const hasPreLeading = !!selectable;
  const hasMidLeading = !!reorderControls || (position != null && !isCompact && !reorderControls);

  // Archive is implicitly suppressed for synthetic / discovered rows,
  // because there is no library row to mark archived. The caller can
  // still pass showArchive=false explicitly to suppress it elsewhere
  // (e.g. curator-collection where archive is irrelevant for foreign
  // tracks per Marco's spec). Net visibility:
  const isInLibrary = track.source === 'owned' && track.id > 0;
  const effectiveShowArchive = showArchive && isInLibrary;

  const resolvedTitleHref =
    titleHref ?? (track.bcTrackId ? `/track/${track.bcTrackId}` : null);

  // Grid template: [pre?] [play] [mid?] [cover-or-pos] [title] [album?]
  // [duration?] [actions?] [trailing?]. Album-rows skip the action slot
  // entirely. Mobile drops album+duration columns.
  const mobileParts: string[] = [];
  if (hasPreLeading) mobileParts.push('40px');
  mobileParts.push('40px'); // play
  if (hasMidLeading) mobileParts.push('40px');
  mobileParts.push(isCompact ? '40px' : '48px'); // cover / position
  mobileParts.push('minmax(0,1fr)'); // title
  if (!isAlbumRow) mobileParts.push('auto'); // actions
  if (trailing) mobileParts.push('auto');

  const smParts: string[] = [];
  if (hasPreLeading) smParts.push('40px');
  smParts.push('44px'); // play
  if (hasMidLeading) smParts.push('40px');
  smParts.push(isCompact ? '40px' : '56px');
  smParts.push('minmax(0,1fr)');
  if (!hideAlbumColumn && !isCompact) smParts.push('minmax(0,180px)');
  if (!hideDuration && !isCompact) smParts.push('60px');
  if (!isAlbumRow) smParts.push('auto');
  if (trailing) smParts.push('auto');

  const mobileTemplate = mobileParts.join(' ');
  const smTemplate = smParts.join(' ');

  return (
    <div
      className={`overflow-hidden rounded-lg border border-border bg-bg-surface transition-colors hover:bg-bg-hover ${
        isCurrent ? 'ring-1 ring-accent' : ''
      }`}
    >
      <div
        className={`group grid items-center gap-2 px-2 py-3 [grid-template-columns:var(--cols-mobile)] sm:gap-3 sm:px-4 sm:[grid-template-columns:var(--cols-sm)] ${
          isCurrent ? 'bg-bg-elevated' : ''
        }`}
        style={
          {
            '--cols-mobile': mobileTemplate,
            '--cols-sm': smTemplate,
          } as CSSProperties
        }
      >
        {/* Pre-play leading slot (selectable). Sits left of the play
            button so the checkbox is the first thing the eye lands on
            in multi-select contexts. */}
        {hasPreLeading && selectable && (
          <div className="flex h-full items-center justify-center">
            <input
              type="checkbox"
              checked={selectable.selected}
              onChange={selectable.onToggle}
              aria-label={selectable.label ?? 'Select track'}
              className="h-4 w-4 cursor-pointer accent-accent"
            />
          </div>
        )}

        {/* Play button */}
        <Tooltip
          text={
            !track.hasStream && (track.needsResolve || track.albumExpand || track.bcUrl)
              ? isAlbumRow
                ? 'Play (loads tracks first)'
                : 'Resolves on play (one BC roundtrip)'
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

        {/* Mid leading slot — reorder arrows or position number, between
            play and cover. Only one wins; selectable already lives in
            the pre-leading slot. */}
        {hasMidLeading && (
          <div className="flex h-full items-center justify-center">
            {reorderControls ? (
              <div className="flex flex-col items-center gap-0.5">
                <button
                  type="button"
                  onClick={reorderControls.onMoveUp}
                  disabled={!reorderControls.canMoveUp || !reorderControls.onMoveUp}
                  aria-label="Move up"
                  className="flex h-4 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 14l5-5 5 5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={reorderControls.onMoveDown}
                  disabled={!reorderControls.canMoveDown || !reorderControls.onMoveDown}
                  aria-label="Move down"
                  className="flex h-4 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 10l5 5 5-5z" />
                  </svg>
                </button>
              </div>
            ) : position != null ? (
              <span className="font-mono text-sm tabular-nums text-fg-muted">
                {position}
              </span>
            ) : null}
          </div>
        )}

        {/* Cover or compact-position column */}
        {isCompact ? (
          <div className="flex h-10 w-10 items-center justify-center font-mono text-sm tabular-nums text-fg-muted">
            {position ?? track.trackNumber ?? ''}
          </div>
        ) : track.bcTrackId ? (
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

        {/* Title block */}
        <div className="min-w-0">
          <div
            className={`flex items-center gap-2 truncate text-base font-semibold ${
              isCurrent ? 'text-accent' : 'text-fg-primary'
            }`}
          >
            {showPlayed ? (
              <PlayedCheck
                trackId={track.source !== 'discovered' ? track.id : null}
                bcTrackId={track.bcTrackId ?? null}
              />
            ) : track.partialPlayedFraction
                && track.partialPlayedFraction.played > 0
                && track.partialPlayedFraction.played < track.partialPlayedFraction.total ? (
              <PartialPlayedDot
                played={track.partialPlayedFraction.played}
                total={track.partialPlayedFraction.total}
              />
            ) : null}
            {resolvedTitleHref ? (
              <Link
                href={resolvedTitleHref}
                className="truncate hover:underline"
                title="Open track page (middle-click for new tab)"
              >
                {track.title}
              </Link>
            ) : (
              <span className="truncate">{track.title}</span>
            )}
            {badges?.map((b) => (
              <span
                key={b.label}
                className={`flex-none rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${BADGE_TONE_CLASSES[b.tone]}`}
              >
                {b.label}
              </span>
            ))}
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

        {/* Album column (sm+ only) */}
        {!isCompact && !hideAlbumColumn && (
          <div className="hidden truncate text-sm text-fg-muted sm:block">
            {track.albumTitle ?? ''}
          </div>
        )}

        {/* Duration (sm+ only) */}
        {!isCompact && !hideDuration && (
          <div className="hidden text-right font-mono text-xs text-fg-muted tabular-nums sm:block">
            {formatDuration(track.durationSeconds)}
          </div>
        )}

        {/* Action bar — suppressed for album/EP rows. The BC external-
            link icon is gone; it only lives on detail-page headers now. */}
        {!isAlbumRow && (
          <div className="flex items-center justify-end gap-1.5">
            <TrackActionsBar
              bcUrl={track.bcUrl}
              bcTrackId={track.bcTrackId ?? null}
              localTrackId={
                track.source === 'discovered' || track.id < 0 ? null : track.id
              }
              title={track.title}
              artistName={track.artistName}
              albumTitle={track.albumTitle}
              coverUrl={track.coverUrl}
              initialRating={track.rating ?? 0}
              initialArchived={!!track.archivedAt}
              showPlaylist={showPlaylist && track.source !== 'discovered'}
              showFollow={showFollow}
              showArchive={effectiveShowArchive}
              labelBcUrl={track.labelBcUrl ?? null}
            />
          </div>
        )}

        {/* Trailing slot (album-expand toggle, remove button, etc.) */}
        {trailing && (
          <div className="flex items-center justify-end">{trailing}</div>
        )}
      </div>

      {/* Expanded content — sits inside the same card so the visual
          grouping holds. Used to render expanded album tracklists under
          a curator-collection album row. */}
      {expandedContent && (
        <div className="border-t border-border bg-bg-elevated/40">
          {expandedContent}
        </div>
      )}
    </div>
  );
}
