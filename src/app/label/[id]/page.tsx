import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStoredAuth } from '@/lib/auth/store';
import { getDb } from '@/lib/db';
import { getPlayedBcTrackIds } from '@/lib/library/plays';
import { getLabelActivity } from '@/lib/library/activity';
import LabelDetailClient from './LabelDetailClient';

export const dynamic = 'force-dynamic';

interface LabelDbRow {
  id: number;
  bc_url: string;
  name: string;
  image_url: string | null;
  followed: number;
}

function getLabelRow(id: number): LabelDbRow | null {
  return (
    getDb()
      .prepare<[number], LabelDbRow>(
        `SELECT l.id, l.bc_url, l.name, l.image_url,
                CASE WHEN f.entity_id IS NULL THEN 0 ELSE 1 END AS followed
           FROM labels l
           LEFT JOIN following f
             ON f.entity_type = 'label' AND f.entity_id = l.id
           WHERE l.id = ?`,
      )
      .get(id) ?? null
  );
}

interface LabelTrackRow {
  id: number;
  bc_track_id: number;
  title: string;
  artist_name: string | null;
  album_title: string | null;
  duration_seconds: number | null;
  cover_url: string | null;
  bc_url: string;
  stream_url: string | null;
  album_url: string | null;
  bc_album_id: number | null;
}

function listTracksForLabel(labelId: number): LabelTrackRow[] {
  return getDb()
    .prepare<[number], LabelTrackRow>(
      `SELECT id, bc_track_id, title, artist_name, album_title, duration_seconds,
              cover_url, bc_url, stream_url, album_url, bc_album_id
         FROM tracks
         WHERE label_id = ? AND removed_at IS NULL
         ORDER BY album_title ASC, track_number ASC`,
    )
    .all(labelId);
}

export default async function LabelPage({
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
  const localId = Number(id);
  if (!Number.isInteger(localId) || localId <= 0) notFound();
  const row = getLabelRow(localId);
  if (!row) notFound();

  const tracks = listTracksForLabel(localId);
  const played = getPlayedBcTrackIds();
  const annotated = tracks.map((t) => ({
    id: t.id,
    bcTrackId: t.bc_track_id,
    title: t.title,
    artistName: t.artist_name,
    albumTitle: t.album_title,
    durationSeconds: t.duration_seconds,
    coverUrl: t.cover_url,
    bcUrl: t.bc_url,
    hasStream: t.stream_url !== null,
    hasBeenPlayed: played.has(t.bc_track_id),
    albumUrl: t.album_url,
    bcAlbumId: t.bc_album_id,
  }));

  // Group by album for the detail view: most labels release as albums/EPs
  // and showing them grouped is more readable than a flat track list.
  type Group = {
    bcAlbumId: number | null;
    albumTitle: string | null;
    albumUrl: string | null;
    coverUrl: string | null;
    tracks: typeof annotated;
  };
  const groups = new Map<string, Group>();
  for (const t of annotated) {
    const key = t.bcAlbumId != null ? `a:${t.bcAlbumId}` : `t:${t.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.tracks.push(t);
    } else {
      groups.set(key, {
        bcAlbumId: t.bcAlbumId,
        albumTitle: t.albumTitle,
        albumUrl: t.albumUrl,
        coverUrl: t.coverUrl,
        tracks: [t],
      });
    }
  }
  const groupList = Array.from(groups.values());

  return (
    <main className="mx-auto max-w-5xl px-4 pb-32 pt-8">
      <Link
        href="/discover"
        className="text-sm text-fg-muted transition-colors hover:text-accent"
      >
        ← Discover
      </Link>
      <LabelDetailClient
        label={{
          id: row.id,
          bcUrl: row.bc_url,
          name: row.name,
          imageUrl: row.image_url,
          isFollowed: row.followed === 1,
        }}
        activity={getLabelActivity(row.id)}
        groups={groupList}
      />
    </main>
  );
}
