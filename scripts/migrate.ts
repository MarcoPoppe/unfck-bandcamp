import { runMigrations } from '../src/lib/db/migrate';

const result = runMigrations();
if (result.applied === 0) {
  console.log(`no pending migrations (${result.total} total)`);
} else {
  console.log(`applied ${result.applied} migration(s) (${result.total} total)`);
}
