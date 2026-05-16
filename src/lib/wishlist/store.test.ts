import { describe, it, expect, beforeEach } from 'vitest';
import { addToWishlist, removeFromWishlist, isOwned, reopenWishlistItem } from './store';
import { getDb } from '../db';

describe('wishlist store (polymorphic)', () => {
  beforeEach(() => {
    getDb().prepare('DELETE FROM wishlist').run();
  });

  it('adds a track wishlist row', () => {
    addToWishlist({ bcItemType: 't', bcTrackId: 12345, bcUrl: 'https://x.bandcamp.com/track/a', title: 'A' });
    const row = getDb().prepare('SELECT * FROM wishlist WHERE bc_track_id=12345').get() as any;
    expect(row.bc_item_type).toBe('t');
    expect(row.mirror_state).toBe('local');
  });

  it('adds an album wishlist row', () => {
    addToWishlist({ bcItemType: 'a', bcAlbumId: 67890, bcUrl: 'https://x.bandcamp.com/album/b', title: 'B' });
    const row = getDb().prepare('SELECT * FROM wishlist WHERE bc_album_id=67890').get() as any;
    expect(row.bc_item_type).toBe('a');
  });

  it('rejects mixed track+album input', () => {
    expect(() =>
      addToWishlist({ bcItemType: 't', bcAlbumId: 1, bcUrl: 'x', title: 'x' } as never)
    ).toThrow();
  });

  it('removeFromWishlist by (type,id)', () => {
    addToWishlist({ bcItemType: 't', bcTrackId: 42, bcUrl: 'x', title: 'x' });
    removeFromWishlist('t', 42);
    const row = getDb().prepare('SELECT * FROM wishlist WHERE bc_track_id=42').get();
    expect(row).toBeUndefined();
  });

  it('reopenWishlistItem clears dismissed_at and resets mirror_state', () => {
    addToWishlist({ bcItemType: 't', bcTrackId: 7, bcUrl: 'x', title: 'x' });
    getDb().prepare(`UPDATE wishlist SET dismissed_at='2025-01-01', mirror_state='synced', bc_synced_at='2025-01-01' WHERE bc_track_id=7`).run();
    reopenWishlistItem('t', 7);
    const row = getDb().prepare('SELECT * FROM wishlist WHERE bc_track_id=7').get() as any;
    expect(row.dismissed_at).toBeNull();
    expect(row.mirror_state).toBe('local');
    expect(row.bc_synced_at).toBeNull();
  });
});
