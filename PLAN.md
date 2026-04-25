# Unfck Bandcamp - 30-Tage-Plan

**Gesamtziel:** Self-Host-Tool fuer Bandcamp mit Beatport-Style UI, Wishlist mit Auto-Mark-as-Bought, Docker-Distribution fuer Freundeskreis.

**Stack:** Next.js 15 (App Router, TS) + Tailwind + better-sqlite3 + cheerio + wavesurfer.js + yt-dlp Binary. Single-Container Docker.

**Workflow:** Pro Phase Implementation → Codex-Review #1 → Fixes (was ich auch so sehe) → Codex-Review #2 → Fixes → naechste Phase.

---

## Phase 0: Repo-Skelett (Tag 1-2)

**Ziel:** Lauffaehiges leeres Next.js-App mit allen Konfigs, DB-Migration-System, Docker-Stub.

**Tasks:**
- package.json mit gepinnten Versionen
- tsconfig.json (strict)
- next.config.js (Port 3457 als default)
- tailwind.config.js + postcss.config.js + globals.css (dark mode default, hoher Kontrast wie SF)
- .gitignore (data/, node_modules, .next, etc.)
- .env.example
- Dockerfile (Stub, multi-stage spaeter)
- docker-compose.yml (Stub mit Volume-Mount)
- README.md (Stub, fuellt sich in Phase 6)
- src/app/layout.tsx (RootLayout, dark mode)
- src/app/page.tsx (Landing: "Unfck Bandcamp - nicht eingerichtet")
- src/app/globals.css
- src/lib/db/index.ts (better-sqlite3 Singleton)
- src/lib/db/schema.ts (Migration-Liste, leer)
- scripts/migrate.ts (Runner)
- npm install

**Acceptance Criteria:**
- `npm run dev` startet Next.js auf Port 3457
- Browser zeigt Landing
- `npm run migrate` legt leere SQLite-DB unter `data/unfck.db` an
- `npx tsc --noEmit` kein Fehler

**Risiken:**
- Windows-Pfade in better-sqlite3 (forward slashes erzwingen)
- yt-dlp ist erst ab Phase 2 noetig, im Phase 0 nur Slot reservieren

**Codex-Review-Fokus:** Konfig-Sauberkeit, package.json Pinning, TS-Strict, Docker-Multi-Stage-Konzept.

---

## Phase 1: BC-Login + Owned-Sync (Tag 3-5)

**Ziel:** Marco kann Cookies einpasten, Tool validiert Session, holt Collection.

