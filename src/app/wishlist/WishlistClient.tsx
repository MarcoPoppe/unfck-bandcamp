'use client';

import { useState } from 'react';
import type { WishlistItem, WishlistStatus } from '@/lib/wishlist/store';

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
        setMessage(json.error ?? `action failed (${res.status})`);
      } else {
        setMessage(`${json.updated ?? 0} Items aktualisiert`);
        await refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'action failed');
    } finally {
      setBusy(false);
    }
  }

  async function triggerOwnedSync() {
    setBusy(true);
    setSyncMessage(null);
    try {
      const res1 = await fetch('/api/sync/owned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const j1 = (await res1.json()) as {
        ok?: boolean;
        wishlistAutoMarked?: number;
        durationMs?: number;
        error?: string;
      };
      if (!res1.ok || !j1.ok) {
        setSyncMessage(j1.error ?? `owned-sync failed (${res1.status})`);
        return;
      }
      // Then expand new items into tracks and sweep the wishlist again,
      // because album purchases only show up as track rows after expansion.
      const res2 = await fetch('/api/sync/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const j2 = (await res2.json()) as {
        ok?: boolean;
        wishlistAutoMarked?: number;
        durationMs?: number;
        error?: string;
        itemsExpanded?: number;
        tracksWritten?: number;
      };
      const sec1 = ((j1.durationMs ?? 0) / 1000).toFixed(1);
      if (!res2.ok || !j2.ok) {
        setSyncMessage(
          `Owned-Sync OK (${sec1}s, ${j1.wishlistAutoMarked ?? 0} auto-marked), ` +
            `Track-Expand fehlgeschlagen: ${j2.error ?? `HTTP ${res2.status}`}. ` +
            `Album-Auto-Match koennte unvollstaendig sein.`,
        );
        await refresh();
        return;
      }
      const totalAuto = (j1.wishlistAutoMarked ?? 0) + (j2.wishlistAutoMarked ?? 0);
      const sec2 = ((j2.durationMs ?? 0) / 1000).toFixed(1);
      setSyncMessage(
        `Owned-Sync ${sec1}s + Track-Expand ${sec2}s ` +
          `(${j2.tracksWritten ?? 0} neue Tracks), ${totalAuto} Wishlist-Items auto-marked`,
      );
      await refresh();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'sync failed');
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
            {t === 'open' ? 'Offen' : t === 'bought' ? 'Gekauft' : 'Verworfen'}{' '}
            <span className="ml-1 text-xs text-fg-muted">{counts[t]}</span>
          </button>
        ))}
        <div className="ml-auto">
          <button
            type="button"
            onClick={triggerOwnedSync}
            disabled={busy}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-fg-primary transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? 'busy...' : 'Owned-Sync (Auto-Mark)'}
          </button>
        </div>
      </div>

      {syncMessage && (
        <div className="rounded border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">
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
            {visible.every((i) => selected.has(i.id)) ? 'keine ausgewaehlt' : 'alle auswaehlen'}
          </button>
          <button
            type="button"
            onClick={() => patchBatch('mark_bought', Array.from(selected))}
            disabled={busy || selected.size === 0}
            className="rounded bg-accent px-3 py-1 font-medium text-fg-primary transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            habe ich gekauft ({selected.size})
          </button>
          <button
            type="button"
            onClick={() => patchBatch('dismiss', Array.from(selected))}
            disabled={busy || selected.size === 0}
            className="rounded border border-border bg-bg-elevated px-3 py-1 transition-colors hover:bg-bg-hover disabled:opacity-50"
          >
            verwerfen
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
          zurueck zu Offen ({selected.size})
        </button>
      )}

      {message && (
        <div className="rounded border border-border bg-bg-surface p-3 text-sm text-fg-secondary">
          {message}
        </div>
      )}

      <div className="space-y-2">
        {visible.length === 0 ? (
          <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
            {tab === 'open'
              ? 'Wishlist ist leer. Tracks aus /tracks oder /discover hinzufuegen kommt in Folge-UI.'
              : `Keine ${tab === 'bought' ? 'gekauften' : 'verworfenen'} Items.`}
          </p>
        ) : (
          visible.map((item) => (
            <WishlistRow
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              onToggle={() => toggleSelected(item.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface RowProps {
  item: WishlistItem;
  selected: boolean;
  onToggle: () => void;
}

function WishlistRow({ item, selected, onToggle }: RowProps) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
        selected ? 'border-accent bg-bg-elevated' : 'border-border bg-bg-surface'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="h-4 w-4 cursor-pointer"
      />
      {item.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.coverUrl} alt="" className="h-12 w-12 flex-none rounded object-cover" />
      ) : (
        <div className="h-12 w-12 flex-none rounded bg-bg-elevated" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.title}</div>
        <div className="truncate text-xs text-fg-secondary">
          {item.artistName ?? 'unknown'}
          {item.albumTitle ? ` · ${item.albumTitle}` : ''}
        </div>
        {item.status === 'bought' && (
          <div className="mt-1 text-xs text-emerald-300">
            gekauft {item.boughtAt} · via {item.boughtVia ?? 'manual'}
          </div>
        )}
      </div>
      <a
        href={item.bcUrl}
        target="_blank"
        rel="noreferrer"
        className="rounded border border-border bg-bg-base px-3 py-1 text-xs text-fg-secondary transition-colors hover:border-accent hover:text-accent"
      >
        ↗ BC
      </a>
    </div>
  );
}
