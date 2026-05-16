/**
 * Extracts the metadata needed to issue collect_item_cb / uncollect_item_cb /
 * cart/cb against a Bandcamp tralbum page. Pulled from three places in the
 * HTML:
 *
 *  - data-band-id and data-tralbum attributes on the page-level wrappers,
 *    present on both anonymous and authenticated responses. Yields band_id,
 *    item_id, item_type, minimum_price.
 *  - data-crumbs attribute: only present on AUTHENTICATED responses. Contains
 *    the HMAC-signed crumbs for collect/uncollect. Anonymous fetches return
 *    an empty object here, so the caller MUST ship the request with a logged-
 *    in cookie (main-auth) before parsing.
 *  - ref_token: NOT in HTML. Bandcamp tracks ref tokens in the session cookie
 *    under r:[...] and updates the cookie via Set-Cookie on each tralbum view.
 *    The parser returns refToken: '' and leaves it to the writer to either
 *    harvest it from a freshly-refreshed cookie or send an empty value.
 *    Phase 0.2 confirmed cart-add accepts an empty/missing ref_token;
 *    collect/uncollect behaviour with empty ref_token is checked at runtime.
 */
export interface TralbumMeta {
  bandId: number;
  itemId: number;
  itemType: 't' | 'a';
  refToken: string;
  minPrice: number;
  crumbs: {
    collect_item_cb: string;
    uncollect_item_cb: string;
  };
}

const DATA_BAND_ID_RE = /data-band-id="(\d+)"/;
const DATA_TRALBUM_RE = /data-tralbum="([^"]+)"/;
const DATA_CRUMBS_RE = /data-crumbs="([^"]+)"/;

function htmlEntityDecode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

interface RawTralbum {
  id?: number;
  current?: {
    id?: number;
    type?: string;
    band_id?: number;
    minimum_price?: number;
    set_price?: number;
  };
  item_type?: string;
}

interface RawCrumbs {
  collect_item_cb?: string;
  uncollect_item_cb?: string;
}

export function parseTralbumMeta(html: string): TralbumMeta {
  const bandIdMatch = DATA_BAND_ID_RE.exec(html);
  const bandId = bandIdMatch ? Number(bandIdMatch[1]) : 0;

  const tralbumMatch = DATA_TRALBUM_RE.exec(html);
  if (!tralbumMatch) {
    throw new Error('parseTralbumMeta: no data-tralbum attribute on page');
  }
  let tralbum: RawTralbum;
  try {
    tralbum = JSON.parse(htmlEntityDecode(tralbumMatch[1])) as RawTralbum;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`parseTralbumMeta: data-tralbum JSON parse failed: ${msg}`);
  }
  const current = tralbum.current ?? {};
  const itemId = current.id ?? tralbum.id ?? 0;
  const rawType = current.type ?? tralbum.item_type ?? 'track';
  const itemType: 't' | 'a' = rawType === 'album' || rawType === 'a' ? 'a' : 't';
  const resolvedBandId = current.band_id ?? bandId;
  const minPrice = Number(current.minimum_price ?? current.set_price ?? 0);

  const crumbsMatch = DATA_CRUMBS_RE.exec(html);
  let crumbs: RawCrumbs = {};
  if (crumbsMatch) {
    try {
      crumbs = JSON.parse(htmlEntityDecode(crumbsMatch[1])) as RawCrumbs;
    } catch {
      crumbs = {};
    }
  }

  return {
    bandId: resolvedBandId,
    itemId,
    itemType,
    refToken: '',
    minPrice,
    crumbs: {
      collect_item_cb: crumbs.collect_item_cb ?? '',
      uncollect_item_cb: crumbs.uncollect_item_cb ?? '',
    },
  };
}

/**
 * Bandcamp's response Set-Cookie on a logged-in tralbum view rewrites the
 * session cookie with the new ref_token prepended to the r:[...] array.
 * Format (URL-decoded):
 *   1\tt:<created>\tr:["<token>","<older>","<older2>"]\tbp:1\tc:1
 * Where <token> matches \d+t\d+a\d+x\d+ (the ref_token we want).
 *
 * Returns the freshest ref_token or empty string when none is present.
 */
export function extractRefTokenFromSessionCookie(rawCookie: string): string {
  const sessionMatch = /session=([^;]+)/.exec(rawCookie);
  if (!sessionMatch) return '';
  const decoded = decodeURIComponent(sessionMatch[1]);
  const refArrayMatch = /r:\[([^\]]+)\]/.exec(decoded);
  if (!refArrayMatch) return '';
  const tokens = refArrayMatch[1]
    .split(',')
    .map((t) => t.trim().replace(/^"|"$/g, ''));
  for (const t of tokens) {
    if (/^\d+t\d+a\d+x\d+$/.test(t)) return t;
  }
  return '';
}
