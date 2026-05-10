'use client';

import { useState } from 'react';
import {
  applyAppUpdate,
  checkForAppUpdate,
  installSpecificVersion,
  isTauri,
  listAppReleases,
  type ReleaseSummary,
  type UpdateInfo,
} from '@/lib/tauri/client';
import { confirm } from '@/lib/ui/confirmStore';

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'no-update' }
  | { kind: 'update'; info: UpdateInfo }
  | { kind: 'installing' }
  | { kind: 'error'; message: string };

/**
 * Shows the running app version and a manual "check for updates" button
 * inside the Tauri runtime. The UpdaterBanner already polls on cold
 * start and every 24h — this just gives the user an explicit control to
 * trigger a check between those intervals.
 */
export default function AboutPanel({ version }: { version: string }) {
  const tauri = isTauri();
  const [state, setState] = useState<CheckState>({ kind: 'idle' });
  // Rollback picker: hidden behind a "Show version history" toggle so
  // the panel doesn't grow a wall of buttons by default. Useful as a
  // safety net when a fresh release ships broken — Marco wanted to be
  // able to drop back to a known-good build without waiting for the
  // next forward fix.
  const [showHistory, setShowHistory] = useState(false);
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [installingVersion, setInstallingVersion] = useState<string | null>(null);

  async function loadHistory() {
    if (releases.length > 0) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const list = await listAppReleases();
      setReleases(list);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Could not load releases');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function installVersion(v: string) {
    const ok = await confirm({
      title: `Install v${v}?`,
      message: `Your current DB is backed up to unfck.db.before-v${version}.bak first. The app will close while the installer runs.`,
      confirmLabel: `Install v${v}`,
    });
    if (!ok) return;
    setInstallingVersion(v);
    try {
      await installSpecificVersion(v);
      // installSpecificVersion exits the app, so we shouldn't get here.
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Install failed');
      setInstallingVersion(null);
    }
  }

  async function handleCheck() {
    setState({ kind: 'checking' });
    try {
      const info = await checkForAppUpdate();
      setState(info ? { kind: 'update', info } : { kind: 'no-update' });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Check failed',
      });
    }
  }

  async function handleInstall() {
    setState({ kind: 'installing' });
    try {
      await applyAppUpdate();
      // applyAppUpdate triggers a relaunch — execution should not reach here.
      setState({
        kind: 'error',
        message: 'Update did not relaunch the app — try again.',
      });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Install failed',
      });
    }
  }

  return (
    <section className="rounded-lg border border-border bg-bg-surface p-6">
      <h2 className="text-xl font-semibold">About</h2>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-fg-secondary">Version</dt>
        <dd className="font-mono text-fg-primary">v{version}</dd>
        <dt className="text-fg-secondary">Repo</dt>
        <dd>
          <a
            href="https://github.com/MarcoPoppe/unfck-bandcamp"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent hover:underline"
          >
            github.com/MarcoPoppe/unfck-bandcamp
          </a>
        </dd>
      </dl>

      {tauri && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleCheck}
            disabled={state.kind === 'checking' || state.kind === 'installing'}
            className="rounded border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.kind === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          {state.kind === 'update' && (
            <button
              type="button"
              onClick={handleInstall}
              disabled={state.kind !== 'update'}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              Install v{state.info.version} + restart
            </button>
          )}
          {state.kind === 'installing' && (
            <span className="text-sm text-fg-secondary">Installing…</span>
          )}
          {state.kind === 'no-update' && (
            <span className="text-sm text-fg-secondary">
              You&rsquo;re on the latest version.
            </span>
          )}
          {state.kind === 'error' && (
            <span className="text-sm text-fg-danger">{state.message}</span>
          )}
        </div>
      )}
      {!tauri && (
        <p className="mt-3 text-xs text-fg-muted">
          Auto-update is only active inside the Tauri desktop app. For Docker
          / dev installs, pull the new image or run <code>git pull</code>.
        </p>
      )}

      {tauri && (
        <div className="mt-6 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => {
              setShowHistory((s) => !s);
              if (!showHistory) void loadHistory();
            }}
            className="text-sm text-fg-secondary transition-colors hover:text-accent"
          >
            {showHistory ? '▾ Hide version history' : '▸ Show version history'}
          </button>
          {showHistory && (
            <div className="mt-3 text-sm">
              <p className="mb-3 text-xs text-fg-muted">
                Roll back to an older release if a fresh build ships broken.
                Your DB is snapshotted to{' '}
                <span className="font-mono">unfck.db.before-vX.Y.Z.bak</span>{' '}
                before the installer runs, so you can recover by hand if a
                downgrade mishandles a newer schema column.
              </p>
              {historyLoading && (
                <p className="text-xs text-fg-muted">Loading releases…</p>
              )}
              {historyError && (
                <p className="text-xs text-fg-danger">{historyError}</p>
              )}
              {!historyLoading && !historyError && releases.length === 0 && (
                <p className="text-xs text-fg-muted">No releases listed.</p>
              )}
              {releases.length > 0 && (
                <ul className="divide-y divide-border rounded border border-border bg-bg-elevated">
                  {releases.map((r) => (
                    <li
                      key={r.version}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-sm">v{r.version}</span>
                        {r.isCurrent && (
                          <span className="ml-2 rounded bg-accent/20 px-2 py-0.5 text-xs text-accent">
                            current
                          </span>
                        )}
                        {r.publishedAt && (
                          <span className="ml-2 text-xs text-fg-muted">
                            {new Date(r.publishedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => installVersion(r.version)}
                        disabled={
                          r.isCurrent || installingVersion !== null
                        }
                        className="rounded border border-border bg-bg-surface px-3 py-1 text-xs transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {installingVersion === r.version
                          ? 'Installing…'
                          : r.isCurrent
                            ? 'Installed'
                            : 'Install this'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
