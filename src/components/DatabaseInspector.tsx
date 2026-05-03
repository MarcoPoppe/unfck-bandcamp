'use client';

import { useEffect, useState } from 'react';

interface TableInfo {
  name: string;
  rowCount: number;
  description: string;
  columns: string[];
}

function formatBytes(b: number | null): string {
  if (b == null) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let val = b;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${val.toFixed(val < 10 ? 2 : 1)} ${units[i]}`;
}

export default function DatabaseInspector() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [dbSizeBytes, setDbSizeBytes] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/db/inspect');
      const json = (await res.json()) as {
        ok?: boolean;
        tables?: TableInfo[];
        dbSizeBytes?: number | null;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Inspect failed (${res.status})`);
      } else {
        setTables(json.tables ?? []);
        setDbSizeBytes(json.dbSizeBytes ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inspect failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const total = tables.reduce((s, t) => s + t.rowCount, 0);

  return (
    <section className="rounded-lg border border-border bg-bg-surface p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Local database</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Everything the tool stores about you is in <code>data/unfck.db</code>. No row
            ever leaves your machine.
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            File size: <span className="font-mono">{formatBytes(dbSizeBytes)}</span> · Total
            rows across tables: <span className="font-mono">{total}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-xs transition-colors hover:bg-bg-hover disabled:opacity-50"
        >
          {loading ? 'Reading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded border border-border-danger bg-bg-danger p-3 text-sm text-fg-danger">
          {error}
        </div>
      )}

      <div className="mt-5 overflow-hidden rounded border border-border">
        <ul className="divide-y divide-border">
          {tables.map((t) => {
            const open = expanded.has(t.name);
            return (
              <li key={t.name}>
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.name)) next.delete(t.name);
                      else next.add(t.name);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-3 bg-bg-base px-3 py-2.5 text-left transition-colors hover:bg-bg-hover"
                >
                  <span className="font-mono text-sm text-fg-primary">{t.name}</span>
                  <span className="rounded-full bg-accent/20 px-2 py-0.5 font-mono text-xs text-accent">
                    {t.rowCount}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                    {t.description}
                  </span>
                  <span className="font-mono text-xs text-fg-muted">{open ? '–' : '+'}</span>
                </button>
                {open && (
                  <div className="bg-bg-base/40 px-3 pb-3 pt-1 text-xs text-fg-muted">
                    <span className="font-mono">columns:</span>{' '}
                    {t.columns.length > 0 ? t.columns.join(', ') : '(none)'}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
