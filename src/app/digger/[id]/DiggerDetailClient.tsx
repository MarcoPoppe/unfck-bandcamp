'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Virtuoso } from 'react-virtuoso';
import StickyPlayerBar from '@/components/StickyPlayerBar';
import TrackRow from '@/components/TrackRow';
import HidePlayedToggle from '@/components/HidePlayedToggle';
import ActiveBadge from '@/components/ActiveBadge';
import OpenOnBandcampButton from '@/components/OpenOnBandcampButton';
import TrackListSearch from '@/components/TrackListSearch';
import type { ActivitySnapshot } from '@/lib/library/activity';
import { usePreferences } from '@/lib/settings/preferences';
import type { DiggerDetail } from '@/lib/sync/diggers';
import { loadPreferences } from '@/lib/settings/preferences';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts, useCurationShortcuts } from '@/lib/store/hooks';
import type { TrackRowData, TrackRowBadge } from '@/components/TrackRow';

interface CollectionItem {
  bcItemId: number;
  bcItemType: 'a' | 't';
  bcUrl: string;
  title: string;
  artistName: string | null;
  coverUrl: string | null;
  isOwnedByYou: boolean;
  hasBeenPlayed?: boolean;
  labelId?: number | null;
  labelName?: string | null;
  labelBcUrl?: string | null;
  /** For album items: bc_track_ids of the EP that exist in the local
   * tracks table. Used by the live "fully heard" check so the green
   * check can light up the moment the last track finishes, without a
   * page reload. */
  knownTrackBcIds?: number[];
}

interface DiggerAlbumTrack {
  trackId: number;
  bcTrackId: number;
  title: string;
  artistName: string | null;
  durationSeconds: number | null;
  trackNumber: number | null;
  bcUrl: string;
  hasStream: boolean;
  coverUrl: string | null;
  hasBeenPlayed: boolean;
}

interface DiggerStats {
  bio: string | null;
  location: string | null;
  websiteUrl: string | null;
  followersCount: number | null;
  followingBandsCount: number | null;
  itemCount: number | null;
}

interface CrawlStatus {
  diggerId: number;
  startedAt: string | null;
  finishedAt: string | null;
  status: 'running' | 'success' | 'error' | null;
  itemsCrawled: number;
  itemsTotalKnown: number | null;
  errorMessage: string | null;
}

interface Props {
  detail: DiggerDetail;
  stats: DiggerStats;
  activity?: ActivitySnapshot;
  collectionItems: CollectionItem[];
  profileError: string | null;
  crawlStatus?: CrawlStatus;
  /**
   * When true, the curator is not (yet) persisted in our DB. Ignore is
   * disabled, Follow turns into a one-shot upsert+follow.
   */
  ephemeral?: boolean;
}

