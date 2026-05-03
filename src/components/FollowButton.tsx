'use client';

import { useEffect, useState } from 'react';
import Tooltip from './Tooltip';

type EntityType = 'artist' | 'label';

interface Props {
  entityType: EntityType;
  /** The Bandcamp URL identifying the entity. For artists this is any track
   * or album URL on the artist's subdomain (the API resolves the artist via
   * fetchArtistOverview). For labels the same shape is reused. */
  bcUrl: string;
  /** Optional initial state — set to true if the page loader already knows
   * the entity is followed, so the button doesn't briefly flash "follow". */
  initialFollowed?: boolean;
}

/**
 * Tiny inline follow-toggle. Marco wants a low-friction way to follow an
 * artist or a label straight from any track row, instead of having to open
 * the artist page first. The component starts in an unknown state and
 * asks /api/follow on first click; subsequent clicks show the persisted
 * state.
 */
export default function FollowButton({ entityType, bcUrl, initialFollowed }: Props) {
  const [followed, setFollowed] = useState(initialFollowed ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every successful toggle so the icon SVG remounts and the
  // pop animation re-fires. 0 means "no toggle yet this session" — keeps
  // the initial paint static.
  const [pulseKey, setPulseKey] = useState(0);

  // No initial GET — would explode the request budget for lists with many
  // rows. We start optimistic-not-followed; the API tells us the truth on
  // first click via `alreadyFollowed`.
  useEffect(() => {
    if (initialFollowed != null) setFollowed(initialFollowed);
  }, [initialFollowed]);

  async function toggleFollow() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (followed) {
        // Unfollow needs the local entityId — fetch the current follow list,
        // find the matching row, then DELETE. This is cheap because the list
        // is bounded by the user's own follows.
        const listRes = await fetch('/api/follow');
        if (!listRes.ok) throw new Error('Could not load follows');
        const listJson = (await listRes.json()) as {
          artists?: { id: number; bcUrl: string }[];
          labels?: { id: number; bcUrl: string }[];
        };
        const pool =
          (entityType === 'artist' ? listJson.artists : listJson.labels) ?? [];
        const wanted = artistBaseFromUrl(bcUrl);
        const match = pool.find(
          (e) => e.bcUrl === wanted || e.bcUrl === bcUrl,
        );
        if (!match) {
          setFollowed(false);
          return;
        }
        const qs = new URLSearchParams({
          entityType,
          entityId: String(match.id),
        });
        const res = await fetch(`/api/follow?${qs.toString()}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`Unfollow failed (${res.status})`);
        setFollowed(false);
        setPulseKey((k) => k + 1);
      } else {
        const res = await fetch('/api/follow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityType, bcUrl: artistBaseFromUrl(bcUrl) }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? 'Follow failed');
        setFollowed(true);
        setPulseKey((k) => k + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Follow toggle failed');
    } finally {
      setBusy(false);
    }
  }

  const label = entityType === 'artist' ? 'artist' : 'label';
  return (
    <Tooltip text={error ?? (followed ? `Unfollow ${label}` : `Follow ${label}`)} position="top">
      <button
        type="button"
        onClick={toggleFollow}
        disabled={busy}
        aria-label={followed ? `Unfollow ${label}` : `Follow ${label}`}
        aria-pressed={followed}
        className={`flex h-7 w-7 flex-none items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
          followed
            ? 'bg-accent/20 text-accent hover:bg-accent/30'
            : 'text-fg-muted hover:bg-bg-hover hover:text-accent'
        }`}
      >
        <span
          // Key remount restarts the pop animation on each successful
          // toggle. The initial render (pulseKey=0) gets no animation.
          key={`pulse-${pulseKey}`}
          aria-hidden
          className={`flex items-center justify-center ${
            pulseKey === 0 ? '' : 'anim-pop-soft'
          }`}
        >
          {entityType === 'artist'
            ? (followed ? <ArtistFollowedIcon /> : <ArtistFollowIcon />)
            : (followed ? <LabelFollowedIcon /> : <LabelFollowIcon />)}
        </span>
      </button>
    </Tooltip>
  );
}

// User silhouette + plus, indicates "follow this artist".
function ArtistFollowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  );
}

// User silhouette + check, "you follow this artist".
function ArtistFollowedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="17 11 19 13 23 9" />
    </svg>
  );
}

// Tag + plus, indicates "follow this label". Tag conveys "imprint / brand"
// which differentiates clearly from the user-shaped artist icon.
function LabelFollowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7v6.59a1 1 0 0 0 .29.7l8.42 8.42a1 1 0 0 0 1.41 0l6.59-6.59a1 1 0 0 0 0-1.41L11.29 6.29a1 1 0 0 0-.7-.29H4a1 1 0 0 0-1 1z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
      <line x1="18" y1="3" x2="18" y2="7" />
      <line x1="20" y1="5" x2="16" y2="5" />
    </svg>
  );
}

// Tag + check, "you follow this label".
function LabelFollowedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7v6.59a1 1 0 0 0 .29.7l8.42 8.42a1 1 0 0 0 1.41 0l6.59-6.59a1 1 0 0 0 0-1.41L11.29 6.29a1 1 0 0 0-.7-.29H4a1 1 0 0 0-1 1z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
      <polyline points="15 4 17 6 21 2" />
    </svg>
  );
}

/** Strip the path off a track/album URL to get the artist (or label) base
 * URL that /api/follow expects. */
function artistBaseFromUrl(bcUrl: string): string {
  try {
    const u = new URL(bcUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return bcUrl;
  }
}
