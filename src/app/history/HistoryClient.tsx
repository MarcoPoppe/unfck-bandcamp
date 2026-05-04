'use client';

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import StickyPlayerBar from '@/components/StickyPlayerBar';
import TrackActionsBar from '@/components/TrackActionsBar';
import PlayedCheck from '@/components/PlayedCheck';
import PlaylistMembershipBadge from '@/components/PlaylistMembershipBadge';
import type { TrackRowData } from '@/components/TrackRow';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts, useCurationShortcuts } from '@/lib/store/hooks';
import type { PlayHistoryEntry } from '@/lib/library/plays';
import { formatDateTime } from '@/lib/util/datetime';

function describePlay(pct: number | null): { label: string; tone: 'low' | 'mid' | 'high' } {
  if (pct == null) return { label: 'Played', tone: 'mid' };
  const v = Math.round(pct * 100);
  if (v < 30) return { label: `Skipped at ${v}%`, tone: 'low' };
  if (v < 70) return { label: `${v}% played`, tone: 'mid' };
  return { label: v >= 95 ? 'Completed' : `${v}% played`, tone: 'high' };
}

type HistoryRow = PlayHistoryEntry & {
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

  const queue = useMemo<TrackRowData[]>(
    () =>
      plays.map((p) => ({
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
    [plays],
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
    // Defensive clamp: completed_pct can come back malformed from older
    // history rows; clamp before rendering CSS width / labels.
    const rawPct = p.completedPct;
    const safePct =
      rawPct == null
        ? null
        : Math.max(0, Math.min(1, Number.isFinite(rawPct) ? rawPct : 0));
    const pctValue = safePct == null ? null : Math.round(safePct * 100);
    const desc = describePlay(safePct);
    const barColor =
      desc.tone === 'high'
        ? 'bg-fg-success'
        : desc.tone === 'low'
          ? 'bg-fg-danger'
          : 'bg-accent';
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
                  <img src={p.coverUrl} alt="" className="h-10 w-10 rounded object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded bg-bg-elevated" />
                )}
              </a>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/track/${p.bcTrackId}`}
                    className={`flex items-center gap-2 truncate text-sm font-medium hover:underline ${
                      rowIsCurrent ? 'text-accent' : 'text-fg-primary'
                    }`}
                    title="Open track page"
                  >
                    {p.hasBeenPlayed && (
                      <PlayedCheck trackId={p.trackId} bcTrackId={p.bcTrackId} />
                    )}
                    <span className="truncate">{p.title}</span>
                  </Link>
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
                    ? `Played ${pctValue}% before switching to the next one`
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
                {formatDateTime(p.playedAt)}
              </div>
            </div>
        );
      }

  return (
    <>
      {plays.length > 200 ? (
        <Virtuoso
          useWindowScroll
          totalCount={plays.length}
          overscan={400}
          computeItemKey={(index) => plays[index].id}
          itemContent={(index) => (
            <div className="pb-1">{renderRow(plays[index])}</div>
          )}
        />
      ) : (
        <div className="space-y-2">
          {plays.map((p) => (
            <div key={p.id}>{renderRow(p)}</div>
          ))}
        </div>
      )}
      <StickyPlayerBar />
    </>
  );
}
