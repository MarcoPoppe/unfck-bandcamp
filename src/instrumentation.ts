export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { runMigrations } = await import('./lib/db/migrate');
  const { logger } = await import('./lib/log');
  const result = runMigrations();
  if (result.applied === 0) {
    logger.info('instrumentation', `db migrations up-to-date (${result.total} total)`);
  } else {
    logger.info(
      'instrumentation',
      `db migrations applied: ${result.applied} (${result.total} total)`,
    );
  }

  // Schema drift preflight: catch the situation where the code references
  // a column that the live DB doesn't have (the same class of bug that
  // surfaced as the tracks.label_name failure). Logged loud so the user
  // sees it in setup diagnostics; we don't crash the app, because the
  // user needs the UI to fix it.
  try {
    const { checkSchema } = await import('./lib/db/schema_check');
    const issues = checkSchema();
    if (issues.length > 0) {
      logger.error('instrumentation', `schema drift detected: ${issues.length} issue(s)`, {
        issues,
      });
    }
  } catch (err) {
    logger.warn('instrumentation', 'could not run schema check', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Mark any sync_runs left as `running` from a previous crash as `error`,
  // so the next sync starts from clean state and `is sync active?` guards
  // (later phases) don't deadlock on stale rows.
  try {
    const { reapStaleSyncRuns } = await import('./lib/sync/owned');
    const reaped = reapStaleSyncRuns();
    if (reaped > 0) {
      logger.info('instrumentation', `reaped ${reaped} stale running sync_run(s)`);
    }
  } catch (err) {
    logger.warn('instrumentation', 'could not reap stale sync runs', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
