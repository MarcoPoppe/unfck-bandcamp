/**
 * URL detector for the "Look up anything" affordance. Pure function: in
 * = whatever the user pasted, out = a tag describing what kind of thing
 * the input points at.
 *
 * The caller routes on `kind`:
 *   - `track`   -> existing lookupTrack pipeline -> /track/[bcTrackId]
 *   - `album`   -> existing lookupTrack pipeline (it imports the whole
 *                 release) -> /track/[firstTrackBcId] showing siblings
 *   - `band`    -> /api/lookup/band -> /artist/[bcBandId]
 *   - `fan`     -> /u/[username]
 *   - `numeric` -> treated as a numeric BC track id (legacy behaviour)
 *   - `unknown` -> surface an error in the UI
 */
export type LookupTarget =
  | { kind: 'track'; bcUrl: string }
  | { kind: 'album'; bcUrl: string }
  | { kind: 'band'; bcUrl: string }
  | { kind: 'fan'; username: string }
  | { kind: 'numeric'; bcTrackId: number }
  | { kind: 'unknown'; reason: string };

const NUMERIC_RE = /^\d+$/;
const FAN_PATH_RE = /^\/([A-Za-z0-9_-]+)\/?$/;
const RESERVED_FAN_SEGMENTS = new Set([
  'artists',
  'discover',
  'login',
  'signup',
  'help',
  'about',
  'jobs',
  'tag',
  'campaigns',
  'terms',
]);

export function detectLookupTarget(rawInput: string): LookupTarget {
  const input = rawInput.trim();
  if (!input) {
    return { kind: 'unknown', reason: 'empty input' };
  }

  if (NUMERIC_RE.test(input)) {
    return { kind: 'numeric', bcTrackId: Number(input) };
  }

  // Allow paste without protocol -- synthesise https so URL parse succeeds.
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return { kind: 'unknown', reason: 'not a valid URL' };
  }
  const host = url.host.toLowerCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // bandcamp.com itself: only used for fan profiles.
  if (host === 'bandcamp.com' || host === 'www.bandcamp.com') {
    const fan = url.pathname.match(FAN_PATH_RE);
    if (fan) {
      const segment = fan[1];
      if (!RESERVED_FAN_SEGMENTS.has(segment.toLowerCase())) {
        return { kind: 'fan', username: segment };
      }
    }
    return { kind: 'unknown', reason: 'bandcamp.com path is not a fan handle' };
  }

  // *.bandcamp.com or a custom domain pointing at a band / label page.
  // Track and album have explicit prefixes; everything else is the band
  // root (or its /music subpage).
  const baseUrl = `${url.protocol}//${url.host}`;
  if (path.startsWith('/track/')) {
    return { kind: 'track', bcUrl: `${baseUrl}${path}` };
  }
  if (path.startsWith('/album/')) {
    return { kind: 'album', bcUrl: `${baseUrl}${path}` };
  }
  if (path === '/' || path === '/music' || path === '/releases') {
    return { kind: 'band', bcUrl: baseUrl };
  }
  // Anything else under the band's domain (merch, lyrics, EPK, ...) we
  // can't navigate into yet, so treat as unknown rather than silently
  // mis-routing.
  return {
    kind: 'unknown',
    reason: `path "${url.pathname}" is not a track / album / band root`,
  };
}
