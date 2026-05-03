import { getCrawlTargetUsername, getStoredAuth, getStoredMainAuth } from '../auth/store';
import { fetchFollowedBands, fetchInitialCollection } from '../bandcamp/fanapi';
import { follow, upsertArtist, upsertLabel } from '../entities/store';
import { recordSyncError } from './errors_store';

export interface ImportFollowsResult {
  fetched: number;
  artistsAdded: number;
  artistsAlreadyFollowed: number;
  labelsAdded: number;
  labelsAlreadyFollowed: number;
  durationMs: number;
}

/**
 * Mirror the configured crawl target's Bandcamp follows into the local DB.
 * Each remote band becomes an artists or labels row (depending on its
 * `is_label` flag), and we insert a `following` row so it shows up under
 * Discover → Follows and gets included in the next discovery sync.
 *
 * Resolution order for the fan_id whose follows we want:
 *   1. Main account's fan_id, if linked — that's the user's real identity.
 *   2. Otherwise: crawl the target profile's public page to extract its
 *      fan_id. Works for any public Bandcamp profile.
 *   3. Fall back to the crawler's own fan_id (single-account / self-crawl).
 */
export async function importFollowsFromBandcamp(): Promise<ImportFollowsResult> {
  const auth = getStoredAuth();
  if (!auth) throw new Error('no auth stored — run /setup first');

  const startedAt = Date.now();

  let targetFanId: number | null = null;
  const main = getStoredMainAuth();
  if (main) {
    targetFanId = main.fanId;
  } else {
    const targetUsername = getCrawlTargetUsername();
    if (targetUsername && targetUsername !== auth.username) {
      // Crawl the public profile to read its fan_id from the page blob.
      const profile = await fetchInitialCollection(targetUsername, auth.cookieString);
      targetFanId = profile.fanId ?? auth.fanId;
    } else {
      targetFanId = auth.fanId;
    }
  }

  let bands;
  try {
    bands = await fetchFollowedBands(targetFanId, auth.cookieString);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordSyncError({
      kind: 'follows',
      itemTitle: `fan_id=${targetFanId}`,
      message,
    });
    throw err;
  }

  let artistsAdded = 0;
  let artistsAlreadyFollowed = 0;
  let labelsAdded = 0;
  let labelsAlreadyFollowed = 0;

  for (const b of bands) {
    try {
      if (b.isLabel) {
        const labelId = upsertLabel({
          bcUrl: b.bcUrl,
          name: b.name,
          imageUrl: b.imageUrl,
        });
        const created = follow('label', labelId);
        if (created) labelsAdded += 1;
        else labelsAlreadyFollowed += 1;
      } else {
        const artistId = upsertArtist({
          bcUrl: b.bcUrl,
          name: b.name,
          bcBandId: b.bandId,
          imageUrl: b.imageUrl,
        });
        const created = follow('artist', artistId);
        if (created) artistsAdded += 1;
        else artistsAlreadyFollowed += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordSyncError({
        kind: 'follows',
        itemUrl: b.bcUrl,
        itemTitle: b.name,
        message,
      });
    }
  }

  return {
    fetched: bands.length,
    artistsAdded,
    artistsAlreadyFollowed,
    labelsAdded,
    labelsAlreadyFollowed,
    durationMs: Date.now() - startedAt,
  };
}
