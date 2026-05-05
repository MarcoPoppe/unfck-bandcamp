'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import TrackActionsBar from '@/components/TrackActionsBar';
import PlayedCheck from '@/components/PlayedCheck';
import PlaylistMembershipBadge from '@/components/PlaylistMembershipBadge';
import TrackListSearch from '@/components/TrackListSearch';
import type { TrackRowData } from '@/components/TrackRow';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts, useCurationShortcuts } from '@/lib/store/hooks';
import type { AggregatedPlayEntry } from '@/lib/library/plays';
import { formatDateTime } from '@/lib/util/datetime';

/**
 * Format a play-completion fraction. There's no "skipped" branch any
 * more — Marco's call: "es gibt keinen Unterschied zwischen skipped
 * und played." Every play is just X% played, with "Completed" as the
 * special case at >= 95%.
 */
function describePlay(pct: number | null): { label: string; isCompleted: boolean } {
  if (pct == null) return { label: 'Played', isCompleted: false };
  const v = Math.round(pct * 100);
  if (v >= 95) return { label: 'Completed', isCompleted: true };
  return { label: `${v}% played`, isCompleted: false };
}

type HistoryRow = AggregatedPlayEntry & {
  hasBeenPlayed: boolean;
  playlists?: { id: number; name: string }[];
};

export default function HistoryClient({ plays }: { plays: HistoryRow[] }) {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const toggle = usePlayerStore((s) => s.toggle);
  const currentId = usePlayerStore((s) => s.currentId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  useGlobalPlaybackShortcuts();
  useCurationShortcuts();

  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return plays;
    return plays.filter((p) => {
      const haystack = `${p.title} ${p.artistName ?? ''} ${p.albumTitle ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [plays, search]);

  const queue = useMemo<TrackRowData[]>(
    () =>
      filtered.map((p) => ({
        id: p.trackId,
        title: p.title,
        artistName: p.artistName,
        albumTitle: p.albumTitle,
        durationSeconds: p.durationSeconds,
        trackNumber: null,
        coverUrl: p.coverUrl,
        bcUrl: p.bcUrl,
        hasStream: p.hasStream,
        bcTrackId: p.bcTrackId,
        hasBeenPlayed: p.hasBeenPlayed,
        source: 'owned' as const,
      })),
    [filtered],
  );

  useEffect(() => {
    setQueue(queue);
  }, [queue, setQueue]);

  if (plays.length === 0) {
    return (
      <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-center text-sm text-fg-muted">
        No plays yet. A track is recorded as soon as you&apos;ve listened to it for at least
        one second.
      </p>
    );
  }

  function renderRow(p: HistoryRow) {
    const rawPct = p.bestCompletedPct;
    const safePct =
      rawPct == null
        ? null
        : Math.max(0, Math.min(1, Number.isFinite(rawPct) ? rawPct : 0));
    const pctValue = safePct == null ? null : Math.round(safePct * 100);
    const desc = describePlay(safePct);
    const barColor = desc.isCompleted ? 'bg-fg-success' : 'bg-accent';
    const rowIsCurrent = currentId === p.trackId;
    const rowPlaying = rowIsCurrent && isPlaying;
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border p-2 transition-colors hover:bg-bg-hover sm:gap-3 sm:px-3 ${
          rowIsCurrent ? 'border-accent/40 bg-bg-elevated' : 'border-border bg-bg-surface'
        }`}
      >
        <button
          type="button"
          onClick={() => toggle(p.trackId)}
          disabled={!p.hasStream}
          title={rowPlaying ? 'Pause' : 'Play'}
          aria-label={rowPlaying ? 'Pause' : 'Play'}
          className={`flex h-8 w-8 flex-none items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30 ${
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
          href={`/track/${p.bcTrackId}`}
          className="flex-none"
          title="Open track page (middle-click for new tab)"
        >
          {p.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.coverUrl} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" />
          ) : (
            <div className="h-10 w-10 rounded bg-bg-elevated" />
          )}
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/track/${p.bcTrackId}`}
              className={`flex items-center gap-2 truncate text-sm font-semibold hover:underline ${
                rowIsCurrent ? 'text-accent' : 'text-fg-primary'
              }`}
              title="Open track page"
            >
              {p.hasBeenPlayed && (
                <PlayedCheck trackId={p.trackId} bcTrackId={p.bcTrackId} />
              )}
              <span className="truncate">{p.title}</span>
            </Link>
            {p.playCount > 1 && (
              <span
                className="flex-none rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary"
                title={`Played ${p.playCount} times`}
              >
                ▶ {p.playCount}
              </span>
            )}
            <PlaylistMembershipBadge
              trackId={p.trackId}
              playlists={p.playlists}
            />
          </div>
          <div className="truncate text-xs text-fg-secondary">
            {p.artistName ?? 'unknown'}
          </div>
        </div>
        <div
          className="flex flex-none items-center gap-2"
          title={
            pctValue != null
              ? `Best completion: ${pctValue}% across ${p.playCount} play${p.playCount === 1 ? '' : 's'}`
              : 'Play recorded'
          }
        >
          <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-bg-elevated">
            {pctValue != null && (
              <div
                className={`absolute left-0 top-0 h-full ${barColor}`}
                style={{ width: `${pctValue}%` }}
              />
            )}
          </div>
          <span className="min-w-[64px] text-xs text-fg-muted">{desc.label}</span>
        </div>
        <TrackActionsBar
          bcUrl={p.bcUrl}
          bcTrackId={p.bcTrackId}
          localTrackId={p.trackId}
          title={p.title}
          artistName={p.artistName}
          albumTitle={p.albumTitle}
          coverUrl={p.coverUrl}
          showFollow
          showArchive
        />
        <div className="flex-none text-right text-xs text-fg-muted">
          {formatDateTime(p.lastPlayedAt)}
        </div>
      </div>
    );
  }

  return (
    <>
      <TrackListSearch
        value={search}
        onChange={setSearch}
        total={plays.length}
        visible={filtered.length}
        unitLabel="track"
        unitLabelPlural="tracks"
      />
      {filtered.length === 0 ? (
        <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-center text-sm text-fg-muted">
          No tracks match &quot;{search}&quot;.
        </p>
      ) : filtered.length > 200 ? (
        <Virtuoso
          useWindowScroll
          totalCount={filtered.length}
          overscan={400}
          computeItemKey={(index) => filtered[index].id}
          itemContent={(index) => (
            <div className="pb-2">{renderRow(filtered[index])}</div>
          )}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <div key={p.id}>{renderRow(p)}</div>
          ))}
        </div>
      )}
    </>
  );
}
