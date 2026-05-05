'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import TrackRow, { type TrackRowData } from '@/components/TrackRow';
import HidePlayedToggle from '@/components/HidePlayedToggle';
import Tooltip from '@/components/Tooltip';
import TrackListSearch from '@/components/TrackListSearch';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts } from '@/lib/store/hooks';
import type { ArtistRow, DiggerRow, LabelRow } from '@/lib/entities/store';
import type { DiggerCandidate } from '@/lib/sync/diggers';
import { detectLookupTarget } from '@/lib/lookup/detect';
import { loadPreferences, usePreferences } from '@/lib/settings/preferences';

type Tab = 'tracks' | 'follows' | 'diggers' | 'lookup';

interface DiscoveryRun {
  id: number;
  status: 'running' | 'success' | 'error';
  startedAt: string;
  finishedAt: string | null;
  itemsSynced: number;
  itemsTotalKnown: number | null;
  errorMessage: string | null;
}

interface DiscoveredTrackRow {
  id: number;
  bcTrackId: number;
  title: string;
  artistName: string | null;
  albumTitle: string | null;
  coverUrl: string | null;
  bcUrl: string;
  durationSeconds: number | null;
  trackNumber: number | null;
  hasStream: boolean;
  hasBeenPlayed?: boolean;
  discoveredVia?: string | null;
  discoveredViaName?: string | null;
  discoveredViaBcFanId?: number | null;
  bpm?: number | null;
}

interface Props {
  tab: Tab;
  tracks: DiscoveredTrackRow[];
  tracksTotal: number;
  followedArtists: ArtistRow[];
  followedLabels: LabelRow[];
  followedDiggers: DiggerRow[];
  curators: DiggerCandidate[];
}

const CURATORS_SEEN_EVENT = 'unfck:curators-seen-changed';
const TRACKS_SEEN_EVENT = 'unfck:tracks-seen-changed';

