import { createHash } from 'node:crypto';
import { getStoredMainAuth } from '../auth/store';
import { extractRefTokenFromSessionCookie, parseTralbumMeta } from './parse_tralbum_meta';
import { BC_USER_AGENT } from './http';

export interface CartAddOpts {
  /**
   * Sync-run id used to stabilize the request_id Bandcamp uses for dedup.
   * Combined with itemKey so retrying the same item in the same run yields
   * the same request_id (idempotent) but a fresh run gets a new one.
   */
  runId: number;
  /** `<itemType>:<itemId>` — same form as the wishlist mirror key. */
  itemKey: string;
  /** Current size of the user's cart on Bandcamp; informational only. */
  cartLength?: number;
  /** Incrementing counter used by Bandcamp's client. Out-of-sync values
   * trigger `resync: true` in the response and silently drop the add. */
  syncNum?: number;
  /**
   * Override the minimum price for PWYW items. The mirror always pays the
   * minimum because the user hasn't expressed willingness for more; callers
   * who want to honour a higher target pass it here.
   */
  unitPriceOverride?: number;
}

export interface CartAddResult {
  ok: boolean;
  error?: string;
  /** True when Bandcamp asked the client to re-sync its cart state. The
   * bulk adder logs this but proceeds; the next reconcile picks it up. */
  resyncRequested?: boolean;
}

const CART_WIRE_TYPE = { t: 't', a: 'a' } as const;

/**
 * Reads every Set-Cookie header from the response. Node fetch's
 * `headers.get('set-cookie')` collapses multiple cookies into one comma
 * separated string that is no longer parseable; `getSetCookie()` is the
 * correct API (Node 19+) and returns each cookie as its own entry.
 */
function readSetCookies(res: Response): string {
  const maybe = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof maybe.getSetCookie === 'function') {
    return maybe.getSetCookie().join('; ');
  }
  // Fallback for older runtimes that don't expose getSetCookie.
  return res.headers.get('set-cookie') ?? '';
}

interface CartItemFromResponse {
  item_id?: number;
  item_type?: string;
}

interface CartDataFromResponse {
  items?: CartItemFromResponse[];
  cart_quantity?: number;
}

interface CartCbResponse {
  resync?: boolean;
  error?: unknown;
  cart_data?: CartDataFromResponse;
  cart_quantity?: number;
}

/**
 * Add a single item to the Bandcamp cart using main-auth. Caller is
 * responsible for throttling between calls (see cart_bulk_add.ts).
 *
 * Failure semantics for `resync: true`:
 * Bandcamp returns HTTP 200 with `resync: true` when the client's
 * `sync_num` or `ref_token` doesn't match the server's expectation. The
 * frontend interprets this as "reset local cart to the server snapshot"
 * — meaning the add was NOT persisted. We treat it as a failure and
 * surface it so the bulk adder can react (e.g. abort on the first
 * resync, since further attempts with the same stale parameters will
 * keep getting rejected).
 */
export async function addToBcCart(bcUrl: string, opts: CartAddOpts): Promise<CartAddResult> {
  const main = getStoredMainAuth();
  if (!main) return { ok: false, error: 'main_auth_missing' };

  let res: Response;
  try {
    res = await fetch(bcUrl, {
      method: 'GET',
      headers: {
        Cookie: main.cookieString,
        'User-Agent': BC_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'tralbum_fetch_failed' };
  }
  if (!res.ok) {
    return { ok: false, error: `tralbum_status_${res.status}` };
  }
  const html = await res.text();
  const canonicalHost = new URL(res.url).host;

  let meta;
  try {
    meta = parseTralbumMeta(html);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'parse_failed' };
  }

  // Build the cookie string we send back: stored cookie ⊕ any session
  // refresh Bandcamp emitted on the tralbum view. ref_token lives in the
  // session cookie's r:[…] array; without it Bandcamp accepts the add
  // request shape but silently drops it (resync: true).
  const refreshedCookieString = readSetCookies(res);
  const refToken = extractRefTokenFromSessionCookie(
    refreshedCookieString || main.cookieString,
  );
  // Prefer the freshly-issued session cookie for the POST so Bandcamp
  // accepts the ref_token we just read. Stored cookie remains the
  // identity carrier (the new Set-Cookie usually only refreshes session).
  const postCookieHeader = refreshedCookieString
    ? `${main.cookieString}; ${refreshedCookieString}`
    : main.cookieString;

  if (!refToken) {
    return { ok: false, error: 'ref_token_missing' };
  }

  const unitPrice = Math.max(opts.unitPriceOverride ?? meta.minPrice, meta.minPrice);
  // Deterministic request id per (run, item): retrying the same item in the
  // same run hits Bandcamp's dedup; a new run gets a fresh one.
  const reqId = createHash('sha1').update(`${opts.runId}:${opts.itemKey}`).digest('hex').slice(0, 16);

  const body = new URLSearchParams({
    req: 'add',
    local_id: `0.${createHash('sha1').update(`${opts.runId}:${opts.itemKey}:local`).digest('hex').slice(0, 16)}`,
    item_type: CART_WIRE_TYPE[meta.itemType],
    item_id: String(meta.itemId),
    unit_price: String(unitPrice),
    quantity: '1',
    option_id: '',
    discount_id: '',
    discount_type: '',
    download_type: '',
    download_id: '',
    purchase_note: '',
    notify_me: '',
    notify_me_label: '',
    band_id: String(meta.bandId),
    releases: '',
    ip_country_code: 'DE',
    associated_license_id: '',
    checkout_now: '',
    shipping_exception_mode: '',
    is_cardable: 'true',
    cart_length: String(opts.cartLength ?? 0),
    fan_id: String(main.fanId),
    ref_token: refToken,
    client_id: '',
    sync_num: String(opts.syncNum ?? 1),
    req_id: reqId,
  });

  const r = await fetch(`https://${canonicalHost}/cart/cb`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: postCookieHeader,
      'User-Agent': BC_USER_AGENT,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Origin: `https://${canonicalHost}`,
      Referer: bcUrl,
    },
    body,
  });
  if (r.status === 401 || r.status === 403) {
    return { ok: false, error: 'main_auth_expired' };
  }
  if (r.status === 429) {
    return { ok: false, error: 'rate_limited' };
  }
  if (!r.ok) {
    return { ok: false, error: `bc_status_${r.status}` };
  }
  let payload: CartCbResponse = {};
  try {
    payload = (await r.json()) as CartCbResponse;
  } catch {
    // Empty body — Bandcamp returns it sometimes for accepted adds.
    return { ok: true };
  }
  if (payload.error) {
    return {
      ok: false,
      error: typeof payload.error === 'string' ? payload.error : 'bc_error',
    };
  }
  if (payload.resync) {
    // resync:true means the add was rejected because our sync_num /
    // ref_token didn't satisfy Bandcamp. Continuing to push with the same
    // stale values keeps getting rejected, so the bulk adder should treat
    // this as a failure and (in the cleanest path) abort.
    return {
      ok: false,
      error: 'bc_resync_rejected',
      resyncRequested: true,
    };
  }
  return { ok: true };
}
