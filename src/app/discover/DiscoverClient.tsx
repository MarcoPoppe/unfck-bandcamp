'use client';

import { useEffect } from 'react';
import TrackRow, { type TrackRowData } from '@/components/TrackRow';
import StickyPlayerBar from '@/components/StickyPlayerBar';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts } from '@/lib/store/hooks';

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
}
// bcTrackId is propagated through to the wishlist button.

interface Props {
  initialTracks: DiscoveredTrackRow[];
}

export default function DiscoverClient({ initialTracks }: Props) {
  const setQueue = usePlayerStore((s) => s.setQueue);

  useGlobalPlaybackShortcuts();

  // Discovery has its own play queue independent of /tracks. We need to map
  // discovered_tracks.id into the player by prefixing 1_000_000_000 so the
  // cache + audio-stream endpoints (which key on tracks.id) don't collide.
  // Instead of that, we expose discovery tracks through a dedicated audio
  // route. For Phase 3 part A we keep the API simple: only owned tracks are
  // playable in-app, discovered tracks open on bandcamp.com.
  const queue: TrackRowData[] = initialTracks.map((t) => ({
    id: t.id,
    title: t.title,
    artistName: t.artistName,
    albumTitle: t.albumTitle,
    durationSeconds: t.durationSeconds,
    trackNumber: t.trackNumber,
    coverUrl: t.coverUrl,
    bcUrl: t.bcUrl,
    hasStream: false, // disable in-app play for discovered tracks in part A
    bcTrackId: t.bcTrackId, // propagate so the wishlist button works on /discover
  }));

  useEffect(() => {
    setQueue(queue);
  }, [queue, setQueue]);

  if (initialTracks.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-bg-surface p-6">
        <h2 className="text-xl font-semibold">Noch nichts entdeckt</h2>
        <p className="mt-2 text-sm text-fg-secondary">
          Folge zuerst Artists unter{' '}
          <a className="text-accent underline" href="/follows">
            /follows
          </a>
          , dann starte dort den Discovery-Sync.
        </p>
      </section>
    );
  }

  return (
    <>
      <p className="mb-3 text-xs text-fg-muted">
        Discovered tracks oeffnen direkt auf bandcamp.com (in-app playback fuer
        Discovery-Tracks kommt in Phase 3 part B).
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        {queue.map((t) => (
          <TrackRow key={t.id} track={t} />
        ))}
      </div>
      <StickyPlayerBar />
    </>
  );
}
