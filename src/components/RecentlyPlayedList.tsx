'use client';

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import StickyPlayerBar from './StickyPlayerBar';
import type { TrackRowData } from './TrackRow';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts } from '@/lib/store/hooks';
import type { PlayHistoryEntry } from '@/lib/library/plays';

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  return iso.split(' ')[0];
}

export default function RecentlyPlayedList({ plays }: { plays: PlayHistoryEntry[] }) {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const toggle = usePlayerStore((s) => s.toggle);
  const currentId = usePlayerStore((s) => s.currentId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useGlobalPlaybackShortcuts();

  const queue = useMemo<TrackRowData[]>(() => {
    return plays.map((p) => ({
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
      source: 'owned' as const,
    }));
  }, [plays]);

  useEffect(() => {
    setQueue(queue);
  }, [queue, setQueue]);

  if (plays.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No plays yet. Start a track on the{' '}
        <Link href="/tracks" className="text-accent hover:underline">
          Library
        </Link>{' '}
        page.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-1">
        {plays.map((p) => {
          const isCurrent = currentId === p.trackId;
          const rowIsPlaying = isCurrent && isPlaying;
          return (
            <li
              key={p.id}
              className={`flex items-center gap-3 rounded border px-3 py-2 transition-colors ${
                isCurrent ? 'border-accent/40 bg-bg-elevated' : 'border-border bg-bg-base'
              }`}
            >
              <button
                type="button"
                onClick={() => toggle(p.trackId)}
                disabled={!p.hasStream}
                title={
                  p.hasStream
                    ? rowIsPlaying
                      ? 'Pause'
                      : 'Play'
                    : 'No stream URL available'
                }
                aria-label={rowIsPlaying ? 'Pause' : 'Play'}
                className={`flex h-9 w-9 flex-none items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30 ${
                  isCurrent
                    ? 'border-accent bg-accent text-fg-on-accent hover:bg-accent-hover'
                    : 'border-border text-fg-secondary hover:border-accent hover:text-accent'
                }`}
              >
                {rowIsPlaying ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              {p.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.coverUrl}
                  alt=""
                  className="h-10 w-10 flex-none rounded object-cover"
                />
              ) : (
                <div className="h-10 w-10 flex-none rounded bg-bg-elevated" />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  href={`/track/${p.bcTrackId}`}
                  className={`block truncate text-sm font-medium hover:underline ${
                    isCurrent ? 'text-accent' : 'text-fg-primary'
                  }`}
                  title="Open track page"
                >
                  {p.title}
                </Link>
                <div className="truncate text-xs text-fg-secondary">
                  {p.artistName ?? 'unknown'}
                </div>
              </div>
              <div className="font-mono text-xs text-fg-muted">{timeAgo(p.playedAt)}</div>
            </li>
          );
        })}
      </ul>
      <StickyPlayerBar />
    </>
  );
}
