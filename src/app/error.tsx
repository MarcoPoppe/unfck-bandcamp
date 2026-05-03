'use client';

import { useEffect, useState } from 'react';

/**
 * Per-segment error boundary. Replaces the white-screen-on-React-throw
 * default with a friendly explanation, the digest of the error (so we
 * can correlate to log lines server-side), and a copy-diagnostics button
 * so a non-technical user can hand us a useful bug report.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[error-boundary]', error);
  }, [error]);

  async function copyDiagnostics() {
    setBusy(true);
    try {
      const res = await fetch('/api/diagnostics');
      const text = await res.text();
      const payload = JSON.stringify(
        {
          clientError: {
            message: error.message,
            digest: error.digest ?? null,
            stack: error.stack ?? null,
          },
          diagnostics: JSON.parse(text),
        },
        null,
        2,
      );
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // ignore — the user will fall back to refreshing
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-start justify-center gap-4 px-6 py-12">
      <div className="rounded-lg border border-border-danger bg-bg-danger p-6 text-fg-danger">
        <h1 className="text-2xl font-semibold">Ups.</h1>
        <p className="mt-2 text-sm">
          Da hat die App einen Schluckauf. Reload probieren — wenn&rsquo;s
          öfter passiert, &bdquo;Copy diagnostics&ldquo; klicken und mir den
          JSON-Brocken schicken.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs">error code: {error.digest}</p>
        )}
        <details className="mt-3 text-xs opacity-80">
          <summary className="cursor-pointer">Technical details</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
        </details>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={copyDiagnostics}
          disabled={busy}
          className="rounded border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover disabled:opacity-50"
        >
          {busy ? 'Copying…' : copied ? 'Copied ✓' : 'Copy diagnostics'}
        </button>
      </div>
    </main>
  );
}
