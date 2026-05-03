# Auth Split: Crawler + optional Main account

**Date:** 2026-05-03
**Target version:** 1.37.0

## Goal

Allow each instance to run with TWO Bandcamp identities instead of one:

- **Crawler** (required): every read/crawl call uses these cookies. Throw-away
  account that only ever fetches public data.
- **Main** (optional): only used to mirror follow/unfollow back to bandcamp.com
  when the user opts in. No reads, no crawls, no audio fetches.

This isolates Bandcamp's anti-scraping risk to the crawler, and gives users a
choice between exposing their real account or not.

## Why this works

- All endpoints we read are either public profile data (`bandcamp.com/<user>`,
  collection_items API, band_details, fan info, supporters, digger
  collections) or audio metadata. Bandcamp serves full-length mp3-128 streams
  to any logged-in account; the user's own account is only required for
  lossless downloads, which the tool never fetches.
- Mirror-Follow on bandcamp.com is the only operation that genuinely needs
  the user's own account.
- The existing `fetchInitialCollection(username, cookieString)` already
  crawls a profile via its public HTML and pulls `fanId` from the page blob.
  The `/api/fancollection/1/collection_items` pagination endpoint accepts
  any logged-in cookie — the `fan_id` in the body controls which profile is
  enumerated, not the cookie's own.

## Scope

### In scope

1. DB migration #17: replace single-row `auth` table with role-tagged rows.
2. `lib/auth/store.ts` rewrite: `getStoredAuth()` returns crawler (or main as
   fallback during migration), new `getStoredMainAuth()`.
3. `/api/auth/*` updates so setup can save/validate either role.
4. Setup UI: two sections (Crawler required, Main optional) plus a
   "Username to crawl" field that defaults to the crawler's own username.
5. `lib/sync/owned.ts`: pass the configured crawl-target username + that
   profile's `fanId` to pagination, instead of the cookie's own `fanId`.
6. `/api/follow` POST: when `mirrorToBc=true`, use main auth; if main not
   linked, skip mirror with a clear toast/log entry.
7. README + Progress.md updates.

### Out of scope (future work)

- Embedded-browser login flow (Tauri-side; happens during distribution work).
- Anonymous public crawls (mentioned earlier; superseded by the crawler
  account approach which gives us the same isolation with fewer rate limits).

## Migration #17 details

```sql
CREATE TABLE auth_v17 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('crawler','main')) UNIQUE,
  cookie_string TEXT NOT NULL,
  fan_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  email TEXT,
  crawl_target_username TEXT,    -- only meaningful on the crawler row
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO auth_v17 (role, cookie_string, fan_id, username, email, updated_at)
  SELECT 'main', cookie_string, fan_id, username, email, updated_at
  FROM auth;
DROP TABLE auth;
ALTER TABLE auth_v17 RENAME TO auth;
```

Rationale: existing single-account setups become "main" (their cookies are
for their actual account). The new crawler row is added later by the user
during the new setup flow. Until they add a crawler, fall back to main for
all calls (backward compat). When they add a crawler, all reads switch.

## auth/store.ts shape

```ts
getStoredAuth(): StoredAuth | null
  // Crawler row, or fallback to main when crawler missing.

getStoredCrawlerAuth(): StoredAuth | null
  // Strict — null when no crawler row exists.

getStoredMainAuth(): StoredAuth | null
  // Strict — null when not linked.

getCrawlTargetUsername(): string | null
  // crawler.crawl_target_username || crawler.username || main.username

saveAuth(role: 'crawler'|'main', auth, cookieString): void
deleteAuth(role: 'crawler'|'main'): void
setCrawlTargetUsername(value: string | null): void
```

## /api/auth changes

`POST /api/auth/validate`: accept `{role}` in the body. Default 'crawler' so
existing UI keeps working until upgraded. `GET /api/auth/status` returns
`{ crawler: { username, crawlTarget }, main: { username } | null }`.

## sync/owned.ts changes

Currently uses `auth.fanId` for pagination. Change to:
1. Resolve `username = crawlTarget || crawler.username`.
2. `fetchInitialCollection(username, crawler.cookieString)` — already returns
   the target profile's `fanId` from the page blob.
3. Use that `fanId` for `paginateCollection`, not the cookie's own.
4. Audio-stream fetcher in `lib/audio/cache.ts` keeps using crawler cookies.

## /api/follow changes

Add an optional `mirrorToBc=true` flag in body (it's already wired up
through preferences). When true:
- Resolve `mainAuth = getStoredMainAuth()`. If null, write a warning into
  the response (`mirrorSkipped: 'no_main_account_linked'`) and proceed
  with the local-only follow.
- Otherwise call the existing mirror logic with `mainAuth.cookieString`.

## Setup UI changes

Two horizontal sections, both with the same paste-cookies + validate flow:
- **Crawler account (required)**: explanation copy "Used for all reads.
  Use a fresh throwaway account; if Bandcamp blocks it, just create a new
  one." Field: cookies, validate button, status badge with username.
- **Crawl target**: input field, defaults to crawler's username. Help copy
  "The bandcamp.com/<user> profile this instance pulls collection / follows
  from. Default = your crawler account itself."
- **Main account (optional)**: explanation "Only needed if you want
  follows in this app to be mirrored back to bandcamp.com on your real
  account. Otherwise leave empty." Same paste-cookies form.

## Migration UX for Marco's existing instance

1. Migration #17 runs on next start, his existing cookies become role='main'.
2. App boot detects "crawler missing" → red banner on setup page asking to
   add a crawler. Until he does, the fallback uses main for everything (old
   behaviour preserved).
3. Once he adds a crawler + sets crawl target to `liebreiz`, all reads
   switch over. Main only fires on follow-mirror.

## Test plan (post-implementation)

- Marco's instance: migration runs cleanly, existing data intact, sync still
  works pre-crawler-setup (fallback path), sync still works post-crawler-
  setup with new identity.
- Fresh DB: setup wizard flows through crawler-only (skip main), then sync
  runs with target = crawler username (own profile).
- Mirror-Follow: with main, with no main (graceful skip), error path.

## Effort estimate (rough)

- Migration + auth-store + auth API: 1-2h
- sync/owned + sync/tracks adjustments: 1h
- /api/follow mirror split: 30min
- Setup UI rewrite (two sections): 2-3h
- Manual smoke + Progress/README: 30min

Total: 5-7h.

## Open follow-ups (don't block this)

- Codex review findings still on the parking lot:
  - `/api/auth/suggest` cookie leak (HIGH) — touch while we're in this file.
  - Schema-drift preflight (HIGH) — separate work.
  - Diagnostics endpoint + ErrorBoundary (HIGH) — separate.
  - File logger + 24 archived tracks (LOW) — separate.
- 44 archived tracks from 2026-04-28 09:19 bulk event still need a decision.
