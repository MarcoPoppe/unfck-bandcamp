import { NextResponse } from 'next/server';
import { lookupTrack } from '@/lib/track/lookup';
import { getDb } from '@/lib/db';
import { getPlayedBcTrackIds } from '@/lib/library/plays';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

interface AlbumTrack {
  trackId: number;
  bcTrackId: number;
  title: string;
  artistName: string | null;
  durationSeconds: number | null;
  trackNumber: number | null;
  bcUrl: string;
  hasStream: boolean;
  coverUrl: string | null;
  hasBeenPlayed: boolean;
  releasedAt: string | null;
}

/**
 * Resolve a Bandcamp album URL to its full tracklist. Used by the "expand"
 * affordance on best-of and curator album rows so users can browse the EP's
 * tracks without leaving the list. lookupTrack already imports every track
 * of the release into the local DB, so we just SELECT them back grouped by
 * bc_album_id afterwards.
 */
export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const url = new URL(req.url);
  const target = url.searchParams.get('url');
  if (!target) {
    return NextResponse.json(
      { ok: false, error: 'url query param required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const result = await lookupTrack(target);
    // releaseBcId is the bc_album_id when releaseTralbumType is 'a'. For a
    // single-track release we return just that track.
    const db = getDb();
    let tracks: AlbumTrack[] = [];
    if (result.releaseTralbumType === 'a') {
      const rows = db
        .prepare<[number], {
          id: number;
          bc_track_id: number;
          title: string;
          artist_name: string | null;
          duration_seconds: number | null;
          track_number: number | null;
          bc_url: string;
          stream_url: string | null;
          cover_url: string | null;
          released_at: string | null;
        }>(
          `SELECT id, bc_track_id, title, artist_name, duration_seconds,
                  track_number, bc_url, stream_url, cover_url, released_at
             FROM tracks
             WHERE bc_album_id = ? AND removed_at IS NULL
             ORDER BY track_number ASC, title ASC`,
        )
        .all(result.releaseBcId);
      const played = getPlayedBcTrackIds();
      tracks = rows.map((r) => ({
        trackId: r.id,
        bcTrackId: r.bc_track_id,
        title: r.title,
        artistName: r.artist_name,
        durationSeconds: r.duration_seconds,
        trackNumber: r.track_number,
        bcUrl: r.bc_url,
        // We just successfully imported this release via lookupTrack — the
        // audio stream endpoint will refresh stream_url on demand if it's
        // null in the DB, so claiming hasStream=true here is safe and lets
        // the player toggle past the hasStream guard.
        hasStream: true,
        coverUrl: r.cover_url,
        hasBeenPlayed: played.has(r.bc_track_id),
        releasedAt: r.released_at,
      }));
    } else {
      tracks = [
        {
          trackId: result.trackId,
          bcTrackId: result.bcTrackId,
          title: result.title,
          artistName: result.artistName,
          durationSeconds: null,
          trackNumber: null,
          bcUrl: result.bcUrl,
          hasStream: true,
          coverUrl: result.coverUrl,
          hasBeenPlayed: false,
          releasedAt: null,
        },
      ];
    }
    return NextResponse.json(
      { ok: true, tracks, releaseBcId: result.releaseBcId },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'lookup failed';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
