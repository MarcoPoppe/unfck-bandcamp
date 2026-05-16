# Main-Auth Write Roundtrip (Phase 0 Task 0.3)

## Verification

Marco confirmed verbally on 2026-05-16: the stored main-auth cookie can collect
and uncollect tracks on the real Bandcamp account. Roundtrip captured live in
the earlier curl exchanges in this session (see `docs/fixtures/album-write/`),
which use exactly the same `Cookie: identity=...; session=...` envelope that
`getStoredMainAuth().cookieString` produces.

The asymmetry was the original concern (`getStoredAuth()` falls back to main if
no crawler is configured, which would let an accidental crawler-fallback write
to the wrong account). The fix is the strict accessor `getStoredMainAuth()`
which never falls back. Every BC write in this feature MUST go through that
accessor — enforced by grep-test in the verification checklist.

## Why no script

The original plan called for `scripts/verify-main-auth-write.mjs`. Marco
decided against the script because (a) the curls already proved the roundtrip
works, and (b) the script would need each tralbum's `band_id`/`crumb`/`ref_token`
parsed from HTML, which is exactly what `parse_tralbum_meta.ts` (Phase 1.3)
does anyway. Once that module is in place, the same roundtrip can be re-verified
with a one-shot `await addToBcWishlist(url); await removeFromBcWishlist(url)`
against any throwaway track URL.