function useStoredSeenSet(storageKey: string, eventName: string): Set<number> {
  const [seen, setSeen] = useState<Set<number>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem(storageKey);
      return new Set(
        raw ? (JSON.parse(raw) as number[]).filter((n) => Number.isInteger(n)) : [],
      );
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    function refresh() {
      try {
        const raw = localStorage.getItem(storageKey);
        setSeen(
          new Set(
            raw ? (JSON.parse(raw) as number[]).filter((n) => Number.isInteger(n)) : [],
          ),
        );
      } catch {
        setSeen(new Set());
      }
    }
    window.addEventListener(eventName, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(eventName, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [storageKey, eventName]);
  return seen;
}

export default function DiscoverHub(props: Props) {
  const params = useSearchParams();
  // Tab counters honour the same client-side filters the lists do, so the
  // badge stays in sync as the user marks rows as seen.
  // Keep this key in sync with DIGGERS_SEEN_KEY below — the sub-tab
  // writes there and dispatches CURATORS_SEEN_EVENT; the hub listens
  // and reads the same bucket so the tab badge updates with the list.
  const seenCurators = useStoredSeenSet('unfck.curators.seen.v1', CURATORS_SEEN_EVENT);
  const seenTracks = useStoredSeenSet('unfck.tracks.seen.v1', TRACKS_SEEN_EVENT);

  function tabHref(t: Tab): string {
    const sp = new URLSearchParams(params?.toString() ?? '');
    if (t === 'tracks') sp.delete('tab');
    else sp.set('tab', t);
    const qs = sp.toString();
    return qs ? `/discover?${qs}` : '/discover';
  }

  const visibleCuratorCount = props.curators.filter(
    (c) => !c.isFollowed && !seenCurators.has(c.diggerId),
  ).length;
  const visibleTrackCount = props.tracks.filter(
    (t) => !seenTracks.has(t.id),
  ).length;

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'tracks', label: 'New tracks', count: visibleTrackCount },
    {
      id: 'follows',
      label: 'Follows',
      count:
        props.followedArtists.length +
        props.followedLabels.length +
        props.followedDiggers.length,
    },
    { id: 'diggers', label: 'Curators', count: visibleCuratorCount },
    { id: 'lookup', label: 'Lookup', count: 0 },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={tabHref(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none ${
              props.tab === t.id
                ? 'border-accent text-fg-primary'
                : 'border-transparent text-fg-secondary hover:text-fg-primary'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                  props.tab === t.id ? 'bg-accent/20 text-accent' : 'bg-bg-elevated text-fg-muted'
                }`}
              >
                {t.count}
              </span>
            )}
          </Link>
        ))}
      </div>

      {props.tab === 'tracks' && (
        <TracksTab
          tracks={props.tracks}
          followCount={
            props.followedArtists.length +
            props.followedLabels.length +
            props.followedDiggers.length
          }
        />
      )}
      {props.tab === 'follows' && (
        <FollowsTab
          initialArtists={props.followedArtists}
          initialLabels={props.followedLabels}
          initialDiggers={props.followedDiggers}
        />
      )}
      {props.tab === 'diggers' && <DiggersTab initialDiggers={props.curators} />}
      {props.tab === 'lookup' && <LookupTab />}
    </div>
  );
}

function LookupTab() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  async function lookupTrackOrAlbum(value: string) {
    const res = await fetch('/api/track/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: value }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      result?: { trackId: number; bcTrackId?: number };
      error?: string;
    };
    if (!res.ok || !json.ok || !json.result) {
      throw new Error(json.error ?? `Lookup failed (${res.status})`);
    }
    router.push(`/track/${json.result.bcTrackId ?? json.result.trackId}`);
  }

  async function lookupBand(bcUrl: string) {
    const res = await fetch('/api/lookup/band', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bcUrl }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      bcBandId?: number;
      error?: string;
    };
    if (!res.ok || !json.ok || !json.bcBandId) {
      throw new Error(json.error ?? `Band lookup failed (${res.status})`);
    }
    router.push(`/artist/${json.bcBandId}`);
  }

  async function submit() {
    const value = input.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const target = detectLookupTarget(value);
      switch (target.kind) {
        case 'track':
        case 'album':
          setHint(target.kind === 'album' ? 'Resolving album…' : 'Resolving track…');
          await lookupTrackOrAlbum(target.bcUrl);
          break;
        case 'numeric':
          setHint('Resolving track id…');
          await lookupTrackOrAlbum(String(target.bcTrackId));
          break;
        case 'band':
          setHint('Resolving artist / label…');
          await lookupBand(target.bcUrl);
          break;
        case 'fan':
          router.push(`/u/${encodeURIComponent(target.username)}`);
          break;
        case 'unknown':
          setError(`Could not interpret input: ${target.reason}`);
          break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-bg-surface p-5">
        <label htmlFor="discover-lookup" className="text-sm font-semibold">
          Look up any Bandcamp link
        </label>
        <p className="mt-1 text-xs text-fg-muted">
          Paste a track, album, artist or label URL, a fan profile, or a
          numeric track id. The router picks the right destination: track /
          album lands on the track-permalink with siblings and supporters,
          artist / label opens that page, fan profiles drop into the curator
          view.
        </p>
        {/* suppressHydrationWarning on the wrapping div + input/button:
            Dashlane (and similar password-manager extensions) inject
            `data-dashlane-rid` / `data-dashlane-label` attributes on
            input fields before React hydrates, which triggers a
            hydration-mismatch warning. Suppressing on the affected
            nodes only — the rest of the tree stays strict. */}
        <div className="mt-3 flex gap-2" suppressHydrationWarning>
          <input
            id="discover-lookup"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="bandcamp URL · numeric track id"
            className="flex-1 rounded border border-border bg-bg-base px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
            autoFocus
            suppressHydrationWarning
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy || !input.trim()}
            className="rounded bg-accent px-5 py-2 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
            suppressHydrationWarning
          >
            {busy ? hint ?? 'Looking up…' : 'Look up'}
          </button>
        </div>
        {error && (
          <div className="mt-3 rounded border border-border-danger bg-bg-danger p-3 text-sm text-fg-danger">
            {error}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-bg-surface p-5 text-sm text-fg-secondary">
        <div className="font-semibold text-fg-primary">Supported inputs</div>
        <ul className="mt-2 list-inside list-disc space-y-1 text-fg-secondary">
          <li>
            <code className="font-mono text-xs">artist.bandcamp.com/track/...</code>
            {' '}or{' '}
            <code className="font-mono text-xs">/album/...</code>
            {' '}— track and album permalinks land on the result page with siblings and supporters.
          </li>
          <li>
            <code className="font-mono text-xs">artist.bandcamp.com</code>
            {' '}— artist or label root, opens the artist / imprint page with all releases.
          </li>
          <li>
            <code className="font-mono text-xs">bandcamp.com/username</code>
            {' '}— fan / curator profile, opens recent collection plus crawl entry point.
          </li>
          <li>Numeric BC track id — legacy shortcut.</li>
        </ul>
      </section>
    </div>
  );
}

const TRACKS_SEEN_KEY = 'unfck.tracks.seen.v1';

function loadTrackSeenIds(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(TRACKS_SEEN_KEY);
    return new Set(
      raw ? (JSON.parse(raw) as number[]).filter((n) => Number.isInteger(n)) : [],
    );
  } catch {
    return new Set();
  }
}

function saveTrackSeenIds(ids: Set<number>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TRACKS_SEEN_KEY, JSON.stringify([...ids]));
    window.dispatchEvent(new CustomEvent(TRACKS_SEEN_EVENT));
  } catch {
    // ignore
  }
}

function TracksTab({
  tracks,
  followCount,
}: {
  tracks: DiscoveredTrackRow[];
  followCount: number;
}) {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const playedBcTrackIds = usePlayerStore((s) => s.playedBcTrackIds);
  const markPlayed = usePlayerStore((s) => s.markPlayed);
  const [prefs] = usePreferences();
  const router = useRouter();
  const [progress, setProgress] = useState<DiscoveryRun | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  // Multi-select + soft-dismiss for the New tracks list. Same pattern as
  // the Curators tab: pick rows, "Mark seen" hides them locally until the
  // next discovery sync wipes the seen-set; "Mark as played" calls /api/plays
  // so the green checkmark sticks across reloads and the row drops out of
  // the Hide-played view too.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [seenTracks, setSeenTracks] = useState<Set<number>>(() => loadTrackSeenIds());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Per-call discovery caps. localStorage-persisted so the user picks
  // once and forgets. Defaults match the server's env-var defaults
  // (12 per artist, 200 per curator) — chosen so a fresh user with a
  // dozen follows finishes the first sync in under a minute.
  const [perArtist, setPerArtist] = useState(12);
  const [perDigger, setPerDigger] = useState(200);
  useEffect(() => {
    const a = Number(localStorage.getItem('unfck.discovery.per_artist'));
    if (Number.isInteger(a) && a > 0) setPerArtist(a);
    const d = Number(localStorage.getItem('unfck.discovery.per_digger'));
    if (Number.isInteger(d) && d > 0) setPerDigger(d);
  }, []);
  function saveCap(key: 'per_artist' | 'per_digger', value: number) {
    localStorage.setItem(`unfck.discovery.${key}`, String(value));
  }
  useGlobalPlaybackShortcuts();

  // On mount, hydrate progress state from the server: if a sync was kicked
  // off and the page navigated away, the user comes back to a live bar.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/sync/discovery')
      .then((r) => r.json() as Promise<{ ok?: boolean; run?: DiscoveryRun | null }>)
      .then((j) => {
        if (cancelled || !j.ok || !j.run) return;
        if (j.run.status === 'running') setProgress(j.run);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll the run row every 1.5s while a sync is running. Stops as soon as
  // the row reports success/error. This is the same cadence the Best-of
  // supporters polling uses and gives the user a steadily-advancing bar.
  useEffect(() => {
    if (!progress || progress.status !== 'running') return;
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch('/api/sync/discovery');
        if (!res.ok) return;
        const j = (await res.json()) as { ok?: boolean; run?: DiscoveryRun | null };
        if (!j.ok || !j.run) return;
        setProgress(j.run);
        if (j.run.status !== 'running') {
          window.clearInterval(interval);
          if (j.run.status === 'success') {
            setSyncMessage(
              `${j.run.itemsSynced} releases crawled. New tracks loaded.`,
            );
            // Fresh discovery → clear the seen-set so any track that's
            // actually still here gets another look.
            setSeenTracks(new Set());
            saveTrackSeenIds(new Set());
            setSelected(new Set());
            router.refresh();
          } else if (j.run.status === 'error') {
            setSyncMessage(j.run.errorMessage ?? 'Discovery sync failed');
          }
        }
      } catch {
        // ignore — next tick retries
      }
    }, 1500);
    return () => window.clearInterval(interval);
  }, [progress, router]);

  async function refreshDiscovery() {
    setSyncMessage(null);
    try {
      const res = await fetch('/api/sync/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releasesPerArtist: perArtist,
          releasesPerDigger: perDigger,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        runId?: number;
        totalEstimate?: number;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.runId) {
        setSyncMessage(json.error ?? `Sync failed (${res.status})`);
        return;
      }
      // Seed the progress bar with the estimated total. The next poll tick
      // will replace this with live numbers from sync_runs.
      setProgress({
        id: json.runId,
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        itemsSynced: 0,
        itemsTotalKnown: json.totalEstimate ?? null,
        errorMessage: null,
      });
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Sync failed');
    }
  }

  const syncing = progress?.status === 'running';

  // Memoize so the queue array identity is stable across renders that don't
  // change `tracks`; otherwise the effect below fires every render and flips
  // the player queue back, racing with the user's actions.
  const queue = useMemo<TrackRowData[]>(
    () =>
      tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artistName: t.artistName,
        albumTitle: t.albumTitle,
        durationSeconds: t.durationSeconds,
        trackNumber: t.trackNumber,
        coverUrl: t.coverUrl,
        bcUrl: t.bcUrl,
        hasStream: t.hasStream,
        bcTrackId: t.bcTrackId,
        hasBeenPlayed: t.hasBeenPlayed,
        discoveredVia: t.discoveredVia,
        discoveredViaName: t.discoveredViaName,
        discoveredViaBcFanId: t.discoveredViaBcFanId,
        bpm: t.bpm,
        source: 'discovered' as const,
      })),
    [tracks],
  );

  useEffect(() => {
    setQueue(queue);
  }, [queue, setQueue]);

  const [search, setSearch] = useState('');
  const visibleQueue = useMemo(() => {
    const q = search.trim().toLowerCase();
    return queue.filter((t) => {
      if (seenTracks.has(t.id)) return false;
      if (
        prefs.hidePlayed &&
        (t.hasBeenPlayed || (t.bcTrackId != null && playedBcTrackIds.has(t.bcTrackId)))
      ) {
        return false;
      }
      if (q) {
        const haystack =
          `${t.title} ${t.artistName ?? ''} ${t.albumTitle ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [queue, prefs.hidePlayed, playedBcTrackIds, seenTracks, search]);
  const hiddenCount = queue.length - visibleQueue.length;

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    if (visibleQueue.every((t) => selected.has(t.id)) && visibleQueue.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleQueue.map((t) => t.id)));
    }
  }
  function markSeen(ids: number[]) {
    setSeenTracks((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      saveTrackSeenIds(next);
      return next;
    });
    setSelected(new Set());
  }
  async function markPlayedSelected() {
    const targets = visibleQueue.filter(
      (t) => selected.has(t.id) && t.bcTrackId != null,
    );
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      // Fire all play-records in parallel — server is local SQLite, no
      // rate limit concern, and we want this to feel instant on dozens of
      // selections. Each successful POST also flips the live played-set
      // so the green check renders without a reload.
      await Promise.all(
        targets.map(async (t) => {
          const res = await fetch('/api/plays', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bcTrackId: t.bcTrackId,
              bcUrl: t.bcUrl,
              durationListenedSeconds: t.durationSeconds ?? 1,
              completedPct: 1,
            }),
          });
          if (res.ok && t.bcTrackId != null) markPlayed(t.bcTrackId);
        }),
      );
    } finally {
      setBulkBusy(false);
      setSelected(new Set());
    }
  }

  const discoverControls = (
    <div className="flex flex-wrap items-end gap-3">
      <button
        type="button"
        onClick={refreshDiscovery}
        disabled={syncing || followCount === 0}
        title={
          followCount === 0
            ? 'Follow at least one artist, label, or curator first (Follows tab)'
            : 'Crawl every followed source and pull in new releases'
        }
        className="rounded bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {syncing
          ? progress && progress.itemsTotalKnown
            ? `Crawling ${progress.itemsSynced}/${progress.itemsTotalKnown}…`
            : `Crawling${progress ? ` ${progress.itemsSynced}` : ''}…`
          : 'Discover'}
      </button>
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        <span>Releases / artist</span>
        <input
          type="number"
          min={1}
          max={200}
          value={perArtist}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n > 0) {
              setPerArtist(n);
              saveCap('per_artist', n);
            }
          }}
          className="w-20 rounded border border-border bg-bg-base px-2 py-1 font-mono text-sm text-fg-primary focus:border-accent focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        <span>Releases / curator</span>
        <input
          type="number"
          min={1}
          max={1000}
          value={perDigger}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n > 0) {
              setPerDigger(n);
              saveCap('per_digger', n);
            }
          }}
          className="w-20 rounded border border-border bg-bg-base px-2 py-1 font-mono text-sm text-fg-primary focus:border-accent focus:outline-none"
        />
      </label>
    </div>
  );

  if (tracks.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-bg-surface p-6">
        <h2 className="text-xl font-semibold">Nothing here yet</h2>
        <p className="mt-2 text-sm text-fg-secondary">
          Follow artists, labels, or curators in the{' '}
          <Link href="/discover?tab=follows" className="text-accent underline">
            Follows
          </Link>{' '}
          tab, then click <strong>Discover</strong> to crawl new releases.
          Curators contribute the most-recent slice of their collection.
        </p>
        <div className="mt-4">{discoverControls}</div>
        {syncMessage && (
          <p className="mt-3 text-xs text-fg-muted">{syncMessage}</p>
        )}
        {syncing && progress && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-bg-elevated">
              <div
                className="h-full bg-accent transition-all"
                style={{
                  width: progress.itemsTotalKnown
                    ? `${Math.min(100, (progress.itemsSynced / progress.itemsTotalKnown) * 100)}%`
                    : '15%',
                }}
              />
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>{discoverControls}</div>
        <div className="flex items-center gap-2">
          {syncMessage && (
            <span className="text-xs text-fg-muted">{syncMessage}</span>
          )}
          <HidePlayedToggle count={hiddenCount} />
        </div>
      </div>
      {syncing && progress && (
        <div className="mb-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-elevated">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: progress.itemsTotalKnown
                  ? `${Math.min(100, (progress.itemsSynced / progress.itemsTotalKnown) * 100)}%`
                  : '15%',
              }}
            />
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            {progress.itemsTotalKnown
              ? `Crawling ${progress.itemsSynced} of ${progress.itemsTotalKnown} releases — Bandcamp rate-limits to ~3 fetches per second, so a few hundred releases take ~30-60s.`
              : `Crawling… ${progress.itemsSynced} releases fetched`}
          </div>
        </div>
      )}
      <TrackListSearch
        value={search}
        onChange={setSearch}
        total={queue.length}
        visible={visibleQueue.length}
      />
      {visibleQueue.length === 0 ? (
        <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
          {search.trim()
            ? `No tracks match "${search}".`
            : seenTracks.size > 0
              ? `All ${queue.length} discovered tracks marked as seen or already heard. Refresh discovery to pull more.`
              : `All ${queue.length} discovered tracks already heard. Toggle "Hide played" off to show them again.`}
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="rounded border border-border bg-bg-elevated px-3 py-1 transition-colors hover:bg-bg-hover"
            >
              {visibleQueue.every((t) => selected.has(t.id)) && visibleQueue.length > 0
                ? 'Deselect all'
                : 'Select all'}
            </button>
            {selected.size > 0 && (
              <>
                <span className="text-xs text-fg-muted">{selected.size} selected</span>
                <button
                  type="button"
                  onClick={markPlayedSelected}
                  disabled={bulkBusy}
                  className="rounded bg-accent px-3 py-1 text-xs font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  Mark as played
                </button>
                <button
                  type="button"
                  onClick={() => markSeen([...selected])}
                  disabled={bulkBusy}
                  className="inline-flex items-center gap-1 rounded border border-border bg-bg-elevated px-3 py-1 text-xs transition-colors hover:bg-bg-hover disabled:opacity-50"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                  Mark seen
                </button>
              </>
            )}
          </div>
          <div className="space-y-2">
            {visibleQueue.map((t) => (
              <TrackRow
                key={t.id}
                track={t}
                selectable={{
                  selected: selected.has(t.id),
                  onToggle: () => toggleSelected(t.id),
                  label: `Select ${t.title}`,
                }}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

interface FollowsTabProps {
  initialArtists: ArtistRow[];
  initialLabels: LabelRow[];
  initialDiggers: DiggerRow[];
}

type EntityType = 'artist' | 'label' | 'digger';

function FollowsTab({ initialArtists, initialLabels, initialDiggers }: FollowsTabProps) {
  const [selectedFollows, setSelectedFollows] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  function toggleFollowSelected(id: number) {
    setSelectedFollows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [subTab, setSubTab] = useState<EntityType>('artist');
  const [artists, setArtists] = useState(initialArtists);
  const [labels, setLabels] = useState(initialLabels);
  const [curators, setDiggers] = useState(initialDiggers);
  const [bcUrl, setBcUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function refreshAll() {
    const res = await fetch('/api/follow');
    if (!res.ok) return;
    const json = (await res.json()) as {
      artists?: ArtistRow[];
      labels?: LabelRow[];
      curators?: DiggerRow[];
    };
    setArtists(json.artists ?? []);
    setLabels(json.labels ?? []);
    setDiggers(json.curators ?? []);
  }

  async function handleAdd() {
    if (!bcUrl.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const prefs = loadPreferences();
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: subTab,
          bcUrl: bcUrl.trim(),
          mirrorToBandcamp: prefs.mirrorFollowsToBandcamp,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        bcMirrorWarning?: string | null;
      };
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? `Add failed (${res.status})`);
      } else {
        setBcUrl('');
        if (json.bcMirrorWarning) {
          setMessage(`Added locally. ${json.bcMirrorWarning}`);
        }
        await refreshAll();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleUnfollow(entityType: EntityType, entityId: number) {
    const prefs = loadPreferences();
    const qs = new URLSearchParams({
      entityType,
      entityId: String(entityId),
    });
    if (prefs.mirrorFollowsToBandcamp) qs.set('mirrorToBandcamp', '1');
    const res = await fetch(`/api/follow?${qs.toString()}`, { method: 'DELETE' });
    if (res.ok) {
      const json = (await res.json()) as { bcMirrorWarning?: string | null };
      if (json.bcMirrorWarning) setMessage(json.bcMirrorWarning);
      await refreshAll();
    }
  }

  async function triggerDiscoverySync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sync/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json = (await res.json()) as {
        ok?: boolean;
        artistsCrawled?: number;
        diggersCrawled?: number;
        releasesFetched?: number;
        tracksWritten?: number;
        durationMs?: number;
        errors?: { error: string }[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? `Discovery sync failed (${res.status})`);
      } else {
        const seconds = ((json.durationMs ?? 0) / 1000).toFixed(1);
        const errCount = json.errors?.length ?? 0;
        const sources: string[] = [];
        if (json.artistsCrawled) sources.push(`${json.artistsCrawled} artists`);
        if (json.diggersCrawled) sources.push(`${json.diggersCrawled} curators`);
        const sourceLabel = sources.length > 0 ? sources.join(' + ') : '0 follows';
        setMessage(
          `${sourceLabel} / ${json.releasesFetched ?? 0} releases / ${json.tracksWritten ?? 0} tracks in ${seconds}s` +
            (errCount > 0 ? ` (${errCount} errors)` : ''),
        );
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Discovery sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const counts = {
    artist: artists.length,
    label: labels.length,
    digger: curators.length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        {(['artist', 'label', 'digger'] as EntityType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSubTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              subTab === t
                ? 'border-accent text-fg-primary'
                : 'border-transparent text-fg-secondary hover:text-fg-primary'
            }`}
          >
            {t === 'artist' ? 'Artists' : t === 'label' ? 'Labels' : 'Curators'}
            <span className="ml-1 text-xs text-fg-muted">{counts[t]}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={triggerDiscoverySync}
            disabled={
              syncing ||
              (artists.length === 0 && labels.length === 0 && curators.length === 0)
            }
            title={
              artists.length === 0 && labels.length === 0 && curators.length === 0
                ? 'Follow at least one artist, label, or curator to enable discovery'
                : 'Crawl every followed artist + curator and pull in their recent releases'
            }
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {syncing ? 'Crawling…' : 'Refresh discovery'}
          </button>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-bg-surface p-4">
        <h3 className="text-base font-semibold">
          Add{' '}
          {subTab === 'artist' ? 'artist URL' : subTab === 'label' ? 'label URL' : 'curator URL'}
        </h3>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={bcUrl}
            onChange={(e) => setBcUrl(e.target.value)}
            placeholder={
              subTab === 'digger'
                ? 'https://bandcamp.com/<username>'
                : 'https://<subdomain>.bandcamp.com'
            }
            className="flex-1 rounded border border-border bg-bg-base px-3 py-2 text-sm font-mono text-fg-primary focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={busy || !bcUrl.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Follow'}
          </button>
        </div>
      </section>

      {message && (
        <div className="rounded border border-border bg-bg-surface p-3 text-sm text-fg-secondary">
          {message}
        </div>
      )}

      {(() => {
        const visible: { id: number; type: EntityType; key: string }[] =
          subTab === 'artist'
            ? artists.map((a) => ({ id: a.id, type: 'artist', key: `a-${a.id}` }))
            : subTab === 'label'
              ? labels.map((l) => ({ id: l.id, type: 'label', key: `l-${l.id}` }))
              : curators.map((d) => ({ id: d.id, type: 'digger', key: `d-${d.id}` }));
        const allSelected =
          visible.length > 0 && visible.every((v) => selectedFollows.has(v.id));
        function toggleSelectAllFollows() {
          if (allSelected) {
            setSelectedFollows(new Set());
          } else {
            setSelectedFollows(new Set(visible.map((v) => v.id)));
          }
        }
        async function bulkUnfollowSelected() {
          const targets = visible.filter((v) => selectedFollows.has(v.id));
          if (targets.length === 0) return;
          setBulkBusy(true);
          try {
            for (const t of targets) {
              await handleUnfollow(t.type, t.id);
            }
          } finally {
            setBulkBusy(false);
            setSelectedFollows(new Set());
          }
        }
        return (
          <>
            {visible.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={toggleSelectAllFollows}
                  className="rounded border border-border bg-bg-elevated px-3 py-1 transition-colors hover:bg-bg-hover"
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
                {selectedFollows.size > 0 && (
                  <>
                    <span className="text-xs text-fg-muted">
                      {selectedFollows.size} selected
                    </span>
                    <button
                      type="button"
                      onClick={bulkUnfollowSelected}
                      disabled={bulkBusy}
                      className="rounded border border-border-danger bg-bg-elevated px-3 py-1 text-xs text-fg-danger transition-colors hover:bg-bg-hover disabled:opacity-50"
                    >
                      Unfollow {selectedFollows.size}
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="space-y-2">
              {subTab === 'artist' &&
                artists.map((a) => (
                  <EntityCard
                    key={a.id}
                    imageUrl={a.imageUrl}
                    title={a.name}
                    subtitle={a.bcUrl}
                    selected={selectedFollows.has(a.id)}
                    onSelect={() => toggleFollowSelected(a.id)}
                    onUnfollow={() => handleUnfollow('artist', a.id)}
                  />
                ))}
              {subTab === 'label' &&
                labels.map((l) => (
                  <EntityCard
                    key={l.id}
                    imageUrl={l.imageUrl}
                    title={l.name}
                    subtitle={l.bcUrl}
                    selected={selectedFollows.has(l.id)}
                    onSelect={() => toggleFollowSelected(l.id)}
                    onUnfollow={() => handleUnfollow('label', l.id)}
                  />
                ))}
              {subTab === 'digger' &&
                curators.map((d) => (
                  <EntityCard
                    key={d.id}
                    imageUrl={d.imageUrl}
                    title={d.displayName ?? d.bcUsername}
                    subtitle={`bandcamp.com/${d.bcUsername}`}
                    href={d.bcFanId ? `/digger/${d.bcFanId}` : `/u/${encodeURIComponent(d.bcUsername)}`}
                    selected={selectedFollows.has(d.id)}
                    onSelect={() => toggleFollowSelected(d.id)}
                    onUnfollow={() => handleUnfollow('digger', d.id)}
                  />
                ))}
            </div>
          </>
        );
      })()}

      <div className="space-y-2">{/* sentinel for empty-state below */}
        {((subTab === 'artist' && artists.length === 0) ||
          (subTab === 'label' && labels.length === 0) ||
          (subTab === 'digger' && curators.length === 0)) && (
          <div className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
            <p>
              No {subTab === 'artist' ? 'artists' : subTab === 'label' ? 'labels' : 'diggers'}{' '}
              followed yet.
            </p>
            <p className="mt-2">
              {subTab === 'digger'
                ? 'Curators are Bandcamp users with overlapping taste. Switch to the Curators tab above to scan supporters of your library.'
                : (
                  <>
                    Pull every {subTab === 'artist' ? 'artist' : 'label'} you
                    follow on bandcamp.com via{' '}
                    <a className="text-accent underline" href="/setup">
                      Setup &rarr; Import follows
                    </a>
                    , or paste a profile URL in Lookup above.
                  </>
                )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface EntityCardProps {
  imageUrl: string | null;
  title: string;
  subtitle: string;
  href?: string;
  selected?: boolean;
  onSelect?: () => void;
  onUnfollow: () => void;
}

function EntityCard({
  imageUrl,
  title,
  subtitle,
  href,
  selected,
  onSelect,
  onUnfollow,
}: EntityCardProps) {
  const inner = (
    <>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="h-12 w-12 flex-none rounded object-cover" />
      ) : (
        <div className="h-12 w-12 flex-none rounded bg-bg-elevated" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-xs text-fg-muted">{subtitle}</div>
      </div>
    </>
  );
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
        selected
          ? 'border-accent bg-bg-elevated'
          : 'border-border bg-bg-surface'
      }`}
    >
      {onSelect && (
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={onSelect}
          className="h-4 w-4 flex-none cursor-pointer accent-accent"
          aria-label={`Select ${title}`}
        />
      )}
      {href ? (
        <Link
          href={href}
          className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-90"
        >
          {inner}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{inner}</div>
      )}
      <button
        type="button"
        onClick={onUnfollow}
        className="rounded border border-border px-3 py-1 text-xs text-fg-secondary transition-colors hover:border-border-danger hover:text-fg-danger"
      >
        Unfollow
      </button>
    </div>
  );
}

type DiggerSource = 'owned' | 'wishlist' | 'playlist';

interface PlaylistOption {
  id: number;
  name: string;
}

const DIGGERS_SEEN_KEY = 'unfck.curators.seen.v1';

function loadSeenIds(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DIGGERS_SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as number[];
    return new Set(arr.filter((n) => Number.isInteger(n)));
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids: Set<number>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DIGGERS_SEEN_KEY, JSON.stringify([...ids]));
    // Notify the tab-counter (and any other listeners) that the
    // session-seen set just changed so they can re-render.
    window.dispatchEvent(new CustomEvent(CURATORS_SEEN_EVENT));
  } catch {
    // ignore quota errors
  }
}

function DiggersTab({ initialDiggers }: { initialDiggers: DiggerCandidate[] }) {
  const router = useRouter();
  const [curators, setDiggers] = useState(initialDiggers);
  const [crawling, setCrawling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState<Set<number>>(new Set());
  const [ignoreBusy, setIgnoreBusy] = useState<Set<number>>(new Set());
  const [source, setSource] = useState<DiggerSource>('owned');
  const [playlists, setPlaylists] = useState<PlaylistOption[]>([]);
  const [playlistId, setPlaylistId] = useState<number | null>(null);
  // Multi-select + soft-dismiss state. `selected` is per-render, `seen`
  // persists in localStorage so a refresh doesn't reset the user's
  // session-level "I've reviewed these" decisions. Seen IDs are wiped
  // when the user runs Find curators again — they'll see the same curators
  // resurface only if they're still good matches.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [seen, setSeen] = useState<Set<number>>(() => loadSeenIds());
  const [hideFollowed, setHideFollowed] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Lazy-load the playlist list the first time the user picks "playlist"
  // so the tab itself stays cheap to render.
  useEffect(() => {
    if (source !== 'playlist' || playlists.length > 0) return;
    let cancelled = false;
    void fetch('/api/playlists')
      .then((r) => r.json() as Promise<{ playlists?: PlaylistOption[] }>)
      .then((j) => {
        if (cancelled) return;
        const list = j.playlists ?? [];
        setPlaylists(list);
        if (list.length > 0 && playlistId == null) setPlaylistId(list[0].id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [source, playlists.length, playlistId]);

  async function refresh() {
    if (source === 'playlist' && playlistId == null) {
      setMessage('Pick a playlist first.');
      return;
    }
    setCrawling(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sync/diggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          ...(source === 'playlist' ? { playlistId } : {}),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        itemsCrawled?: number;
        collectorsSeen?: number;
        diggersWritten?: number;
        durationMs?: number;
        errors?: { error: string }[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? `Crawl failed (${res.status})`);
      } else {
        const seconds = ((json.durationMs ?? 0) / 1000).toFixed(1);
        const errCount = json.errors?.length ?? 0;
        const sourceLabel =
          source === 'wishlist'
            ? 'wishlist tracks'
            : source === 'playlist'
              ? `playlist "${playlists.find((p) => p.id === playlistId)?.name ?? '?'}"`
              : 'library releases';
        setMessage(
          `Scanned ${json.itemsCrawled ?? 0} ${sourceLabel}, ${json.collectorsSeen ?? 0} collectors, ${json.diggersWritten ?? 0} curators found in ${seconds}s` +
            (errCount > 0 ? ` (${errCount} errors)` : ''),
        );
        // Fresh scan → wipe the seen-set so previously-dismissed curators
        // get another chance if they still match the new source.
        setSeen(new Set());
        saveSeenIds(new Set());
        setSelected(new Set());
        router.refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Crawl failed');
    } finally {
      setCrawling(false);
    }
  }

  async function ignoreDigger(d: DiggerCandidate) {
    if (ignoreBusy.has(d.diggerId)) return;
    setIgnoreBusy((s) => new Set(s).add(d.diggerId));
    try {
      const res = await fetch(`/api/diggers/${d.diggerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ignore' }),
      });
      if (res.ok) {
        setDiggers((prev) => prev.filter((x) => x.diggerId !== d.diggerId));
      }
    } finally {
      setIgnoreBusy((s) => {
        const next = new Set(s);
        next.delete(d.diggerId);
        return next;
      });
    }
  }

  async function follow(d: DiggerCandidate) {
    if (followBusy.has(d.diggerId)) return;
    setFollowBusy((s) => new Set(s).add(d.diggerId));
    try {
      const prefs = loadPreferences();
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'digger',
          bcUrl: `https://bandcamp.com/${d.bcUsername}`,
          mirrorToBandcamp: prefs.mirrorFollowsToBandcamp,
        }),
      });
      if (res.ok) {
        setDiggers((prev) =>
          prev.map((x) => (x.diggerId === d.diggerId ? { ...x, isFollowed: true } : x)),
        );
      }
    } finally {
      setFollowBusy((s) => {
        const next = new Set(s);
        next.delete(d.diggerId);
        return next;
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-fg-muted">Scan</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as DiggerSource)}
            disabled={crawling}
            className="rounded border border-border bg-bg-base px-2 py-1.5 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
          >
            <option value="owned">my library</option>
            <option value="wishlist">my open wishlist</option>
            <option value="playlist">a specific playlist</option>
          </select>
          {source === 'playlist' && playlists.length > 0 && (
            <select
              value={playlistId ?? ''}
              onChange={(e) => setPlaylistId(Number(e.target.value) || null)}
              disabled={crawling}
              className="rounded border border-border bg-bg-base px-2 py-1.5 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
            >
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {source === 'playlist' && playlists.length === 0 && (
            <span className="text-xs text-fg-muted">
              No playlists yet —{' '}
              <a className="text-accent underline" href="/playlists">
                create one
              </a>
              .
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={crawling || (source === 'playlist' && playlistId == null)}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {crawling ? 'Scanning supporters…' : 'Find curators'}
        </button>
        <p className="flex-1 text-xs text-fg-muted">
          Scans the supporters list of the chosen tralbums and ranks Bandcamp
          users by overlap.
        </p>
      </div>
      {source === 'owned' && (
        <p className="text-xs text-fg-muted">
          Heads-up: releases whose every track is archived in your library
          are excluded from the scan (otherwise &ldquo;curators I no longer
          listen to&rdquo; would dominate the result). Open{' '}
          <a className="text-accent underline" href="/tracks?archived=1">
            Library &rarr; Archived
          </a>{' '}
          and unarchive a track to include its release again.
        </p>
      )}

      {message && (
        <div className="rounded border border-border-success bg-bg-success p-3 text-sm text-fg-success">
          {message}
        </div>
      )}

      {(() => {
        const visibleDiggers = curators.filter((d) => {
          if (seen.has(d.diggerId)) return false;
          if (hideFollowed && d.isFollowed) return false;
          return true;
        });
        const allSelected =
          visibleDiggers.length > 0 &&
          visibleDiggers.every((d) => selected.has(d.diggerId));
        // Total hidden = followed curators that the toggle is filtering out
        // PLUS curators marked seen this session. Marco wants the badge to
        // reflect "how many fell out of the visible list", not just "how
        // many were already followed", so a Mark-seen click bumps the
        // counter immediately.
        const hiddenFollowedCount =
          (hideFollowed ? curators.filter((d) => d.isFollowed).length : 0) +
          curators.filter((d) => seen.has(d.diggerId) && !(hideFollowed && d.isFollowed))
            .length;

        function toggleSelected(id: number) {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }
        function toggleSelectAll() {
          if (allSelected) {
            setSelected(new Set());
          } else {
            setSelected(new Set(visibleDiggers.map((d) => d.diggerId)));
          }
        }
        function markSeen(ids: number[]) {
          setSeen((prev) => {
            const next = new Set(prev);
            for (const id of ids) next.add(id);
            saveSeenIds(next);
            return next;
          });
          setSelected(new Set());
        }
        async function followSelected() {
          const targets = visibleDiggers.filter(
            (d) => selected.has(d.diggerId) && !d.isFollowed,
          );
          if (targets.length === 0) return;
          setBulkBusy(true);
          try {
            for (const d of targets) {
              await follow(d);
            }
            markSeen(targets.map((d) => d.diggerId));
          } finally {
            setBulkBusy(false);
          }
        }
        async function ignorePermanentlySelected() {
          const ids = [...selected];
          if (ids.length === 0) return;
          setBulkBusy(true);
          try {
            for (const id of ids) {
              const d = visibleDiggers.find((x) => x.diggerId === id);
              if (d) await ignoreDigger(d);
            }
          } finally {
            setBulkBusy(false);
            setSelected(new Set());
          }
        }

        if (visibleDiggers.length === 0 && curators.length === 0) {
          return (
            <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
              No curators yet. Pick a source above (
              {source === 'wishlist'
                ? 'your wishlist'
                : source === 'playlist'
                  ? 'a playlist'
                  : 'your library'}
              ) and run &ldquo;Find curators&rdquo; — it scans the supporters of
              each tralbum and ranks Bandcamp users with overlapping taste.
            </p>
          );
        }

        return (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                onClick={toggleSelectAll}
                disabled={visibleDiggers.length === 0}
                className="rounded border border-border bg-bg-elevated px-3 py-1 transition-colors hover:bg-bg-hover disabled:opacity-50"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
              {selected.size > 0 && (
                <>
                  <span className="text-xs text-fg-muted">
                    {selected.size} selected
                  </span>
                  <button
                    type="button"
                    onClick={followSelected}
                    disabled={bulkBusy}
                    className="rounded bg-accent px-3 py-1 text-xs font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
                  >
                    Follow & mark seen
                  </button>
                  <button
                    type="button"
                    onClick={() => markSeen([...selected])}
                    disabled={bulkBusy}
                    className="inline-flex items-center gap-1 rounded border border-border bg-bg-elevated px-3 py-1 text-xs transition-colors hover:bg-bg-hover disabled:opacity-50"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                    Mark seen
                  </button>
                  <button
                    type="button"
                    onClick={ignorePermanentlySelected}
                    disabled={bulkBusy}
                    className="rounded border border-border bg-bg-elevated px-3 py-1 text-xs text-fg-secondary transition-colors hover:border-border-warning hover:text-fg-warning disabled:opacity-50"
                    title="Permanently exclude these curators from future scans (Ignore in DB)"
                  >
                    Permanently ignore
                  </button>
                </>
              )}
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={hideFollowed}
                  onChange={(e) => setHideFollowed(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-accent"
                />
                Hide curators I already follow
              </label>
            </div>
            {visibleDiggers.length === 0 ? (
              <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
                {seen.size > 0
                  ? `All ${curators.length - hiddenFollowedCount} candidates marked seen. Run "Find curators" again to refresh.`
                  : 'All candidates are curators you already follow. Untick "Hide" above to review them.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {visibleDiggers.map((d) => (
            <li
              key={d.diggerId}
              className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                selected.has(d.diggerId)
                  ? 'border-accent bg-bg-elevated'
                  : 'border-border bg-bg-surface'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(d.diggerId)}
                onChange={() => toggleSelected(d.diggerId)}
                className="h-4 w-4 flex-none cursor-pointer accent-accent"
                aria-label={`Select ${d.displayName ?? d.bcUsername}`}
              />
              <Link
                href={
                  d.bcFanId
                    ? `/digger/${d.bcFanId}`
                    : `/u/${encodeURIComponent(d.bcUsername)}`
                }
                className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-90"
              >
                {d.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={d.imageUrl}
                    alt=""
                    className="h-12 w-12 flex-none rounded-full object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 flex-none rounded-full bg-bg-elevated" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {d.displayName ?? d.bcUsername}
                    </span>
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-mono text-accent">
                      {d.overlapCount} match{d.overlapCount === 1 ? '' : 'es'}
                    </span>
                  </div>
                  <div className="truncate text-xs text-fg-muted">
                    @{d.bcUsername}
                    {d.sampleTitles.length > 0 && (
                      <span className="ml-2">
                        shared: {d.sampleTitles.slice(0, 3).join(' · ')}
                        {d.sampleTitles.length > 3 ? '…' : ''}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
              {d.isFollowed ? (
                <span className="rounded border border-border bg-bg-elevated px-3 py-1 text-xs text-fg-muted">
                  Following
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => follow(d)}
                  disabled={followBusy.has(d.diggerId)}
                  className="rounded bg-accent px-3 py-1 text-xs font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  Follow
                </button>
              )}
              <Tooltip text="Mark as seen — comes back on next scan if still a match" position="top">
                <button
                  type="button"
                  onClick={() => markSeen([d.diggerId])}
                  className="flex h-8 w-8 flex-none items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-primary"
                  aria-label="Mark as seen"
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
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </Tooltip>
            </li>
          ))}
                </ul>
              )}
            </>
          );
        })()}
    </div>
  );
}
