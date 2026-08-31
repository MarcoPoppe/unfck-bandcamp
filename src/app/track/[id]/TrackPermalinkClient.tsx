'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import TrackRow, { type TrackRowData } from '@/components/TrackRow';
import TrackActionsBar from '@/components/TrackActionsBar';
import OpenOnBandcampButton from '@/components/OpenOnBandcampButton';
import HidePlayedToggle from '@/components/HidePlayedToggle';
import PlayedCheck from '@/components/PlayedCheck';
import { usePreferences } from '@/lib/settings/preferences';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts } from '@/lib/store/hooks';
import type { TrackPermalinkData } from '@/lib/track/lookup';

interface Supporter {
  fanId: number;
  username: string;
  displayName: string | null;
  imageUrl: string | null;
}

interface BestOfItem {
  bcItemId: number;
  bcItemType: 'a' | 't';
  bcUrl: string;
  title: string;
  artistName: string | null;
  coverUrl: string | null;
  matchCount: number;
  ownedByYou: boolean;
  hasBeenPlayed?: boolean;
  /** For album rows: number of locally-known tracks of this album that have
   * been played at least once. Used for the "n/m played" tooltip. */
  albumPlayedCount?: number;
  /** For album rows: number of locally-known tracks of this album. */
  albumTotalCount?: number;
  /** Set by the server when the artist is already in our local DB so the
   * link goes straight to /artist/[bcBandId]. Falls back to /artist/go for
   * unknown artists (server resolves via lookupTrack on the fly). */
  artistBcBandId?: number | null;
  /** Label info if any local track of this release carries a label. */
  labelId?: number | null;
  labelName?: string | null;
  labelBcUrl?: string | null;
  /** Release date if a local track / album row carries one. Servers
   * format-agnostic ISO string; the UI parses leniently. */
  releasedAt?: string | null;
}

function BestOfArtistLink({
  artistName,
  artistBcBandId,
  bcUrl,
}: {
  artistName: string | null;
  artistBcBandId: number | null;
  bcUrl: string;
}) {
  if (!artistName) {
    return <div className="truncate text-xs text-fg-secondary">unknown</div>;
  }
  const href =
    artistBcBandId != null
      ? `/artist/${artistBcBandId}`
      : `/artist/go?url=${encodeURIComponent(bcUrl)}`;
  return (
    <a
      href={href}
      className="block max-w-full truncate text-xs text-fg-secondary hover:text-accent hover:underline"
      title="Open artist page (middle-click for new tab)"
    >
      {artistName}
    </a>
  );
}

function BestOfLabelLink({
  labelId,
  labelName,
}: {
  labelId: number | null;
  labelName: string;
}) {
  if (labelId == null) {
    return (
      <div
        className="block max-w-full truncate text-xs text-fg-muted"
        title={`Label: ${labelName}`}
      >
        <span className="opacity-60">on</span> {labelName}
      </div>
    );
  }
  return (
    <a
      href={`/label/${labelId}`}
      className="block max-w-full truncate text-xs text-fg-muted hover:text-accent hover:underline"
      title={`Label: ${labelName} (middle-click for new tab)`}
    >
      <span className="opacity-60">on</span> {labelName}
    </a>
  );
}