**Tasks:**
- DB-Tabellen: `auth` (cookie_string, fan_id, username, valid_until), `tracks` (id-pkey, bc_track_id, bc_album_id, title, artist, label, cover_url, release_date, bc_url, is_owned, added_at)
- `src/lib/bandcamp/auth.ts`: validateCookies (GET https://bandcamp.com/, prueft 200 + identity-Cookie active), parsePagedata (extrahiert fan_id + username aus pagedata-blob)
- `src/lib/bandcamp/fanapi.ts`: fetchCollection (POST /api/fancollection/1/collection_items, paginiert ueber older_than_token, count=100)
- `src/app/api/auth/validate/route.ts`: POST {cookies} → speichert + validiert
- `src/app/api/sync/owned/route.ts`: POST → laeuft Sync, schreibt Tracks
- `src/app/setup/page.tsx`: Onboarding-UI (Textarea fuer Cookies, Validate-Button, Sync-Status-Indicator)
- Background-Sync alle 6h via setInterval im Server (oder Cron via API-Call von docker-compose)

**Acceptance Criteria:**
- Marco paste Cookies in `data/bc_cookies.txt`
- POST /api/auth/validate liefert {ok: true, username: "marco", fan_id: 12345}
- POST /api/sync/owned holt komplette Collection, in DB sind alle Tracks mit is_owned=1
- Sync ist idempotent (zweiter Run dupliziert nicht)

**Risiken:**
- Bandcamp Rate-Limit auf Fan-API (vermutlich nicht aggressiv, aber sicherheitshalber 500 ms zwischen Pages)
- Cookie-String-Format: Header-Wert vs JSON-Cookies (wir nehmen Header-String)
- Fan-ID kann auf andere Wege gefunden werden (auch in JSON-API), aber pagedata-blob ist einfachster
- Wenn Cookies abgelaufen sind, brauchen wir clean Error-Path (UI zeigt "Bitte neue Cookies")

**Codex-Review-Fokus:** Pagination-Logik, Idempotenz, Error-Handling bei abgelaufenen Cookies, SQL-Injection in Inserts.

---

## Phase 2: Player + TrackRow (Tag 6-10)

**Ziel:** Beatport-Style Liste, sofortiges Abspielen, Multi-Track ohne Reload.

**Tasks:**
- `src/lib/audio/cache.ts`: getCachedPath (track_id → File-Pfad), downloadIfMissing (yt-dlp -f mp3 best, Quality-Cap 128 fuer Speed)
- `src/lib/audio/ytdlp.ts`: spawn-wrapper, Progress-Tracking, Timeout 60 s
- `src/app/api/audio/proxy/route.ts`: GET ?id=... → falls cached, Range-Stream lokal; sonst proxy direkt zu BC-Stream-URL aus Track-Metadata
- `src/components/StickyPlayerBar.tsx`: wavesurfer + native audio, Source-of-Truth ist `<audio>`, ws bekommt media:audio
- `src/components/TrackRow.tsx`: Cover, Title, Artist, Label, Release-Date, Duration, Play-Button (loest playerStore.play(track) aus)
- `src/lib/store/player.ts`: Zustand-Store mit current, queue, isPlaying, play(), next(), prev()
- AWSD-Shortcuts: A=prev, D=next, W=like, S=dislike, Space=pause
- `src/app/page.tsx` umgebaut zu Owned-Tab: alle owned Tracks als Liste, Sortable
- Auto-Advance: ended-Event triggert next() aus Store

**Acceptance Criteria:**
- Marco klickt auf erste Track-Row → Sound in <500 ms (cached) oder <3 s (uncached)
- Naechster Track startet automatisch nach Ende
- Pause via Space, Skip via A/D
- Bei 100 Tracks im DOM kein FPS-Drop (Virtualisierung mit react-window falls noetig)

**Risiken:**
- BC-Stream-URLs haben Token mit kurzer Lebensdauer, nicht cachen!
- yt-dlp produziert manchmal nur Album-Files bei Album-URLs - Single-Track-Pipeline wichtig
- wavesurfer-React-Wrapper hat in SF Edge-Cases gehabt (rejected Promise bei Abort), den Fix uebernehmen

**Codex-Review-Fokus:** Memory-Leaks im Player (audio-Element nicht recycled), Race-Conditions bei schnellem Skip, Range-Header-Korrektheit.

---

## Phase 3: Following + Discovery (Tag 11-15)

**Ziel:** Artists/Labels/Diggers folgen, ihre Releases als flache Track-Liste sehen.

**Tasks:**
- DB-Tabellen: `artists` (bc_url, name, image_url), `labels` (bc_url, name, image_url), `diggers` (bc_username, fan_id, image_url)
- `following` Tabelle (entity_type, entity_id, followed_at)
- `src/lib/bandcamp/crawl_artist.ts`: BC-URL → Track-Liste (HTML scrape pagedata)
- `src/lib/bandcamp/crawl_label.ts`: BC-URL → Track-Liste (label-Subdomains haben /artists, /releases)
- `src/lib/bandcamp/crawl_digger.ts`: BC-Username → Tralbum-Collectors-API + Match auf vorhandene Tracks
- `src/app/api/follow/route.ts`: POST/DELETE
- `src/app/api/discover/route.ts`: GET → Tracks von gefolgten Entities, sortiert nach release_date desc
- `src/app/follows/page.tsx`: Liste aller Follows, addable per BC-URL-Paste
- `src/app/discover/page.tsx`: flache Track-Liste neuer Releases

**Acceptance Criteria:**
- Marco paste eine Artist-URL → wird gefolgt, Tracks erscheinen
- Discover-Tab zeigt neueste Releases der Followed
- Diggers-Tab zeigt Bandcamp-User-Collections, klickbar, fuegt Tracks hinzu

**Risiken:**
- BC hat verschiedene Page-Layouts fuer Artist/Label/Solo-Release - mehrere Parser noetig
- Diggers-Crawl ist API-heavy, paginieren mit Throttle
- Knowledge ueber BC-URL-Patterns aus SF-Code uebernehmen

**Codex-Review-Fokus:** Crawler-Robustheit, Schema-Drift in BC-HTML, Foreign-Key-Sauberkeit.

---

## Phase 4: Wishlist + Cart-Stage + Auto-Mark-as-Bought (Tag 16-20)

**Ziel:** Eigener Korb, Direktlinks zu BC, Auto-Removal nach Kauf.

**Tasks:**
- DB-Tabellen: `wishlist` (track_id, added_at, status: open/bought/dismissed, bought_at, source: manual/auto)
- `src/components/WishlistButton.tsx`: Toggle in TrackRow
- `src/app/wishlist/page.tsx`: Liste mit BC-Direktlink, Multi-Select, "Mark as bought"-Button
- `src/lib/sync/owned_diff.ts`: nach jedem Owned-Sync vergleicht neue Owned-Items mit Wishlist, matcht per bc_track_id, setzt status=bought + source=auto
- Background-Sync-Trigger via Vercel-Cron-Pattern (oder docker setInterval)
- Notification-UI: nach Sync zeigt Toast "3 Wishlist-Items wurden gekauft erkannt"

**Acceptance Criteria:**
- Marco markiert 3 Tracks
- Klickt Direktlink → BC oeffnet
- Kauft 1 manuell auf BC
- Naechster Sync (manuell triggern fuer Test) markiert den 1 als bought

**Risiken:**
- Edge-Case: Marco kauft Album, das mehrere Tracks der Wishlist enthaelt - alle gleichzeitig markieren
- bc_track_id-Matching: Wishlist hat Track-IDs, BC-Collection liefert Items mit Track-ODER-Album-IDs - Mapping-Tabelle noetig
- Wishlist-Items, die manuell als "bought" markiert wurden, duerfen nicht spaeter durch Sync ueberschrieben werden

**Codex-Review-Fokus:** Idempotenz-der-Match-Logik, Race-Condition bei gleichzeitigen manuellen + auto Updates.

---

## Phase 5: Tags + Playlists + Listen-History (Tag 21-25)

**Ziel:** Persoenliche DB-Layer, die BC nicht hat.

**Tasks:**
- DB-Tabellen: `tags` (id, name, color), `track_tags` (track_id, tag_id), `playlists` (id, name, created_at), `playlist_tracks` (playlist_id, track_id, position), `track_plays` (track_id, played_at, completed_pct)
- `src/components/TagChip.tsx` + Tag-Picker in TrackRow
- `src/components/PlaylistAddDropdown.tsx` in TrackRow
- `src/app/tags/page.tsx`: Tag-Verwaltung, Filter "Tracks mit Tag X"
- `src/app/playlists/page.tsx` + `playlists/[id]/page.tsx`: CRUD + Reorder (drag-and-drop)
- Auto-Insert in track_plays bei jedem Play (>30s = completed)
- Heard-Indicator in TrackRow (graue Cover wenn schon gehoert + completed)

**Acceptance Criteria:**
- Marco taggt Tracks mit "Sommer 26"
- Filtert Tag-Liste
- Baut Playlist "Set XYZ" mit 10 Tracks
- Sieht "schon gehoert"-Marker in Discover

**Risiken:**
- track_plays-Tabelle waechst schnell (jeder Play = eine Zeile) - Index auf track_id Pflicht
- Drag-and-Drop-Reorder wenn Playlist > 100 Items: Performance-Test noetig

**Codex-Review-Fokus:** Index-Strategie, Reorder-Atomaritaet (alle Positions in einer Transaction).

---

## Phase 6: Docker + Distribution (Tag 26-30)

**Ziel:** `docker compose up` fuer Freunde, in <5 min lauffaehig.

**Tasks:**
- Multi-Stage Dockerfile: deps, builder, runner
- yt-dlp im runner-Stage installiert (apk add yt-dlp falls Alpine, sonst pipx)
- ffmpeg im runner-Stage (yt-dlp braucht's fuer manche Formate)
- docker-compose.yml: image, port-mapping, volumes (data/), env-vars
- Health-Check Endpoint `/api/health`
- README.md final mit:
  - Voraussetzungen (Docker, Browser)
  - Cookie-Extraction-Anleitung mit Screenshots
  - `docker compose up`
  - Troubleshooting (abgelaufene Cookies, Port-Konflikte)
  - FAQ (warum kein Auto-Cart? Bandcamp-ToS-Hinweis fuer Self-Host-Nutzer)
- Erste Smoke-Tests:
  - Marco auf eigenem PC
  - 1-2 Freunde im Freundeskreis

**Acceptance Criteria:**
- Auf einem frischen PC (oder VM): `git clone` + `docker compose up` → Tool laeuft in <5 min
- Cookie-Onboarding klappt
- Owned-Sync laeuft, Tracks erscheinen, Player spielt

**Risiken:**
- yt-dlp-Installation in Alpine vs Debian: Debian-base ist leichter, aber groesser
- Volume-Permissions auf Linux vs Windows-Docker (host vs WSL)
- Erste Friends-Tests werden Bugs aufzeigen, Buffer fuer 5 Tag fix

**Codex-Review-Fokus:** Dockerfile-Security (no-root, COPY-Leaks), Volume-Layout, README-Vollstaendigkeit.

---

## Codex-Review-Loop (pro Phase)

1. Phase fertig → Self-Test (npm run dev, manuelle Smoke)
2. Codex-Agent: Code-Review-Pass mit Fokus aus Phase
3. Marco-Style-Bewertung: was sehe ich auch so → fixen
4. was ist Codex-Sicht aber nicht meine → diskutieren oder skippen mit Begruendung
5. Codex-Review #2 (selber Fokus, nach Fixes)
6. Final-Fixes
7. Phase-Commit `git tag phase-X`
8. Phase X+1

## Erwartung an Iteration 1 (heute Nacht)

Realistisch in 8-10 h echte Arbeit:
- Phase 0 vollstaendig (incl. 2 Codex-Reviews)
- Phase 1 vollstaendig (incl. 2 Codex-Reviews)
- Phase 2 angefangen, evtl. die Haelfte

Marco prueft morgen frueh: `npm run dev`, Cookie-Onboarding, Owned-Sync. Phase 2-6 in Folgesessions.
