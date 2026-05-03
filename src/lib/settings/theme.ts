'use client';

/**
 * Theme mode, stored separately from the rest of preferences so the inline
 * boot script in <head> can read it without parsing the full preferences JSON.
 *
 * 'system' tracks the OS-level prefers-color-scheme. 'light' / 'dark' force
 * the app to that palette regardless of OS.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'unfck.theme.v1';
export const THEME_CHANGE_EVENT = 'unfck:theme-changed';

export function loadThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
    return 'system';
  } catch {
    return 'system';
  }
}

export function saveThemeMode(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
}

/** Resolve a stored mode against the OS preference into the concrete palette
 * to apply. Used both by the inline boot script (inlined as a string in
 * layout.tsx) and by the React hook below. Keep this pure so both paths
 * agree. */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

/**
 * Apply the resolved palette to <html>. We toggle a single `.light` class:
 * its absence means the dark default from globals.css is in effect. We also
 * keep the `.dark` class in sync so any leftover Tailwind `dark:` utilities
 * still resolve correctly.
 */
export function applyTheme(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolved === 'light') {
    root.classList.add('light');
    root.classList.remove('dark');
  } else {
    root.classList.add('dark');
    root.classList.remove('light');
  }
}

/**
 * Boot script injected verbatim into a <script> tag in <head>.
 * Runs synchronously before paint so the correct palette is on <html>
 * before any styled element renders. Kept tiny (no imports, no helpers).
 * Content is a hard-coded literal — no untrusted input ever reaches this.
 */
export const THEME_BOOT_SCRIPT = `(() => {
  try {
    var m = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (m !== 'light' && m !== 'dark' && m !== 'system') m = 'system';
    var resolved = m;
    if (m === 'system') {
      resolved = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    var c = document.documentElement.classList;
    if (resolved === 'light') { c.add('light'); c.remove('dark'); }
    else { c.add('dark'); c.remove('light'); }
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();`;
