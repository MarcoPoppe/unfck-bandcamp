'use client';

import { useEffect, useRef } from 'react';
import { useConfirmStore } from '@/lib/ui/confirmStore';

export default function ConfirmDialog() {
  const open = useConfirmStore((s) => s.open);
  const request = useConfirmStore((s) => s.request);
  const answer = useConfirmStore((s) => s.answer);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    confirmBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        answer(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        answer(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, answer]);

  if (!open || !request) return null;

  const {
    message,
    title,
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    destructive = true,
  } = request;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'confirm-title' : undefined}
      aria-describedby="confirm-message"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) answer(false);
      }}
    >
      <div className="mx-4 w-full max-w-md rounded-lg border border-border bg-bg-elevated p-5 shadow-xl">
        {title && (
          <h2 id="confirm-title" className="mb-2 text-base font-semibold text-fg-primary">
            {title}
          </h2>
        )}
        <p id="confirm-message" className="text-sm text-fg-secondary">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => answer(false)}
            className="rounded border border-border bg-bg-base px-3 py-1.5 text-sm text-fg-primary hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => answer(true)}
            className={`rounded px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              destructive
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-accent text-fg-on-accent hover:opacity-90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
