import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface TableInfo {
  name: string;
  rowCount: number;
  description: string;
  columns: string[];
}

const TABLES: Array<{ name: string; description: string }> = [
  { name: 'auth', description: 'Encrypted Bandcamp session (1 row)' },
  { name: 'collection_items', description: "Your owned releases (synced from Bandcamp)" },
  { name: 'tracks', description: 'Tracks expanded from owned releases + lookup-imported tracks' },
  { name: 'discovered_tracks', description: 'Tracks from artists you follow (Discover)' },
  { name: 'artists', description: 'Artists referenced by tracks or follows' },
  { name: 'labels', description: 'Labels referenced by tracks or follows' },
  { name: 'diggers', description: 'Bandcamp users you found or follow' },
  { name: 'following', description: 'Your follows on artists / labels / curators' },
  { name: 'wishlist', description: 'Your wishlist with status (open / bought / dismissed)' },
  { name: 'tags', description: 'Personal tags' },
  { name: 'track_tags', description: 'Tag assignments per track' },
  { name: 'playlists', description: 'Your playlists' },
  { name: 'playlist_tracks', description: 'Track ordering inside playlists' },
  { name: 'track_plays', description: 'Play history (one row per playback)' },
  { name: 'track_curation', description: 'Like / dislike / archive state per track' },
  { name: 'digger_overlap', description: 'Curators ranked by collection overlap with you' },
  { name: 'digger_collection', description: 'Curators’ full collections (after a crawl)' },
  { name: 'digger_crawl_runs', description: 'Bookkeeping for curator collection crawls' },
  { name: 'best_of_supporters_runs', description: 'Best-of-supporters results per track' },
  { name: 'sync_runs', description: 'Bookkeeping for owned / discovery sync jobs' },
  { name: '_migrations', description: 'Applied schema migrations' },
];

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const db = getDb();
  const out: TableInfo[] = [];
  for (const t of TABLES) {
    try {
      const row = db
        .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM ${t.name}`)
        .get();
      const colsRows = db
        .prepare<[], { name: string }>(`PRAGMA table_info(${t.name})`)
        .all();
      out.push({
        name: t.name,
        rowCount: row?.c ?? 0,
        description: t.description,
        columns: colsRows.map((r) => r.name),
      });
    } catch {
      out.push({
        name: t.name,
        rowCount: 0,
        description: t.description + ' (table missing)',
        columns: [],
      });
    }
  }
  // DB file size for context.
  let dbSizeBytes: number | null = null;
  try {
    const r = db.prepare<[], { p: number }>(
      `SELECT page_count * page_size AS p FROM pragma_page_count, pragma_page_size`,
    ).get();
    dbSizeBytes = r?.p ?? null;
  } catch {
    // ignore
  }
  return NextResponse.json(
    { ok: true, tables: out, dbSizeBytes },
    { headers: NO_STORE_HEADERS },
  );
}
