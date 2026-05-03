import { bcPostJson } from './http';

export interface BcCollector {
  fanId: number;
  username: string;
  displayName: string | null;
  imageId: number | null;
  imageUrl: string | null;
}

interface CollectorsApiResponse {
  results: Array<{
    fan_id: number;
    username: string;
    name?: string;
    image_id?: number | null;
    token?: string;
  }>;
  more_available: boolean;
}

export interface CollectorsPage {
  collectors: BcCollector[];
  moreAvailable: boolean;
  nextToken: string | null;
}

const COLLECTORS_URL = 'https://bandcamp.com/api/tralbumcollectors/2/thumbs';

function avatarUrl(imageId: number | null | undefined): string | null {
  if (!imageId) return null;
  return `https://f4.bcbits.com/img/${imageId}_42.jpg`;
}

/**
 * Fetch a page of supporters (collectors) for a given tralbum (track or
 * album). Bandcamp paginates this in pages of ~80 by default; pass the
 * previous response's `last_token` to advance.
 */
export async function fetchCollectorsPage(input: {
  tralbumType: 'a' | 't';
  tralbumId: number;
  cookieString: string;
  count?: number;
  token?: string | null;
}): Promise<CollectorsPage> {
  // Verified against the live endpoint: body-key is `token`, and the cursor
  // for the next page is the `token` field of the LAST result in the
  // response (the API does not return a top-level `last_token`).
  const body = {
    tralbum_type: input.tralbumType,
    tralbum_id: input.tralbumId,
    count: input.count ?? 80,
    token: input.token ?? null,
  };
  const res = await bcPostJson<CollectorsApiResponse>(COLLECTORS_URL, body, {
    cookieString: input.cookieString,
  });
  const results = res.results ?? [];
  const collectors: BcCollector[] = results.map((r) => ({
    fanId: r.fan_id,
    username: r.username,
    displayName: r.name ?? null,
    imageId: r.image_id ?? null,
    imageUrl: avatarUrl(r.image_id ?? null),
  }));
  const lastResult = results[results.length - 1];
  const nextToken = res.more_available && lastResult?.token ? lastResult.token : null;
  return {
    collectors,
    moreAvailable: !!res.more_available,
    nextToken,
  };
}
