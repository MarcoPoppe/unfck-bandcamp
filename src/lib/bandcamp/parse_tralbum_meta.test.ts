import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractRefTokenFromSessionCookie, parseTralbumMeta } from './parse_tralbum_meta';

const html = readFileSync('docs/fixtures/tralbum-page.html', 'utf8');

describe('parseTralbumMeta', () => {
  it('extracts bandId, itemId, itemType from data-tralbum + data-band-id', () => {
    const meta = parseTralbumMeta(html);
    expect(meta.bandId).toBe(2593437335);
    expect(meta.itemId).toBe(2673726244);
    expect(meta.itemType).toBe('a');
  });

  it('extracts minPrice from current.minimum_price', () => {
    const meta = parseTralbumMeta(html);
    expect(meta.minPrice).toBeGreaterThan(0);
  });

  it('extracts collect_item_cb crumb in the canonical |endpoint|ts|sig format', () => {
    const meta = parseTralbumMeta(html);
    expect(meta.crumbs.collect_item_cb).toMatch(/^\|collect_item_cb\|\d+\|/);
  });

  it('extracts uncollect_item_cb crumb in the canonical |endpoint|ts|sig format', () => {
    const meta = parseTralbumMeta(html);
    expect(meta.crumbs.uncollect_item_cb).toMatch(/^\|uncollect_item_cb\|\d+\|/);
  });

  it('returns refToken="" because HTML never carries it (cookie-only)', () => {
    const meta = parseTralbumMeta(html);
    expect(meta.refToken).toBe('');
  });

  it('throws when data-tralbum is missing', () => {
    expect(() => parseTralbumMeta('<html><body>nothing here</body></html>')).toThrow(
      /no data-tralbum/,
    );
  });

  it('tolerates HTML without data-crumbs (anonymous fetch case)', () => {
    const minimal = '<html><div data-band-id="1"><div data-tralbum="{&quot;current&quot;:{&quot;id&quot;:42,&quot;type&quot;:&quot;track&quot;,&quot;minimum_price&quot;:1}}"></div></div></html>';
    const meta = parseTralbumMeta(minimal);
    expect(meta.itemId).toBe(42);
    expect(meta.itemType).toBe('t');
    expect(meta.crumbs.collect_item_cb).toBe('');
    expect(meta.crumbs.uncollect_item_cb).toBe('');
  });
});

describe('extractRefTokenFromSessionCookie', () => {
  it('pulls the freshest album ref token out of r:[...]', () => {
    const raw =
      'session=1%09t%3A1778905701%09r%3A%5B%22337922181t3127876176a2673726244x1778929730%22%2C%228443f0t3127876176x1778929712%22%5D%09bp%3A1%09c%3A1; identity=junk';
    expect(extractRefTokenFromSessionCookie(raw)).toBe(
      '337922181t3127876176a2673726244x1778929730',
    );
  });

  it('accepts a track-only ref token (no a<album_id> segment)', () => {
    const raw =
      'session=1%09t%3A1%09r%3A%5B%228443f0t3127876176x1778929712%22%5D%09bp%3A1';
    expect(extractRefTokenFromSessionCookie(raw)).toBe('8443f0t3127876176x1778929712');
  });

  it('skips search/misc tokens that have no t-segment', () => {
    const raw =
      'session=1%09t%3A1%09r%3A%5B%22526519257s0c0x1778929213%22%2C%2299t555a777x123%22%5D%09bp%3A1';
    expect(extractRefTokenFromSessionCookie(raw)).toBe('99t555a777x123');
  });

  it('returns empty string when session cookie is missing', () => {
    expect(extractRefTokenFromSessionCookie('identity=junk; foo=bar')).toBe('');
  });

  it('returns empty string when r:[] array is empty', () => {
    expect(extractRefTokenFromSessionCookie('session=1%09t%3A1%09r%3A%5B%5D%09bp%3A1')).toBe('');
  });

  it('picks the LAST session= when multiple Set-Cookie entries are joined', () => {
    // Mirrors getSetCookie().join('; ') with an old session followed by a refresh.
    const raw =
      'identity=keep; session=1%09t%3A100%09r%3A%5B%22aaa1t1x1%22%5D; session=1%09t%3A200%09r%3A%5B%22bbb2t2x2%22%5D; Path=/';
    expect(extractRefTokenFromSessionCookie(raw)).toBe('bbb2t2x2');
  });
});
