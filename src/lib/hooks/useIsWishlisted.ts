import { usePlayerStore } from '@/lib/store/player';

/**
 * Reactive read of the polymorphic wishlist set. Returns true iff the
 * given (type, id) is currently on the open wishlist. Subscribes via the
 * underlying `wishlistedItems: Set<string>` so any add/remove triggers a
 * re-render in every component using this hook.
 */
export function useIsWishlisted(itemType: 't' | 'a', itemId: number): boolean {
  return usePlayerStore((s) => s.wishlistedItems.has(`${itemType}:${itemId}`));
}
