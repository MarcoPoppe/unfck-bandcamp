# Unfck Bandcamp

**Status:** Scope final, vor MVP-Bau
**Angelegt:** 2026-04-25

## Vision

Self-Host-Tool, das Bandcamps schlechte Musiksuche durch ein Beatport-aehnliches UI ersetzt. Marco baut es zuerst fuer sich, dann fuer einen kleinen Freundeskreis als Docker-Distribution.

Kein SaaS, kein zentraler Server. Jeder hostet lokal mit eigenem BC-Account.

## Strategie

**Neustart**, kein Fork. SoundFinder bleibt unangetastet, Module werden gezielt portiert (Bandcamp-Scraping, Fan-API, Audio-Proxy, Player-Komponenten).

## MVP-Scope (4-6 Wochen)

1. BC-Account-Login (Cookie-Paste aus DevTools)
2. Owned-Sync aus BC-Collection
3. Beatport-Style Track-Liste mit Player
4. Following Artists/Labels/Diggers
5. Wishlist + Cart-Stage mit Auto-Mark-as-Bought via Owned-Sync
6. Persoenliche DB: Gehoert, Like/Dislike, Tags, Playlists
7. Docker-Compose Distribution

**v2:** Vorschlagssystem (Following-Graph-basiert)

## Wishlist-Loesung (statt Cart-Push)

Nutzer markiert Tracks im Korb. Direktlink zu bandcamp.com pro Item. Background-Sync ueber Fan-API matched Collection gegen Wishlist und entfernt gekaufte Items automatisch. Multi-Select als manuelles Override.

## Naechste Schritte (Reihenfolge)

- [ ] Tag 1-2: Repo-Skelett (Next.js + better-sqlite3 + httpx + Tailwind + wavesurfer, leere DB, leere Routes)
- [ ] Tag 3-5: BC-Login + Owned-Sync (Fan-API-Modul aus SF portieren)
- [ ] Tag 6-10: TrackRow + StickyPlayerBar (aus SF portieren, BC-only)
- [ ] Tag 11-15: Following Artists/Labels/Diggers (Crawler aus SF portieren)
- [ ] Tag 16-20: Wishlist + Cart-Stage + Auto-Mark-as-Bought
- [ ] Tag 21-25: Tags, Playlists, Listen-History
- [ ] Tag 26-30: Docker + Distribution + README

## Log

- 2026-04-25: Projekt angelegt
- 2026-04-25: Pivot von SaaS zu Self-Host
- 2026-04-25: Strategie final = Neustart, kein Fork (Marcos Bauchgefuehl bestaetigt nach Code-Review)
- 2026-04-25: MVP-Scope final inkl. Wishlist mit Auto-Mark-as-Bought
- 2026-04-25: BC-Login = Cookie-Paste (Methode a)
