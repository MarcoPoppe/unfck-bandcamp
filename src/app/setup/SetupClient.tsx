'use client';

import { useEffect, useState } from 'react';
import { isTauri, signInWithBandcamp } from '@/lib/tauri/client';
import AboutPanel from '@/components/AboutPanel';
import { MINIMIZE_TO_TRAY_KEY } from '@/components/AppShell';
import ShortcutsEditor from '@/components/ShortcutsEditor';
import PreferencesEditor from '@/components/PreferencesEditor';
import DatabaseInspector from '@/components/DatabaseInspector';
import DiagnosticsPanel from '@/components/DiagnosticsPanel';
import { formatDateTime } from '@/lib/util/datetime';

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

interface InitialState {
  crawler: AuthSummary | null;
  main: AuthSummary | null;
  crawlTargetUsername: string | null;
  ownedCount: number;
  lastSync: SyncRun | null;
  appVersion: string;
}

type Role = 'crawler' | 'main';

export default function SetupClient({ initial }: { initial: InitialState }) {
  const [crawler, setCrawler] = useState<AuthSummary | null>(initial.crawler);
  const [main, setMain] = useState<AuthSummary | null>(initial.main);
  // Crawl target is derived now: main.username || crawler.username — but we
  // still display it so the user knows which profile is being indexed.
  const crawlTarget = initial.crawlTargetUsername ?? '';
  const [ownedCount, setOwnedCount] = useState(initial.ownedCount);
  const [lastSync, setLastSync] = useState<SyncRun | null>(initial.lastSync);
  const [resolvedTarget, setResolvedTarget] = useState<string | null>(
    initial.crawlTargetUsername,
  );

  const [crawlerCookieInput, setCrawlerCookieInput] = useState('');
  const [mainCookieInput, setMainCookieInput] = useState('');
  const [validating, setValidating] = useState<Role | null>(null);
  const [loggingOut, setLoggingOut] = useState<Role | null>(null);
  const [syncing, setSyncing] = useState<'library' | 'follows' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // True when running inside the Tauri desktop wrapper. Embedded login
  // and "Open data folder" buttons only render then. SSR-safe — set in
  // useEffect, defaults false during server render.
  const [tauriRuntime, setTauriRuntime] = useState(false);
  useEffect(() => {
    setTauriRuntime(isTauri());
  }, []);

  // Wizard mode is shown only on a fresh install (no auth of any kind yet).
  // It walks the user through the two setup steps; the user clicks "I'm
  // done" or completes step 2 and we drop into the normal layout.
  const [wizardDone, setWizardDone] = useState(
    initial.crawler != null || initial.main != null,
  );
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);

  // One-shot suggest from data/bc_cookies.txt for the crawler slot — only
  // when neither account is configured yet, to avoid surprising users who
  // already have a working setup.
  useEffect(() => {
    if (crawler || main) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/auth/suggest');
        const json = (await res.json()) as { present?: boolean; cookieString?: string };
        if (!cancelled && json.present && json.cookieString) {
          setCrawlerCookieInput(json.cookieString);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [crawler, main]);

  /**
   * Tauri-only path. Spawns an embedded WebView at bandcamp.com/login,
   * waits for the user to log in, extracts the resulting session cookies,
   * then forwards them to the same /api/auth/validate endpoint as the
   * paste flow. Falls back gracefully to the textarea if the Tauri
   * command fails or returns an empty cookieString — so a half-broken
   * embedded login can't lock the user out of setup.
   */
  async function handleEmbeddedSignIn(role: Role) {
    setValidating(role);
    setMessage(null);
    try {
      const result = await signInWithBandcamp(role);
      if (!result.cookieString) {
        setMessage({
          kind: 'error',
          text: 'Embedded login returned no cookies — paste them manually below.',
        });
        return;
      }
      if (role === 'crawler') setCrawlerCookieInput(result.cookieString);
      else setMainCookieInput(result.cookieString);
      // Re-use the same validation path so the server-side handler stays
      // single-source-of-truth.
      await runValidate(role, result.cookieString);
    } catch (err) {
      setMessage({
        kind: 'error',
        text:
          err instanceof Error
            ? `Embedded sign-in failed: ${err.message}`
            : 'Embedded sign-in failed.',
      });
    } finally {
      setValidating(null);
    }
  }

  async function handleValidate(role: Role) {
    const cookieString = (role === 'crawler' ? crawlerCookieInput : mainCookieInput).trim();
    if (!cookieString) return;
    setValidating(role);
    setMessage(null);
    await runValidate(role, cookieString);
    setValidating(null);
  }

  async function runValidate(role: Role, cookieString: string) {
    try {
      const res = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookieString, role }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        auth?: AuthSummary;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.auth) {
        setMessage({ kind: 'error', text: json.error ?? `Validation failed (${res.status})` });
        return;
      }
      const summary: AuthSummary = { ...json.auth, updatedAt: new Date().toISOString() };
      if (role === 'crawler') {
        setCrawler(summary);
        setCrawlerCookieInput('');
        if (!wizardDone) setWizardStep(2);
      } else {
        setMain(summary);
        setMainCookieInput('');
        if (!wizardDone) setWizardDone(true);
      }
      setMessage({
        kind: 'ok',
        text:
          role === 'crawler'
            ? `Crawler signed in as ${summary.username} — all reads use this account.`
            : `Main account linked: ${summary.username}. Used only for follow mirroring.`,
      });
      await refreshStatus();
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  async function handleLogout(role: Role) {
    const label = role === 'crawler' ? 'crawler' : 'main account';
    if (
      !confirm(
        `Sign out of the ${label}? This deletes the stored cookies for this slot.`,
      )
    ) {
      return;
    }
    setLoggingOut(role);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage({ kind: 'error', text: json.error ?? `Logout failed (${res.status})` });
        return;
      }
      if (role === 'crawler') setCrawler(null);
      else setMain(null);
      setMessage({ kind: 'ok', text: `Signed out (${label}).` });
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Logout failed',
      });
    } finally {
      setLoggingOut(null);
    }
  }

  async function handleSyncLibrary() {
    setSyncing('library');
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
        tracksWritten?: number;
        itemsExpanded?: number;
        trackImportError?: string | null;
        trackImportErrors?: { bcUrl: string; error: string }[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setMessage({ kind: 'error', text: json.error ?? `Sync failed (${res.status})` });
        return;
      }
      const seconds = ((json.durationMs ?? 0) / 1000).toFixed(1);
      const trackPart = json.tracksWritten
        ? `, ${json.tracksWritten} tracks imported`
        : '';
      const errs =
        json.trackImportErrors && json.trackImportErrors.length > 0
          ? ` — ${json.trackImportErrors.length} item(s) failed: ${json.trackImportErrors
              .map((e) => `${e.bcUrl} (${e.error})`)
              .join('; ')}`
          : '';
      setMessage({
        kind: errs || json.trackImportError ? 'error' : 'ok',
        text:
          `Synced ${json.itemsSynced ?? 0} items in ${seconds}s${trackPart}` +
          (json.totalKnown ? ` (Bandcamp reports ${json.totalKnown} total)` : '') +
          (json.trackImportError ? ` — track import warning: ${json.trackImportError}` : '') +
          errs,
      });
      await refreshStatus();
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'unknown error',
      });
    } finally {
      setSyncing(null);
    }
  }

  async function handleSyncFollows() {
    setSyncing('follows');
    setMessage(null);
    try {
      const res = await fetch('/api/sync/follows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json = (await res.json()) as {
        ok?: boolean;
        fetched?: number;
        artistsAdded?: number;
        artistsAlreadyFollowed?: number;
        labelsAdded?: number;
        labelsAlreadyFollowed?: number;
        durationMs?: number;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setMessage({ kind: 'error', text: json.error ?? `Follow import failed (${res.status})` });
        return;
      }
      const seconds = ((json.durationMs ?? 0) / 1000).toFixed(1);
      const skipped =
        (json.artistsAlreadyFollowed ?? 0) + (json.labelsAlreadyFollowed ?? 0);
      setMessage({
        kind: 'ok',
        text:
          `Imported ${json.fetched ?? 0} bands in ${seconds}s — ` +
          `${json.artistsAdded ?? 0} new artists, ${json.labelsAdded ?? 0} new labels` +
          (skipped > 0 ? ` (skipped ${skipped} already followed)` : ''),
      });
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Follow import failed',
      });
    } finally {
      setSyncing(null);
    }
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/auth/status');
      const json = (await res.json()) as {
        configured?: boolean;
        crawler?: AuthSummary | null;
        main?: AuthSummary | null;
        crawlTargetUsername?: string | null;
        ownedCount?: number;
        lastSync?: SyncRun | null;
      };
      setCrawler(json.crawler ?? null);
      setMain(json.main ?? null);
      setResolvedTarget(json.crawlTargetUsername ?? null);
      setOwnedCount(json.ownedCount ?? 0);
      setLastSync(json.lastSync ?? null);
    } catch {
      // ignore
    }
  }

  const noAccountAtAll = !crawler && !main;
  const hasOnlyMainLegacy = !crawler && main;
  const showWizard = !wizardDone && noAccountAtAll;

  if (showWizard) {
    return (
      <div className="space-y-6">
        <WizardProgress step={wizardStep} />

        {wizardStep === 1 && (
          <section className="rounded-lg border border-border bg-bg-surface p-6">
            <h2 className="text-xl font-semibold">Step 1: Burner Bandcamp account</h2>
            <p className="mt-2 text-sm text-fg-secondary">
              The app needs a Bandcamp login to read your collection,
              follows, and supporters lists. We use a <strong>burner
              account</strong> — a throwaway you create just for this
              tool — so all the fetching happens through that account, not
              your real one. If Bandcamp ever flags it, you make a new burner
              and nothing of yours is at risk.
            </p>
            <details className="mt-3 text-xs text-fg-muted">
              <summary className="cursor-pointer hover:text-fg-secondary">
                How to create the burner and grab its cookies
              </summary>
              <ol className="mt-2 ml-4 list-decimal space-y-1">
                <li>
                  Go to{' '}
                  <a className="text-accent underline" href="https://bandcamp.com/signup" target="_blank" rel="noreferrer">
                    bandcamp.com/signup
                  </a>{' '}
                  and create an account. Any email works, even a{' '}
                  <code>+unfck</code> tag on your usual address.
                </li>
                <li>Stay logged in on that account in the same browser.</li>
                <li>
                  Open DevTools (F12) &rarr; Network tab &rarr; click any
                  request to bandcamp.com &rarr; Request Headers &rarr; copy
                  the full <code>Cookie:</code> string.
                </li>
                <li>Paste it below and click Validate.</li>
              </ol>
            </details>
            {tauriRuntime && (
              <div className="mt-3 rounded border border-accent/40 bg-accent/5 p-3">
                <p className="text-sm text-fg-secondary">
                  <strong>Easy mode:</strong> sign in with Bandcamp directly
                  in this app — no DevTools needed.
                </p>
                <button
                  type="button"
                  onClick={() => handleEmbeddedSignIn('crawler')}
                  disabled={validating === 'crawler'}
                  className="mt-2 rounded bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {validating === 'crawler' ? 'Signing in…' : 'Sign in with Bandcamp'}
                </button>
                <p className="mt-2 text-xs text-fg-muted">
                  Or paste cookies manually below.
                </p>
              </div>
            )}
            <textarea
              value={crawlerCookieInput}
              onChange={(e) => setCrawlerCookieInput(e.target.value)}
              rows={5}
              className="mt-3 w-full rounded border border-border bg-bg-base p-3 font-mono text-xs text-fg-primary focus:border-accent focus:outline-none"
              placeholder="identity=...; client_id=...; session=...; ..."
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-fg-muted">Step 1 of 2</span>
              <button
                type="button"
                onClick={() => handleValidate('crawler')}
                disabled={validating === 'crawler' || !crawlerCookieInput.trim()}
                className="rounded bg-accent px-4 py-2 font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {validating === 'crawler' ? 'Validating…' : 'Validate & continue'}
              </button>
            </div>
          </section>
        )}

        {wizardStep === 2 && (
          <section className="rounded-lg border border-border bg-bg-surface p-6">
            <h2 className="text-xl font-semibold">Step 2: Your Bandcamp account (optional)</h2>
            <p className="mt-2 text-sm text-fg-secondary">
              Optional. Link your <strong>real</strong> Bandcamp account if
              you want the app to:
            </p>
            <ul className="mt-2 ml-4 list-disc text-sm text-fg-secondary">
              <li>read <em>your</em>{' '}collection and follows (instead of the burner&rsquo;s)</li>
              <li>mirror &ldquo;follow artist&rdquo; clicks back to bandcamp.com on your account</li>
            </ul>
            <p className="mt-2 text-sm text-fg-secondary">
              Skip this if you just want the burner&rsquo;s data — you can
              always link your account later from Setup.
            </p>
            {tauriRuntime && (
              <div className="mt-3 rounded border border-accent/40 bg-accent/5 p-3">
                <p className="text-sm text-fg-secondary">
                  <strong>Easy mode:</strong> sign in with Bandcamp directly
                  in this app.
                </p>
                <button
                  type="button"
                  onClick={() => handleEmbeddedSignIn('main')}
                  disabled={validating === 'main'}
                  className="mt-2 rounded bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {validating === 'main' ? 'Signing in…' : 'Sign in with Bandcamp'}
                </button>
                <p className="mt-2 text-xs text-fg-muted">
                  Make sure to log in to your <strong>real</strong> account
                  this time, not the burner.
                </p>
              </div>
            )}
            <textarea
              value={mainCookieInput}
              onChange={(e) => setMainCookieInput(e.target.value)}
              rows={5}
              className="mt-3 w-full rounded border border-border bg-bg-base p-3 font-mono text-xs text-fg-primary focus:border-accent focus:outline-none"
              placeholder="Paste your real-account cookies here, or leave empty to skip"
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setWizardStep(1)}
                className="text-sm text-fg-muted transition-colors hover:text-fg-primary"
              >
                &larr; Back
              </button>
              <span className="text-xs text-fg-muted">Step 2 of 2</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWizardDone(true)}
                  className="rounded border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover"
                >
                  Skip &amp; finish
                </button>
                <button
                  type="button"
                  onClick={() => handleValidate('main')}
                  disabled={validating === 'main' || !mainCookieInput.trim()}
                  className="rounded bg-accent px-4 py-2 font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {validating === 'main' ? 'Validating…' : 'Link & finish'}
                </button>
              </div>
            </div>
          </section>
        )}

        {message && (
          <div
            className={`rounded border p-4 text-sm ${
              message.kind === 'ok'
                ? 'border-border-success bg-bg-success text-fg-success'
                : 'border-border-danger bg-bg-danger text-fg-danger'
            }`}
          >
            {message.text}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {hasOnlyMainLegacy && (
        <div className="rounded border border-border-warning bg-bg-warning p-4 text-sm text-fg-warning">
          You&rsquo;re running on a legacy single-account setup. The cookies
          you pasted earlier are stored as &ldquo;Your Bandcamp account&rdquo;.
          The app keeps working, but adding a separate burner account
          isolates all reads from your real one — recommended before sharing
          this instance with anyone else.
        </div>
      )}

      <section className="rounded-lg border border-border bg-bg-surface p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Burner Bandcamp account (required)</h2>
            <p className="mt-1 text-sm text-fg-secondary">
              All reads, crawls, and audio fetches go through this account.
              Create a fresh throwaway on bandcamp.com so your real identity
              never touches the tool. If Bandcamp blocks it, just make a new
              one and re-paste cookies here.
            </p>
          </div>
          {crawler && (
            <button
              type="button"
              onClick={() => handleLogout('crawler')}
              disabled={loggingOut === 'crawler'}
              className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:border-border-danger hover:text-fg-danger disabled:opacity-50"
            >
              {loggingOut === 'crawler' ? 'Signing out…' : 'Sign out'}
            </button>
          )}
        </div>
        {crawler ? (
          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-fg-muted">Username</dt>
            <dd className="font-mono">{crawler.username}</dd>
            <dt className="text-fg-muted">Fan ID</dt>
            <dd className="font-mono">{crawler.fanId}</dd>
            <dt className="text-fg-muted">Cookies updated</dt>
            <dd className="font-mono text-xs">{formatDateTime(crawler.updatedAt)}</dd>
          </dl>
        ) : (
          <>
            <p className="mt-3 text-xs text-fg-muted">
              Open DevTools → Network → any request to bandcamp.com → Request
              Headers → <code>Cookie:</code>. Paste the full string here.
            </p>
            <textarea
              value={crawlerCookieInput}
              onChange={(e) => setCrawlerCookieInput(e.target.value)}
              rows={5}
              className="mt-3 w-full rounded border border-border bg-bg-base p-3 font-mono text-xs text-fg-primary focus:border-accent focus:outline-none"
              placeholder="identity=...; client_id=...; session=...; ..."
            />
            <button
              type="button"
              onClick={() => handleValidate('crawler')}
              disabled={validating === 'crawler' || !crawlerCookieInput.trim()}
              className="mt-3 rounded bg-accent px-4 py-2 font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {validating === 'crawler' ? 'Validating…' : 'Validate cookies'}
            </button>
          </>
        )}
      </section>

      <section className="rounded-lg border border-border bg-bg-surface p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Your Bandcamp account (optional)</h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Link your real account if you want the app to read{' '}
              <em>your</em>{' '}collection and follows, or to mirror &ldquo;follow
              artist&rdquo; clicks back to bandcamp.com on your account.
              Leave empty otherwise — the local follow list works without it.
            </p>
          </div>
          {main && (
            <button
              type="button"
              onClick={() => handleLogout('main')}
              disabled={loggingOut === 'main'}
              className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:border-border-danger hover:text-fg-danger disabled:opacity-50"
            >
              {loggingOut === 'main' ? 'Signing out…' : 'Unlink'}
            </button>
          )}
        </div>
        {main ? (
          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-fg-muted">Username</dt>
            <dd className="font-mono">{main.username}</dd>
            <dt className="text-fg-muted">Fan ID</dt>
            <dd className="font-mono">{main.fanId}</dd>
            <dt className="text-fg-muted">Cookies updated</dt>
            <dd className="font-mono text-xs">{formatDateTime(main.updatedAt)}</dd>
          </dl>
        ) : (
          <>
            <textarea
              value={mainCookieInput}
              onChange={(e) => setMainCookieInput(e.target.value)}
              rows={5}
              className="mt-3 w-full rounded border border-border bg-bg-base p-3 font-mono text-xs text-fg-primary focus:border-accent focus:outline-none"
              placeholder="Paste your real-account Bandcamp cookies here (optional)"
            />
            <button
              type="button"
              onClick={() => handleValidate('main')}
              disabled={validating === 'main' || !mainCookieInput.trim()}
              className="mt-3 rounded border border-border bg-bg-elevated px-4 py-2 font-medium text-fg-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {validating === 'main' ? 'Validating…' : 'Link main account'}
            </button>
          </>
        )}
      </section>

      {(crawler || main) && (
        <section className="rounded-lg border border-border bg-bg-surface p-6">
          <h2 className="text-xl font-semibold">Sync from Bandcamp</h2>
          <p className="mt-2 text-sm text-fg-secondary">
            Indexing the library of{' '}
            <a
              className="font-medium text-accent hover:underline"
              href={`https://bandcamp.com/${resolvedTarget || main?.username || crawler?.username || ''}`}
              target="_blank"
              rel="noreferrer"
              title="Open this profile on bandcamp.com"
            >
              @{resolvedTarget || main?.username || crawler?.username || '?'}
            </a>
            . Click <strong>Sync library</strong>{' '}to pull every release in
            that profile&rsquo;s collection plus the tracks behind them.
            Click <strong>Import follows</strong>{' '}to pull every artist and
            label that profile follows so they show up under
            Discover &rarr; Follows.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-fg-muted">Items imported</div>
              <div className="text-2xl font-semibold">{ownedCount}</div>
            </div>
            <div>
              <div className="text-fg-muted">Last library sync</div>
              <div className="font-mono text-xs">
                {lastSync ? (
                  <>
                    {lastSync.status} {formatDateTime(lastSync.startedAt)}
                    {lastSync.itemsSynced > 0 && ` (${lastSync.itemsSynced} items)`}
                  </>
                ) : (
                  '—'
                )}
              </div>
            </div>
          </div>
          {lastSync?.errorMessage && (
            <div className="mt-3 rounded border border-border-danger bg-bg-danger p-3 text-sm text-fg-danger">
              {lastSync.errorMessage}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSyncLibrary}
              disabled={syncing != null || noAccountAtAll}
              className="rounded bg-accent px-4 py-2 font-medium text-fg-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing === 'library' ? 'Syncing library…' : 'Sync library'}
            </button>
            <button
              type="button"
              onClick={handleSyncFollows}
              disabled={syncing != null || noAccountAtAll}
              className="rounded border border-border bg-bg-elevated px-4 py-2 font-medium text-fg-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing === 'follows' ? 'Importing follows…' : 'Import follows'}
            </button>
          </div>
        </section>
      )}

      {message && (
        <div
          className={`rounded border p-4 text-sm ${
            message.kind === 'ok'
              ? 'border-border-success bg-bg-success text-fg-success'
              : 'border-border-danger bg-bg-danger text-fg-danger'
          }`}
        >
          {message.text}
        </div>
      )}

      <PreferencesEditor />
      <ShortcutsEditor />
      {tauriRuntime && <AppWindowSection />}
      <AboutPanel version={initial.appVersion} />
      <DiagnosticsPanel />
      <DatabaseInspector />
    </div>
  );
}

function AppWindowSection() {
  const [trayOnClose, setTrayOnClose] = useState(false);
  // Hydrate from localStorage on mount. The toggle is purely client-side
  // state — Rust doesn't read it; AppShell's onCloseRequested listener
  // reads the same key and decides whether to hide vs close.
  useEffect(() => {
    setTrayOnClose(localStorage.getItem(MINIMIZE_TO_TRAY_KEY) === 'true');
  }, []);

  function toggle() {
    const next = !trayOnClose;
    setTrayOnClose(next);
    if (next) localStorage.setItem(MINIMIZE_TO_TRAY_KEY, 'true');
    else localStorage.removeItem(MINIMIZE_TO_TRAY_KEY);
  }

  return (
    <section className="rounded-lg border border-border bg-bg-surface p-6">
      <h2 className="text-xl font-semibold">App window</h2>
      <p className="mt-2 text-sm text-fg-secondary">
        By default the app runs inside its own desktop window. If you
        prefer the standard browser experience (Tabs, Bookmarks, F12
        DevTools), open the local server in your default browser. The
        desktop window stays open as the host of the local server —
        don&rsquo;t close it, or the browser tab will lose its
        backend.
      </p>
      <button
        type="button"
        onClick={() => {
          window.open(`${window.location.origin}/`, '_blank', 'noopener');
        }}
        className="mt-3 rounded border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover"
      >
        ↗ Open in default browser
      </button>

      <div className="mt-6 border-t border-border pt-5">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={trayOnClose}
            onChange={toggle}
            className="mt-1 h-4 w-4 cursor-pointer"
          />
          <span className="flex-1">
            <span className="block text-sm font-medium">
              Close button minimizes to system tray
            </span>
            <span className="mt-1 block text-xs text-fg-muted">
              When enabled, clicking the X hides the window but keeps the
              app running in the system tray (next to the clock). The
              local server stays alive so your browser tab to
              127.0.0.1:3457 keeps working. Right-click the tray icon for
              a real Quit. When disabled, X behaves like in any other
              app: it quits the app and stops the server.
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}

function WizardProgress({ step }: { step: 1 | 2 }) {
  const labels = ['Burner account', 'Your account'];
  return (
    <div className="flex items-center gap-2">
      {labels.map((label, i) => {
        const num = (i + 1) as 1 | 2;
        const active = num === step;
        const done = num < step;
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                active
                  ? 'border-accent bg-accent text-fg-on-accent'
                  : done
                    ? 'border-accent text-accent'
                    : 'border-border text-fg-muted'
              }`}
            >
              {done ? '✓' : num}
            </div>
            <span
              className={`text-sm ${
                active ? 'font-semibold text-fg-primary' : 'text-fg-secondary'
              }`}
            >
              {label}
            </span>
            {i < labels.length - 1 && (
              <span className="mx-1 text-fg-muted">›</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
