# Unfck Bandcamp

**Version:** 2.4.14 (siehe `package.json`)
**Status:** Tauri-Installer läuft Ende-zu-Ende. Auto-Update funktioniert ab v2.4.9. Tray-Toggle ab v2.4.13. Release-Matrix auf 2 Targets getrimmt (Apple Silicon + Windows x64), 6 Assets pro Release.
**Stack:** Next.js 16.2.4 + TypeScript + Tailwind 3, better-sqlite3 12.9.0 (WAL), Tauri 2.11 (devtools + tray-icon), Plugin-Updater + Plugin-Process + Plugin-Shell + Plugin-Log, Node 22.11.0 als externalBin.
**Repo:** https://github.com/MarcoPoppe/unfck-bandcamp (public, 1 star).
**Release:** https://github.com/MarcoPoppe/unfck-bandcamp/releases/latest
**Zielplattform:** Tauri-Installer pro OS via GitHub Releases + Auto-Updater. Self-Host via Docker oder `npm run dev` bleibt für Power-User.

## Seiten / Module

| Pfad | Status | Zweck |
|---|---|---|
| `/` | done | Home-Dashboard mit 6 Stat-Cards, Sync-Health, Recently-Played |
| `/setup` | done | 2-Step-Wizard, Diagnostics, App-window-Section mit Browser + Tray-Toggle, About-Panel mit Update-Check |
| `/tracks` | done | Library mit Search/Sort/Archived/Lookup |
| `/discover` | done | 4 Sub-Tabs (New/Follows/Curators/Lookup), inline Discover-Knopf + Releases-pro-Sync-Settings |
| `/wishlist` | done | Open/Bought/Dismissed, Multi-Select, Search |
| `/playlists`, `/playlists/[id]` | done | Hand-curated Setlists mit Reorder + Search |
| `/labels`, `/label/[id]` | done | Label-Index + Label-Detail |
| `/history` | done | Alle Plays ever, aggregiert pro Track mit play_count |
| `/track/[bcTrackId]` | done | Track-Permalink mit 2-Stage-Lookup |
| `/artist/[bcBandId]` | done | Artist-Detail, von Discover-Follows klickbar |
| `/digger/[bcFanId]` | done | Curator-Profil, Best-of-Supporters-Crawl |
| `/u/[username]` | done | Anonymes BC-User-Profil |

## Architektur-Kerne

- **TrackRow Single Source of Truth** (Phase AI). Slot-API für alle Tracklisten.
- **Filigree-Werte (v2.1.6+):** p-2, h-8 Play, h-10 Cover, text-sm Title.
- **Auth-Split (Mig 17):** auth-Tabelle role-tagged (crawler + main).
- **Tauri-Sidecar:** Rust spawnt Node-Server auf 127.0.0.1:3457. Splash probet via `wait_for_server` Tauri-Command (Rust TCP-connect, kein CORS).
- **Tray-on-Close (v2.4.13):** Rust on_window_event liest File-Flag aus `app_data_dir/minimize_to_tray.flag`. Synchron im Close-Handler. Frontend toggelt via `set_minimize_to_tray` Tauri-Command.
- **Persistenter Player (v2.4.12):** StickyPlayerBar einmal in AppShell gemounted, nicht mehr pro Page. Audio überlebt Navigation.
- **Discovery-Sync-Block (v2.4.12):** Tracks-Liste hidden während Sync läuft, vermeidet DB-Race zwischen User-Plays und Background-Inserts.
- **Auto-Updater:** ed25519-signed `latest.json` auf GH Releases. UpdaterBanner polled bei Mount + 24h. About-Panel hat manuellen Check.

## Aktueller Stand

**Funktioniert:**
- Volle Boot-Kette (Splash → Sidecar → App, Auto-Update)
- Library-Sync (38 items für liebreiz)
- Follow-Import (31 artists, 6 labels)
- Curators-Find mit Self-Exclude
- Plays-Persistenz (Marco hat zurückgenommen, geht doch)
- Player über Navigation stabil
- Asset-Bundling (CSS/JS chunks im Bundle)

**In Arbeit / wartet auf v2.4.14-CI:**
- Tray-Toggle (Rust-Handler statt JS, Marco testet sobald Build durch)
- Cookie-Anleitung als Bilder (Marco hat `docs/HowToCookie.pptx` abgelegt, Integration in Setup-Wizard ausstehend)

