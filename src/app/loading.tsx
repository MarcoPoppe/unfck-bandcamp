export default function GlobalLoading() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <div className="flex items-center gap-3 text-fg-muted">
        <span
          className="inline-block h-3 w-3 animate-pulse rounded-full bg-accent"
          aria-hidden="true"
        />
        <span className="text-sm">Loading…</span>
      </div>
    </main>
  );
}
