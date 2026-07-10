#!/usr/bin/env python3
"""screenshot_to_playlist.py

Workflow: DJ-Software-Screenshot -> Bandcamp-Playlist im lokalen Unfck-Bandcamp-Tool.

Arbeitsteilung:
  - Den Vision-Schritt (Screenshot -> Trackliste als JSON) macht Claude.
  - Dieses Skript erledigt den deterministischen Rest:
      1. Jeden Track ueber Bandcamps oeffentliche Autocomplete-Such-API suchen
      2. Bestes Match per Fuzzy-Score waehlen (Track-Seiten werden Alben vorgezogen)
      3. Match via /api/track/lookup zur lokalen trackId aufloesen (persistiert den Track in die DB)
      4. Playlist anlegen und die sicheren Treffer hinzufuegen
      5. Report schreiben: sicher / unsicher / nicht gefunden

Nur Python-stdlib, keine Extra-Dependencies. Voraussetzung: der Unfck-Bandcamp-Server
laeuft lokal (Standard-Port 3457) und ist eingeloggt (crawler-auth genuegt fuers Suchen).

Beispiele:
  # Volllauf: suchen, Playlist "Set Juli 2026" anlegen, sichere Treffer hinzufuegen
  python3 scripts/screenshot_to_playlist.py scripts/tracklists/set-juli-2026.json

  # Nur suchen, nichts schreiben (Report ansehen)
  python3 scripts/screenshot_to_playlist.py scripts/tracklists/set-juli-2026.json --dry-run

  # Zweite Runde: gepruefte URLs nachtraeglich in eine bestehende Playlist legen
  python3 scripts/screenshot_to_playlist.py --playlist-id 12 \
      --add-urls "https://artist.bandcamp.com/track/foo,https://artist.bandcamp.com/track/bar"
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import time
import unicodedata
import urllib.request
import urllib.error

BC_SEARCH_URL = "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# "Mix"-Beiwoerter, die auf Bandcamp oft fehlen -> beim Kern-Vergleich rauswerfen.
NOISE = re.compile(
    r"\((?:[^)]*\b(?:original|extended|instrumental|radio|club|vinyl|rework|edit|version|mix)\b[^)]*)\)",
    re.I,
)


# ---------------------------------------------------------------------------
# Normalisierung / Fuzzy-Scoring
# ---------------------------------------------------------------------------
def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def normalize(s: str) -> str:
    s = strip_accents((s or "").lower())
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def core(s: str) -> str:
    """Titel-Kern: Mix-/Vinyl-/Version-Klammern entfernen, dann normalisieren."""
    s = NOISE.sub(" ", s or "")
    s = re.sub(r"\((?:vinyl|original|extended)\)", " ", s, flags=re.I)
    return normalize(s)


def ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def split_artists(s: str) -> list[str]:
    parts = re.split(r"[,/&]| feat\.? | ft\.? | x | vs\.? ", s or "", flags=re.I)
    return [p.strip() for p in parts if p.strip()]


def artist_similarity(query_artist: str, band_name: str) -> float:
    qa, bn = normalize(query_artist), normalize(band_name)
    if not qa or not bn:
        return 0.0
    best = ratio(qa, bn)
    for tok in split_artists(query_artist):
        nt = normalize(tok)
        if not nt:
            continue
        best = max(best, ratio(nt, bn))
        if nt and nt in bn:              # z. B. "Lancaster" in "jackspot lancaster"
            best = max(best, 0.9)
    for tok in split_artists(band_name):
        nt = normalize(tok)
        if nt and nt in qa:
            best = max(best, 0.85)
    return best


def title_similarity(query_title: str, cand_name: str) -> float:
    full = ratio(normalize(query_title), normalize(cand_name))
    kern = ratio(core(query_title), core(cand_name))
    return max(full, kern)


def score(track: dict, cand: dict) -> tuple[float, float, float]:
    ts = title_similarity(track["title"], cand.get("name", ""))
    as_ = artist_similarity(track.get("artist", ""), cand.get("band_name", ""))
    combined = 0.62 * ts + 0.38 * as_
    if cand.get("type") == "a":          # Album-Treffer: leichter Malus, nie auto-add
        combined -= 0.06
    return combined, ts, as_


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def http_json(url: str, payload: dict, timeout: int = 30, host_header: str | None = None) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", UA)
    if host_header:
        req.add_header("Host", host_header)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def bc_search(text: str, item_filter: str = "") -> list[dict]:
    payload = {"search_text": text, "search_filter": item_filter, "full_page": False}
    try:
        d = http_json(BC_SEARCH_URL, payload, timeout=15)
    except (urllib.error.URLError, TimeoutError, ValueError):
        return []
    return d.get("auto", {}).get("results", []) or []


class Api:
    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")

    def post(self, path: str, body: dict) -> dict:
        return http_json(self.base + path, body, timeout=90)

    def lookup(self, bc_url_or_id: str) -> dict:
        r = self.post("/api/track/lookup", {"input": bc_url_or_id})
        if not r.get("ok"):
            raise RuntimeError(r.get("error", "lookup failed"))
        return r["result"]

    def create_playlist(self, name: str, description: str | None = None) -> int:
        r = self.post("/api/playlists", {"action": "create", "name": name, "description": description})
        if not r.get("ok"):
            raise RuntimeError(r.get("error", "create failed"))
        return int(r["id"])

    def add_track(self, playlist_id: int, track_id: int) -> bool:
        r = self.post("/api/playlists",
                      {"action": "add_track", "playlistId": playlist_id, "trackId": track_id})
        if not r.get("ok"):
            raise RuntimeError(r.get("error", "add_track failed"))
        return bool(r.get("added"))


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------
def query_variants(track: dict) -> list[str]:
    title, artist = track["title"], track.get("artist", "")
    core_title = re.sub(r"\s+", " ", NOISE.sub(" ", title)).strip()
    seen, out = set(), []
    for q in (f"{title} {artist}", f"{core_title} {artist}", f"{artist} {core_title}", title):
        q = q.strip()
        if q and q.lower() not in seen:
            seen.add(q.lower())
            out.append(q)
    return out


def best_match(track: dict, sleep: float) -> dict:
    candidates: dict[str, dict] = {}   # dedupe per URL
    for i, q in enumerate(query_variants(track)):
        for item_filter in ("t", ""):
            for cand in bc_search(q, item_filter):
                if cand.get("type") not in ("t", "a"):
                    continue
                url = cand.get("item_url_path") or cand.get("item_url_root")
                if not url:
                    continue
                sc, ts, as_ = score(track, cand)
                prev = candidates.get(url)
                if prev is None or sc > prev["score"]:
                    candidates[url] = {
                        "url": url, "type": cand.get("type"),
                        "name": cand.get("name"), "band_name": cand.get("band_name"),
                        "score": round(sc, 3), "title_score": round(ts, 3),
                        "artist_score": round(as_, 3),
                    }
            time.sleep(sleep)
        # Frueh raus, wenn ein sehr sicherer Track-Treffer schon da ist.
        top = max(candidates.values(), key=lambda c: c["score"], default=None)
        if top and top["type"] == "t" and top["score"] >= 0.82 and top["artist_score"] >= 0.5:
            break
    ranked = sorted(candidates.values(), key=lambda c: c["score"], reverse=True)
    return {"track": track, "candidates": ranked[:5], "best": ranked[0] if ranked else None}


def classify(match: dict, min_conf: float, min_unc: float) -> str:
    b = match["best"]
    if not b:
        return "notfound"
    # "Sicher" nur, wenn Titel UND Artist passen. Ein exakter Titel mit
    # fremdem Artist (haeufig auf Bandcamp) ist wertlos -> nur "unsicher".
    if (b["type"] == "t" and b["score"] >= min_conf
            and b["title_score"] >= 0.6 and b["artist_score"] >= 0.6):
        return "confident"
    if b["score"] >= min_unc:
        return "uncertain"
    return "notfound"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def label(track: dict) -> str:
    return f'{track["title"]} / {track.get("artist", "?")}'


def run_add_urls(api: Api, playlist_id: int, urls: list[str]) -> None:
    print(f"\nLege {len(urls)} URL(s) in Playlist #{playlist_id} …\n")
    for u in urls:
        u = u.strip()
        if not u:
            continue
        try:
            res = api.lookup(u)
            added = api.add_track(playlist_id, res["trackId"])
            state = "hinzugefuegt" if added else "war schon drin"
            print(f"  OK  {res['title']} / {res.get('artistName')}  [{state}]")
        except Exception as e:  # noqa: BLE001
            print(f"  ERR {u}: {e}")
        time.sleep(1.0)


def main() -> int:
    ap = argparse.ArgumentParser(description="Screenshot-Trackliste -> Bandcamp-Playlist")
    ap.add_argument("tracklist", nargs="?", help="Pfad zur Trackliste-JSON")
    ap.add_argument("--base-url", default="http://localhost:3457")
    ap.add_argument("--dry-run", action="store_true", help="nur suchen, nichts schreiben")
    ap.add_argument("--playlist-id", type=int, help="in bestehende Playlist einfuegen")
    ap.add_argument("--add-urls", help="Komma-Liste von BC-URLs direkt einfuegen (mit --playlist-id)")
    ap.add_argument("--min-confident", type=float, default=0.70)
    ap.add_argument("--min-uncertain", type=float, default=0.48)
    ap.add_argument("--sleep", type=float, default=0.35, help="Pause zwischen Such-Calls (s)")
    args = ap.parse_args()

    # Windows-Konsole ist standardmaessig cp1252 -> Umlaute/Sonderzeichen wuerden
    # den Print crashen. utf-8 erzwingen, Rest notfalls ersetzen.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass

    api = Api(args.base_url)

    # Sonderpfad: gepruefte URLs nachtraeglich einfuegen
    if args.add_urls:
        if not args.playlist_id:
            print("--add-urls braucht --playlist-id", file=sys.stderr)
            return 2
        run_add_urls(api, args.playlist_id, args.add_urls.split(","))
        return 0

    if not args.tracklist:
        ap.error("tracklist-JSON fehlt (oder nutze --add-urls)")

    with open(args.tracklist, encoding="utf-8") as f:
        data = json.load(f)
    tracks = data["tracks"]
    playlist_name = data.get("playlist_name", "Import")
    print(f'Trackliste: {len(tracks)} Tracks  |  Playlist: "{playlist_name}"'
          f'{"  (DRY-RUN)" if args.dry_run else ""}\n')

    results = []
    for i, tr in enumerate(tracks, 1):
        m = best_match(tr, args.sleep)
        cls = classify(m, args.min_confident, args.min_uncertain)
        m["classification"] = cls
        results.append(m)
        b = m["best"]
        tag = {"confident": "OK ", "uncertain": "?? ", "notfound": "XX "}[cls]
        detail = (f'{b["score"]:.2f} [{b["type"]}] {b["name"]} / {b["band_name"]}'
                  if b else "kein Treffer")
        print(f"  {tag}{i:>2}/{len(tracks)}  {label(tr)}\n         -> {detail}")

    confident = [r for r in results if r["classification"] == "confident"]
    uncertain = [r for r in results if r["classification"] == "uncertain"]
    notfound = [r for r in results if r["classification"] == "notfound"]

    playlist_id = args.playlist_id
    if not args.dry_run:
        if playlist_id is None:
            playlist_id = api.create_playlist(playlist_name, data.get("source"))
            print(f'\nPlaylist "{playlist_name}" angelegt (id {playlist_id}).')
        print(f"\nFuege {len(confident)} sichere Treffer hinzu …")
        for r in confident:
            try:
                res = api.lookup(r["best"]["url"])
                api.add_track(playlist_id, res["trackId"])
                r["resolved"] = {"trackId": res["trackId"], "bcUrl": res["bcUrl"]}
                print(f'  + {res["title"]} / {res.get("artistName")}')
            except Exception as e:  # noqa: BLE001
                r["classification"] = "uncertain"
                r["lookup_error"] = str(e)
                print(f'  ! Fehler bei {label(r["track"])}: {e}')
            time.sleep(1.0)

    # Report schreiben
    report = {
        "playlist_name": playlist_name,
        "playlist_id": playlist_id,
        "dry_run": args.dry_run,
        "summary": {"total": len(results), "confident": len(confident),
                    "uncertain": len(uncertain), "notfound": len(notfound)},
        "results": results,
    }
    report_path = (args.tracklist.rsplit(".", 1)[0] + ".report.json") if args.tracklist \
        else "report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print(f"SICHER: {len(confident)}   UNSICHER: {len(uncertain)}   "
          f"NICHT GEFUNDEN: {len(notfound)}   (von {len(results)})")
    if uncertain:
        print("\nUNSICHER (bitte pruefen):")
        for r in uncertain:
            b = r["best"]
            print(f'  - {label(r["track"])}')
            if b:
                print(f'      Vorschlag {b["score"]:.2f} [{b["type"]}] '
                      f'{b["name"]} / {b["band_name"]}\n      {b["url"]}')
    if notfound:
        print("\nNICHT GEFUNDEN:")
        for r in notfound:
            print(f'  - {label(r["track"])}')
    print(f"\nReport: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
