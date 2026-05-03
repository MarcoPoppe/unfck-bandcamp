'use client';

import { useEffect, useState } from 'react';
import TrackRow, { type TrackRowData } from '@/components/TrackRow';
import StickyPlayerBar from '@/components/StickyPlayerBar';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts } from '@/lib/store/hooks';
import type { PlaylistTrack } from '@/lib/library/playlists';

interface Props {
  playlistId: number;
  initialTracks: PlaylistTrack[];
}

export default function PlaylistDetailClient({ playlistId, initialTracks }: Props) {
  const [tracks, setTracks] = useState<PlaylistTrack[]>(initialTracks);
  const [busy, setBusy] = useState(false);
  const setQueue = usePlayerStore((s) => s.setQueue);

  useGlobalPlaybackShortcuts();

  useEffect(() => {
    const queue: TrackRowData[] = tracks.map((t) => ({
      id: t.trackId,
      title: t.title,
      artistName: t.artistName,
      albumTitle: t.albumTitle,
      durationSeconds: t.durationSeconds,
      trackNumber: null,
      coverUrl: t.coverUrl,
      bcUrl: t.bcUrl,
      hasStream: t.hasStream,
      bcTrackId: t.bcTrackId,
      hasBeenPlayed: t.hasBeenPlayed,
    }));
    setQueue(queue);
  }, [tracks, setQueue]);

  async function move(trackId: number, direction: -1 | 1) {
    const idx = tracks.findIndex((t) => t.trackId === trackId);
    const next = idx + direction;
    if (idx < 0 || next < 0 || next >= tracks.length) return;
    const reordered = [...tracks];
    [reordered[idx], reordered[next]] = [reordered[next], reordered[idx]];
    setTracks(reordered);
    setBusy(true);
    try {
      await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reorder',
          playlistId,
          orderedTrackIds: reordered.map((t) => t.trackId),
        }),
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(trackId: number) {
    setBusy(true);
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_track', playlistId, trackId }),
      });
      if (res.ok) {
        setTracks(tracks.filter((t) => t.trackId !== trackId));
      }
    } finally {
      setBusy(false);
    }
  }

  if (tracks.length === 0) {
    return (
      <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
        No tracks yet. Add tracks via the + button on the Tracks page.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border">
        {tracks.map((t, idx) => (
          <div
            key={t.trackId}
            className="grid grid-cols-[40px_1fr_120px] items-center border-b border-border bg-bg-surface px-3 py-2"
          >
            <div className="flex flex-col items-center text-fg-muted">
              <button
                type="button"
                disabled={busy || idx === 0}
                onClick={() => move(t.trackId, -1)}
                className="text-xs hover:text-fg-primary disabled:opacity-20"
                aria-label="Move up"
              >
                ▲
              </button>
              <span className="text-xs">{idx + 1}</span>
              <button
                type="button"
                disabled={busy || idx === tracks.length - 1}
                onClick={() => move(t.trackId, 1)}
                className="text-xs hover:text-fg-primary disabled:opacity-20"
                aria-label="Move down"
              >
                ▼
              </button>
            </div>
            <TrackRow
              track={{
                id: t.trackId,
                title: t.title,
                artistName: t.artistName,
                albumTitle: t.albumTitle,
                durationSeconds: t.durationSeconds,
                trackNumber: null,
                coverUrl: t.coverUrl,
                bcUrl: t.bcUrl,
                hasStream: t.hasStream,
                bcTrackId: t.bcTrackId,
                hasBeenPlayed: t.hasBeenPlayed,
              }}
            />
            <button
              type="button"
              onClick={() => remove(t.trackId)}
              disabled={busy}
              className="ml-auto rounded border border-border px-3 py-1 text-xs text-fg-secondary transition-colors hover:border-border-danger hover:text-fg-danger disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <StickyPlayerBar />
    </>
  );
}
