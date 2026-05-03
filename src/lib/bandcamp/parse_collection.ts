import type { BcCollectionItem, BcCollectionPage, BcItemType } from './types';

export interface ProfileBlob {
  fanId: number | null;
  fanUsername: string | null;
  displayName: string | null;
  imageId: number | null;
  imageUrl: string | null;
  bio: string | null;
  location: string | null;
  websiteUrl: string | null;
  followersCount: number | null;
  followingBandsCount: number | null;
  itemCount: number | null;
  lastToken: string | null;
  initialItems: BcCollectionItem[];
}

const PAGEDATA_RE = /<div[^>]+id="pagedata"[^>]+data-blob="([^"]+)"/;

function htmlEntityDecode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

interface RawCollectionItem {
  item_id?: number;
  item_type?: string;
  tralbum_id?: number;
  tralbum_type?: string;
  album_id?: number | null;
  item_title?: string;
  item_url?: string;
  tralbum_url?: string;
  url_hints?: { subdomain?: string; custom_domain?: string | null; slug?: string };
  band_id?: number;
  band_name?: string;
  band_url?: string;
  album_title?: string;
  label?: string | null;
  item_art_id?: number;
  item_art_url?: string;
  num_streamable_tracks?: number;
  purchased?: string;
  featured_track?: number;
  featured_track_title?: string;
  featured_track_url?: string;
}

interface RawCollectionData {
  item_count?: number;
  last_token?: string;
  items?: Record<string, RawCollectionItem>;
  sequence?: string[];
  redownload_urls?: Record<string, string>;
}

interface RawFanData {
  fan_id?: number;
  id?: number;
  username?: string;
  name?: string;
  trackpipe_url?: string;
  photo?: { image_id?: number; width?: number; height?: number };
  bio?: string | null;
  location?: string | null;
  website_url?: string | null;
  followers_count?: number;
  following_bands_count?: number;
  following_fans_count?: number;
}

interface PagedataBlob {
  fan_data?: RawFanData;
  collection_data?: RawCollectionData;
  identities?: { fan?: { id?: number; username?: string } };
  item_cache?: {
    collection?: Record<string, RawCollectionItem>;
    wishlist?: Record<string, RawCollectionItem>;
  };
}

function deriveItemType(raw: RawCollectionItem): BcItemType | null {
  if (raw.tralbum_type === 'a' || raw.tralbum_type === 't') return raw.tralbum_type;
  if (raw.item_type === 'album') return 'a';
  if (raw.item_type === 'track') return 't';
  const url = raw.tralbum_url ?? raw.item_url ?? '';
  if (url.includes('/track/')) return 't';
  if (url.includes('/album/')) return 'a';
  return null;
}

function buildCoverUrl(raw: RawCollectionItem): string | null {
  if (raw.item_art_url) return raw.item_art_url;
  if (raw.item_art_id) return `https://f4.bcbits.com/img/a${raw.item_art_id}_2.jpg`;
  return null;
}

function rawItemToCollectionItem(raw: RawCollectionItem): BcCollectionItem | null {
  const url = raw.tralbum_url ?? raw.item_url;
  const title = raw.item_title;
  const itemType = deriveItemType(raw);
  const itemId = raw.tralbum_id ?? raw.item_id ?? null;
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
    labelName: raw.label ?? null,
    bandId: raw.band_id ?? null,
    coverUrl: buildCoverUrl(raw),
    purchasedAt: raw.purchased ?? null,
    rawJson: JSON.stringify(raw),
  };
}

export function parseProfileBlob(html: string): ProfileBlob | null {
  const m = PAGEDATA_RE.exec(html);
  if (!m) return null;
  let blob: PagedataBlob;
  try {
    blob = JSON.parse(htmlEntityDecode(m[1])) as PagedataBlob;
  } catch {
    return null;
  }
  const fanData = blob.fan_data ?? {};
  const collection = blob.collection_data ?? {};
  const identitiesFan = blob.identities?.fan ?? {};

  const fanId = fanData.fan_id ?? fanData.id ?? identitiesFan.id ?? null;
  const fanUsername = fanData.username ?? identitiesFan.username ?? null;
  const displayName = fanData.name ?? null;
  const imageId = fanData.photo?.image_id ?? null;
  const imageUrl = imageId ? `https://f4.bcbits.com/img/${imageId}_5.jpg` : null;
  const bio = fanData.bio ?? null;
  const location = fanData.location ?? null;
  const websiteUrl = fanData.website_url ?? null;
  const followersCount = fanData.followers_count ?? null;
  const followingBandsCount = fanData.following_bands_count ?? null;
  const itemCount = collection.item_count ?? null;
  const lastToken = collection.last_token ?? null;

  // bandcamp moved most items into item_cache.collection, but some payloads
  // still carry rows in collection_data.items. Resolve each sequence key
  // against both maps so partial overlap or transition state can't drop rows.
  const itemSourcePrimary: Record<string, RawCollectionItem> = blob.item_cache?.collection ?? {};
  const itemSourceFallback: Record<string, RawCollectionItem> = collection.items ?? {};

  const initialItems: BcCollectionItem[] = [];
  if (collection.sequence) {
    for (const key of collection.sequence) {
      const raw = itemSourcePrimary[key] ?? itemSourceFallback[key];
      if (!raw) continue;
      const item = rawItemToCollectionItem(raw);
      if (item) initialItems.push(item);
    }
  }

  return {
    fanId,
    fanUsername,
    displayName,
    imageId,
    imageUrl,
    bio,
    location,
    websiteUrl,
    followersCount,
    followingBandsCount,
    itemCount,
    lastToken,
    initialItems,
  };
}

const INLINE_FAN_ID_RE = /"fanId":\s*(\d+)/;
const INLINE_FAN_USERNAME_RE = /"fanUsername":"([a-zA-Z0-9_\-]+)"/;

/**
 * The bandcamp homepage no longer carries a full pagedata blob, but the
 * navbar component embeds the logged-in fan's id and username inline as
 * JSON. We harvest both with a quick regex pair (works on encoded and
 * decoded HTML).
 */
export function parseHomepageFanIdentity(
  html: string,
): { fanId: number | null; fanUsername: string | null } {
  const decoded = htmlEntityDecode(html);
  const idMatch = INLINE_FAN_ID_RE.exec(decoded);
  const userMatch = INLINE_FAN_USERNAME_RE.exec(decoded);
  return {
    fanId: idMatch ? Number(idMatch[1]) : null,
    fanUsername: userMatch ? userMatch[1] : null,
  };
}

export function rawCollectionPageToItems(payload: {
  items?: RawCollectionItem[];
  last_token?: string;
  more_available?: boolean;
}): BcCollectionPage {
  const items = (payload.items ?? [])
    .map(rawItemToCollectionItem)
    .filter((item): item is BcCollectionItem => item !== null);
  return {
    items,
    lastToken: payload.last_token ?? null,
    moreAvailable: payload.more_available ?? false,
    collectionTotal: null,
  };
}
