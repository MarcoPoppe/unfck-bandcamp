import type { BcItemType } from './types';

export interface BcTrackInfo {
  bcTrackId: number;
  title: string;
  trackNumber: number | null;
  durationSeconds: number | null;
  streamUrl: string | null;
  bcUrl: string;
}

export interface BcReleaseInfo {
  bcReleaseId: number;
  releaseType: BcItemType;
  releaseTitle: string;
  artistName: string | null;
  artistUrl: string | null;
  albumTitle: string | null;
  albumUrl: string | null;
  coverUrl: string | null;
  tracks: BcTrackInfo[];
}

interface RawTrackInfo {
  track_id?: number;
  id?: number;
  title?: string;
  track_num?: number;
  duration?: number;
  file?: Record<string, string> | null;
  title_link?: string;
}

interface RawTralbumCurrent {
  id?: number;
  title?: string;
  type?: 'track' | 'album';
  artist?: string;
  art_id?: number;
  band_id?: number;
  release_date?: string;
  album_title?: string;
  track_number?: number;
}

interface RawTralbumData {
  current?: RawTralbumCurrent;
  url?: string;
  artist?: string;
  album_url?: string | null;
  album_title?: string | null;
  trackinfo?: RawTrackInfo[];
  art_id?: number;
}

function htmlEntityDecode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const TRALBUM_DATA_ATTR_RE = /\bdata-tralbum="([^"]+)"/;
const LEGACY_TRALBUM_RE = /(?:var|window\.)\s+TralbumData\s*=\s*(\{[\s\S]*?\});/;

export function parseTralbumData(html: string): RawTralbumData | null {
  const attrMatch = TRALBUM_DATA_ATTR_RE.exec(html);
  if (attrMatch) {
    try {
      return JSON.parse(htmlEntityDecode(attrMatch[1])) as RawTralbumData;
    } catch {
      // fall through to legacy
    }
  }
  const legacyMatch = LEGACY_TRALBUM_RE.exec(html);
  if (legacyMatch) {
    try {
      return JSON.parse(legacyMatch[1]) as RawTralbumData;
    } catch {
      return null;
    }
  }
  return null;
}

const PAGEDATA_RE = /<div[^>]+id="pagedata"[^>]+data-blob="([^"]+)"/;

interface PagedataReleaseBlob {
  fan_tralbum_data?: { tralbum_id?: number; tralbum_type?: string };
  url_data?: { artist_url?: string };
}

export function parseReleasePagedata(html: string): PagedataReleaseBlob | null {
  const m = PAGEDATA_RE.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(htmlEntityDecode(m[1])) as PagedataReleaseBlob;
  } catch {
    return null;
  }
}

const ART_ID_RE = /"art_id":\s*(\d+)/;
const BAND_NAME_LINK_RE = /<p\s+id="band-name-location"[\s\S]*?<span[^>]+class="title"[^>]*>([^<]+)<\/span>/;
const ALT_ARTIST_RE = /<span\s+itemprop="byArtist"[^>]*>\s*<a[^>]+>([^<]+)<\/a>/;

function extractArtistName(html: string, t: RawTralbumData): string | null {
  if (t.artist) return t.artist;
  if (t.current?.artist) return t.current.artist;
  const m = BAND_NAME_LINK_RE.exec(html) ?? ALT_ARTIST_RE.exec(html);
  return m ? m[1].trim() : null;
}

function extractCoverUrl(html: string, t: RawTralbumData): string | null {
  const aid = t.art_id ?? t.current?.art_id;
  if (aid) return `https://f4.bcbits.com/img/a${aid}_2.jpg`;
  const m = ART_ID_RE.exec(html);
  if (m) return `https://f4.bcbits.com/img/a${m[1]}_2.jpg`;
  return null;
}

export function parseReleasePage(html: string, baseUrl: string): BcReleaseInfo | null {
  const tralbum = parseTralbumData(html);
  if (!tralbum) return null;
  const current = tralbum.current ?? {};
  const releaseId = current.id ?? null;
  const releaseTypeStr = current.type ?? null;
  if (!releaseId || !releaseTypeStr) return null;
  const releaseType: BcItemType = releaseTypeStr === 'album' ? 'a' : 't';
  const releaseTitle = current.title ?? '';
  const artistName = extractArtistName(html, tralbum);
  const coverUrl = extractCoverUrl(html, tralbum);

  let artistUrl: string | null = null;
  try {
    const u = new URL(baseUrl);
    artistUrl = `${u.protocol}//${u.host}`;
  } catch {
    // ignore
  }

  let albumUrl: string | null = null;
  if (releaseType === 't' && tralbum.album_url && artistUrl) {
    albumUrl = `${artistUrl}${tralbum.album_url}`;
  } else if (releaseType === 'a') {
    albumUrl = baseUrl;
  }

  const trackinfo = tralbum.trackinfo ?? [];
  const tracks: BcTrackInfo[] = [];

  // For single-track releases, bandcamp sometimes omits trackinfo and only
  // exposes the track via current.{id,title,track_number}. Fall back to that.
  if (trackinfo.length === 0 && releaseType === 't' && current.id && current.title) {
    tracks.push({
      bcTrackId: current.id,
      title: current.title,
      trackNumber: current.track_number ?? 1,
      durationSeconds: null,
      streamUrl: null,
      bcUrl: baseUrl,
    });
  }

  for (const raw of trackinfo) {
    const trackId = raw.track_id ?? raw.id;
    const title = raw.title;
    if (!trackId || !title) continue;
    const stream = raw.file?.['mp3-128'] ?? null;
    const trackBcUrl =
      raw.title_link && artistUrl
        ? `${artistUrl}${raw.title_link}`
        : releaseType === 't'
          ? baseUrl
          : `${artistUrl ?? ''}/track/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    tracks.push({
      bcTrackId: trackId,
      title,
      trackNumber: raw.track_num ?? null,
      durationSeconds: raw.duration ?? null,
      streamUrl: stream,
      bcUrl: trackBcUrl,
    });
  }

  return {
    bcReleaseId: releaseId,
    releaseType,
    releaseTitle,
    artistName,
    artistUrl,
    albumTitle: tralbum.album_title ?? (releaseType === 'a' ? releaseTitle : null),
    albumUrl,
    coverUrl,
    tracks,
  };
}
