"""Source discovery pilot: Fas 1-3 of .claude/specs/source-discovery-engine.md in read mode (owner 2026-11-18).

Runs in .github/workflows/discovery-pilot.yml, once a day on the dates in configs/shared/discovery_pilot.json, one job per town.
Nothing touches a database (no read, no write); each day's result is a JSON file uploaded as a workflow artifact, and the next day
starts from the earlier days' files.

  Fas 1, candidates: OpenStreetMap POIs with a website inside the town (Overpass), and new domains from Brave queries built from a
         config template (at most `max_queries_per_town_per_day` per town and day; a query already run on an earlier day is not
         asked again). Our own sites, existing sources, blocked domains and social networks are never candidates.
  Fas 2, probe, in the spec's order, every request through scrapers/polite_fetch.py (robots.txt, one UA, rule 13):
         robots.txt (no = closed) -> /wp-json/tribe/events/v1/events -> an iCal link or a Google Calendar embed -> schema.org
         Event JSON-LD on / /events /calendar /whats-on /christmas -> RSS/Atom with dated items -> an Eventbrite organizer link.
         Nothing found = the candidate rests (90 days in the engine). No HTML scraping, no model.
  Fas 3, admission (judged in `report`, never applied): robots allows and the format is structured; >= 80 % of the events lie
         inside the town by the existing radius rule (inside the boundary, or within 25 miles of the centre; coordinates from the
         source, else Nominatim on the source's own place text); every date reasonable (no year before 2000, at most 12 months
         ahead); three successful fetches on consecutive days; at most 50 % duplicates of another source's events.

    python -m scripts.discovery_pilot gate                                    # run=true|false for today's UTC date ($GITHUB_OUTPUT)
    python -m scripts.discovery_pilot day --town glasgow --state prev/ --out out/
    python -m scripts.discovery_pilot report --state all/ --out report/

Eventbrite: an organizer link is recorded as a format, but the pilot has no Eventbrite API key, so it is never fetched (and never
admitted). Duplicates are measured between the pilot's own candidate sources only: the pilot reads no database, so overlap with the
events we already publish is not measured.
"""
from __future__ import annotations

import argparse
import html as _html
import json
import math
import os
import random
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, urljoin, urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "configs" / "shared" / "discovery_pilot.json"
BOUNDARY_DIR = ROOT / "site" / "src" / "data" / "town-boundaries"
BLOCKED_PATH = ROOT / "scripts" / "blocked-domains.json"
OVERPASS_URLS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")  # as refresh_osm_places
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
BRAVE_URL = "https://api.search.brave.com/res/v1/web/search"
EARTH_RADIUS_MILES = 3958.8
MAX_EVENTS_KEPT = 300  # per source and day in the artifact
BRAVE_GAP_S = 1.1  # Brave's base plans allow 1 request per second


