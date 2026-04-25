export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { runMigrations } = await import('./lib/db/migrate');
  const result = runMigrations();
  if (result.applied === 0) {
    console.log(`[instrumentation] db migrations up-to-date (${result.total} total)`);
  } else {
    console.log(
      `[instrumentation] db migrations applied: ${result.applied} (${result.total} total)`,
    );
  }

  // Mark any sync_runs left as `running` from a previous crash as `error`,
  // so the next sync starts from clean state and `is sync active?` guards
  // (later phases) don't deadlock on stale rows.
  try {
    const { reapStaleSyncRuns } = await import('./lib/sync/owned');
    const reaped = reapStaleSyncRuns();
    if (reaped > 0) {
      console.log(`[instrumentation] reaped ${reaped} stale running sync_run(s)`);
    }
  } catch (err) {
    console.warn('[instrumentation] could not reap stale sync runs:', err);
  }
}
