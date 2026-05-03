# Unfck Bandcamp

Self-Host-Tool, das Bandcamps Track-Suche durch ein Beatport-aehnliches UI ersetzt. Eigener Player mit Wavesurfer-Waveform, lokale Audio-Cache, Wishlist mit Auto-Mark-as-Bought, Following von Artists und Discovery-Feed, Tags, Playlists, Listen-History.

**Self-Host nur.** Kein zentraler Server, keine Cloud, kein Multi-Tenant. Du laeufst eine eigene Instanz auf deinem Geraet, mit deinem Bandcamp-Account.

## Voraussetzungen

- **Docker** + **Docker Compose** (empfohlene Variante), oder
- **Node.js 22+** + **yt-dlp** + **ffmpeg** lokal (Dev-Variante)
- Ein **Bandcamp-Account** mit Cookies, die du gleich extrahierst.

## Quickstart (Docker)

```bash
git clone <repo-url> unfck-bandcamp
cd unfck-bandcamp
mkdir -p data/audio_cache    # auf Linux: anschliessend `sudo chown -R 1001:1001 data`
docker compose up -d --build
```

**Erstbuild dauert erfahrungsgemaess 5-10 Minuten** (Node-Image, apt-get fuer ffmpeg/python3, native better-sqlite3 Compile, `npm ci`, `next build`, yt-dlp-Download). Danach laeuft `docker compose up -d` in unter 30 Sekunden.

Tool laeuft auf <http://localhost:3457>. Beim ersten Aufruf wirst du auf `/setup` umgeleitet.

Das Compose-File bindet den Port standardmaessig nur an `127.0.0.1`. Wenn du es ueber LAN erreichbar machen willst, **musst** du einen authentifizierenden Reverse-Proxy davor stellen (Caddy, Traefik mit BasicAuth, etc.) und dann `BIND_HOST=0.0.0.0 docker compose up -d` aufrufen. **Niemals ohne Auth direkt ans Internet exposen** — die `/api/auth/*` Routen sind loopback-only abgesichert, aber dein Bandcamp-Cookie liegt unverschluesselt in der lokalen DB.

## Quickstart (lokal, Dev)

```bash
npm install
npm run migrate
npm run dev
```

Browser: <http://localhost:3457>.

## Cookies extrahieren (5 min)

1. Auf <https://bandcamp.com> einloggen.
2. **F12** → Tab **Network**.
3. **F5** (Seite neu laden).
4. Ersten Eintrag im Network-Panel anklicken (meist `bandcamp.com`).
5. Rechte Spalte → Tab **Headers** → Section **Request Headers**.
6. Zeile finden, die mit `Cookie:` anfaengt → Rechtsklick → **Copy value** (alternativ String markieren und kopieren).
7. Auf der `/setup`-Seite den String in das Textfeld einfuegen, **Cookies validieren** klicken.
8. Sobald `Eingeloggt als <username>` erscheint, **Sync starten**.

Wer das automatisieren will, kann die Cookies auch in eine Datei `data/bc_cookies.txt` legen — die UI fragt sie beim ersten Aufruf automatisch ab und befuellt das Textfeld.

**Wichtig:** Loesche `data/bc_cookies.txt` wieder, sobald die Cookies erfolgreich in der DB sind. Die Datei ist via `.gitignore` vom Repo ausgeschlossen, aber unverschluesselt auf der Platte.

## Was kann das Tool

**`/tracks`** — flache Beatport-Style Liste deiner kompletten Bandcamp-Collection (Albums werden in einzelne Tracks zerlegt). Klick Play → spielt im fixed-bottom Sticky-Player mit Wavesurfer. AWSD-Shortcuts: `A`/`D` = vor/zurueck, `Space` = play/pause.

**`/discover`** — neue Tracks von gefolgten Artists. Folgst du jemandem unter `/follows`, dann erscheinen seine neuen Releases hier (Discovery-Sync per Knopfdruck).

**`/follows`** — Artists / Labels / Diggers folgen, jeweils per Bandcamp-URL. **Discovery-Sync** Button crawled die `/music`-Pages der followed Artists und schreibt Tracks in `discovered_tracks`.