function AlbumTrackRow({
  track,
  siblings,
  albumCoverUrl,
  buildQueueOnPlay,
}: {
  track: AlbumTrack;
  /** All tracks of the parent EP, in order. Passed in so the player queue
   * gets every sibling on play and A/D advances through the release. */
  siblings: AlbumTrack[];
  albumCoverUrl: string | null;
  /** Optional: build the full contextual queue (e.g. all best-of items
   * with this EP expanded inline) instead of just the EP's siblings.
   * Without this, advance past the last EP-track lands on currentId=null
   * because there's nothing else in the queue. */
  buildQueueOnPlay?: () => TrackRowData[];
}) {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const toggle = usePlayerStore((s) => s.toggle);
  const playerCurrentId = usePlayerStore((s) => s.currentId);
  const playerIsPlaying = usePlayerStore((s) => s.isPlaying);
  const playedBcTrackIds = usePlayerStore((s) => s.playedBcTrackIds);
  const isCurrent = playerCurrentId === track.trackId;
  const isPlaying = isCurrent && playerIsPlaying;
  const showPlayed = track.hasBeenPlayed || playedBcTrackIds.has(track.bcTrackId);

  function play() {
    if (buildQueueOnPlay) {
      setQueue(buildQueueOnPlay());
    } else {
      // Fallback: queue only the EP's siblings. Used in standalone contexts
      // (e.g. /track/[id] with no surrounding list).
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
          needsResolve: !s.hasStream && !!s.bcUrl,
          bcTrackId: s.bcTrackId,
          hasBeenPlayed: s.hasBeenPlayed,
          source: 'owned' as const,
        })),
      );
    }
    toggle(track.trackId);
  }

  return (
    <div
      className={`flex items-center gap-2 rounded px-2 py-1.5 ${
        isCurrent ? 'bg-bg-elevated' : 'hover:bg-bg-hover'
      }`}
    >
      <button
        type="button"
        onClick={play}
        disabled={!track.hasStream && !track.bcUrl}
        title={
          !track.hasStream && track.bcUrl
            ? 'Resolves on play (one BC roundtrip)'
            : isPlaying
              ? 'Pause'
              : 'Play'
        }
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30 ${
          isCurrent
            ? 'border-accent bg-accent text-fg-on-accent'
            : 'border-border text-fg-secondary hover:border-accent hover:text-accent'
        }`}
      >
        {isPlaying ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <span className="w-5 flex-none text-right font-mono text-xs text-fg-muted tabular-nums">
        {track.trackNumber ?? ''}
      </span>
      <a
        href={`/track/${track.bcTrackId}`}
        className={`flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm hover:underline ${
          isCurrent ? 'text-accent' : ''
        }`}
      >
        {showPlayed && (
          <PlayedCheck trackId={track.trackId} bcTrackId={track.bcTrackId} />
        )}
        <span className="truncate">{track.title}</span>
      </a>
      <span className="flex-none font-mono text-xs text-fg-muted tabular-nums">
        {formatDuration(track.durationSeconds)}
      </span>
      <TrackActionsBar
        bcUrl={track.bcUrl}
        bcTrackId={track.bcTrackId}
        localTrackId={track.trackId}
        title={track.title}
        artistName={track.artistName}
        albumTitle={null}
        coverUrl={track.coverUrl ?? albumCoverUrl}
        showFollow
        
      />
    </div>
  );
}

interface BestOfStatus {
  trackId: number;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'error';
  supportersScanned: number;
  supportersTotal: number | null;
  itemsAggregated: number;
  topItems: BestOfItem[];
  errorMessage: string | null;
}

/**
 * Build the player queue from a best-of list with one album row replaced
 * by its expanded tracklist. Used when the user clicks Play on a single
 * track inside a manually-expanded EP — without this, setQueue(siblings)
 * would shrink the queue to just the 4 EP-tracks, and advance past the
 * last one would land on currentId=null because there's nothing else.
 */
function buildBestOfQueueWithExpansion(
  topItems: BestOfItem[],
  expandedAlbumBcId: number,
  expandedTracks: AlbumTrack[],
): TrackRowData[] {
  return topItems.flatMap((it) => {
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

interface AlbumTrack {
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

function formatReleasedShort(s: string): string {
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return s;
  const d = new Date(ts);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function TrackPermalinkClient({ data }: { data: TrackPermalinkData }) {
  const { track, siblings } = data;
  const setQueue = usePlayerStore((s) => s.setQueue);
  const toggle = usePlayerStore((s) => s.toggle);
  const playerCurrentId = usePlayerStore((s) => s.currentId);
  const playerIsPlaying = usePlayerStore((s) => s.isPlaying);
  const queue = usePlayerStore((s) => s.queue);
  const playedBcTrackIds = usePlayerStore((s) => s.playedBcTrackIds);
  const isCurrent = usePlayerStore((s) => s.currentId === track.id);
  const isPlaying = usePlayerStore((s) => s.currentId === track.id && s.isPlaying);
  const [prefs] = usePreferences();

  useGlobalPlaybackShortcuts();

  const visibleSiblings = useMemo(() => {
    if (!prefs.hidePlayed) return siblings;
    return siblings.filter(
      (s) => !(s.hasBeenPlayed || playedBcTrackIds.has(s.bcTrackId)),
    );
  }, [siblings, prefs.hidePlayed, playedBcTrackIds]);
  const hiddenSiblingCount = siblings.length - visibleSiblings.length;

  const [supporters, setSupporters] = useState<Supporter[]>([]);
  const [supportersMore, setSupportersMore] = useState(false);
  const [supportersLoading, setSupportersLoading] = useState(true);
  const [supportersError, setSupportersError] = useState<string | null>(null);

  const [bestOf, setBestOf] = useState<BestOfStatus | null>(null);
  const [bestOfRunning, setBestOfRunning] = useState(false);
  const [bestOfError, setBestOfError] = useState<string | null>(null);

  // Tracked for the runBestOf polling loop so it stops setting state once
  // the user navigates away.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [expandedAlbumId, setExpandedAlbumId] = useState<number | null>(null);
  const [albumTracksCache, setAlbumTracksCache] = useState<Map<number, AlbumTrack[]>>(
    new Map(),
  );
  const [albumLoadingId, setAlbumLoadingId] = useState<number | null>(null);
  const [albumLoadError, setAlbumLoadError] = useState<string | null>(null);

  // Live "album fully heard" check: server-side hasBeenPlayed only reflects
  // page-load state. If the user expanded an EP and just played all its
  // tracks, the cache OR the player queue (with parentBcAlbumId) has every
  // track of the album. Walk that and flag the album played live.
  function isAlbumFullyHeardLive(albumBcId: number): boolean {
    const cached = albumTracksCache.get(albumBcId);
    if (cached && cached.length > 0) {
      return cached.every(
        (t) =>
          t.hasBeenPlayed || (t.bcTrackId > 0 && playedBcTrackIds.has(t.bcTrackId)),
      );
    }
    const fromQueue = queue.filter(
      (t) => t.parentBcAlbumId === albumBcId && t.bcTrackId != null,
    );
    if (fromQueue.length === 0) return false;
    return fromQueue.every(
      (t) => t.hasBeenPlayed || playedBcTrackIds.has(t.bcTrackId ?? 0),
    );
  }

  const visibleBestOf = useMemo(() => {
    if (!bestOf || !prefs.hidePlayed) return bestOf;
    const filtered = bestOf.topItems.filter((it) => {
      if (it.hasBeenPlayed) return false;
      if (it.bcItemType === 't' && playedBcTrackIds.has(it.bcItemId)) return false;
      if (it.bcItemType === 'a' && isAlbumFullyHeardLive(it.bcItemId)) return false;
      return true;
    });
    return { ...bestOf, topItems: filtered };
    // Live check depends on cache + queue; listed below so memo recomputes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestOf, prefs.hidePlayed, playedBcTrackIds, albumTracksCache, queue]);
  const hiddenBestOfCount =
    (bestOf?.topItems.length ?? 0) - (visibleBestOf?.topItems.length ?? 0);

  // Sync UI expand state with the player: when the player advances into a
  // track that originated from a fat album-entry (parentBcAlbumId set), open
  // that album row in the UI and seed its tracklist cache from the queue.
  useEffect(() => {
    const cur = queue.find((t) => t.id === playerCurrentId);
    const parent = cur?.parentBcAlbumId;
    if (!parent) return;
    setExpandedAlbumId(parent);
    setAlbumTracksCache((m) => {
      if (m.has(parent)) return m;
      const albumTracks: AlbumTrack[] = queue
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
  }, [playerCurrentId, queue]);

  async function toggleAlbumExpand(item: BestOfItem) {
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
        tracks?: AlbumTrack[];
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

  useEffect(() => {
    const queue: TrackRowData[] =
      siblings.length > 0
        ? siblings.map((s) => ({
            id: s.id,
            title: s.title,
            artistName: s.artistName,
            albumTitle: s.albumTitle,
            durationSeconds: s.durationSeconds,
            trackNumber: s.trackNumber,
            coverUrl: s.coverUrl,
            bcUrl: s.bcUrl,
            hasStream: s.hasStream,
            needsResolve: !s.hasStream && !!s.bcUrl,
            bcTrackId: s.bcTrackId,
            hasBeenPlayed: s.hasBeenPlayed,
            source: 'owned' as const,
          }))
        : [
            {
              id: track.id,
              title: track.title,
              artistName: track.artistName,
              albumTitle: track.albumTitle,
              durationSeconds: track.durationSeconds,
              trackNumber: null,
              coverUrl: track.coverUrl,
              bcUrl: track.bcUrl,
              hasStream: track.streamAvailable,
              // Lazy resolve: when we don't have a stream URL cached but
              // we know the BC URL, the player swaps this entry for a
              // resolved one on first play. Marco's invariant: every
              // playable surface should reach the audio path.
              needsResolve: !track.streamAvailable && !!track.bcUrl,
              bcTrackId: track.bcTrackId,
              hasBeenPlayed: track.hasBeenPlayed,
              source: 'owned' as const,
            },
          ];
    setQueue(queue);
  }, [track, siblings, setQueue]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setSupportersLoading(true);
      setSupportersError(null);
      setSupporters([]);
      setSupportersMore(false);
      try {
        // Auto-paginate every supporter the API will hand out. Bandcamp pages
        // are 80 each; 1000+ supporters takes a few seconds but keeps the UI
        // honest about scale. The route walks two tralbum variants (release
        // and track permalink), so the same fan can arrive twice — dedupe by
        // fan id to keep the count and the React keys honest.
        const all: Supporter[] = [];
        const seenFanIds = new Set<number>();
        let token: string | null = null;
        for (let i = 0; i < 200; i += 1) {
          const url = token
            ? `/api/track/${track.id}/supporters?token=${encodeURIComponent(token)}`
            : `/api/track/${track.id}/supporters`;
          const res = await fetch(url);
          const json = (await res.json()) as {
            ok?: boolean;
            collectors?: Supporter[];
            moreAvailable?: boolean;
            nextToken?: string | null;
            error?: string;
          };
          if (cancelled) return;
          if (!res.ok || !json.ok) {
            setSupportersError(json.error ?? `Supporters fetch failed (${res.status})`);
            break;
          }
          for (const c of json.collectors ?? []) {
            if (seenFanIds.has(c.fanId)) continue;
            seenFanIds.add(c.fanId);
            all.push(c);
          }
          setSupporters([...all]);
          if (!json.moreAvailable || !json.nextToken) {
            setSupportersMore(false);
            break;
          }
          token = json.nextToken;
          setSupportersMore(true);
        }
      } catch (err) {
        if (cancelled) return;
        setSupportersError(err instanceof Error ? err.message : 'Supporters fetch failed');
      } finally {
        if (!cancelled) setSupportersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [track.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadBestOf() {
      try {
        const res = await fetch(`/api/track/${track.id}/best-of`);
        if (!res.ok) return;
        const json = (await res.json()) as { ok?: boolean; status?: BestOfStatus | null };
        if (!cancelled && json.ok) setBestOf(json.status ?? null);
      } catch {
        // ignore
      }
    }
    void loadBestOf();
    // When the user navigates back via browser history, the page can be
    // restored from the bfcache without the initial fetch above re-firing.
    // Listening to `pageshow` (with persisted=true) handles that case so
    // Marco doesn't need to F5 to see the best-of list again.
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) void loadBestOf();
    }
    window.addEventListener('pageshow', onPageShow);
    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [track.id]);

  async function runBestOf() {
    setBestOfRunning(true);
    setBestOfError(null);
    try {
      const startRes = await fetch(`/api/track/${track.id}/best-of`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const startJson = (await startRes.json()) as {
        ok?: boolean;
        status?: BestOfStatus;
        error?: string;
      };
      if (!startRes.ok || !startJson.ok) {
        setBestOfError(startJson.error ?? `Crawl failed (${startRes.status})`);
        return;
      }
      if (mountedRef.current && startJson.status) setBestOf(startJson.status);

      // Poll progress every 1.5s until the run leaves 'running' state.
      // Update bestOf each tick so the UI shows "scanned 47 of 137" live.
      // Bail out the moment the component unmounts so we don't setState
      // on a vanished component (which would also keep the polling fetch
      // running indefinitely on slow networks).
      while (mountedRef.current) {
        await new Promise((r) => setTimeout(r, 1500));
        if (!mountedRef.current) break;
        const pollRes = await fetch(`/api/track/${track.id}/best-of`);
        if (!mountedRef.current) break;
        if (!pollRes.ok) continue;
        const pollJson = (await pollRes.json()) as {
          ok?: boolean;
          status?: BestOfStatus | null;
        };
        if (!mountedRef.current) break;
        if (!pollJson.ok || !pollJson.status) continue;
        setBestOf(pollJson.status);
        if (pollJson.status.status !== 'running') {
          if (pollJson.status.status === 'error' && pollJson.status.errorMessage) {
            setBestOfError(pollJson.status.errorMessage);
          }
          break;
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setBestOfError(err instanceof Error ? err.message : 'Crawl failed');
      }
    } finally {
      if (mountedRef.current) setBestOfRunning(false);
    }
  }

  // The best-of items become the player queue when the user starts playing
  // one of them. Single-tracks enter as lazy synthetic-id entries. Album
  // rows enter as `albumExpand` fat entries — StickyPlayerBar resolves them
  // on demand and replaces the entry with the full tracklist via expandAlbum.
  function playBestOfItem(item: BestOfItem) {
    if (!bestOf) return;
    const queue: TrackRowData[] = bestOf.topItems.map((i) =>
      i.bcItemType === 't'
        ? {
            id: -i.bcItemId,
            title: i.title,
            artistName: i.artistName,
            albumTitle: null,
            durationSeconds: null,
            trackNumber: null,
            coverUrl: i.coverUrl,
            bcUrl: i.bcUrl,
            hasStream: true,
            bcTrackId: i.bcItemId,
            hasBeenPlayed: i.hasBeenPlayed,
            needsResolve: true,
            source: 'owned' as const,
          }
        : {
            // Distinct synthetic id range for albums so it can't collide
            // with track synth ids used above (-bcItemId for tracks).
            id: -1_000_000_000 - i.bcItemId,
            title: i.title,
            artistName: i.artistName,
            albumTitle: null,
            durationSeconds: null,
            trackNumber: null,
            coverUrl: i.coverUrl,
            bcUrl: i.bcUrl,
            hasStream: false,
            bcTrackId: undefined,
            hasBeenPlayed: i.hasBeenPlayed,
            albumExpand: true,
            source: 'owned' as const,
          },
    );
    setQueue(queue);
    const targetId =
      item.bcItemType === 't' ? -item.bcItemId : -1_000_000_000 - item.bcItemId;
    toggle(targetId);
  }


  return (
    <>
      <Link href="/track" className="text-sm text-fg-muted hover:text-accent">
        ← New lookup
      </Link>

      <section className="mt-4 grid gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
        <div>
          {track.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={track.coverUrl}
              alt=""
              className="aspect-square w-full rounded-lg object-cover shadow-lg"
            />
          ) : (
            <div className="aspect-square w-full rounded-lg bg-bg-elevated" />
          )}
        </div>
        <div className="flex flex-col">
          <div className="text-xs uppercase tracking-wide text-fg-muted">
            {track.isOwned ? 'In your collection' : 'Lookup result'}
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{track.title}</h1>
          <div className="mt-1 text-lg text-fg-secondary">
            {track.artistName ? (
              track.artistBcBandId ? (
                <Link
                  href={`/artist/${track.artistBcBandId}`}
                  className="hover:text-accent hover:underline"
                >
                  {track.artistName}
                </Link>
              ) : (
                track.artistName
              )
            ) : (
              'unknown artist'
            )}
          </div>
          {track.albumUrl ? (
            <a
              href={`/track/go?url=${encodeURIComponent(track.albumUrl)}`}
              className="text-sm text-fg-muted hover:text-accent hover:underline"
              title="Open this release (middle-click for new tab)"
            >
              From {track.albumTitle ?? 'this release'} →
            </a>
          ) : (
            track.albumTitle && (
              <div className="text-sm text-fg-muted">From {track.albumTitle}</div>
            )
          )}
          {track.labelName && (
            <div className="mt-0.5 text-sm">
              <BestOfLabelLink
                labelId={track.labelId ?? null}
                labelName={track.labelName}
              />
            </div>
          )}
          {track.releasedAt && (
            <div className="mt-0.5 text-xs text-fg-muted" title={`Released ${track.releasedAt}`}>
              <span className="opacity-60">released</span> {formatReleasedShort(track.releasedAt)}
            </div>
          )}
          <div className="mt-1 font-mono text-xs text-fg-muted">
            {formatDuration(track.durationSeconds)} · bc id {track.bcTrackId}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => toggle(track.id)}
              title={
                !track.streamAvailable
                  ? 'No cached stream — first play fetches one from Bandcamp'
                  : isPlaying
                    ? 'Pause'
                    : 'Play'
              }
              className="flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
              {isPlaying ? 'Pause' : isCurrent ? 'Resume' : 'Play'}
            </button>
            <TrackActionsBar
              bcUrl={track.bcUrl}
              bcTrackId={track.bcTrackId}
              localTrackId={track.id}
              title={track.title}
              artistName={track.artistName}
              albumTitle={track.albumTitle}
              coverUrl={track.coverUrl}
              showFollow
              showArchive={false}
            />
            <OpenOnBandcampButton href={track.bcUrl} />
          </div>
          {!track.streamAvailable && (
            <p className="mt-3 text-xs text-fg-muted">
              No stream URL available yet. Press play to fetch one from Bandcamp.
            </p>
          )}
        </div>
      </section>

      {siblings.length > 1 && (
        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Tracks on this release
            </h2>
            <HidePlayedToggle count={hiddenSiblingCount} />
          </div>
          {visibleSiblings.length === 0 ? (
            <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-center text-sm text-fg-muted">
              All {siblings.length} tracks of this release already heard.
            </p>
          ) : (
            <div className="space-y-2">
              {visibleSiblings.map((s) => (
                <TrackRow
                  key={s.id}
                  track={{
                    id: s.id,
                    title: s.title,
                    artistName: s.artistName,
                    albumTitle: s.albumTitle,
                    durationSeconds: s.durationSeconds,
                    trackNumber: s.trackNumber,
                    coverUrl: s.coverUrl,
                    bcUrl: s.bcUrl,
                    hasStream: s.hasStream,
                    bcTrackId: s.bcTrackId,
                    hasBeenPlayed: s.hasBeenPlayed,
                    source: 'owned' as const,
                  }}
                  showArchive={false}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Best of all supporters
            {bestOf?.status === 'success' && (
              <span className="ml-2 normal-case text-fg-muted">
                · {bestOf.itemsAggregated} matches from {bestOf.supportersScanned} supporters
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {bestOf && bestOf.topItems.length > 0 && (
              <HidePlayedToggle count={hiddenBestOfCount} />
            )}
            <button
              type="button"
              onClick={runBestOf}
              disabled={bestOfRunning}
              className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              {bestOfRunning
                ? bestOf?.supportersTotal
                  ? `Scanning ${bestOf.supportersScanned}/${bestOf.supportersTotal}…`
                  : 'Scanning supporters…'
                : bestOf
                  ? 'Re-scan'
                  : 'Find best of supporters'}
            </button>
          </div>
        </div>
        {bestOfError && (
          <div className="mb-3 rounded border border-border-danger bg-bg-danger p-3 text-sm text-fg-danger">
            {bestOfError}
          </div>
        )}
        {!bestOf && !bestOfRunning && !bestOfError && (
          <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-4 text-xs text-fg-muted">
            Walks through every supporter of this track, fetches each one&apos;s recent
            collection, and ranks the items they collectively rate. Items shared by 2 or more
            supporters appear here. Crawl runs in the background — at ~350ms per profile, 100
            supporters take ~35s, 1000 take ~6min.
          </p>
        )}
        {bestOfRunning && bestOf?.status === 'running' && bestOf.supportersTotal && (
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-bg-elevated">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${Math.min(100, (bestOf.supportersScanned / bestOf.supportersTotal) * 100)}%`,
              }}
            />
          </div>
        )}
        {bestOf && bestOf.topItems.length > 0 && visibleBestOf && visibleBestOf.topItems.length === 0 && (
          <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-center text-sm text-fg-muted">
            All {bestOf.topItems.length} matches already heard. Toggle &ldquo;Hide
            played&rdquo; off to show them again.
          </p>
        )}
        {visibleBestOf && visibleBestOf.topItems.length > 0 && (
          <ul className="space-y-2">
            {visibleBestOf.topItems.map((item) => {
              // Match the queue entry by either synthetic id (-bcItemId) or
              // resolved local id (bcTrackId === item.bcItemId).
              const queueEntry = queue.find(
                (t) =>
                  t.id === -item.bcItemId ||
                  t.id === -1_000_000_000 - item.bcItemId ||
                  t.bcTrackId === item.bcItemId,
              );
              const rowIsCurrent =
                queueEntry != null && playerCurrentId === queueEntry.id;
              // For album rows: also visually "active" when a child track of
              // this album is playing (queue track has parentBcAlbumId match).
              // rowPlaying stays tied to rowIsCurrent so the parent's
              // play-button icon represents the parent's own state, not the
              // child's — clicking it always means "play this album from
              // the start".
              const currentQueueEntry = queue.find((t) => t.id === playerCurrentId);
              const rowAlbumPlaying =
                item.bcItemType === 'a' &&
                currentQueueEntry?.parentBcAlbumId === item.bcItemId;
              const rowActive = rowIsCurrent || rowAlbumPlaying;
              const rowPlaying = rowIsCurrent && playerIsPlaying;
              const isAlbum = item.bcItemType === 'a';
              // Albums are also playable now: clicking the play button kicks
              // off the album-expand flow in the player which fetches the
              // tracklist and starts the first track.
              const isPlayable = true;
              const isExpanded = expandedAlbumId === item.bcItemId || rowAlbumPlaying;
              const expandedTracks = albumTracksCache.get(item.bcItemId);
              return (
                <li
                  key={`${item.bcItemType}-${item.bcItemId}`}
                  className={`flex flex-col rounded-lg border bg-bg-surface ${
                    rowActive
                      ? 'border-accent'
                      : item.ownedByYou
                        ? 'border-accent/40'
                        : 'border-border'
                  }`}
                >
                  <div className="flex items-center gap-2 p-2">
                    <button
                      type="button"
                      onClick={() => playBestOfItem(item)}
                      disabled={!isPlayable}
                      title={
                        !isPlayable
                          ? 'Album — expand to play individual tracks'
                          : rowPlaying
                            ? 'Pause'
                            : 'Play'
                      }
                      aria-label={rowPlaying ? 'Pause' : 'Play'}
                      className={`flex h-9 w-9 flex-none items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30 ${
                        rowIsCurrent
                          ? 'border-accent bg-accent text-fg-on-accent hover:bg-accent-hover'
                          : 'border-border text-fg-secondary hover:border-accent hover:text-accent'
                      }`}
                    >
                      {rowPlaying ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                    <a
                      href={`/track/go?url=${encodeURIComponent(item.bcUrl)}`}
                      className="flex-none"
                      title="Open release (middle-click for new tab)"
                    >
                      {item.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.coverUrl}
                          alt=""
                          className="h-12 w-12 rounded object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded bg-bg-elevated" />
                      )}
                    </a>
                    <div className="min-w-0 flex-1">
                      <a
                        href={`/track/go?url=${encodeURIComponent(item.bcUrl)}`}
                        className={`flex max-w-full items-center gap-2 truncate text-left text-sm font-medium hover:underline ${
                          rowIsCurrent ? 'text-accent' : ''
                        }`}
                        title="Open track page (middle-click for new tab)"
                      >
                        {(item.hasBeenPlayed ||
                          (item.bcItemType === 't' &&
                            playedBcTrackIds.has(item.bcItemId)) ||
                          (item.bcItemType === 'a' &&
                            isAlbumFullyHeardLive(item.bcItemId))) && (
                          <PlayedCheck
                            trackId={
                              item.bcItemType === 't' &&
                              queueEntry &&
                              !queueEntry.needsResolve
                                ? queueEntry.id
                                : null
                            }
                            bcTrackId={
                              item.bcItemType === 't' ? item.bcItemId : null
                            }
                            tooltip={
                              item.bcItemType === 'a' &&
                              item.albumTotalCount != null
                                ? `All ${item.albumTotalCount} tracks heard`
                                : undefined
                            }
                          />
                        )}
                        <span className="truncate">{item.title}</span>
                        {isAlbum && (
                          <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
                            EP
                          </span>
                        )}
                      </a>
                      <BestOfArtistLink
                        artistName={item.artistName}
                        artistBcBandId={item.artistBcBandId ?? null}
                        bcUrl={item.bcUrl}
                      />
                      {item.labelName && (
                        <BestOfLabelLink
                          labelId={item.labelId ?? null}
                          labelName={item.labelName}
                        />
                      )}
                      {item.releasedAt && (
                        <div className="truncate text-xs text-fg-muted" title={`Released ${item.releasedAt}`}>
                          <span className="opacity-60">released</span> {formatReleasedShort(item.releasedAt)}
                        </div>
                      )}
                      {item.ownedByYou && !rowIsCurrent && (
                        <div className="text-xs text-accent">You own this</div>
                      )}
                    </div>
                    <span className="flex-none rounded-full bg-accent/20 px-2 py-0.5 text-xs font-mono text-accent">
                      {item.matchCount}×
                    </span>
                    {isAlbum && (
                      <button
                        type="button"
                        onClick={() => toggleAlbumExpand(item)}
                        disabled={albumLoadingId === item.bcItemId}
                        title={isExpanded ? 'Hide tracks' : 'Show tracks'}
                        aria-label={isExpanded ? 'Collapse album' : 'Expand album'}
                        aria-expanded={isExpanded}
                        className="flex h-9 w-9 flex-none items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-primary disabled:opacity-50"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    )}
                    <TrackActionsBar
                      bcUrl={item.bcUrl}
                      bcTrackId={item.bcItemType === 't' ? item.bcItemId : null}
                      localTrackId={
                        queueEntry && !queueEntry.needsResolve ? queueEntry.id : null
                      }
                      title={item.title}
                      artistName={item.artistName}
                      albumTitle={null}
                      coverUrl={item.coverUrl}
                      showFollow
                      labelBcUrl={item.labelBcUrl ?? null}
                      
                    />
                  </div>
                  {isAlbum && isExpanded && (
                    <div className="border-t border-border px-2 pb-2">
                      {albumLoadingId === item.bcItemId && (
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
                        <div className="mt-2 space-y-1">
                          {expandedTracks.map((tr) => (
                            <AlbumTrackRow
                              key={tr.bcTrackId}
                              track={tr}
                              siblings={expandedTracks}
                              albumCoverUrl={item.coverUrl}
                              buildQueueOnPlay={() =>
                                buildBestOfQueueWithExpansion(
                                  bestOf?.topItems ?? [],
                                  item.bcItemId,
                                  expandedTracks,
                                )
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {bestOf && bestOf.topItems.length === 0 && bestOf.status === 'success' && (
          <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-4 text-xs text-fg-muted">
            Scanned {bestOf.supportersScanned} supporters but no items appeared in 2 or more
            collections. Try re-scanning later.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Supporters {supporters.length > 0 && `· ${supporters.length}${supportersMore ? '+' : ''}`}
        </h2>
        {supportersError ? (
          <div className="rounded border border-border-danger bg-bg-danger p-3 text-sm text-fg-danger">
            {supportersError}
          </div>
        ) : supporters.length === 0 && !supportersLoading ? (
          <p className="text-sm text-fg-muted">No supporters listed yet.</p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {supporters.map((s) => (
                <li
                  key={`${s.fanId}-${s.username}`}
                  className="flex items-center gap-2 rounded border border-border bg-bg-surface px-2 py-2"
                >
                  {s.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.imageUrl}
                      alt=""
                      className="h-8 w-8 flex-none rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-8 w-8 flex-none rounded-full bg-bg-elevated" />
                  )}
                  <Link
                    href={`/u/${encodeURIComponent(s.username)}`}
                    className="min-w-0 flex-1 truncate text-sm hover:text-accent"
                    title={s.displayName ?? s.username}
                  >
                    {s.displayName ?? s.username}
                  </Link>
                </li>
              ))}
            </ul>
            {supportersLoading && (
              <p className="mt-3 text-xs text-fg-muted">Loading more supporters…</p>
            )}
          </>
        )}
      </section>

    </>
  );
}
