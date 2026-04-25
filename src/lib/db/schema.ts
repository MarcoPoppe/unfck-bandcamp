import type Database from 'better-sqlite3';

export interface Migration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

const META_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'init_meta',
    up: (db) => {
      db.prepare(META_TABLE_SQL).run();
    },
  },
];
