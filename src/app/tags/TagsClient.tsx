'use client';

import { useState } from 'react';
import type { TagRow } from '@/lib/library/tags';

export default function TagsClient({ initialTags }: { initialTags: TagRow[] }) {
  const [tags, setTags] = useState<TagRow[]>(initialTags);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#7c5cff');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/tags');
    if (!res.ok) return;
    const json = (await res.json()) as { tags?: TagRow[] };
    setTags(json.tags ?? []);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: name.trim(), color }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? `create failed (${res.status})`);
      } else {
        setName('');
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Tag wirklich loeschen? Alle Track-Zuweisungen gehen verloren.')) return;
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', tagId: id }),
    });
    if (res.ok) await refresh();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-bg-surface p-4">
        <h2 className="text-base font-semibold">Tag erstellen</h2>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Sommer 26, Set XYZ"
            className="flex-1 rounded border border-border bg-bg-base px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded border border-border bg-bg-base"
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
        {message && (
          <p className="mt-3 text-sm text-red-300">{message}</p>
        )}
      </section>

      <div className="space-y-2">
        {tags.length === 0 ? (
          <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-center text-sm text-fg-muted">
            Noch keine Tags angelegt.
          </p>
        ) : (
          tags.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-bg-surface p-3"
            >
              <span
                className="h-4 w-4 flex-none rounded"
                style={{ backgroundColor: t.color }}
              />
              <div className="flex-1 truncate font-medium">{t.name}</div>
              <span className="text-sm text-fg-muted">{t.trackCount ?? 0} Tracks</span>
              <button
                type="button"
                onClick={() => handleDelete(t.id)}
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
