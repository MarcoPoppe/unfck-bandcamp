'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import StickyPlayerBar from '@/components/StickyPlayerBar';
import TrackRow, { type TrackRowData } from '@/components/TrackRow';
import HidePlayedToggle from '@/components/HidePlayedToggle';
import ActiveBadge from '@/components/ActiveBadge';
import OpenOnBandcampButton from '@/components/OpenOnBandcampButton';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts } from '@/lib/store/hooks';
import { loadPreferences, usePreferences } from '@/lib/settings/preferences';
import type { ActivitySnapshot } from '@/lib/library/activity';

interface Artist {
  id: number;
  bcUrl: string;
  name: string;
  imageUrl: string | null;
  bcBandId: number | null;
  isFollowed: boolean;
}

interface OwnedTrack {
  id: number;
  bcTrackId: number;
  title: string;
  albumTitle: string | null;
  bcUrl: string;
  coverUrl: string | null;
  durationSeconds: number | null;
  hasStream: boolean;
  hasBeenPlayed: boolean;
  releasedAt: string | null;
}

interface Release {
  /** Slug-shaped URL when known. Null for items that come from the
   * Mobile-API discography but didn't have an HTML tile yet — those
   * resolve their permalink on first interaction via /api/lookup/by-id. */
  bcUrl: string | null;
  title: string;
  releaseType: 'album' | 'track';
  releaseDate: string | null;
  artId: number | null;
  bcItemId: number | null;
  artistName: string | null;
}

interface Props {
  artist: Artist;
  activity: ActivitySnapshot;
  releases: Release[];
  ownedTracks: OwnedTrack[];
  overviewError: string | null;
}

