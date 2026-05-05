/**
 * Thin client-side wrapper around Tauri's invoke API.
 *
 * The web build (browser, dev server, Docker) and the Tauri build run
 * the SAME bundle — Tauri ships an injected `window.__TAURI_INTERNALS__`
 * object only inside its embedded WebView. We feature-detect that object
 * to decide whether desktop-only paths (embedded login, native updater
 * banner, "open data folder" button) are available.
 *
 * Keep this file SSR-safe: every export must guard against `window`
 * being undefined so it doesn't break server-rendering.
 */

type TauriCore = {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
};

interface TauriInternals {
  invoke: TauriCore['invoke'];
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`Tauri command "${cmd}" called outside Tauri runtime`);
  }
  return window.__TAURI_INTERNALS__!.invoke<T>(cmd, args);
}

export interface SignInResult {
  cookieString: string;
  fanId: number | null;
  username: string | null;
  role: 'crawler' | 'main';
}

/**
 * Asks the Tauri backend to spawn an embedded Bandcamp login WebView.
 * The Rust side polls the WebView until the user lands on a post-login
 * URL, then extracts session cookies and returns them. The setup wizard
 * forwards the cookieString to the existing /api/auth/validate endpoint
 * so no new server-side path is required.
 *
 * Phase 2 status: the Rust command is currently a stub that returns an
 * Err describing the missing implementation. The wizard surfaces that
 * error and falls back to the cookie-paste flow. See
 * `docs/specs/2026-05-03-tauri-distribution.md` for the embedded-login
 * design and `src-tauri/src/lib.rs::commands::open_bandcamp_login`.
 */
export async function signInWithBandcamp(
  role: 'crawler' | 'main',
): Promise<SignInResult> {
  return invoke<SignInResult>('open_bandcamp_login', { role });
}

/** Triggers the updater plugin to check for a new release. Returns null
 * when no update is available. */
export interface UpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}
export async function checkForAppUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;
  try {
    const mod = await import(
      '@tauri-apps/plugin-updater'
    );
    const update = await mod.check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? null,
      date: update.date ?? null,
    };
  } catch (err) {
    console.warn('updater check failed', err);
    return null;
  }
}

/** Downloads + installs the pending update + restarts the app. */
export async function applyAppUpdate(): Promise<void> {
  if (!isTauri()) return;
  const updMod = await import(
    '@tauri-apps/plugin-updater'
  );
  const procMod = await import(
    '@tauri-apps/plugin-process'
  );
  const update = await updMod.check();
  if (!update) return;
  await update.downloadAndInstall();
  await procMod.relaunch();
}
