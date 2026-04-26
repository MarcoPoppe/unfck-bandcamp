'use client';

import { useEffect } from 'react';
import { usePlayerStore } from './player';

/**
 * Beatport-style keyboard shortcuts:
 *   A = prev track
 *   D = next track
 *   Space = play/pause toggle
 *
 * W/S (like/dislike) and 1/2/3 (filters) are reserved for Phase 5/3 and
 * are not bound here.
 *
 * Shortcuts are suppressed while the user is typing into an input/textarea
 * or while a modifier key is held (so browser shortcuts still work).
 */
export function useGlobalPlaybackShortcuts() {
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const toggleIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentId = usePlayerStore((s) => s.currentId);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
      }
      const k = e.key.toLowerCase();
      if (k === 'a') {
        e.preventDefault();
        prev();
      } else if (k === 'd') {
        e.preventDefault();
        next();
      } else if (k === ' ' || k === 'spacebar') {
        if (currentId == null) return;
        e.preventDefault();
        toggleIsPlaying(!isPlaying);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [next, prev, toggleIsPlaying, isPlaying, currentId]);
}
