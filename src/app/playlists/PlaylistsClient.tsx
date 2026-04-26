'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { PlaylistRow } from '@/lib/library/playlists';

export default function PlaylistsClient({ initialPlaylists }: { initialPlaylists: PlaylistRow[] }) {
  const [playlists, setPlaylists] = useState<PlaylistRow[]>(initialPlaylists);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch('/api/playlists');
    if (!res.ok) return;
    const json = (await res.json()) as { playlists?: PlaylistRow[] };
    setPlaylists(json.playlists ?? []);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: name.trim() }),
      });
      if (res.ok) {
        setName('');
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Playlist loeschen?')) return;
    const res = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', playlistId: id }),
    });
    if (res.ok) await refresh();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-bg-surface p-4">
        <h2 className="text-base font-semibold">Playlist anlegen</h2>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Berghain Set 2026-04"
            className="flex-1 rounded border border-border bg-bg-base px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !name.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-fg-primary transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            anlegen
          </button>
        </div>
      </section>

      <div className="space-y-2">
        {playlists.length === 0 ? (
          <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-center text-sm text-fg-muted">
            Noch keine Playlists.
          </p>
        ) : (
          playlists.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-bg-surface p-3"
            >
              <Link
                href={`/playlists/${p.id}`}
                className="flex-1 truncate font-medium hover:text-accent"
              >
                {p.name}
              </Link>
              <span className="text-sm text-fg-muted">{p.trackCount} Tracks</span>
              <button
                type="button"
                onClick={() => handleDelete(p.id)}
                className="rounded border border-border px-3 py-1 text-xs text-fg-secondary transition-colors hover:border-red-700 hover:text-red-200"
              >
                loeschen
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
