# Unfck Bandcamp

**Status:** Alle 7 Phasen done, ready zum Verteilen
**Angelegt:** 2026-04-25

## Phasen-Status

| Phase | Status | Tag | Commit |
|---|---|---|---|
| 0 Skelett | done | `phase-0` | 16b91f0 |
| 1 BC-Login + Owned-Sync | done | `phase-1` | 95b9a9f |
| 2A Track-Expansion + Basic Player | done | `phase-2a` | 5d189ae |
| 2B Wavesurfer + Sticky Bar + AWSD + Audio Cache | done | `phase-2b` | 4bee82d |
| 3 Following + Discovery | done | `phase-3` | e18dc92 |
| 4 Wishlist + Cart-Stage + Auto-Mark | done | `phase-4` | c618b1c |
| 5 Tags + Playlists + History | done | `phase-5` | be09f91 |
| 6 Docker + Distribution | done | `phase-6` | d1d5fec |

Alle Phasen mit jeweils 2 Codex-Review-Iterationen durchgezogen.

## Was Marco morgen testen kann

```bash
cd C:\Users\marco\Claude\unfck_bandcamp
npm run dev
```

Browser: <http://localhost:3457>

7 Routen erreichbar:
- **/** Home mit Statistiken + Navigation
- **/setup** Cookie-Validation + Owned-Sync
- **/tracks** Track-Liste mit Wavesurfer-Player + AWSD-Shortcuts
- **/discover** Neue Releases von gefolgten Artists
- **/follows** Artists/Labels/Diggers folgen
- **/wishlist** Wishlist mit Auto-Mark-as-Bought
- **/playlists** + **/playlists/[id]** eigene Track-Sammlungen mit Reorder
- **/tags** Custom-Tags mit Color-Picker
- **/history** Letzte 200 Plays

Alternative Docker:
```bash
mkdir -p data/audio_cache
docker compose up -d --build
```

## Datenmodell (8 Migrations)

- **collection_items**: BC Owned-Items (Album-Granularitaet)
- **tracks**: Track-Granularitaet, expanded aus collection_items
- **artists / labels / diggers**: Followed-Entities
- **following**: polymorpher Link
- **discovered_tracks**: aus Discovery-Crawl, separate Tabelle (nicht owned)
- **wishlist**: open/bought/dismissed mit auto-match
- **tags + track_tags**: Custom-Tags
- **playlists + playlist_tracks**: Manuelle Sammlungen mit Reorder
- **track_plays**: Listen-History (>= 1s + 10% Threshold)
- **sync_runs**: Audit-Log mit stale-reaper

## Distribution

- Docker-Compose default port-bind 127.0.0.1 (defense-in-depth)
- 12 cookie-touching API-Routes loopback-only
- LICENSE: MIT
- README mit Setup, Cookie-Anleitung, Backup, Linux-Permissions, Troubleshooting

## Nicht in MVP (dokumentiert in PLAN.md, kommt spaeter)

- Diggers-Discovery (BC-User mit Geschmacks-Overlap)
- Discovery-Audio-Stream (in-app Playback fuer noch-nicht-gekaufte Tracks)
- Encrypted-Cookies-At-Rest
- Custom-Domain Artist-Resolution (band_id-Match faengt 90% ab, aber nicht alle)

## Log

- 2026-04-25: Projekt angelegt, Vision -> Pivot SaaS zu Self-Host -> Strategie Neuaufbau (statt Fork)
- 2026-04-25 abends: Phase 0, 1, 2A done (commits + tags)
- 2026-04-26 ueber Nacht: Phase 2B, 3, 4, 5, 6 done — alle Codex-Review-Loops, alle gegen echtes BC verifiziert
