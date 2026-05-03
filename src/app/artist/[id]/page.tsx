import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStoredAuth } from '@/lib/auth/store';
import { getDb } from '@/lib/db';
import { fetchArtistOverview, type BcArtistOverview } from '@/lib/bandcamp/fetch_artist';
import { resolveBandIdToUrl } from '@/lib/bandcamp/resolve_ids';
import { upsertArtist } from '@/lib/entities/store';
import { getPlayedBcTrackIds } from '@/lib/library/plays';
import { getArtistActivity } from '@/lib/library/activity';
import ArtistDetailClient from './ArtistDetailClient';

export const dynamic = 'force-dynamic';

interface ArtistDbRow {
  id: number;
  bc_url: string;
  name: string;
  bc_band_id: number | null;
  image_url: string | null;
  followed: number;
}

function getArtistRow(id: number): ArtistDbRow | null {
  return (
    getDb()
      .prepare<[number], ArtistDbRow>(
        `SELECT a.id, a.bc_url, a.name, a.bc_band_id, a.image_url,
                CASE WHEN f.entity_id IS NULL THEN 0 ELSE 1 END AS followed
           FROM artists a
           LEFT JOIN following f
             ON f.entity_type = 'artist' AND f.entity_id = a.id
           WHERE a.id = ?`,
      )
      .get(id) ?? null
  );
}

function localIdFromBcBandId(bcBandId: number): number | null {
  const row = getDb()
    .prepare<[number], { id: number }>('SELECT id FROM artists WHERE bc_band_id = ?')
    .get(bcBandId);
  return row?.id ?? null;
}

interface OwnedTrackRow {
  id: number;
  bc_track_id: number;
  title: string;
  album_title: string | null;
  bc_url: string;
  cover_url: string | null;
  duration_seconds: number | null;
  stream_url: string | null;
  released_at: string | null;
}

function listOwnedByArtist(artistId: number): OwnedTrackRow[] {
  return getDb()
    .prepare<[number], OwnedTrackRow>(
      `SELECT id, bc_track_id, title, album_title, bc_url, cover_url,
              duration_seconds, stream_url, released_at
         FROM tracks
         WHERE artist_id = ? AND removed_at IS NULL
         ORDER BY album_title ASC, track_number ASC`,
    )
    .all(artistId);
}

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
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
  // URL param is the Bandcamp band id. Resolve to our local artists.id.
  const bcBandId = Number(id);
  if (!Number.isInteger(bcBandId) || bcBandId <= 0) notFound();
  let localId = localIdFromBcBandId(bcBandId);
  // Auto-lookup fallback: if we have never seen this band before, ask BC for
  // its bandcamp_url, persist a stub row, and continue rendering. This
  // matches the /track/[id] behaviour where unknown ids resolve on demand
  // instead of dead-ending in a 404.
  if (!localId) {
    const resolved = await resolveBandIdToUrl(bcBandId, auth.cookieString);
    if (resolved) {
      localId = upsertArtist({
        bcUrl: resolved.bcUrl,
        name: resolved.name ?? 'unknown',
        bcBandId,
        imageUrl: resolved.imageUrl,
      });
    }
  }
  if (!localId) notFound();
  const row = getArtistRow(localId);
  if (!row) notFound();

  let overview: BcArtistOverview | null = null;
  let overviewError: string | null = null;
  try {
    overview = await fetchArtistOverview(row.bc_url, auth.cookieString);
  } catch (err) {
    overviewError = err instanceof Error ? err.message : 'Artist overview fetch failed';
  }

  const played = getPlayedBcTrackIds();
  const owned = listOwnedByArtist(localId).map((t) => ({
    releasedAt: t.released_at,
    id: t.id,
    bcTrackId: t.bc_track_id,
    title: t.title,
    albumTitle: t.album_title,
    bcUrl: t.bc_url,
    coverUrl: t.cover_url,
    durationSeconds: t.duration_seconds,
    hasBeenPlayed: played.has(t.bc_track_id),
    hasStream: t.stream_url !== null,
  }));

  return (
    <main className="mx-auto max-w-5xl px-4 pb-32 pt-8">
      <Link
        href="/tracks"
        className="text-sm text-fg-muted transition-colors hover:text-accent"
      >
        ← Library
      </Link>
      <ArtistDetailClient
        artist={{
          id: row.id,
          bcUrl: row.bc_url,
          name: overview?.name && overview.name !== 'unknown' ? overview.name : row.name,
          imageUrl: overview?.imageUrl ?? row.image_url,
          bcBandId: overview?.bcBandId ?? row.bc_band_id,
          isFollowed: row.followed === 1,
        }}
        activity={getArtistActivity(row.id)}
        releases={overview?.releases ?? []}
        ownedTracks={owned}
        overviewError={overviewError}
      />
    </main>
  );
}
