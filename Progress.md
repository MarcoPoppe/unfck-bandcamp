# Unfck Bandcamp

**Version:** 2.4.7 (siehe `package.json`)
**Status:** Tauri-Installer läuft Ende-zu-Ende. v2.4.3-2.4.5 waren eine Bug-Kaskade (Node-ABI, CORS, Asset-Bundling). v2.4.6 ist der erste Build wo die App vollständig rennt: gestylt, hydriert, Library-Sync 38 items. Sammelt Folge-UX-Fixes nach Marcos erstem Test (Username-Anzeige, Curators-API-URL, neues Logo, Update-Button).
**Release:** https://github.com/MarcoPoppe/unfck-bandcamp/releases/latest
**Repo:** https://github.com/MarcoPoppe/unfck-bandcamp (public seit 2026-05-04, GH-Actions sind damit unlimited gratis).
**Zielplattform:** Tauri-Installer pro OS via GitHub Releases + Auto-Updater. Self-Host via Docker Compose / `npm run dev` bleibt Option für Power-User.

## Stack

- Next.js 16.2.4 (App Router) + TypeScript strict + Tailwind 3
- better-sqlite3 12.9.0 (WAL mode, IMMEDIATE-Tx, instrumentation hook auto-migrates)
- cheerio 1.0.0, zustand 5.0.1, wavesurfer.js 7.8.6, react-virtuoso 4.18.6
- realtime-bpm-analyzer 5.0.12 (Offline-Detection via AudioContext)
- yt-dlp 2026.03.17 (sha256-pinned)
- **Tauri 2.11** + plugin-updater + plugin-shell + plugin-log + plugin-process
- ed25519-signed updates über GitHub Releases
- Node 22.11.0 als externalBin im Bundle

## Seiten / Module

| Pfad | Status | Zweck |
|---|---|---|
| `/` | done | Home-Dashboard mit 6 Stat-Cards, Sync-Health, Recently-Played |
| `/setup` | done | 2-Step-Wizard (Burner + Your account), Diagnostics, Sync, App-window-Section mit Browser-Button (ab v2.4.2) |
| `/tracks` | done | Library mit Search/Sort/Archived/Lookup, TrackRow filigree |
| `/discover` | done | 4 Tabs (New / Follows / Curators / Lookup) mit Multi-Select, Search, X-Symbol an Mark-seen |
| `/wishlist` | done | Open/Bought/Dismissed mit Multi-Select, Search, Auto-Mark-as-Bought |
| `/playlists`, `/playlists/[id]` | done | Hand-curated Setlists mit Reorder + Search (Reorder disabled wenn Search aktiv) |
| `/labels`, `/label/[id]` | done | Label-Index + Label-Detail mit Releases gruppiert, Card-Look |
| `/history` | done | **Alle Plays ever**, aggregiert pro Track mit `play_count`-Badge, best Completion, Search |
| `/track/[bcTrackId]` | done | Track-Permalink mit 2-Stage-Lookup (bcUrl-Fallback aus discovered_tracks/wishlist), Custom-Error-Page |
| `/artist/[bcBandId]` | done | Artist-Detail mit Library-Owned + BC-Releases inline-aufklappbar, ReleaseRow als Card |
| `/digger/[bcFanId]` | done | Curator-Profil mit Search, EP-aufklappbar (großer Pfeil-Toggle), Sub-Tracks compact |
| `/u/[username]` | done | Anonymes BC-User-Profil |
| `/api/...` | done | Health, Diagnostics, Auth (validate/suggest/status/logout/avatar), Sync (owned/tracks/discovery/diggers/follows), Audio-Stream, CRUD, Lookup |

## Architektur-Kerne (relevant für neue Sessions)

- **Single Source of Truth Tracklist:** `<TrackRow>` (Phase AI). Slot-API: `variant`, `position`, `reorderControls`, `selectable`, `trailing`, `expandedContent`, `badges`, `titleHref`, `hideAlbumColumn`, `hideDuration`, `partialPlayedFraction`. Action-Bar via `<TrackActionsBar>` mit Lazy-Resolve für nicht-importierte Curator-Items.
- **Filigree-Werte (v2.1.6+):** `p-2` padding, `h-8 w-8` Play, `h-10 w-10` Cover, `text-sm` Title, `text-xs` Meta, `gap-2/sm:gap-3`, `rounded-lg border bg-bg-surface`. Alle Renderer (TrackRow, Wishlist, History, Label, Artist-ReleaseRow) auf gleiche Werte.
- **Auth-Split (Phase AF, Mig 17):** auth-Tabelle role-tagged (crawler/main).
- **Stage-and-Swap im digger_collection-Crawl** (Mig 18, staged_run_at).
- **Tauri-Sidecar-Pattern (Phase AJ):** Im Release-Build spawnt Rust einen Node-Sidecar (`server.js` mit `PORT=3457`, `DATABASE_PATH=<app_data>/data/unfck.db`). Node ist als `externalBin` im Bundle (Naming `node-<TARGET_TRIPLE>[.exe]`). Im Debug-Mode läuft `npm run dev` als beforeDevCommand, Sidecar-Spawn übersprungen.
- **Auto-Updater:** ed25519-signed manifests, Endpoint `releases/latest/download/latest.json`. UpdaterBanner React-Component polled bei Mount + 24h.
- **Search-Pattern (v2.3.0+):** `<TrackListSearch>` Component, clientseitig filtern auf title+artist+album, eingebaut auf History/Wishlist/Discover/Curator/Playlist. Library hat eigene Search.
- **Sidecar-Diagnostik (v2.4.2+):** stdout/stderr werden via `CommandEvent` in tauri-plugin-log gepumpt → app-log directory. F12-DevTools auch in Production aktiv.