**`/wishlist`** — Tracks markieren, die du auf Bandcamp kaufen willst. Direktlinks zur BC-Item-Page. Beim naechsten Owned-Sync werden gekaufte Tracks **automatisch** als gekauft markiert (auto-match via `bc_track_id`). Manuell als gekauft markieren / dismissen / re-open ist ueber Multi-Select moeglich.

**`/playlists`** — eigene Track-Sammlungen, manuell zusammengestellt. Drag-and-Drop Reorder, Tracks aus `/tracks` ueber den `+`-Button im TrackRow hinzufuegen.

**`/tags`** — frei vergebbare Labels (z.B. "Sommer 26", "Set XYZ"). Per `+`-Button in TrackRow zuweisbar.

**`/history`** — letzte 200 Plays mit Cover, Artist, Completion-Prozent, Zeitstempel. Plays werden auto-recordet, sobald ein Track > 1s und mind. 10 % Dauer gespielt wurde.

## Konfiguration

Siehe `.env.example`. Die wichtigsten Variablen:

- `PORT=3457` — Port, auf dem das Tool laeuft
- `DATABASE_PATH=./data/unfck.db` — SQLite-DB-File
- `AUDIO_CACHE_DIR=./data/audio_cache` — lokaler MP3-Cache
- `MAX_AUDIO_CACHE_BYTES=2147483648` — Cache-Cap (default 2 GiB, LRU-by-atime Eviction)
- `DISCOVERY_RELEASES_PER_ARTIST=12` — Limit pro Artist beim Discovery-Crawl

## Architektur

- **Single-Tenant pro Instanz.** Keine Multi-User-DB, keine Cloud-Auth.
- **Stack:** Next.js 16 (App Router) + TypeScript strict + Tailwind + better-sqlite3 + cheerio + Zustand + wavesurfer.js + yt-dlp.
- **DB:** SQLite unter `data/unfck.db` (WAL mode). Migrations laufen automatisch beim Server-Start via `src/instrumentation.ts`.
- **Audio:** Cache-First. `/api/audio/stream?id=…` liefert aus `data/audio_cache/track_<id>.mp3` mit voller Range-Support, faellt bei Cache-Miss auf Bandcamps signed URL zurueck und schreibt parallel in den Cache fuer das naechste Mal.
- **Discovery:** Bandcamps `/<artist>/music` Seite wird gecrawlt mit 350 ms Cooldown zwischen Batches von 3 parallelen Release-Fetches. `data-tralbum` Attribut wird geparst um Track-IDs + signed mp3-128 URLs zu extrahieren.

## Sicherheits-Hinweise

- Bandcamp-Cookies liegen **unverschluesselt** in `data/unfck.db` (Tabelle `auth`). Wer die DB-Datei hat, kann sich als du auf bandcamp.com einloggen. **Niemals `data/` oder `data/unfck.db` an andere weitergeben.** Wenn du das Tool an Freunde weitergibst, schickst du **nur das Repo / Image**, nicht deinen `data/`-Ordner. Sie machen ihren eigenen Setup-Flow mit ihren eigenen Cookies.
- Backup-Strategie vor jedem Update: `cp data/unfck.db data/unfck.db.bak && cp -r data/audio_cache data/audio_cache.bak`. Migrations laufen automatisch beim Container-Start; wenn eine fehlschlaegt, kannst du mit dem Backup zurueck.
- Alle nicht-public API-Routen sind **loopback-only** (Host-Header + X-Forwarded-For-Pruefung; `127.0.0.1`/`::1`/`localhost` ok, alles andere 403). Konkret: `/api/auth/validate`, `/api/auth/suggest`, `/api/auth/status`, `/api/sync/owned`, `/api/sync/tracks`, `/api/sync/discovery`, `/api/audio/stream`, `/api/follow`, `/api/wishlist`, `/api/tags`, `/api/playlists`, `/api/plays`. Lesende Endpunkte (`/api/auth/status`, `/api/auth/suggest`) sind ebenfalls geschuetzt, weil sie Identitaets- bzw. Cookie-Daten zurueckgeben. Defense-in-Depth: docker-compose bindet den Host-Port standardmaessig nur auf `127.0.0.1`.
- Bandcamps ToS (Acceptable Use Policy) verbietet automatisierte Zugriffe explizit. **Öffentlich dokumentierte Account-Bans wegen Scraping gibt es Stand 04/2026 nicht** — die jüngste Banwelle 2024/2025 betraf AI-generierten Content, nicht Scraping. Bandcamp hat aber das Recht, deinen Account jederzeit zu sperren wenn sie automatisierten Zugriff bemerken.
- **Realistisch beobachtetes Verhalten:** Cloudflare Bot Management drosselt IPs bei zu vielen Requests (etwa ab 5+/min) auf 10-30 Min temporäre Blocks. Das hast du auch ohne Sperre gegen dich. Wir machen 350ms zwischen Batches und max. 3 parallele Fetches — konservativ genug für Solo-Use.
- **Risikoprofil:** Solo-Nutzung mit eingeloggten Cookies fällt vermutlich unter normale Heavy-User-Aktivität. Verteilung an viele User über einen gehosteten Service erhöht das Risiko deutlich (Pattern wird auffällig). **Nutzung auf eigene Verantwortung.**

