# Unfck Bandcamp

**Status:** Phase 0, 1, 2A done — Phase 2B (Wavesurfer + Sticky Player + AWSD) offen
**Angelegt:** 2026-04-25

## Was Marco morgen frueh sehen kann

`cd C:\Users\marco\Claude\unfck_bandcamp && npm run dev`, dann http://localhost:3457:

- **/setup** — Cookie-Paste (auto-prefill aus `data/bc_cookies.txt`), Validate, dann Owned-Sync
- **/** — Home zeigt eingeloggten Status + Owned-Count + Last-Sync, plus Buttons fuer /tracks und /setup
- **/tracks** — Beatport-Style flache Track-Liste der gekauften Releases. Klick "Tracks expandieren" um Album-Items in einzelne Tracks aufzubrechen. Play-Button auf jedem Track spielt direkt im sticky-bottom-Player (native HTML5 audio, Wavesurfer kommt in Part B).

Smoke-Test gegen Marcos echtes BC-Konto:
- 36 Collection Items via Fan-API → 36 collection_items in DB
- 36 Items expanded zu 44 Tracks via Release-Page-Scrape, alle mit Stream-URLs
- /api/audio/stream liefert HTTP 200, 4.4 MB MP3, 128 kbps, sauber an HTML5 audio dispatchable
- Auto-Advance funktioniert, ueberspringt streamlose Tracks

## Strategie

Self-Host-Tool, Beatport-Style UI fuer Bandcamp. Marco zuerst, dann kleiner Freundeskreis als Docker-Distribution. Kein SaaS, kein zentraler Server.

Neuaufbau, nicht Fork. SoundFinder bleibt unangetastet, BC-Module wurden aus SF-Wissen rekonstruiert (BC hat das Schema in vielen Stellen umgebaut: `item_cache.collection` statt `collection_data.items`, `data-tralbum="..."` statt `var TralbumData`).

## Phasen-Status

- [x] **Phase 0 (Skelett)** — git tag `phase-0`, Codex 2 Pässe clean
- [x] **Phase 1 (BC-Login + Owned-Sync)** — git tag `phase-1`, Codex 2 Pässe, alle Findings adressiert oder dokumentiert
- [x] **Phase 2A (Track-Expansion + Basic Player)** — git tag `phase-2a`, Codex 2 Pässe, alle Findings adressiert oder dokumentiert
- [ ] **Phase 2B (Wavesurfer + Sticky Bar + AWSD + Audio-Cache)** — naechste Session
- [ ] **Phase 3 (Following + Discovery)**
- [ ] **Phase 4 (Wishlist + Cart-Stage + Auto-Mark-as-Bought)**
- [ ] **Phase 5 (Tags + Playlists + History)**
- [ ] **Phase 6 (Docker + Distribution)**

## Stack

- Next.js 16.2.4 (App Router) + TypeScript strict
- Tailwind 3 (dark default, hoher Kontrast)
- better-sqlite3 12.9.0 (WAL, IMMEDIATE-Tx, instrumentation hook auto-migrates)
- cheerio 1.0 (parser, aber HTML-Parsing ist regex-basiert wo schneller)
- Zustand 5 (Player-Store)
- yt-dlp Binary 2026.03.17 (im Dockerfile gepinnt mit SHA256, fuer Phase 2B Audio-Cache)
- ffmpeg im Container

## Datenmodell (Stand Phase 2A)

- `auth` (single-row, CHECK id=1) — cookie_string, fan_id, username, email
- `collection_items` — Owned-Items aus BC Fan-API, idempotent upsert auf (bc_item_id, bc_item_type), tombstone via removed_at
- `tracks` — pro-Track-Granularitaet, expanded aus collection_items via release-page-scrape, mit purchased_at denormalisiert
- `sync_runs` — Audit-Log, instrumentation reaped stale `running` rows beim Server-Start

## Verschoben fuer Phase 2B oder spaeter

Aus Codex-Reviews dokumentiert, nicht in Phase 2A umgesetzt:
- TTL fuer Stream-URL-Cache (aktuell 30 min, Comment markiert als SPECULATION)
- Adaptive Backoff bei Track-Expansion (aktuell starres 350ms-Delay)
- Audio-Lokal-Cache via yt-dlp (Phase 2B)
- Wavesurfer Waveform-Player (Phase 2B)
- AWSD-Shortcuts (Phase 2B)
- Encrypted cookies-at-rest (Phase 6)
- Suffix-Range im Audio-Stream (Range `bytes=-N`) (Edge-Case, akzeptabel)

## Naechste Session

Phase 2B starten (Wavesurfer-Player + Sticky-Bar + AWSD). Player-Store ist bereits da — Phase 2B ist UI-Refactor, kein Daten-Refactor.

## Log

- 2026-04-25: Projekt angelegt, Strategie geklaert (Self-Host, Neuaufbau, BC-Login Cookie-Paste a)
- 2026-04-25: Phase 0 done (Skelett, Migrations, Docker-Stub, Health-Endpoint)
- 2026-04-25: Phase 1 done (BC-Login + Owned-Sync, 36 Items vom echten BC)
- 2026-04-25: Phase 2A done (Track-Expansion zu 44 Tracks + Basic Player + native audio playback verified)
