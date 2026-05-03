import { NextResponse } from 'next/server';
import { syncOwnedCollection } from '@/lib/sync/owned';
import { expandCollectionToTracks } from '@/lib/sync/tracks';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

interface SyncBody {
  maxItems?: number;
  skipTrackImport?: boolean;
}

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: SyncBody = {};
  try {
    body = (await req.json()) as SyncBody;
  } catch {
    // empty body is fine
  }

  try {
    const ownedResult = await syncOwnedCollection(body.maxItems);

    let tracksWritten = 0;
    let itemsExpanded = 0;
    let trackImportError: string | null = null;
    let trackImportErrors: { bcUrl: string; error: string }[] = [];

    if (!body.skipTrackImport) {
      try {
        const trackResult = await expandCollectionToTracks({});
        tracksWritten = trackResult.tracksWritten;
        itemsExpanded = trackResult.itemsExpanded;
        trackImportErrors = trackResult.errors.map((e) => ({
          bcUrl: e.bcUrl,
          error: e.error,
        }));
      } catch (err) {
        trackImportError = err instanceof Error ? err.message : 'track import failed';
      }
    }

    return NextResponse.json(
      {
        ok: true,
        ...ownedResult,
        tracksWritten,
        itemsExpanded,
        trackImportError,
        trackImportErrors,
        wishlistAutoMarked: ownedResult.wishlistAutoMarked,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
