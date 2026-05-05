import type { BcCollectionPage } from './types';
import { BC_ORIGIN, bcGet, bcPostJson } from './http';
import { parseProfileBlob, rawCollectionPageToItems } from './parse_collection';

const COLLECTION_PAGE_SIZE = 80;
// Politeness delay between paginated fan-API calls. Bandcamp does not document
// rate limits; SoundFinder's lived experience showed bursts of 10+ rapid requests
// occasionally trigger transient 5xx. 250 ms is conservative and barely felt.
const PAGINATION_DELAY_MS = 250;

interface RawFanCollectionPage {
  items?: unknown[];
  last_token?: string;
  more_available?: boolean;
}

export async function fetchInitialCollection(
  username: string,
  cookieString: string,
): Promise<BcCollectionPage & { fanId: number | null; fanUsername: string | null }> {
  const res = await bcGet(`${BC_ORIGIN}/${encodeURIComponent(username)}`, { cookieString });
  if (res.status !== 200) {
    throw new Error(`profile page for ${username} returned ${res.status}`);
  }
  const html = await res.text();
  const blob = parseProfileBlob(html);
  if (!blob) {
    throw new Error(`profile page for ${username} did not contain a parseable pagedata blob`);
  }
  return {
    items: blob.initialItems,
    lastToken: blob.lastToken,
    moreAvailable: blob.lastToken !== null,
    collectionTotal: blob.itemCount,
    fanId: blob.fanId,
    fanUsername: blob.fanUsername,
  };
}

export async function fetchCollectionPage(
  fanId: number,
  olderThanToken: string,
  cookieString: string,
  count = COLLECTION_PAGE_SIZE,
): Promise<BcCollectionPage> {
  const payload = await bcPostJson<RawFanCollectionPage>(
    `${BC_ORIGIN}/api/fancollection/1/collection_items`,
    { fan_id: fanId, older_than_token: olderThanToken, count },
    { cookieString },
  );
  return rawCollectionPageToItems(payload as never);
}

export interface PaginateOptions {
  fanId: number;
  initialLastToken: string | null;
  cookieString: string;
  maxItems?: number;
  onPage?: (page: BcCollectionPage, soFar: number) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface BcFollowedBand {
  bandId: number;
  name: string;
  bcUrl: string;
  imageId: number | null;
  imageUrl: string | null;
  isLabel: boolean;
}

interface RawFollowedBand {
  band_id?: number;
  name?: string;
  url_hints?: { subdomain?: string; custom_domain?: string | null };
  image_id?: number | null;
  is_label?: boolean | number;
}

interface RawFollowingBandsPage {
  followeers?: RawFollowedBand[];
  bands?: RawFollowedBand[];
  more_available?: boolean;
  last_token?: string | null;
}

function bandUrlFromHints(b: RawFollowedBand): string | null {
  const sub = b.url_hints?.subdomain?.trim();
  const custom = b.url_hints?.custom_domain?.trim();
  if (custom) return `https://${custom}`;
  if (sub) return `https://${sub}.bandcamp.com`;
  return null;
}

function avatarUrlFromImageId(imageId: number | null): string | null {
  if (!imageId) return null;
  return `https://f4.bcbits.com/img/${imageId}_42.jpg`;
}

function rawToFollowedBand(b: RawFollowedBand): BcFollowedBand | null {
  if (!b.band_id || !b.name) return null;
  const bcUrl = bandUrlFromHints(b);
  if (!bcUrl) return null;
  return {
    bandId: b.band_id,
    name: b.name,
    bcUrl,
    imageId: b.image_id ?? null,
    imageUrl: avatarUrlFromImageId(b.image_id ?? null),
    isLabel: !!b.is_label,
  };
}

/**
 * Pull every band the fan currently follows on Bandcamp. Paginated through
 * `older_than_token` like collection_items. Returns artists + labels in one
 * list — caller decides how to split them into local entity tables.
 */
export async function fetchFollowedBands(
  fanId: number,
  cookieString: string,
): Promise<BcFollowedBand[]> {
  const out: BcFollowedBand[] = [];
  // Bandcamp's following_bands endpoint returns [] when older_than_token
  // is null — collection_items tolerates that, but this endpoint wants a
  // sentinel meaning "everything older than now". Format is
  // `<unix_seconds>:<numeric_id>`. A future-dated timestamp works as the
  // initial cursor; subsequent pages use the last_token from the
  // previous page.
  let token: string = `${Math.floor(Date.now() / 1000) + 60}:1`;
  for (let i = 0; i < 100; i += 1) {
    const payload: RawFollowingBandsPage = await bcPostJson<RawFollowingBandsPage>(
      `${BC_ORIGIN}/api/fancollection/1/following_bands`,
      { fan_id: fanId, older_than_token: token, count: COLLECTION_PAGE_SIZE },
      { cookieString },
    );
    const raw = payload.followeers ?? payload.bands ?? [];
    for (const r of raw) {
      const item = rawToFollowedBand(r);
      if (item) out.push(item);
    }
    if (!payload.more_available || !payload.last_token || payload.last_token === token) break;
    token = payload.last_token;
    if (PAGINATION_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, PAGINATION_DELAY_MS));
    }
  }
  return out;
}

export async function paginateCollection(opts: PaginateOptions): Promise<{
  totalItems: number;
  pages: number;
}> {
  let token = opts.initialLastToken;
  let totalItems = 0;
  let pages = 0;
  const max = opts.maxItems ?? Number.POSITIVE_INFINITY;

  while (token && totalItems < max) {
    if (opts.signal?.aborted) break;
    const page = await fetchCollectionPage(opts.fanId, token, opts.cookieString);
    pages += 1;
    totalItems += page.items.length;
    if (opts.onPage) await opts.onPage(page, totalItems);
    if (!page.moreAvailable || !page.lastToken || page.lastToken === token) break;
    token = page.lastToken;
    if (PAGINATION_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, PAGINATION_DELAY_MS));
    }
  }
  return { totalItems, pages };
}
