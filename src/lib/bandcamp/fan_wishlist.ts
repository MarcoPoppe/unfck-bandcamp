import { BC_ORIGIN, bcGet, bcPostJson } from './http';
import { parseProfileBlob } from './parse_collection';
import type { BcCollectionItem, BcCollectionPage, BcItemType } from './types';

const WISHLIST_PAGE_SIZE = 20;

interface RawWishlistItem {
  fan_id?: number;
  item_id?: number;
  item_type?: string;
  tralbum_id?: number;
  tralbum_type?: string;
  album_id?: number | null;
  band_id?: number | null;
  item_title?: string;
  item_url?: string;
  url_hints?: { subdomain?: string; custom_domain?: string | null; slug?: string };
  band_name?: string;
  band_url?: string;
  album_title?: string | null;
  item_art_id?: number;
  item_art_url?: string;
  purchased?: string | null;
}

interface RawWishlistPage {
  items?: RawWishlistItem[];
  last_token?: string | null;
  more_available?: boolean;
}

function deriveItemType(raw: RawWishlistItem): BcItemType | null {
  if (raw.tralbum_type === 'a' || raw.tralbum_type === 't') return raw.tralbum_type;
  if (raw.item_type === 'album') return 'a';
  if (raw.item_type === 'track') return 't';
  const url = raw.item_url ?? '';
  if (url.includes('/track/')) return 't';
  if (url.includes('/album/')) return 'a';
  return null;
}

function coverUrlFor(raw: RawWishlistItem): string | null {
  if (raw.item_art_url) return raw.item_art_url;
  if (raw.item_art_id) return `https://f4.bcbits.com/img/a${raw.item_art_id}_2.jpg`;
  return null;
}

function rawToCollectionItem(raw: RawWishlistItem): BcCollectionItem | null {
  const itemType = deriveItemType(raw);
  const itemId = raw.tralbum_id ?? raw.item_id ?? null;
  const url = raw.item_url;
  const title = raw.item_title;
  if (!url || !title || !itemType || !itemId) return null;

  const subdomain = raw.url_hints?.subdomain;
  const artistUrl = raw.band_url ?? (subdomain ? `https://${subdomain}.bandcamp.com` : null);
  return {
    bcItemId: itemId,
    bcItemType: itemType,
    bcUrl: url,
    title,
    artistName: raw.band_name ?? null,
    artistUrl,
    albumTitle: raw.album_title ?? null,
    labelName: null,
    bandId: raw.band_id ?? null,
    coverUrl: coverUrlFor(raw),
    purchasedAt: raw.purchased ?? null,
    rawJson: JSON.stringify(raw),
  };
}

function pageFromPayload(payload: RawWishlistPage): BcCollectionPage {
  const items = (payload.items ?? [])
    .map(rawToCollectionItem)
    .filter((it): it is BcCollectionItem => it !== null);
  return {
    items,
    lastToken: payload.last_token ?? null,
    moreAvailable: payload.more_available ?? false,
    collectionTotal: null,
  };
}

export interface InitialWishlistPage extends BcCollectionPage {
  fanId: number | null;
  fanUsername: string | null;
}

/**
 * Reads the user's profile to harvest the fan_id, then calls the wishlist
 * API with a future-dated sentinel cursor so the first page is the freshest
 * slice. Returns the same shape as `fetchWishlistPage` plus the fanId and
 * username, which the caller uses for subsequent pagination.
 */
export async function fetchInitialWishlist(
  username: string,
  cookieString: string,
): Promise<InitialWishlistPage> {
  const res = await bcGet(`${BC_ORIGIN}/${encodeURIComponent(username)}`, { cookieString });
  if (res.status !== 200) {
    throw new Error(`profile page for ${username} returned ${res.status}`);
  }
  const html = await res.text();
  const blob = parseProfileBlob(html);
  if (!blob) {
    throw new Error(`profile page for ${username} did not contain a parseable pagedata blob`);
  }
  const fanId = blob.fanId;
  if (!fanId) {
    throw new Error(`profile page for ${username} did not expose a fan_id`);
  }

  // Future-dated sentinel cursor: asks the API for "everything before this
  // point in time", which on first call is the freshest slice. Format
  // mirrors the cursor Bandcamp returns in `last_token` for subsequent
  // pages: `<unix_seconds>:<item_id>:<type-letter>::`.
  const sentinel = `${Math.floor(Date.now() / 1000) + 60}:1:t::`;
  const first = await fetchWishlistPage(fanId, sentinel, cookieString);

  let total: number | null = null;
  const countMatch = html.match(/"wishlist_data":\s*\{[^}]*"item_count":\s*(\d+)/);
  if (countMatch) total = Number(countMatch[1]);

  return {
    ...first,
    collectionTotal: total,
    fanId,
    fanUsername: blob.fanUsername,
  };
}

export async function fetchWishlistPage(
  fanId: number,
  olderThanToken: string,
  cookieString: string,
  count = WISHLIST_PAGE_SIZE,
): Promise<BcCollectionPage> {
  const payload = await bcPostJson<RawWishlistPage>(
    `${BC_ORIGIN}/api/fancollection/1/wishlist_items`,
    { fan_id: fanId, older_than_token: olderThanToken, count },
    { cookieString },
  );
  return pageFromPayload(payload);
}

export { pageFromPayload as __pageFromPayloadForTests };
