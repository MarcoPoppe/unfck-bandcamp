'use client';

import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '@/lib/store/player';
import Tooltip from './Tooltip';

interface PlaylistOption {
  id: number;
  name: string;
  contains: boolean;
}

interface Props {
  trackId: number;
  /** Open the dropdown immediately on mount. Used by the Lazy* wrappers
   * after a successful /api/track/lookup so the user doesn't have to
   * click twice (once to resolve, once to open). */
  initiallyOpen?: boolean;
}

/**
 * Per-row playlist manager. The trigger button shows a music-note glyph
 * (matching PlaylistMembershipBadge). Opening it loads the user's playlists
 * with `contains` annotated for this track, and renders one checkbox per
 * playlist. Toggling a box adds or removes the track from that playlist
 * with optimistic UI: state flips immediately, the request reconciles in
 * the background.
 *
 * Naming kept as `AddToPlaylistButton` for grep continuity; the file now
 * also handles removal.
 */
export default function AddToPlaylistButton({ trackId, initiallyOpen = false }: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  const [playlists, setPlaylists] = useState<PlaylistOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  // Whether the dropdown should open above (true) or below (false) the
  // trigger button. Computed at open-time from the trigger's distance to
  // the viewport bottom so rows near the bottom of the page (or behind
  // the sticky player bar) still show the full menu.
  const [openUpward, setOpenUpward] = useState(false);
  // Subscribe to the live membership for this track so the trigger button's
  // accent state and tooltip reflect store updates from any other dropdown
  // instance (or a different page already mounted in the queue store).
  const liveMembership = usePlayerStore((s) =>
    s.playlistMembershipByTrackId.get(trackId),
  );
  const addPlaylistMembership = usePlayerStore((s) => s.addPlaylistMembership);
  const removePlaylistMembership = usePlayerStore(
    (s) => s.removePlaylistMembership,
  );

  useEffect(() => {
    setOpen(initiallyOpen);
    setPlaylists([]);
    setLoaded(false);
    setLoading(false);
    setBusyIds(new Set());
    setErrorMsg(null);
  }, [trackId, initiallyOpen]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current) return;
      if (e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // When `open` flips on (toggleOpen or initiallyOpen), compute flip
  // direction and fetch the playlist list. Doing this in an effect keeps
  // toggleOpen a pure state update — the previous impure updater pattern
  // (side effects inside setOpen's updater function) lost the open=true
  // commit intermittently because React 18 may re-invoke updaters and the
  // setState calls inside collided with the outer setOpen.
  useEffect(() => {
    if (!open) return;
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < 360);
    }
    void loadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function loadOptions() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/playlists?trackId=${trackId}`);
      const json = (await res.json()) as { ok?: boolean; playlists?: PlaylistOption[] };
      setPlaylists(json.playlists ?? []);
      setLoaded(true);
    } catch {
      setErrorMsg('Could not load playlists');
    } finally {
      setLoading(false);
    }
  }

  function toggleOpen() {
    setOpen((prev) => !prev);
  }

  async function toggleMembership(p: PlaylistOption) {
    if (busyIds.has(p.id)) return;
    const willContain = !p.contains;
    // Optimistic flip
    setPlaylists((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, contains: willContain } : x)),
    );
    setBusyIds((prev) => {
      const next = new Set(prev);
      next.add(p.id);
      return next;
    });
    setErrorMsg(null);
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: willContain ? 'add_track' : 'remove_track',
          playlistId: p.id,
          trackId,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        // Roll back optimistic flip
        setPlaylists((prev) =>
          prev.map((x) => (x.id === p.id ? { ...x, contains: p.contains } : x)),
        );
        setErrorMsg(json.error ?? 'Update failed');
      } else {
        // Mirror the change into the global store so every visible badge
        // for this track updates without a page refresh.
        if (willContain) {
          addPlaylistMembership(trackId, { id: p.id, name: p.name });
        } else {
          removePlaylistMembership(trackId, p.id);
        }
      }
    } catch {
      setPlaylists((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, contains: p.contains } : x)),
      );
      setErrorMsg('Update failed');
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    }
  }

  // Prefer the live store value (kept in sync across the app) once it has
  // been populated for this track; fall back to the locally-loaded list
  // before the dropdown has fetched, and to zero before either has hydrated.
  const memberCount = liveMembership
    ? liveMembership.length
    : playlists.filter((p) => p.contains).length;

  return (
    <div className="relative" ref={ref}>
      <Tooltip
        text={
          memberCount > 0
            ? `In ${memberCount} playlist${memberCount === 1 ? '' : 's'} — click to manage`
            : 'Add to playlist'
        }
        position="top"
        disabled={open}
      >
      <button
        type="button"
        onClick={toggleOpen}
        className={`relative flex h-9 w-9 items-center justify-center rounded transition-colors hover:bg-bg-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          memberCount > 0 ? 'text-accent' : 'text-fg-muted'
        }`}
        aria-label="Manage playlist membership"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M9 17V5l10-2v12"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="6" cy="17" r="3" />
          <circle cx="16" cy="15" r="3" />
        </svg>
      </button>
      </Tooltip>
      {open && (
        <div
          className={`absolute right-0 z-50 w-64 rounded border border-border bg-bg-elevated p-2 shadow-lg ${
            openUpward ? 'bottom-10' : 'top-10'
          }`}
        >
          <div className="px-2 py-1 text-xs uppercase tracking-wide text-fg-muted">
            Playlists
          </div>
          {loading && !loaded ? (
            <div className="px-2 py-2 text-xs text-fg-muted">Loading…</div>
          ) : playlists.length === 0 ? (
            <div className="px-2 py-2 text-xs text-fg-muted">
              No playlists yet. Create one on the{' '}
              <a className="text-accent underline" href="/playlists">
                Playlists page
              </a>
              .
            </div>
          ) : (
            <ul role="menu" className="max-h-72 overflow-auto">
              {playlists.map((p) => {
                const busy = busyIds.has(p.id);
                return (
                  <li key={p.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-bg-hover ${
                        busy ? 'opacity-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={p.contains}
                        disabled={busy}
                        onChange={() => toggleMembership(p)}
                        className="h-4 w-4 flex-none cursor-pointer accent-accent"
                        aria-label={
                          p.contains ? `Remove from ${p.name}` : `Add to ${p.name}`
                        }
                      />
                      <span
                        className={`truncate text-sm ${
                          p.contains ? 'text-fg-primary' : 'text-fg-secondary'
                        }`}
                      >
                        {p.name}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {errorMsg && (
            <div className="mt-2 border-t border-border-danger px-2 pt-2 text-xs text-fg-danger">
              {errorMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
