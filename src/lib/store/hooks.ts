'use client';

import { useEffect } from 'react';
import { usePlayerStore } from './player';
import { useShortcuts } from '../settings/shortcuts';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

function eventKey(e: KeyboardEvent): string {
  if (e.key === ' ' || e.key === 'Spacebar') return ' ';
  if (e.key.length === 1) return e.key.toLowerCase();
  return e.key;
}

/**
 * Beatport-style transport shortcuts. Bindings come from user settings
 * (localStorage); defaults are A/D/Space + W to like (= wishlist-add).
 */
export function useGlobalPlaybackShortcuts() {
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentId = usePlayerStore((s) => s.currentId);
  const queue = usePlayerStore((s) => s.queue);
  const bindings = useShortcuts();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isTypingTarget(e.target)) return;
      const k = eventKey(e);
      if (k === bindings.prev) {
        e.preventDefault();
        prev();
      } else if (k === bindings.next) {
        e.preventDefault();
        next();
      } else if (k === bindings.playPause) {
        if (currentId == null) return;
        e.preventDefault();
        setIsPlaying(!isPlaying);
      } else if (k === bindings.like) {
        // Add the currently playing track to the wishlist. Fire-and-
        // forget; if it's already on the wishlist the API just returns
        // ok=false and the row stays untouched.
        if (currentId == null) return;
        const cur = queue.find((t) => t.id === currentId);
        if (!cur || cur.bcTrackId == null) return;
        e.preventDefault();
        void fetch('/api/wishlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bcTrackId: cur.bcTrackId,
            bcUrl: cur.bcUrl,
            title: cur.title,
            artistName: cur.artistName,
            albumTitle: cur.albumTitle,
            coverUrl: cur.coverUrl,
          }),
        }).catch(() => {});
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [next, prev, setIsPlaying, isPlaying, currentId, queue, bindings]);
}

/**
 * No-op shells kept so callers don't break. Like/dislike + filter shortcuts
 * were retired when Marco removed rating curation from the UI; the binding
 * settings still live in /setup so this can be restored without a migration.
 */
export function useCurationShortcuts() {
  // intentionally empty
}

export function useFilterShortcuts() {
  // intentionally empty
}
