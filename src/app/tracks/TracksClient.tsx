'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Virtuoso } from 'react-virtuoso';
import TrackRow, { type TrackRowData } from '@/components/TrackRow';
import HidePlayedToggle from '@/components/HidePlayedToggle';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts, useCurationShortcuts, useFilterShortcuts } from '@/lib/store/hooks';
import { formatKey, useShortcuts } from '@/lib/settings/shortcuts';
import { usePreferences } from '@/lib/settings/preferences';
import type { TrackRatingFilter, TrackSortMode, TrackRowExtended } from '@/lib/sync/tracks';

interface Props {
  initialTracks: TrackRowExtended[];
  initialRating: TrackRatingFilter;
  initialSort: TrackSortMode;
  initialSearch: string;
  archivedView: boolean;
  archivedCount: number;
  libraryEmpty: boolean;
}

const SORT_OPTIONS: Array<{ value: TrackSortMode; label: string }> = [
  { value: 'artist', label: 'Artist' },
  { value: 'recent', label: 'Recent' },
];

export default function TracksClient({
  initialTracks,
  initialRating,
  initialSort,
  initialSearch,
  archivedView,
  archivedCount,
  libraryEmpty,
}: Props) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupInput, setLookupInput] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const playedBcTrackIds = usePlayerStore((s) => s.playedBcTrackIds);
  const [prefs] = usePreferences();

  useGlobalPlaybackShortcuts();
  useCurationShortcuts();
  useFilterShortcuts();
  const bindings = useShortcuts();

  // Apply the global "hide played" filter at the row level. We filter the
  // visible list, but keep the player queue based on `initialTracks` so
  // A/D still walks the full library — otherwise toggling the filter on
  // would shorten the queue and skip past tracks the user wants to revisit.
  const visibleTracks = useMemo(() => {
    if (!prefs.hidePlayed) return initialTracks;
    return initialTracks.filter(
      (t) => !(t.hasBeenPlayed || playedBcTrackIds.has(t.bcTrackId)),
    );
  }, [initialTracks, prefs.hidePlayed, playedBcTrackIds]);
  const hiddenCount = initialTracks.length - visibleTracks.length;

  useEffect(() => {
    const queue: TrackRowData[] = initialTracks.map((t) => ({
      ...t,
      bcTrackId: t.bcTrackId,
      source: 'owned' as const,
    }));
    setQueue(queue);
  }, [initialTracks, setQueue]);

  function pushFilter(updates: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    if (initialRating !== 'all') sp.set('rating', initialRating);
    if (initialSort !== 'artist') sp.set('sort', initialSort);
    if (initialSearch) sp.set('q', initialSearch);
    if (archivedView) sp.set('archived', '1');
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined || v === '' || v === 'all' || v === 'artist' || (k === 'archived' && v !== '1')) {
        sp.delete(k);
      } else {
        sp.set(k, v);
      }
    }
    const qs = sp.toString();
    router.push(qs ? `/tracks?${qs}` : '/tracks');
  }

  function handleSearchSubmit() {
    pushFilter({ q: search.trim() || undefined });
  }

  async function submitLookup() {
    const value = lookupInput.trim();
    if (!value) return;
    setLookupBusy(true);
    setLookupError(null);
    try {
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
        setLookupError(json.error ?? `Lookup failed (${res.status})`);
        return;
      }
      router.push(`/track/${json.result.bcTrackId ?? json.result.trackId}`);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLookupBusy(false);
    }
  }

  async function refreshLibrary() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/sync/owned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json = (await res.json()) as {
        ok?: boolean;
        itemsSynced?: number;
        tracksWritten?: number;
        durationMs?: number;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setSyncMessage(json.error ?? `Sync failed (${res.status})`);
      } else {
        const seconds = ((json.durationMs ?? 0) / 1000).toFixed(1);
        setSyncMessage(
          `Imported ${json.itemsSynced ?? 0} items / ${json.tracksWritten ?? 0} new tracks in ${seconds}s`,
        );
        setTimeout(() => router.refresh(), 600);
      }
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="space-y-4">
        {libraryEmpty ? (
          <section className="rounded-lg border border-border bg-bg-surface p-6">
            <h2 className="text-xl font-semibold">No tracks yet</h2>
            <p className="mt-2 text-sm text-fg-secondary">
              Sync your Bandcamp collection to import tracks with stream URLs into the local
              database.
            </p>
            <button
              type="button"
              onClick={refreshLibrary}
              disabled={syncing}
              className="mt-4 rounded bg-accent px-4 py-2 font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync collection'}
            </button>
            {syncMessage && (
              <p className="mt-3 text-sm text-fg-secondary">{syncMessage}</p>
            )}
          </section>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchSubmit();
                }}
                onBlur={handleSearchSubmit}
                placeholder="Search title, artist, album…"
                className="min-w-[180px] flex-1 rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
              <select
                value={initialSort}
                onChange={(e) => pushFilter({ sort: e.target.value })}
                className="rounded border border-border bg-bg-elevated px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                aria-label="Sort"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    Sort: {opt.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => pushFilter({ archived: archivedView ? undefined : '1' })}
                className={`rounded border px-3 py-1.5 text-xs transition-colors ${
                  archivedView
                    ? 'border-border-warning bg-bg-warning text-fg-warning'
                    : archivedCount > 0
                      ? 'border-border bg-bg-elevated text-fg-secondary hover:bg-bg-hover hover:text-fg-primary'
                      : 'border-border bg-bg-elevated text-fg-muted hover:bg-bg-hover'
                }`}
              >
                {archivedView
                  ? `← Back to library`
                  : archivedCount > 0
                    ? `Archived (${archivedCount})`
                    : 'Archived'}
              </button>
              <button
                type="button"
                onClick={() => setLookupOpen((v) => !v)}
                className={`ml-auto rounded border px-3 py-1.5 text-xs transition-colors ${
                  lookupOpen
                    ? 'border-accent bg-accent/20 text-accent'
                    : 'border-border bg-bg-elevated text-fg-secondary hover:bg-bg-hover hover:text-fg-primary'
                }`}
              >
                Look up track
              </button>
              <button
                type="button"
                onClick={refreshLibrary}
                disabled={syncing}
                className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-xs transition-colors hover:bg-bg-hover disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : 'Refresh from Bandcamp'}
              </button>
              <HidePlayedToggle count={hiddenCount} />
            </div>

            {lookupOpen && (
              <div className="rounded-lg border border-accent/40 bg-bg-surface p-4">
                <div className="mb-1 text-sm font-semibold">Look up a Bandcamp track</div>
                <div className="text-xs text-fg-muted">
                  Paste a track URL or numeric track id. Imports the release into the local
                  database and opens its permalink with cover, siblings, and supporters.
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={lookupInput}
                    onChange={(e) => setLookupInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitLookup();
                    }}
                    placeholder="https://artist.bandcamp.com/track/song-name  ·  3924159572"
                    className="flex-1 rounded border border-border bg-bg-base px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={submitLookup}
                    disabled={lookupBusy || !lookupInput.trim()}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
                  >
                    {lookupBusy ? 'Looking up…' : 'Look up'}
                  </button>
                </div>
                {lookupError && (
                  <div className="mt-3 rounded border border-border-danger bg-bg-danger p-2 text-xs text-fg-danger">
                    {lookupError}
                  </div>
                )}
              </div>
            )}

            {syncMessage && (
              <div className="rounded border border-border-success bg-bg-success p-3 text-sm text-fg-success">
                {syncMessage}
              </div>
            )}

            <p className="text-xs text-fg-muted">
              <span className="font-mono text-fg-secondary">
                {formatKey(bindings.prev)}/{formatKey(bindings.next)}
              </span>{' '}
              previous/next ·{' '}
              <span className="font-mono text-fg-secondary">{formatKey(bindings.playPause)}</span>{' '}
              play/pause
            </p>

            {initialTracks.length === 0 ? (
              <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
                {archivedView
                  ? 'No archived tracks. Use the box icon on a track row to archive it.'
                  : 'No tracks match the current filter.'}
              </p>
            ) : visibleTracks.length === 0 ? (
              <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
                All {initialTracks.length} tracks already heard. Toggle &ldquo;Hide
                played&rdquo; off to show them again.
              </p>
            ) : visibleTracks.length > 200 ? (
              // Virtualized list: only render rows currently in view + a small
              // overscan window. Keeps the DOM at ~30 rows even with 10k+ tracks.
              <div className="space-y-2">
                <Virtuoso
                  useWindowScroll
                  totalCount={visibleTracks.length}
                  overscan={400}
                  computeItemKey={(index) => visibleTracks[index].id}
                  itemContent={(index) => {
                    const t = visibleTracks[index];
                    return (
                      <TrackRow
                        track={{
                          ...t,
                          bcTrackId: t.bcTrackId,
                          source: 'owned' as const,
                        }}
                      />
                    );
                  }}
                />
              </div>
            ) : (
              <div className="space-y-2">
                {visibleTracks.map((t) => (
                  <TrackRow
                    key={t.id}
                    track={{
                      ...t,
                      bcTrackId: t.bcTrackId,
                      source: 'owned' as const,
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
