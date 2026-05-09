import { NextResponse } from 'next/server';
import {
  createDiscoverySyncRun,
  estimateDiscoveryReleaseCount,
  getLatestDiscoverySyncRun,
  syncFollowedDiscovery,
} from '@/lib/sync/discovery';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

/**
 * Kick off a discovery sync in the background and return the runId so the
 * client can poll GET /api/sync/discovery for live progress. Without the
 * fire-and-forget pattern the request would block for the full duration of
 * the crawl (10s-3min) and the UI couldn't render a progress bar.
 */
interface PostBody {
  releasesPerArtist?: number;
  releasesPerDigger?: number;
  /** Marco's "stop after N tracks" mode: shared budget across both
   * the artist and digger passes. The crawl exits the outer loop
   * as soon as the count is reached, so a 50-target run no longer
   * has to drain every followed artist before it stops. */
  targetTrackCount?: number;
  /** Restrict the crawl to artists + curators tagged into this
   * playlist (Pfad A). When unset, the full follow list is used. */
  playlistScopeId?: number;
}

function clampPositiveInt(raw: unknown, max: number): number | undefined {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return Math.min(n, max);
}

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  let body: PostBody = {};
  try {
    body = (await req.json()) as PostBody;
  } catch {
    // empty body is allowed — fall back to defaults
  }
  const caps = {
    releasesPerArtist: clampPositiveInt(body.releasesPerArtist, 200),
    releasesPerDigger: clampPositiveInt(body.releasesPerDigger, 1000),
    targetTrackCount: clampPositiveInt(body.targetTrackCount, 5000),
    playlistScopeId: clampPositiveInt(body.playlistScopeId, 1_000_000),
  };
  // If a sync is already running, return its row instead of starting a new
  // one — protects against double-click and panel-juggling.
  const existing = getLatestDiscoverySyncRun();
  if (existing && existing.status === 'running') {
    return NextResponse.json(
      { ok: true, runId: existing.id, alreadyRunning: true },
      { headers: NO_STORE_HEADERS },
    );
  }
  const totalKnown = estimateDiscoveryReleaseCount();
  const runId = createDiscoverySyncRun(totalKnown);
  // Fire-and-forget: the response returns immediately with the runId; the
  // sync runs in the background and updates sync_runs.items_synced as it
  // progresses. Errors are persisted to sync_runs.error_message rather than
  // surfacing through the response (the client would already have moved on).
  void syncFollowedDiscovery(runId, caps).catch(() => {
    // syncFollowedDiscovery already records the error to sync_runs; nothing
    // more to do here. The catch keeps the promise from going unhandled.
  });
  return NextResponse.json(
    { ok: true, runId, totalEstimate: totalKnown },
    { headers: NO_STORE_HEADERS },
  );
}

/** Poll endpoint for the discovery progress bar. Returns the latest run
 * regardless of status so the UI can show "last synced N tracks" when
 * idle. */
export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  const run = getLatestDiscoverySyncRun();
  return NextResponse.json({ ok: true, run }, { headers: NO_STORE_HEADERS });
}
