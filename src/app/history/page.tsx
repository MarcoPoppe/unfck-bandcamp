import { listRecentPlays } from '@/lib/library/plays';
import { getStoredAuth } from '@/lib/auth/store';

export const dynamic = 'force-dynamic';

function formatPct(p: number | null): string {
  if (p == null) return '';
  return `${Math.round(p * 100)}%`;
}

export default function HistoryPage() {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">History</h1>
        <p className="mt-2 text-fg-secondary">
          Setup nicht abgeschlossen. <a className="text-accent underline" href="/setup">/setup</a>
        </p>
      </main>
    );
  }
  const plays = listRecentPlays(200);
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">History</h1>
          <p className="text-fg-secondary">{plays.length} letzte Plays</p>
        </div>
        <a href="/" className="text-sm text-fg-muted transition-colors hover:text-accent">
          ← home
        </a>
      </header>
      <div className="space-y-1">
        {plays.length === 0 ? (
          <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-center text-sm text-fg-muted">
            Noch keine Plays. Ein Track gilt als &quot;gehoert&quot;, sobald 50% oder mehr gespielt wurden.
          </p>
        ) : (
          plays.map((p) => (
            <div
              key={p.id}
              className="grid grid-cols-[56px_1fr_80px_140px] items-center gap-3 rounded border border-border bg-bg-surface px-3 py-2"
            >
              {p.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.coverUrl} alt="" className="h-10 w-10 rounded object-cover" />
              ) : (
                <div className="h-10 w-10 rounded bg-bg-elevated" />
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.title}</div>
                <div className="truncate text-xs text-fg-secondary">
                  {p.artistName ?? 'unknown'}
                </div>
              </div>
              <div className="text-right text-xs text-fg-muted">
                {formatPct(p.completedPct)}
              </div>
              <div className="text-right font-mono text-xs text-fg-muted">{p.playedAt}</div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
