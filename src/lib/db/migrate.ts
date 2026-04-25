import { getDb } from './index';
import { migrations } from './schema';

function validateMigrationList(): void {
  const seen = new Set<number>();
  let lastId = 0;
  for (const m of migrations) {
    if (m.id <= 0 || !Number.isInteger(m.id)) {
      throw new Error(`migration ${m.name} has invalid id ${m.id}`);
    }
    if (seen.has(m.id)) {
      throw new Error(`duplicate migration id ${m.id}`);
    }
    if (m.id <= lastId) {
      throw new Error(
        `migrations must be ordered by ascending id; ${m.id} (${m.name}) follows ${lastId}`,
      );
    }
    seen.add(m.id);
    lastId = m.id;
  }
}

const META_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

export interface MigrationResult {
  applied: number;
  total: number;
}

export function runMigrations(): MigrationResult {
  validateMigrationList();

  const db = getDb();
  db.prepare(META_TABLE_SQL).run();

  let applied = 0;

  // IMMEDIATE transaction: SQLite acquires a RESERVED lock right away,
  // so two concurrent runners (e.g. CLI + instrumentation hook) serialize cleanly.
  const tx = db.transaction(() => {
    const alreadyApplied = new Set(
      db
        .prepare<[], { id: number }>('SELECT id FROM _migrations')
        .all()
        .map((row) => row.id),
    );
    for (const migration of migrations) {
      if (alreadyApplied.has(migration.id)) continue;
      migration.up(db);
      db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(
        migration.id,
        migration.name,
      );
      console.log(`[migrate] applied ${migration.id}: ${migration.name}`);
      applied += 1;
    }
  });
  tx.immediate();

  const total = (
    db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM _migrations').get() as {
      count: number;
    }
  ).count;

  return { applied, total };
}