### Linux-Bind-Mount Permissions

Auf Linux laeuft der Container als UID 1001. Wenn dein `data/` auf dem Host einem anderen Nutzer gehoert, kann der Container nicht schreiben. Fix:

```bash
mkdir -p data/audio_cache
sudo chown -R 1001:1001 data
```

Auf macOS und Windows mit Docker Desktop ist das normalerweise transparent gehandled.

## Troubleshooting

**`/setup` zeigt "cookies are missing identity or js_logged_in marker"**
Du hast nicht den vollstaendigen Cookie-String kopiert. Stelle sicher, dass `identity=…` und `js_logged_in=1` enthalten sind.

**`/setup` zeigt "bandcamp.com returned 403 during cookie validation"**
Cookies sind abgelaufen. Neu einloggen auf bandcamp.com, neue Cookies extrahieren, in `/setup` paste.

**Sync laeuft an "could not resolve bandcamp username for these cookies"**
Bandcamp hat sein Layout geaendert (selten, aber moeglich). Issue im Repo aufmachen mit dem extrahierten Cookie-String (NICHT public im Issue posten, nur DM).

**Owned-Sync zeigt 0 wishlist-auto-marked obwohl ich Albums gekauft habe**
Albums werden erst beim Track-Expand in einzelne Tracks zerlegt. `/wishlist` macht das automatisch (2-step-Flow), `/api/sync/owned` allein nicht. Klick "Owned-Sync (Auto-Mark)" auf der Wishlist-Page.

**Track laesst sich nicht abspielen**
Stream-URL-Cache veraltet (Bandcamp-Tokens sind ~30 min gueltig). Refresh laeuft automatisch beim naechsten Klick. Wenn Problem persistiert: F12 → Console → siehe Fehlermeldung von `/api/audio/stream`.

## Was seit Phase 6 dazu gekommen ist (v1.7+)

Die Sektionen oben beschreiben das Tool wie es zu Phase 6 stand. Hier die
zusätzlich gebauten Features:

**Discovery erweitert** — Diggers (= andere Bandcamp-User die du folgst)
sind jetzt vollständig integriert: ihre Profile sind crawlbar
(`/digger/[bcFanId]` und `/u/[username]`), ihre Collection wird gepullt,
und Discovery-Sync zieht Tracks aus ihren Collections genauso wie aus
gefolgten Artists. "Refresh discovery"-Button mit Live-Progressbar
(polled `sync_runs` alle 1.5s).

**Best of all Supporters** — auf jeder Track-Permalink-Page
(`/track/[bcTrackId]`): crawlt alle Bandcamp-Supporter dieses Tracks
durch ihre Recent-Collection und aggregiert "welche Items teilen sie".
Ist quasi eine Discovery-Engine basierend darauf, was Leute mit
demselben Geschmack noch gekauft haben.