export default function ArtistDetailClient({
  artist,
  activity,
  releases,
  ownedTracks,
  overviewError,
}: Props) {
  const router = useRouter();
  const [followed, setFollowed] = useState(artist.isFollowed);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState<string | null>(null);

  const setQueue = usePlayerStore((s) => s.setQueue);
  const playedBcTrackIds = usePlayerStore((s) => s.playedBcTrackIds);
  const [prefs] = usePreferences();
  useGlobalPlaybackShortcuts();

  // Album-tracks cache lifted up so the player queue spans every
  // expanded release. Each ReleaseRow pushes its resolved tracklist
  // here on first expand; the queue effect rebuilds the player queue
  // as Library-owned + every expanded release in render order, so A/D
  // walks the full artist set instead of just the current EP.
  const [albumTracksByBcUrl, setAlbumTracksByBcUrl] = useState<
    Map<string, AlbumTrackPayload[]>
  >(new Map());
  const handleTracksLoaded = useCallback(
    (bcUrl: string, tracks: AlbumTrackPayload[]) => {
      setAlbumTracksByBcUrl((prev) => {
        if (prev.get(bcUrl)) return prev;
        const next = new Map(prev);
        next.set(bcUrl, tracks);
        return next;
      });
    },
    [],
  );

  const ownedRows = useMemo<TrackRowData[]>(() => {
    return ownedTracks.map((t) => ({
      id: t.id,
      title: t.title,
      artistName: artist.name,
      albumTitle: t.albumTitle,
      durationSeconds: t.durationSeconds,
      trackNumber: null,
      coverUrl: t.coverUrl,
      bcUrl: t.bcUrl,
      hasStream: t.hasStream,
      needsResolve: !t.hasStream && !!t.bcUrl,
      bcTrackId: t.bcTrackId,
      hasBeenPlayed: t.hasBeenPlayed,
      releasedAt: t.releasedAt,
      source: 'owned' as const,
    }));
  }, [ownedTracks, artist.name]);

  // Library queue. Used both for the "In your library" section render
  // and (alone) when nothing is expanded yet.
  const queue = ownedRows;

  // Combined queue: library owned-tracks plus every expanded release's
  // tracks, in the order the releases appear in `releases`. Tracks
  // already present in the library aren't duplicated. Used as the
  // player queue source so A/D can walk EP -> next EP without leaving
  // the artist.
  const combinedQueue = useMemo<TrackRowData[]>(() => {
    const seen = new Set<number>(ownedRows.map((r) => r.id));
    const out: TrackRowData[] = [...ownedRows];
    for (const release of releases) {
      if (!release.bcUrl) continue;
      const tracks = albumTracksByBcUrl.get(release.bcUrl);
      if (!tracks) continue;
      for (const t of tracks) {
        if (seen.has(t.trackId)) continue;
        seen.add(t.trackId);
        out.push({
          id: t.trackId,
          title: t.title,
          artistName: t.artistName ?? artist.name,
          albumTitle: release.title,
          durationSeconds: t.durationSeconds,
          trackNumber: t.trackNumber,
          coverUrl: t.coverUrl,
          bcUrl: t.bcUrl,
          hasStream: t.hasStream,
          needsResolve: !t.hasStream && !!t.bcUrl,
          bcTrackId: t.bcTrackId,
          hasBeenPlayed: t.hasBeenPlayed,
          releasedAt: t.releasedAt ?? null,
          source: 'owned' as const,
        });
      }
    }
    return out;
  }, [ownedRows, releases, albumTracksByBcUrl, artist.name]);

  useEffect(() => {
    setQueue(combinedQueue);
  }, [combinedQueue, setQueue]);

  const visibleQueue = useMemo(() => {
    if (!prefs.hidePlayed) return queue;
    return queue.filter(
      (t) =>
        !(t.hasBeenPlayed || (t.bcTrackId != null && playedBcTrackIds.has(t.bcTrackId))),
    );
  }, [queue, prefs.hidePlayed, playedBcTrackIds]);
  const hiddenCount = queue.length - visibleQueue.length;

  async function handleFollow() {
    setBusy(true);
    setMessage(null);
    try {
      const prefs = loadPreferences();
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'artist',
          entityId: artist.id,
          mirrorToBandcamp: prefs.mirrorFollowsToBandcamp,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        bcMirrorWarning?: string | null;
      };
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? `Follow failed (${res.status})`);
      } else {
        setFollowed(true);
        if (json.bcMirrorWarning) setMessage(json.bcMirrorWarning);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleUnfollow() {
    setBusy(true);
    setMessage(null);
    try {
      const prefs = loadPreferences();
      const qs = new URLSearchParams({
        entityType: 'artist',
        entityId: String(artist.id),
      });
      if (prefs.mirrorFollowsToBandcamp) qs.set('mirrorToBandcamp', '1');
      const res = await fetch(`/api/follow?${qs.toString()}`, { method: 'DELETE' });
      if (res.ok) {
        setFollowed(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function lookupRelease(release: Release) {
    // Two paths. (1) Slug URL known (HTML tile or already-resolved):
    // hand it straight to /api/track/lookup. (2) Mobile-API-only item:
    // use /api/lookup/by-id which calls tralbum_details to recover the
    // permalink, then routes to /track/[bcTrackId].
    const key = release.bcUrl ?? `id:${release.releaseType}:${release.bcItemId}`;
    setLookupBusy(key);
    setMessage(null);
    try {
      if (release.bcUrl) {
        const res = await fetch('/api/track/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: release.bcUrl }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          result?: { trackId: number; bcTrackId?: number };
          error?: string;
        };
        if (res.ok && json.ok && json.result) {
          router.push(`/track/${json.result.bcTrackId ?? json.result.trackId}`);
          return;
        }
        setMessage(json.error ?? `Lookup failed (${res.status})`);
        return;
      }
      if (release.bcItemId == null) {
        setMessage('release has no URL or item id');
        return;
      }
      const res = await fetch('/api/lookup/by-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: release.bcItemId,
          itemType: release.releaseType,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        bcTrackId?: number;
        trackId?: number;
        error?: string;
      };
      if (res.ok && json.ok && (json.bcTrackId ?? json.trackId)) {
        router.push(`/track/${json.bcTrackId ?? json.trackId}`);
        return;
      }
      setMessage(json.error ?? `By-id lookup failed (${res.status})`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLookupBusy(null);
    }
  }

  return (
    <>
      <section className="mt-4 grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          {artist.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={artist.imageUrl}
              alt=""
              className="aspect-square w-full rounded-lg object-cover shadow-lg"
            />
          ) : (
            <div className="aspect-square w-full rounded-lg bg-bg-elevated" />
          )}
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <div className="text-xs uppercase tracking-wide text-fg-muted">Artist</div>
            <ActiveBadge snapshot={activity} variant="full" />
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{artist.name}</h1>
          <div className="mt-1 font-mono text-xs text-fg-muted">
            {artist.bcUrl.replace(/^https?:\/\//, '')}
            {artist.bcBandId ? ` · band id ${artist.bcBandId}` : ''}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {followed ? (
              <button
                type="button"
                onClick={handleUnfollow}
                disabled={busy}
                className="rounded-full border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover disabled:opacity-50"
              >
                Following
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFollow}
                disabled={busy}
                className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                Follow
              </button>
            )}
            <OpenOnBandcampButton
              href={artist.bcUrl}
              label="Open artist on bandcamp.com"
            />
          </div>
          {message && (
            <div className="mt-3 rounded border border-border bg-bg-surface p-3 text-sm text-fg-secondary">
              {message}
            </div>
          )}
          {overviewError && (
            <div className="mt-3 rounded border border-border-danger bg-bg-danger p-3 text-xs text-fg-danger">
              Could not fetch the latest releases: {overviewError}
            </div>
          )}
        </div>
      </section>

      {ownedTracks.length > 0 && (
        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              In your library · {ownedTracks.length} tracks
            </h2>
            <HidePlayedToggle count={hiddenCount} />
          </div>
          {visibleQueue.length === 0 ? (
            <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-center text-sm text-fg-muted">
              All {queue.length} tracks of this artist already heard.
            </p>
          ) : (
            <div className="space-y-2">
              {visibleQueue.map((t) => (
                <TrackRow key={t.id} track={t} />
              ))}
            </div>
          )}
        </section>
      )}

      {releases.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Releases on Bandcamp · {releases.length}
          </h2>
          <div className="overflow-hidden rounded-lg border border-border">
            {releases.map((r) => {
              const key =
                r.bcUrl ?? `id:${r.releaseType}:${r.bcItemId}`;
              return (
                <ReleaseRow
                  key={key}
                  release={r}
                  artistName={artist.name}
                  onOpenPermalink={() => lookupRelease(r)}
                  lookupBusy={lookupBusy === key}
                  onTracksLoaded={handleTracksLoaded}
                />
              );
            })}
          </div>
        </section>
      )}

      <StickyPlayerBar />
    </>
  );
}

interface AlbumTrackPayload {
  trackId: number;
  bcTrackId: number;
  title: string;
  artistName: string | null;
  durationSeconds: number | null;
  trackNumber: number | null;
  bcUrl: string;
  hasStream: boolean;
  coverUrl: string | null;
  hasBeenPlayed: boolean;
  releasedAt?: string | null;
}

/**
 * One row in the "Releases on Bandcamp" list with inline expansion. Click
 * the chevron (or the title) and we resolve the release via
 * /api/album/by-url, store the tracklist locally, and render each track
 * with a play button. Marco's invariant: every list with audio context
 * should let the user start playback in place, no detour through the
 * track-permalink page.
 */
function ReleaseRow({
  release,
  artistName,
  onOpenPermalink,
  lookupBusy,
  onTracksLoaded,
}: {
  release: Release;
  artistName: string;
  onOpenPermalink: () => void;
  lookupBusy: boolean;
  /** Fires once with the resolved tracklist after the user expands this
   * release. Lets the parent rebuild the player queue across every
   * expanded release so A/D walks them all. */
  onTracksLoaded: (bcUrl: string, tracks: AlbumTrackPayload[]) => void;
}) {
  const toggle = usePlayerStore((s) => s.toggle);

  const [tracks, setTracks] = useState<AlbumTrackPayload[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function expand() {
    setOpen((v) => !v);
    if (tracks || loading) return;
    setLoading(true);
    setError(null);
    try {
      // Resolve a slug URL when the row only carries a bc item id
      // (mobile-API-only items). One extra roundtrip via tralbum_details
      // before we hit the regular by-url path.
      let url = release.bcUrl;
      if (!url) {
        if (release.bcItemId == null) {
          setError('release has no URL or item id');
          return;
        }
        const res = await fetch('/api/lookup/by-id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: release.bcItemId,
            itemType: release.releaseType,
          }),
        });
        const json = (await res.json()) as { ok?: boolean; bcUrl?: string; error?: string };
        if (!res.ok || !json.ok || !json.bcUrl) {
          setError(json.error ?? `id-lookup failed (${res.status})`);
          return;
        }
        url = json.bcUrl;
      }
      const res = await fetch(
        `/api/album/by-url?url=${encodeURIComponent(url)}`,
      );
      const json = (await res.json()) as {
        ok?: boolean;
        tracks?: AlbumTrackPayload[];
        error?: string;
      };
      if (!res.ok || !json.ok || !json.tracks) {
        setError(json.error ?? `Lookup failed (${res.status})`);
        return;
      }
      setTracks(json.tracks);
      // Push the resolved list up to the parent so the unified player
      // queue picks every expanded release up. Without this, A/D would
      // stop at the EP boundary because the queue would only contain
      // owned tracks.
      onTracksLoaded(url, json.tracks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }

  /** Play handler: the player queue has already been built by the
   * parent (Library + every expanded release in render order), so all
   * we do here is toggle the right id. A/D then walks across every
   * expanded EP, not just this one. */
  function playTrack(t: AlbumTrackPayload) {
    toggle(t.trackId);
  }

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-2 hover:bg-bg-hover">
        <button
          type="button"
          onClick={expand}
          aria-expanded={open}
          aria-label={open ? 'Collapse release' : 'Expand release'}
          className="flex h-7 w-7 flex-none items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg-primary"
          title={open ? 'Collapse' : 'Expand tracklist'}
        >
          <span
            className={`inline-block transition-transform ${
              open ? 'rotate-90' : ''
            }`}
          >
            ▶
          </span>
        </button>
        <button
          type="button"
          onClick={expand}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title="Click to expand tracklist"
        >
          <span className="truncate text-sm font-medium">{release.title}</span>
          <span className="flex-none rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
            {release.releaseType === 'album' ? 'EP' : 'Track'}
          </span>
        </button>
        {release.bcUrl ? (
          <a
            href={`/track/go?url=${encodeURIComponent(release.bcUrl)}`}
            className="rounded px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg-primary"
            title="Open release page (middle-click for new tab)"
          >
            Page
          </a>
        ) : null}
        <button
          type="button"
          onClick={onOpenPermalink}
          disabled={lookupBusy}
          className="rounded px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg-primary disabled:opacity-50"
          title="Open the track permalink for this release"
        >
          {lookupBusy ? '…' : 'Detail'}
        </button>
      </div>
      {open && (
        <div className="border-t border-border">
          {loading && (
            <p className="px-4 py-3 text-xs text-fg-muted">Loading tracklist…</p>
          )}
          {error && !loading && (
            <p className="px-4 py-3 text-xs text-fg-danger">{error}</p>
          )}
          {tracks && tracks.length === 0 && !loading && !error && (
            <p className="px-4 py-3 text-xs text-fg-muted">No tracks found.</p>
          )}
          {tracks && tracks.length > 0 && (
            <div>
              {tracks.map((t) => {
                const row: TrackRowData = {
                  id: t.trackId,
                  title: t.title,
                  artistName: t.artistName ?? artistName,
                  albumTitle: release.title,
                  durationSeconds: t.durationSeconds,
                  trackNumber: t.trackNumber,
                  coverUrl: t.coverUrl,
                  bcUrl: t.bcUrl,
                  hasStream: t.hasStream,
                  needsResolve: !t.hasStream && !!t.bcUrl,
                  bcTrackId: t.bcTrackId,
                  hasBeenPlayed: t.hasBeenPlayed,
                  releasedAt: t.releasedAt ?? null,
                  source: 'owned' as const,
                };
                return (
                  <TrackRow
                    key={t.trackId}
                    track={row}
                    onPlayOverride={() => playTrack(t)}
                    showArchive={false}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

