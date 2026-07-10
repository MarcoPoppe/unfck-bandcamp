# Diagnose: „Decoder sehr langsam beim Anhören" (2026-06-11)

## Symptom

Beim Anhören im Dev-Server (Port 3458) dauert es 20 bis 50 Sekunden, bis ein uncached Track abspielt. Im UI läuft währenddessen der „Decoding"-Spinner.

## Beweiskette

| Messung | Ergebnis |
|---|---|
| `GET /api/audio/stream?id=2545` (3,9 MB) | 20,5s |
| `GET /api/audio/stream?id=2570` (4,8 MB) | 31,6s |
| `GET /api/audio/stream?id=2599` (5,6 MB, sauberer Repro-Test, idle Server) | 20,6s bis zum ersten Byte |
| curl direkt gegen t4.bcbits.com (gleiche stream_url, Messung 1) | 0,38s, 11,5 MB/s |
| curl direkt gegen t4.bcbits.com (gleiche URL, Messung 2, wenige Minuten später) | 56s, 93 KB/s |
| Node `fetch` + `arrayBuffer()` (nacktes Node, ohne Next.js, ohne Disk) | 57,8s für 5,2 MB |
| curl gegen speed.cloudflare.com (5 MB), im selben Zeitfenster | 0,4s, 12,5 MB/s |

## Root Cause (drei Schichten)

1. **Bandcamp-CDN drosselt die IP dynamisch** auf ~93 bis 160 KB/s nach viel BC-Traffic (Digger-Session: Page-Fetches pro Track-Lookup plus Full-MP3-Caching pro angespieltem Track). Die Drosselung ist variabel: dieselbe URL lieferte einmal 11,5 MB/s, Minuten später 93 KB/s. Die Leitung selbst ist frei (Cloudflare 12,5 MB/s im selben Moment). Kein IPv6-Problem, kein undici-Problem, kein Disk/Defender-Problem (alle einzeln ausgeschlossen).
2. **Die Stream-Route wartet auf den kompletten Download**, bevor sie das erste Byte ausliefert (`src/app/api/audio/stream/route.ts`, `await cacheStream(...)`). Bewusste Entscheidung aus einem früheren Rate-Limit-Fix (eine BC-Verbindung statt zwei parallele). Bei gedrosseltem CDN wird daraus die volle Wartezeit.
3. **WaveSurfer gated Playback auf Full-Decode:** `ready` feuert erst, wenn die Datei komplett geladen und dekodiert ist (`StickyPlayerBar.tsx`). Der „Decoding"-Spinner läuft also fast die ganze Zeit, während der Server noch von Bandcamp lädt. Daher der Eindruck „der Decoder ist langsam".

## Hinweis aus der Historie

Der Kommentar in `route.ts` erwähnt frühere „91s stalls in dev logs" durch Doppel-Verbindungen. Das passt zum selben CDN-Drossel-Verhalten.

## Fix-Optionen (Stand Session-Ende, noch nicht entschieden)

1. **Prefetch der nächsten 1 bis 2 Queue-Tracks reaktivieren:** Während ein Track läuft, ist selbst gedrosselt genug Zeit zum Vorladen. Sequentielles Hören wird wartefrei. Skippen bleibt langsam. (Prefetch wurde beim Umbau auf Full-Download entfernt, siehe Kommentar `StickyPlayerBar.tsx` ~Zeile 644.)
2. **Tee-Streaming plus progressives Playback:** Eine BC-Verbindung, Bytes parallel an Client und Disk. Player startet über das Audio-Element sobald gepuffert, Waveform kommt nach Full-Decode nach. Echter Fix, größerer Player-Eingriff.
3. **Kosmetik:** Download-Fortschritt statt generischem Spinner.

## Nebenbefunde

- Audio-Cache bei 2,9 GB, Limit 2 GB. Prune läuft nur alle 25 Writes, seit Serverstart noch nicht gefeuert. Selbstheilend.
- Port 3457 war von Unfck Discogs belegt (eigener Next.js-Server), deshalb lief der Dev-Server in dieser Session auf 3458.
- React-Warnung im Dev-Log: setState during render in `DiscoverHub.tsx:76` (refresh in saveSeenIds via DiggersTab). Nicht Teil dieser Diagnose, notiert für später.
