'use client';

import { useEffect, useRef, useState } from 'react';

interface PlaylistOption {
  id: number;
  name: string;
  contains: boolean;
}

type Kind = 'artist' | 'digger';

interface Props {
  kind: Kind;
  /** Local entity id (artists.id or diggers.id). */
  entityId: number;
  className?: string;
}

/**
 * Dropdown that lets the user toggle which playlists an artist or curator
 * is tagged into. Pfad A from the playlist-bucket design: playlists carry
 * artists + curators, not just tracks, so Discover can scope a crawl to
 * "only the artists + curators tagged into this bucket".
 *
 * Distinct from `AddToPlaylistButton.tsx` which handles per-track membership
 * (different schema, different endpoint).
 */
export default function AddEntityToPlaylistButton({ kind, entityId, className }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [playlists, setPlaylists] = useState<PlaylistOption[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);

  const baseUrl =
    kind === 'artist'
      ? `/api/artists/${entityId}/playlists`
      : `/api/digger/${entityId}/playlists`;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void fetch(baseUrl)
      .then((r) => r.json() as Promise<{ ok?: boolean; playlists?: PlaylistOption[] }>)
      .then((j) => {
        if (j.ok && j.playlists) setPlaylists(j.playlists);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, baseUrl]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function toggle(p: PlaylistOption) {
    setBusyIds((prev) => new Set(prev).add(p.id));
    const action = p.contains ? 'remove' : 'add';
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId: p.id, action }),
      });
      const json = (await res.json()) as { ok?: boolean };
      if (json.ok) {
        setPlaylists((prev) =>
          prev.map((x) => (x.id === p.id ? { ...x, contains: !x.contains } : x)),
        );
      }
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    }
  }

  const inCount = playlists.filter((p) => p.contains).length;
  const label =
    inCount > 0 ? `In ${inCount} playlist${inCount === 1 ? '' : 's'}` : 'Add to playlist';

  return (
    <div ref={ref} className={`relative inline-block ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:border-accent hover:text-fg-primary"
      >
        {label}
        <span className="ml-1 text-fg-muted">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded border border-border bg-bg-elevated shadow-lg">
          <div className="border-b border-border px-3 py-2 text-xs text-fg-muted">
            Tag this {kind === 'artist' ? 'artist' : 'curator'} into playlists
          </div>
          {loading ? (
            <div className="p-3 text-sm text-fg-muted">Loading…</div>
          ) : playlists.length === 0 ? (
            <div className="p-3 text-sm text-fg-muted">
              No playlists yet. Create one in the Playlists tab.
            </div>
          ) : (
            <ul className="max-h-72 overflow-auto py-1">
              {playlists.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={busyIds.has(p.id)}
                    onClick={() => toggle(p)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-bg-hover disabled:opacity-50"
                  >
                    <span className="truncate">{p.name}</span>
                    <span
                      className={`flex h-4 w-4 flex-none items-center justify-center rounded border text-[10px] ${
                        p.contains
                          ? 'border-accent bg-accent text-fg-on-accent'
                          : 'border-border'
                      }`}
                      aria-label={p.contains ? 'in playlist' : 'not in playlist'}
                    >
                      {p.contains ? '✓' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
