'use client';

import { useEffect, useState } from 'react';

export interface Preferences {
  timeDisplay: 'elapsed' | 'remaining';
  mirrorFollowsToBandcamp: boolean;
  /** Global toggle to hide tracks the user has already heard. Filters at
   * the row-render level in every track list (Library, Discover, Curator,
   * Track-Permalink siblings + Best-of, Artist, Label, Wishlist).
   * Persisted in localStorage so the user only sets it once. */
  hidePlayed: boolean;
  /** When `hidePlayed` is on, should partially-played albums (some but
   * not all tracks heard) also be hidden? Default false: partials stay
   * visible so the user can finish them. */
  hidePartialAlbums: boolean;
  /** When on, detect BPM automatically a few seconds after a track
   * starts playing — but only for tracks that don't have a BPM yet, so
   * skip-through browsing doesn't cost extra fetches. Default on. */
  autoDetectBpm: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  timeDisplay: 'elapsed',
  mirrorFollowsToBandcamp: false,
  hidePlayed: false,
  hidePartialAlbums: false,
  autoDetectBpm: true,
};

const STORAGE_KEY = 'unfck.prefs.v1';
const CHANGE_EVENT = 'unfck:prefs-changed';

export function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: Preferences): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function usePreferences(): [Preferences, (next: Partial<Preferences>) => void] {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  useEffect(() => {
    setPrefs(loadPreferences());
    function reload() {
      setPrefs(loadPreferences());
    }
    window.addEventListener(CHANGE_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(CHANGE_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, []);
  function update(next: Partial<Preferences>) {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    savePreferences(merged);
  }
  return [prefs, update];
}
