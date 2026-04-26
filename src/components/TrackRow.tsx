'use client';

import { usePlayerStore } from '@/lib/store/player';
import WishlistButton from './WishlistButton';
import TrackActions from './TrackActions';

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
  bcTrackId?: number;
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
      className={`group grid grid-cols-[40px_56px_1fr_180px_60px_30px_60px] items-center gap-3 border-b border-border px-3 py-2 transition-colors hover:bg-bg-hover ${
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
      <div className="flex items-center justify-end gap-2 text-sm">
        {track.bcTrackId ? (
          <WishlistButton
            bcTrackId={track.bcTrackId}
            bcUrl={track.bcUrl}
            title={track.title}
            artistName={track.artistName}
            albumTitle={track.albumTitle}
            coverUrl={track.coverUrl}
          />
        ) : (
          <span className="text-fg-muted opacity-30">♡</span>
        )}
        <TrackActions trackId={track.id} />
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

