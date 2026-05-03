import { NextResponse } from 'next/server';
import pkg from '../../../../package.json' with { type: 'json' };
import { getDb } from '@/lib/db';
import {
  getStoredCrawlerAuth,
  getStoredMainAuth,
  getCrawlTargetUsername,
} from '@/lib/auth/store';
import { checkSchema } from '@/lib/db/schema_check';
import { listRecentSyncErrors } from '@/lib/sync/errors_store';
import { readRecentLog } from '@/lib/log';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SyncRunRow {
  id: number;
  kind: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  items_synced: number;
  items_total_known: number | null;
  error_message: string | null;
}

/**
 * Aggregated state snapshot a non-technical user can copy-paste into a
 * support thread. Loopback-only because cookie-derived metadata is in
 * scope (we redact secrets, but the username and email together are
 * still account-identifying).
 *
 * Shape is stable enough that future versions can be diffed by eye.
 */
export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const db = getDb();

  const migrationRow = db
    .prepare<[], { max_id: number | null; count: number }>(
      'SELECT MAX(id) AS max_id, COUNT(*) AS count FROM _migrations',
    )
    .get();

  const recentRuns = db
    .prepare<[], SyncRunRow>(
      `SELECT id, kind, started_at, finished_at, status, items_synced,
              items_total_known, error_message
         FROM sync_runs ORDER BY id DESC LIMIT 10`,
    )
    .all();

  const counts = {
    collection_items: countSafe(db, 'collection_items', 'removed_at IS NULL'),
    tracks: countSafe(db, 'tracks', 'removed_at IS NULL'),
    discovered_tracks: countSafe(db, 'discovered_tracks', '1=1'),
    curators: countSafe(db, 'diggers', '1=1'),
    playlists: countSafe(db, 'playlists', '1=1'),
    wishlist_open: countSafe(db, 'wishlist', "status='open'"),
    track_plays: countSafe(db, 'track_plays', '1=1'),
  };

  const crawler = getStoredCrawlerAuth();
  const main = getStoredMainAuth();

  return NextResponse.json(
    {
      ok: true,
      generatedAt: new Date().toISOString(),
      app: {
        name: pkg.name,
        version: pkg.version,
        nodeVersion: process.version,
        platform: process.platform,
        uptimeSec: Math.round(process.uptime()),
      },
      auth: {
        crawler: crawler
          ? {
              username: crawler.username,
              fanId: crawler.fanId,
              hasEmail: crawler.email != null,
              cookiesUpdatedAt: crawler.updatedAt,
            }
          : null,
        main: main
          ? {
              username: main.username,
              fanId: main.fanId,
              hasEmail: main.email != null,
              cookiesUpdatedAt: main.updatedAt,
            }
          : null,
        crawlTargetUsername: getCrawlTargetUsername(),
      },
      schema: {
        latestMigrationId: migrationRow?.max_id ?? null,
        appliedCount: migrationRow?.count ?? 0,
        drift: checkSchema(),
      },
      counts,
      recentSyncRuns: recentRuns.map((r) => ({
        id: r.id,
        kind: r.kind,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        status: r.status,
        itemsSynced: r.items_synced,
        itemsTotalKnown: r.items_total_known,
        errorMessage: r.error_message,
      })),
      recentSyncErrors: listRecentSyncErrors(50),
      recentLog: readRecentLog(80),
      env: {
        databasePath: process.env.DATABASE_PATH ?? null,
        cookieSuggestEnabled: process.env.UNFCK_ALLOW_COOKIE_SUGGEST === '1',
      },
    },
    { headers: NO_STORE_HEADERS },
  );
}

function countSafe(
  db: ReturnType<typeof getDb>,
  table: string,
  where: string,
): number | null {
  try {
    const row = db
      .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`)
      .get();
    return row?.c ?? 0;
  } catch {
    // Table missing or column missing — return null so the diagnostics
    // payload still serialises and the consumer can see the gap.
    return null;
  }
}
