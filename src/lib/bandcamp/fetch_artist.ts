import { bcGet, BC_USER_AGENT, BC_ORIGIN } from './http';
import { decodeHtmlEntities } from './html_entities';

export interface BcArtistOverview {
  bcUrl: string;
  name: string;
  imageUrl: string | null;
  bcBandId: number | null;
  releases: BcArtistRelease[];
}

export interface BcArtistRelease {
  /** Slug-shaped URL when known from the HTML tile grid. Items that only
   * came from the band_details Mobile API (lazy-loaded ones) have null
   * here — the UI resolves them on demand via /api/lookup/by-id. */
  bcUrl: string | null;
  title: string;
  releaseType: 'album' | 'track';
  releaseDate: string | null;
  artId: number | null;
  /** Numeric BC item id (album_id or track_id) if known. Required to
   * resolve a tile that lacks bcUrl into a permalink. */
  bcItemId: number | null;
  /** Per-release artist when the band root is a label/imprint with many
   * artists. Mobile API gives us this; HTML-only items inherit the
   * band name. */
  artistName: string | null;
}

interface BandDetailsItem {
  item_id?: number;
  item_type?: 'album' | 'track';
  title?: string;
  art_id?: number;
  release_date?: string;
  artist_name?: string;
}

interface BandDetailsResponse {
  discography?: BandDetailsItem[];
}

const BAND_NAME_RE = /<meta\s+property="og:title"\s+content="([^"]+)"/;
const OG_IMAGE_RE = /<meta\s+property="og:image"\s+content="([^"]+)"/;
// `band_id` ships either as plain JSON in a <script> tag or as HTML-entity-
// encoded JSON inside a `data-blob` attribute (".bandcamp.com/music" pages
// use the latter most of the time). Match both forms so the artist root
// /label root paths both yield a numeric id.
const BAND_ID_RE_PLAIN = /"band_id":\s*(\d+)/;
const BAND_ID_RE_ENT = /&quot;band_id&quot;:\s*(\d+)/;
// The /music page lists release tiles; each tile is rendered as an <li>
// containing an <a href="/album/..." or "/track/...">.
// `<li>` tile pattern. Anchor on `data-item-id="<type>-<id>"` because
// that attribute is always present even when the class list spreads
// across multiple lines. Capture the inner href (slug URL) and title.
const RELEASE_TILE_RE =
  /<li\s+data-item-id="(album|track)-(\d+)"[\s\S]*?<a\s+href="(\/(?:album|track)\/[^"#?]+)"[\s\S]*?(?:<p[^>]+class="title"[^>]*>([\s\S]*?)<\/p>|<\/li>)/g;
const ART_ID_ATTR_RE = /data-art-id="(\d+)"/g;

function stripTags(s: string): string {
  return decodeHtmlEntities(
    s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' '),
  ).trim();
}

