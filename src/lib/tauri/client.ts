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

/** Whether X minimizes to tray. Read from a flag file under
 * app_data_dir, written by setMinimizeToTray. The Rust close-event
 * handler reads the same flag synchronously. */
export async function getMinimizeToTray(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('get_minimize_to_tray');
  } catch {
    return false;
  }
}

export async function setMinimizeToTray(value: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('set_minimize_to_tray', { value });
}

/** Triggers the updater plugin to check for a new release. Returns null
 * when no update is available.
 *
 * v2.4.20 routes this through our own `check_for_updates` Tauri command
 * instead of the plugin's bundled `plugin:updater|check` JS API. The
 * plugin path keeps getting rejected by the ACL layer with "Command
 * plugin:updater|check not allowed by ACL" even though the capability
 * permissions are all in place — v2.4.18's diagnose_updater proved the
 * plugin itself is healthy from Rust, only the frontend IPC path is
 * broken. Our custom command runs the same `app.updater().check()` call
 * the plugin would, but doesn't go through the broken ACL hop. */
export interface UpdateInfo {
  version: string;
  currentVersion?: string;
  notes: string | null;
  date: string | null;
}

export async function checkForAppUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;
  try {
    const result = await invoke<UpdateInfo | null>('check_for_updates');
    return result ?? null;
  } catch (err) {
    console.warn('updater check failed', err);
    return null;
  }
}

/** Pipe a string into the Tauri log so we can read it from
 * %LOCALAPPDATA%/com.unfck.bandcamp/logs without asking the user to
 * paste DevTools output. SSR-safe + no-op outside Tauri. */
export async function tauriLog(
  level: 'info' | 'warn' | 'error',
  message: string,
): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke<void>('log_from_frontend', { level, message });
  } catch {
    // best effort
  }
}

/** Diagnostic: ask Rust to call the updater plugin directly. If this
 * succeeds but the frontend `invoke('plugin:updater|check')` fails with
 * an ACL error, we know the plugin is fine and the bug is in the
 * capability layer. */
export async function diagnoseUpdaterFromRust(): Promise<string> {
  return invoke<string>('diagnose_updater');
}

export interface ReleaseSummary {
  version: string;
  publishedAt: string | null;
  isCurrent: boolean;
}

/** Returns the most recent published GitHub releases of the public
 * repo. Used by the About-panel rollback picker so the user can
 * see what versions are out there and pick a target. */
export async function listAppReleases(): Promise<ReleaseSummary[]> {
  if (!isTauri()) return [];
  return invoke<ReleaseSummary[]>('list_releases');
}

/** Downloads the NSIS installer of a specific version and spawns
 * it. Killed sidecar + DB snapshot happen on the Rust side; the
 * Tauri app exits cleanly so the installer can take over the file
 * lock without the user having to click "Ignore" in NSIS. */
export async function installSpecificVersion(version: string): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('install_specific_version', { version });
}

/** Downloads + installs the pending update + restarts the app.
 *
 * Like checkForAppUpdate, this uses our own `apply_update` command
 * instead of the plugin's JS API, so it doesn't hit the broken ACL
 * path. The Rust side does the download, install, and restart in one
 * go — control should not return on success since restart() exits the
 * current process. */
export async function applyAppUpdate(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('apply_update');
}
