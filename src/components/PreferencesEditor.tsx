'use client';

import { useEffect, useState } from 'react';
import { usePreferences } from '@/lib/settings/preferences';
import {
  applyTheme,
  loadThemeMode,
  resolveTheme,
  saveThemeMode,
  THEME_CHANGE_EVENT,
  type ThemeMode,
} from '@/lib/settings/theme';

const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'White paper background, dark text' },
  { value: 'dark', label: 'Dark', hint: 'Beatport-style near-black surfaces' },
  { value: 'system', label: 'System', hint: 'Follow the OS setting' },
];

export default function PreferencesEditor() {
  const [prefs, update] = usePreferences();
  const [theme, setTheme] = useState<ThemeMode>('system');

  useEffect(() => {
    setTheme(loadThemeMode());
    const reload = () => setTheme(loadThemeMode());
    window.addEventListener(THEME_CHANGE_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, []);

  function pickTheme(next: ThemeMode) {
    setTheme(next);
    saveThemeMode(next);
    applyTheme(resolveTheme(next));
  }

  return (
    <section className="rounded-lg border border-border bg-bg-surface p-6">
      <h2 className="text-xl font-semibold">Player preferences</h2>
      <p className="mt-1 text-sm text-fg-secondary">
        Tweak how the player displays time and which palette the app uses.
        Stored locally per browser.
      </p>

      <div className="mt-5 space-y-3">
        <div className="rounded border border-border bg-bg-base p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Appearance</div>
              <div className="text-xs text-fg-muted">
                Switch between dark, light, and OS-controlled palettes. Applies
                instantly.
              </div>
            </div>
            <div className="flex flex-none items-center gap-1 rounded-lg border border-border bg-bg-elevated p-0.5">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => pickTheme(opt.value)}
                  title={opt.hint}
                  aria-pressed={theme === opt.value}
                  className={`rounded px-3 py-1 text-xs transition-colors ${
                    theme === opt.value
                      ? 'bg-accent text-fg-on-accent'
                      : 'text-fg-secondary hover:bg-bg-hover hover:text-fg-primary'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 rounded border border-border bg-bg-base p-3">
          <div>
            <div className="text-sm font-medium">Time display</div>
            <div className="text-xs text-fg-muted">
              Whether the right-hand time shows the track length or the remaining time.
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-elevated p-0.5">
            <button
              type="button"
              onClick={() => update({ timeDisplay: 'elapsed' })}
              className={`rounded px-3 py-1 text-xs transition-colors ${
                prefs.timeDisplay === 'elapsed'
                  ? 'bg-accent text-fg-on-accent'
                  : 'text-fg-secondary hover:bg-bg-hover hover:text-fg-primary'
              }`}
            >
              Total length
            </button>
            <button
              type="button"
              onClick={() => update({ timeDisplay: 'remaining' })}
              className={`rounded px-3 py-1 text-xs transition-colors ${
                prefs.timeDisplay === 'remaining'
                  ? 'bg-accent text-fg-on-accent'
                  : 'text-fg-secondary hover:bg-bg-hover hover:text-fg-primary'
              }`}
            >
              Remaining
            </button>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 rounded border border-border bg-bg-base p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Mirror follow actions to Bandcamp</div>
            <div className="text-xs text-fg-muted">
              When you follow or unfollow an artist or curator here, also do it on
              bandcamp.com using your stored cookies. Best-effort: if Bandcamp&apos;s
              endpoint changes, the local action still succeeds and a warning surfaces.
            </div>
          </div>
          <button
            type="button"
            onClick={() => update({ mirrorFollowsToBandcamp: !prefs.mirrorFollowsToBandcamp })}
            aria-pressed={prefs.mirrorFollowsToBandcamp}
            className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              prefs.mirrorFollowsToBandcamp ? 'bg-accent' : 'bg-bg-elevated'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-fg-on-accent transition-transform ${
                prefs.mirrorFollowsToBandcamp ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="flex items-start justify-between gap-3 rounded border border-border bg-bg-base p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Auto-detect BPM</div>
            <div className="text-xs text-fg-muted">
              Detects tempo automatically a few seconds after a track starts.
              Only when the BPM isn&apos;t known yet, so once per track.
              Skipping fast cancels in-flight detections.
            </div>
          </div>
          <button
            type="button"
            onClick={() => update({ autoDetectBpm: !prefs.autoDetectBpm })}
            aria-pressed={prefs.autoDetectBpm}
            className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              prefs.autoDetectBpm ? 'bg-accent' : 'bg-bg-elevated'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-fg-on-accent transition-transform ${
                prefs.autoDetectBpm ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="flex items-start justify-between gap-3 rounded border border-border bg-bg-base p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">
              Hide partially-played albums when &ldquo;Hide played&rdquo; is on
            </div>
            <div className="text-xs text-fg-muted">
              Default off: an album where you&apos;ve heard 1-of-4 tracks stays visible
              with a half-circle indicator so you can finish it. Turn on if you want
              hide-played to be aggressive — only fully-untouched albums remain.
            </div>
          </div>
          <button
            type="button"
            onClick={() => update({ hidePartialAlbums: !prefs.hidePartialAlbums })}
            aria-pressed={prefs.hidePartialAlbums}
            className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              prefs.hidePartialAlbums ? 'bg-accent' : 'bg-bg-elevated'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-fg-on-accent transition-transform ${
                prefs.hidePartialAlbums ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>
    </section>
  );
}
