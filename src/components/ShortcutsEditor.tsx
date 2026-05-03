'use client';

import { useEffect, useState } from 'react';
import {
  DEFAULT_BINDINGS,
  SHORTCUT_META,
  formatKey,
  isAcceptableKey,
  loadShortcuts,
  normaliseEventKey,
  resetShortcuts,
  saveShortcuts,
  type ShortcutBindings,
} from '@/lib/settings/shortcuts';

type RecordingId = keyof ShortcutBindings | null;

const GROUP_LABELS: Record<'transport' | 'curation' | 'filter', string> = {
  transport: 'Playback',
  curation: 'Curation',
  filter: 'Filters (on Tracks page)',
};

export default function ShortcutsEditor() {
  const [bindings, setBindings] = useState<ShortcutBindings>(DEFAULT_BINDINGS);
  const [recording, setRecording] = useState<RecordingId>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    setBindings(loadShortcuts());
  }, []);

  useEffect(() => {
    if (!recording) return;
    function handler(e: KeyboardEvent) {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        setHint(null);
        return;
      }
      if (!isAcceptableKey(e.key)) {
        setHint(`Key "${e.key}" cannot be bound (reserved for input or navigation).`);
        return;
      }
      const newKey = normaliseEventKey(e.key);

      // Detect collisions with existing bindings, swap them so we never end up
      // with two actions on the same key.
      const next: ShortcutBindings = { ...bindings };
      const collidingId = (Object.keys(next) as Array<keyof ShortcutBindings>).find(
        (k) => k !== recording && next[k] === newKey,
      );
      if (collidingId) {
        next[collidingId] = bindings[recording];
        setHint(
          `Swapped: ${SHORTCUT_META.find((m) => m.id === collidingId)?.label ?? collidingId} now uses ${formatKey(bindings[recording])}.`,
        );
      } else {
        setHint(null);
      }
      next[recording] = newKey;
      setBindings(next);
      saveShortcuts(next);
      setRecording(null);
    }
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [recording, bindings]);

  function handleReset() {
    resetShortcuts();
    setBindings(DEFAULT_BINDINGS);
    setHint('Shortcuts restored to defaults.');
  }

  const grouped = SHORTCUT_META.reduce<Record<'transport' | 'curation' | 'filter', typeof SHORTCUT_META>>(
    (acc, item) => {
      acc[item.group].push(item);
      return acc;
    },
    { transport: [], curation: [], filter: [] },
  );

  return (
    <section className="rounded-lg border border-border bg-bg-surface p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Keyboard shortcuts</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Stored locally per browser. Click a key to record a new binding, press
            <kbd className="mx-1 rounded border border-border bg-bg-elevated px-1 font-mono text-xs">
              Esc
            </kbd>
            to cancel.
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="rounded border border-border bg-bg-elevated px-3 py-1.5 text-xs transition-colors hover:bg-bg-hover"
        >
          Reset defaults
        </button>
      </div>

      {hint && (
        <div className="mt-4 rounded border border-border bg-bg-elevated p-3 text-xs text-fg-secondary">
          {hint}
        </div>
      )}

      <div className="mt-5 space-y-5">
        {(Object.keys(grouped) as Array<'transport' | 'curation' | 'filter'>).map((group) => (
          <div key={group}>
            <div className="mb-2 text-xs uppercase tracking-wide text-fg-muted">
              {GROUP_LABELS[group]}
            </div>
            <ul className="divide-y divide-border overflow-hidden rounded border border-border">
              {grouped[group].map((meta) => {
                const isRecording = recording === meta.id;
                const value = bindings[meta.id];
                return (
                  <li
                    key={meta.id}
                    className="flex items-center gap-3 bg-bg-base px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{meta.label}</div>
                      <div className="truncate text-xs text-fg-muted">{meta.description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRecording(isRecording ? null : meta.id)}
                      className={`min-w-[88px] rounded border px-3 py-1.5 text-center font-mono text-sm transition-colors ${
                        isRecording
                          ? 'animate-pulse border-accent bg-accent/20 text-accent'
                          : 'border-border bg-bg-elevated text-fg-primary hover:bg-bg-hover'
                      }`}
                    >
                      {isRecording ? 'Press a key…' : formatKey(value)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
