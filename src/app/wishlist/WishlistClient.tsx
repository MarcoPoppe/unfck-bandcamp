'use client';

import { useEffect, useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
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

interface BulkAddItemResult {
  key: string;
  status: 'added' | 'duplicate_skipped' | 'owned_skipped' | 'failed' | 'main_auth_expired';
  error?: string;
}

interface SyncRunSummary {
  id: number;
  status: 'running' | 'success' | 'error';
  errorMessage: string | null;
  itemsSynced: number;
  finishedAt: string | null;
}

function itemKey(item: WishlistItem): string | null {
  const id = item.bcItemType === 't' ? item.bcTrackId : item.bcAlbumId;
  return id != null ? `${item.bcItemType}:${id}` : null;
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
  const [bcSyncRunning, setBcSyncRunning] = useState(false);
  const [recentSizeMismatches, setRecentSizeMismatches] = useState(0);
  const [cartResults, setCartResults] = useState<Record<string, BulkAddItemResult>>({});
  const [retryingKeys, setRetryingKeys] = useState<Set<string>>(new Set());

  const setWishlistedItems = usePlayerStore((s) => s.setWishlistedItems);

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
    const openItems = o.items ?? [];
    const keys = openItems
      .map(itemKey)
      .filter((k): k is string => k !== null);
    setWishlistedItems(keys);
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

  async function pollBcSyncStatus(): Promise<void> {
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch('/api/sync/wishlist');
      if (!res.ok) continue;
      const json = (await res.json()) as { ok?: boolean; run?: SyncRunSummary; recent?: SyncRunSummary[] };
      if (json.recent) {
        const consecutiveSize = json.recent
          .slice(0, 3)
          .filter((r) => r.status === 'error' && (r.errorMessage ?? '').includes('size_mismatch'))
          .length;
        setRecentSizeMismatches(consecutiveSize >= 3 ? consecutiveSize : 0);
      }
      const run = json.run;
      if (!run || run.status === 'running') continue;
      setBcSyncRunning(false);
      if (run.status === 'success') {
        setSyncMessage(`Wishlist synced with Bandcamp · ${run.itemsSynced} items`);
        await refresh();
      } else {
        setSyncMessage(`Wishlist sync failed: ${run.errorMessage ?? 'unknown error'}`);
      }
      return;
    }
    setBcSyncRunning(false);
    setSyncMessage('Wishlist sync still running after 10 minutes; check sync_runs in DB');
  }

  async function triggerBcWishlistSync() {
    setBusy(true);
    setSyncMessage(null);
    setBcSyncRunning(true);
    try {
      const res = await fetch('/api/sync/wishlist', { method: 'POST' });
      if (!res.ok) {
        setSyncMessage(`Could not start wishlist sync (${res.status})`);
        setBcSyncRunning(false);
        return;
      }
      await pollBcSyncStatus();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Sync failed');
      setBcSyncRunning(false);
    } finally {
      setBusy(false);
    }
  }

  async function triggerCartAdd() {
    if (selected.size === 0) return;
    const openItems = items.open;
    const itemsForCart = openItems
      .filter((i) => selected.has(i.id))
      .map((i) => {
        const id = i.bcItemType === 't' ? i.bcTrackId : i.bcAlbumId;
        return id != null ? { itemType: i.bcItemType, itemId: id, bcUrl: i.bcUrl } : null;
      })
      .filter((i): i is { itemType: 't' | 'a'; itemId: number; bcUrl: string } => i !== null);
    if (itemsForCart.length === 0) return;
    setBusy(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/cart/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsForCart }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        alreadyRunning?: boolean;
        results?: BulkAddItemResult[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setSyncMessage(json.error ?? `Cart-add failed (${res.status})`);
        return;
      }
      if (json.alreadyRunning) {
        setSyncMessage('Another cart-add run is already in flight. Wait for it to finish.');
        return;
      }
      const map: Record<string, BulkAddItemResult> = { ...cartResults };
      for (const r of json.results ?? []) {
        map[r.key] = r;
      }
      setCartResults(map);
      const added = (json.results ?? []).filter((r) => r.status === 'added').length;
      const skipped = (json.results ?? []).filter((r) => r.status === 'owned_skipped').length;
      const failed = (json.results ?? []).filter((r) => r.status === 'failed').length;
      setSyncMessage(
        `Cart-add finished · ${added} added · ${skipped} already owned · ${failed} failed`,
      );
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Cart-add failed');
    } finally {
      setBusy(false);
    }
  }

  async function retryMirror(item: WishlistItem) {
    const id = item.bcItemType === 't' ? item.bcTrackId : item.bcAlbumId;
    if (id == null) return;
    const key = `${item.bcItemType}:${id}`;
    setRetryingKeys((prev) => new Set(prev).add(key));
    try {
      const res = await fetch('/api/wishlist/retry-mirror', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType: item.bcItemType, itemId: id }),
      });
      if (res.status === 409) return;
      await refresh();
    } finally {
      setRetryingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
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
    // Only track-typed items are playable. Album items still appear in the
    // list but their play button is disabled (album playback would require
    // expanding the tracklist; out of scope for the sync feature).
    return visible
      .filter((i) => i.bcItemType === 't' && i.bcTrackId != null)
      .map<TrackRowData>((i) => {
        const bcTrackId = i.bcTrackId as number;
        if (i.localTrackId != null) {
          return {
            id: i.localTrackId,
            title: i.title,
            artistName: i.artistName ?? null,
            albumTitle: i.albumTitle ?? null,
            durationSeconds: null,
            trackNumber: null,
            coverUrl: i.coverUrl ?? null,
            bcUrl: i.bcUrl,
            hasStream: i.hasStream ?? false,
            bcTrackId,
            hasBeenPlayed: i.hasBeenPlayed ?? false,
            source: 'owned',
          };
        }
        return {
          id: -bcTrackId,
          title: i.title,
          artistName: i.artistName ?? null,
          albumTitle: i.albumTitle ?? null,
          durationSeconds: null,
          trackNumber: null,
          coverUrl: i.coverUrl ?? null,
          bcUrl: i.bcUrl,
          hasStream: true,
          bcTrackId,
          hasBeenPlayed: i.hasBeenPlayed ?? false,
          needsResolve: true,
          source: 'owned',
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
      v = v.filter((i) => {
        const trackId = i.bcTrackId;
        return !(i.hasBeenPlayed || (trackId != null && playedBcTrackIds.has(trackId)));
      });
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

  function playItem(item: WishlistItem) {
    if (item.bcItemType !== 't' || item.bcTrackId == null) return;
    if (item.localTrackId != null) {
      toggle(item.localTrackId);
    } else {
      toggle(-item.bcTrackId);
    }
  }

  const pushFailedCount = items.open.filter((i) => i.mirrorState === 'push_failed').length;

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
            onClick={triggerBcWishlistSync}
            disabled={busy || bcSyncRunning}
            title="Pull wishlist state from bandcamp.com (mirror)"
            className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm font-medium transition-colors hover:bg-bg-hover disabled:opacity-50"
          >
            {bcSyncRunning ? 'Syncing BC…' : 'Sync with Bandcamp'}
          </button>
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

      {recentSizeMismatches >= 3 && (
        <div className="rounded border border-border-warning bg-bg-warning p-3 text-sm text-fg-warning">
          Bandcamp wishlist appears to be changing while we sync (3+ consecutive
          size mismatches). Try again in a minute, or pause new heart actions
          until the next attempt succeeds.
        </div>
      )}

      {syncMessage && (
        <div className="rounded border border-border-success bg-bg-success p-3 text-sm text-fg-success">
          {syncMessage}
        </div>
      )}

      {pushFailedCount > 0 && tab === 'open' && (
        <div className="rounded border border-border-warning bg-bg-warning p-3 text-sm text-fg-warning">
          {pushFailedCount} item{pushFailedCount === 1 ? '' : 's'} failed to mirror to
          Bandcamp. Use the &ldquo;Retry mirror&rdquo; button on those rows.
        </div>
      )}

      {tab === 'open' && visible.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
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
          <button
            type="button"
            onClick={triggerCartAdd}
            disabled={busy || selected.size === 0}
            className="rounded border border-accent bg-bg-elevated px-3 py-1 font-medium text-accent transition-colors hover:bg-bg-hover disabled:opacity-50"
          >
            Add to Bandcamp cart ({selected.size})
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
                  const key = itemKey(item);
                  return (
                    <div className="pb-2">
                      <WishlistRow
                        item={item}
                        selected={selected.has(item.id)}
                        onToggle={() => toggleSelected(item.id)}
                        isCurrent={isItemCurrent(item, currentId)}
                        isPlaying={isItemCurrent(item, currentId) && isPlaying}
                        isResolving={false}
                        onPlay={() => playItem(item)}
                        hasBeenPlayedLive={
                          item.bcTrackId != null && playedBcTrackIds.has(item.bcTrackId)
                        }
                        cartStatus={key ? cartResults[key]?.status : undefined}
                        cartError={key ? cartResults[key]?.error : undefined}
                        onRetryMirror={() => retryMirror(item)}
                        retrying={key ? retryingKeys.has(key) : false}
                      />
                    </div>
                  );
                }}
              />
            ) : (
              <div className="space-y-2">
                {filteredVisible.map((item) => {
                  const key = itemKey(item);
                  return (
                    <WishlistRow
                      key={item.id}
                      item={item}
                      selected={selected.has(item.id)}
                      onToggle={() => toggleSelected(item.id)}
                      isCurrent={isItemCurrent(item, currentId)}
                      isPlaying={isItemCurrent(item, currentId) && isPlaying}
                      isResolving={false}
                      onPlay={() => playItem(item)}
                      hasBeenPlayedLive={
                        item.bcTrackId != null && playedBcTrackIds.has(item.bcTrackId)
                      }
                      cartStatus={key ? cartResults[key]?.status : undefined}
                      cartError={key ? cartResults[key]?.error : undefined}
                      onRetryMirror={() => retryMirror(item)}
                      retrying={key ? retryingKeys.has(key) : false}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function isItemCurrent(item: WishlistItem, currentId: number | null): boolean {
  if (currentId == null) return false;
  if (item.localTrackId != null && currentId === item.localTrackId) return true;
  if (item.bcTrackId != null && currentId === -item.bcTrackId) return true;
  return false;
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
  cartStatus?: BulkAddItemResult['status'];
  cartError?: string;
  onRetryMirror: () => void;
  retrying: boolean;
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
  cartStatus,
  cartError,
  onRetryMirror,
  retrying,
}: RowProps) {
  const needsResolve = item.localTrackId == null;
  const isAlbum = item.bcItemType === 'a';
  const playable = !isResolving && !isAlbum;
  const linkHref = isAlbum
    ? item.bcUrl
    : `/track/${item.bcTrackId}`;
  const isExternalLink = isAlbum;
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
          isAlbum
            ? 'Album — open on Bandcamp to play'
            : isResolving
              ? 'Looking up track on Bandcamp…'
              : needsResolve
                ? 'Click to import from Bandcamp and play'
                : isPlaying
                  ? 'Pause'
                  : 'Play'
        }
        aria-label={isAlbum ? 'Album, not playable inline' : isPlaying ? 'Pause' : 'Play'}
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
        href={linkHref}
        target={isExternalLink ? '_blank' : undefined}
        rel={isExternalLink ? 'noopener noreferrer' : undefined}
        className="flex-none"
        title={isExternalLink ? 'Open album on Bandcamp' : 'Open track page (middle-click for new tab)'}
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
            href={linkHref}
            target={isExternalLink ? '_blank' : undefined}
            rel={isExternalLink ? 'noopener noreferrer' : undefined}
            className="flex items-center gap-2 truncate text-sm font-semibold hover:underline"
            title={isExternalLink ? 'Open album on Bandcamp' : 'Open track page'}
          >
            {(item.hasBeenPlayed || hasBeenPlayedLive) && item.bcTrackId != null && (
              <PlayedCheck trackId={item.localTrackId ?? null} bcTrackId={item.bcTrackId} />
            )}
            <span className="truncate">{item.title}</span>
            {isAlbum && (
              <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-xs uppercase text-fg-muted">
                Album
              </span>
            )}
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
        {item.mirrorState === 'push_failed' && (
          <div className="mt-1 flex items-center gap-2 text-xs text-fg-warning">
            <span title={item.mirrorError ?? 'mirror push failed'}>
              ⚠ mirror failed: {item.mirrorError ?? 'unknown error'}
            </span>
            <button
              type="button"
              onClick={onRetryMirror}
              disabled={retrying}
              className="rounded border border-border bg-bg-surface px-2 py-0.5 text-xs hover:bg-bg-hover disabled:opacity-50"
            >
              {retrying ? 'Retrying…' : 'Retry mirror'}
            </button>
          </div>
        )}
        {item.mirrorState === 'pushing' && (
          <div className="mt-1 text-xs text-fg-muted">⏳ pushing to Bandcamp…</div>
        )}
        {cartStatus && (
          <div className="mt-1 text-xs">
            {cartStatus === 'added' && <span className="text-fg-success">✓ in Bandcamp cart</span>}
            {cartStatus === 'owned_skipped' && (
              <span className="text-fg-muted">⊘ already owned</span>
            )}
            {cartStatus === 'duplicate_skipped' && (
              <span className="text-fg-muted">⊘ duplicate</span>
            )}
            {cartStatus === 'failed' && (
              <span className="text-fg-warning">
                ✗ cart-add failed{cartError ? `: ${cartError}` : ''}
              </span>
            )}
            {cartStatus === 'main_auth_expired' && (
              <span className="text-fg-warning">✗ main-auth expired, re-link account</span>
            )}
          </div>
        )}
      </div>
      {!isAlbum && item.bcTrackId != null && (
        <TrackActionsBar
          bcUrl={item.bcUrl}
          bcTrackId={item.bcTrackId}
          localTrackId={item.localTrackId ?? null}
          title={item.title}
          artistName={item.artistName ?? null}
          albumTitle={item.albumTitle ?? null}
          coverUrl={item.coverUrl ?? null}
          showFollow
          showArchive
        />
      )}
    </div>
  );
}