export async function fetchArtistOverview(
  artistBaseUrl: string,
  cookieString: string,
): Promise<BcArtistOverview> {
  // Bandcamp artist subdomains have a /music page listing every release.
  const url = artistBaseUrl.replace(/\/+$/, '') + '/music';
  const res = await bcGet(url, { cookieString });
  if (res.status !== 200) {
    throw new Error(`artist overview ${url} returned ${res.status}`);
  }
  const html = await res.text();

  const nameMatch = html.match(BAND_NAME_RE);
  const imageMatch = html.match(OG_IMAGE_RE);
  const bandIdMatch =
    html.match(BAND_ID_RE_PLAIN) ?? html.match(BAND_ID_RE_ENT);

  // Step 1: parse the HTML tile grid. Gives us slug-shaped URLs but only
  // for the ~16 above-the-fold items BC ships in the initial response.
  const htmlReleases = new Map<string, BcArtistRelease>();
  RELEASE_TILE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RELEASE_TILE_RE.exec(html)) !== null) {
    const itemType = m[1] as 'album' | 'track';
    const itemId = Number(m[2]);
    const path = m[3];
    const titleHtml = m[4] ?? '';
    const fullUrl = `${artistBaseUrl.replace(/\/+$/, '')}${path}`;
    const key = `${itemType}:${itemId}`;
    htmlReleases.set(key, {
      bcUrl: fullUrl,
      title: stripTags(titleHtml) || path,
      releaseType: itemType,
      releaseDate: null,
      artId: null,
      bcItemId: itemId,
      artistName: null,
    });
  }

  const bcBandId = bandIdMatch ? Number(bandIdMatch[1]) : null;

  // Step 2: ask the Mobile API for the full discography. Returns every
  // release the band has, including the lazy-loaded ones the HTML
  // doesn't render up front, plus per-item release_date and art_id.
  // Failure here is non-fatal — we fall back to the html-only list.
  let mobileReleases: BcArtistRelease[] = [];
  if (bcBandId) {
    try {
      mobileReleases = await fetchBandDetailsDiscography(bcBandId, cookieString);
    } catch {
      // ignore — we still have the html list
    }
  }

  // Step 3: merge by `<type>:<item_id>`. Mobile API entries that match
  // an HTML tile inherit its slug URL; mobile-only entries keep
  // bcUrl=null and the UI resolves on demand.
  const merged = new Map<string, BcArtistRelease>();
  for (const r of htmlReleases.values()) {
    if (r.bcItemId == null) continue;
    merged.set(`${r.releaseType}:${r.bcItemId}`, r);
  }
  for (const r of mobileReleases) {
    if (r.bcItemId == null) continue;
    const key = `${r.releaseType}:${r.bcItemId}`;
    const existing = merged.get(key);
    if (existing) {
      // HTML wins for slug URL + title text; mobile fills the gaps.
      merged.set(key, {
        ...existing,
        title: existing.title || r.title,
        releaseDate: existing.releaseDate ?? r.releaseDate,
        artId: existing.artId ?? r.artId,
        artistName: existing.artistName ?? r.artistName,
      });
    } else {
      merged.set(key, r);
    }
  }

  // Order: mobile API order is newest-first which matches what BC
  // displays. Fall back to htmlReleases insertion order for the items
  // it covered first.
  const orderKeys: string[] = [];
  for (const r of mobileReleases) {
    if (r.bcItemId != null) orderKeys.push(`${r.releaseType}:${r.bcItemId}`);
  }
  for (const r of htmlReleases.values()) {
    if (r.bcItemId == null) continue;
    const k = `${r.releaseType}:${r.bcItemId}`;
    if (!orderKeys.includes(k)) orderKeys.push(k);
  }
  const releases: BcArtistRelease[] = orderKeys
    .map((k) => merged.get(k))
    .filter((x): x is BcArtistRelease => !!x);

  // Layout-change detector: if NONE of our markers survived the parse,
  // bandcamp likely changed the page structure. Fail loud rather than
  // silently writing 0-release pages.
  if (!nameMatch && !imageMatch && !bandIdMatch && releases.length === 0) {
    throw new Error(
      `artist overview ${url} parsed but found no name/image/band_id/releases — possible bandcamp layout change`,
    );
  }

  return {
    bcUrl: artistBaseUrl,
    name: nameMatch ? stripTags(nameMatch[1]) : 'unknown',
    imageUrl: imageMatch ? imageMatch[1] : null,
    bcBandId,
    releases,
  };
}

async function fetchBandDetailsDiscography(
  bandId: number,
  cookieString: string,
): Promise<BcArtistRelease[]> {
  const apiUrl = `${BC_ORIGIN}/api/mobile/24/band_details?band_id=${bandId}`;
  const res = await bcGet(apiUrl, { cookieString });
  if (res.status !== 200) return [];
  const json = (await res.json()) as BandDetailsResponse;
  if (!Array.isArray(json.discography)) return [];
  return json.discography
    .map((d) => {
      const itemType = d.item_type === 'track' ? 'track' : 'album';
      const itemId = typeof d.item_id === 'number' ? d.item_id : null;
      if (!itemId) return null;
      return {
        bcUrl: null,
        title: d.title ?? '',
        releaseType: itemType as 'album' | 'track',
        releaseDate: d.release_date ?? null,
        artId: typeof d.art_id === 'number' ? d.art_id : null,
        bcItemId: itemId,
        artistName: d.artist_name ?? null,
      } as BcArtistRelease;
    })
    .filter((x): x is BcArtistRelease => x != null);
}

// Reference BC_USER_AGENT so we can later tune it without removing the import.
void BC_USER_AGENT;
