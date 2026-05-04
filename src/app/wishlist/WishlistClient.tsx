'use client';

import { useEffect, useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import StickyPlayerBar from '@/components/StickyPlayerBar';
import TrackActionsBar from '@/components/TrackActionsBar';
import HidePlayedToggle from '@/components/HidePlayedToggle';
import PlayedCheck from '@/components/PlayedCheck';
import PlaylistMembershipBadge from '@/components/PlaylistMembershipBadge';
import type { TrackRowData } from '@/components/TrackRow';
import TrackListSearch from '@/components/TrackListSearch';
import { usePlayerStore } from '@/lib/store/player';
import { useGlobalPlaybackShortcuts, useCurationShortcuts } from '@/lib/store/hooks';
import { usePreferences } from '@/lib/settings/preferences';
import type { WishlistItem, WishlistStatus } from '@/lib/wishlist/store';
import { formatDateTime } from '@/lib/util/datetime';

type Tab = WishlistStatus;

interface Props {
  initialOpen: WishlistItem[];
  initialBought: WishlistItem[];
  initialDismissed: WishlistItem[];
  initialCounts: Record<WishlistStatus, number>;
}

export default function WishlistClient({
  initialOpen,
  initialBought,
  initialDismissed,
  initialCounts,
}: Props) {
  const [tab, setTab] = useState<Tab>('open');
  const [items, setItems] = useState<Record<Tab, WishlistItem[]>>({
    open: initialOpen,
    bought: initialBought,
    dismissed: initialDismissed,
  });
  const [counts, setCounts] = useState(initialCounts);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const setWishlistedBcTrackIds = usePlayerStore((s) => s.setWishlistedBcTrackIds);

  async function refresh() {
    const [openR, boughtR, dismissedR] = await Promise.all([
      fetch('/api/wishlist?status=open'),
      fetch('/api/wishlist?status=bought'),
      fetch('/api/wishlist?status=dismissed'),
    ]);
    const o = (await openR.json()) as { items?: WishlistItem[]; counts?: Record<WishlistStatus, number> };
    const b = (await boughtR.json()) as { items?: WishlistItem[] };
    const d = (await dismissedR.json()) as { items?: WishlistItem[] };
    setItems({
      open: o.items ?? [],
      bought: b.items ?? [],
      dismissed: d.items ?? [],
    });
    if (o.counts) setCounts(o.counts);
    setSelected(new Set());
    // Re-hydrate the live wishlist set after any patch so hearts elsewhere
    // (player bar, other lists) drop their fill once an item is dismissed
    // or marked bought.
    setWishlistedBcTrackIds((o.items ?? []).map((i) => i.bcTrackId));
  }

  async function patchBatch(action: 'mark_bought' | 'dismiss' | 'reopen', ids: number[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/wishlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action }),
      });
      const json = (await res.json()) as { ok?: boolean; updated?: number; error?: string };
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? `Action failed (${res.status})`);
      } else {
        setMessage(`${json.updated ?? 0} items updated`);
        await refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function triggerOwnedSync() {
    setBusy(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/sync/owned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json = (await res.json()) as {
        ok?: boolean;
        itemsSynced?: number;
        tracksWritten?: number;
        wishlistAutoMarked?: number;
        durationMs?: number;
        trackImportError?: string | null;
        trackImportErrors?: { bcUrl: string; error: string }[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setSyncMessage(json.error ?? `Sync failed (${res.status})`);
        return;
      }
      const seconds = ((json.durationMs ?? 0) / 1000).toFixed(1);
      const auto = json.wishlistAutoMarked ?? 0;
      const autoMsg = auto > 0 ? `, ${auto} wishlist item(s) marked as bought` : '';
      const trackErr = json.trackImportError
        ? ` (track import warning: ${json.trackImportError})`
        : '';
      const perItemErrs =
        json.trackImportErrors && json.trackImportErrors.length > 0
          ? ` — ${json.trackImportErrors.length} item(s) failed: ${json.trackImportErrors
              .map((e) => `${e.bcUrl} (${e.error})`)
              .join('; ')}`
          : '';
      setSyncMessage(
        `Synced ${json.itemsSynced ?? 0} items / ${json.tracksWritten ?? 0} new tracks in ${seconds}s${autoMsg}${trackErr}${perItemErrs}`,
      );
      await refresh();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    const visible = items[tab].map((i) => i.id);
    if (visible.every((id) => selected.has(id)) && visible.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible));
    }
  }

  const visible = items[tab];

  const playerQueue = useMemo<TrackRowData[]>(() => {
    return visible.map((i) => {
      // Already-imported items keep their real local id; lazy items get a
      // synthetic negative id and `needsResolve: true` so StickyPlayerBar
      // imports them via /api/track/lookup right before playing.
      if (i.localTrackId != null) {
        return {
          id: i.localTrackId,
          title: i.title,
          artistName: i.artistName,
          albumTitle: i.albumTitle,
          durationSeconds: null,
          trackNumber: null,
          coverUrl: i.coverUrl,
          bcUrl: i.bcUrl,
          hasStream: i.hasStream,
          bcTrackId: i.bcTrackId,
          hasBeenPlayed: i.hasBeenPlayed,
          source: 'owned' as const,
        };
      }
      return {
        id: -i.bcTrackId,
        title: i.title,
        artistName: i.artistName,
        albumTitle: i.albumTitle,
        durationSeconds: null,
        trackNumber: null,
        coverUrl: i.coverUrl,
        bcUrl: i.bcUrl,
        hasStream: true,
        bcTrackId: i.bcTrackId,
        hasBeenPlayed: i.hasBeenPlayed,
        needsResolve: true,
        source: 'owned' as const,
      };
    });
  }, [visible]);

  const setQueue = usePlayerStore((s) => s.setQueue);
  const toggle = usePlayerStore((s) => s.toggle);
  const currentId = usePlayerStore((s) => s.currentId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playedBcTrackIds = usePlayerStore((s) => s.playedBcTrackIds);
  const [prefs] = usePreferences();
  const [search, setSearch] = useState('');
  const filteredVisible = useMemo(() => {
    let v = visible;
    if (prefs.hidePlayed) {
      v = v.filter(
        (i) => !(i.hasBeenPlayed || playedBcTrackIds.has(i.bcTrackId)),
      );
    }
    const q = search.trim().toLowerCase();
    if (q) {
      v = v.filter((i) =>
        `${i.title} ${i.artistName ?? ''} ${i.albumTitle ?? ''}`
          .toLowerCase()
          .includes(q),
      );
    }
    return v;
  }, [visible, prefs.hidePlayed, playedBcTrackIds, search]);
  const hiddenWishlistCount = visible.length - filteredVisible.length;
  useGlobalPlaybackShortcuts();
  useCurationShortcuts();

  useEffect(() => {
    setQueue(playerQueue);
  }, [playerQueue, setQueue]);


  async function refreshWishlistFromApi() {
    const res = await fetch(`/api/wishlist?status=${tab}`);
    if (!res.ok) return;
    const json = (await res.json()) as { items?: WishlistItem[] };
    setItems((prev) => ({ ...prev, [tab]: json.items ?? [] }));
  }

  function playItem(item: WishlistItem) {
    // The queue already contains an entry for this item — either the real
    // local track id (after import) or a synthetic id with `needsResolve`.
    // Toggle against whichever id the queue currently holds; StickyPlayer
    // resolves on demand if needed.
    if (item.localTrackId != null) {
      toggle(item.localTrackId);
    } else {
      toggle(-item.bcTrackId);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border">
        {(['open', 'bought', 'dismissed'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setSelected(new Set());
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === t
                ? 'border-accent text-fg-primary'
                : 'border-transparent text-fg-secondary hover:text-fg-primary'
            }`}
          >
            {t === 'open' ? 'Open' : t === 'bought' ? 'Bought' : 'Dismissed'}{' '}
            <span className="ml-1 text-xs text-fg-muted">{counts[t]}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <HidePlayedToggle count={hiddenWishlistCount} />
          <button
            type="button"
            onClick={triggerOwnedSync}
            disabled={busy}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? 'Syncing…' : 'Sync library'}
          </button>
        </div>
      </div>

      {syncMessage && (
        <div className="rounded border border-border-success bg-bg-success p-3 text-sm text-fg-success">
          {syncMessage}
        </div>
      )}

      {tab === 'open' && visible.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={toggleAll}
            className="rounded border border-border bg-bg-elevated px-3 py-1 transition-colors hover:bg-bg-hover"
          >
            {visible.every((i) => selected.has(i.id)) ? 'Deselect all' : 'Select all'}
          </button>
          <button
            type="button"
            onClick={() => patchBatch('mark_bought', Array.from(selected))}
            disabled={busy || selected.size === 0}
            className="rounded bg-accent px-3 py-1 font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            Mark as bought ({selected.size})
          </button>
          <button
            type="button"
            onClick={() => patchBatch('dismiss', Array.from(selected))}
            disabled={busy || selected.size === 0}
            className="rounded border border-border bg-bg-elevated px-3 py-1 transition-colors hover:bg-bg-hover disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      )}

      {tab !== 'open' && visible.length > 0 && (
        <button
          type="button"
          onClick={() => patchBatch('reopen', Array.from(selected))}
          disabled={busy || selected.size === 0}
          className="rounded border border-border bg-bg-elevated px-3 py-1 text-sm transition-colors hover:bg-bg-hover disabled:opacity-50"
        >
          Move back to Open ({selected.size})
        </button>
      )}

      {message && (
        <div className="rounded border border-border bg-bg-surface p-3 text-sm text-fg-secondary">
          {message}
        </div>
      )}

      <div className="space-y-2">
        {visible.length === 0 ? (
          <div className="rounded border border-dashed border-border bg-bg-surface px-4 py-10 text-center text-sm text-fg-muted">
            {tab === 'open' ? (
              <>
                <p>Your wishlist is empty.</p>
                <p className="mt-2">
                  Tap the heart icon on any track — in Library, in
                  Discover, in a curator&rsquo;s collection, or even in the
                  player bar — to drop it in here.
                </p>
              </>
            ) : tab === 'bought' ? (
              <p>
                Nothing here yet. After your next library sync, anything you
                actually bought on Bandcamp moves here automatically.
              </p>
            ) : (
              <p>No dismissed items.</p>
            )}
          </div>
        ) : (
          <>
            <TrackListSearch
              value={search}
              onChange={setSearch}
              total={visible.length}
              visible={filteredVisible.length}
              unitLabel="item"
              unitLabelPlural="items"
            />
            {filteredVisible.length === 0 ? (
              <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
                {search.trim()
                  ? `No items match "${search}".`
                  : `All ${visible.length} items already heard. Toggle "Hide played" off to show them again.`}
              </p>
            ) : filteredVisible.length > 200 ? (
          <Virtuoso
            useWindowScroll
            totalCount={filteredVisible.length}
            overscan={400}
            computeItemKey={(index) => filteredVisible[index].id}
            itemContent={(index) => {
              const item = filteredVisible[index];
              return (
                <div className="pb-2">
                  <WishlistRow
                    item={item}
                    selected={selected.has(item.id)}
                    onToggle={() => toggleSelected(item.id)}
                    isCurrent={
                      (item.localTrackId != null && currentId === item.localTrackId) ||
                      (item.bcTrackId != null && currentId === -item.bcTrackId)
                    }
                    isPlaying={
                      ((item.localTrackId != null && currentId === item.localTrackId) ||
                        (item.bcTrackId != null && currentId === -item.bcTrackId)) &&
                      isPlaying
                    }
                    isResolving={false}
                    onPlay={() => playItem(item)}
                    hasBeenPlayedLive={
                      item.bcTrackId != null && playedBcTrackIds.has(item.bcTrackId)
                    }
                  />
                </div>
              );
            }}
          />
        ) : (
          <div className="space-y-2">
            {filteredVisible.map((item) => (
              <WishlistRow
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                onToggle={() => toggleSelected(item.id)}
                isCurrent={
                  (item.localTrackId != null && currentId === item.localTrackId) ||
                  (item.bcTrackId != null && currentId === -item.bcTrackId)
                }
                isPlaying={
                  ((item.localTrackId != null && currentId === item.localTrackId) ||
                    (item.bcTrackId != null && currentId === -item.bcTrackId)) &&
                  isPlaying
                }
                isResolving={false}
                onPlay={() => playItem(item)}
                hasBeenPlayedLive={
                  item.bcTrackId != null && playedBcTrackIds.has(item.bcTrackId)
                }
              />
            ))}
          </div>
        )}
          </>
        )}
      </div>
      <StickyPlayerBar />
    </div>
  );
}

interface RowProps {
  item: WishlistItem;
  selected: boolean;
  onToggle: () => void;
  isCurrent: boolean;
  isPlaying: boolean;
  isResolving: boolean;
  onPlay: () => void;
  hasBeenPlayedLive: boolean;
}

function WishlistRow({
  item,
  selected,
  onToggle,
  isCurrent,
  isPlaying,
  hasBeenPlayedLive,
  isResolving,
  onPlay,
}: RowProps) {
  const needsResolve = item.localTrackId == null;
  const playable = !isResolving;
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border p-2 transition-colors sm:gap-3 sm:px-3 ${
        selected
          ? 'border-accent bg-bg-elevated'
          : isCurrent
            ? 'border-accent/40 bg-bg-elevated'
            : 'border-border bg-bg-surface'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="h-4 w-4 flex-none cursor-pointer"
        aria-label="Select item"
      />
      <button
        type="button"
        onClick={onPlay}
        disabled={!playable}
        title={
          isResolving
            ? 'Looking up track on Bandcamp…'
            : needsResolve
              ? 'Click to import from Bandcamp and play'
              : isPlaying
                ? 'Pause'
                : 'Play'
        }
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className={`flex h-8 w-8 flex-none items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 ${
          isCurrent
            ? 'border-accent bg-accent text-fg-on-accent hover:bg-accent-hover'
            : 'border-border text-fg-secondary hover:border-accent hover:text-accent'
        }`}
      >
        {isResolving ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="animate-spin"
          >
            <path d="M21 12a9 9 0 1 1-6.2-8.6" strokeLinecap="round" />
          </svg>
        ) : isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <a
        href={`/track/${item.bcTrackId}`}
        className="flex-none"
        title="Open track page (middle-click for new tab)"
      >
        {item.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.coverUrl} alt="" className="h-10 w-10 rounded object-cover" />
        ) : (
          <div className="h-10 w-10 rounded bg-bg-elevated" />
        )}
      </a>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <a
            href={`/track/${item.bcTrackId}`}
            className="flex items-center gap-2 truncate text-sm font-semibold hover:underline"
            title="Open track page"
          >
            {(item.hasBeenPlayed || hasBeenPlayedLive) && (
              <PlayedCheck trackId={item.localTrackId} bcTrackId={item.bcTrackId} />
            )}
            <span className="truncate">{item.title}</span>
          </a>
          <PlaylistMembershipBadge
            trackId={item.localTrackId}
            playlists={item.playlists}
          />
        </div>
        <div className="truncate text-xs text-fg-secondary">
          {item.artistName ?? 'unknown'}
          {item.albumTitle ? ` · ${item.albumTitle}` : ''}
        </div>
        {item.status === 'bought' && (
          <div className="mt-1 text-xs text-fg-success">
            Bought {formatDateTime(item.boughtAt)} · via {item.boughtVia ?? 'manual'}
          </div>
        )}
      </div>
      <TrackActionsBar
        bcUrl={item.bcUrl}
        bcTrackId={item.bcTrackId}
        localTrackId={item.localTrackId}
        title={item.title}
        artistName={item.artistName}
        albumTitle={item.albumTitle}
        coverUrl={item.coverUrl}
        showFollow
        showArchive
      />
    </div>
  );
}
