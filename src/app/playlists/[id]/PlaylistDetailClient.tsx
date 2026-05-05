'use client';

import { useEffect, useMemo, useState } from 'react';
import TrackRow, { type TrackRowData } from '@/components/TrackRow';
import TrackListSearch from '@/components/TrackListSearch';
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
  const [search, setSearch] = useState('');
  const setQueue = usePlayerStore((s) => s.setQueue);

  const filteredTracks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) =>
      `${t.title} ${t.artistName ?? ''} ${t.albumTitle ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }, [tracks, search]);
  const isFiltered = search.trim().length > 0;

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
      <TrackListSearch
        value={search}
        onChange={setSearch}
        total={tracks.length}
        visible={filteredTracks.length}
      />
      {filteredTracks.length === 0 && isFiltered && (
        <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-center text-sm text-fg-muted">
          No tracks match &quot;{search}&quot;.
        </p>
      )}
      <div className="space-y-2">
        {filteredTracks.map((t) => {
          const idx = tracks.findIndex((x) => x.trackId === t.trackId);
          return (
          <TrackRow
            key={t.trackId}
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
              source: 'owned',
            }}
            position={idx + 1}
            reorderControls={{
              onMoveUp: () => move(t.trackId, -1),
              onMoveDown: () => move(t.trackId, 1),
              canMoveUp: !busy && !isFiltered && idx > 0,
              canMoveDown: !busy && !isFiltered && idx < tracks.length - 1,
            }}
            hideDuration
            showFollow
            showArchive
            trailing={
              <button
                type="button"
                onClick={() => remove(t.trackId)}
                disabled={busy}
                className="rounded border border-border px-3 py-1 text-xs text-fg-secondary transition-colors hover:border-border-danger hover:text-fg-danger disabled:opacity-50"
              >
                Remove
              </button>
            }
          />
          );
        })}
      </div>
    </>
  );
}
