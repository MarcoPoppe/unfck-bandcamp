import { notFound } from 'next/navigation';
import { getStoredAuth } from '@/lib/auth/store';
import { getDb } from '@/lib/db';
import { getTrackPermalink, lookupTrack } from '@/lib/track/lookup';
import { getPlayedBcTrackIds } from '@/lib/library/plays';
import { logger } from '@/lib/log';
import TrackPermalinkClient from './TrackPermalinkClient';
import OpenOnBandcampButton from '@/components/OpenOnBandcampButton';

export const dynamic = 'force-dynamic';

function localIdFromBcTrackId(bcTrackId: number): number | null {
  const row = getDb()
    .prepare<[number], { id: number }>(
      'SELECT id FROM tracks WHERE bc_track_id = ? AND removed_at IS NULL',
    )
    .get(bcTrackId);
  return row?.id ?? null;
}

/**
 * Find a known Bandcamp URL for a given numeric track id by checking
 * peripheral tables (discovered_tracks, wishlist). Bandcamp's mobile
 * tralbum_details endpoint 404s for some tracks when called with a
 * numeric id, but lookupTrack works reliably with a real bcUrl. So
 * before declaring a track unresolvable we cast a wider net.
 */
function findKnownBcUrl(bcTrackId: number): string | null {
  const db = getDb();
  const fromDiscovered = db
    .prepare<[number], { bc_url: string | null }>(
      'SELECT bc_url FROM discovered_tracks WHERE bc_track_id = ? AND bc_url IS NOT NULL LIMIT 1',
    )
    .get(bcTrackId);
  if (fromDiscovered?.bc_url) return fromDiscovered.bc_url;
  const fromWishlist = db
    .prepare<[number], { bc_url: string | null }>(
      'SELECT bc_url FROM wishlist WHERE bc_track_id = ? AND bc_url IS NOT NULL LIMIT 1',
    )
    .get(bcTrackId);
  if (fromWishlist?.bc_url) return fromWishlist.bc_url;
  return null;
}

export default async function TrackPermalinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <p className="text-fg-secondary">
          Setup is not complete.{' '}
          <a className="text-accent underline" href="/setup">
            Open setup
          </a>
          .
        </p>
      </main>
    );
  }
  const { id } = await params;
  // URL param is the Bandcamp track id (10-digit). Resolve it to our local
  // tracks.id, falling back to a live lookup if we don't have the track yet.
  const bcTrackId = Number(id);
  if (!Number.isInteger(bcTrackId) || bcTrackId <= 0) notFound();

  let localId = localIdFromBcTrackId(bcTrackId);
  let lookupError: string | null = null;
  if (!localId) {
    // Two-stage lookup: prefer a known bcUrl from discovered_tracks /
    // wishlist (Bandcamp's URL-based lookup is reliable), and only
    // fall back to the numeric id when we have no URL hint at all
    // (the mobile tralbum_details endpoint 404s for some tracks).
    const knownBcUrl = findKnownBcUrl(bcTrackId);
    const lookupInputs = knownBcUrl
      ? [knownBcUrl, String(bcTrackId)]
      : [String(bcTrackId)];
    for (const input of lookupInputs) {
      try {
        const result = await lookupTrack(input);
        localId = result.trackId;
        lookupError = null;
        break;
      } catch (err) {
        lookupError = err instanceof Error ? err.message : 'Lookup failed';
      }
    }
  }
  if (!localId) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Track unavailable</h1>
        <p className="mt-3 text-sm text-fg-secondary">
          The Bandcamp track id <code className="font-mono">{bcTrackId}</code>{' '}
          could not be imported. Bandcamp&rsquo;s mobile lookup occasionally
          404s for tracks that are otherwise reachable on the website. Open
          the track directly on Bandcamp to play or buy it.
        </p>
        {lookupError && (
          <p className="mt-3 font-mono text-xs text-fg-muted">
            {lookupError}
          </p>
        )}
        <div className="mt-6 flex items-center gap-2">
          <a
            href="/discover"
            className="rounded border border-border bg-bg-elevated px-4 py-2 text-sm transition-colors hover:bg-bg-hover"
          >
            Back to Discover
          </a>
          <OpenOnBandcampButton
            href={`https://bandcamp.com/?show_track_id=${bcTrackId}`}
          />
        </div>
      </main>
    );
  }
  let data = getTrackPermalink(localId);
  if (!data) notFound();
  // On-demand release-date refill for tracks imported before migration 16
  // (when the column was added). One BC roundtrip via lookupTrack pulls
  // the full tralbum_details and writes `released_at` back into the row,
  // so the next render has it. Best-effort: a failure just leaves the
  // field empty, no error surfacing.
  if (data && !data.track.releasedAt && data.track.bcUrl) {
    try {
      await lookupTrack(data.track.bcUrl);
      const refreshed = getTrackPermalink(localId);
      if (refreshed) data = refreshed;
    } catch (err) {
      logger.warn('track-permalink', 'released_at refill failed', {
        bcTrackId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const played = getPlayedBcTrackIds();
  const annotated = {
    ...data,
    track: { ...data.track, hasBeenPlayed: played.has(data.track.bcTrackId) },
    siblings: data.siblings.map((s) => ({
      ...s,
      hasBeenPlayed: played.has(s.bcTrackId),
    })),
  };
  return (
    <main className="mx-auto max-w-5xl px-4 pb-32 pt-8">
      <TrackPermalinkClient data={annotated} />
    </main>
  );
}
