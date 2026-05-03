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
export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
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
  void syncFollowedDiscovery(runId).catch(() => {
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
