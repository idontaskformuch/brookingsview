"""Glasgow image candidates from Wikimedia Commons (owner-ordered 2026-10-24).

Collects CANDIDATES only: nothing is activated. The output, data/glasgow_image_candidates.json, feeds the
noindex review page /qa/images/ on the Glasgow site; the owner approves ids from there, and only then do images
get downloaded and wired into the pools (this-week seasons, holidays, category images).

OWNER'S RULES (hard filters here, then a human check on the review page):
  - Licenses: ONLY CC0, public domain, CC BY and CC BY-SA. Never NC or ND, never anything else (GFDL, OGL, ...).
  - Attribution: photographer, license and a link to the Commons file page are stored for every candidate. A
    CC BY / CC BY-SA file with no named author is dropped (it cannot be credited).
  - No murals, graffiti, posters, paintings or other 2D artworks as the main subject (UK freedom of panorama
    covers buildings and sculptures only): keyword-dropped here, and anything the keywords miss is the reviewer's
    job on the page.
  - No identifiable people as the main subject: portraits, crowds and similar are dropped by keyword; weaker
    hints ("people", "man", "child" ...) become a visible flag for the reviewer.
  - Only Glasgow: a candidate must mention Glasgow or one of its well-known places in its title, description or
    categories, and other places that share the name are dropped.

Politeness: Commons API, one request per query, 1 s apart, an identifying User-Agent, maxlag set.

    python -m scripts.source_glasgow_commons_images            # query Commons, rewrite the JSON
    python -m scripts.source_glasgow_commons_images --dry-run  # query and report, write nothing
"""
from __future__ import annotations

import argparse
import html
import json
import re
import time
from datetime import date
from pathlib import Path

import requests

API = "https://commons.wikimedia.org/w/api.php"
UA = "ViewMediaBot (+https://glasgowloop.co.uk/contact) glasgow-image-sourcing"
OUT = Path(__file__).resolve().parent.parent / "data" / "glasgow_image_candidates.json"
THUMB_WIDTH = 480
MIN_WIDTH = 1200
MIN_ASPECT = 1.3  # landscape, so it can crop to a 16:9 hero

# bucket -> (id prefix, queries). Seasons first (autumn, winter), then holidays, then section categories.
BUCKETS: dict[str, tuple[str, list[str]]] = {
    "season:autumn": ("AUT", ["Glasgow Botanic Gardens autumn", "Kelvingrove Park autumn", "Pollok Country Park autumn",
                              "Glasgow Necropolis autumn", "Glasgow Green autumn", "River Clyde Glasgow autumn", "Glasgow autumn trees",
                              "Glasgow Cathedral autumn", "Queen's Park Glasgow autumn", "Glasgow West End autumn", "Glasgow University autumn", "Glasgow autumn colours"]),
    "season:winter": ("WIN", ["Glasgow snow", "Kelvingrove Park snow", "Glasgow Green snow", "Glasgow frost",
                              "George Square Glasgow winter", "Glasgow winter sunset"]),
    "holiday:halloween": ("HAL", ["Glasgow Necropolis mist", "Glasgow Necropolis dusk", "Glasgow Necropolis", "Glasgow Cathedral dusk", "Glasgow Halloween", "Glasgow pumpkins"]),
    "holiday:bonfire_night": ("BON", ["Glasgow fireworks", "Bonfire night Glasgow", "Fireworks River Clyde Glasgow", "Glasgow Green fireworks", "fireworks over Glasgow", "Glasgow fireworks display night"]),
    "holiday:st_andrews_day": ("AND", ["Saltire Glasgow", "St Andrew's Day Glasgow", "Scottish flag Glasgow City Chambers", "St Andrew's in the Square Glasgow"]),
    "holiday:christmas": ("XMS", ["Glasgow Christmas lights", "George Square Christmas Glasgow", "Glasgow Christmas market", "Buchanan Street Christmas"]),
    "holiday:hogmanay": ("HOG", ["Hogmanay Glasgow", "Glasgow New Year fireworks", "Glasgow Hogmanay celebrations", "George Square fireworks", "Glasgow New Year"]),
    "category:city_hall": ("CIT", ["Glasgow City Chambers", "City Chambers George Square", "George Square Glasgow"]),
    "category:events": ("EVT", ["Kelvingrove Art Gallery and Museum", "SEC Armadillo Glasgow", "Glasgow Royal Concert Hall",
                                "Barrowland Ballroom", "Merchant City Glasgow", "Riverside Museum Glasgow"]),
    "category:sports": ("SPO", ["Hampden Park", "Celtic Park", "Ibrox Stadium", "Emirates Arena Glasgow"]),
    "category:traffic": ("TRF", ["Glasgow Central Station", "Clyde Arc Glasgow", "Glasgow M8 motorway", "Glasgow Queen Street station"]),
    "category:weather_alert": ("WEA", ["Glasgow rain", "Glasgow storm clouds", "River Clyde Glasgow"]),
    "category:university": ("UNI", ["University of Glasgow main building", "University of Glasgow cloisters"]),
}