**EP-Expand** — Album-Items in jeder Liste haben einen Chevron, der die
Tracklist inline ausklappt. EP als Ganzes spielen + A/D durchläuft alle
Tracks. Plus Auto-Expand: wenn der Player A/D auf eine EP trifft, wird
sie automatisch resolved und der erste Track gestartet.

**Hide played + Mark unplayed** — globaler Toggle "Hide played" in jeder
Liste blendet gehörte Tracks aus (persistiert in localStorage). Klick
auf den grünen Haken markiert einen Track wieder als ungehört
(WhatsApp-Style "mark as unread"). EPs gelten als "fully heard" wenn
alle ihre Tracks gehört wurden — server-side join über
`tracks.bc_album_id` und `tracks.album_url` mit Reconcile-Pass beim
Page-Load (heilt legacy-NULL-Spalten in der DB).

**Live-State-Sync via Player-Store** — `playedBcTrackIds` und
`wishlistedBcTrackIds` als Sets im Zustand-Store. Wenn du im Player das
Herz drückst, leuchtet das Heart-Icon **sofort überall** wo dieser
Track gerendert wird. Hydration in AppShell beim ersten Mount.

**Beatport-Style Player-Bar** — Cover + Title/Artist/Album links, Time-
Block (elapsed / total / BPM-Slot), große Waveform mittig, Transport-
Cluster rechts (Wishlist-Heart, Open-on-Bandcamp, prev, big-Play, next).
WaveSurfer mit eigenem Audio-Element (für Browser-Autoplay-Unlock auf
ersten User-Gesture).

**Klickbarkeit überall** — Title, Artist, Label, Cover sind in jeder
Liste `<a>`-Tags zu den entsprechenden Detail-Pages. Mittelklick öffnet
saubere neue Tabs. Server-Side Redirect-Routes `/track/go?url=` und
`/artist/go?url=` resolved BC-URLs zu lokalen IDs und 302'n weiter.

**Like-Shortcut** — `W` (default, in `/setup` änderbar) fügt den aktuell
laufenden Track zur Wishlist hinzu, ohne maus.

**`/label/[id]`-Page** — Label-Übersicht mit Cover, Follow-Toggle und
allen Releases gruppiert nach Album.

**Discovered-Track-Source-Anzeige** — auf jedem Discover-Tab-Track
steht "via leonlicht" / "via [Artist-Name]" je nachdem woher er kommt.

**Player-Resilience** — drei Watchdogs gegen wedged Player:
`decodingRef` Reset im track-change Effekt, AbortController-Timeouts
(10s) für Album-Fetch und Track-Lookup, plus 30s-Watchdog auf das
`ready`-Event von WaveSurfer mit Auto-Skip wenn nichts kommt.

**Audio-Stream Re-Architecture** — Cache-First: Bei Cache-Miss wird
synchron auf `cacheStream` gewartet (eine BC-Connection statt zwei),
dann von Disk gestreamt. Verhindert Rate-Limit-Stalls bei BC nach
großen Discovery-Syncs. Audio-Prefetch wurde dafür entfernt — erste
Wiedergabe pro Track ist jetzt 2-5s langsamer, aber zweite Wiedergabe
ist instant und der Player wedget nicht mehr.

## Bereitstellung an andere Leute

### Aktueller Stand

- Es gibt **keinen klassischen Login-Screen**. Jeder User muss seine
  eigenen Bandcamp-Cookies aus seinem Browser kopieren und auf
  `/setup` einfügen (siehe Anleitung oben).
- Es gibt **keinen Installer**. Der Empfänger braucht entweder Docker
  oder Node.js und CLI-Erfahrung.
- Es gibt **kein Auto-Update**. `git pull && docker compose up -d --build`
  ist der manuelle Pfad.

### Optionen für sinnvolle Distribution

Sortiert nach Aufwand:

#### Option A: ZIP + Anleitung (klein, ~2-3h)

Empfänger kriegt:
1. Repo-ZIP oder GitHub-Link
2. README mit Schritt-für-Schritt-Anleitung
3. `docker compose up -d --build` als Einzeiler

Funktioniert für tech-savvy Leute. Setup-Aufwand für den Empfänger:
~10 min wenn er Docker hat, ~30 min wenn er es zuerst installieren
muss.

