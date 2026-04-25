export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-5xl font-bold tracking-tight">Unfck Bandcamp</h1>
      <p className="mt-4 text-fg-secondary">
        Beatport-style discovery for your Bandcamp collection. Self-hosted, single-tenant.
      </p>
      <div className="mt-12 rounded-lg border border-border bg-bg-surface p-6">
        <h2 className="text-xl font-semibold">Setup pending</h2>
        <p className="mt-2 text-fg-secondary">
          Phase 0 skeleton. Phase 1 (auth + owned-sync) is the next step. Once it ships, this page
          becomes the onboarding flow.
        </p>
      </div>
    </main>
  );
}
