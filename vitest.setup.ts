import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { beforeAll, afterAll } from 'vitest';

// Route every test through a disposable DB so we never touch the dev DB
// (which carries a known pre-Mig22 CHECK-constraint quirk on the auth table).
const TEST_DB_PATH = resolve('./data/unfck.test.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

function removeIfExists(p: string): void {
  if (existsSync(p)) rmSync(p, { force: true });
}

function wipeTestDb(): void {
  removeIfExists(TEST_DB_PATH);
  removeIfExists(`${TEST_DB_PATH}-wal`);
  removeIfExists(`${TEST_DB_PATH}-shm`);
}

beforeAll(async () => {
  mkdirSync(dirname(TEST_DB_PATH), { recursive: true });
  wipeTestDb();
  const { runMigrations } = await import('./src/lib/db/migrate');
  runMigrations();
});

afterAll(async () => {
  const { closeDb } = await import('./src/lib/db');
  closeDb();
  wipeTestDb();
});