GLASGOW_WORDS = (
    "glasgow", "kelvingrove", "necropolis", "clyde", "hampden", "celtic park", "ibrox", "barrowland", "pollok",
    "merchant city", "george square", "buchanan street", "riverside museum", "squinty", "finnieston", "partick",
    "govan", "gorbals", "dennistoun", "hillhead",
)
OTHER_GLASGOWS = ("kentucky", "montana", "delaware", "missouri", "virginia", "east glasgow", "glasgow, ky", "glasgow, mt")

HARD_2D = re.compile(
    r"\b(murals?|graffiti|street art|wall art|paintings?|posters?|artworks?|frescos?|billboards?|advertis\w*|logos?|diagrams?|"
    r"drawings?|engravings?|stamps?|postcards?|illustrations?|coat of arms|flag of|map of|banknotes?|sketch(?:es)?)\b", re.I)
HARD_PEOPLE = re.compile(r"\b(portraits?|selfies?|crowds?|audiences?|supporters|fans|weddings?|group photo|spectators)\b", re.I)
SOFT_PEOPLE = re.compile(r"\b(people|person|man|men|woman|women|child|children|boy|girl|player|players|runner|parade|procession|visitors)\b", re.I)
SOFT_SIGN = re.compile(r"\b(sign|signage|shop|storefront|advert)\b", re.I)


def license_ok(short_name: str | None, license_key: str | None) -> bool:
    """Only CC0, public domain, CC BY and CC BY-SA. Never NC/ND, never GFDL or anything else."""
    text = f"{short_name or ''} {license_key or ''}".strip().lower()
    if not text:
        return False
    if re.search(r"(^|[-\s])(nc|nd)([-\s]|$)", text):
        return False
    if text.startswith(("cc0", "cc-zero")) or "public domain" in text or text.startswith("pd") or re.search(r"\bpd-", text):
        return True
    return bool(re.match(r"cc[- ]by(-sa)?[- ]\d", text))


def needs_attribution(short_name: str | None) -> bool:
    t = (short_name or "").lower()
    return not (t.startswith(("cc0", "cc-zero", "pd")) or "public domain" in t)


