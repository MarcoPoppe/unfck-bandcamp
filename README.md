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
- Bandcamps ToS verbietet automatisierte Zugriffe auf ihre Inhalte. Self-Host fuer den eigenen Account ist im legalen Graubereich, aber Bandcamp hat das Recht, deinen Account zu sperren wenn sie dich erwischen. **Nutzung auf eigene Verantwortung.**

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

## Roadmap

Siehe `PLAN.md`. Phase 0-6 sind in Git-Tags `phase-0` bis `phase-6` festgehalten. Phase 6 (this) liefert Docker-Distribution + dieses README.

Geplant fuer kommende Phasen (nicht commitet):
- Diggers-Discovery (BC-User mit Geschmacks-Overlap)
- Discovery-Audio-Stream (in-app Playback fuer noch-nicht-gekaufte Tracks)
- Custom-Domain Artist-Resolution
- Encrypted-Cookies-At-Rest

## Lizenz

MIT. Siehe [LICENSE](LICENSE).

### Third-party notices

Transitive Abhaengigkeiten enthalten Pakete unter eigenen Lizenzen, darunter LGPL-3.0-or-later (z.B. `@img/sharp-libvips*` ueber `next/image`'s `sharp`-Optimierung). Diese sind unveraendert eingebunden; ihre Nutzungsbedingungen gelten ergaenzend zur MIT-Lizenz dieses Projekts. Vollstaendige Liste via `npm ls --all`.
