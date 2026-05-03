import { getDb } from '@/lib/db';

export type ActivityStatus = 'active' | 'dormant' | 'inactive' | 'unknown';

export interface ActivitySnapshot {
  status: ActivityStatus;
  /** Latest activity date as the underlying source string. May be ISO
   * 8601 or, in some BC payloads, an RFC-1123-ish "01 Mar 2024 ..." form.
   * The UI parses leniently; consumers that just want a label render it
   * as YYYY-MM-DD via `formatActivityDate`. */
  lastDate: string | null;
  /** Days between now and lastDate, rounded down. null when no data. */
  daysAgo: number | null;
}

/**
 * Cutoff thresholds for the activity rollup. An artist counts as
 * "active" when something landed within the last `ACTIVE_DAYS`, "dormant"
 * within `DORMANT_DAYS`, and "inactive" beyond that. No data = "unknown".
 *
 * Numbers chosen to match how the user tends to think about scenes:
 * three months feels current, a year feels still-around, anything older
 * is "the project is on ice".
 */
const ACTIVE_DAYS = 90;
const DORMANT_DAYS = 365;

/**
 * Pure classifier: turn a last-activity date string into a snapshot.
 * Exposed so non-DB callers (e.g. the ephemeral `/u/[username]` route,
 * which has live-fetched items but no persisted curator row yet) can
 * build a snapshot from whatever they already have.
 */
export function classifyActivity(lastDate: string | null): ActivitySnapshot {
  if (!lastDate) return { status: 'unknown', lastDate: null, daysAgo: null };
  const ts = Date.parse(lastDate);
  if (!Number.isFinite(ts)) {
    return { status: 'unknown', lastDate, daysAgo: null };
  }
  const daysAgo = Math.floor((Date.now() - ts) / 86_400_000);
  let status: ActivityStatus;
  if (daysAgo <= ACTIVE_DAYS) status = 'active';
  else if (daysAgo <= DORMANT_DAYS) status = 'dormant';
  else status = 'inactive';
  return { status, lastDate, daysAgo };
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * Combine the latest release date across owned tracks and discovered
 * tracks for one artist. Both tables can carry a release date — the
 * `tracks.released_at` was added in migration 16, so older rows return
 * NULL here until they get re-synced.
 */
export function getArtistActivity(artistId: number): ActivitySnapshot {
  const db = getDb();
  const ownedRow = db
    .prepare<[number], { d: string | null }>(
      `SELECT MAX(released_at) AS d FROM tracks
       WHERE artist_id = ? AND removed_at IS NULL AND released_at IS NOT NULL`,
    )
    .get(artistId);
  const discRow = db
    .prepare<[number], { d: string | null }>(
      `SELECT MAX(release_date) AS d FROM discovered_tracks
       WHERE artist_id = ? AND release_date IS NOT NULL`,
    )
    .get(artistId);
  return classifyActivity(maxDate(ownedRow?.d ?? null, discRow?.d ?? null));
}

export function getLabelActivity(labelId: number): ActivitySnapshot {
  const db = getDb();
  const ownedRow = db
    .prepare<[number], { d: string | null }>(
      `SELECT MAX(released_at) AS d FROM tracks
       WHERE label_id = ? AND removed_at IS NULL AND released_at IS NOT NULL`,
    )
    .get(labelId);
  const discRow = db
    .prepare<[number], { d: string | null }>(
      `SELECT MAX(release_date) AS d FROM discovered_tracks
       WHERE label_id = ? AND release_date IS NOT NULL`,
    )
    .get(labelId);
  return classifyActivity(maxDate(ownedRow?.d ?? null, discRow?.d ?? null));
}

/**
 * For curators we track the most recent `purchased_at` in their crawled
 * collection. That's the closest equivalent to "still active", since a
 * curator who hasn't bought anything in months is presumably not a useful
 * source for fresh discovery.
 */
export function getDiggerActivity(diggerId: number): ActivitySnapshot {
  const db = getDb();
  const row = db
    .prepare<[number], { d: string | null }>(
      `SELECT MAX(purchased_at) AS d FROM digger_collection
       WHERE digger_id = ? AND purchased_at IS NOT NULL`,
    )
    .get(diggerId);
  return classifyActivity(row?.d ?? null);
}

/** Render a release/added date as YYYY-MM-DD when parseable, or the
 * raw string when not. */
export function formatActivityDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return s;
  return new Date(ts).toISOString().slice(0, 10);
}
