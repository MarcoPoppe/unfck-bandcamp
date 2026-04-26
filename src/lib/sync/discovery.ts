import { getDb } from '../db';
import { getStoredAuth } from '../auth/store';
import { fetchArtistOverview } from '../bandcamp/fetch_artist';
import { fetchReleasePage } from '../bandcamp/fetch_release';
import { listFollowedArtists, upsertArtist } from '../entities/store';

const PER_REQUEST_DELAY_MS = 350;
const RELEASE_PARALLELISM = 3;
const DEFAULT_RELEASES_PER_ARTIST = 12;

function getReleasesPerArtist(): number {
  const raw = process.env.DISCOVERY_RELEASES_PER_ARTIST;
  if (!raw) return DEFAULT_RELEASES_PER_ARTIST;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RELEASES_PER_ARTIST;
}

export interface DiscoverySyncResult {
  artistsCrawled: number;
  releasesFetched: number;
  tracksWritten: number;
  errors: { artistId: number; bcUrl: string; error: string }[];
  durationMs: number;
}

function upsertDiscoveredTrackStmt() {
  return getDb().prepare(
    `INSERT INTO discovered_tracks (
       bc_track_id, bc_album_id, title, artist_id, artist_name, artist_url,
       album_title, album_url, label_id, label_name, cover_url, bc_url,
       release_date, duration_seconds, track_number, stream_url, stream_url_fetched_at,
       discovered_via, discovered_via_entity_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (bc_track_id) DO UPDATE SET
       title = excluded.title,
       artist_id = COALESCE(excluded.artist_id, discovered_tracks.artist_id),
       artist_name = excluded.artist_name,
       album_title = excluded.album_title,
       album_url = excluded.album_url,
       cover_url = COALESCE(excluded.cover_url, discovered_tracks.cover_url),
       stream_url = COALESCE(excluded.stream_url, discovered_tracks.stream_url),
       stream_url_fetched_at = COALESCE(excluded.stream_url_fetched_at, discovered_tracks.stream_url_fetched_at),
       last_seen_at = datetime('now')`,
  );
}

