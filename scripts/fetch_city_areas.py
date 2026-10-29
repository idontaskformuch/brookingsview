"""Static neighbourhood file per town for /tonight and /this-weekend ("Merchant City" next to a venue).

Reads OpenStreetMap through Overpass (read-only, ViewMediaBot, two requests per town) and writes site/src/config/areas/<town>.json:
the place=suburb|neighbourhood|quarter nodes around the town centre, plus the area of each curated-register venue (resolved by the
venue's name in OSM, then the nearest area node), for venues our data gives no coordinates for. Ticketmaster venues carry coordinates
and are matched at build time. Data (c) OpenStreetMap contributors, ODbL. Review the diff before committing.

    python -m scripts.fetch_city_areas --town glasgow [--radius-km 8]
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


def point(el: dict) -> tuple[float, float] | None:
    if "lat" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    return (c["lat"], c["lon"]) if c else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--town", required=True)
    ap.add_argument("--radius-km", type=float, default=8)
    args = ap.parse_args()
    cfg = json.loads((ROOT / "configs" / f"{args.town}.json").read_text(encoding="utf-8"))
    lat, lon = cfg["coordinates"]["lat"], cfg["coordinates"]["lon"]
    ua = user_agent(args.town)
    around = f"(around:{round(args.radius_km * 1000)},{lat},{lon})"

    nodes = overpass(f'[out:json][timeout:60];node["place"~"^(suburb|neighbourhood|quarter)$"]["name"]{around};out;', ua)
    areas: dict[str, dict] = {}
    for el in nodes:
        name = el["tags"]["name"]
        areas.setdefault(name, {"name": name, "lat": round(el["lat"], 5), "lon": round(el["lon"], 5)})
    area_list = sorted(areas.values(), key=lambda a: a["name"])
    print(f"{len(area_list)} area nodes")

    venues: dict[str, str] = {}
    names = [v["name"] for v in cfg.get("evening_register", {}).get("venues", [])]
    if names:
        time.sleep(5)
        alt = "|".join(re.escape(n) for n in names + [a for v in cfg["evening_register"]["venues"] for a in v.get("aliases", [])])
        els = overpass(f'[out:json][timeout:60];nwr["name"~"^({alt})$",i]{around};out tags center;', ua)
        for v in cfg["evening_register"]["venues"]:
            wanted = {norm(v["name"]), *map(norm, v.get("aliases", []))}
            hit = next((p for el in els if norm(el.get("tags", {}).get("name", "")) in wanted and (p := point(el))), None)
            if not hit:
                print(f"  [no OSM match] {v['name']}")
                continue
            best = min(area_list, key=lambda a: km(hit[0], hit[1], a["lat"], a["lon"]), default=None)
            if best and km(hit[0], hit[1], best["lat"], best["lon"]) <= MAX_VENUE_AREA_KM:
                venues[norm(v["name"])] = best["name"]
                print(f"  {v['name']} -> {best['name']}")
            else:
                print(f"  [no area within {MAX_VENUE_AREA_KM} km] {v['name']}")

    out = ROOT / "site" / "src" / "config" / "areas" / f"{args.town}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"attribution": ATTRIBUTION, "areas": area_list, "venues": venues}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
