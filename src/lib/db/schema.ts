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

      // Polymorphic following: entity_type points at artists/labels/curators.
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
  {
    id: 8,
    name: 'phase5_tags_playlists_history',
    up: (db) => {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS tags (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT NOT NULL UNIQUE,
           color TEXT NOT NULL DEFAULT '#7c5cff',
           created_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`,
      ).run();
      db.prepare(
        `CREATE TABLE IF NOT EXISTS track_tags (
           track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
           tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
           added_at TEXT NOT NULL DEFAULT (datetime('now')),
           PRIMARY KEY (track_id, tag_id)
         )`,
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_track_tags_tag_id ON track_tags (tag_id)',
      ).run();
      db.prepare(
        `CREATE TABLE IF NOT EXISTS playlists (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT NOT NULL,
           description TEXT,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`,
      ).run();
      db.prepare(
        `CREATE TABLE IF NOT EXISTS playlist_tracks (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
           track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
           position INTEGER NOT NULL,
           added_at TEXT NOT NULL DEFAULT (datetime('now')),
           UNIQUE (playlist_id, track_id)
         )`,
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position ON playlist_tracks (playlist_id, position)',
      ).run();
      db.prepare(
        `CREATE TABLE IF NOT EXISTS track_plays (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
           played_at TEXT NOT NULL DEFAULT (datetime('now')),
           completed_pct REAL,
           source TEXT
         )`,
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_track_plays_track_id ON track_plays (track_id)',
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_track_plays_played_at ON track_plays (played_at DESC)',
      ).run();
    },
  },
  {
    id: 9,
    name: 'phase_d_curation',
    up: (db) => {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS track_curation (
           track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
           rating INTEGER NOT NULL DEFAULT 0 CHECK (rating IN (-1, 0, 1)),
           archived_at TEXT,
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`,
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_track_curation_archived ON track_curation (archived_at)',
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_track_curation_rating ON track_curation (rating)',
      ).run();
    },
  },
  {
    id: 10,
    name: 'phase_f_diggers',
    up: (db) => {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS digger_overlap (
           digger_id INTEGER PRIMARY KEY REFERENCES diggers(id) ON DELETE CASCADE,
           overlap_count INTEGER NOT NULL DEFAULT 0,
           sample_titles TEXT,
           last_computed_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`,
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_digger_overlap_count ON digger_overlap (overlap_count DESC)',
      ).run();
    },
  },
  {
    id: 11,
    name: 'phase_k_digger_ignored',
    up: (db) => {
      db.prepare(
        'ALTER TABLE digger_overlap ADD COLUMN ignored_at TEXT',
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_digger_overlap_ignored ON digger_overlap (ignored_at)',
      ).run();
    },
  },
  {
    id: 12,
    name: 'phase_m_best_of_supporters',
    up: (db) => {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS best_of_supporters_runs (
           track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
           started_at TEXT NOT NULL,
           finished_at TEXT,
           status TEXT NOT NULL,
           supporters_scanned INTEGER NOT NULL DEFAULT 0,
           supporters_total INTEGER,
           items_aggregated INTEGER NOT NULL DEFAULT 0,
           top_items_json TEXT,
           error_message TEXT
         )`,
      ).run();
    },
  },
  {
    id: 13,
    name: 'phase_n_digger_collection',
    up: (db) => {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS digger_collection (
           digger_id INTEGER NOT NULL REFERENCES diggers(id) ON DELETE CASCADE,
           bc_item_id INTEGER NOT NULL,
           bc_item_type TEXT NOT NULL,
           title TEXT,
           artist_name TEXT,
           cover_url TEXT,
           bc_url TEXT,
           purchased_at TEXT,
           PRIMARY KEY (digger_id, bc_item_id, bc_item_type)
         )`,
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_digger_collection_item ON digger_collection (bc_item_id, bc_item_type)',
      ).run();
      db.prepare(
        `CREATE TABLE IF NOT EXISTS digger_crawl_runs (
           digger_id INTEGER PRIMARY KEY REFERENCES diggers(id) ON DELETE CASCADE,
           started_at TEXT NOT NULL,
           finished_at TEXT,
           status TEXT NOT NULL,
           items_crawled INTEGER NOT NULL DEFAULT 0,
           items_total_known INTEGER,
           error_message TEXT
         )`,
      ).run();
    },
  },
  {
    id: 14,
    name: 'phase_p_collection_position',
    up: (db) => {
      db.prepare(
        'ALTER TABLE digger_collection ADD COLUMN position INTEGER',
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_digger_collection_position ON digger_collection (digger_id, position)',
      ).run();
    },
  },
  {
    id: 15,
    name: 'phase_v_bpm',
    up: (db) => {
      // BPM detected client-side via realtime-bpm-analyzer during playback
      // and persisted here once we have a stable reading. REAL because
      // typical detector output is fractional (127.43 BPM); the UI rounds
      // for display.
      db.prepare('ALTER TABLE tracks ADD COLUMN bpm REAL').run();
    },
  },
  {
    id: 16,
    name: 'phase_y_released_at',
    up: (db) => {
      // Original release date from Bandcamp's tralbum_details
      // (`release_date`, ISO 8601). Used by the Active-Status badge on
      // Artist and Label pages: an artist counts as active when their
      // latest release is within the configurable cutoff. Stored as TEXT
      // because BC sometimes only gives us year-month precision and we
      // want to keep the original string rather than coerce.
      db.prepare('ALTER TABLE tracks ADD COLUMN released_at TEXT').run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_tracks_artist_released ON tracks (artist_id, released_at)',
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_tracks_label_released ON tracks (label_id, released_at)',
      ).run();
    },
  },
  {
    id: 17,
    name: 'phase_af_auth_split',
    up: (db) => {
      // Replace the single-row `auth` table with role-tagged rows so each
      // instance can hold a crawler account (used for all reads) and an
      // optional main account (used only to mirror follow/unfollow back
      // to bandcamp.com). Existing rows become role='main' so legacy
      // setups keep working until the user adds a crawler.
      db.prepare(
        `CREATE TABLE auth_v17 (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           role TEXT NOT NULL CHECK (role IN ('crawler','main')) UNIQUE,
           cookie_string TEXT NOT NULL,
           fan_id INTEGER NOT NULL,
           username TEXT NOT NULL,
           email TEXT,
           crawl_target_username TEXT,
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`,
      ).run();
      // Carry over any existing auth row as the main account. The legacy
      // table had id=1 only; we don't need that constraint anymore.
      db.prepare(
        `INSERT INTO auth_v17 (role, cookie_string, fan_id, username, email, updated_at)
           SELECT 'main', cookie_string, fan_id, username, email, updated_at
             FROM auth`,
      ).run();
      db.prepare('DROP TABLE auth').run();
      db.prepare('ALTER TABLE auth_v17 RENAME TO auth').run();
    },
  },
  {
    id: 18,
    name: 'phase_ag_sync_errors_and_staging',
    up: (db) => {
      // Per-item sync errors persisted so the diagnostics endpoint can
      // surface them long after the sync toast has been dismissed. Codex
      // pass-2 finding: errors lived only in API responses, so the user
      // had no way to retrieve "what went wrong yesterday".
      db.prepare(
        `CREATE TABLE IF NOT EXISTS sync_errors (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           run_kind TEXT NOT NULL,
           run_id INTEGER,
           item_url TEXT,
           item_title TEXT,
           error_message TEXT NOT NULL,
           created_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`,
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_sync_errors_created ON sync_errors (created_at DESC)',
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_sync_errors_kind ON sync_errors (run_kind, created_at DESC)',
      ).run();

      // Stage-and-swap marker for digger_collection crawls. Codex pass-2:
      // the previous implementation deleted every row before fetching, so
      // a mid-run crash erased prior crawl data. New approach: tag freshly
      // persisted rows with `staged_run_at`, then on success delete every
      // row whose marker is not the current run.
      db.prepare(
        'ALTER TABLE digger_collection ADD COLUMN staged_run_at TEXT',
      ).run();
    },
  },
  {
    id: 19,
    name: 'phase_ah_digger_source_tag',
    up: (db) => {
      // Track which scan-source last picked up each curator, so the UI
      // can scope the displayed list (and the "shared:" sample titles)
      // to the source the user just scanned. Without this, switching
      // from "library" to "playlist X" still shows curators from older
      // library scans whose sample_titles point at tracks that aren't
      // in playlist X — Marco saw UNMADE listed under his "Minimal
      // April 2026" scan with shared tracks (Tim Theo, SVNX, FREEMAN)
      // that aren't in that playlist at all.
      db.prepare(
        "ALTER TABLE digger_overlap ADD COLUMN last_source TEXT",
      ).run();
      db.prepare(
        'ALTER TABLE digger_overlap ADD COLUMN last_source_playlist_id INTEGER',
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_digger_overlap_last_source ON digger_overlap (last_source, last_source_playlist_id)',
      ).run();
    },
  },
  {
    id: 20,
    name: 'phase_ai_playlist_buckets',
    up: (db) => {
      // Promote playlists from "track collections" to genre buckets:
      // attach artists and curators to a playlist so Discover can
      // scope a crawl to "only the artists + curators tagged into
      // playlist Minimal" instead of the user's entire follow list.
      // An entity can sit in multiple playlists (one artist that
      // covers Minimal AND Tech-House gets two rows). Many-to-many
      // junction tables, no payload.
      db.prepare(
        `CREATE TABLE IF NOT EXISTS playlist_artists (
           playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
           artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
           added_at TEXT NOT NULL DEFAULT (datetime('now')),
           PRIMARY KEY (playlist_id, artist_id)
         )`,
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_playlist_artists_artist ON playlist_artists (artist_id)',
      ).run();
      db.prepare(
        `CREATE TABLE IF NOT EXISTS playlist_curators (
           playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
           digger_id INTEGER NOT NULL REFERENCES diggers(id) ON DELETE CASCADE,
           added_at TEXT NOT NULL DEFAULT (datetime('now')),
           PRIMARY KEY (playlist_id, digger_id)
         )`,
      ).run();
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_playlist_curators_curator ON playlist_curators (digger_id)',
      ).run();
    },
  },
  {
    id: 21,
    name: 'phase_ai_auth_check_quote_fix',
    up: (db) => {
      // Mig 17 created the auth table with `CHECK (role IN ("crawler","main"))` —
      // double-quoted string literals. SQLite 3.31+ treats double-quoted tokens
      // as column references inside CHECK, not strings. Older SQLite tolerated
      // this; 3.53 (current better-sqlite3) raises "no such column: crawler"
      // whenever a subsequent DDL triggers schema re-validation (e.g. another
      // table's DROP+RENAME). Mig 22's wishlist rebuild was the trigger. We
      // rebuild auth here with single-quoted literals so every later migration
      // can safely touch other tables.
      db.prepare(
        `CREATE TABLE auth_new (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           role TEXT NOT NULL CHECK (role IN ('crawler','main')) UNIQUE,
           cookie_string TEXT NOT NULL,
           fan_id INTEGER NOT NULL,
           username TEXT NOT NULL,
           email TEXT,
           crawl_target_username TEXT,
           updated_at TEXT NOT NULL
         )`,
      ).run();
      db.prepare(
        `INSERT INTO auth_new
           (id, role, cookie_string, fan_id, username, email, crawl_target_username, updated_at)
         SELECT id, role, cookie_string, fan_id, username, email, crawl_target_username, updated_at
           FROM auth`,
      ).run();
      db.prepare('DROP TABLE auth').run();
      db.prepare('ALTER TABLE auth_new RENAME TO auth').run();
    },
  },
  {
    id: 22,
    name: 'phase_aj_wishlist_polymorphic',
    up: (db) => {
      // Relax wishlist from track-only to polymorphic (track | album) and
      // add a push-mirror state machine so the upcoming wishlist-sync
      // worker can track local mutations through their bandcamp.com
      // round-trip. SQLite can't drop a NOT NULL constraint in place, so
      // we use the standard create-new / copy / drop-old / rename dance.
      // Existing rows are seeded with mirror_state='local' so the next
      // sync re-verifies them against the remote wishlist.
      db.prepare(
        `CREATE TABLE wishlist_new (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           bc_track_id INTEGER,
           bc_album_id INTEGER,
           bc_item_type TEXT NOT NULL DEFAULT 't' CHECK(bc_item_type IN ('t','a')),
           bc_url TEXT NOT NULL,
           title TEXT NOT NULL,
           artist_name TEXT,
           album_title TEXT,
           cover_url TEXT,
           status TEXT,
           source TEXT,
           added_at TEXT,
           bought_at TEXT,
           bought_via TEXT,
           dismissed_at TEXT,
           bc_synced_at TEXT,
           mirror_state TEXT NOT NULL DEFAULT 'local'
             CHECK(mirror_state IN ('local','pushing','synced','push_failed')),
           mirror_error TEXT,
           CHECK ((bc_item_type='t' AND bc_track_id IS NOT NULL)
               OR (bc_item_type='a' AND bc_album_id IS NOT NULL))
         )`,
      ).run();
      db.prepare(
        `INSERT INTO wishlist_new
           (id, bc_track_id, bc_url, title, artist_name, album_title, cover_url,
            status, source, added_at, bought_at, bought_via, dismissed_at,
            mirror_state)
           SELECT id, bc_track_id, bc_url, title, artist_name, album_title,
                  cover_url, status, source, added_at, bought_at, bought_via,
                  dismissed_at, 'local'
             FROM wishlist`,
      ).run();
      db.prepare('DROP TABLE wishlist').run();
      db.prepare('ALTER TABLE wishlist_new RENAME TO wishlist').run();
      db.prepare(
        'CREATE UNIQUE INDEX idx_wishlist_track ON wishlist(bc_track_id) WHERE bc_track_id IS NOT NULL',
      ).run();
      db.prepare(
        'CREATE UNIQUE INDEX idx_wishlist_album ON wishlist(bc_album_id) WHERE bc_album_id IS NOT NULL',
      ).run();
      db.prepare(
        `CREATE INDEX idx_wishlist_mirror_state ON wishlist(mirror_state) WHERE mirror_state IN ('pushing','push_failed')`,
      ).run();
      // Re-create the indexes that lived on the pre-Mig22 wishlist table
      // (originally added by Mig 7). DROP TABLE removed them along with the
      // old table, so the wishlist UI's status filters and added_at sort
      // would otherwise regress to full table scans.
      db.prepare(
        'CREATE INDEX idx_wishlist_status ON wishlist (status)',
      ).run();
      db.prepare(
        'CREATE INDEX idx_wishlist_added_at ON wishlist (added_at DESC)',
      ).run();
    },
  },
  {
    id: 23,
    name: 'phase_aj_wishlist_status_default_backfill',
    up: (db) => {
      // Mig 22's wishlist_new declared `status TEXT` without a default,
      // dropping the implicit 'open' default the pre-Mig-22 table had.
      // Every row inserted by addToWishlist() between Mig 22 and this
      // migration carries status=NULL and is therefore invisible on the
      // /wishlist UI (which filters WHERE status='open'). Backfill the
      // NULLs to 'open' so existing wishes resurface; the addToWishlist
      // INSERT statement was also fixed to set status='open' explicitly
      // so new rows can't regress into the same hole.
      //
      // NULL rows that already have bought_at or dismissed_at are
      // promoted to those statuses instead — defensive: if the same
      // status-write bug ever bit reopenItem / dismissItem, this aligns
      // them properly. Both setter paths happen to write status today,
      // so this branch is normally a no-op.
      db.prepare(
        `UPDATE wishlist SET status = 'bought'
           WHERE status IS NULL AND bought_at IS NOT NULL`,
      ).run();
      db.prepare(
        `UPDATE wishlist SET status = 'dismissed'
           WHERE status IS NULL AND dismissed_at IS NOT NULL`,
      ).run();
      db.prepare(
        `UPDATE wishlist SET status = 'open' WHERE status IS NULL`,
      ).run();
    },
  },
];
