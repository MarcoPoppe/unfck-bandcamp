import { BC_ORIGIN, bcGet } from './http';
import { parseProfileBlob } from './parse_collection';
import type { BcCollectionItem } from './types';

export interface DiggerProfile {
  fanId: number | null;
  username: string;
  displayName: string | null;
  imageUrl: string | null;
  bio: string | null;
  location: string | null;
  websiteUrl: string | null;
  followersCount: number | null;
  followingBandsCount: number | null;
  itemCount: number | null;
  initialItems: BcCollectionItem[];
}

/**
 * Pull a Bandcamp fan's public profile page so we can show their avatar,
 * stats, and the most recent slice of their collection.
 */
export async function fetchDiggerProfile(
  username: string,
  cookieString: string,
): Promise<DiggerProfile> {
  const slug = username.replace(/^[/@]+/, '').trim();
  if (!slug) throw new Error('curator username is empty');
  const res = await bcGet(`${BC_ORIGIN}/${encodeURIComponent(slug)}`, { cookieString });
  if (res.status !== 200) {
    throw new Error(`Bandcamp profile for ${slug} returned ${res.status}`);
  }
  const html = await res.text();
  const blob = parseProfileBlob(html);
  if (!blob) {
    throw new Error(`Bandcamp profile for ${slug} did not contain a parseable pagedata blob`);
  }
  return {
    fanId: blob.fanId,
    username: blob.fanUsername ?? slug,
    displayName: blob.displayName,
    imageUrl: blob.imageUrl,
    bio: blob.bio,
    location: blob.location,
    websiteUrl: blob.websiteUrl,
    followersCount: blob.followersCount,
    followingBandsCount: blob.followingBandsCount,
    itemCount: blob.itemCount,
    initialItems: blob.initialItems,
  };
}
