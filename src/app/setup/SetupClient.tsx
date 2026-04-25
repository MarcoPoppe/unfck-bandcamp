'use client';

import { useEffect, useState } from 'react';

interface SyncRun {
  id: number;
  status: 'running' | 'success' | 'error';
  startedAt: string;
  finishedAt: string | null;
  itemsSynced: number;
  itemsTotalKnown: number | null;
  errorMessage: string | null;
}

interface AuthSummary {
  fanId: number;
  username: string;
  email: string | null;
  updatedAt: string;
}

type InitialState =
  | { configured: false }
  | {
      configured: true;
      auth: AuthSummary;
      ownedCount: number;
      lastSync: SyncRun | null;
    };

export default function SetupClient({ initial }: { initial: InitialState }) {
  const [configured, setConfigured] = useState(initial.configured);
  const [auth, setAuth] = useState<AuthSummary | null>(
    initial.configured ? initial.auth : null,
  );
  const [ownedCount, setOwnedCount] = useState(
    initial.configured ? initial.ownedCount : 0,
  );
  const [lastSync, setLastSync] = useState<SyncRun | null>(
    initial.configured ? initial.lastSync : null,
  );

  const [cookieInput, setCookieInput] = useState('');
  const [validating, setValidating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Try to pre-fill from data/bc_cookies.txt if it exists.
  useEffect(() => {
    if (configured) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/auth/suggest');
        const json = (await res.json()) as { present?: boolean; cookieString?: string };
        if (!cancelled && json.present && json.cookieString) {
          setCookieInput(json.cookieString);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured]);

  async function handleValidate() {
    setValidating(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookieString: cookieInput }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        auth?: { fanId: number; username: string; email: string | null };
        error?: string;
      };
      if (!res.ok || !json.ok || !json.auth) {
        setMessage({ kind: 'error', text: json.error ?? `validate failed (${res.status})` });
      } else {
        setConfigured(true);
        setAuth({ ...json.auth, updatedAt: new Date().toISOString() });
        setOwnedCount(0);
        setLastSync(null);
        setMessage({
          kind: 'ok',
          text: `eingeloggt als ${json.auth.username} (fan_id ${json.auth.fanId})`,
        });
      }
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'unknown error',
      });
    } finally {
      setValidating(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sync/owned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json = (await res.json()) as {
        ok?: boolean;
        itemsSynced?: number;
        totalKnown?: number | null;
        durationMs?: number;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setMessage({ kind: 'error', text: json.error ?? `sync failed (${res.status})` });
      } else {
        const seconds = ((json.durationMs ?? 0) / 1000).toFixed(1);
        setMessage({
          kind: 'ok',
          text: `${json.itemsSynced} items in ${seconds}s synchronisiert${
            json.totalKnown ? ` (Bandcamp meldet ${json.totalKnown} total)` : ''
          }`,
        });
        await refreshStatus();
      }
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'unknown error',
      });
    } finally {
      setSyncing(false);
    }
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/auth/status');
      const json = (await res.json()) as {
        configured?: boolean;
        auth?: AuthSummary;
        ownedCount?: number;
        lastSync?: SyncRun | null;
      };
      if (json.configured && json.auth) {
        setAuth(json.auth);
        setOwnedCount(json.ownedCount ?? 0);
        setLastSync(json.lastSync ?? null);
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-8">
      {!configured && (
        <section className="rounded-lg border border-border bg-bg-surface p-6">
          <h2 className="text-xl font-semibold">Schritt 1: Cookies validieren</h2>
          <p className="mt-2 text-sm text-fg-secondary">
            Cookies aus DevTools → Network → Request Headers → <code>Cookie:</code>. Den kompletten
            String hier rein.
          </p>
          <textarea
            value={cookieInput}
            onChange={(e) => setCookieInput(e.target.value)}
            rows={6}
            className="mt-4 w-full rounded border border-border bg-bg-base p-3 font-mono text-xs text-fg-primary focus:border-accent focus:outline-none"
            placeholder="identity=...; client_id=...; session=...; ..."
          />
          <button
            type="button"
            onClick={handleValidate}
            disabled={validating || !cookieInput.trim()}
            className="mt-4 rounded bg-accent px-4 py-2 font-medium text-fg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {validating ? 'pruefe...' : 'Cookies validieren'}
          </button>
        </section>
      )}

      {configured && auth && (
        <section className="rounded-lg border border-border bg-bg-surface p-6">
          <h2 className="text-xl font-semibold">Eingeloggt</h2>
          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-fg-muted">Username</dt>
            <dd className="font-mono">{auth.username}</dd>
            <dt className="text-fg-muted">Fan-ID</dt>
            <dd className="font-mono">{auth.fanId}</dd>
            {auth.email && (
              <>
                <dt className="text-fg-muted">Email</dt>
                <dd className="font-mono">{auth.email}</dd>
              </>
            )}
            <dt className="text-fg-muted">Cookies aktualisiert</dt>
            <dd className="font-mono text-xs">{auth.updatedAt}</dd>
          </dl>
        </section>
      )}

      {configured && (
        <section className="rounded-lg border border-border bg-bg-surface p-6">
          <h2 className="text-xl font-semibold">Schritt 2: Owned-Sync</h2>
          <p className="mt-2 text-sm text-fg-secondary">
            Holt deine komplette Bandcamp-Collection und schreibt sie in die lokale DB.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-fg-muted">Items in DB</div>
              <div className="text-2xl font-semibold">{ownedCount}</div>
            </div>
            <div>
              <div className="text-fg-muted">Letzter Sync</div>
              <div className="font-mono text-xs">
                {lastSync ? (
                  <>
                    {lastSync.status} {lastSync.startedAt}
                    {lastSync.itemsSynced > 0 && ` (${lastSync.itemsSynced} items)`}
                  </>
                ) : (
                  '—'
                )}
              </div>
            </div>
          </div>
          {lastSync?.errorMessage && (
            <div className="mt-3 rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">
              {lastSync.errorMessage}
            </div>
          )}
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="mt-4 rounded bg-accent px-4 py-2 font-medium text-fg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? 'synchronisiere...' : 'Sync starten'}
          </button>
        </section>
      )}

      {message && (
        <div
          className={`rounded border p-4 text-sm ${
            message.kind === 'ok'
              ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
              : 'border-red-900 bg-red-950/40 text-red-200'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
