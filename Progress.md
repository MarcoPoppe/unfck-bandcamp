# Unfck Bandcamp

**Version:** 0.7.0 (siehe `package.json`)
**Status:** MVP komplett. Alle 7 Phasen done, ready zum Verteilen.
**Repo:** lokal unter `C:\Users\marco\Claude\unfck_bandcamp\` (kein Remote)
**Zielplattform:** Self-Host via Docker Compose (Marco + Freundeskreis), oder lokal via `npm run dev`

## Stack

- Next.js 16.2.4 (App Router) + TypeScript strict + Tailwind 3
- better-sqlite3 12.9.0 (WAL mode, IMMEDIATE-Tx, instrumentation hook auto-migrates)
- cheerio 1.0.0 (HTML parsing fuer BC pages)
- zustand 5.0.1 (Player-Store, single source of truth)
- wavesurfer.js 7.8.6 (Waveform im Sticky-Player)
- yt-dlp 2026.03.17 (sha256-pinned, im Docker-Image)
- ffmpeg (im Docker-Image, fuer yt-dlp Audio-Format-Konvertierung)

## Seiten / Module

| Pfad | Status | Zweck |
|---|---|---|
| `/` | done | Home mit Stats + Navigation |
| `/setup` | done | Cookie-Paste, Validate, Owned-Sync trigger |
| `/tracks` | done | Beatport-Style Track-Liste, Wavesurfer-Player, AWSD-Shortcuts, Heart-/+-Button |
| `/discover` | done | Tracks von Followed-Artists (Discovery-Tab) |
| `/follows` | done | Artists/Labels/Diggers folgen, Discovery-Sync triggern |
| `/wishlist` | done | Wishlist mit Auto-Mark-as-Bought, Multi-Select-Actions |
| `/playlists` | done | Playlist-Index mit Create/Delete |
| `/playlists/[id]` | done | Detail mit Reorder + Track-Remove + Player |
| `/tags` | done | Tag-Verwaltung mit Color-Picker |
| `/history` | done | Letzte 200 Plays |
| `/api/health` | done | Health-Check fuer Docker |
| `/api/auth/{validate,suggest,status}` | done | Auth-Endpunkte (loopback-only) |
| `/api/sync/{owned,tracks,discovery}` | done | Sync-Endpunkte (loopback-only) |
| `/api/audio/stream` | done | Range-aware Audio-Proxy + Cache |
| `/api/{follow,wishlist,tags,playlists,plays,discover,tracks}` | done | CRUD-APIs |

## Abgeschlossene Arbeiten

### Phase 0 — Repo-Skelett (`phase-0`, commit 16b91f0)
- Next.js 16 + TS strict + Tailwind dark + better-sqlite3 + cheerio + zustand
- Migration-System (validate monotone unique IDs, IMMEDIATE-Tx, idempotent)
- instrumentation hook auto-runs migrations beim Server-Start
- Dockerfile multi-stage, non-root, ffmpeg + yt-dlp pinned
- .dockerignore schuetzt `data/` (cookies, db) vor Build-Context
- Health endpoint
- Codex 2 Pass: 7 findings → fixed via instrumentation hook

### Phase 1 — BC-Login + Owned-Sync (`phase-1`, commit 95b9a9f)
- DB: auth (single-row CHECK), collection_items, sync_runs
- Cookie-Parser (identity, logout-email, js_logged_in)
- BC homepage parser (inline JSON `fanId`+`fanUsername`)
- Fan-API client mit Pagination + Politeness-Delay
- Pre-flight cookie revalidation vor Sync (catch expired cookies)
- Stale-Run-Reaper beim Server-Start
- Tombstone-Logik (last_seen_run_id + removed_at) nur bei voll-vollstaendigem Sync
- Loopback-Guard auf cookie-bearing endpoints
- Codex 2 Pass: 7 findings, alle fixed/dokumentiert
- **Verifiziert gegen echtes BC**: 36 items via Fan-API in <1.3s

### Phase 2A — Track-Expansion + Basic Player (`phase-2a`, commit 5d189ae)
- DB Migration #4 + #5: tracks Tabelle mit purchased_at-Denormalisierung
- BC `data-tralbum=...` HTML-Attribut Parser (BC hat Schema gewechselt)
- Track-Expansion: 350 ms Delay, idempotent upsert mit COALESCE auf stream_url
- Audio-Stream-Endpoint mit Range-aware Proxy + 30 min TTL + lazy-refresh
- TrackRow + MinimalPlayer Components mit zustand store
- Tombstone-Cascade tracks bei collection_item-removal (atomic via tx)
- **Verifiziert**: 36 items → 44 tracks expanded, alle hasStream, MP3 4.4 MB

### Phase 2B — Wavesurfer + Sticky Bar + AWSD + Audio-Cache (`phase-2b`, commit 4bee82d)
- StickyPlayerBar mit Wavesurfer.js v7, native `<audio>` als Source-of-Truth
- Single-Owner-Discipline: track-change-effect nur src+load, isPlaying-effect ownt play/pause
- requestTokenRef gegen stale-rejection bei schnellem Skip
- AWSD-Shortcuts (A/D=prev/next, Space=play/pause), gated bei input/textarea
- Audio-Cache: data/audio_cache/track_<id>.mp3, atomic via tmp+rename, inflight-dedup, 30s failure-backoff
- LRU-by-atime Eviction, default 2 GiB cap (env-tunable)
- Range-Sanitization: bytes=N-M valid, bytes=N-M (descending) → 416
- Codex 2 Pass: 5 findings, alle fixed
- **Verifiziert**: cache-miss 6 MB MP3, cache-hit instant, range bytes=0-1023 → 1024 bytes 206

### Phase 3 — Following + Discovery (`phase-3`, commit e18dc92)
- DB Migration #6: artists, labels, diggers, polymorphic following, discovered_tracks (separate von tracks)
- upsertArtist match by bc_band_id first (mit > 0 guard) → custom-domain duplicates verhindert
- BC `/<artist>/music` Parser mit Layout-Change-Detector (throw bei allen 4 Markern fehlend)
- Discovery-Sync: bounded parallelism 3 + 350 ms cooldown zwischen Batches, limit DISCOVERY_RELEASES_PER_ARTIST=12
- HTTP-Layer: 3-attempt retry-with-jitter auf 429/5xx
- /follows mit Tabs + Add-by-URL, /discover mit TrackRow grid
- Codex 2 Pass: 12 findings, 3 WARN gefixt + 9 INFO/Part-B
- **Verifiziert**: Sender Records → 12 releases / 105 tracks / 4.6s

### Phase 4 — Wishlist + Cart-Stage + Auto-Mark (`phase-4`, commit c618b1c)
- DB Migration #7: wishlist mit status (open/bought/dismissed) + bought_via (manual/auto)
- addToWishlist dedupe by bc_track_id, re-open mit komplettem Reset
- autoMatchOwnedToWishlist: SELECT candidates → tx-update mit changes>0 counter (concurrent safe)
- Sync-Hooks: nach syncOwnedCollection + nach expandCollectionToTracks ruft auto-match
- /wishlist UI 2-step-Flow (owned-sync → tracks-expand → auto-match), error-display bei step-2-failure
- WishlistButton (Heart-Icon) im TrackRow, optimistic update
- Loopback-Guards auf alle 3 Methoden (GET/POST/PATCH)
- Codex 2 Pass: 14 findings, 4 high/medium fixed (loopback, error-handling, reopen-reset, changes-counter)
- **Verifiziert**: Track 3924159572 (Whos In Control) auto-marked nach track-expand

### Phase 5 — Tags + Playlists + History (`phase-5`, commit be09f91)
- DB Migration #8: tags (name UNIQUE), track_tags (composite PK), playlists, playlist_tracks (UNIQUE+position), track_plays
- Tags: case-insensitive dedupe via LOWER(), trackCount JOIN durch tracks WHERE removed_at IS NULL
- Playlists: addTrackToPlaylist atomic via IMMEDIATE-tx (kein Position-Race), reorder transactional
- Plays: recordPlay threshold = max(1, min(5, duration*0.1)), didFire-Guard gegen StrictMode
- TrackActions Component (+-Dropdown) im TrackRow: lazy-load tags+playlists, attach via API
- /tags + /playlists + /playlists/[id] + /history Pages
- next.config.js output:'standalone' fuer Phase 6 vorbereitet
- docker-compose BIND_HOST=127.0.0.1 default
- Codex 2 Pass: 10 findings, 6 high/medium fixed + 4 dokumentiert

### Phase 6 — Docker + Distribution (`phase-6`, commit d1d5fec)
- Dockerfile auf Standalone-Layout: COPY .next/standalone + .next/static + public + node_modules/better-sqlite3
- next.config.js outputFileTracingRoot fix fuer Windows-deeply-nested-tree
- docker-compose env-vars passthrough: SYNC_INTERVAL_MIN, MAX_AUDIO_CACHE_BYTES, DISCOVERY_RELEASES_PER_ARTIST, YTDLP_PATH (mit defaults)
- README komplett neu (170+ Zeilen): Voraussetzungen, Quickstart Docker+Lokal, Cookie-Anleitung, Feature-Walkthrough, Konfiguration, Architektur, Sicherheits-Hinweise, Backup, Linux-Permissions, Troubleshooting, Roadmap, Lizenz
- LICENSE: MIT, Copyright 2026 Marco Poppe
- Loopback-Guards finalisiert (12 cookie-touching routes)
- Third-party-notice fuer LGPL-Transitives (sharp via next/image)
- Codex 2 Pass: 7 MAJOR + 3 MINOR, alle fixed

## Datenmodell (8 Migrations)

| Migration | Tabellen | Zweck |
|---|---|---|
| #1 | _migrations | Migration-Tracker |
| #2 | auth, collection_items, sync_runs | Phase 1 BC-Auth + Owned-Sync |
| #3 | (ALTER) collection_items | Phase 1.5 last_seen_run_id + removed_at fuer Tombstones |
| #4 | tracks | Phase 2A Track-Granularitaet aus collection_items |
| #5 | (ALTER) tracks | Phase 2A purchased_at denormalize |
| #6 | artists, labels, diggers, following, discovered_tracks, (ALTER) tracks | Phase 3 Following + Discovery |
| #7 | wishlist | Phase 4 Wishlist mit Auto-Mark |
| #8 | tags, track_tags, playlists, playlist_tracks, track_plays | Phase 5 Library-Layer |

## Bekannte offene Punkte

Alle aus den Codex-Reviews dokumentiert:

**Aufgeschoben fuer kuenftige Phasen:**
- Diggers-Discovery (BC-User mit Geschmacks-Overlap, separater Crawler)
- Discovery-Audio-Stream (in-app Playback fuer noch-nicht-gekaufte Tracks; Audio-Endpoint kennt aktuell nur tracks-Tabelle, nicht discovered_tracks)
- Encrypted-Cookies-At-Rest (bisher Plain-Text in DB, OK fuer Self-Host single-tenant)
- Custom-Domain Artist-Resolution: band_id-Match faengt 95 % ab, aber custom domains haben nicht immer band_id im HTML

**Akzeptierte Trade-offs:**
- /history hartcap auf 200 (kein Paging) — bei DJ-Use-Case ueberfluessig
- TrackActions Doppelklick-Race (ms-Window, idempotent serverseitig)
- LOWER() in tag-dedupe ist ASCII-only (`Cafe` vs `Café` koennen 2 Tags werden) — niedriger Impact
- /api/auth/suggest reicht Cookies nur an Loopback (geschuetzt) raus
- Cache-Eviction nur LRU-by-atime, kein TTL — bei 2 GiB cap unproblematisch

**Marco-Tasks vor Friend-Test:**
- LICENSE Copyright-Jahr/Name pruefen
- README Repo-URL setzen sobald GitHub-Repo angelegt
- `data/bc_cookies.txt` aus Marcos lokalem Volume loeschen, sobald Setup erfolgreich (sicherheitshalber)
- Erstbuild-Zeit auf seiner Hardware messen (5-10 min annotiert in README)

## Letzte Aenderungen (Session 2026-04-25 + 2026-04-26)

Vollstaendige autonome Build-Session ueber Nacht:

- 9 Commits, 7 Phase-Tags (`phase-0` bis `phase-6`)
- ~80 Codex-Befunde durchgearbeitet (jeweils 2 Iterationen pro Phase)
- Alle Sync-Pfade gegen Marcos echtes BC-Konto verifiziert (fan_id 3602423, username liebreiz)
- Stack festgenagelt, Distribution-ready (Docker + MIT + README)
- Version-Bump 0.1.0 → 0.7.0 fuer den 7-Phasen-Block (gemaess feedback_versionierung)

**Naechstes Mal:**
- Marco-Review der UI auf seinem Geraet (Browser-Test der ganzen Tool-Surface)
- Eventuelle Friend-Test mit kleinem Freundeskreis (Repo + Cookie-Anleitung verteilen)
- Folge-Phase fuer Diggers / Discovery-Audio / Encryption falls gewuenscht
