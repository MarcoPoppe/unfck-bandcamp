# Unfck Bandcamp

Self-Host-Tool, das Bandcamps Track-Suche durch ein Beatport-aehnliches UI ersetzt. Eigener Player, eigene Wishlist mit Auto-Mark-as-Bought via Owned-Sync, Following von Artists, Labels und Diggers.

**Status:** Phase 0 (Skelett, in Entwicklung)

## Voraussetzungen

- Docker + Docker Compose (Distribution-Variante)
- ODER lokal: Node.js 22+, yt-dlp, ffmpeg

## Quickstart (lokal, dev)

```bash
npm install
npm run migrate
npm run dev
```

Browser: http://localhost:3457

## Quickstart (Docker)

```bash
docker compose up -d
```

Cookies extrahieren und in `data/bc_cookies.txt` ablegen (Anleitung kommt in Phase 1).

## Architektur

- **Single-Tenant pro Instanz**, jeder Nutzer hostet auf eigenem Geraet mit eigenem BC-Account
- **Stack:** Next.js 15 (App Router) + better-sqlite3 + cheerio + wavesurfer.js + yt-dlp
- **DB:** SQLite unter `data/unfck.db`
- **Audio-Cache:** `data/audio_cache/`

## Roadmap

Siehe `PLAN.md` fuer den 30-Tage-Plan.

## Lizenz

TBD
