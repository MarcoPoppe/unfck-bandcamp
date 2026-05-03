# Unfck Bandcamp

**Version:** 1.45.0 (siehe `package.json`)
**Status:** Phase AI durch — TrackRow-Unification fertig. Eine Komponente für alle Tracklisten (Library, History, Wishlist, Discover, Curator-Collection, Playlist-Detail). Slot-basiert (variant=full/compact, position, reorderControls, selectable, trailing, expandedContent, badges, titleHref). DiggerAlbumTrackRow gelöscht; expanded Curator-Album-Tracks rendern als TrackRow variant=compact. TrackRow nutzt intern TrackActionsBar — Lazy-Resolve für nicht-importierte Curator-Items kommt damit kostenlos. Build clean, tsc clean. Tauri-Distribution als nächstes.
**Repo:** lokal unter `C:\Users\marco\Claude\unfck_bandcamp\` (kein Remote)
**Zielplattform:** Self-Host via Docker Compose (Marco + Freundeskreis), oder lokal via `npm run dev` auf Port 3457. Tauri-Distribution geplant in nächster Session.

## Stack

- Next.js 16.2.4 (App Router) + TypeScript strict + Tailwind 3
- better-sqlite3 12.9.0 (WAL mode, IMMEDIATE-Tx, instrumentation hook auto-migrates)
- cheerio 1.0.0 (HTML parsing)
- zustand 5.0.1 (Player-Store + Live-Played + Wishlist + Playlist-Membership Sets)
- wavesurfer.js 7.8.6 (48px Waveform im Beatport-Style Sticky-Player)
- realtime-bpm-analyzer 5.0.12 (installiert, Live-Detection rolled back; Offline-Detection via AudioContext aktiv)
- react-virtuoso 4.18.6 (Virtualisierung Library 200+ / Curator-Collection 500+)
- yt-dlp 2026.03.17 (sha256-pinned, im Docker-Image)
- ffmpeg im Docker-Image fuer yt-dlp Audio-Format-Konvertierung

## Routen / Module

| Pfad | Status | Zweck |
|---|---|---|
| `/` | done | Home-Dashboard mit 6 Stat-Cards, Sync-Health, Recently-Played, Datum dd.mm.yyyy hh:mm |
| `/setup` | done | 2-Step-Wizard (Burner + Your account), DiagnosticsPanel mit Copy-Button, Sync-Section mit Library + Follow-Imports |
| `/tracks` | done | Library mit Search/Sort/Archived/Lookup, TrackRow |
| `/discover` | done | 4 Tabs: New tracks (Multi-Select+Mark-as-played) / Follows (Multi-Select+Bulk-Unfollow) / Curators (Multi-Select+Mark-Seen+Hide-already-followed) / Lookup |
| `/wishlist` | done | Open/Bought/Dismissed mit Multi-Select, Auto-Mark via collection_items, dd.mm.yyyy-Datum |
| `/playlists`, `/playlists/[id]` | done | Hand-curated set lists mit Reorder-Pfeile (Migration auf TrackRow geplant) |
| `/tags` | hidden | Route lebt, aus UI raus (Marco-Wunsch); DB+API stehen, Revival möglich |
| `/labels`, `/label/[id]` | done | Label-Index + Label-Detail-Page mit Releases gruppiert |
| `/history` | done | Letzte 200 Plays mit dd.mm.yyyy hh:mm-Datum |
| `/track/[bcTrackId]` | done | Track-Permalink mit on-demand released_at-Refill, Custom-Error-Page bei Lookup-Fail |
| `/artist/[bcBandId]` | done | Artist-Detail mit Library-Owned + BC-Releases inline-aufklappbar |
| `/digger/[bcFanId]` | done | Curator-Profil (DIGGER-Badge → CURATOR), kompakt-zentrierter Header (Migration auf TrackRow geplant) |
| `/u/[username]` | done | Anonymes BC-User-Profil |
| `/api/health` | done | Version aus package.json + uptime |
| `/api/diagnostics` | done | Aggregated state-snapshot mit redacted cookies |
| `/api/auth/{validate,suggest,status,logout,avatar}` | done | role-aware (crawler/main); suggest gated by env var |
| `/api/sync/{owned,tracks,discovery,diggers,follows}` | done | crawler-cookies durchgehend; per-item errors persisted |
| `/api/audio/stream` | done | Range-aware Audio-Proxy + Cache |
| `/api/{follow,wishlist,tags,playlists,plays,discover,tracks}` | done | CRUD-APIs |
| `/api/playlists?as=memberships` | done | Live track→playlists map for AppShell hydration |
| `/api/track/lookup`, `/api/track/[id]/{supporters,best-of,by-local/[id]/artist,bpm}` | done | Lookup, supporters, best-of crawl |

## Datenmodell (18 Migrations)

| Migration | Inhalt |
|---|---|
| 1-16 | (siehe vorherige Phasen-Logs) |
| 17 | phase_af_auth_split — auth-Tabelle mit role (crawler/main) + crawl_target_username |
| 18 | phase_ag_sync_errors_and_staging — sync_errors Tabelle, digger_collection.staged_run_at |

## Sicherheit

- BC-Cookies AES-256-GCM verschlüsselt at rest (key in `data/.app_secret`, chmod 600)
- 12 cookie-touching Routes loopback-guarded
- Pre-flight cookie revalidation vor Sync
- `/api/auth/suggest` gated by `UNFCK_ALLOW_COOKIE_SUGGEST=1` (Codex-HIGH)
- Schema-Drift-Preflight beim App-Start (Codex-HIGH)
- File-Logger nach `data/logs/app-YYYY-MM-DD.log` (JSON Lines)
- Stale-Run-Reaper für sync_runs + digger_crawl_runs + best_of_supporters_runs

## Abgeschlossene Phasen (Auszug seit v1.27.0)

### Auth-Split (Phase AF, v1.37.0)

Migration 17. `auth`-Tabelle wurde role-tagged (crawler/main). Crawler-Account macht alle Reads, Main-Account ist optional und nur für Mirror-Follow zuständig. `getStoredAuth()` fällt auf main zurück bei Legacy-Setups. Setup-Wizard 2-step (Burner + Your account). Spec: `docs/specs/2026-05-03-auth-split-crawler-main.md`.

### Codex-HIGH-Findings (v1.38.0)

- `/api/health` returnt aus package.json (war hardcoded `0.1.0`)
- `/api/auth/suggest` gated by env var
- File-Logger `lib/log.ts` (JSON Lines, instrumentation hook nutzt ihn)
- Schema-Drift-Preflight `lib/db/schema_check.ts` läuft bei jedem Boot
- `/api/diagnostics` aggregator + `<DiagnosticsPanel>` mit Copy-Button im Setup
- `app/error.tsx` + `app/global-error.tsx` (mit humorvollem "Ups." statt Panik)
- File-Logger nach `data/logs/`

### Per-Item-Sync-Errors persistiert (v1.39.0)

Migration 18. `sync_errors`-Tabelle, `recordSyncError()` helper, integriert in alle 6 Sync-Module (owned, tracks, discovery, diggers, follows_import, digger_collection, best_of_supporters). `digger_collection`-Crawl auf Stage-and-Swap umgestellt (Codex-MED). Stale-Run-Reaper auf alle 3 Run-Tabellen erweitert.

### Find Curators Source-Picker + Find-Diggers→Curators (v1.39.0 + v1.43.0)

Source-Dropdown: my owned releases / my open wishlist / a specific playlist. `listWishlistTralbums` + `listPlaylistTralbums` neu in `lib/sync/diggers.ts`. UI-Rename Diggers→Curators (alle UI-Strings, DB-Tabellen + Routes bleiben `digger*`).

### UI-Polish-Pass (v1.40.x)

- Action-Bar überall: Heart → Playlist → Follow → Archive (uniform)
- Top-Nav: Avatar-Pill (BC-Profilbild über `/api/auth/avatar`, 6h localStorage-Cache) statt @username + Cog
- Kontrast-Sweep: `bg-accent text-fg-primary` → `text-fg-on-accent` (18 Files, 34 Lines, fix für Light-Mode)
- "via Curator" lesbarer (`text-fg-secondary` statt fg-muted, plus klickbarer Link wenn bcFanId bekannt)
- Setup-Wizard "Crawler/Main" → "Burner / Your Bandcamp account", ausklappbare DevTools-Anleitung
- Empty-States überall einladender mit Calls-to-Action

### Tooltip-Component (v1.40.0+, Refactored v1.42.0)

`<Tooltip>`-Komponente mit Portal + Fixed-Position, viewport-edge-clamp, auto-flip. Migriert: WishlistButton, FollowButton, AddToPlaylistButton, CurationButtons, PlayedCheck, PartialPlayedDot, HidePlayedToggle, AppShell-More+Avatar, StickyPlayerBar Player-Buttons + Time-Toggle, TrackRow Play+BC-Link.

### Multi-Select + Soft-Dismiss (v1.42.0–v1.43.0)

Pattern aus Diggers-Tab auf alle drei Discover-Tabs ausgerollt:
- New tracks: Bulk "Mark as played" + "Mark seen" mit localStorage `unfck.tracks.seen.v1`
- Curators: Bulk "Follow & mark seen" / "Mark seen" / "Permanently ignore" mit localStorage `unfck.diggers.seen.v1`, plus "Hide already-followed"-Toggle
- Follows: Bulk-Unfollow für Artists/Labels/Curators, EntityCard mit Checkbox

Tab-Counter respektiert seen + already-followed (custom-event-driven hook `useStoredSeenSet`).

### Datetime-Helper + Format-Vereinheitlichung (v1.41.0)

`lib/util/datetime.ts` mit `formatDateTime` (dd.mm.yyyy HH:MM) + `formatDate`. Migriert: Setup last-sync, Wishlist boughtAt, History playedAt, Home recent-syncs.

### Counter-Fix + 404-Fix + Release-Date (v1.44.0)

- Hide-curators-Counter zählt jetzt followed + seen (vorher nur followed)
- `/track/[id]` zeigt eigene "Track unavailable"-Page statt 404 wenn Lookup fehlschlägt; mit BC-Fallback-Link
- Release-Date Option 1: `listDiggerCollection` joined `tracks` per `bc_track_id`/`bc_album_id` für `released_at` + `localTrackId`
- Release-Date Option 2: Track-Permalink macht on-demand `lookupTrack` wenn `released_at` NULL, refresht und re-rendert

## Bekannte offene Punkte / Pläne in `docs/specs/`

**Plan 1: TrackRow Unification** — `docs/specs/2026-05-04-trackrow-unification.md`
- Eine `<TrackRow>` für alle Tracklisten (Library, History, Wishlist, Discover, Curator-Collection, Playlist-Detail)
- Slot-basiert: leading (checkbox/position/reorder), trailing (album-expand/remove), expandedContent (album-tracks)
- 5 Phasen, ~3.5h, Migrations-Plan + Test-Checkliste
- DiggerAlbumTrackRow-Custom verschwindet; Curator-Collection + Playlist-Detail nutzen die unified component

**Plan 2: Tauri Distribution + Auto-Updater** — `docs/specs/2026-05-03-tauri-distribution.md`
- Tauri-Wrapper (Win/macOS/Linux), Embedded-Browser-Login statt Cookie-Paste
- GitHub Releases als Distribution-Pfad mit Auto-Updater (tauri-plugin-updater)
- 5 Phasen, ~1.5-2 Tage, GitHub Actions Release-Workflow inklusive
- Code-Signing optional (Phase 2)

**Akzeptierte Trade-offs:**
- Wellenform pro Row (Beatport-Style inline) — pro-Row WaveSurfer-Instanz wäre Performance-Killer
- BPM Live-Detection — Offline-Detection läuft, Live rolled back wegen `createMediaElementSource`-Konflikt
- Mobile-Layout (Desktop-only ab ~1280px)
- Curator-URL bleibt `/digger/[id]` (DB-Tabellen heißen weiter `diggers`); Renaming wäre Migration-Overkill

**Offene Codex-MED-Findings (lower priority):**
- Discovery feed-endpoint refactor für Wegwerf-Setup (aktuell iteriert über Follows)
- Per-Item-Errors auch in den restlichen 4 Sync-Modulen — schon erledigt
- Audio-stream Server-Errors strukturiert
- Migration-Half-State-Schutz (Pro-Migration-Transaction)
- Several silent catches in `lib/bandcamp/parse_release.ts` / `resolve_ids.ts`

## Test-Checkliste für Marco

1. `npm run dev` → http://localhost:3457
2. /setup: 2-Step-Wizard durchklicken, Avatar-Pill oben rechts sichtbar
3. /discover: alle 4 Tabs (New tracks Multi-Select, Follows Multi-Unfollow, Curators Multi-Select+Mark-Seen)
4. /wishlist: open/bought/dismissed mit dd.mm.yyyy hh:mm
5. /digger/[id]: Inactive-Badge mit Datum-Suffix, Album-Expand-Button "Tracks ▾"
6. /track/[unbekannte-id]: zeigt "Track unavailable" mit BC-Fallback statt 404
7. Tooltips: Hover auf Heart/Playlist/Follow/Archive zeigt dunkle Tooltip-Bubbles, kein Browser-Gelb mehr
8. /api/diagnostics: JSON-Snapshot mit version 1.44.0, schema.drift []

## Stand-Log (letzte Sessions)

- 2026-04-25 bis 2026-04-29: Phase A bis W (siehe vorherige Phasen-Memo)
- 2026-05-01: Phase X-AE (Theme-System, Tempo+BPM, Datum, Konsistenz-Sweep, Mikro-Animationen, Everything-Lookup, Datum+cross-EP-queue, Mobile-API-Discography)
- 2026-05-03: Riesige Session — Auth-Split, UI-Polish-Pass, Tauri-Spec, Codex-Audit-Pass, Diggers→Curators Rename, Multi-Select-Pattern, Counter-Fix, Avatar-Bild aus BC, Custom-Tooltip-Portal-Refactor, Release-Date Option 1+2, Custom-Error-Page für Track-404
- 2026-05-04: TrackRow-Unification-Plan + Tauri-Plan geschrieben
- 2026-05-04: Sammelcommit v1.44.0 (37 Phasen seit v0.7.0). Phase AI: TrackRow-Unification durch — alle 5 Phasen, build clean. Tauri-Distribution als nächstes.

## Phase AI — TrackRow Unification (v1.45.0)

5 Phasen aus `docs/specs/2026-05-04-trackrow-unification.md`:

1. **API erweitert.** TrackRow.tsx nimmt jetzt `variant`, `position`, `reorderControls`, `selectable`, `trailing`, `expandedContent`, `titleHref`, `badges`, `showFollow/Archive/BcLink`, `hideAlbumColumn/Duration`, `partialPlayedFraction` an. Defaults so gewählt, dass alle 8 bestehenden Aufrufer unverändert kompilieren. Inline action-buttons durch `<TrackActionsBar>` ersetzt — damit kommt Lazy-Resolve für nicht-importierte Curator-Items kostenlos.
2. **Curator-Track-Items.** `DiggerDetailClient.renderCollectionItem` rendert track-items als `<TrackRow titleHref="/track/go?url=…" badges="You own this" showFollow showArchive hideAlbumColumn hideDuration onPlayOverride={...} />`.
3. **Curator-Album-Items + DiggerAlbumTrackRow gelöscht.** Album-items rendern als TrackRow mit `trailing={AlbumExpandToggle}` und `expandedContent={AlbumTracklist}`. Inline tracklist nutzt neue `AlbumTrackCompactRow`-Wrapper, der TrackRow mit `variant="compact" position={t.trackNumber}` rendert. Code-Reduktion: ~150 LOC.
4. **Playlist-Detail.** PlaylistDetailClient nutzt TrackRow mit `position`, `reorderControls`, `trailing={Remove}`, `hideDuration`. Custom Reorder-Wrapper raus.
5. **Discover-Tracks-Tab.** TracksTab nutzt `selectable={{selected, onToggle, label}}` statt Wrapper-Flex mit eigener Checkbox.

**Build-Status:** `tsc --noEmit` clean. `next build` clean (alle Routen kompilieren). ESLint-Config fehlt im Repo (Pre-existing, nicht durch diese Session verursacht).
