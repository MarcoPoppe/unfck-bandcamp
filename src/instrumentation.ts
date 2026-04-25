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
}