#### Option B: Tauri-Wrapper als Desktop-App (mittel, ~1-2 Tage)

Tauri macht aus der Next.js-App eine native Desktop-App
(.exe / .dmg / .deb / .AppImage). Vorteile:

- Single-File-Download, Doppelklick startet
- Kein Docker, kein Node nötig auf Empfänger-Seite
- ~5 MB Bundle (Tauri nutzt System-Webview statt eigenes Chrome)
- Auto-Update über GitHub Releases möglich
- Bundled SQLite + lokales Audio-Cache-Verzeichnis

Was zu tun ist:
- Tauri-Projekt initialisieren (`cargo install tauri-cli`,
  `tauri init`)
- Next.js auf Static-Export umstellen oder Sidecar-Server-Modus
- Build-Pipeline für die drei OS-Targets
- Optional: Code-Signing für Mac (Apple Developer ID, ~99€/Jahr)

#### Option C: Embedded-Browser für Cookie-Login (oben drauf, ~1 Tag)

Wenn schon Tauri/Electron: beim ersten Start öffnet die App ein
Bandcamp-Login-Webview. User loggt sich normal ein, Wrapper extrahiert
Session-Cookies direkt aus dem Webview. Kein Copy-Paste mehr.

Das macht die UX wirklich freundlich — der Empfänger sieht nichts mehr
von "Cookies kopieren", sondern bekommt einen normalen Login-Flow.

#### Option D: Hosted Multi-User-Service (groß, ~2-3 Wochen)

Single-User → Multi-Tenant. Erfordert:
- Eigenes Auth-System (Login + DB pro User)
- Server-Hosting (VPS, mind. 2 GB RAM, Disk für Audio-Caches aller User)
- BC-Cookie-Management server-side (Encrypted, Rotation, etc.)
- **Hohes ToS-Risiko**: BC verbietet automatisierten Zugriff. Ein
  öffentlich gehosteter Service zieht das in den scharfen Bereich,
  realistisch sperren sie deine IP/Account-Pool als ersten Schritt.

**Nicht empfohlen** ohne starke rechtliche Klärung.

### Empfehlung

Wenn du das ernst meinst und an mehrere Leute verteilen willst:
**Option B + C kombiniert** (Tauri + Embedded-Browser-Login). Das ist
~3 Tage Arbeit für mich, danach hast du einen Installer pro OS, der
den User ohne CLI-Wissen funktioniert.

Wenn es nur 1-2 Leute mit Tech-Background sind: **Option A** reicht
und kostet keine 3 Stunden.

Sag Bescheid wenn du B+C willst — dann mache ich einen separaten Plan
mit konkreten Steps.

## Roadmap

Siehe `PLAN.md` und `Progress.md`. Phase 0-V sind durch.

**Bekannte offene Punkte:**

- **BPM-Detection**: einmal angefangen via `realtime-bpm-analyzer`,
  hat den Audio-Routing-Pfad zerstört (`createMediaElementSource` darf
  nur einmal pro Audio-Element gerufen werden). Fix-Aufwand: ~1.5h mit
  persistentem MediaElementSource der einmal beim Mount erstellt wird.
- **EP-Played Live-Update ohne Reload**: aktuell wird ein Album als
  "fully heard" erst nach Page-Reload markiert (server-side join).
  Pro Sub-Track-Play client-side checken ob alle siblings played sind.
- **Like/Dislike-Rating** wieder einbauen, falls gewünscht.
- **Mobile-Layout** falls jemand das wirklich braucht.
- **Beatport-/RA-Integration** als zusätzliche Discovery-Quelle.

## Lizenz

MIT. Siehe [LICENSE](LICENSE).

### Third-party notices

Transitive Abhaengigkeiten enthalten Pakete unter eigenen Lizenzen, darunter LGPL-3.0-or-later (z.B. `@img/sharp-libvips*` ueber `next/image`'s `sharp`-Optimierung). Diese sind unveraendert eingebunden; ihre Nutzungsbedingungen gelten ergaenzend zur MIT-Lizenz dieses Projekts. Vollstaendige Liste via `npm ls --all`.
