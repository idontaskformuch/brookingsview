"""Weekly OpenStreetMap snapshot for the evening layer's "Open late" block (/tonight).

For every town whose configs/<town>.json has `open_late: {radius_km}`, ask Overpass once for named pubs, bars, nightclubs and
restaurants that carry `opening_hours`, and store the slimmed result in osm_places (one row per town, replaced). The site build reads
that row and never calls Overpass itself (owner 2026-10-29); a missing row or one older than 14 days gives no Open late block.

Overpass usage policy: identifiable User-Agent (ViewMediaBot, scrapers/user_agent.py), at most one run per town per week (a town whose
snapshot is younger than MIN_DAYS_BETWEEN_RUNS is skipped unless --force), towns one after another with a pause, a 25 s server timeout,
and a backoff when a mirror answers 429/5xx. Data (c) OpenStreetMap contributors, ODbL: the page credits it.

    python -m scripts.refresh_osm_places            # dry run: fetch and report, write nothing
    python -m scripts.refresh_osm_places --apply    # write (what the osm-open-late workflow runs)
    python -m scripts.refresh_osm_places --town glasgow --out snapshot.json     # one Overpass call, result to a file, DB untouched
    python -m scripts.refresh_osm_places --town glasgow --from-file snapshot.json --apply   # write that file, no second Overpass call

Every place carries its coordinates (`lat`, `lon`: a node's own, or the `center` of a way or relation), which the evening layer's
"Make a night of it" needs to work out a walk; a place Overpass gives none for has no `lat`/`lon` and is never paired.
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests
from psycopg.types.json import Jsonb

from db.db import get_conn
from scrapers.user_agent import user_agent

CONFIG_DIR = Path(__file__).resolve().parent.parent / "configs"
OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
MIN_DAYS_BETWEEN_RUNS = 6
PAUSE_BETWEEN_TOWNS_S = 10
ATTEMPTS = 3
KEEP_TAGS = ("name", "amenity", "opening_hours", "website", "contact:website")


def overpass_query(lat: float, lon: float, radius_km: float) -> str:
    return (
        '[out:json][timeout:25];nwr["amenity"~"^(pub|bar|nightclub|restaurant)$"]["opening_hours"]["name"]'
        f"(around:{round(radius_km * 1000)},{lat},{lon});out tags center;"
    )


def coordinates(el: dict[str, Any]) -> dict[str, float]:
    """{'lat', 'lon'} from a node's own position or a way's/relation's center; {} when Overpass gave none (never guessed)."""
    pos = el.get("center") or el
    lat, lon = pos.get("lat"), pos.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        return {"lat": round(float(lat), 6), "lon": round(float(lon), 6)}
    return {}


def slim_elements(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Only what the site reads: type, id, position and five tags. Elements without a name or opening_hours are dropped."""
    out = []
    for el in elements:
        tags = el.get("tags") or {}
        if not tags.get("name") or not tags.get("opening_hours"):
            continue
        out.append({"type": el.get("type"), "id": el.get("id"), **coordinates(el), "tags": {k: tags[k] for k in KEEP_TAGS if k in tags}})
    return out


def due(last_fetched: datetime | None, now: datetime, force: bool = False) -> bool:
    return force or last_fetched is None or now - last_fetched >= timedelta(days=MIN_DAYS_BETWEEN_RUNS)


def read_snapshot_file(path: Path) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))["elements"]


def write_snapshot_file(path: Path, town_id: str, elements: list[dict[str, Any]], fetched_at: datetime) -> None:
    path.write_text(json.dumps({"town_id": town_id, "fetched_at": fetched_at.isoformat(), "elements": elements}, ensure_ascii=False, indent=1), encoding="utf-8")


def towns_with_open_late() -> list[dict[str, Any]]:
    towns = []
    for path in sorted(CONFIG_DIR.glob("*.json")):
        cfg = json.loads(path.read_text(encoding="utf-8"))
        ol, coords = cfg.get("open_late"), cfg.get("coordinates")
        if ol and coords:
            towns.append({"town_id": cfg["town_id"], "lat": coords["lat"], "lon": coords["lon"], "radius_km": ol["radius_km"]})
    return towns


def fetch(town: dict[str, Any], session: requests.Session | None = None, sleep=time.sleep) -> list[dict[str, Any]]:
    """Raises RuntimeError when every attempt fails; the caller leaves the previous snapshot in place."""
    http = session or requests
    headers = {"User-Agent": user_agent(town["town_id"])}
    data = {"data": overpass_query(town["lat"], town["lon"], town["radius_km"])}
    last = "no attempt made"
    for attempt in range(ATTEMPTS):
        endpoint = OVERPASS_ENDPOINTS[attempt % len(OVERPASS_ENDPOINTS)]
        try:
            res = http.post(endpoint, data=data, headers=headers, timeout=60)
            if res.status_code == 200:
                return slim_elements(res.json().get("elements", []))
            last = f"{endpoint} answered {res.status_code}"
        except (requests.RequestException, ValueError) as e:
            last = f"{endpoint}: {e}"
        sleep(30 * (attempt + 1))
    raise RuntimeError(f"{town['town_id']}: Overpass unavailable ({last})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to osm_places (default: dry run)")
    ap.add_argument("--force", action="store_true", help="ignore the one-run-per-week guard")
    ap.add_argument("--town", help="only this town_id (needed with --out and --from-file)")
    ap.add_argument("--out", type=Path, help="fetch once and write the result to this file; nothing is written to the database")
    ap.add_argument("--from-file", type=Path, help="with --apply: write this file's elements to the database instead of calling Overpass")
    args = ap.parse_args()
    if (args.out or args.from_file) and not args.town:
        ap.error("--out and --from-file need --town")
    if args.out and args.from_file:
        ap.error("--out and --from-file are separate steps")
    if args.from_file and not args.apply:
        ap.error("--from-file only makes sense with --apply")

    now = datetime.now(timezone.utc)
    failures = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            for i, town in enumerate(t for t in towns_with_open_late() if not args.town or t["town_id"] == args.town):
                cur.execute("SELECT fetched_at FROM osm_places WHERE town_id = %s", (town["town_id"],))
                row = cur.fetchone()
                if not due(row[0] if row else None, now, args.force):
                    print(f"  [skip]   {town['town_id']}: snapshot from {row[0]:%Y-%m-%d} is younger than {MIN_DAYS_BETWEEN_RUNS} days")
                    continue
                if i:
                    time.sleep(PAUSE_BETWEEN_TOWNS_S)
                if args.from_file:
                    elements = read_snapshot_file(args.from_file)
                else:
                    try:
                        elements = fetch(town)
                    except RuntimeError as e:
                        print(f"  [FAILED] {e}")
                        failures += 1
                        continue
                print(f"  [ok]     {town['town_id']}: {len(elements)} places with opening hours within {town['radius_km']} km")
                if args.out:
                    write_snapshot_file(args.out, town["town_id"], elements, now)
                    print(f"  [file]   {args.out}")
                    continue
                if args.apply:
                    cur.execute(
                        "INSERT INTO osm_places (town_id, fetched_at, radius_km, elements) VALUES (%s, now(), %s, %s) "
                        "ON CONFLICT (town_id) DO UPDATE SET fetched_at = now(), radius_km = EXCLUDED.radius_km, elements = EXCLUDED.elements",
                        (town["town_id"], town["radius_km"], Jsonb(elements)),
                    )
    print("written to DB" if args.apply and not args.out else "DRY RUN -- nothing written to the database, pass --apply to write")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
