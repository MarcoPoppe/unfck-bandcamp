/**
 * Supporter lookups span two tralbums, not one.
 *
 * Bandcamp ships the same audio under separate tralbums: the release
 * (`tralbum_type='a'`, bc_album_id) and the track permalink
 * (`tralbum_type='t'`, bc_track_id). Collectors attach to whichever tralbum
 * the buyer actually purchased, so each variant carries its own list and one
 * of them is regularly empty. Asking only the album is how
 * "Kandelaki (Extended Mix)" showed "No supporters listed yet" while
 * bandcamp.com displayed five (album: 0 collectors, track: 5).
 *
 * `runBestOfSupporters` already crawls both variants; these helpers give the
 * per-track supporters route the same reach while keeping its paginated
 * cursor contract intact. The cursor is variant-scoped (`v<index>~<bcToken>`)
 * so a single opaque token can walk album pages first and then continue into
 * the track pages.
 */

export interface SupporterVariant {
  tralbumType: 'a' | 't';
  tralbumId: number;
}

export interface SupporterCursor {
  variantIndex: number;
  bcToken: string | null;
}

const CURSOR_RE = /^v(\d+)~([\s\S]*)$/;

/** Album variant first (Bandcamp favours release-form items), track second. */
export function buildSupporterVariants(row: {
  bcTrackId: number | null;
  bcAlbumId: number | null;
}): SupporterVariant[] {
  const variants: SupporterVariant[] = [];
  if (row.bcAlbumId) variants.push({ tralbumType: 'a', tralbumId: row.bcAlbumId });
  if (row.bcTrackId) variants.push({ tralbumType: 't', tralbumId: row.bcTrackId });
  return variants;
}

/**
 * Decode a cursor handed back to us by the client. Returns `null` when the
 * cursor points past the last variant, which the route answers with a final
 * empty page rather than silently restarting at variant 0 (that would loop the
 * client's auto-pagination over the same names).
 *
 * A token that is not variant-scoped is treated as a raw Bandcamp token for
 * variant 0, so cursors issued by the previous single-variant implementation
 * keep working.
 */
export function parseSupporterCursor(
  token: string | null | undefined,
  variantCount: number,
): SupporterCursor | null {
  if (!token) return { variantIndex: 0, bcToken: null };
  const m = CURSOR_RE.exec(token);
  if (!m) return { variantIndex: 0, bcToken: token };
  const variantIndex = Number(m[1]);
  if (!Number.isInteger(variantIndex) || variantIndex >= variantCount) return null;
  return { variantIndex, bcToken: m[2] === '' ? null : m[2] };
}

/**
 * Decide where the walk continues after a fetched page: deeper into the
 * current variant, over to the next variant, or done. A variant is also
 * considered spent when Bandcamp claims more pages but hands out no cursor,
 * which would otherwise re-request the same page forever.
 */
export function nextSupporterCursor(input: {
  variantIndex: number;
  variantCount: number;
  moreAvailable: boolean;
  nextToken: string | null;
}): { nextToken: string | null; moreAvailable: boolean } {
  if (input.moreAvailable && input.nextToken) {
    return { nextToken: `v${input.variantIndex}~${input.nextToken}`, moreAvailable: true };
  }
  const next = input.variantIndex + 1;
  if (next < input.variantCount) {
    return { nextToken: `v${next}~`, moreAvailable: true };
  }
  return { nextToken: null, moreAvailable: false };
}