def strip_html(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def is_glasgow(haystack: str) -> bool:
    h = haystack.lower()
    return any(w in h for w in GLASGOW_WORDS) and not any(o in h for o in OTHER_GLASGOWS)


def evaluate(page: dict) -> tuple[dict | None, str | None]:
    """-> (candidate fields, None) or (None, reject reason). Pure: no network."""
    info = (page.get("imageinfo") or [{}])[0]
    meta = info.get("extmetadata") or {}
    title = page.get("title", "")
    if info.get("mime") not in ("image/jpeg", "image/png"):
        return None, "mime"
    w, h = int(info.get("width") or 0), int(info.get("height") or 0)
    if w < MIN_WIDTH or not h or w / h < MIN_ASPECT:
        return None, "size-or-aspect"
    short = (meta.get("LicenseShortName") or {}).get("value")
    lic_key = (meta.get("License") or {}).get("value")
    if not license_ok(short, lic_key):
        return None, "license"
    artist = strip_html((meta.get("Artist") or {}).get("value"))
    if needs_attribution(short) and (not artist or artist.lower() in ("unknown", "unknown author", "anonymous")):
        return None, "no-author"
    desc = strip_html((meta.get("ImageDescription") or {}).get("value"))
    cats = [c for c in ((meta.get("Categories") or {}).get("value") or "").split("|") if c]
    hay = f"{title} {desc} {' '.join(cats)}"
    if not is_glasgow(hay):
        return None, "not-glasgow"
    if HARD_2D.search(hay):
        return None, "2d-artwork"
    if HARD_PEOPLE.search(f"{title} {' '.join(cats)}"):
        return None, "people-main-subject"
    flags: list[str] = []
    if SOFT_PEOPLE.search(hay):
        flags.append("people?")
    if SOFT_SIGN.search(hay):
        flags.append("sign/shop?")
    return {
        "title": title.removeprefix("File:"),
        "page_url": info.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/{title.replace(' ', '_')}",
        "thumb_url": info.get("thumburl"),
        "thumb_w": info.get("thumbwidth"), "thumb_h": info.get("thumbheight"),
        "width": w, "height": h,
        "artist": artist or None,
        "license": short,
        "license_url": (meta.get("LicenseUrl") or {}).get("value"),
        "description": desc[:300],
        "categories": cats[:8],
        "taken": (meta.get("DateTimeOriginal") or {}).get("value"),
        "flags": flags,
    }, None


def query(session: requests.Session, text: str) -> list[dict]:
    params = {
        "action": "query", "format": "json", "formatversion": "2", "maxlag": "5",
        "generator": "search", "gsrsearch": f"{text} filetype:bitmap", "gsrnamespace": "6", "gsrlimit": "40",
        "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": str(THUMB_WIDTH),
        "iiextmetadatafilter": "LicenseShortName|License|LicenseUrl|Artist|ImageDescription|Categories|DateTimeOriginal",
    }
    r = session.get(API, params=params, timeout=30)
    r.raise_for_status()
    return (r.json().get("query") or {}).get("pages") or []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    existing = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"candidates": []}
    known_ids = {c["pageid"]: c["id"] for c in existing.get("candidates", [])}
    counters: dict[str, int] = {}
    for cid in known_ids.values():
        prefix, _, n = cid.partition("-")
        counters[prefix] = max(counters.get(prefix, 0), int(n))

    session = requests.Session()
    session.headers["User-Agent"] = UA
    rejected: dict[str, int] = {}
    found: dict[int, dict] = {}
    for bucket, (prefix, queries) in BUCKETS.items():
        for q in queries:
            time.sleep(1.0)
            for page in query(session, q):
                pid = page["pageid"]
                if pid in found:
                    if bucket not in found[pid]["buckets"]:
                        found[pid]["buckets"].append(bucket)
                    continue
                cand, reason = evaluate(page)
                if cand is None:
                    rejected[reason] = rejected.get(reason, 0) + 1
                    continue
                if pid in known_ids:
                    cid = known_ids[pid]
                else:
                    counters[prefix] = counters.get(prefix, 0) + 1
                    cid = f"{prefix}-{counters[prefix]:03d}"
                found[pid] = {"id": cid, "pageid": pid, "buckets": [bucket], **cand}
            print(f"  {bucket:26} {q!r}: {len(found)} candidates so far")

    candidates = sorted(found.values(), key=lambda c: c["id"])
    payload = {
        "generated": date.today().isoformat(),
        "source": "Wikimedia Commons (commons.wikimedia.org), queried via the public API",
        "license_policy": "CC0, public domain, CC BY, CC BY-SA only; never NC or ND",
        "attribution": "photographer, license and a link to the Commons file page per image",
        "status": "CANDIDATES ONLY: nothing here is activated until the owner approves ids on /qa/images/",
        "rejected_by_reason": dict(sorted(rejected.items())),
        "candidates": candidates,
    }
    by_bucket: dict[str, int] = {}
    for c in candidates:
        for b in c["buckets"]:
            by_bucket[b] = by_bucket.get(b, 0) + 1
    print(f"{len(candidates)} candidates; rejected: {payload['rejected_by_reason']}")
    print("per bucket:", by_bucket)
    if not args.dry_run:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
