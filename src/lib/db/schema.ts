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

const AUTH_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cookie_string TEXT NOT NULL,
    fan_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    email TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const COLLECTION_ITEMS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS collection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bc_item_id INTEGER NOT NULL,
    bc_item_type TEXT NOT NULL CHECK (bc_item_type IN ('a', 't')),
    bc_url TEXT NOT NULL,
    title TEXT NOT NULL,
    artist_name TEXT,
    artist_url TEXT,
    album_title TEXT,
    label_name TEXT,
    band_id INTEGER,
    cover_url TEXT,
    purchased_at TEXT,
    added_to_db_at TEXT NOT NULL DEFAULT (datetime('now')),
    raw_json TEXT NOT NULL,
    UNIQUE (bc_item_id, bc_item_type)
  )
`;

const COLLECTION_INDEXES_SQL = [
  'CREATE INDEX IF NOT EXISTS idx_collection_items_purchased_at ON collection_items (purchased_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_collection_items_artist ON collection_items (artist_name)',
];

const SYNC_RUNS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
    items_synced INTEGER NOT NULL DEFAULT 0,
    items_total_known INTEGER,
    error_message TEXT
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
  {
    id: 2,
    name: 'phase1_auth_and_collection',
    up: (db) => {
      db.prepare(AUTH_TABLE_SQL).run();
      db.prepare(COLLECTION_ITEMS_TABLE_SQL).run();
      for (const ix of COLLECTION_INDEXES_SQL) {
        db.prepare(ix).run();
      }
      db.prepare(SYNC_RUNS_TABLE_SQL).run();
    },
  },
  {
    id: 3,
    name: 'phase1_5_collection_lifecycle',
    up: (db) => {
      db.prepare('ALTER TABLE collection_items ADD COLUMN last_seen_run_id INTEGER').run();
      db.prepare('ALTER TABLE collection_items ADD COLUMN removed_at TEXT').run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_collection_items_last_seen ON collection_items (last_seen_run_id)',
      ).run();
    },
  },
];
