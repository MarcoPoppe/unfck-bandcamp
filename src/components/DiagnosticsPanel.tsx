'use client';

import { useEffect, useState } from 'react';
import { diagnoseUpdaterFromRust, isTauri, tauriLog } from '@/lib/tauri/client';

interface SchemaIssue {
  table: string;
  column: string;
  reason: string;
}

interface DiagnosticsPayload {
  generatedAt: string;
  app: { version: string };
  schema: { drift: SchemaIssue[] };
}

/**
 * Compact diagnostics panel for the setup page. Shows app version + a
 * "Copy diagnostics" button that puts a JSON snapshot of /api/diagnostics
 * into the clipboard. If the schema-drift check turned anything up, it's
 * shown as a red banner so the user notices before clicking copy.
 *
 * The full payload is intentionally not rendered inline — it would be
 * walls of JSON nobody reads. Copying into a chat / mail is the actual
 * use case.
 */
export default function DiagnosticsPanel() {
  const [version, setVersion] = useState<string | null>(null);
  const [drift, setDrift] = useState<SchemaIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tauri, setTauri] = useState(false);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagDone, setDiagDone] = useState(false);

  useEffect(() => {
    setTauri(isTauri());
  }, []);

  // Run the desktop-side ACL + cookie diagnostics. Everything is piped
  // into the Tauri log file (%LOCALAPPDATA%/com.unfck.bandcamp/logs)
  // so the developer can read it from disk afterwards without asking
  // the user to copy DevTools output.
  async function runDesktopDiagnostics() {
    setDiagBusy(true);
    setDiagDone(false);
    try {
      await tauriLog('info', '=== diagnostics run start ===');

      // 1) Direct Rust-side updater check, bypassing the frontend ACL.
      try {
        const result = await diagnoseUpdaterFromRust();
        await tauriLog('info', `rust-side updater.check: ${result}`);
      } catch (e) {
        await tauriLog('error', `rust-side updater.check threw: ${String(e)}`);
      }

      // 2) Frontend invoke of the same plugin command — this is the path
      //    that's been failing with "not allowed by ACL".
      try {
        // Direct internals call, since the @tauri-apps/plugin-updater
        // import has its own caching layer that may swallow context.
        const w = window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke: (
              cmd: string,
              args?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        };
        const internals = w.__TAURI_INTERNALS__;
        if (!internals) {
          await tauriLog('error', 'frontend: __TAURI_INTERNALS__ missing');
        } else {
          try {
            const r = await internals.invoke('plugin:updater|check');
            await tauriLog(
              'info',
              `frontend invoke plugin:updater|check ok: ${JSON.stringify(r).slice(0, 300)}`,
            );
          } catch (e) {
            await tauriLog(
              'error',
              `frontend invoke plugin:updater|check failed: ${String(e)}`,
            );
          }
        }
      } catch (e) {
        await tauriLog('error', `frontend updater probe threw: ${String(e)}`);
      }

      await tauriLog('info', '=== diagnostics run end ===');
      setDiagDone(true);
      setTimeout(() => setDiagDone(false), 5000);
    } finally {
      setDiagBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/diagnostics')
      .then((r) => r.json() as Promise<DiagnosticsPayload>)
      .then((j) => {
        if (cancelled) return;
        setVersion(j.app?.version ?? null);
        setDrift(j.schema?.drift ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyDiagnostics() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch('/api/diagnostics');
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Diagnostics</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            App version: <span className="font-mono">{version ?? '…'}</span>.
            If something is broken, click the button below and paste the
            JSON into the bug report.
          </p>
        </div>
        <button
          type="button"
          onClick={copyDiagnostics}
          disabled={busy}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? 'Copying…' : copied ? 'Copied ✓' : 'Copy diagnostics'}
        </button>
      </div>

      {drift.length > 0 && (
        <div className="mt-4 rounded border border-border-danger bg-bg-danger p-3 text-sm text-fg-danger">
          <strong>Schema drift detected.</strong> The running code expects
          {' '}
          {drift.length} column{drift.length === 1 ? '' : 's'} that the local
          database does not have. This usually means a migration did not run.
          Restart the app; if the error persists, share diagnostics with the
          maintainer.
          <ul className="mt-2 list-inside list-disc font-mono text-xs">
            {drift.slice(0, 8).map((d, i) => (
              <li key={i}>
                {d.table}.{d.column} ({d.reason})
              </li>
            ))}
            {drift.length > 8 && <li>…and {drift.length - 8} more</li>}
          </ul>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded border border-border-danger bg-bg-danger p-3 text-xs text-fg-danger">
          {error}
        </div>
      )}

      {tauri && (
        <div className="mt-4 rounded border border-border bg-bg-elevated p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Desktop diagnostics</strong> — runs the ACL + updater
              probes and writes everything into the Tauri log file.
            </span>
            <button
              type="button"
              onClick={runDesktopDiagnostics}
              disabled={diagBusy}
              className="rounded border border-border bg-bg-surface px-3 py-1 text-xs transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              {diagBusy ? 'Running…' : diagDone ? 'Logged ✓' : 'Run desktop diagnostics'}
            </button>
          </div>
          <p className="mt-2 text-xs text-fg-secondary">
            After running, the log file is at
            {' '}
            <span className="font-mono">
              %LOCALAPPDATA%\com.unfck.bandcamp\logs\Unfck Bandcamp.log
            </span>
            .
          </p>
        </div>
      )}
    </section>
  );
}
