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
 * The tokens themselves come in two shapes depending on the page kind:
 *   album page:  `<id>t<track_id>a<album_id>x<timestamp>`
 *   track page:  `<id>t<track_id>x<timestamp>`            (no a-segment)
 *   misc/search: `<id>s<sub>c<sub2>x<timestamp>`          (we ignore these)
 *
 * Returns the freshest tralbum ref_token (first match in the array order
 * Bandcamp returns, which is newest-first) or empty string when none is
 * present. Caller passes either the stored cookie OR the joined
 * Set-Cookie header from a fresh tralbum response — the latter is what
 * Bandcamp expects on cart-add (the ref_token must reference the just-
 * viewed tralbum, otherwise the add comes back as resync:true).
 */
export function extractRefTokenFromSessionCookie(rawCookie: string): string {
  // The cookie can appear multiple times in a joined Set-Cookie blob, with
  // the freshest value emitted last. We need the LAST `session=` entry.
  let lastSession: string | null = null;
  const sessionRe = /session=([^;,\s]+)/g;
  for (let m = sessionRe.exec(rawCookie); m; m = sessionRe.exec(rawCookie)) {
    lastSession = m[1];
  }
  if (!lastSession) return '';
  const decoded = decodeURIComponent(lastSession);
  const refArrayMatch = /r:\[([^\]]+)\]/.exec(decoded);
  if (!refArrayMatch) return '';
  const tokens = refArrayMatch[1]
    .split(',')
    .map((t) => t.trim().replace(/^"|"$/g, ''));
  // Accept any token whose body has a `t<digits>` segment — both album and
  // track tokens carry one. Reject `s<digits>c<digits>` search/misc
  // tokens.
  for (const t of tokens) {
    if (/^\w+t\d+(a\d+)?x\d+$/.test(t)) return t;
  }
  return '';
}
