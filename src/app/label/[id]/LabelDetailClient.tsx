'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import StickyPlayerBar from '@/components/StickyPlayerBar';
import TrackActionsBar from '@/components/TrackActionsBar';
import FollowButton from '@/components/FollowButton';
import HidePlayedToggle from '@/components/HidePlayedToggle';
import PlayedCheck from '@/components/PlayedCheck';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts } from '@/lib/store/hooks';
import { loadPreferences, usePreferences } from '@/lib/settings/preferences';
import ActiveBadge from '@/components/ActiveBadge';
import type { TrackRowData } from '@/components/TrackRow';
import type { ActivitySnapshot } from '@/lib/library/activity';

interface LabelTrack {
  id: number;
  bcTrackId: number;
  title: string;
  artistName: string | null;
  albumTitle: string | null;
  durationSeconds: number | null;
  coverUrl: string | null;
  bcUrl: string;
  hasStream: boolean;
  hasBeenPlayed: boolean;
  albumUrl: string | null;
  bcAlbumId: number | null;
}

interface Group {
  bcAlbumId: number | null;
  albumTitle: string | null;
  albumUrl: string | null;
  coverUrl: string | null;
  tracks: LabelTrack[];
}

interface Props {
  label: {
    id: number;
    bcUrl: string;
    name: string;
    imageUrl: string | null;
    isFollowed: boolean;
  };
  activity: ActivitySnapshot;
  groups: Group[];
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function LabelDetailClient({ label, activity, groups }: Props) {
  const router = useRouter();
  const setQueue = usePlayerStore((s) => s.setQueue);
  const toggle = usePlayerStore((s) => s.toggle);
  const playerCurrentId = usePlayerStore((s) => s.currentId);
  const playerIsPlaying = usePlayerStore((s) => s.isPlaying);
  const playedBcTrackIds = usePlayerStore((s) => s.playedBcTrackIds);
  const [prefs] = usePreferences();
  useGlobalPlaybackShortcuts();

  const [followed, setFollowed] = useState(label.isFollowed);
  const [followBusy, setFollowBusy] = useState(false);

  // Filter each release's tracklist by hide-played; release groups whose
  // tracklist becomes empty are dropped from the visible list.
  const visibleGroups = useMemo(() => {
    if (!prefs.hidePlayed) return groups;
    const out = [];
    for (const g of groups) {
      const filteredTracks = g.tracks.filter(
        (t) => !(t.hasBeenPlayed || playedBcTrackIds.has(t.bcTrackId)),
      );
      if (filteredTracks.length > 0) out.push({ ...g, tracks: filteredTracks });
    }
    return out;
  }, [groups, prefs.hidePlayed, playedBcTrackIds]);
  const hiddenTrackCount =
    groups.reduce((n, g) => n + g.tracks.length, 0) -
    visibleGroups.reduce((n, g) => n + g.tracks.length, 0);

  // Build queue from every track on the label so A/D walks through the
  // whole catalog from any starting point.
  useEffect(() => {
    const queue: TrackRowData[] = groups.flatMap((g) =>
      g.tracks.map((t) => ({
        id: t.id,
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
        source: 'owned' as const,
      })),
    );
    setQueue(queue);
  }, [groups, setQueue]);

  async function toggleFollow() {
    if (followBusy) return;
    setFollowBusy(true);
    try {
      if (followed) {
        const prefs = loadPreferences();
        const qs = new URLSearchParams({
          entityType: 'label',
          entityId: String(label.id),
        });
        if (prefs.mirrorFollowsToBandcamp) qs.set('mirrorToBandcamp', '1');
        const res = await fetch(`/api/follow?${qs.toString()}`, { method: 'DELETE' });
        if (res.ok) {
          setFollowed(false);
          router.refresh();
        }
      } else {
        const prefs = loadPreferences();
        const res = await fetch('/api/follow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityType: 'label',
            bcUrl: label.bcUrl,
            mirrorToBandcamp: prefs.mirrorFollowsToBandcamp,
          }),
        });
        const json = (await res.json()) as { ok?: boolean };
        if (res.ok && json.ok) {
          setFollowed(true);
          router.refresh();
        }
      }
    } finally {
      setFollowBusy(false);
    }
  }

  return (
    <>
      <section className="mt-4 grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <div>
          {label.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={label.imageUrl}
              alt=""
              className="aspect-square w-full rounded-lg object-cover"
            />
          ) : (
            <div className="aspect-square w-full rounded-lg bg-bg-elevated" />
          )}
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <div className="text-xs uppercase tracking-wide text-fg-muted">Label</div>
            <ActiveBadge snapshot={activity} variant="full" />
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{label.name}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleFollow}
              disabled={followBusy}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                followed
                  ? 'bg-accent/20 text-accent hover:bg-accent/30'
                  : 'bg-accent text-fg-on-accent hover:bg-accent-hover'
              }`}
            >
              {followBusy ? '…' : followed ? '✓ Following' : '+ Follow label'}
            </button>
            <a
              href={label.bcUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-border bg-bg-elevated px-3 py-2 text-sm transition-colors hover:bg-bg-hover"
            >
              ↗ Open on Bandcamp
            </a>
          </div>
          <p className="mt-3 text-xs text-fg-muted">
            {groups.length} releases · {groups.reduce((n, g) => n + g.tracks.length, 0)} tracks in your library
          </p>
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Releases on this label
          </h2>
          {groups.length > 0 && <HidePlayedToggle count={hiddenTrackCount} />}
        </div>
        {groups.length === 0 ? (
          <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-sm text-fg-muted">
            No tracks of this label in your library yet.
          </p>
        ) : visibleGroups.length === 0 ? (
          <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-sm text-fg-muted">
            All tracks of this label already heard.
          </p>
        ) : (
          <ul className="space-y-2">
            {visibleGroups.map((g, gi) => (
              <li
                key={`${gi}-${g.bcAlbumId ?? g.albumTitle ?? 'group'}`}
                className="rounded-lg border border-border bg-bg-surface p-2"
              >
                <div className="flex items-center gap-3 p-1">
                  {g.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={g.coverUrl}
                      alt=""
                      className="h-12 w-12 flex-none rounded object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 flex-none rounded bg-bg-elevated" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {g.albumTitle ?? g.tracks[0]?.title ?? '(unknown release)'}
                    </div>
                    <div className="truncate text-xs text-fg-secondary">
                      {g.tracks[0]?.artistName ?? 'unknown'}
                    </div>
                  </div>
                </div>
                <div className="mt-1 space-y-1">
                  {g.tracks.map((t) => {
                    const isCurrent = playerCurrentId === t.id;
                    const isPlaying = isCurrent && playerIsPlaying;
                    const showPlayed = t.hasBeenPlayed || playedBcTrackIds.has(t.bcTrackId);
                    return (
                      <div
                        key={t.id}
                        className={`flex items-center gap-2 rounded px-2 py-1.5 ${
                          isCurrent ? 'bg-bg-elevated' : 'hover:bg-bg-hover'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggle(t.id)}
                          disabled={!t.hasStream}
                          title={isPlaying ? 'Pause' : 'Play'}
                          aria-label={isPlaying ? 'Pause' : 'Play'}
                          className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30 ${
                            isCurrent
                              ? 'border-accent bg-accent text-fg-on-accent'
                              : 'border-border text-fg-secondary hover:border-accent hover:text-accent'
                          }`}
                        >
                          {isPlaying ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                            </svg>
                          ) : (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          )}
                        </button>
                        <a
                          href={`/track/${t.bcTrackId}`}
                          className={`flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm hover:underline ${
                            isCurrent ? 'text-accent' : ''
                          }`}
                        >
                          {showPlayed && (
                            <PlayedCheck trackId={t.id} bcTrackId={t.bcTrackId} />
                          )}
                          <span className="truncate">{t.title}</span>
                        </a>
                        <span className="flex-none font-mono text-xs text-fg-muted tabular-nums">
                          {formatDuration(t.durationSeconds)}
                        </span>
                        <FollowButton entityType="artist" bcUrl={t.bcUrl} />
                        <TrackActionsBar
                          bcUrl={t.bcUrl}
                          bcTrackId={t.bcTrackId}
                          localTrackId={t.id}
                          title={t.title}
                          artistName={t.artistName}
                          albumTitle={t.albumTitle}
                          coverUrl={t.coverUrl}
                          
                        />
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <StickyPlayerBar />
    </>
  );
}
