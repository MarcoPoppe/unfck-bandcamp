'use client';

import { useEffect, useMemo, useState } from 'react';
import TrackRow, { type TrackRowData } from '@/components/TrackRow';
import TrackListSearch from '@/components/TrackListSearch';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts } from '@/lib/store/hooks';
import type {
  PlaylistArtistRow,
  PlaylistCuratorRow,
  PlaylistTrack,
} from '@/lib/library/playlists';
import { confirm } from '@/lib/ui/confirmStore';

interface Props {
  playlistId: number;
  initialTracks: PlaylistTrack[];
  initialArtists: PlaylistArtistRow[];
  initialCurators: PlaylistCuratorRow[];
}

type Tab = 'tracks' | 'artists' | 'curators';

export default function PlaylistDetailClient({
  playlistId,
  initialTracks,
  initialArtists,
  initialCurators,
}: Props) {
  const [tracks, setTracks] = useState<PlaylistTrack[]>(initialTracks);
  const [artists, setArtists] = useState<PlaylistArtistRow[]>(initialArtists);
  const [curators, setCurators] = useState<PlaylistCuratorRow[]>(initialCurators);
  const [tab, setTab] = useState<Tab>('tracks');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const setQueue = usePlayerStore((s) => s.setQueue);

  async function untagArtist(artistId: number) {
    const ok = await confirm({
      message: 'Remove this artist from the playlist?',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    const res = await fetch(`/api/playlists/${playlistId}/artists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistId, action: 'remove' }),
    });
    if (res.ok) setArtists((prev) => prev.filter((a) => a.artistId !== artistId));
  }

  async function untagCurator(diggerId: number) {
    const ok = await confirm({
      message: 'Remove this curator from the playlist?',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    const res = await fetch(`/api/playlists/${playlistId}/curators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diggerId, action: 'remove' }),
    });
    if (res.ok) setCurators((prev) => prev.filter((c) => c.diggerId !== diggerId));
  }

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

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'tracks', label: 'Tracks', count: tracks.length },
    { id: 'artists', label: 'Artists', count: artists.length },
    { id: 'curators', label: 'Curators', count: curators.length },
  ];

  return (
    <>
      <div className="mb-4 flex gap-2 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-accent text-fg-primary'
                : 'border-transparent text-fg-secondary hover:text-fg-primary'
            }`}
          >
            {t.label} <span className="ml-1 text-xs text-fg-muted">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === 'artists' && (
        <div>
          {artists.length === 0 ? (
            <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
              No artists in this playlist yet. Open an artist profile and use
              &quot;Add to playlist&quot; to tag them into a genre bucket.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded border border-border bg-bg-surface">
              {artists.map((a) => (
                <li key={a.artistId} className="flex items-center gap-3 p-3">
                  {a.imageUrl ? (
                    <img
                      src={a.imageUrl}
                      alt=""
                      className="h-10 w-10 flex-none rounded bg-bg-elevated object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 flex-none rounded bg-bg-elevated" />
                  )}
                  <div className="min-w-0 flex-1">
                    <a
                      href={`/artist/${a.artistId}`}
                      className="block truncate text-sm font-medium text-fg-primary hover:text-accent"
                    >
                      {a.name}
                    </a>
                    <div className="truncate font-mono text-xs text-fg-muted">
                      {a.bcUrl.replace(/^https?:\/\//, '')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => untagArtist(a.artistId)}
                    className="rounded border border-border px-3 py-1 text-xs text-fg-secondary transition-colors hover:border-border-danger hover:text-fg-danger"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'curators' && (
        <div>
          {curators.length === 0 ? (
            <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
              No curators in this playlist yet. Open a curator profile and use
              &quot;Add to playlist&quot;.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded border border-border bg-bg-surface">
              {curators.map((c) => (
                <li key={c.diggerId} className="flex items-center gap-3 p-3">
                  {c.imageUrl ? (
                    <img
                      src={c.imageUrl}
                      alt=""
                      className="h-10 w-10 flex-none rounded-full bg-bg-elevated object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 flex-none rounded-full bg-bg-elevated" />
                  )}
                  <div className="min-w-0 flex-1">
                    <a
                      href={`/digger/${c.diggerId}`}
                      className="block truncate text-sm font-medium text-fg-primary hover:text-accent"
                    >
                      {c.displayName ?? c.bcUsername}
                    </a>
                    <div className="truncate font-mono text-xs text-fg-muted">
                      @{c.bcUsername}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => untagCurator(c.diggerId)}
                    className="rounded border border-border px-3 py-1 text-xs text-fg-secondary transition-colors hover:border-border-danger hover:text-fg-danger"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'tracks' && tracks.length === 0 && (
        <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
          No tracks yet. Add tracks via the + button on the Tracks page.
        </p>
      )}

      {tab === 'tracks' && tracks.length > 0 && (
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
      )}
    </>
  );
}
