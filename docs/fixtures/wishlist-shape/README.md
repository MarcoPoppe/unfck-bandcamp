# Wishlist Read-Shape Fixtures (Phase 0 Task 0.1)

Captures the polymorphic wishlist API response so `fan_wishlist.ts` parsing
has a regression anchor. Source: public wishlist of `ponybarker`
(fan_id `10039889`, 332 items), captured 2026-05-16.

## Files

- `wishlist_items.json` — full response body of
  `POST https://bandcamp.com/api/fancollection/1/wishlist_items` with body
  `{"fan_id": 10039889, "older_than_token": "1773927713:2608417532:t::", "count": 20}`
  fetched against the live profile.

## Confirmed Schema Invariants

- Top-level keys: `items`, `more_available`, `item_lookup`, `last_token`,
  `tracklists`, `purchase_infos`, `collectors`.
- `items[i].item_type` is the full word `"album"` / `"track"`.
- `items[i].tralbum_type` is the single letter `"a"` / `"t"`.
- `tracklists` keys are `<type-letter><item_id>` e.g. `a283604243`,
  `t1642649786` (matches our internal item-key format).
- `last_token` format: `<unix_ts>:<item_id>:<type-letter>::` (used as cursor
  for the next page).
- `more_available: true` plus a non-empty `last_token` means another page
  exists; the loop ends when `more_available` flips to `false`.

## Initial-Page Source

The first 20 items also arrive inline inside `pagedata` on the profile HTML
(`window.WishlistData`). We don't bother capturing that separately because
the wishlist sync loop calls the API directly with a sentinel cursor for
the initial page too, keeping a single code path.
