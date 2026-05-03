import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { crawlDiggerCollection, getDiggerCrawlStatus } from '@/lib/sync/digger_collection';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';
import { getStoredAuth } from '@/lib/auth/store';
import { upsertDigger } from '@/lib/entities/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

function localIdFromBcFanId(bcFanId: number): number | null {
  const row = getDb()
    .prepare<[number], { id: number }>('SELECT id FROM diggers WHERE bc_fan_id = ?')
    .get(bcFanId);
  return row?.id ?? null;
}

async function resolveLocalId(idParam: string): Promise<number | null> {
  const num = Number(idParam);
  if (!Number.isInteger(num) || num <= 0) return null;
  return localIdFromBcFanId(num);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const { id } = await ctx.params;
  const localId = await resolveLocalId(id);
  if (!localId) {
    return NextResponse.json(
      { ok: false, error: 'curator not found' },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { ok: true, status: getDiggerCrawlStatus(localId) },
    { headers: NO_STORE_HEADERS },
  );
}

interface CrawlPostBody {
  /** When the curator isn't yet in the local curators table (the user is
   * browsing /u/[username] ephemerally), the client passes the profile
   * data it already has from fetchDiggerProfile so the server can upsert
   * without an extra BC API round-trip. */
  bcUsername?: string;
  displayName?: string | null;
  imageUrl?: string | null;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const { id } = await ctx.params;
  const bcFanId = Number(id);
  if (!Number.isInteger(bcFanId) || bcFanId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'invalid bc fan id' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  let body: CrawlPostBody = {};
  try {
    body = (await req.json()) as CrawlPostBody;
  } catch {
    // Empty body is fine for already-persisted curators.
  }
  let localId = localIdFromBcFanId(bcFanId);
  // Auto-persist on first crawl: /u/[username] users browse ephemerally,
  // they aren't in the curators table until something forces them in.
  // Prefer the data the client passed in (it already fetched the profile
  // for the page header) — saves one BC roundtrip and works even when
  // bandcamp.com/api/fan/2/collection_summary returns a non-standard
  // shape, which it sometimes does.
  if (!localId) {
    if (body.bcUsername && body.bcUsername.length > 0) {
      localId = upsertDigger({
        bcUsername: body.bcUsername,
        bcFanId,
        displayName: body.displayName ?? null,
        imageUrl: body.imageUrl ?? null,
      });
    } else {
      // Fall back to a server-side profile fetch if the client didn't
      // pass anything (e.g. legacy clients, or direct API hits).
      const auth = getStoredAuth();
      if (!auth) {
        return NextResponse.json(
          { ok: false, error: 'not configured (run /setup)' },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      // We need a username to call fetchDiggerProfile. Without one from
      // the client, give up — bandcamp.com does not expose a stable
      // fanId → username lookup for arbitrary users.
      return NextResponse.json(
        {
          ok: false,
          error:
            'could not resolve username for this fan id — pass bcUsername in the request body',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
  }
  try {
    const result = await crawlDiggerCollection(localId);
    return NextResponse.json(
      { ok: true, ...result, status: getDiggerCrawlStatus(localId) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'crawl failed';
    return NextResponse.json(
      { ok: false, error: message, status: getDiggerCrawlStatus(localId) },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
