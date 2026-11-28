"""/help/ places: lat/lon at write time (owner 2026-11-28). Fills ONLY rows where lat and lon are NULL; never overwrites, never guesses.
  * UK postcode   -> postcodes.io /postcodes/<postcode> (open data: OS / Royal Mail / ONS), the postcode's centre.
  * US address    -> Nominatim (OpenStreetMap), street + town + state + ZIP; accepted only when the hit has the SAME house number
                     and the SAME ZIP as the row (a street centroid or a near-miss is no answer). 1 request/s (polite_fetch API_TERMS).
  * anything else -> nothing.
Every request goes through PoliteFetcher (ViewMediaBot UA, robots.txt, ledger). Run by scrapers/help_sources --write and by the weekly
freshness job (scripts/watch_sources, write mode) after their own writes; the one-off backfill is `python -m scrapers.help_geocode`
(--dry-run prints the plan; --write needs --prod + ALLOW_PROD_WRITE=help_geocode and a backup first, CLAUDE.md 14)."""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from urllib.parse import quote

from db import help_places as hp

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
POSTCODES_IO = "https://api.postcodes.io/postcodes/"
UK_POSTCODE = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$", re.I)
STATE = {"brookings_sd": "SD", "broomfield_co": "CO", "moreno_valley_ca": "CA"}
HOUSE_NUMBER = re.compile(r"^\s*(\d+[A-Za-z]?)\b")


@dataclass(frozen=True)
class Found:
    place_id: int
    slug: str
    lat: float
    lon: float
    how: str


@dataclass
class Plan:
    found: list[Found] = field(default_factory=list)
    missed: list[tuple[int, str, str]] = field(default_factory=list)   # (id, slug, why)


def _json(got):
    from scrapers.polite_fetch import Fetched
    if not isinstance(got, Fetched) or got.status != 200:
        return None
    try:
        return json.loads(got.text)
    except ValueError:
        return None


def _uk(row: dict, fetcher) -> tuple[float, float, str] | None:
    pc = re.sub(r"\s+", " ", row["postal_code"].strip().upper())
    body = _json(fetcher.get(POSTCODES_IO + quote(pc)))
    res = (body or {}).get("result") if isinstance(body, dict) else None
    if not res or res.get("latitude") is None or res.get("longitude") is None:
        return None
    return float(res["latitude"]), float(res["longitude"]), "postcodes.io"


def _us(row: dict, fetcher) -> tuple[float, float, str] | None:
    street, zip_ = (row.get("street_address") or "").strip(), (row.get("postal_code") or "").strip()
    number = HOUSE_NUMBER.match(street)
    state = STATE.get(row["town_id"])
    if not number or not state or not zip_:
        return None
    q = f"{street}, {hp.TOWN_NAMES[row['town_id']]}, {state} {zip_}"
    rows = _json(fetcher.get(NOMINATIM_URL, {"q": q, "format": "jsonv2", "limit": 1, "countrycodes": "us", "addressdetails": 1}))
    if not rows or not isinstance(rows, list):
        return None
    addr = rows[0].get("address") or {}
    if addr.get("house_number") != number.group(1) or not str(addr.get("postcode", "")).startswith(zip_[:5]):
        return None
    return float(rows[0]["lat"]), float(rows[0]["lon"]), "nominatim"


def locate(row: dict, fetcher) -> tuple[float, float, str] | None:
    """(lat, lon, source) for one help place row, or None. No lookup at all when the row cannot be matched exactly."""
    pc = row.get("postal_code") or ""
    if UK_POSTCODE.match(pc.strip()):
        return _uk(row, fetcher)
    if row["town_id"] in STATE:
        return _us(row, fetcher)
    return None


def plan(rows: list[dict], fetcher_for) -> Plan:
    out = Plan()
    for r in rows:
        if r.get("lat") is not None or r.get("lon") is not None:
            continue
        hit = locate(r, fetcher_for(r["town_id"]))
        if hit:
            out.found.append(Found(r["id"], r["slug"], hit[0], hit[1], hit[2]))
        else:
            out.missed.append((r["id"], r["slug"], "no exact match" if (r.get("postal_code") or r.get("street_address")) else "no address"))
    return out


def apply(cur, found: list[Found]) -> None:
    for f in found:
        cur.execute("UPDATE places SET lat = %s, lon = %s WHERE id = %s AND lat IS NULL AND lon IS NULL", (f.lat, f.lon, f.place_id))


def load(cur, town: str | None = None) -> list[dict]:
    """The help places without coordinates (all towns, or one)."""
    cols = ("id", "town_id", "slug", "street_address", "postal_code", "lat", "lon")
    sql = f"SELECT {', '.join(cols)} FROM places WHERE category = ANY(%s) AND lat IS NULL AND lon IS NULL"
    args: list = [list(hp.HELP_CATEGORIES)]
    if town:
        sql += " AND town_id = %s"
        args.append(town)
    cur.execute(sql + " ORDER BY id", args)
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def fill(cur, fetcher_for, town: str | None = None) -> Plan:
    """Look up and write coordinates for the help places that have none (the write paths call this after their own writes)."""
    p = plan(load(cur, town), fetcher_for)
    apply(cur, p.found)
    return p


def _fetcher_for(town: str):
    from scrapers.polite_fetch import PoliteFetcher
    return PoliteFetcher("source", town)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Fill lat/lon of /help/ places that have none (postcodes.io UK, Nominatim US).")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--write", action="store_true", help="live needs --prod + ALLOW_PROD_WRITE=help_geocode (backup first)")
    ap.add_argument("--town")
    from db.db import connect   # reads --prod from sys.argv (the write guard)
    args = ap.parse_args([a for a in argv if a != "--prod"])
    conn = connect()
    try:
        with conn.cursor() as cur:
            rows = load(cur, args.town)
            fetchers: dict = {}
            p = plan(rows, lambda t: fetchers.setdefault(t, _fetcher_for(t)))
            for f in p.found:
                print(f"FOUND  {f.place_id:>4} {f.slug:<55} {f.lat:.6f},{f.lon:.6f}  ({f.how})")
            for pid, slug, why in p.missed:
                print(f"EMPTY  {pid:>4} {slug:<55} {why}")
            print(f"{len(rows)} rows without coordinates: {len(p.found)} found, {len(p.missed)} left empty")
            if args.write:
                apply(cur, p.found)
                conn.commit()
                print(f"written: {len(p.found)}")
            else:
                conn.rollback()
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