## Bekannte offene Punkte

- **🔴 v2.4.4 Build läuft, noch nicht getestet.** Drei Fixes: Node 22 in CI (matchen mit bundled Node 22), Splash-Probe via Tauri-IPC (CORS umgangen), Stale-Sidecar-Schutz (kein zweiter Spawn wenn Port belegt).
- **Embedded-Login Cookie-Extraction** (Tauri-2-Webview-Cookie-API plattform-spezifisch). Aktuell Stub mit URL-Polling. Setup-Wizard fällt graceful auf Cookie-Paste zurück. Geplant für v2.5.0.
- **UpdaterBanner UX** (v2.5.0): Fortschritts-Bar + Status-Stages („Downloading 45 %" → „Verifying" → „Installing"). Aktuell nur „Installing…"-Text ohne Fortschritt.
- **Code-Signing** weiter übersprungen (out of scope für Friend-Test).
- **Friend-Test noch nicht gestartet** — wartet auf v2.4.3 Selbst-Test durch Marco.

## Letzte Änderungen (Session 2026-05-04)

Sehr lange Session. Komplette Tauri-Distribution + viele UI-Loops.

### Tauri-Distribution + Auto-Updater (v2.0.0 → v2.0.1)
- Plan 1+2 aus `docs/specs/` durchgezogen: TrackRow-Unification (v1.45.0) + Tauri-Bootstrap.
- GH-Actions-Pipeline für Win/macOS-arm64/macOS-x86_64/Linux mit ed25519-Signing.
- v2.0.1 Hotfix für `latest.json`-Generation (`createUpdaterArtifacts: true`).

### UI-Polish-Loops (v2.1.x)
- v2.1.0: Card-Look, Checkbox vor Play, BC-Link rausgenommen aus TrackRow → neuer `<OpenOnBandcampButton>` auf 4 Detail-Page-Headern, EP-Row minimal, Archive-Auto-Hide.
- v2.1.1: TrackRow-Höhe an Wishlist-Referenz angeglichen (h-9/h-12/p-3).
- v2.1.2: History/Label/Artist-ReleaseRow ebenfalls auf gleiche Höhe gebracht (Marco's UI-Konsistenz-Regel — Memory `feedback_ui_konsistenz_alle.md`).
- v2.1.3: Wishlist BC-Button raus, OpenOnBandcampButton ohne grauen Hintergrund, Archive auf Track-Detail-Page raus, 404-Page Open-Button als Symbol.
- v2.1.4: Meta-Zeilen in TrackRow auf 1 Zeile mit `·`-Trennzeichen kondensiert, StickyPlayerBar Open-on-bandcamp → AddToPlaylistButton.
- v2.1.5: Counter-Pillen weg (HidePlayedToggle + Hide-curators), `<LazyAddToPlaylistButton>` für Player-Lazy-Resolve, Track-Permalink 2-Stage-Lookup (bcUrl aus discovered_tracks/wishlist als Fallback).
- v2.1.6: Cards filigraner überall (p-2, h-8 Play, h-10 Cover, text-sm Title, text-xs Meta), X-Symbol an Mark-seen-Buttons.

### History v2 (v2.2.0 → v2.3.0)
- v2.2.0: History zeigt alle Plays ever (LIMIT 0 = unlimited), Cover lazy-loaded.
- v2.3.0: `listPlaysAggregated()` mit GROUP BY track_id (`play_count`, `lastPlayedAt`, `bestCompletedPct`). Skipped vs Played wording vereinheitlicht. Neuer `<TrackListSearch>` Component eingebaut auf History/Wishlist/Discover/Curator/Playlist.

### Tauri Distribution v2 (v2.4.0 → v2.4.4)
- v2.4.0: Node 22.11.0 als externalBin in den Installer gebundelt — keine Vorbedingungen mehr auf User-Rechner. Bundle-Größe ~80MB. README für Friend-Test umgeschrieben.
- v2.4.1: Splash-Screen mit echtem Logo (statt Text), App-Icons aus Wordmark-Source generiert (`tauri icon`), Cargo-Warnings cleanup, GH-Actions auf Node 24.
- v2.4.2: Sidecar-stdout/stderr in Tauri-Log gepumpt, F12-DevTools in Production, progressive Splash-Diagnostik (5/15/60s), Browser-Button im /setup.
- v2.4.3: Sidecar-CWD-Fix + extended-length-path-Strip. Server startete, scheiterte aber an better-sqlite3 NODE_MODULE_VERSION-Mismatch + CORS auf der Splash-Probe.
- v2.4.4: drei Fixes nach Marco's Logs:
  - **CI Node 20 → 22**: `npm ci` lief mit Node 20, prebuild-install zog NODE_MODULE_VERSION 115 binary. Runtime ist aber Node 22 (NODE_MODULE_VERSION 127). better-sqlite3 crashte mit ERR_DLOPEN_FAILED beim Laden im instrumentation hook → 500 auf jedem Request.
  - **Splash auf Tauri-IPC**: `wait_for_server` Tauri-Command (Rust-side TCP-connect-Probe) statt cross-origin fetch. Vermeidet das tauri.localhost ↔ 127.0.0.1:3457 CORS-Problem ohne API-Surface zu öffnen. `withGlobalTauri: true` in tauri.conf für `window.__TAURI__.core.invoke` im Vanilla-JS-Splash.
  - **Stale-Sidecar-Schutz**: setup() prüft `is_port_listening(3457)` vor Spawn. Vermeidet EADDRINUSE-Folgefehler wenn ein vorheriger Node-Prozess noch hängt.
- v2.4.5: Asset-Bundling für next standalone gefixt:
  - **`.next/static/` und `public/` in standalone-Tree kopiert** über erweiterten `tauri-prepare-shell.mjs`. next build mit `output: 'standalone'` lässt die Ordner aus, doku-bekannt. Ohne Copy: Server rendert SSR-HTML, aber CSS/JS-Chunks 404 → React hydratisiert nie → ungestylte UI mit toten Forms.
  - **`tauri.conf.json` resources auf nur `../.next/standalone/**/*` reduziert**, statt drei separate Globs die das Bundle-Layout aufbrechen.
- v2.4.6: erste echte Test-Findings nach v2.4.5-Selbsttest:
  - **Square-Logo** (Parallelogramm + Brushwordmark) ersetzt das alte Wordmark-only über `npx tauri icon` für alle Größen + `.ico`/`.icns`.
  - **Follow-Import Cookie/fanId-Mismatch**: `following_bands`-Endpoint gab `[]` zurück weil targetFanId=main aber cookie=burner. Jetzt als Pair gewählt.
  - **Display-Username konsistent** mit Avatar: Header und Home-Greeting nehmen Main-Username wenn linked, statt Burner.
  - **Curators-API URL**: Client rief `/api/sync/curators` und `/api/curators/[id]`, Routes heißen aber `/api/sync/diggers` / `/api/diggers/[id]` (interne Tabellen-Convention). 404 → HTML-Antwort → JSON-Parse-Crash.
  - **Shortcuts-Editor**: leere "Filters (on Tracks page)"-Group wird jetzt nicht mehr als Header gerendert.
  - **About-Panel auf /setup**: Version-Anzeige + manueller "Check for updates"-Button im Tauri-Build, mit Hinweis für Web/Docker-Builds dass Auto-Update desktop-only ist.
  - **"my owned releases" → "my library"** in Discover-Curator-Source-Picker für Konsistenz mit dem Nav-Label.

### Repo + Workflow
- Repo public gemacht (Marco's Bestätigung): GH-Actions sind damit unlimited gratis, Friends können direkt von Releases-Page laden.
- Memory `feedback_ui_konsistenz_alle.md`: UI-Regeln gelten überall, nicht nur primärer Renderer.
- Memory `project_unfck_bandcamp_ep_actions_idea.md`: EP-als-Ganzes hearten/playlistten als Feature-Idee geparkt.
- **Release-Discipline ab jetzt:** Patches sammeln auf master, nur taggen wenn Marco "ja release" sagt oder mehrere Changes da sind. Nicht mehr nach jedem Patch.

## Nächste Session

1. **Marco testet v2.4.3 Installer.** Wenn Splash durchläuft → Selbst-Test komplett, dann Friend-Test mit 1-2 Leuten. Wenn Splash weiter hängt → v2.4.2's `[sidecar]`-Logs zeigen den echten Grund.
2. **v2.5.0 Plan**: UpdaterBanner Fortschritts-Bar + Embedded-Login Cookie-Extraktion fertig.
3. **Geordnete Releases**: erst sammeln, dann taggen. Nicht jeder commit ein Tag.
