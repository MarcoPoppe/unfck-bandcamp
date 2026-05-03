/**
 * Decode the HTML entities Bandcamp emits in tile titles, attribute
 * blobs and other inline-rendered strings. Covers the common named
 * entities plus numeric (decimal and hex) entity references — Bandcamp
 * encodes apostrophes as `&#39;` not `&apos;`, so the named-only
 * variant we used to ship missed Marco's "Who's God To You?" titles.
 */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    // & last so we don't accidentally re-decode an entity that ends in &amp;
    .replace(/&amp;/g, '&');
}
