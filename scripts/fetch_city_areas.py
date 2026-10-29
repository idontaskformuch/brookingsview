"""Static neighbourhood file per town for /tonight and /this-weekend ("Merchant City" next to a venue).

Reads OpenStreetMap through Overpass (read-only, ViewMediaBot, two requests per town) and writes site/src/config/areas/<town>.json:
the place=suburb|neighbourhood|quarter nodes around the town centre, plus the area of each curated-register venue (resolved by the
venue's name in OSM, then the nearest area node), for venues our data gives no coordinates for. Ticketmaster venues carry coordinates
and are matched at build time. Data (c) OpenStreetMap contributors, ODbL. Review the diff before committing.

    python -m scripts.fetch_city_areas --town glasgow [--radius-km 8] [--extras-only]

Also writes `places` (normalised name of an OSM pub/bar/nightclub/restaurant with opening hours -> area, for grouping "Open late" by
neighbourhood; the weekly osm_places snapshot has no coordinates) and `venueMiles` (straight-line miles from the town centre for each
curated-register venue, for the near / further-afield split). --extras-only keeps the area nodes already in the file and refreshes only these two.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import time
from pathlib import Path

import requests

from scrapers.user_agent import user_agent

ROOT = Path(__file__).resolve().parent.parent
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
ATTRIBUTION = "Neighbourhoods: © OpenStreetMap contributors (ODbL)"
MAX_VENUE_AREA_KM = 1.5


def km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = math.pi / 180
    h = math.sin((b_lat - a_lat) * r / 2) ** 2 + math.cos(a_lat * r) * math.cos(b_lat * r) * math.sin((b_lon - a_lon) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def overpass(query: str, ua: str) -> list[dict]:
    last = ""
    for attempt in range(3):
        try:
            res = requests.post(ENDPOINTS[attempt % 2], data={"data": query}, headers={"User-Agent": ua}, timeout=90)
            if res.status_code == 200:
                return res.json().get("elements", [])
            last = f"{res.status_code}"
        except requests.RequestException as e:
            last = str(e)
        time.sleep(20 * (attempt + 1))
    raise RuntimeError(f"Overpass unavailable ({last})")


def nominatim(name: str, lat: float, lon: float, ua: str) -> tuple[float, float] | None:
    """One geocoder lookup for a venue Overpass did not find by name, bounded to about 25 miles round the town centre."""
    try:
        time.sleep(1.5)
        res = requests.get("https://nominatim.openstreetmap.org/search", headers={"User-Agent": ua}, timeout=30, params={
            "q": name, "format": "jsonv2", "limit": 1, "bounded": 1, "viewbox": f"{lon - 0.4},{lat + 0.4},{lon + 0.4},{lat - 0.4}"})
        hits = res.json() if res.status_code == 200 else []
        return (float(hits[0]["lat"]), float(hits[0]["lon"])) if hits else None
    except (requests.RequestException, ValueError, KeyError):
        return None


def point(el: dict) -> tuple[float, float] | None:
    if "lat" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    return (c["lat"], c["lon"]) if c else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--town", required=True)
    ap.add_argument("--radius-km", type=float, default=8)
    ap.add_argument("--extras-only", action="store_true")
    args = ap.parse_args()
    cfg = json.loads((ROOT / "configs" / f"{args.town}.json").read_text(encoding="utf-8"))
    lat, lon = cfg["coordinates"]["lat"], cfg["coordinates"]["lon"]
    ua = user_agent(args.town)
    around = f"(around:{round(args.radius_km * 1000)},{lat},{lon})"

    out = ROOT / "site" / "src" / "config" / "areas" / f"{args.town}.json"
    if args.extras_only:
        area_list = json.loads(out.read_text(encoding="utf-8"))["areas"]
        print(f"{len(area_list)} area nodes (kept)")
    else:
        nodes = overpass(f'[out:json][timeout:60];node["place"~"^(suburb|neighbourhood|quarter)$"]["name"]{around};out;', ua)
        areas: dict[str, dict] = {}
        for el in nodes:
            name = el["tags"]["name"]
            areas.setdefault(name, {"name": name, "lat": round(el["lat"], 5), "lon": round(el["lon"], 5)})
        area_list = sorted(areas.values(), key=lambda a: a["name"])
        print(f"{len(area_list)} area nodes")

    venues: dict[str, str] = {}
    venue_miles: dict[str, float] = {}
    names = [v["name"] for v in cfg.get("evening_register", {}).get("venues", [])]
    if names:
        time.sleep(5)
        alt = "|".join(re.escape(n) for n in names + [a for v in cfg["evening_register"]["venues"] for a in v.get("aliases", [])])
        els = overpass(f'[out:json][timeout:60];nwr["name"~"^({alt})$",i]{around};out tags center;', ua)
        for v in cfg["evening_register"]["venues"]:
            wanted = {norm(v["name"]), *map(norm, v.get("aliases", []))}
            hit = next((p for el in els if norm(el.get("tags", {}).get("name", "")) in wanted and (p := point(el))), None)
            if not hit:
                hit = nominatim(v["name"], lat, lon, ua)
                if hit:
                    venue_miles[norm(v["name"])] = round(km(lat, lon, hit[0], hit[1]) / 1.609344, 1)
                    print(f"  {v['name']} -> {venue_miles[norm(v['name'])]} mi (Nominatim; no area)")
                else:
                    print(f"  [no OSM match] {v['name']}: distance unknown, counts as near")
                continue
            venue_miles[norm(v["name"])] = round(km(lat, lon, hit[0], hit[1]) / 1.609344, 1)
            best = min(area_list, key=lambda a: km(hit[0], hit[1], a["lat"], a["lon"]), default=None)
            if best and km(hit[0], hit[1], best["lat"], best["lon"]) <= MAX_VENUE_AREA_KM:
                venues[norm(v["name"])] = best["name"]
                print(f"  {v['name']} -> {best['name']}")
            else:
                print(f"  [no area within {MAX_VENUE_AREA_KM} km] {v['name']}")

    places: dict[str, str] = {}
    ol = cfg.get("open_late")
    if ol and area_list:
        time.sleep(5)
        ol_around = f"(around:{round(ol['radius_km'] * 1000)},{lat},{lon})"
        try:
            els = overpass(f'[out:json][timeout:90];nwr["amenity"~"^(pub|bar|nightclub|restaurant)$"]["opening_hours"]["name"]{ol_around};out tags center;', ua)
        except RuntimeError as e:
            print(f"  [open-late places skipped] {e}")
            els = []
        seen: dict[str, set[str]] = {}
        for el in els:
            p = point(el)
            if not p:
                continue
            best = min(area_list, key=lambda a: km(p[0], p[1], a["lat"], a["lon"]))
            if km(p[0], p[1], best["lat"], best["lon"]) <= MAX_VENUE_AREA_KM:
                seen.setdefault(norm(el["tags"]["name"]), set()).add(best["name"])
            else:
                seen.setdefault(norm(el["tags"]["name"]), set()).add("")
        # a chain with branches in several areas (or one outside every area) is ambiguous by name alone: no area
        places = {k: next(iter(v)) for k, v in sorted(seen.items()) if len(v) == 1 and next(iter(v))}
        print(f"{len(places)} open-late places with an area (of {len(seen)} names)")

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"attribution": ATTRIBUTION, "areas": area_list, "venues": venues, "venueMiles": venue_miles, "places": places}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
