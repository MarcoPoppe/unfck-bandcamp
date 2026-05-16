import { getStoredMainAuth } from '../auth/store';
import { extractRefTokenFromSessionCookie, parseTralbumMeta } from './parse_tralbum_meta';
import { BC_USER_AGENT } from './http';

export interface BcWriteResult {
  ok: boolean;
  error?: string;
}

const ITEM_TYPE_FOR_WISHLIST = { t: 'track', a: 'album' } as const;

interface FetchedTralbum {
  html: string;
  canonicalHost: string;
  refreshedCookie: string;
}

/**
 * GET the tralbum page with the main-auth cookie attached so the response
 * carries the user-specific crumbs and so the Set-Cookie reply contains a
 * fresh ref_token in its session array. We capture the redirected URL
 * because custom-domain artists (`example.com`) need the canonical host for
 * the subsequent POST to land on the right vhost.
 */
async function fetchTralbumWithAuth(
  bcUrl: string,
  cookieString: string,
): Promise<FetchedTralbum> {
  const res = await fetch(bcUrl, {
    method: 'GET',
    headers: {
      Cookie: cookieString,
      'User-Agent': BC_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`tralbum ${bcUrl} returned ${res.status}`);
  }
  const html = await res.text();
  const canonicalHost = new URL(res.url).host;
  // Node fetch's headers.get('set-cookie') folds multiple Set-Cookie lines
  // into one comma-separated string that we can't reparse. getSetCookie()
  // is the correct API (Node 19+) and returns each cookie as its own
  // entry; we join them with '; ' so they read like a regular Cookie
  // header. ref_token lives in the refreshed `session` cookie's r:[…]
  // array — without it cart-add comes back with resync:true and the item
  // is silently dropped.
  const maybeHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const refreshedCookie =
    typeof maybeHeaders.getSetCookie === 'function'
      ? maybeHeaders.getSetCookie().join('; ')
      : (res.headers.get('set-cookie') ?? cookieString);
  return { html, canonicalHost, refreshedCookie };
}

export async function addToBcWishlist(bcUrl: string): Promise<BcWriteResult> {
  const main = getStoredMainAuth();
  if (!main) return { ok: false, error: 'main_auth_missing' };

  let tralbum: FetchedTralbum;
  try {
    tralbum = await fetchTralbumWithAuth(bcUrl, main.cookieString);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'tralbum_fetch_failed' };
  }

  let meta;
  try {
    meta = parseTralbumMeta(tralbum.html);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'parse_failed' };
  }
  if (!meta.crumbs.collect_item_cb) {
    return { ok: false, error: 'main_auth_missing_crumbs' };
  }

  const refToken = extractRefTokenFromSessionCookie(tralbum.refreshedCookie);

  const body = new URLSearchParams({
    fan_id: String(main.fanId),
    item_id: String(meta.itemId),
    item_type: ITEM_TYPE_FOR_WISHLIST[meta.itemType],
    band_id: String(meta.bandId),
    ref_token: refToken,
    crumb: meta.crumbs.collect_item_cb,
  });

  const res = await fetch(`https://${tralbum.canonicalHost}/collect_item_cb`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: main.cookieString,
      'User-Agent': BC_USER_AGENT,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Origin: `https://${tralbum.canonicalHost}`,
      Referer: bcUrl,
    },
    body,
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'main_auth_expired' };
  }
  if (!res.ok) {
    return { ok: false, error: `bc_status_${res.status}` };
  }
  return { ok: true };
}

export async function removeFromBcWishlist(bcUrl: string): Promise<BcWriteResult> {
  const main = getStoredMainAuth();
  if (!main) return { ok: false, error: 'main_auth_missing' };

  let tralbum: FetchedTralbum;
  try {
    tralbum = await fetchTralbumWithAuth(bcUrl, main.cookieString);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'tralbum_fetch_failed' };
  }

  let meta;
  try {
    meta = parseTralbumMeta(tralbum.html);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'parse_failed' };
  }
  if (!meta.crumbs.uncollect_item_cb) {
    return { ok: false, error: 'main_auth_missing_crumbs' };
  }

  const body = new URLSearchParams({
    fan_id: String(main.fanId),
    item_id: String(meta.itemId),
    item_type: ITEM_TYPE_FOR_WISHLIST[meta.itemType],
    band_id: String(meta.bandId),
    crumb: meta.crumbs.uncollect_item_cb,
  });

  const res = await fetch(`https://${tralbum.canonicalHost}/uncollect_item_cb`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: main.cookieString,
      'User-Agent': BC_USER_AGENT,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Origin: `https://${tralbum.canonicalHost}`,
      Referer: bcUrl,
    },
    body,
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'main_auth_expired' };
  }
  if (!res.ok) {
    return { ok: false, error: `bc_status_${res.status}` };
  }
  return { ok: true };
}
