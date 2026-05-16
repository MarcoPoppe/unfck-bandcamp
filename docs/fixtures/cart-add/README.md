# Cart Add Without ref_token (Phase 0 Task 0.2)

Proves that the `ref_token` parameter on
`POST <band>.bandcamp.com/cart/cb` (req=add) is optional. The mirror has no
ref_token to send (it doesn't run inside the Bandcamp UI), so we need to
know whether Bandcamp accepts the request anyway.

## Files

- `no-ref-token.json` — response body when posting cart-add **without**
  the `ref_token` form field. Captured against
  `thomaspheckmann.bandcamp.com/album/drax-ltd-ii-amphetamine-the-complete-remixes`
  2026-05-16.

## Verdict

Required: **no**. HTTP 200, response body confirms `req: "add"` accepted.

## Implementation Notes

- `resync: true` in the response signals that our client-side `sync_num`
  was out of sync with Bandcamp's internal counter. Implementations that
  treat the cart as fire-and-forget can ignore this. Bulk-add does so.
- Response does **not** echo the added item. We trust HTTP 200 + absence
  of `error`.
- The response includes the logged-in account's email under `cart_data.email`.
  Not used, no special handling beyond not logging it.
