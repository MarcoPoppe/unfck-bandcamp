'use client';

import { usePreferences } from '@/lib/settings/preferences';
import Tooltip from './Tooltip';

/**
 * Inline toggle button for the "hide already-played tracks" preference.
 * Drop it next to the heading of any track list and the lists pick up the
 * filter via `usePreferences().hidePlayed`. Toggle state is persisted in
 * localStorage so it sticks across sessions and across all list pages.
 */
export default function HidePlayedToggle({ count }: { count?: number }) {
  const [prefs, setPrefs] = usePreferences();
  const active = prefs.hidePlayed;
  return (
    <Tooltip text={active ? 'Show all tracks' : 'Hide tracks you have already heard'} position="bottom">
    <button
      type="button"
      onClick={() => setPrefs({ hidePlayed: !active })}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active
          ? 'border-accent/60 bg-accent/15 text-accent'
          : 'border-border bg-bg-elevated text-fg-secondary hover:bg-bg-hover hover:text-fg-primary'
      }`}
    >
      {active ? (
        // closed-eye icon
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m2 2 20 20M6.71 6.71C3.4 8.27 1 12 1 12s4 7 11 7c2.27 0 4.32-.67 6.06-1.66M9.9 4.24A11 11 0 0 1 12 4c7 0 11 7 11 7a16 16 0 0 1-3.06 3.94M14.12 14.12A3 3 0 1 1 9.88 9.88" />
        </svg>
      ) : (
        // open-eye icon
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
      {active ? 'Hidden' : 'Hide played'}
      {count != null && count > 0 && active && (
        <span className="rounded-full bg-bg-base/40 px-1.5 text-[10px]">{count}</span>
      )}
    </button>
    </Tooltip>
  );
}
