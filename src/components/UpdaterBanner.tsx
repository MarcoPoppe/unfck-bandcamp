'use client';

import { useEffect, useState } from 'react';
import {
  applyAppUpdate,
  checkForAppUpdate,
  isTauri,
  type UpdateInfo,
} from '@/lib/tauri/client';

/**
 * Small top-of-app banner that appears only inside the Tauri desktop
 * wrapper when a new release is available on GitHub. The Tauri updater
 * plugin checks `latest.json` on the configured GitHub release endpoint
 * once at startup and again every 24 h. Click "Install + restart" to
 * apply.
 *
 * Renders nothing in the web build, in dev, or while no update exists,
 * so it can be mounted globally in the app shell without side effects.
 */
export default function UpdaterBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function probe() {
      try {
        const info = await checkForAppUpdate();
        if (!cancelled) setUpdate(info);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Update check failed');
        }
      }
    }

    void probe();
    // Re-probe every 24h while the app stays open. Tauri's startup
    // probe handles the cold-launch case; this catches long-running
    // sessions.
    timer = setInterval(() => void probe(), 24 * 60 * 60 * 1000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  if (!update || dismissed) return null;

  async function install() {
    setBusy(true);
    setError(null);
    try {
      await applyAppUpdate();
      // applyAppUpdate triggers a relaunch — control should not return
      // here on success. If it does the update silently failed.
      setBusy(false);
      setError('Update did not relaunch the app — try again.');
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Install failed');
    }
  }

  return (
    <div className="sticky top-0 z-40 border-b border-accent/40 bg-accent/10 px-4 py-2">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold text-accent">
          Update available — v{update.version}
        </span>
        {update.notes && (
          <span className="truncate text-fg-secondary" title={update.notes}>
            {update.notes}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={install}
            disabled={busy}
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? 'Installing…' : 'Install + restart'}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded border border-border bg-bg-elevated px-3 py-1 text-xs text-fg-secondary transition-colors hover:bg-bg-hover"
          >
            Later
          </button>
        </div>
        {error && (
          <span className="basis-full text-xs text-fg-danger">{error}</span>
        )}
      </div>
    </div>
  );
}