export default function DiggerDetailClient({
  detail,
  stats,
  activity,
  collectionItems,
  profileError,
  crawlStatus,
  ephemeral = false,
}: Props) {
  const [crawling, setCrawling] = useState(false);
  const [crawlMessage, setCrawlMessage] = useState<string | null>(null);

  async function runFullCrawl() {
    if (!detail.bcFanId) {
      setCrawlMessage('No fan id available; cannot crawl this curator.');
      return;
    }
    setCrawling(true);
    setCrawlMessage(null);
    try {
      // Pass the profile data we already fetched on the page so the server
      // can upsert the curator without another BC roundtrip when this is
      // the first crawl on /u/[username].
      const res = await fetch(`/api/digger/${detail.bcFanId}/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bcUsername: detail.bcUsername,
          displayName: detail.displayName,
          imageUrl: detail.imageUrl,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        itemsCrawled?: number;
        itemsTotalKnown?: number | null;
        durationMs?: number;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setCrawlMessage(json.error ?? `Crawl failed (${res.status})`);
      } else {
        const seconds = ((json.durationMs ?? 0) / 1000).toFixed(1);
        setCrawlMessage(
          `Crawled ${json.itemsCrawled ?? 0}${
            json.itemsTotalKnown ? `/${json.itemsTotalKnown}` : ''
          } items in ${seconds}s`,
        );
        // Reload to show the persisted collection.
        window.location.reload();
      }
    } catch (err) {
      setCrawlMessage(err instanceof Error ? err.message : 'Crawl failed');
    } finally {
      setCrawling(false);
    }
  }
  const router = useRouter();
  const [followed, setFollowed] = useState(detail.isFollowed);
  const [ignored, setIgnored] = useState(detail.isIgnored);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleFollow() {
    setBusy(true);
    setMessage(null);
    try {
      const prefs = loadPreferences();
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'digger',
          bcUrl: `https://bandcamp.com/${detail.bcUsername}`,
          mirrorToBandcamp: prefs.mirrorFollowsToBandcamp,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        bcMirrorWarning?: string | null;
      };
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? `Follow failed (${res.status})`);
      } else {
        setFollowed(true);
        if (json.bcMirrorWarning) setMessage(json.bcMirrorWarning);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleUnfollow() {
    setBusy(true);
    setMessage(null);
    try {
      const listRes = await fetch('/api/follow');
      if (!listRes.ok) throw new Error(`follow list failed (${listRes.status})`);
      const listJson = (await listRes.json()) as {
        curators?: { id: number; bcUsername: string }[];
      };
      const match = listJson.curators?.find((d) => d.bcUsername === detail.bcUsername);
      if (!match) {
        setFollowed(false);
        return;
      }
      const prefs = loadPreferences();
      const qs = new URLSearchParams({
        entityType: 'digger',
        entityId: String(match.id),
      });
      if (prefs.mirrorFollowsToBandcamp) qs.set('mirrorToBandcamp', '1');
      const res = await fetch(`/api/follow?${qs.toString()}`, { method: 'DELETE' });
      if (res.ok) {
        setFollowed(false);
        router.refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unfollow failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleIgnore() {
    if (ephemeral) {
      setMessage('Follow this curator first to ignore them.');
      return;
    }
    setBusy(true);
    setMessage(null);
    const next = !ignored;
    try {
      const res = await fetch(`/api/diggers/${detail.diggerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: next ? 'ignore' : 'unignore' }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? `Action failed (${res.status})`);
      } else {
        setIgnored(next);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const setQueue = usePlayerStore((s) => s.setQueue);
  const togglePlayer = usePlayerStore((s) => s.toggle);
  const playerCurrentId = usePlayerStore((s) => s.currentId);
  const playerIsPlaying = usePlayerStore((s) => s.isPlaying);
  const playerQueue = usePlayerStore((s) => s.queue);
  const playedBcTrackIds = usePlayerStore((s) => s.playedBcTrackIds);
  useGlobalPlaybackShortcuts();
  useCurationShortcuts();

  // EP-aufklappen: same shape as best-of. Tracklist comes from /api/album/by-url.
  const [expandedAlbumId, setExpandedAlbumId] = useState<number | null>(null);
  const [albumTracksCache, setAlbumTracksCache] = useState<Map<number, DiggerAlbumTrack[]>>(
    new Map(),
  );
  const [albumLoadingId, setAlbumLoadingId] = useState<number | null>(null);
  const [albumLoadError, setAlbumLoadError] = useState<string | null>(null);

  async function toggleAlbumExpand(item: CollectionItem) {
    if (expandedAlbumId === item.bcItemId) {
      setExpandedAlbumId(null);
      return;
    }
    setExpandedAlbumId(item.bcItemId);
    if (albumTracksCache.has(item.bcItemId)) return;
    setAlbumLoadingId(item.bcItemId);
    setAlbumLoadError(null);
    try {
      const res = await fetch(
        `/api/album/by-url?url=${encodeURIComponent(item.bcUrl)}`,
      );
      const json = (await res.json()) as {
        ok?: boolean;
        tracks?: DiggerAlbumTrack[];
        error?: string;
      };
      if (!res.ok || !json.ok || !json.tracks) {
        setAlbumLoadError(json.error ?? 'Could not load tracks');
        return;
      }
      setAlbumTracksCache((m) => new Map(m).set(item.bcItemId, json.tracks ?? []));
    } catch (err) {
      setAlbumLoadError(err instanceof Error ? err.message : 'Album load failed');
    } finally {
      setAlbumLoadingId(null);
    }
  }

  // Sync UI expand state with the player: when the player advances into a
  // track that originated from an expanded album, open that row and seed
  // the cache from the queue.
  useEffect(() => {
    const cur = playerQueue.find((t) => t.id === playerCurrentId);
    const parent = cur?.parentBcAlbumId;
    if (!parent) return;
    setExpandedAlbumId(parent);
    setAlbumTracksCache((m) => {
      if (m.has(parent)) return m;
      const albumTracks: DiggerAlbumTrack[] = playerQueue
        .filter((t) => t.parentBcAlbumId === parent)
        .map((t) => ({
          trackId: t.id,
          bcTrackId: t.bcTrackId ?? 0,
          title: t.title,
          artistName: t.artistName,
          durationSeconds: t.durationSeconds,
          trackNumber: t.trackNumber,
          bcUrl: t.bcUrl,
          hasStream: t.hasStream,
          coverUrl: t.coverUrl,
          hasBeenPlayed: t.hasBeenPlayed ?? false,
        }));
      return new Map(m).set(parent, albumTracks);
    });
  }, [playerCurrentId, playerQueue]);

  // Build the player queue from every visible track + album item in
  // display order. Tracks become lazy synthetic entries; albums become fat
  // `albumExpand` entries that the player resolves on demand and replaces
  // with the resolved tracklist.
  useEffect(() => {
    const queue: TrackRowData[] = collectionItems.map((it) =>
      it.bcItemType === 't'
        ? {
            id: -it.bcItemId,
            title: it.title,
            artistName: it.artistName,
            albumTitle: null,
            durationSeconds: null,
            trackNumber: null,
            coverUrl: it.coverUrl,
            bcUrl: it.bcUrl,
            hasStream: true,
            bcTrackId: it.bcItemId,
            hasBeenPlayed: it.hasBeenPlayed,
            needsResolve: true,
            source: 'owned' as const,
          }
        : {
            id: -1_000_000_000 - it.bcItemId,
            title: it.title,
            artistName: it.artistName,
            albumTitle: null,
            durationSeconds: null,
            trackNumber: null,
            coverUrl: it.coverUrl,
            bcUrl: it.bcUrl,
            hasStream: false,
            hasBeenPlayed: it.hasBeenPlayed,
            albumExpand: true,
            source: 'owned' as const,
          },
    );
    setQueue(queue);
  }, [collectionItems, setQueue]);

  function playItem(item: CollectionItem) {
    if (item.bcItemType === 't') {
      const synthId = -item.bcItemId;
      const queueEntry = playerQueue.find(
        (t) => t.id === synthId || t.bcTrackId === item.bcItemId,
      );
      togglePlayer(queueEntry?.id ?? synthId);
    } else {
      // Album: toggle the fat queue entry; player will fetch and expand.
      togglePlayer(-1_000_000_000 - item.bcItemId);
    }
  }

  /** True when the player is currently working on this collection item, no
   * matter whether it's still synthetic or already resolved or expanded. */
  function isCurrentItem(it: CollectionItem): boolean {
    if (playerCurrentId == null) return false;
    if (it.bcItemType === 't') {
      if (playerCurrentId === -it.bcItemId) return true;
      return currentQueueEntry?.bcTrackId === it.bcItemId;
    }
    // Album: current when its fat entry is selected, or any of its
    // expanded child tracks is currently playing.
    if (playerCurrentId === -1_000_000_000 - it.bcItemId) return true;
    return currentQueueEntry?.parentBcAlbumId === it.bcItemId;
  }

  const ownedOverlap = collectionItems.filter((i) => i.isOwnedByYou).length;
  const [prefs] = usePreferences();

  // Client-side "fully heard" check for albums. The server already sets
  // `it.hasBeenPlayed` based on getAlbumPlayedStats at page-load time, but
  // that doesn't reflect plays the user just made in this session. We
  // augment by looking at:
  //   1. albumTracksCache — populated when the user expanded the EP (its
  //      tracks are also present after lookupTrack via /api/album/by-url)
  //   2. playerQueue with `parentBcAlbumId` — populated when the player
  //      auto-expanded an album-fat-entry on advance.
  // If either source covers all tracks of the album AND every one of them
  // has been played (server hasBeenPlayed or live playedBcTrackIds), treat
  // the album as fully heard.
  function isAlbumFullyHeardLive(it: CollectionItem): boolean {
    // Variante A: server pre-computed the bc_track_ids of every locally
    // known track of this album. If we have that list and every id is in
    // the live played-set, the album is fully heard. This is the path
    // that lights up the green check the moment the user finishes the
    // last EP-track, even without expanding the row in the UI.
    if (it.knownTrackBcIds && it.knownTrackBcIds.length > 0) {
      return it.knownTrackBcIds.every((bcId) => playedBcTrackIds.has(bcId));
    }
    const cached = albumTracksCache.get(it.bcItemId);
    if (cached && cached.length > 0) {
      return cached.every(
        (t) =>
          t.hasBeenPlayed || (t.bcTrackId > 0 && playedBcTrackIds.has(t.bcTrackId)),
      );
    }
    const fromQueue = playerQueue.filter(
      (t) => t.parentBcAlbumId === it.bcItemId && t.bcTrackId != null,
    );
    if (fromQueue.length === 0) return false;
    return fromQueue.every(
      (t) => t.hasBeenPlayed || playedBcTrackIds.has(t.bcTrackId ?? 0),
    );
  }
  /** How many of the album's known tracks have been played (live count).
   * Used by the partial-played indicator. */
  function albumPlayedCountLive(it: CollectionItem): { played: number; total: number } {
    const ids = it.knownTrackBcIds ?? [];
    if (ids.length === 0) return { played: 0, total: 0 };
    let played = 0;
    for (const id of ids) if (playedBcTrackIds.has(id)) played += 1;
    return { played, total: ids.length };
  }

  // Filter the visible row list, but keep the player queue derived from
  // the full `collectionItems` so A/D walks the entire collection even
  // when the user toggled "hide played" on.
  const [search, setSearch] = useState('');
  const visibleItems = useMemo(() => {
    let v = collectionItems;
    if (prefs.hidePlayed) {
      v = v.filter((it) => {
        if (it.hasBeenPlayed) return false;
        if (it.bcItemType === 't' && playedBcTrackIds.has(it.bcItemId)) return false;
        if (it.bcItemType === 'a') {
          if (isAlbumFullyHeardLive(it)) return false;
          if (prefs.hidePartialAlbums) {
            const stats = albumPlayedCountLive(it);
            if (stats.played > 0) return false;
          }
        }
        return true;
      });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      v = v.filter((it) =>
        `${it.title} ${it.artistName ?? ''} ${it.labelName ?? ''}`
          .toLowerCase()
          .includes(q),
      );
    }
    return v;
    // isAlbumFullyHeardLive + albumPlayedCountLive depend on
    // albumTracksCache + playerQueue + playedBcTrackIds; all listed below
    // so the memo recomputes when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    collectionItems,
    prefs.hidePlayed,
    prefs.hidePartialAlbums,
    playedBcTrackIds,
    albumTracksCache,
    playerQueue,
    search,
  ]);
  const hiddenItemCount = collectionItems.length - visibleItems.length;

  // Precompute lookup maps so the per-row renderer doesn't do a linear scan
  // of playerQueue for every item — at 10k+ collections this turns from
  // O(n) into O(n²) which freezes the virtualization scroll on mid-range
  // hardware.
  const queueByBcTrackId = useMemo(() => {
    const m = new Map<number, TrackRowData>();
    for (const t of playerQueue) {
      if (t.bcTrackId != null && !t.needsResolve) m.set(t.bcTrackId, t);
    }
    return m;
  }, [playerQueue]);
  const currentQueueEntry = useMemo(
    () => playerQueue.find((t) => t.id === playerCurrentId) ?? null,
    [playerQueue, playerCurrentId],
  );

  // Single source of truth for one collection-item row. Used by both the
  // virtualized and the plain rendering path so behaviour stays identical
  // regardless of list size. Uses the unified <TrackRow>.
  function renderCollectionItem(it: CollectionItem) {
    const isAlbum = it.bcItemType === 'a';
    const isExpanded = expandedAlbumId === it.bcItemId;
    const expandedTracks = albumTracksCache.get(it.bcItemId);

    // Local lib id when the curator's track is also in our library — the
    // queue lookup returns it for tracks resolved by the player or the
    // server-side fully-heard pre-compute. null when the track hasn't
    // been imported yet, in which case TrackRow's id is synthetic and
    // TrackActionsBar lazy-resolves on first action click.
    const queueEntry = queueByBcTrackId.get(it.bcItemId);
    const localTrackId = queueEntry?.id ?? null;

    const trackPlayedFlag =
      it.hasBeenPlayed === true
      || (!isAlbum && playedBcTrackIds.has(it.bcItemId));
    const albumFullyHeard = isAlbum && (it.hasBeenPlayed === true || isAlbumFullyHeardLive(it));
    const albumPartial = isAlbum && !albumFullyHeard ? albumPlayedCountLive(it) : null;

    const trackData: TrackRowData = {
      // Tracks: real lib-id when known, else synthetic negative bc-id so
      // the player keeps it in queue order; albums: deep-negative id.
      id: isAlbum
        ? -1_000_000_000 - it.bcItemId
        : (localTrackId ?? -it.bcItemId),
      title: it.title,
      artistName: it.artistName,
      albumTitle: null,
      durationSeconds: null,
      trackNumber: null,
      coverUrl: it.coverUrl,
      bcUrl: it.bcUrl,
      hasStream: !isAlbum,
      bcTrackId: isAlbum ? undefined : it.bcItemId,
      hasBeenPlayed: !isAlbum ? trackPlayedFlag : albumFullyHeard,
      needsResolve: !isAlbum && localTrackId == null,
      albumExpand: isAlbum,
      labelName: it.labelName,
      labelId: it.labelId,
      labelBcUrl: it.labelBcUrl,
      source: 'owned',
      bcItemType: it.bcItemType,
      partialPlayedFraction:
        albumPartial && albumPartial.total > 0 ? albumPartial : undefined,
    };

    const badges: TrackRowBadge[] = it.isOwnedByYou
      ? [{ label: 'You own this', tone: 'accent' }]
      : [];

    function onPlayOverride() {
      if (isAlbum && !isExpanded) {
        // Open the UI section in parallel to the player's expand-flow so
        // the user immediately sees the EP loading.
        void toggleAlbumExpand(it);
      }
      playItem(it);
    }

    const albumExpandToggle = isAlbum ? (
      <button
        type="button"
        onClick={() => toggleAlbumExpand(it)}
        disabled={albumLoadingId === it.bcItemId}
        title={isExpanded ? 'Hide tracks' : 'Show tracks of this album'}
        aria-label={isExpanded ? 'Collapse album tracks' : 'Expand album tracks'}
        aria-expanded={isExpanded}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-border bg-bg-elevated text-fg-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    ) : null;

    const expandedRegion = isAlbum && isExpanded ? (
      <div className="px-2 pb-2 pt-2">
        {albumLoadingId === it.bcItemId && (
          <p className="px-2 py-3 text-xs text-fg-muted">Loading tracks…</p>
        )}
        {albumLoadError && albumLoadingId === null && !expandedTracks && (
          <p className="px-2 py-3 text-xs text-fg-danger">{albumLoadError}</p>
        )}
        {expandedTracks && expandedTracks.length === 0 && (
          <p className="px-2 py-3 text-xs text-fg-muted">
            No tracks found for this release.
          </p>
        )}
        {expandedTracks && expandedTracks.length > 0 && (
          <div className="space-y-0">
            {expandedTracks.map((tr) => (
              <AlbumTrackCompactRow
                key={tr.bcTrackId}
                track={tr}
                siblings={expandedTracks}
                albumCoverUrl={it.coverUrl}
                buildQueueOnPlay={() =>
                  buildDiggerQueueWithExpansion(
                    collectionItems,
                    it.bcItemId,
                    expandedTracks,
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    ) : null;

    return (
      <TrackRow
        key={`${it.bcItemType}-${it.bcItemId}`}
        track={trackData}
        titleHref={`/track/go?url=${encodeURIComponent(it.bcUrl)}`}
        badges={badges}
        showFollow
        showArchive={false}
        hideAlbumColumn
        hideDuration
        onPlayOverride={onPlayOverride}
        trailing={albumExpandToggle ?? undefined}
        expandedContent={expandedRegion ?? undefined}
      />
    );
  }

  return (
    <>
      <section className="mt-4 grid gap-6 md:grid-cols-[140px_minmax(0,1fr)] md:items-center">
        <div>
          {detail.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={detail.imageUrl}
              alt=""
              className="aspect-square w-full rounded-full object-cover"
            />
          ) : (
            <div className="aspect-square w-full rounded-full bg-bg-elevated" />
          )}
        </div>
        <div className="flex flex-col">
          {/* Identity block: name first, supporting meta below. */}
          <h1 className="text-3xl font-bold tracking-tight">
            {detail.displayName ?? detail.bcUsername}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-secondary">
            <span>@{detail.bcUsername}</span>
            <span className="text-fg-muted">·</span>
            <span className="text-xs uppercase tracking-wide text-fg-muted">Curator</span>
            {activity && (
              <>
                <span className="text-fg-muted">·</span>
                <ActiveBadge snapshot={activity} variant="compact" />
              </>
            )}
            {stats.location && (
              <>
                <span className="text-fg-muted">·</span>
                <span className="text-xs text-fg-muted">{stats.location}</span>
              </>
            )}
          </div>
          {stats.bio && (
            <p className="mt-3 text-sm text-fg-secondary">{stats.bio}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {followed ? (
              <button
                type="button"
                onClick={handleUnfollow}
                disabled={busy}
                className="rounded-full border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover disabled:opacity-50"
              >
                Following
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFollow}
                disabled={busy}
                className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                Follow
              </button>
            )}
            {!ephemeral && (
              <button
                type="button"
                onClick={toggleIgnore}
                disabled={busy}
                className={`rounded-full border px-4 py-2 text-sm transition-colors disabled:opacity-50 ${
                  ignored
                    ? 'border-border-warning bg-bg-warning text-fg-warning hover:bg-bg-warning'
                    : 'border-border bg-bg-elevated text-fg-secondary hover:bg-bg-hover'
                }`}
              >
                {ignored ? 'Ignored — restore' : 'Ignore'}
              </button>
            )}
            {stats.websiteUrl && (
              <a
                href={stats.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-border bg-bg-elevated px-3 py-2 text-sm transition-colors hover:bg-bg-hover"
              >
                ↗ Website
              </a>
            )}
            <OpenOnBandcampButton
              href={`https://bandcamp.com/${detail.bcUsername}`}
              label="Open curator on bandcamp.com"
            />
          </div>
          {/* Stats row: separate band, smaller weight than identity. */}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
            {stats.itemCount != null && (
              <span>
                <span className="text-fg-secondary">{stats.itemCount}</span> in collection
              </span>
            )}
            {stats.followersCount != null && (
              <span>
                <span className="text-fg-secondary">{stats.followersCount}</span> followers
              </span>
            )}
            {stats.followingBandsCount != null && (
              <span>
                <span className="text-fg-secondary">{stats.followingBandsCount}</span>{' '}
                following bands
              </span>
            )}
            {detail.bcFanId && <span>fan id {detail.bcFanId}</span>}
          </div>
          {message && (
            <div className="mt-3 rounded border border-border bg-bg-surface p-3 text-sm text-fg-secondary">
              {message}
            </div>
          )}
          {profileError && (
            <div className="mt-3 rounded border border-border-danger bg-bg-danger p-3 text-xs text-fg-danger">
              Could not fetch profile: {profileError}
            </div>
          )}
        </div>
      </section>

      {/* Collection section: always render the shell so the user sees that
          a crawl will populate it, even before any data has been fetched. */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
            {collectionItems.length === 0
              ? 'Collection'
              : crawlStatus?.status === 'success'
                ? 'Full collection'
                : 'Recent collection'}
            {stats.itemCount != null && collectionItems.length > 0 && (
              <span className="ml-2 normal-case text-fg-muted">
                · showing {collectionItems.length} of {stats.itemCount}
              </span>
            )}
          </h2>
            <div className="flex items-center gap-2">
              {ownedOverlap > 0 && (
                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-mono text-accent">
                  {ownedOverlap} you also own
                </span>
              )}
              <HidePlayedToggle count={hiddenItemCount} />
              {detail.bcFanId && (
                <button
                  type="button"
                  onClick={runFullCrawl}
                  disabled={crawling}
                  className="rounded border border-border bg-bg-elevated px-3 py-1 text-xs transition-colors hover:bg-bg-hover disabled:opacity-50"
                >
                  {crawling
                    ? 'Crawling…'
                    : crawlStatus?.status === 'success'
                      ? 'Re-crawl'
                      : 'Crawl full collection'}
                </button>
              )}
            </div>
          </div>
          {crawlMessage && (
            <div className="mb-3 rounded border border-border bg-bg-surface p-2 text-xs text-fg-secondary">
              {crawlMessage}
            </div>
          )}
          {collectionItems.length > 0 && (
            <TrackListSearch
              value={search}
              onChange={setSearch}
              total={collectionItems.length}
              visible={visibleItems.length}
              unitLabel="item"
              unitLabelPlural="items"
            />
          )}
          {collectionItems.length === 0 ? (
            <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
              No collection items loaded yet. Click &ldquo;Crawl full
              collection&rdquo; above to fetch every release this curator
              supports on Bandcamp.
            </p>
          ) : visibleItems.length === 0 ? (
            <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-center text-sm text-fg-muted">
              All {collectionItems.length} items already heard. Toggle &ldquo;Hide
              played&rdquo; off to show them again.
            </p>
          ) : visibleItems.length > 500 ? (
            <Virtuoso
              useWindowScroll
              totalCount={visibleItems.length}
              overscan={400}
              computeItemKey={(index) =>
                `${visibleItems[index].bcItemType}-${visibleItems[index].bcItemId}`
              }
              itemContent={(index) => (
                <div className="pb-2">{renderCollectionItem(visibleItems[index])}</div>
              )}
            />
          ) : (
            <div className="space-y-2">
              {visibleItems.map((it) => (
                <div key={`${it.bcItemType}-${it.bcItemId}`}>
                  {renderCollectionItem(it)}
                </div>
              ))}
            </div>
          )}
          <StickyPlayerBar />
          {stats.itemCount != null && stats.itemCount > collectionItems.length && (
            <p className="mt-3 text-xs text-fg-muted">
              Showing {collectionItems.length} of {stats.itemCount}. Click &ldquo;Crawl full
              collection&rdquo; above to load all items.
            </p>
          )}
        </section>
    </>
  );
}

/**
 * Build the queue from the curator's collection with one album expanded
 * to its tracklist inline. Used on Play of an individual EP-track so
 * advance past the last sibling lands on the next collection item, not
 * currentId=null.
 */
function buildDiggerQueueWithExpansion(
  collectionItems: CollectionItem[],
  expandedAlbumBcId: number,
  expandedTracks: DiggerAlbumTrack[],
): TrackRowData[] {
  return collectionItems.flatMap((it) => {
    if (it.bcItemType === 'a' && it.bcItemId === expandedAlbumBcId) {
      return expandedTracks.map<TrackRowData>((t) => ({
        id: t.trackId,
        title: t.title,
        artistName: t.artistName,
        albumTitle: it.title,
        durationSeconds: t.durationSeconds,
        trackNumber: t.trackNumber,
        coverUrl: t.coverUrl ?? it.coverUrl,
        bcUrl: t.bcUrl,
        hasStream: t.hasStream,
        bcTrackId: t.bcTrackId,
        hasBeenPlayed: t.hasBeenPlayed,
        parentBcAlbumId: expandedAlbumBcId,
        source: 'owned' as const,
      }));
    }
    if (it.bcItemType === 't') {
      return [{
        id: -it.bcItemId,
        title: it.title,
        artistName: it.artistName,
        albumTitle: null,
        durationSeconds: null,
        trackNumber: null,
        coverUrl: it.coverUrl,
        bcUrl: it.bcUrl,
        hasStream: true,
        bcTrackId: it.bcItemId,
        hasBeenPlayed: it.hasBeenPlayed,
        needsResolve: true,
        source: 'owned' as const,
      }];
    }
    return [{
      id: -1_000_000_000 - it.bcItemId,
      title: it.title,
      artistName: it.artistName,
      albumTitle: null,
      durationSeconds: null,
      trackNumber: null,
      coverUrl: it.coverUrl,
      bcUrl: it.bcUrl,
      hasStream: false,
      bcTrackId: undefined,
      hasBeenPlayed: it.hasBeenPlayed,
      albumExpand: true,
      source: 'owned' as const,
    }];
  });
}

/**
 * Compact sub-row inside an expanded album. Uses the unified <TrackRow>
 * primitive with `variant="compact"` so it shares the same action-bar,
 * tooltip, and play behaviour as the full rows. The only differences:
 * cover is replaced by the track number, no album/duration columns.
 */
function AlbumTrackCompactRow({
  track,
  siblings,
  albumCoverUrl,
  buildQueueOnPlay,
}: {
  track: DiggerAlbumTrack;
  siblings: DiggerAlbumTrack[];
  albumCoverUrl: string | null;
  buildQueueOnPlay?: () => TrackRowData[];
}) {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const toggle = usePlayerStore((s) => s.toggle);

  const trackData: TrackRowData = {
    id: track.trackId,
    title: track.title,
    artistName: track.artistName,
    albumTitle: null,
    durationSeconds: track.durationSeconds,
    trackNumber: track.trackNumber,
    coverUrl: track.coverUrl ?? albumCoverUrl,
    bcUrl: track.bcUrl,
    hasStream: track.hasStream,
    bcTrackId: track.bcTrackId,
    hasBeenPlayed: track.hasBeenPlayed,
    source: 'owned',
  };

  function play() {
    if (buildQueueOnPlay) {
      setQueue(buildQueueOnPlay());
    } else {
      setQueue(
        siblings.map((s) => ({
          id: s.trackId,
          title: s.title,
          artistName: s.artistName,
          albumTitle: null,
          durationSeconds: s.durationSeconds,
          trackNumber: s.trackNumber,
          coverUrl: s.coverUrl ?? albumCoverUrl,
          bcUrl: s.bcUrl,
          hasStream: s.hasStream,
          bcTrackId: s.bcTrackId,
          hasBeenPlayed: s.hasBeenPlayed,
          source: 'owned' as const,
        })),
      );
    }
    toggle(track.trackId);
  }

  return (
    <TrackRow
      track={trackData}
      variant="compact"
      position={track.trackNumber}
      showFollow
      showArchive={false}
      onPlayOverride={play}
    />
  );
}
