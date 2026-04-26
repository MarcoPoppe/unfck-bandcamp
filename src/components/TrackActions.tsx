'use client';

import { useEffect, useRef, useState } from 'react';

interface TagOption {
  id: number;
  name: string;
  color: string;
}

interface PlaylistOption {
  id: number;
  name: string;
}

interface Props {
  trackId: number;
}

/**
 * Compact dropdown that lets the user attach a tag or playlist to a track
 * directly from a TrackRow. Loads the option lists lazily when the menu
 * opens. Keeps state local — we don't track per-row attachment status here
 * (Phase 5B can lift this once the UI matures).
 */
export default function TrackActions({ trackId }: Props) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current) return;
      if (e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function loadOptions() {
    if (loaded) return;
    try {
      const [tRes, pRes] = await Promise.all([
        fetch('/api/tags'),
        fetch('/api/playlists'),
      ]);
      const tJson = (await tRes.json()) as { tags?: TagOption[] };
      const pJson = (await pRes.json()) as { playlists?: PlaylistOption[] };
      setTags(tJson.tags ?? []);
      setPlaylists(pJson.playlists ?? []);
      setLoaded(true);
    } catch {
      setMessage('konnte Tags/Playlists nicht laden');
    }
  }

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      if (next) void loadOptions();
      return next;
    });
  }

  async function attachTag(tagId: number) {
    setBusy(true);
    setMessage(null);
    try {
      await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'attach', trackId, tagId }),
      });
      setMessage('Tag hinzugefuegt');
    } finally {
      setBusy(false);
    }
  }

  async function addToPlaylist(playlistId: number) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_track', playlistId, trackId }),
      });
      const json = (await res.json()) as { added?: boolean };
      setMessage(json.added ? 'zu Playlist hinzugefuegt' : 'war schon drin');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className="text-xs text-fg-muted transition-colors hover:text-accent"
        title="Tag oder Playlist"
      >
        +
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-20 w-56 rounded border border-border bg-bg-elevated p-2 shadow-lg">
          <div className="px-2 py-1 text-xs uppercase tracking-wide text-fg-muted">Tag</div>
          {tags.length === 0 ? (
            <div className="px-2 py-1 text-xs text-fg-muted">noch keine Tags</div>
          ) : (
            tags.map((t) => (
              <button
                key={`t-${t.id}`}
                type="button"
                disabled={busy}
                onClick={() => attachTag(t.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors hover:bg-bg-hover disabled:opacity-50"
              >
                <span className="h-3 w-3 rounded" style={{ backgroundColor: t.color }} />
                <span className="truncate">{t.name}</span>
              </button>
            ))
          )}
          <div className="mt-2 px-2 py-1 text-xs uppercase tracking-wide text-fg-muted">
            Playlist
          </div>
          {playlists.length === 0 ? (
            <div className="px-2 py-1 text-xs text-fg-muted">noch keine Playlists</div>
          ) : (
            playlists.map((p) => (
              <button
                key={`p-${p.id}`}
                type="button"
                disabled={busy}
                onClick={() => addToPlaylist(p.id)}
                className="block w-full truncate rounded px-2 py-1 text-left text-sm transition-colors hover:bg-bg-hover disabled:opacity-50"
              >
                {p.name}
              </button>
            ))
          )}
          {message && (
            <div className="mt-2 border-t border-border px-2 pt-2 text-xs text-fg-secondary">
              {message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