export async function syncFollowedArtistsDiscovery(): Promise<DiscoverySyncResult> {
  const auth = getStoredAuth();
  if (!auth) throw new Error('no auth stored');

  const startedAt = Date.now();
  const followed = listFollowedArtists();
  const errors: DiscoverySyncResult['errors'] = [];
  let releasesFetched = 0;
  let tracksWritten = 0;

  const stmt = upsertDiscoveredTrackStmt();
  const now = new Date().toISOString();

  for (let i = 0; i < followed.length; i += 1) {
    const artist = followed[i];
    try {
      const overview = await fetchArtistOverview(artist.bcUrl, auth.cookieString);
      // Refresh artist metadata if we now know more.
      upsertArtist({
        bcUrl: artist.bcUrl,
        name: overview.name || artist.name,
        bcBandId: overview.bcBandId ?? artist.bcBandId,
        imageUrl: overview.imageUrl ?? artist.imageUrl,
      });
      // Limit to most-recent releases per artist so a 100-release backlog
      // doesn't dominate the sync. The /music page lists releases newest-first.
      const releasesToCrawl = overview.releases.slice(0, getReleasesPerArtist());
      // Bounded parallelism: 3 fetches in flight per batch, cooldown between.
      // Cuts total wallclock ~3x vs strictly-serial crawling.
      for (let bs = 0; bs < releasesToCrawl.length; bs += RELEASE_PARALLELISM) {
        const batch = releasesToCrawl.slice(bs, bs + RELEASE_PARALLELISM);
        const results = await Promise.allSettled(
          batch.map((release) => fetchReleasePage(release.bcUrl, auth.cookieString)),
        );
        const tx = getDb().transaction(() => {
          for (let bi = 0; bi < results.length; bi += 1) {
            const result = results[bi];
            const release = batch[bi];
            if (result.status === 'rejected') {
              errors.push({
                artistId: artist.id,
                bcUrl: release.bcUrl,
                error:
                  result.reason instanceof Error ? result.reason.message : String(result.reason),
              });
              continue;
            }
            const detail = result.value;
            releasesFetched += 1;
            for (const t of detail.tracks) {
              stmt.run(
                t.bcTrackId,
                detail.releaseType === 'a' ? detail.bcReleaseId : null,
                t.title,
                artist.id,
                detail.artistName ?? artist.name,
                detail.artistUrl ?? artist.bcUrl,
                detail.albumTitle,
                detail.albumUrl,
                null,
                null,
                detail.coverUrl,
                t.bcUrl,
                null,
                t.durationSeconds,
                t.trackNumber,
                t.streamUrl,
                t.streamUrl ? now : null,
                'crawl_artist',
                artist.id,
              );
              tracksWritten += 1;
            }
          }
        });
        tx();
        if (bs + RELEASE_PARALLELISM < releasesToCrawl.length) {
          await new Promise((res) => setTimeout(res, PER_REQUEST_DELAY_MS));
        }
      }
      // Mark artist as freshly crawled.
      getDb()
        .prepare('UPDATE artists SET last_crawled_at = datetime(?) WHERE id = ?')
        .run('now', artist.id);
    } catch (err) {
      errors.push({
        artistId: artist.id,
        bcUrl: artist.bcUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (i < followed.length - 1) {
      await new Promise((res) => setTimeout(res, PER_REQUEST_DELAY_MS));
    }
  }

  return {
    artistsCrawled: followed.length,
    releasesFetched,
    tracksWritten,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

export interface DiscoveredTrackRow {
  id: number;
  bcTrackId: number;
  title: string;
  artistName: string | null;
  artistId: number | null;
  albumTitle: string | null;
  albumUrl: string | null;
  coverUrl: string | null;
  bcUrl: string;
  durationSeconds: number | null;
  trackNumber: number | null;
  hasStream: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  discoveredVia: string;
}

export function listDiscoveredTracks(opts?: {
  limit?: number;
  excludeOwned?: boolean;
}): DiscoveredTrackRow[] {
  const limit = opts?.limit ?? 200;
  const excludeOwned = opts?.excludeOwned ?? true;
  const rows = getDb()
    .prepare<
      [number],
      {
        id: number;
        bc_track_id: number;
        title: string;
        artist_id: number | null;
        artist_name: string | null;
        album_title: string | null;
        album_url: string | null;
        cover_url: string | null;
        bc_url: string;
        duration_seconds: number | null;
        track_number: number | null;
        stream_url: string | null;
        first_seen_at: string;
        last_seen_at: string;
        discovered_via: string;
        is_owned: number;
      }
    >(
      `SELECT d.id, d.bc_track_id, d.title, d.artist_id, d.artist_name,
              d.album_title, d.album_url, d.cover_url, d.bc_url,
              d.duration_seconds, d.track_number, d.stream_url,
              d.first_seen_at, d.last_seen_at, d.discovered_via,
              CASE WHEN EXISTS (
                SELECT 1 FROM tracks t WHERE t.bc_track_id = d.bc_track_id AND t.removed_at IS NULL
              ) THEN 1 ELSE 0 END AS is_owned
         FROM discovered_tracks d
         WHERE d.dismissed_at IS NULL
         ORDER BY d.first_seen_at DESC
         LIMIT ?`,
    )
    .all(limit);
  const filtered = excludeOwned ? rows.filter((r) => r.is_owned === 0) : rows;
  return filtered.map((r) => ({
    id: r.id,
    bcTrackId: r.bc_track_id,
    title: r.title,
    artistName: r.artist_name,
    artistId: r.artist_id,
    albumTitle: r.album_title,
    albumUrl: r.album_url,
    coverUrl: r.cover_url,
    bcUrl: r.bc_url,
    durationSeconds: r.duration_seconds,
    trackNumber: r.track_number,
    hasStream: r.stream_url !== null,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    discoveredVia: r.discovered_via,
  }));
}

export function getDiscoveredTrackCount(): number {
  return (
    getDb()
      .prepare<
        [],
        { c: number }
      >('SELECT COUNT(*) AS c FROM discovered_tracks WHERE dismissed_at IS NULL')
      .get() as { c: number }
  ).c;
}
