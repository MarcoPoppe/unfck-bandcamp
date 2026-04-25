'use client';

import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '@/lib/store/player';

export interface TrackRowData {
  id: number;
  title: string;
  artistName: string | null;
  albumTitle: string | null;
  durationSeconds: number | null;
  trackNumber: number | null;
  coverUrl: string | null;
  bcUrl: string;
  hasStream: boolean;
}

interface Props {
  track: TrackRowData;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function TrackRow({ track }: Props) {
  const isCurrent = usePlayerStore((s) => s.currentId === track.id);
  const isPlaying = usePlayerStore((s) => s.currentId === track.id && s.isPlaying);
  const toggle = usePlayerStore((s) => s.toggle);

  return (
    <div
      className={`group grid grid-cols-[40px_56px_1fr_180px_60px_60px] items-center gap-3 border-b border-border px-3 py-2 transition-colors hover:bg-bg-hover ${
        isCurrent ? 'bg-bg-elevated' : 'bg-bg-surface'
      }`}
    >
      <button
        type="button"
        onClick={() => toggle(track.id)}
        disabled={!track.hasStream}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-fg-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
        aria-label={isPlaying ? 'pause' : 'play'}
      >
        {isPlaying ? '❚❚' : '▶'}
      </button>
      {track.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={track.coverUrl}
          alt=""
          className="h-12 w-12 rounded object-cover"
          loading="lazy"
        />
      ) : (
        <div className="h-12 w-12 rounded bg-bg-elevated" />
      )}
      <div className="min-w-0">
        <div className="truncate font-medium text-fg-primary">{track.title}</div>
        <div className="truncate text-sm text-fg-secondary">
          {track.artistName ?? 'unknown artist'}
        </div>
      </div>
      <div className="truncate text-sm text-fg-muted">{track.albumTitle ?? ''}</div>
      <div className="text-right font-mono text-xs text-fg-muted">
        {formatDuration(track.durationSeconds)}
      </div>
      <a
        href={track.bcUrl}
        target="_blank"
        rel="noreferrer"
        className="text-right text-xs text-fg-muted transition-colors hover:text-accent"
        title="open on bandcamp.com"
      >
        ↗
      </a>
    </div>
  );
}

/**
 * Minimal native-audio player wired to the shared Zustand store. Phase 2 part B
 * will replace this with a Wavesurfer-backed sticky bar; the store already
 * exposes the queue/next/prev API the new player will consume, so the swap
 * stays a UI-only change.
 */
export function MinimalPlayer() {
  const queue = usePlayerStore((s) => s.queue);
  const currentId = usePlayerStore((s) => s.currentId);
  const advance = usePlayerStore((s) => s.next);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = queue.find((t) => t.id === currentId) ?? null;

  useEffect(() => {
    setError(null);
    const audio = audioRef.current;
    if (!audio || !current) return;
    audio.src = `/api/audio/stream?id=${current.id}`;
    audio.play().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'play failed');
    });
  }, [current]);

  if (!current) return null;
  return (
    <div className="sticky bottom-0 z-10 border-t border-border bg-bg-elevated p-3">
      <div className="mx-auto flex max-w-5xl items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{current.title}</div>
          <div className="truncate text-xs text-fg-secondary">
            {current.artistName ?? 'unknown artist'}
          </div>
          {error && <div className="mt-1 text-xs text-red-400">{error}</div>}
        </div>
        <audio
          ref={audioRef}
          controls
          onEnded={advance}
          className="h-9 max-w-md flex-1"
        />
      </div>
    </div>
  );
}
