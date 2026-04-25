'use client';

import { useEffect, useState } from 'react';
import TrackRow, { MinimalPlayer, type TrackRowData } from '@/components/TrackRow';
import { usePlayerStore } from '@/lib/store/player';

interface Props {
  initialTracks: TrackRowData[];
}

export default function TracksClient({ initialTracks }: Props) {
  const [expanding, setExpanding] = useState(false);
  const [expandMessage, setExpandMessage] = useState<string | null>(null);
  const setQueue = usePlayerStore((s) => s.setQueue);

  // Seed the player store with the initial tracks. The list page is the only
  // place that owns the queue; later phases (playlists, discovery) will own
  // their own queues and overwrite this on mount.
  useEffect(() => {
    setQueue(initialTracks);
  }, [initialTracks, setQueue]);

  async function expandTracks() {
    setExpanding(true);
    setExpandMessage(null);
    try {
      const res = await fetch('/api/sync/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json = (await res.json()) as {
        ok?: boolean;
        itemsExpanded?: number;
        tracksWritten?: number;
        durationMs?: number;
        errors?: { error: string }[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setExpandMessage(json.error ?? `expand failed (${res.status})`);
      } else {
        const seconds = ((json.durationMs ?? 0) / 1000).toFixed(1);
        const errCount = json.errors?.length ?? 0;
        setExpandMessage(
          `${json.tracksWritten} Tracks aus ${json.itemsExpanded} Releases in ${seconds}s` +
            (errCount > 0 ? ` (${errCount} Fehler)` : ''),
        );
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (err) {
      setExpandMessage(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setExpanding(false);
    }
  }

  return (
    <div className="space-y-4">
      {initialTracks.length === 0 && (
        <section className="rounded-lg border border-border bg-bg-surface p-6">
          <h2 className="text-xl font-semibold">Noch keine Tracks expanded</h2>
          <p className="mt-2 text-sm text-fg-secondary">
            Klick "Tracks expandieren" um die Release-Pages deiner gekauften Items zu fetchen
            und einzelne Tracks (mit Stream-URLs) in die DB zu schreiben.
          </p>
          <button
            type="button"
            onClick={expandTracks}
            disabled={expanding}
            className="mt-4 rounded bg-accent px-4 py-2 font-medium text-fg-primary transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {expanding ? 'expandiere...' : 'Tracks expandieren'}
          </button>
          {expandMessage && (
            <p className="mt-3 text-sm text-fg-secondary">{expandMessage}</p>
          )}
        </section>
      )}

      {initialTracks.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={expandTracks}
              disabled={expanding}
              className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              {expanding ? 'expandiere...' : 'neue items expandieren'}
            </button>
            {expandMessage && (
              <span className="text-sm text-fg-secondary">{expandMessage}</span>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            {initialTracks.map((t) => (
              <TrackRow key={t.id} track={t} />
            ))}
          </div>
        </>
      )}

      <MinimalPlayer />
    </div>
  );
}
