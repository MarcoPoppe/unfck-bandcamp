'use client';

import { useEffect, useState } from 'react';

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
    </section>
  );
}
