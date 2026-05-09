import { getDb } from '../db';
import { getStoredAuth } from '../auth/store';
import { fetchArtistOverview } from '../bandcamp/fetch_artist';
import { fetchReleasePage } from '../bandcamp/fetch_release';
import { fetchDiggerProfile } from '../bandcamp/fetch_digger';
import {
  listArtistsTaggedToPlaylist,
  listDiggersTaggedToPlaylist,
  listFollowedArtists,
  listFollowedDiggers,
  upsertArtist,
} from '../entities/store';
import { listDiggerCollection } from './digger_collection';
import { recordSyncError } from './errors_store';

const PER_REQUEST_DELAY_MS = 350;
const RELEASE_PARALLELISM = 3;
const DEFAULT_RELEASES_PER_ARTIST = 12;
// Higher default for curators: the user explicitly wants every track from a
// followed curator they haven't heard yet. With 350ms-per-request and 3-way
// parallelism, 200 releases cost ~25s.
const DEFAULT_RELEASES_PER_DIGGER = 200;

function getReleasesPerDigger(): number {
  const raw = process.env.DISCOVERY_RELEASES_PER_DIGGER;
  if (!raw) return DEFAULT_RELEASES_PER_DIGGER;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RELEASES_PER_DIGGER;
}

/** Strip trailing slash for URL-set keys so /album/x and /album/x/ collapse. */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Create a sync_runs row marked 'running' and return its id. The client
 * polls this row to render a progress bar during long discovery crawls. */
export function createDiscoverySyncRun(totalKnown: number | null): number {
  const info = getDb()
    .prepare(
      `INSERT INTO sync_runs (kind, status, items_synced, items_total_known)
         VALUES (?, 'running', 0, ?)`,
    )
    .run('discovery', totalKnown);
  return Number(info.lastInsertRowid);
}

/** Best-effort upper bound on releases the next sync will fetch — used for
 * the progress bar's denominator. Counts each followed artist's recent
 * release window and each followed curator's collection size (capped). */
export function estimateDiscoveryReleaseCount(): number {
  const artistsCount = listFollowedArtists().length;
  const curators = listFollowedDiggers();
  const perDigger = getReleasesPerDigger();
  const perArtist = getReleasesPerArtist();
  let diggerEstimate = 0;
  for (const d of curators) {
    const r = getDb()
      .prepare<[number], { c: number }>(
        `SELECT COUNT(*) AS c FROM digger_collection WHERE digger_id = ?`,
      )
      .get(d.id);
    diggerEstimate += Math.min(r?.c ?? perDigger, perDigger);
  }
  return artistsCount * perArtist + diggerEstimate;
}

