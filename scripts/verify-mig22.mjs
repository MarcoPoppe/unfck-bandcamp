// scripts/verify-mig22.mjs
// Dumps wishlist schema and confirms Mig 22 invariants.
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';

const dbPath = process.env.DATABASE_PATH
  ?? path.join(os.homedir(), 'AppData/Roaming/com.unfck.bandcamp/data/unfck.db');
const db = new Database(dbPath, { readonly: true });

const cols = db.prepare('PRAGMA table_info(wishlist)').all().map((c) => c.name);
const expected = ['id','bc_track_id','bc_album_id','bc_item_type','bc_url','title',
  'artist_name','album_title','cover_url','status','source','added_at',
  'bought_at','bought_via','dismissed_at','bc_synced_at','mirror_state','mirror_error'];
const missing = expected.filter((c) => !cols.includes(c));
if (missing.length) { console.error('MISSING:', missing); process.exit(1); }

const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='wishlist'`).all().map((r) => r.name);
const expectedIdx = ['idx_wishlist_track','idx_wishlist_album','idx_wishlist_mirror_state'];
const missingIdx = expectedIdx.filter((i) => !idx.includes(i));
if (missingIdx.length) { console.error('MISSING INDEX:', missingIdx); process.exit(1); }

const rowCount = db.prepare('SELECT COUNT(*) AS n FROM wishlist').get().n;
console.log(`OK: ${cols.length} columns, ${idx.length} indexes, ${rowCount} rows preserved.`);
