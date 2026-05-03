'use client';

import { useEffect, useState } from 'react';

/**
 * Shortcut bindings live in localStorage so they persist per-browser without
 * needing a server round-trip. Hooks read defaults synchronously on first
 * render (SSR-safe) and rehydrate from storage in useEffect, then listen for
 * the `unfck:shortcuts-changed` event so updates from Settings propagate to
 * every mounted hook in the same tab.
 */

export interface ShortcutBindings {
  prev: string;
  next: string;
  playPause: string;
  like: string;
  dislike: string;
  filterAll: string;
  filterLiked: string;
  filterUnrated: string;
  filterDisliked: string;
}

export const DEFAULT_BINDINGS: ShortcutBindings = {
  prev: 'a',
  next: 'd',
  playPause: ' ',
  like: 'w',
  dislike: 's',
  filterAll: '0',
  filterLiked: '1',
  filterUnrated: '2',
  filterDisliked: '3',
};

export interface ShortcutMeta {
  id: keyof ShortcutBindings;
  label: string;
  group: 'transport' | 'curation' | 'filter';
  description: string;
}

// Like is back as the wishlist-add shortcut. dislike + the rating filters
// are still hidden because the like/dislike rating system itself was
// retired — restoring them is just a matter of adding the entries here.
export const SHORTCUT_META: ShortcutMeta[] = [
  { id: 'prev', label: 'Previous track', group: 'transport', description: 'Skip to previous track in queue' },
  { id: 'next', label: 'Next track', group: 'transport', description: 'Skip to next track in queue' },
  { id: 'playPause', label: 'Play / pause', group: 'transport', description: 'Toggle playback of current track' },
  { id: 'like', label: 'Like (add to wishlist)', group: 'curation', description: 'Add the currently playing track to your wishlist' },
];

const STORAGE_KEY = 'unfck.shortcuts.v1';
const CHANGE_EVENT = 'unfck:shortcuts-changed';

export function loadShortcuts(): ShortcutBindings {
  if (typeof window === 'undefined') return DEFAULT_BINDINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BINDINGS;
    const parsed = JSON.parse(raw) as Partial<ShortcutBindings>;
    return { ...DEFAULT_BINDINGS, ...parsed };
  } catch {
    return DEFAULT_BINDINGS;
  }
}

export function saveShortcuts(bindings: ShortcutBindings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function resetShortcuts(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function useShortcuts(): ShortcutBindings {
  const [bindings, setBindings] = useState<ShortcutBindings>(DEFAULT_BINDINGS);
  useEffect(() => {
    setBindings(loadShortcuts());
    function reload() {
      setBindings(loadShortcuts());
    }
    window.addEventListener(CHANGE_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(CHANGE_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, []);
  return bindings;
}

/**
 * Return a human-readable label for a stored key value. " " becomes "Space",
 * "ArrowLeft" stays as-is, single letters are upper-cased.
 */
export function formatKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key === 'Escape') return 'Esc';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * Normalise a KeyboardEvent.key into the storage form used in
 * ShortcutBindings: single printable chars are lower-cased, named keys
 * (Space, ArrowUp, etc.) keep their event-key spelling.
 */
export function normaliseEventKey(key: string): string {
  if (key === ' ' || key === 'Spacebar') return ' ';
  if (key.length === 1) return key.toLowerCase();
  return key;
}

/**
 * Reject keys that would clash with text input or browser navigation.
 */
export function isAcceptableKey(key: string): boolean {
  if (!key) return false;
  if (key === 'Tab' || key === 'Enter' || key === 'Escape') return false;
  if (key === 'Backspace' || key === 'Delete') return false;
  if (key.startsWith('F') && /^F\d{1,2}$/.test(key)) return false;
  return true;
}