function updateDiscoverySyncRun(
  runId: number,
  patch: {
    items_synced?: number;
    items_total_known?: number | null;
    status?: 'running' | 'success' | 'error';
    finished?: boolean;
    error_message?: string | null;
  },
): void {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.items_synced != null) {
    sets.push('items_synced = ?');
    values.push(patch.items_synced);
  }
  if (patch.items_total_known !== undefined) {
    sets.push('items_total_known = ?');
    values.push(patch.items_total_known);
  }
  if (patch.status) {
    sets.push('status = ?');
    values.push(patch.status);
  }
  if (patch.finished) {
    sets.push("finished_at = datetime('now')");
  }
  if (patch.error_message !== undefined) {
    sets.push('error_message = ?');
    values.push(patch.error_message);
  }
  if (sets.length === 0) return;
  values.push(runId);
  getDb()
    .prepare(`UPDATE sync_runs SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
}

export interface DiscoverySyncProgress {
  id: number;
  status: 'running' | 'success' | 'error';
  startedAt: string;
  finishedAt: string | null;
  itemsSynced: number;
  itemsTotalKnown: number | null;
  errorMessage: string | null;
}

/** Latest discovery sync row (running or finished) for the status endpoint. */
export function getLatestDiscoverySyncRun(): DiscoverySyncProgress | null {
  const row = getDb()
    .prepare<[], {
      id: number;
      status: 'running' | 'success' | 'error';
      started_at: string;
      finished_at: string | null;
      items_synced: number;
      items_total_known: number | null;
      error_message: string | null;
    }>(
      `SELECT id, status, started_at, finished_at, items_synced,
              items_total_known, error_message
         FROM sync_runs
         WHERE kind = 'discovery'
         ORDER BY id DESC
         LIMIT 1`,
    )
    .get();
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    itemsSynced: row.items_synced,
    itemsTotalKnown: row.items_total_known,
    errorMessage: row.error_message,
  };
}

function getReleasesPerArtist(): number {
  const raw = process.env.DISCOVERY_RELEASES_PER_ARTIST;
  if (!raw) return DEFAULT_RELEASES_PER_ARTIST;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RELEASES_PER_ARTIST;
}

export interface DiscoverySyncResult {
  artistsCrawled: number;
  diggersCrawled?: number;
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

interface ProgressOpts {
  onProgress?: (releasesFetched: number) => void;
  /** sync_runs row id passed through so per-item errors can be linked
   * back to the run they happened in. Optional — single-shot crawls
   * without progress tracking pass null. */
  runId?: number | null;
  /** Per-call override for the release cap. Lets the user pick a
   * smaller/larger crawl from the Discover page without restarting
   * the app (the env var still acts as the global default). */
  releasesPerArtist?: number;
  releasesPerDigger?: number;
  /** Total-tracks stop signal shared across the artist + digger
   * passes. If set, the crawl exits the outer loop as soon as
   * tracker.written >= tracker.target. Marco wanted "give me 50
   * tracks and stop", so we expose a shared counter that both
   * inner crawls update after each batch and check at the top of
   * each iteration. */
  tracker?: TrackBudget;
  /** When set, the crawl is scoped to artists + curators tagged
   * into this playlist (Pfad A). Without it, the full follow list
   * is used. Lets the user run a Minimal-only crawl from the
   * Minimal bucket without crawling Tech-House sources too. */
  playlistScopeId?: number;
}

export interface TrackBudget {
  written: number;
  target: number;
}

export async function syncFollowedArtistsDiscovery(
  opts?: ProgressOpts,
): Promise<DiscoverySyncResult> {
  const auth = getStoredAuth();
  if (!auth) throw new Error('no auth stored');

  const startedAt = Date.now();
  const followed = opts?.playlistScopeId
    ? listArtistsTaggedToPlaylist(opts.playlistScopeId)
    : listFollowedArtists();
  const errors: DiscoverySyncResult['errors'] = [];
  let releasesFetched = 0;
  let tracksWritten = 0;

  const stmt = upsertDiscoveredTrackStmt();
  const now = new Date().toISOString();

  for (let i = 0; i < followed.length; i += 1) {
    if (opts?.tracker && opts.tracker.written >= opts.tracker.target) break;
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
      // Discovery only crawls releases that already have an HTML-known
      // slug URL. Mobile-API-only items (lazy-loaded, no slug yet)
      // would need a tralbum_details roundtrip first; we skip them here
      // and let the on-demand artist-page lookup handle them.
      const releasesToCrawl = overview.releases
        .filter((r): r is typeof r & { bcUrl: string } => r.bcUrl != null)
        .slice(0, opts?.releasesPerArtist ?? getReleasesPerArtist());
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
              const message =
                result.reason instanceof Error ? result.reason.message : String(result.reason);
              errors.push({ artistId: artist.id, bcUrl: release.bcUrl, error: message });
              recordSyncError({
                kind: 'discovery',
                runId: opts?.runId ?? null,
                itemUrl: release.bcUrl,
                itemTitle: artist.name,
                message,
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
              if (opts?.tracker) opts.tracker.written += 1;
            }
          }
        });
        tx();
        opts?.onProgress?.(releasesFetched);
        if (opts?.tracker && opts.tracker.written >= opts.tracker.target) break;
        if (bs + RELEASE_PARALLELISM < releasesToCrawl.length) {
          await new Promise((res) => setTimeout(res, PER_REQUEST_DELAY_MS));
        }
      }
      // Mark artist as freshly crawled.
      getDb()
        .prepare('UPDATE artists SET last_crawled_at = datetime(?) WHERE id = ?')
        .run('now', artist.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ artistId: artist.id, bcUrl: artist.bcUrl, error: message });
      recordSyncError({
        kind: 'discovery',
        runId: opts?.runId ?? null,
        itemUrl: artist.bcUrl,
        itemTitle: artist.name,
        message,
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

/**
 * Discovery via followed curators: for each followed fan, walk their
 * collection (preferring the persisted `digger_collection` table from a
 * full crawl, falling back to the live profile's recent-slice) and pipe
 * every release URL through fetchReleasePage so its tracks land in
 * `discovered_tracks` with `discovered_via = 'crawl_digger'`.
 *
 * Skip-already-fetched: releases whose normalised album/track URL is
 * already represented in discovered_tracks (any source) are skipped to
 * avoid hitting Bandcamp for things we already know about — running this
 * multiple times is cheap and idempotent.
 */
export async function syncFollowedDiggersDiscovery(
  opts?: ProgressOpts,
): Promise<DiscoverySyncResult> {
  const auth = getStoredAuth();
  if (!auth) throw new Error('no auth stored');

  const startedAt = Date.now();
  const followed = opts?.playlistScopeId
    ? listDiggersTaggedToPlaylist(opts.playlistScopeId)
    : listFollowedDiggers();
  const errors: DiscoverySyncResult['errors'] = [];
  let releasesFetched = 0;
  let tracksWritten = 0;

  const stmt = upsertDiscoveredTrackStmt();
  const now = new Date().toISOString();
  const releaseLimit = opts?.releasesPerDigger ?? getReleasesPerDigger();

  // Pre-compute the set of release URLs we already imported (any prior run
  // of any source). We dedup per release-URL so an album with N tracks only
  // costs one BC fetch even when re-run. tracks/album URLs are normalised
  // to bare host+path to handle BC's stray trailing slashes.
  const knownReleaseUrls = new Set<string>();
  const knownRows = getDb()
    .prepare<[], { bc_url: string | null; album_url: string | null }>(
      `SELECT bc_url, album_url FROM discovered_tracks
         UNION ALL
         SELECT bc_url, album_url FROM tracks WHERE removed_at IS NULL`,
    )
    .all();
  for (const r of knownRows) {
    if (r.album_url) knownReleaseUrls.add(stripTrailingSlash(r.album_url));
    if (r.bc_url) knownReleaseUrls.add(stripTrailingSlash(r.bc_url));
  }

  for (let i = 0; i < followed.length; i += 1) {
    if (opts?.tracker && opts.tracker.written >= opts.tracker.target) break;
    const curator = followed[i];
    try {
      // Source preference: full curator crawl if available, otherwise BC's
      // recent-slice via the live profile fetch.
      const crawled = listDiggerCollection(curator.id, 100000);
      let candidateItems: { bcUrl: string }[];
      if (crawled.length > 0) {
        candidateItems = crawled
          .filter((it) => !!it.bcUrl)
          .map((it) => ({ bcUrl: it.bcUrl as string }));
      } else {
        const profile = await fetchDiggerProfile(curator.bcUsername, auth.cookieString);
        candidateItems = profile.initialItems
          .filter((it) => !!it.bcUrl)
          .map((it) => ({ bcUrl: it.bcUrl }));
      }
      const seenUrls = new Set<string>();
      const releases = [];
      for (const it of candidateItems) {
        const norm = stripTrailingSlash(it.bcUrl);
        if (seenUrls.has(norm)) continue;
        seenUrls.add(norm);
        // Skip releases we already have a row for (any source). The user
        // re-running discovery shouldn't re-cost N HTTP requests when
        // nothing new is in the curator's collection.
        if (knownReleaseUrls.has(norm)) continue;
        releases.push(it.bcUrl);
        if (releases.length >= releaseLimit) break;
      }
      for (let bs = 0; bs < releases.length; bs += RELEASE_PARALLELISM) {
        const batch = releases.slice(bs, bs + RELEASE_PARALLELISM);
        const results = await Promise.allSettled(
          batch.map((url) => fetchReleasePage(url, auth.cookieString)),
        );
        const tx = getDb().transaction(() => {
          for (let bi = 0; bi < results.length; bi += 1) {
            const result = results[bi];
            const url = batch[bi];
            if (result.status === 'rejected') {
              const message =
                result.reason instanceof Error ? result.reason.message : String(result.reason);
              errors.push({ artistId: curator.id, bcUrl: url, error: message });
              recordSyncError({
                kind: 'discovery',
                runId: opts?.runId ?? null,
                itemUrl: url,
                itemTitle: curator.bcUsername,
                message,
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
                null,
                detail.artistName,
                detail.artistUrl,
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
                'crawl_digger',
                curator.id,
              );
              tracksWritten += 1;
              if (opts?.tracker) opts.tracker.written += 1;
            }
          }
        });
        tx();
        opts?.onProgress?.(releasesFetched);
        if (opts?.tracker && opts.tracker.written >= opts.tracker.target) break;
        if (bs + RELEASE_PARALLELISM < releases.length) {
          await new Promise((res) => setTimeout(res, PER_REQUEST_DELAY_MS));
        }
      }
      getDb()
        .prepare('UPDATE diggers SET last_crawled_at = datetime(?) WHERE id = ?')
        .run('now', curator.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const url = `https://bandcamp.com/${curator.bcUsername}`;
      errors.push({ artistId: curator.id, bcUrl: url, error: message });
      recordSyncError({
        kind: 'discovery',
        runId: opts?.runId ?? null,
        itemUrl: url,
        itemTitle: curator.bcUsername,
        message,
      });
    }
    if (i < followed.length - 1) {
      await new Promise((res) => setTimeout(res, PER_REQUEST_DELAY_MS));
    }
  }

  return {
    artistsCrawled: 0,
    diggersCrawled: followed.length,
    releasesFetched,
    tracksWritten,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Combined discovery sync — runs the artist crawl and the curator crawl
 * back-to-back and merges their stats. When called with a `runId` from
 * createDiscoverySyncRun, progress is written to sync_runs after each
 * fetched release so the UI can poll and render a progress bar.
 */
export async function syncFollowedDiscovery(
  runId?: number,
  caps?: {
    releasesPerArtist?: number;
    releasesPerDigger?: number;
    /** Total tracks to write across both artist + digger passes
     * before the crawl exits early. Marco's "give me 50 tracks
     * and stop" mode. Without it, both inner crawls run until
     * their own per-source caps. */
    targetTrackCount?: number;
    /** Restrict the crawl to artists + curators tagged into this
     * playlist. The full follow list is used if undefined. */
    playlistScopeId?: number;
  },
): Promise<DiscoverySyncResult> {
  const startedAt = Date.now();
  let totalReleases = 0;
  const onProgress = (n: number) => {
    if (runId == null) return;
    updateDiscoverySyncRun(runId, { items_synced: totalReleases + n });
  };
  // Shared track budget threaded through both inner crawls so a
  // small target doesn't have to wait for the artist pass to fully
  // empty out before the digger pass even checks whether it should
  // run. `written` is incremented from inside the loops; both check
  // their own outer iteration after each release batch.
  const tracker = caps?.targetTrackCount
    ? { written: 0, target: caps.targetTrackCount }
    : undefined;
  try {
    const a = await syncFollowedArtistsDiscovery({
      onProgress,
      runId: runId ?? null,
      releasesPerArtist: caps?.releasesPerArtist,
      tracker,
      playlistScopeId: caps?.playlistScopeId,
    });
    totalReleases = a.releasesFetched;
    if (runId != null) {
      updateDiscoverySyncRun(runId, { items_synced: totalReleases });
    }
    const d =
      tracker && tracker.written >= tracker.target
        ? {
            artistsCrawled: 0,
            diggersCrawled: 0,
            releasesFetched: 0,
            tracksWritten: 0,
            errors: [] as DiscoverySyncResult['errors'],
            durationMs: 0,
          }
        : await syncFollowedDiggersDiscovery({
            onProgress,
            runId: runId ?? null,
            releasesPerDigger: caps?.releasesPerDigger,
            tracker,
            playlistScopeId: caps?.playlistScopeId,
          });
    totalReleases = a.releasesFetched + d.releasesFetched;
    if (runId != null) {
      updateDiscoverySyncRun(runId, {
        items_synced: totalReleases,
        status: 'success',
        finished: true,
      });
    }
    return {
      artistsCrawled: a.artistsCrawled,
      diggersCrawled: d.diggersCrawled ?? 0,
      releasesFetched: a.releasesFetched + d.releasesFetched,
      tracksWritten: a.tracksWritten + d.tracksWritten,
      errors: [...a.errors, ...d.errors],
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    if (runId != null) {
      updateDiscoverySyncRun(runId, {
        status: 'error',
        finished: true,
        error_message: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
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
  discoveredViaEntityId: number | null;
  discoveredViaName: string | null;
  /** When discoveredVia is 'crawl_digger', the bc_fan_id of the curator
   * — lets the UI link "via Leon Licht" straight to their /digger/[id]
   * profile without a follow-up lookup. Null for artists or unresolved. */
  discoveredViaBcFanId: number | null;
  bpm: number | null;
}

export function listDiscoveredTracks(opts?: {
  limit?: number;
  excludeOwned?: boolean;
  excludePlayed?: boolean;
}): DiscoveredTrackRow[] {
  const limit = opts?.limit ?? 200;
  const excludeOwned = opts?.excludeOwned ?? true;
  const excludePlayed = opts?.excludePlayed ?? false;
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
        discovered_via_entity_id: number | null;
        is_owned: number;
        is_played: number;
        bpm: number | null;
      }
    >(
      `SELECT d.id, d.bc_track_id, d.title, d.artist_id, d.artist_name,
              d.album_title, d.album_url, d.cover_url, d.bc_url,
              d.duration_seconds, d.track_number, d.stream_url,
              d.first_seen_at, d.last_seen_at, d.discovered_via,
              d.discovered_via_entity_id,
              (SELECT t.bpm FROM tracks t
                 WHERE t.bc_track_id = d.bc_track_id AND t.removed_at IS NULL
                 LIMIT 1) AS bpm,
              CASE WHEN EXISTS (
                SELECT 1 FROM tracks t WHERE t.bc_track_id = d.bc_track_id AND t.removed_at IS NULL
              ) THEN 1 ELSE 0 END AS is_owned,
              CASE WHEN EXISTS (
                SELECT 1 FROM track_plays tp
                  INNER JOIN tracks t2 ON t2.id = tp.track_id
                  WHERE t2.bc_track_id = d.bc_track_id
              ) THEN 1 ELSE 0 END AS is_played
         FROM discovered_tracks d
         WHERE d.dismissed_at IS NULL
         ORDER BY d.first_seen_at DESC
         LIMIT ?`,
    )
    .all(limit);
  let filtered = rows;
  if (excludeOwned) filtered = filtered.filter((r) => r.is_owned === 0);
  if (excludePlayed) filtered = filtered.filter((r) => r.is_played === 0);

  // Resolve discovered_via_entity_id to a human-readable source name so the
  // UI can show "via leonlicht" / "via Mark Broom" without an extra round-
  // trip per row. Build maps once, then map.
  const artistIds = new Set<number>();
  const diggerIds = new Set<number>();
  for (const r of filtered) {
    if (r.discovered_via_entity_id == null) continue;
    if (r.discovered_via === 'crawl_artist') artistIds.add(r.discovered_via_entity_id);
    if (r.discovered_via === 'crawl_digger') diggerIds.add(r.discovered_via_entity_id);
  }
  const artistNames = new Map<number, string>();
  if (artistIds.size > 0) {
    const ph = Array.from(artistIds).map(() => '?').join(',');
    const arows = getDb()
      .prepare<number[], { id: number; name: string }>(
        `SELECT id, name FROM artists WHERE id IN (${ph})`,
      )
      .all(...Array.from(artistIds));
    for (const a of arows) artistNames.set(a.id, a.name);
  }
  const diggerNames = new Map<number, string>();
  const diggerFanIds = new Map<number, number | null>();
  if (diggerIds.size > 0) {
    const ph = Array.from(diggerIds).map(() => '?').join(',');
    const drows = getDb()
      .prepare<number[], { id: number; bc_username: string; bc_fan_id: number | null; display_name: string | null }>(
        `SELECT id, bc_username, bc_fan_id, display_name FROM diggers WHERE id IN (${ph})`,
      )
      .all(...Array.from(diggerIds));
    for (const d of drows) {
      diggerNames.set(d.id, d.display_name ?? d.bc_username);
      diggerFanIds.set(d.id, d.bc_fan_id);
    }
  }

  return filtered.map((r) => {
    let viaName: string | null = null;
    let viaBcFanId: number | null = null;
    if (r.discovered_via_entity_id != null) {
      if (r.discovered_via === 'crawl_artist') {
        viaName = artistNames.get(r.discovered_via_entity_id) ?? null;
      } else if (r.discovered_via === 'crawl_digger') {
        viaName = diggerNames.get(r.discovered_via_entity_id) ?? null;
        viaBcFanId = diggerFanIds.get(r.discovered_via_entity_id) ?? null;
      }
    }
    return {
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
      discoveredViaEntityId: r.discovered_via_entity_id,
      discoveredViaName: viaName,
      discoveredViaBcFanId: viaBcFanId,
      bpm: r.bpm,
    };
  });
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
