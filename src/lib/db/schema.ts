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
  {
    id: 4,
    name: 'phase2_tracks',
    up: (db) => {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS tracks (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           bc_track_id INTEGER NOT NULL UNIQUE,
           bc_album_id INTEGER,
           title TEXT NOT NULL,
           artist_name TEXT,
           artist_url TEXT,
           album_title TEXT,
           album_url TEXT,
           duration_seconds REAL,
           track_number INTEGER,
           cover_url TEXT,
           bc_url TEXT NOT NULL,
           stream_url TEXT,
           stream_url_fetched_at TEXT,
           source_collection_item_id INTEGER,
           added_at TEXT NOT NULL DEFAULT (datetime('now')),
           last_seen_run_id INTEGER,
           removed_at TEXT,
           FOREIGN KEY (source_collection_item_id) REFERENCES collection_items(id) ON DELETE SET NULL
         )`,
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks (artist_name)',
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks (album_url)',
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks (source_collection_item_id)',
      ).run();
    },
  },
  {
    id: 5,
    name: 'phase2_tracks_purchased_at',
    up: (db) => {
      // Denormalize purchased_at from the source collection_item so chronological
      // sort works even after a tombstone nulls out source_collection_item_id.
      db.prepare('ALTER TABLE tracks ADD COLUMN purchased_at TEXT').run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_tracks_purchased_at ON tracks (purchased_at DESC)',
      ).run();
    },
  },
  {
    id: 6,
    name: 'phase3_following',
    up: (db) => {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS artists (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           bc_url TEXT NOT NULL UNIQUE,
           name TEXT NOT NULL,
           bc_band_id INTEGER,
           image_url TEXT,
           added_at TEXT NOT NULL DEFAULT (datetime('now')),
           last_crawled_at TEXT
         )`,
      ).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_artists_band_id ON artists (bc_band_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_artists_name ON artists (name)').run();

      db.prepare(
        `CREATE TABLE IF NOT EXISTS labels (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           bc_url TEXT NOT NULL UNIQUE,
           name TEXT NOT NULL,
           image_url TEXT,
           added_at TEXT NOT NULL DEFAULT (datetime('now')),
           last_crawled_at TEXT
         )`,
      ).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_labels_name ON labels (name)').run();

      db.prepare(
        `CREATE TABLE IF NOT EXISTS diggers (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           bc_username TEXT NOT NULL UNIQUE,
           bc_fan_id INTEGER UNIQUE,
           display_name TEXT,
           image_url TEXT,
           added_at TEXT NOT NULL DEFAULT (datetime('now')),
           last_crawled_at TEXT
         )`,
      ).run();

      // Polymorphic following: entity_type points at artists/labels/diggers.
      // Application-level FK because SQLite cannot polymorphic-reference.
      db.prepare(
        `CREATE TABLE IF NOT EXISTS following (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           entity_type TEXT NOT NULL CHECK (entity_type IN ('artist', 'label', 'digger')),
           entity_id INTEGER NOT NULL,
           followed_at TEXT NOT NULL DEFAULT (datetime('now')),
           UNIQUE (entity_type, entity_id)
         )`,
      ).run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_following_type ON following (entity_type)').run();

      // Tracks now point at their artist/label so discovery queries can join.
      db.prepare('ALTER TABLE tracks ADD COLUMN artist_id INTEGER REFERENCES artists(id)').run();
      db.prepare('ALTER TABLE tracks ADD COLUMN label_id INTEGER REFERENCES labels(id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_tracks_artist_id ON tracks (artist_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_tracks_label_id ON tracks (label_id)').run();

      // Discovery feed: tracks that came in via following-crawls (not in
      // owned collection). source = 'crawl_artist' / 'crawl_label' / 'crawl_digger'.
      db.prepare(
        `CREATE TABLE IF NOT EXISTS discovered_tracks (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           bc_track_id INTEGER NOT NULL UNIQUE,
           bc_album_id INTEGER,
           title TEXT NOT NULL,
           artist_id INTEGER REFERENCES artists(id),
           artist_name TEXT,
           artist_url TEXT,
           album_title TEXT,
           album_url TEXT,
           label_id INTEGER REFERENCES labels(id),
           label_name TEXT,
           cover_url TEXT,
           bc_url TEXT NOT NULL,
           release_date TEXT,
           duration_seconds REAL,
           track_number INTEGER,
           stream_url TEXT,
           stream_url_fetched_at TEXT,
           discovered_via TEXT NOT NULL,
           discovered_via_entity_id INTEGER,
           first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
           last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
           dismissed_at TEXT
         )`,
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_discovered_first_seen ON discovered_tracks (first_seen_at DESC)',
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_discovered_via ON discovered_tracks (discovered_via, discovered_via_entity_id)',
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_discovered_artist ON discovered_tracks (artist_id)',
      ).run();
    },
  },
  {
    id: 7,
    name: 'phase4_wishlist',
    up: (db) => {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS wishlist (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           bc_track_id INTEGER NOT NULL UNIQUE,
           bc_url TEXT NOT NULL,
           title TEXT NOT NULL,
           artist_name TEXT,
           album_title TEXT,
           cover_url TEXT,
           status TEXT NOT NULL CHECK (status IN ('open', 'bought', 'dismissed')) DEFAULT 'open',
           source TEXT NOT NULL CHECK (source IN ('discovery', 'manual')) DEFAULT 'discovery',
           added_at TEXT NOT NULL DEFAULT (datetime('now')),
           bought_at TEXT,
           bought_via TEXT CHECK (bought_via IS NULL OR bought_via IN ('manual', 'auto')),
           dismissed_at TEXT
         )`,
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_wishlist_status ON wishlist (status)',
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_wishlist_added_at ON wishlist (added_at DESC)',
      ).run();
    },
  },
];
