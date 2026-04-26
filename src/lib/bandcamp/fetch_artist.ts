import { bcGet, BC_USER_AGENT } from './http';

export interface BcArtistOverview {
  bcUrl: string;
  name: string;
  imageUrl: string | null;
  bcBandId: number | null;
  releases: BcArtistRelease[];
}

export interface BcArtistRelease {
  bcUrl: string;
  title: string;
  releaseType: 'album' | 'track';
  releaseDate: string | null;
  artId: number | null;
}

const BAND_NAME_RE = /<meta\s+property="og:title"\s+content="([^"]+)"/;
const OG_IMAGE_RE = /<meta\s+property="og:image"\s+content="([^"]+)"/;
const BAND_ID_RE = /"band_id":\s*(\d+)/;
// The /music page lists release tiles; each tile is rendered as an <li>
// containing an <a href="/album/..." or "/track/...">.
const RELEASE_TILE_RE =
  /<li[^>]+class="[^"]*music-grid-item[^"]*"[\s\S]*?<a\s+href="(\/(?:album|track)\/[^"#?]+)"[\s\S]*?(?:<p[^>]+class="title"[^>]*>([\s\S]*?)<\/p>|<\/li>)/g;
const ART_ID_ATTR_RE = /data-art-id="(\d+)"/g;

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
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

  const nameMatch = BAND_NAME_RE.exec(html);
  const imageMatch = OG_IMAGE_RE.exec(html);
  const bandIdMatch = BAND_ID_RE.exec(html);

  const releases: BcArtistRelease[] = [];
  RELEASE_TILE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RELEASE_TILE_RE.exec(html)) !== null) {
    const path = m[1];
    const titleHtml = m[2] ?? '';
    const releaseType = path.startsWith('/track/') ? 'track' : 'album';
    const fullUrl = `${artistBaseUrl.replace(/\/+$/, '')}${path}`;
    releases.push({
      bcUrl: fullUrl,
      title: stripTags(titleHtml) || path,
      releaseType,
      releaseDate: null,
      artId: null,
    });
  }
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
    bcBandId: bandIdMatch ? Number(bandIdMatch[1]) : null,
    releases,
  };
}

// Reference BC_USER_AGENT so we can later tune it without removing the import.
void BC_USER_AGENT;
