import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { __pageFromPayloadForTests as pageFromPayload } from './fan_wishlist';

const responseJson = readFileSync('docs/fixtures/wishlist-shape/wishlist_items.json', 'utf8');

describe('fan_wishlist page parser', () => {
  it('parses the captured fixture into a BcCollectionPage', () => {
    const payload = JSON.parse(responseJson);
    const page = pageFromPayload(payload);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(20);
    expect(page.moreAvailable).toBe(true);
    expect(page.lastToken).toMatch(/^\d+:\d+:[ta]::/);
  });

  it('produces items with both album and track entries', () => {
    const payload = JSON.parse(responseJson);
    const page = pageFromPayload(payload);
    const types = new Set(page.items.map((i) => i.bcItemType));
    // The captured fixture (ponybarker wishlist) contains both.
    expect(types.has('a')).toBe(true);
    expect(types.has('t')).toBe(true);
  });

  it('every item has required identification fields', () => {
    const payload = JSON.parse(responseJson);
    const page = pageFromPayload(payload);
    for (const item of page.items) {
      expect(item.bcItemId).toBeGreaterThan(0);
      expect(['t', 'a']).toContain(item.bcItemType);
      expect(item.bcUrl).toMatch(/^https:\/\//);
      expect(item.title.length).toBeGreaterThan(0);
    }
  });

  it('rawJson round-trips so we can later re-parse if shape evolves', () => {
    const payload = JSON.parse(responseJson);
    const page = pageFromPayload(payload);
    for (const item of page.items) {
      expect(() => JSON.parse(item.rawJson)).not.toThrow();
    }
  });
});
