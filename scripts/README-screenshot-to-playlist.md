# Workflow: Screenshot zu Bandcamp-Playlist

Aus einem oder mehreren Screenshots einer Trackliste (DJ-Software, Beatport, Rekordbox, …)
eine Playlist im lokalen Unfck-Bandcamp-Tool anlegen. Claude liest die Tracks aus den
Bildern, ein Python-Skript sucht sie auf Bandcamp und legt die Playlist an.

## Arbeitsteilung

| Schritt | Wer | Was |
|---|---|---|
| 1. Tracks aus Screenshot lesen | Claude (Bilderkennung) | Titel + Interpret (+ Album, falls sichtbar) in eine JSON-Datei schreiben |
| 2. Auf Bandcamp suchen | Skript | Bandcamps öffentliche Autocomplete-Such-API, Fuzzy-Matching mit Score |
| 3. Track auflösen | Skript über `/api/track/lookup` | Bandcamp-URL zur lokalen trackId, Track wird in die DB persistiert |
| 4. Playlist bauen | Skript über `/api/playlists` | Playlist anlegen, sichere Treffer hinzufügen |
| 5. Report + Review | Skript, dann Claude/Marco | Unsichere und nicht gefundene Tracks werden gelistet und gemeinsam geprüft |

Der Bild-Schritt bleibt bei Claude, weil er Kontext braucht (überlappende Screenshots
deduplizieren, abgeschnittene Zeilen erkennen, "Artist - Titel" korrekt trennen). Alles
Deterministische macht das Skript.

## Voraussetzungen

- Unfck-Bandcamp-Server läuft lokal (Standard-Port **3457**). Kurztest: `curl http://localhost:3457/api/health`
- In der App eingeloggt. Für das reine Suchen und Auflösen genügt die crawler-auth (kein main-auth-Write nötig, da wir nur lokal in die DB schreiben, nicht auf Bandcamp).
- Python 3 (nur stdlib, keine Extra-Pakete).

## Ablauf

### 1. Trackliste als JSON anlegen

Datei unter `scripts/tracklists/<name>.json`:

```json
{
  "playlist_name": "Set Juli 2026",
  "source": "kurze Herkunftsnotiz",
  "tracks": [
    { "title": "Untold Pulse", "artist": "Mowree" },
    { "title": "Eastern Chant (Original Mix)", "artist": "Hoffman", "album": "Obscure" }
  ]
}
```

`album` ist optional und hilft nur bei der manuellen Prüfung, ins Matching geht aktuell nur
Titel + Artist. Bei Einträgen im Format "Artist - Titel" (manche Labels tun das) trennt man
sauber: `title` = eigentlicher Titel, `artist` = Interpret.

### 2. Erst ein Dry-Run (nichts wird geschrieben)

```bash
cd unfck_bandcamp
python3 scripts/screenshot_to_playlist.py scripts/tracklists/set-juli-2026.json --dry-run
```

Zeigt pro Track das beste Match und schreibt einen Report neben die Trackliste
(`<name>.report.json`). Klassen:

- **OK** (sicher): Track-Treffer, Titel- und Artist-Score über Schwelle. Wird beim Volllauf automatisch hinzugefügt.
- **??** (unsicher): plausibel, aber Titel oder Artist wackeln, oder es ist nur ein Album-Treffer. Wird nicht automatisch hinzugefügt.
- **XX** (nicht gefunden): kein brauchbarer Treffer. Meist, weil der Track gar nicht auf Bandcamp ist (Beatport-Exklusives etc.).

### 3. Volllauf

```bash
python3 scripts/screenshot_to_playlist.py scripts/tracklists/set-juli-2026.json
```

Legt die Playlist an und fügt alle sicheren Treffer hinzu. Am Ende Report + Liste der
unsicheren/fehlenden Tracks.

### 4. Nachladen geprüfter URLs (Review-Runde)

Für unsichere Tracks, die Marco als korrekt bestätigt (oder eine bessere URL nennt),
in die bestehende Playlist nachladen:

```bash
python3 scripts/screenshot_to_playlist.py --playlist-id 4 \
  --add-urls "https://artist.bandcamp.com/track/foo,https://andere.bandcamp.com/track/bar"
```

## Matching-Logik (Kurzfassung)

- Pro Track mehrere Suchvarianten (Titel+Artist, Kern-Titel+Artist, Artist+Titel, nur Titel), Filter "t" (Tracks) bevorzugt, "" (alles) als Fallback.
- Score = 0.62 x Titel-Ähnlichkeit + 0.38 x Artist-Ähnlichkeit. Accent- und Klammer-tolerant (z. B. "(Original Mix)" wird beim Kernvergleich ignoriert, "Röyksopp" = "Royksopp").
- **Sicher** nur, wenn Track-Treffer und Titel-Score >= 0.6 und Artist-Score >= 0.6 und Gesamt >= 0.70. Der Artist-Score ist bewusst streng, weil ein exakter Titel mit fremdem Artist auf Bandcamp häufig ist (z. B. "Delusion" von zig Acts).
- Album-Treffer werden nie automatisch hinzugefügt (die lookup-Route würde sonst Track 1 des Albums nehmen, nicht den gemeinten Titel).

Schwellen justierbar über `--min-confident` und `--min-uncertain`.

## Grenzen

- **Nicht alle Tracks sind auf Bandcamp.** Underground-Techno/House-Sets ziehen viel von Beatport; erfahrungsgemäß sind rund ein Drittel nicht auffindbar. Das ist kein Fehler des Skripts.
- Die Such-API ist unauthentifiziert und generös. Bei sehr generischen Titeln ("Euphoria", "Zorro") kann der beste Treffer der falsche Act sein, deshalb der strenge Artist-Score.
- Die Suche belastet Bandcamp. Standard-Pause 0.35 s zwischen Calls (`--sleep`), Lookups zusätzlich 1 s. Bei sehr großen Listen entsprechend Geduld.

## Beispiel-Lauf (2026-07-01, "Set Juli 2026")

54 Tracks aus zwei überlappenden Screenshots. Ergebnis: 32 automatisch sicher hinzugefügt,
1 nach Prüfung nachgeladen (Ronnie Spiteri - Soul Finder), 13 unsicher (fast alle falsche
Treffer), 8 nicht auf Bandcamp. Playlist id 4.
