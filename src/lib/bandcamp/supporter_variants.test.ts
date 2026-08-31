import { describe, it, expect } from 'vitest';
import {
  buildSupporterVariants,
  parseSupporterCursor,
  nextSupporterCursor,
} from './supporter_variants';

describe('buildSupporterVariants', () => {
  it('yields album first, then track, when the track belongs to a release', () => {
    expect(buildSupporterVariants({ bcTrackId: 3890319024, bcAlbumId: 2559850597 })).toEqual([
      { tralbumType: 'a', tralbumId: 2559850597 },
      { tralbumType: 't', tralbumId: 3890319024 },
    ]);
  });

  it('yields only the track variant for a standalone single', () => {
    expect(buildSupporterVariants({ bcTrackId: 123, bcAlbumId: null })).toEqual([
      { tralbumType: 't', tralbumId: 123 },
    ]);
  });

  it('yields only the album variant when the track id is missing', () => {
    expect(buildSupporterVariants({ bcTrackId: null, bcAlbumId: 777 })).toEqual([
      { tralbumType: 'a', tralbumId: 777 },
    ]);
  });

  it('yields nothing when neither id is known', () => {
    expect(buildSupporterVariants({ bcTrackId: null, bcAlbumId: null })).toEqual([]);
  });
});

describe('parseSupporterCursor', () => {
  it('starts at the first variant when no cursor is given', () => {
    expect(parseSupporterCursor(null, 2)).toEqual({ variantIndex: 0, bcToken: null });
    expect(parseSupporterCursor('', 2)).toEqual({ variantIndex: 0, bcToken: null });
  });

  it('round-trips a variant-scoped cursor', () => {
    expect(parseSupporterCursor('v0~abc:1:2', 2)).toEqual({
      variantIndex: 0,
      bcToken: 'abc:1:2',
    });
  });

  it('treats an empty token as the start of that variant', () => {
    expect(parseSupporterCursor('v1~', 2)).toEqual({ variantIndex: 1, bcToken: null });
  });

  it('reports exhaustion when the variant index is out of range', () => {
    // Guards against an endless client loop: the route answers with an empty,
    // final page instead of silently restarting at variant 0.
    expect(parseSupporterCursor('v5~x', 2)).toBeNull();
  });

  it('accepts a bare Bandcamp token as a variant-0 cursor (backwards compatible)', () => {
    expect(parseSupporterCursor('1699999999:1234:a', 2)).toEqual({
      variantIndex: 0,
      bcToken: '1699999999:1234:a',
    });
  });
});

describe('nextSupporterCursor', () => {
  it('stays on the same variant while Bandcamp has more pages', () => {
    expect(
      nextSupporterCursor({
        variantIndex: 0,
        variantCount: 2,
        moreAvailable: true,
        nextToken: 'tok9',
      }),
    ).toEqual({ nextToken: 'v0~tok9', moreAvailable: true });
  });

  it('advances to the next variant once the current one runs dry', () => {
    // This is the whole point: an album with zero collectors must not end the
    // walk while the track permalink still has supporters.
    expect(
      nextSupporterCursor({
        variantIndex: 0,
        variantCount: 2,
        moreAvailable: false,
        nextToken: null,
      }),
    ).toEqual({ nextToken: 'v1~', moreAvailable: true });
  });

  it('ends the walk after the last variant', () => {
    expect(
      nextSupporterCursor({
        variantIndex: 1,
        variantCount: 2,
        moreAvailable: false,
        nextToken: null,
      }),
    ).toEqual({ nextToken: null, moreAvailable: false });
  });

  it('advances when Bandcamp claims more pages but hands out no cursor', () => {
    expect(
      nextSupporterCursor({
        variantIndex: 0,
        variantCount: 2,
        moreAvailable: true,
        nextToken: null,
      }),
    ).toEqual({ nextToken: 'v1~', moreAvailable: true });
  });
});
