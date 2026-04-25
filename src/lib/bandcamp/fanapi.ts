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
