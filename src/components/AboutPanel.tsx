'use client';

import { useState } from 'react';
import {
  applyAppUpdate,
  checkForAppUpdate,
  isTauri,
  type UpdateInfo,
} from '@/lib/tauri/client';

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
    </section>
  );
}