**Blockiert / Bekannte Limits:**
- Embedded-Login Cookie-Extract (Tauri-2-Webview-Cookie-API plattform-spezifisch, Stub mit Paste-Fallback)
- Code-Signing (out of scope für Friend-Test)
- macOS-Build-Fail bei v2.4.10 nicht final diagnostiziert (Win lief, hat zur Zeit gereicht)

## Bekannte offene Punkte

- Cookie-Anleitung: PPTX-Slides als PNG ins Setup-Wizard einbetten (`public/setup-guide/`).
- Embedded-Login fertigstellen (geplant v2.5.0).
- UpdaterBanner UX: Fortschritts-Bar mit Status-Stages.
- Plays-Verlust bei Hide-During-Sync: nur UX-Workaround, der echte DB-Race ist nicht behoben.
- EP-als-Ganzes hearten/playlistten (Feature-Idee, geparkt in `project_unfck_bandcamp_ep_actions_idea.md`).
- Find-curators: Cancel-Button für laufenden Sync (UI-only-Hide ist drin, echter Cancel braucht Polling der `sync_runs.status` in den Sync-Loops).

## Nächste Session

1. **v2.4.14 grün abwarten und installieren** (Apple Silicon + Windows). Tray-Toggle echtes Verhalten verifizieren.
2. **Cookie-PPTX in Setup-Wizard integrieren**: Slides als PNG exportieren, in `public/setup-guide/` ablegen, Wizard erweitern.
3. **Friend-Test starten**: 1-2 Leute installieren lassen, Setup-Flow mit echten Cookies durchspielen, Auto-Update über v2.4.14 → nächste Version testen.

## Letzte Session

### Session 2026-05-05 (v2.4.4 bis v2.4.14, 11 Tags, Bug-Kaskade durch)

**Hauptarbeit: Bug-Kaskade nach v2.4.3-Test, dann Stabilisierung, dann Feature-Pflege.**

- **v2.4.4** Node-ABI-Mismatch (CI Node 20 vs Bundle Node 22) + Splash-IPC + Stale-Sidecar.
- **v2.4.5** Asset-Bundling: `.next/static/` und `public/` in standalone-Tree kopiert (next-standalone-Stolperfalle, App rendert SSR-HTML, aber CSS/JS-Chunks 404, keine Hydration).
- **v2.4.6** Logo-Square + Follow-Import-Cookie-Pair + Display-Username konsistent + Curators-API-URL + About-Panel + leere Shortcut-Group + "my library"-Label.
- **v2.4.7 → v2.4.8** v2.4.7 failed (Cargo-Feature `tray-icon` fehlte), v2.4.8 fixt das.
- **v2.4.9** Updater funktionierte nie: `webpackIgnore: true` auf dynamic imports → Browser konnte bare specifier nicht auflösen → silent return null. Entfernt.
- **v2.4.10** Curators-Tab-Badge-Sync + Follow-Import older_than_token Cursor (war null, Bandcamp gab dadurch [] zurück, jetzt seeded mit `<future-ts>:1`).
- **v2.4.11** ACL-Permissions: `core:event:allow-listen`, `core:window:allow-hide/show/close`, `tauri-plugin-process` registriert.
- **v2.4.12** StickyPlayerBar Single-Mount in AppShell, raus aus 10 Pages, Player überlebt Navigation. Hide-Track-Liste während Discovery-Sync (DB-Race-Vermeidung). Followed Artists + Labels klickbar.
- **v2.4.13** Tray-Toggle nach Rust verlagert (JS-Listener griff nicht reliably), Release-Matrix auf Apple Silicon + Win x64 getrimmt, Bundle-Targets auf `["app", "dmg", "nsis", "updater"]`.
- **v2.4.14** Hotfix: Bundle-Targets sind nur `["dmg", "nsis"]` valid, Schema-Error bei `app`/`updater`-Strings.
- **Discover-Knopf + Releases-pro-Sync-Settings** in Empty + Loaded State.
- **Curators self-exclude**: main.fanId statt burner.fanId.
- **Cookie-Anleitung**: Marco hat `docs/HowToCookie.pptx` abgelegt, Integration ins Wizard ausstehend.
- **Repo got 1 star** vom externen User 11ph22il (organic discovery via public-Repo-Crawl).

## Ältere Sessions

- 2026-05-04 (R1): Tauri-Distribution + Auto-Updater (v2.0.0 → v2.0.1), UI-Polish-Loops v2.1.x, History v2 (v2.2.0 → v2.3.0), Node-Bundling v2.4.0 → v2.4.3.
- Vorherige Phasen (A bis AH, MVP bis v1.44): siehe `project_unfck_bandcamp_history.md`.
- Phase AI (v1.45.0): TrackRow-Unification.