def load_config(path: Path = CONFIG_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def town_config(town_id: str) -> dict:
    return json.loads((ROOT / "configs" / f"{town_id}.json").read_text(encoding="utf-8"))


# --- geometry: the existing radius rule (site/src/lib/town-boundary.ts) -----------------------------------------------------------
def load_boundary(town_id: str) -> dict | None:
    path = BOUNDARY_DIR / f"{town_id}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def _in_ring(lon: float, lat: float, ring: list) -> bool:
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_boundary(lat: float, lon: float, geometry: dict) -> bool:
    polys = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    return any(_in_ring(lon, lat, rings[0]) and not any(_in_ring(lon, lat, h) for h in rings[1:]) for rings in polys)


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(min(1.0, math.sqrt(a)))


def in_area(lat: float, lon: float, center: dict, boundary: dict | None, radius_miles: float) -> bool:
    """In the town by the existing rule: inside its boundary, or within `radius_miles` of its centre."""
    if boundary is not None and in_boundary(lat, lon, boundary):
        return True
    return haversine_miles(lat, lon, center["lat"], center["lon"]) <= radius_miles


def bbox(geometry: dict) -> tuple[float, float, float, float]:
    polys = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    pts = [p for rings in polys for p in rings[0]]
    return min(p[1] for p in pts), min(p[0] for p in pts), max(p[1] for p in pts), max(p[0] for p in pts)


# --- hosts ------------------------------------------------------------------------------------------------------------------------
def host_of(url: str) -> str:
    return urlparse(url).netloc.lower().split(":")[0].removeprefix("www.")


def _urls_in(obj: Any) -> list[str]:
    if isinstance(obj, dict):
        return [u for v in obj.values() for u in _urls_in(v)]
    if isinstance(obj, list):
        return [u for v in obj for u in _urls_in(v)]
    return [obj] if isinstance(obj, str) and obj.startswith(("http://", "https://")) else []


def known_hosts(tcfg: dict) -> set[str]:
    """Hosts of every URL the town's config already names (sources, links, notes)."""
    return {host_of(u) for u in _urls_in(tcfg) if host_of(u)}


def blocked_hosts() -> set[str]:
    data = json.loads(BLOCKED_PATH.read_text(encoding="utf-8"))
    return {d["domain"].lower().removeprefix("www.") for d in data.get("domains", [])}


def exclusion(host: str, cfg: dict, known: set[str], blocked: set[str]) -> str | None:
    def under(suffixes) -> bool:
        return any(host == s or host.endswith("." + s) for s in suffixes)
    if not host:
        return "no host"
    if under(cfg["exclude_hosts"]["suffixes"]):
        return "excluded host (social network or our own site)"
    if under(blocked):
        return "scripts/blocked-domains.json"
    if host in known:
        return "already a source in the town's config"
    return None


# --- Fas 1: candidates ------------------------------------------------------------------------------------------------------------
def overpass_query(tags: list[list[str]], area: str) -> str:
    sel = "".join(f'nwr["{k}"="{v}"]["name"][~"^(website|contact:website)$"~"."]{area};' for k, v in tags)
    return f"[out:json][timeout:60];({sel});out tags center;"


def osm_area(town_id: str, tcfg: dict, pcfg: dict) -> tuple[str, dict | None]:
    boundary = load_boundary(town_id)
    if boundary is not None:
        s, w, n, e = bbox(boundary)
        return f"({s},{w},{n},{e})", boundary
    c = tcfg["coordinates"]
    return f"(around:{round(pcfg['towns'][town_id]['osm_radius_km'] * 1000)},{c['lat']},{c['lon']})", None


def osm_candidates(elements: list[dict], boundary: dict | None, tags: list[list[str]]) -> list[dict]:
    """One candidate per element with a website; inside the boundary when the town has one (the Overpass bbox is wider)."""
    out = []
    for el in elements:
        t = el.get("tags") or {}
        url = (t.get("website") or t.get("contact:website") or "").strip()
        if not url.startswith(("http://", "https://")):
            url = "https://" + url if url and " " not in url else ""
        pos = el.get("center") or el
        lat, lon = pos.get("lat"), pos.get("lon")
        if not url or lat is None or lon is None:
            continue
        if boundary is not None and not in_boundary(lat, lon, boundary):
            continue
        cat = next((f"{k}={v}" for k, v in tags if t.get(k) == v), None)
        out.append({"host": host_of(url), "url": url, "name": t.get("name"), "source": "osm",
                    "osm_id": f"{el.get('type')}/{el.get('id')}", "category": cat, "lat": lat, "lon": lon})
    return out


def queries_for_day(pcfg: dict, town_id: str, already_run: set[str], today: date) -> list[str]:
    """Templates in season for `today`, not asked on an earlier day, at most the per-town daily cap."""
    city = pcfg["towns"][town_id]["search_name"]
    out = []
    for tpl in pcfg["brave"]["queries"]:
        if tpl.get("months") and today.month not in tpl["months"]:
            continue
        q = tpl["q"].format(city=city)
        if q not in already_run:
            out.append(q)
    return out[: pcfg["brave"]["max_queries_per_town_per_day"]]


def brave_results(session, query: str, api_key: str, count: int, country: str) -> list[dict]:
    """Brave's own result list (title, url). Called directly, not through ai_pipeline.search_client, which logs every call to the
    api_usage table: the pilot touches no database, so it counts its own calls (`brave_calls` in the day file)."""
    res = session.get(BRAVE_URL, params={"q": query, "count": count, "country": country},
                      headers={"Accept": "application/json", "X-Subscription-Token": api_key}, timeout=20)
    res.raise_for_status()
    return [{"title": r.get("title", ""), "url": r.get("url", "")} for r in ((res.json().get("web") or {}).get("results") or [])]


def brave_candidates(session, queries: list[str], api_key: str | None, count: int, country: str, cap: int,
                     sleep=None) -> tuple[list[dict], list[str], list[str]]:
    """(candidates, queries run, errors). Never more than `cap` calls, whatever the list holds; BRAVE_GAP_S between two calls."""
    import time
    sleep = sleep or time.sleep
    cands, run, errors = [], [], []
    if not api_key:
        return cands, run, ["BRAVE_API_KEY missing: no Brave queries"]
    for i, q in enumerate(queries[:cap]):
        if i:
            sleep(BRAVE_GAP_S)
        run.append(q)
        try:
            results = brave_results(session, q, api_key, count, country)
        except Exception as exc:  # noqa: BLE001 -- one failed query is logged, the rest still run
            errors.append(f"{q}: {type(exc).__name__}")
            continue
        for r in results:
            if r["url"].startswith(("http://", "https://")):
                p = urlparse(r["url"])
                cands.append({"host": host_of(r["url"]), "url": f"{p.scheme}://{p.netloc}/", "name": r["title"],
                              "source": "brave", "query": q, "result_url": r["url"]})
    return cands, run, errors


def merge_candidates(*lists: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for lst in lists:
        for c in lst:
            if c["host"] in out:
                out[c["host"]].setdefault("also", []).append({k: c.get(k) for k in ("source", "name", "query", "osm_id") if c.get(k)})
            else:
                out[c["host"]] = dict(c)
    return out


# --- Fas 2: probe -----------------------------------------------------------------------------------------------------------------
_ICS_HREF_RE = re.compile(r"(\.ics(\?|$)|[?&]ical=1|ical_subscribe|/ical/|^webcal://)", re.I)
_EVENTBRITE_RE = re.compile(r"https?://(?:www\.)?eventbrite\.(?:com|co\.uk|ca)/o/[a-z0-9-]+-\d+", re.I)


def _soup(text: str):
    from bs4 import BeautifulSoup
    return BeautifulSoup(text, "html.parser")


def ics_links(page_html: str, base: str) -> list[tuple[str, str]]:
    """[(format, absolute feed URL)]: <link rel=alternate type=text/calendar>, hrefs to .ics / ?ical=1 / webcal:, and Google Calendar
    embeds (their public iCal address is calendar.google.com/calendar/ical/<src>/public/basic.ics)."""
    soup, out = _soup(page_html), []
    for tag in soup.find_all("link", href=True):
        if "text/calendar" in (tag.get("type") or "").lower() and not tag["href"].strip().startswith("#"):
            out.append(("ics", urljoin(base, tag["href"])))
    for tag in soup.find_all("a", href=True):
        href = tag["href"].strip()
        if _ICS_HREF_RE.search(href) and "google.com/calendar" not in href:
            out.append(("ics", "https://" + href[len("webcal://"):] if href.lower().startswith("webcal://") else urljoin(base, href)))
    for tag in soup.find_all(["iframe", "a"]):
        src = tag.get("src") or tag.get("href") or ""
        if "calendar.google.com/calendar" in src and "src=" in src:
            for cal in parse_qs(urlparse(src).query).get("src", []):
                out.append(("google_calendar", f"https://calendar.google.com/calendar/ical/{quote(cal, safe='')}/public/basic.ics"))
    seen, uniq = set(), []
    for f, u in out:
        if u not in seen:
            seen.add(u)
            uniq.append((f, u))
    return uniq


def _ld_objects(obj: Any) -> list[dict]:
    if isinstance(obj, list):
        return [o for x in obj for o in _ld_objects(x)]
    if isinstance(obj, dict):
        return [obj] + _ld_objects(obj.get("@graph", []))
    return []


def _is_event(o: dict) -> bool:
    types = o.get("@type")
    types = types if isinstance(types, list) else [types]
    return any(isinstance(t, str) and t.endswith("Event") for t in types)


def jsonld_events(page_html: str) -> list[dict]:
    out = []
    for tag in _soup(page_html).find_all("script", type=lambda t: t and "ld+json" in t.lower()):
        try:
            data = json.loads(tag.string or tag.get_text() or "")
        except ValueError:
            continue
        out.extend(o for o in _ld_objects(data) if _is_event(o))
    return out


def feed_links(page_html: str, base: str) -> list[str]:
    return [urljoin(base, t["href"]) for t in _soup(page_html).find_all("link", href=True)
            if (t.get("type") or "").lower() in ("application/rss+xml", "application/atom+xml")]


def eventbrite_link(page_html: str) -> str | None:
    m = _EVENTBRITE_RE.search(page_html)
    return m.group(0) if m else None


def rss_items(xml_text: str) -> list[dict]:
    """Items of an RSS or Atom feed with their title and date (pubDate/published/updated/dc:date). Not event times."""
    from xml.etree import ElementTree as ET
    try:
        root = ET.fromstring(xml_text.encode("utf-8") if isinstance(xml_text, str) else xml_text)
    except ET.ParseError:
        return []
    items = []
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        fields = {c.tag.split("}")[-1]: (c.text or "").strip() for c in el}
        when = fields.get("pubDate") or fields.get("published") or fields.get("updated") or fields.get("date")
        items.append({"title": fields.get("title"), "date": when or None})
    return items


def _origin(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme or 'https'}://{p.netloc}"


def probe(fetcher, cand: dict, pcfg: dict, today: date) -> dict:
    """The first format found in the spec's order, or why none. Never more than one request per page (polite_fetch's day cache)."""
    from scrapers import robots as _robots
    from scrapers.polite_fetch import Refused

    origin = _origin(cand["url"])
    home = origin + "/"
    out: dict[str, Any] = {"host": cand["host"], "origin": origin, "format": None, "feed_url": None}
    verdict = fetcher.robots_verdict(home)
    status, text = fetcher.robots_text(home)
    out["robots_status"] = status
    out["old_strict_ai_bot"] = _robots.names_ai_bot(text) if status == 200 else None
    out["llm_excluded"] = {"bot": verdict.ai_bot, "rule": verdict.ai_rule} if verdict.llm_excluded else None
    if not verdict.ok:
        return {**out, "result": "closed", "reason": verdict.reason}

    tribe = origin + "/wp-json/tribe/events/v1/events"
    got = fetcher.get(tribe, {"per_page": pcfg["probe"]["tribe_per_page"], "start_date": today.isoformat()})
    if not isinstance(got, Refused) and got.status == 200:
        try:
            if isinstance(json.loads(got.text).get("events"), list):
                return {**out, "result": "found", "format": "tribe_rest", "feed_url": tribe}
        except (ValueError, AttributeError):
            pass

    pages: dict[str, str] = {}
    refusals = []
    for path in pcfg["probe"]["pages"]:
        got = fetcher.get(origin + path)
        if isinstance(got, Refused):
            refusals.append(got.reason)
            if got.link_only:
                return {**out, "result": "refused", "reason": got.reason}
            continue
        if got.status == 200 and b"<" in got.body[:2000]:
            pages[got.final_url] = got.text
    if not pages:
        return {**out, "result": "unreachable", "reason": "; ".join(refusals) or "no page answered 200"}

    for base, page in pages.items():
        links = ics_links(page, base)
        if links:
            fmt, url = links[0]
            return {**out, "result": "found", "format": fmt, "feed_url": url}
    for base, page in pages.items():
        if jsonld_events(page):
            return {**out, "result": "found", "format": "jsonld", "feed_url": base}
    for base, page in pages.items():
        for feed in feed_links(page, base)[:2]:
            got = fetcher.get(feed)
            if not isinstance(got, Refused) and got.status == 200 and any(i["date"] for i in rss_items(got.text)):
                return {**out, "result": "found", "format": "rss", "feed_url": feed}
    for page in pages.values():
        eb = eventbrite_link(page)
        if eb:
            return {**out, "result": "found", "format": "eventbrite_organizer", "feed_url": eb}
    return {**out, "result": "none", "reason": "no structured format found (rests 90 days)"}


# --- Fas 3: fetch and normalise ---------------------------------------------------------------------------------------------------
def _address_text(loc: Any) -> str | None:
    """The street address alone (what Nominatim can find); None when the source gives none."""
    if isinstance(loc, list):
        loc = loc[0] if loc else None
    addr = loc.get("address") if isinstance(loc, dict) else None
    if isinstance(addr, dict):
        addr = ", ".join(str(addr[k]).strip() for k in ("streetAddress", "addressLocality", "addressRegion", "postalCode")
                         if addr.get(k) and str(addr[k]).strip())
    return addr.strip() if isinstance(addr, str) and addr.strip() else None


def _place_text(loc: Any) -> str | None:
    if isinstance(loc, list):
        loc = loc[0] if loc else None
    if isinstance(loc, str):
        return loc.strip() or None
    if not isinstance(loc, dict):
        return None
    parts = [p for p in (loc.get("name"), _address_text(loc)) if isinstance(p, str) and p.strip()]
    return ", ".join(p.strip() for p in parts) or None


def _geo(loc: Any) -> tuple[float | None, float | None]:
    if isinstance(loc, list):
        loc = loc[0] if loc else None
    geo = loc.get("geo") if isinstance(loc, dict) else None
    try:
        return float(geo["latitude"]), float(geo["longitude"])
    except (TypeError, KeyError, ValueError):
        return None, None


def events_from_jsonld(objs: list[dict]) -> list[dict]:
    out = []
    for o in objs:
        lat, lon = _geo(o.get("location"))
        out.append({"title": _html.unescape(str(o.get("name") or "")).strip(), "start": o.get("startDate"), "end": o.get("endDate"),
                    "venue": _place_text(o.get("location")), "address": _address_text(o.get("location")), "lat": lat, "lon": lon,
                    "url": o.get("url")})
    return out


def events_from_tribe(body: str) -> list[dict]:
    out = []
    for e in json.loads(body).get("events", []):
        v = e.get("venue") if isinstance(e.get("venue"), dict) else {}
        address = ", ".join(p for p in (v.get("address"), v.get("city"),
                                        " ".join(p for p in (v.get("state") or v.get("stateprovince"), v.get("zip")) if p)) if p)
        place = ", ".join(p for p in (v.get("venue"), address) if p)
        try:
            lat, lon = float(v["geo_lat"]), float(v["geo_lng"])
        except (KeyError, TypeError, ValueError):
            lat = lon = None
        tz = e.get("timezone")
        def iso(s):
            if not s:
                return None
            d = datetime.fromisoformat(s)
            return (d.replace(tzinfo=ZoneInfo(tz)) if tz else d).isoformat()
        out.append({"title": _html.unescape(re.sub(r"<[^>]+>", "", str(e.get("title") or ""))).strip(),
                    "start": iso(e.get("start_date")), "end": iso(e.get("end_date")), "venue": place or None,
                    "address": address if v.get("address") else None,
                    "lat": lat, "lon": lon, "url": e.get("url")})
    return out


def events_from_ics(body: bytes, tzname: str) -> list[dict]:
    from scrapers.event_sources import _parse_ical
    return [{"title": r["title"], "start": r["starts_at"], "end": r["ends_at"], "venue": r["venue"], "lat": None, "lon": None,
             "url": r["url"]} for r in _parse_ical("discovery", body, tzname)]


def fetch_events(fetcher, found: dict, tzname: str, pcfg: dict, today: date) -> dict:
    """One fetch of a found source: {"ok", "reason", "events"}. ok = 200 and at least one event parsed."""
    from scrapers.polite_fetch import Refused

    fmt, url = found["format"], found["feed_url"]
    if fmt == "eventbrite_organizer":
        return {"ok": False, "reason": "not fetched: the pilot has no Eventbrite API key", "events": []}
    params = {"per_page": pcfg["probe"]["tribe_per_page"], "start_date": today.isoformat()} if fmt == "tribe_rest" else None
    got = fetcher.get(url, params)
    if isinstance(got, Refused):
        return {"ok": False, "reason": got.reason, "events": []}
    if got.status != 200:
        return {"ok": False, "reason": f"status {got.status}", "events": []}
    try:
        if fmt == "tribe_rest":
            events = events_from_tribe(got.text)
        elif fmt in ("ics", "google_calendar"):
            events = events_from_ics(got.body, tzname)
        elif fmt == "jsonld":
            events = events_from_jsonld(jsonld_events(got.text))
        else:  # rss: item dates are publication dates, not event times
            events = [{"title": i["title"], "start": None, "end": None, "venue": None, "lat": None, "lon": None, "url": None,
                       "published": i["date"]} for i in rss_items(got.text)]
    except Exception as exc:  # noqa: BLE001 -- a source that does not parse is a failed fetch, not a crashed pilot
        return {"ok": False, "reason": f"parse error: {type(exc).__name__}", "events": []}
    events = [e for e in events if e["title"]]
    return {"ok": bool(events), "reason": "" if events else "no events in the feed", "events": events}


# --- Fas 3: judging ---------------------------------------------------------------------------------------------------------------
def _parse_dt(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def date_reasonable(start: Any, now: datetime, acfg: dict) -> bool:
    d = _parse_dt(start)
    return d is not None and d.year >= acfg["earliest_year"] and d <= now + timedelta(days=acfg["max_days_ahead"])


class Geocoder:
    """Nominatim through polite_fetch (its API terms: 1 request/s, identifying UA). One lookup per distinct place text, cached across
    days in the artifact; at most `budget` new lookups per run."""

    def __init__(self, fetcher, countrycodes: str, budget: int, cache: dict | None = None):
        self.fetcher, self.countrycodes, self.budget = fetcher, countrycodes, budget
        self.cache: dict[str, list[float] | None] = dict(cache or {})
        self.lookups = 0

    def __call__(self, text: str | None) -> tuple[float, float] | None:
        from scrapers.polite_fetch import Refused
        if not text:
            return None
        key = re.sub(r"\s+", " ", text).strip().lower()
        if key in self.cache:
            hit = self.cache[key]
            return (hit[0], hit[1]) if hit else None
        if self.lookups >= self.budget:
            return None
        self.lookups += 1
        got = self.fetcher.get(NOMINATIM_URL, {"q": text, "format": "jsonv2", "limit": 1, "countrycodes": self.countrycodes})
        hit = None
        if not isinstance(got, Refused) and got.status == 200:
            try:
                rows = json.loads(got.text)
                if rows:
                    hit = [float(rows[0]["lat"]), float(rows[0]["lon"])]
            except (ValueError, KeyError, TypeError):
                hit = None
        self.cache[key] = hit
        return (hit[0], hit[1]) if hit else None


def judge_events(events: list[dict], geocode, center: dict, boundary: dict | None, acfg: dict, now: datetime) -> dict:
    n = len(events)
    reasonable = inside = located = 0
    for e in events:
        e["date_ok"] = date_reasonable(e.get("start"), now, acfg)
        reasonable += e["date_ok"]
        lat, lon = e.get("lat"), e.get("lon")
        if lat is None or lon is None:
            hit = geocode(e.get("address") or e.get("venue"))  # the street address when the source has one
            lat, lon = hit if hit else (None, None)
            e["geocoded"] = hit is not None
        if lat is not None and lon is not None:
            located += 1
            e["inside"] = in_area(lat, lon, center, boundary, acfg["nearby_radius_miles"])
            inside += e["inside"]
        else:
            e["inside"] = None
    upcoming = sum(1 for e in events if (_parse_dt(e.get("start")) or datetime.min.replace(tzinfo=timezone.utc)) >= now)
    return {"events": n, "reasonable_dates": reasonable, "located": located, "inside": inside, "upcoming": upcoming,
            "in_area_share": round(inside / n, 3) if n else 0.0, "reasonable_share": round(reasonable / n, 3) if n else 0.0}


def event_key(e: dict) -> tuple[str, str] | None:
    d = _parse_dt(e.get("start"))
    if d is None:
        return None
    return re.sub(r"[^a-z0-9]+", " ", (e.get("title") or "").lower()).strip(), d.date().isoformat()


def duplicate_shares(events_by_host: dict[str, list[dict]]) -> dict[str, float]:
    """Per source: the share of its events (title + date) that another candidate source of the same town also lists."""
    keys = {h: {k for e in evs if (k := event_key(e))} for h, evs in events_by_host.items()}
    out = {}
    for h, mine in keys.items():
        others = set().union(*(k for o, k in keys.items() if o != h)) if len(keys) > 1 else set()
        out[h] = round(len(mine & others) / len(mine), 3) if mine else 0.0
    return out


def longest_consecutive_days(days: list[str]) -> int:
    ds = sorted({date.fromisoformat(d) for d in days})
    best = run = 0
    prev = None
    for d in ds:
        run = run + 1 if prev is not None and d - prev == timedelta(days=1) else 1
        best, prev = max(best, run), d
    return best


def admission(src: dict, acfg: dict) -> tuple[bool, list[str]]:
    """Every Fas 3 rule for one source; the failed ones as reasons."""
    why = []
    if src.get("format") not in acfg["structured_formats"]:
        why.append("no structured format")
    if src.get("in_area_share", 0) < acfg["min_in_area_share"]:
        why.append(f"in area {src.get('in_area_share', 0):.0%} < {acfg['min_in_area_share']:.0%}")
    if src.get("reasonable_share", 0) < acfg["min_reasonable_date_share"]:
        why.append(f"reasonable dates {src.get('reasonable_share', 0):.0%}")
    if src.get("consecutive_ok_days", 0) < acfg["min_successful_days"]:
        why.append(f"{src.get('consecutive_ok_days', 0)} successful day(s) in a row < {acfg['min_successful_days']}")
    if src.get("duplicate_share", 0) > acfg["max_duplicate_share"]:
        why.append(f"duplicates {src['duplicate_share']:.0%} > {acfg['max_duplicate_share']:.0%}")
    return not why, why


# --- state ------------------------------------------------------------------------------------------------------------------------
def load_days(state_dir: Path | None, town_id: str | None = None) -> list[dict]:
    if state_dir is None or not state_dir.is_dir():
        return []
    days = []
    for p in sorted(state_dir.rglob("day-*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        if town_id is None or d.get("town_id") == town_id:
            days.append(d)
    return sorted(days, key=lambda d: (d["town_id"], d["date"]))


# --- commands ---------------------------------------------------------------------------------------------------------------------
def cmd_gate(pcfg: dict, today: date) -> int:
    run = today.isoformat() in pcfg["run_dates"]
    line = f"run={'true' if run else 'false'}"
    print(f"{line} ({today.isoformat()}, run dates {', '.join(pcfg['run_dates'])})")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    return 0


def cmd_day(pcfg: dict, town_id: str, state_dir: Path | None, out_dir: Path, now: datetime, *, fetcher=None, session=None) -> dict:
    from scrapers.polite_fetch import PoliteFetcher, Refused

    today = now.date()
    tcfg = town_config(town_id)
    tz = tcfg["timezone"]
    center = tcfg["coordinates"]
    acfg = pcfg["admission"]
    town_pcfg = pcfg["towns"][town_id]
    fetcher = fetcher or PoliteFetcher("dryrun", town_id)
    if session is None:
        import requests
        session = requests.Session()
    earlier = [d for d in load_days(state_dir, town_id) if d["date"] < today.isoformat()]
    known, blocked = known_hosts(tcfg), blocked_hosts()

    # Fas 1
    candidates: dict[str, dict] = {}
    for d in earlier:
        candidates.update(d.get("candidates", {}))
    log: list[str] = []
    area, boundary = osm_area(town_id, tcfg, pcfg)
    osm_new: list[dict] = []
    if not any(d.get("osm_done") for d in earlier):
        for endpoint in OVERPASS_URLS:  # the mirror only when the main instance gives no usable answer
            got = fetcher.get(endpoint, {"data": overpass_query(pcfg["osm"]["tags"], area)})
            if not isinstance(got, Refused) and got.status == 200:
                break
            log.append(f"overpass {host_of(endpoint)}: {got.reason if isinstance(got, Refused) else got.status}")
        if not isinstance(got, Refused) and got.status == 200:
            try:
                osm_new = osm_candidates(json.loads(got.text).get("elements", []), boundary, pcfg["osm"]["tags"])
            except ValueError:
                log.append(f"overpass: answer is not JSON ({len(got.body)} bytes{', cut at the size cap' if got.cut else ''})")
    already = {q for d in earlier for q in d.get("queries_run", [])}
    queries = queries_for_day(pcfg, town_id, already, today)
    brave_new, queries_run, brave_errors = brave_candidates(
        session, queries, os.environ.get("BRAVE_API_KEY"), pcfg["brave"]["results_per_query"], town_pcfg["brave_country"],
        pcfg["brave"]["max_queries_per_town_per_day"])
    log.extend(brave_errors)
    excluded: dict[str, str] = {}
    for host, c in merge_candidates(osm_new, brave_new).items():
        why = exclusion(host, pcfg, known, blocked)
        if why:
            excluded[host] = why
        elif host not in candidates:
            candidates[host] = c

    # Fas 2
    probes: dict[str, dict] = {}
    for d in earlier:
        probes.update(d.get("probes", {}))
    todo = [h for h in candidates if h not in probes][: pcfg["probe"]["max_new_probes_per_town_per_day"]]
    for host in todo:
        probes[host] = {**probe(fetcher, candidates[host], pcfg, today), "probed_on": today.isoformat()}

    # Fas 3: today's fetch of every found source
    cache: dict = {}
    for d in earlier:
        cache.update(d.get("geocode_cache", {}))
    geocode = Geocoder(fetcher, town_pcfg["nominatim_countrycodes"], pcfg["geocode"]["max_lookups_per_town_per_day"], cache)
    fetches = {}
    for host, p in probes.items():
        if p.get("result") != "found":
            continue
        f = fetch_events(fetcher, p, tz, pcfg, today)
        stats = judge_events(f["events"], geocode, center, boundary, acfg, now) if f["ok"] else {}
        fetches[host] = {"format": p["format"], "feed_url": p["feed_url"], "ok": f["ok"], "reason": f["reason"], "stats": stats,
                         "events": f["events"][:MAX_EVENTS_KEPT]}

    day = {"town_id": town_id, "date": today.isoformat(), "generated_utc": now.isoformat(timespec="seconds"),
           "osm_done": bool(osm_new) or any(d.get("osm_done") for d in earlier), "osm_new": len(osm_new),
           "queries_run": queries_run, "brave_calls": len(queries_run), "brave_new": len(brave_new), "excluded": excluded,
           "candidates": candidates, "probes": probes, "probed_today": todo, "fetches": fetches,
           "geocode_lookups": geocode.lookups, "geocode_cache": geocode.cache, "log": log}
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"day-{town_id}-{today.isoformat()}.json").write_text(json.dumps(day, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[{town_id}] {today}: candidates {len(candidates)} (osm +{len(osm_new)}, brave +{len(brave_new)} from {len(queries_run)} "
          f"queries), probed {len(todo)}, found {sum(1 for p in probes.values() if p.get('result') == 'found')}, "
          f"fetched ok {sum(1 for f in fetches.values() if f['ok'])}/{len(fetches)}, geocode lookups {geocode.lookups}")
    return day


def town_report(days: list[dict], pcfg: dict) -> dict:
    acfg = pcfg["admission"]
    last = days[-1]
    ok_days: dict[str, list[str]] = {}
    for d in days:
        for host, f in d["fetches"].items():
            if f["ok"]:
                ok_days.setdefault(host, []).append(d["date"])
    latest: dict[str, dict] = {}
    for d in days:  # each source's newest successful fetch
        for host, f in d["fetches"].items():
            if f["ok"]:
                latest[host] = {**f, "date": d["date"]}
    dup = duplicate_shares({h: f["events"] for h, f in latest.items()})
    sources = []
    for host, p in last["probes"].items():
        if p.get("result") != "found":
            continue
        f = latest.get(host, {})
        st = f.get("stats", {})
        src = {"host": host, "format": p["format"], "feed_url": p["feed_url"], "source": last["candidates"].get(host, {}).get("source"),
               "old_strict_ai_bot": p.get("old_strict_ai_bot"), "llm_excluded": p.get("llm_excluded"),
               "ok_days": ok_days.get(host, []), "consecutive_ok_days": longest_consecutive_days(ok_days.get(host, [])),
               "events": st.get("events", 0), "upcoming": st.get("upcoming", 0), "in_area_share": st.get("in_area_share", 0.0),
               "reasonable_share": st.get("reasonable_share", 0.0), "duplicate_share": dup.get(host, 0.0),
               "last_reason": next((d["fetches"][host]["reason"] for d in reversed(days) if host in d["fetches"]), "")}
        src["admitted"], src["why_not"] = admission(src, acfg)
        sources.append(src)
    admitted = {s["host"] for s in sources if s["admitted"]}
    seen, unique = set(), []
    for host in sorted(admitted):
        for e in latest[host]["events"]:
            k = event_key(e)
            if k and k not in seen and (_parse_dt(e.get("start")) or datetime.min.replace(tzinfo=timezone.utc)) >= datetime.fromisoformat(
                    last["generated_utc"]):
                seen.add(k)
                unique.append({**e, "host": host})
    rng = random.Random(f"{pcfg['report']['seed']}-{last['town_id']}")
    pool = unique or [{**e, "host": h, "not_admitted": True} for h, f in latest.items() for e in f["events"]]
    examples = rng.sample(pool, min(pcfg["report"]["examples_per_town"], len(pool)))
    probes = last["probes"].values()
    return {
        "town_id": last["town_id"], "days": [d["date"] for d in days],
        "candidates": len(last["candidates"]),
        "candidates_by_source": {s: sum(1 for c in last["candidates"].values() if c["source"] == s) for s in ("osm", "brave")},
        "excluded": len(last.get("excluded", {})), "brave_calls": sum(d["brave_calls"] for d in days),
        "probed": sum(1 for _ in probes), "unprobed": len(last["candidates"]) - len(last["probes"]),
        "results": {r: sum(1 for p in last["probes"].values() if p.get("result") == r)
                    for r in ("found", "none", "closed", "refused", "unreachable")},
        "formats": {f: sum(1 for s in sources if s["format"] == f) for f in acfg["structured_formats"]},
        "old_strict_would_refuse": sum(1 for p in last["probes"].values() if p.get("old_strict_ai_bot")),
        "sources": sorted(sources, key=lambda s: (not s["admitted"], -s["upcoming"])),
        "admitted": len(admitted), "admitted_upcoming_events": len(unique), "examples": examples,
    }


def render_markdown(reports: list[dict]) -> str:
    lines = ["# Source discovery pilot: report", "",
             "Read mode, no database. Fas 3 rules from configs/shared/discovery_pilot.json. \"Old strict\" = the robots.txt names an "
             "AI crawler (the strict mode removed 2026-11-18 would have refused the host; the current mode does not).", ""]
    for r in reports:
        lines += [f"## {r['town_id']} ({', '.join(r['days'])})", "",
                  f"- Candidates: {r['candidates']} (OSM {r['candidates_by_source']['osm']}, Brave {r['candidates_by_source']['brave']}); "
                  f"excluded {r['excluded']}; Brave calls {r['brave_calls']}; probed {r['probed']}, not yet probed {r['unprobed']}",
                  f"- Probe results: " + ", ".join(f"{k} {v}" for k, v in r["results"].items()),
                  f"- Formats found: " + ", ".join(f"{k} {v}" for k, v in r["formats"].items() if v),
                  f"- Hosts the old strict mode would have refused: {r['old_strict_would_refuse']}",
                  f"- Would be admitted: {r['admitted']}, giving {r['admitted_upcoming_events']} upcoming events (deduplicated)", "",
                  "| Host | Format | From | Days ok | Events (upcoming) | In area | Dates ok | Dup | Old strict | Admitted / why not |",
                  "|---|---|---|---|---|---|---|---|---|---|"]
        for s in r["sources"]:
            lines.append(f"| {s['host']} | {s['format']} | {s['source']} | {len(s['ok_days'])} ({s['consecutive_ok_days']} in a row) | "
                         f"{s['events']} ({s['upcoming']}) | {s['in_area_share']:.0%} | {s['reasonable_share']:.0%} | "
                         f"{s['duplicate_share']:.0%} | {s['old_strict_ai_bot'] or ''} | "
                         f"{'yes' if s['admitted'] else '; '.join(s['why_not']) or s['last_reason']} |")
        lines += ["", f"Examples ({len(r['examples'])}, random):", ""]
        for e in r["examples"]:
            lines.append(f"- {e.get('start') or '?'} | {e['title']} | {e.get('venue') or '(no place)'} | {e['host']}"
                         + (" (not admitted)" if e.get("not_admitted") else ""))
        lines.append("")
    return "\n".join(lines)


def cmd_report(pcfg: dict, state_dir: Path, out_dir: Path) -> list[dict]:
    days = load_days(state_dir)
    reports = []
    for town in sorted({d["town_id"] for d in days}):
        reports.append(town_report([d for d in days if d["town_id"] == town], pcfg))
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(json.dumps(reports, ensure_ascii=False, indent=1), encoding="utf-8")
    (out_dir / "report.md").write_text(render_markdown(reports), encoding="utf-8")
    print(render_markdown(reports))
    return reports


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="python -m scripts.discovery_pilot")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("gate")
    d = sub.add_parser("day")
    d.add_argument("--town", required=True)
    d.add_argument("--state", type=Path)
    d.add_argument("--out", type=Path, required=True)
    r = sub.add_parser("report")
    r.add_argument("--state", type=Path, required=True)
    r.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    pcfg = load_config()
    now = datetime.now(timezone.utc)
    if args.cmd == "gate":
        return cmd_gate(pcfg, now.date())
    if args.cmd == "day":
        if args.town not in pcfg["towns"]:
            ap.error(f"unknown town {args.town}")
        cmd_day(pcfg, args.town, args.state, args.out, now)
        return 0
    cmd_report(pcfg, args.state, args.out)
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    sys.exit(main(sys.argv[1:]))
