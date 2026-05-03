'use client';

import Link from 'next/link';
import { usePlayerStore } from '@/lib/store/player';

interface Props {
  /** Local tracks.id. When provided, the badge subscribes to the live
   * membership map in the player store and re-renders whenever the user
   * adds or removes the track from a playlist via the dropdown — no page
   * refresh needed. When null/undefined the badge falls back to the
   * `playlists` prop only (used during SSR before hydration, or for
   * lazy/discovery rows that have no local id yet). */
  trackId?: number | null;
  /** Server-rendered playlist list, used as the initial value before the
   * store hydrates and as a fallback when `trackId` is null. */
  playlists?: { id: number; name: string }[];
}

/**
 * Compact "in N playlists" pill rendered next to a track title. Shows a
 * music-note glyph plus the count. Tooltip lists the playlist names.
 * Clicking opens the first playlist. Hidden entirely when the track is in
 * zero playlists.
 */
export default function PlaylistMembershipBadge({ trackId, playlists }: Props) {
  // Subscribe to the live store entry only when we have a local id;
  // otherwise the prop value is the only thing we can show.
  const live = usePlayerStore((s) =>
    trackId != null ? s.playlistMembershipByTrackId.get(trackId) : undefined,
  );
  // Pick live state if the store has hydrated for this track. The store
  // hydrates the FULL membership map on mount, so once `setPlaylistMembershipMap`
  // has run we know that an absent entry means "in zero playlists" — not
  // "not yet hydrated".
  const hydrated = usePlayerStore((s) => s.playlistMembershipByTrackId);
  const list =
    trackId != null
      ? live ?? (hydrated.size > 0 ? [] : playlists ?? [])
      : playlists ?? [];
  if (list.length === 0) return null;
  const tooltip = list.map((p) => p.name).join(', ');
  const target = list[0];
  return (
    <Link
      href={`/playlists/${target.id}`}
      title={`In ${list.length} playlist${list.length === 1 ? '' : 's'}: ${tooltip}`}
      aria-label={`In ${list.length} playlist${list.length === 1 ? '' : 's'}`}
      className="inline-flex flex-none items-center gap-1 rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-[11px] leading-none text-fg-secondary transition-colors hover:border-accent hover:text-accent"
      onClick={(e) => e.stopPropagation()}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M9 17V5l10-2v12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6" cy="17" r="3" />
        <circle cx="16" cy="15" r="3" />
      </svg>
      <span>{list.length}</span>
    </Link>
  );
}
