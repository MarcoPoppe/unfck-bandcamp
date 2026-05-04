# Unfck Bandcamp

Self-Host-Tool, das Bandcamps Track-Suche durch ein Beatport-ähnliches UI ersetzt. Eigener Player mit Wavesurfer-Waveform, lokaler Audio-Cache, Wishlist mit Auto-Mark-as-Bought, Following von Artists/Labels/Curators, Discovery-Feed, Playlists, History mit Aggregation und Suche.

**Self-Host nur.** Kein zentraler Server, keine Cloud, kein Multi-Tenant. Du läufst eine eigene Instanz auf deinem Gerät, mit deinem Bandcamp-Account. Cookies + Daten + Audio-Cache liegen lokal in `~/.local/share/unfck-bandcamp/data` (Linux), `~/Library/Application Support/unfck-bandcamp/data` (macOS) oder `%APPDATA%/unfck-bandcamp/data` (Windows).

---

## Installation für Friends — Doppelklick & los

Lad den Installer für dein OS aus dem [Releases-Reiter](https://github.com/MarcoPoppe/unfck-bandcamp/releases/latest):

| OS | Datei | Was tun |
|---|---|---|
| **Windows** | `Unfck.Bandcamp_X.Y.Z_x64_en-US.msi` | Doppelklick. Bei „Windows hat den PC geschützt" → **Weitere Informationen** → **Trotzdem ausführen**. |
| **macOS (Apple Silicon)** | `Unfck.Bandcamp_X.Y.Z_aarch64.dmg` | Mounten, App in `/Applications` ziehen. Beim ersten Start: **Rechtsklick → Öffnen → Öffnen**. Danach normal startbar. |
| **macOS (Intel)** | `Unfck.Bandcamp_X.Y.Z_x64.dmg` | wie oben |
| **Linux** | `.AppImage`, `.deb` oder `.rpm` | AppImage: `chmod +x` + ausführen. Deb/RPM: mit Paketmanager installieren. |

**Node.js etc. brauchst du nicht** — alles ist im Installer drin. App-Größe ist ~80 MB pro OS, weil ein vollständiger Node-Sidecar mitgeliefert wird.

> **Warum die Sicherheits-Warnungen?** Die App ist nicht code-signiert (Code-Signing-Zertifikate kosten 99–300 €/Jahr und stehen aktuell nicht im Verhältnis zum Friend-Test-Aufwand). Sobald du die Warnung einmal weggeklickt hast, merkt sich dein OS das.

Auto-Updates sind aktiv: neue Versionen installieren sich beim nächsten App-Start automatisch.

---

## Setup-Wizard beim ersten Start

Wenn die App das erste Mal startet, landest du auf `/setup`. Zwei Schritte:

### Schritt 1: Burner-Bandcamp-Account

Die App liest deine Bandcamp-Daten (Collection, Follows, Curator-Profile) über einen **Burner-Account** — einen Wegwerf-Account den du nur für dieses Tool anlegst. Falls Bandcamp den Account jemals flaggt, machst du einen neuen, und dein **echter** Account bleibt unangetastet.

1. Auf [bandcamp.com/signup](https://bandcamp.com/signup) einen neuen Account anlegen. Email kann ein `+unfck`-Tag deiner normalen Adresse sein, z. B. `marco+unfck@gmail.com`.
2. Im selben Browser auf [bandcamp.com](https://bandcamp.com) eingeloggt bleiben.
3. Cookies extrahieren (ein bisschen DevTools-Frickelei, aber 30 Sekunden):
   - Drück **F12** (DevTools)
   - Tab **Network** öffnen
   - Lade bandcamp.com neu (F5)
   - Klick auf irgendeinen Request zu `bandcamp.com` in der Liste
   - Rechte Spalte → **Headers** → unter **Request Headers** den ganzen `Cookie:`-String kopieren (alles nach `Cookie:`)
4. In der App den String ins Textfeld pasten → **Validate & continue** klicken.

Wenn du eine Tauri-Version mit Embedded-Login erwischst (ab v2.5.0 geplant), entfällt Schritt 3 — dann öffnet sich ein In-App-Bandcamp-Login-Fenster.

### Schritt 2: Dein echter Bandcamp-Account (optional)

Optional kannst du auch deinen **echten** Account verlinken. Das ermöglicht der App:

- Deine **eigene** Collection und Follows zu lesen statt der Burner-Daten
- "Follow Artist"-Klicks auf bandcamp.com **mirrorn** zu deinem echten Account

Oder Schritt 2 einfach skippen — funktioniert auch nur mit Burner.

---

## Was du dann machen kannst

- **Sync library**: holt deine Bandcamp-Käufe (mit Stream-URLs).
- **Sync follows**: importiert wem du auf Bandcamp folgst.
- **/discover**: neue Tracks von gefolgten Artists + Curatoren-Empfehlungen.
- **/wishlist**: was du kaufen willst. Auto-marked-as-bought beim nächsten Sync.
- **/playlists**: handgemachte Setlists mit Reorder und Remove.
- **/digger/[id]**: Curator-Profile, EPs aufklappbar, Tracks markieren.
- **/history**: alle Plays ever, aggregiert pro Track mit Best-Completion und Play-Count.
- **BPM-Detection**: läuft offline beim Abspielen, schreibt Tempo in die Library.
- **Tempo-Controls**: Track temporär +/- 10 % Pitchen, ähnlich Beatport.
- Suche überall in den Tracklisten (nach Title/Artist/Album).

---

## Power-User: lokale Dev-Variante

Wer den Code selbst bauen oder eine Headless-Variante betreiben will:

```bash
git clone https://github.com/MarcoPoppe/unfck-bandcamp.git
cd unfck-bandcamp
npm ci
npm run dev   # http://localhost:3457
```

Voraussetzungen: Node.js 22+, yt-dlp, ffmpeg im PATH.

Für Docker-Compose-Setup siehe [docker-compose.yml](./docker-compose.yml).

---

## Stack

- Next.js 16 (App Router) + TypeScript strict + Tailwind 3
- better-sqlite3 (WAL mode)
- cheerio (HTML-Parsing)
- zustand (Player-Store)
- wavesurfer.js (Waveform)
- yt-dlp (sha256-pinned, Audio-Caching)
- **Tauri 2.11** (Desktop-Wrapper) + plugin-updater + plugin-shell
- ed25519-signed updates über GitHub Releases

## Sicherheit + Privacy

- BC-Cookies sind **AES-256-GCM-verschlüsselt** at rest (Schlüssel in `data/.app_secret`, chmod 600).
- 12 Cookie-touching API-Routes sind loopback-guarded.
- `/api/auth/suggest` ist hinter einer ENV-Variable gegated.
- Schema-Drift-Preflight beim App-Start, JSON-Lines File-Logger, Stale-Run-Reaper.
- Keine Telemetrie, keine externen Calls außer Bandcamp + (optional) GitHub für Update-Checks.

## Lizenz

MIT.

## Contributing

Issues + PRs willkommen. Self-Host-Architektur ist gesetzt; SaaS-PRs landen im Bin (Bandcamp ToS).
