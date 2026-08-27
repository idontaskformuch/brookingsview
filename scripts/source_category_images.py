"""Sources REAL stock photos for GENERIC category images (a library, a
park, a warehouse, ...) -- see NEEDS-HUMAN-REVIEW.md, "Switch venue/category
images to real photos" and "Images still repeating across all pages, not
just front page". Replaces the category half of the retired
scripts/generate_venue_category_images.py.

Does NOT touch content/illustrations/generate_illustration.py or
config/image_model.py -- the content-track Flux pipeline stays untouched.

EACH CATEGORY GETS A POOL OF SEVERAL IMAGES, NOT ONE: a single photo per
category meant every card in that category showed the IDENTICAL image
everywhere it appeared sitewide, not just adjacently on one page --
dedupeConsecutiveImages() (site/src/pages/index.astro) only ever solved the
adjacent-on-one-page case. lib/images.ts's resolveImage() now picks
deterministically from the pool per item (pickFromPool()) -- a real fix
needs multiple real candidates per category to pick from, which is what
this script now sources (target: 3 per category).

SOURCE PRIORITY: Pexels first, Unsplash as fallback only if Pexels has no
good match -- see this module's own docstring in NEEDS-HUMAN-REVIEW.md for
why: Pexels' license permits downloading and self-hosting (matches this
site's fully-static asset pipeline, same pattern as every other image here),
Unsplash's API Guidelines MANDATE hotlinking (no downloading/re-hosting) --
a real architecture exception, kept to only where Pexels can't cover it.

ATTRIBUTION IS REQUIRED FOR BOTH, not just Unsplash (a Pexels API bulk-key
condition, not just a courtesy -- see pexels.com/api/documentation's
attribution guidelines). Pexels images get the same simple attributionText/
attributionUrl pair venue images use; Unsplash images get attributionHtml
(see lib/images.ts's ImageRef) because Unsplash's exact required format
("Photo by [Name] on Unsplash", BOTH independently clickable with UTM
params) can't be expressed as one link.

Unsplash-specific requirements this script handles (see NEEDS-HUMAN-REVIEW.md
for the citations): hotlinked src URL (never downloaded), a UTM-tagged
attribution link, and firing the one-time `download_location` tracking ping
at SELECTION time (not on every page render -- selection happens once, here,
not per-pageview).

CANDIDATES ARE HAND-REVIEWED, NOT AUTO-PICKED: `--montage` fetches N
candidates per category and composites them into ONE labeled contact-sheet
image per (town, category) under .review_montages/ -- reviewing one grid
image is far faster than viewing every candidate individually, without
skipping the actual "does this look like a different real, identifiable
place" visual check the earlier single-image pass already established as
necessary (readable signage naming another town, a named university's own
landmark, foreign-language school signage, visible sponsor branding all got
caught this way, not by text alone). CATEGORY_SEARCHES' `chosen` list is
filled in only after actually looking at the montage.

Requires PEXELS_API_KEY and (only if a category falls back to it)
UNSPLASH_ACCESS_KEY in the environment/.env -- both free, instant signups
(pexels.com/api, unsplash.com/developers).

Usage:
    python -m scripts.source_category_images --montage        # build review grids for every category
    python -m scripts.source_category_images --montage --only brookings_sd city_hall
    python -m scripts.source_category_images                  # dry run: search + print candidates as text
    python -m scripts.source_category_images --apply           # download/hotlink + write category-images.ts
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from io import BytesIO
from pathlib import Path

# Windows' console defaults to cp1252, which can't encode a real
# photographer name (accented characters etc.) -- reconfigure to UTF-8
# rather than crash mid-dry-run on an otherwise-successful API response.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import requests
from PIL import Image, ImageDraw

IMAGE_WIDTH = 1200
IMAGE_HEIGHT = 800
REQUEST_TIMEOUT = 30
CATEGORIES_DIR = Path("site/public/assets/images/categories")
CATEGORY_IMAGES_TS = Path("site/src/config/category-images.ts")
MONTAGE_DIR = Path(".review_montages")
# How many images to actually keep per category pool -- see module
# docstring ("target: 3 per category").
POOL_SIZE = 3

# Stable per-fleet identifier for Unsplash's required UTM parameters (all
# three towns share one codebase/attribution identity -- see
# NEEDS-HUMAN-REVIEW.md, not worth a per-town value for a tracking param).
UNSPLASH_APP_NAME = "brookingsview"

# The same human-facing alt text CATEGORY_MOTIFS already had in the retired
# generate_venue_category_images.py -- reused verbatim, this feature only
# changes the IMAGE, never the alt text a reader/screen-reader sees. Every
# image in a category's pool shares the same alt text (it's a description
# of the CATEGORY, "Civic buildings in Brookings", not of one specific photo).
ALT_TEXT: dict[tuple[str, str], str] = {
    ("brookings_sd", "city_hall"): "Civic buildings in Brookings.",
    ("brookings_sd", "events"): "Community events in Brookings.",
    ("brookings_sd", "home_sales"): "Residential homes in Brookings.",
    ("brookings_sd", "jobs"): "Local employers in Brookings.",
    ("brookings_sd", "sports"): "Jackrabbits and regional sports in Brookings.",
    ("brookings_sd", "school_alerts"): "Schools in Brookings.",
    ("brookings_sd", "weather_alert"): "Weather conditions in Brookings.",
    ("brookings_sd", "university"): "South Dakota State University in Brookings.",
    ("moreno_valley_ca", "city_hall"): "Civic buildings in Moreno Valley.",
    ("moreno_valley_ca", "events"): "Community events in Moreno Valley.",
    ("moreno_valley_ca", "home_sales"): "Residential homes in Moreno Valley.",
    ("moreno_valley_ca", "jobs"): "Warehouse and logistics employers in Moreno Valley.",
    ("moreno_valley_ca", "sports"): "Regional sports in the Moreno Valley area.",
    ("moreno_valley_ca", "school_alerts"): "Schools in Moreno Valley.",
    ("moreno_valley_ca", "weather_alert"): "Weather conditions in Moreno Valley.",
    ("moreno_valley_ca", "traffic"): "Freeway traffic in Moreno Valley.",
    ("moreno_valley_ca", "workplace_watch"): "Warehouse and logistics workplaces in Moreno Valley.",
}

# (town, category) -> {"query": str, "chosen": [(source, id), ...]}. `query`
# is the ACTUAL string that produced every id in `chosen` (a category using
# a second, more specific query after the first's results were rejected
# just uses that final query string here -- there's no need to remember the
# rejected one, CATEGORY_SEARCHES only tracks what's actually in the pool).
# `chosen` is filled in by hand after reviewing a --montage grid.
CategorySearch = dict
def _pool(*ids: int, source: str = "pexels", query: str | None = None) -> list[dict]:
    """Shorthand for a same-query pool -- most pools pull every pick from
    the category's own main query. Pass `query=` only for an id that came
    from a different (refined) search -- see CITY_HALL_V2_QUERY below."""
    return [{"source": source, "id": i, **({"query": query} if query else {})} for i in ids]


_MV_CITY_HALL_V2_QUERY = "american municipal government building generic"

# Reviewed 2026-08-27 via --montage contact sheets (see NEEDS-HUMAN-REVIEW.md
# "Images still repeating across all pages"). Rejections that shaped these
# picks, beyond the earlier single-image pass's findings: Beverly Hills and
# City of Los Angeles's own iconic, nationally-recognizable City Hall towers
# and downtown LA's skyline (both far too identifiable AND badly mismatched
# in scale for a city Moreno Valley's size -- needed a second, more specific
# query, see _MV_CITY_HALL_V2_QUERY); a real estate/company logo ("Amazon")
# lit up on a warehouse at night, rejected the same way a Millville/WSU/
# Vietnamese-signage result was earlier (Amazon is also a real tracked
# Workplace Watch employer, making this a doubly bad pick); a Mercedes-Benz
# grille badge; real children's faces in close-up on several school-alerts
# candidates (skipped even where not textually "identifiable," same spirit
# as the no-real-people rule elsewhere in this project); a handful of
# results that were generically foreign/European-coded (German Rathaus
# architecture, Vietnamese/Chinese university signage, Andean altiplano
# terrain) used for an American-town category, which isn't a textual
# mislabel but is a real place/character mismatch all the same.
#
# CAUGHT ONLY AFTER DOWNLOADING (montage thumbnails are 360x240 -- too
# small to resolve small background text): an aerial "small municipal
# building with clock tower" result (Mazin Omron, id 32998755) turned out,
# at full resolution, to be South San Francisco's actual City Hall, complete
# with the "SOUTH SAN FRANCISCO THE INDUSTRIAL CITY" hillside sign and an
# "SSF" hedge topiary both clearly readable in the background -- exactly the
# specific-real-place mismatch this whole review process exists to catch,
# just missed at thumbnail resolution. Swapped for a full-resolution-
# verified generic flag-and-office-facade photo (Robert So, id 12567141)
# under a second, more specific v2 query. Lesson applied going forward:
# any aerial/wide shot with a visible hillside or distant background needs
# a full-resolution check before acceptance, not just the montage thumbnail.
CATEGORY_SEARCHES: dict[tuple[str, str], CategorySearch] = {
    ("brookings_sd", "city_hall"): {"query": "small town city hall brick building", "chosen": _pool(38855972, 37485219, 37469663)},
    ("brookings_sd", "events"): {"query": "small town street festival community", "chosen": _pool(10148954, 10130178, 8839417)},
    ("brookings_sd", "home_sales"): {"query": "midwest suburban houses tree lined street", "chosen": _pool(38211756, 8148346, 5846801)},
    ("brookings_sd", "jobs"): {"query": "grain elevator silo farm building", "chosen": _pool(33406024, 2714630, 12380134)},
    ("brookings_sd", "sports"): {"query": "high school football stadium bleachers", "chosen": _pool(13345801, 13345803, 13345751)},
    ("brookings_sd", "school_alerts"): {"query": "elementary school building exterior", "chosen": _pool(35758714, 18145430, 17144608)},
    ("brookings_sd", "weather_alert"): {"query": "prairie storm clouds sky", "chosen": _pool(30068845, 4824517, 29383810)},
    ("brookings_sd", "university"): {"query": "university campus lawn trees buildings", "chosen": _pool(7752993, 27276232, 36725428)},
    ("moreno_valley_ca", "city_hall"): {
        "query": "modern civic building palm trees california",
        "chosen": _pool(32957453, 1422407) + _pool(12567141, query=_MV_CITY_HALL_V2_QUERY),
    },
    # All 3 of this category's original picks failed a FULL-RESOLUTION
    # recheck (montage thumbnails are too small to catch small background
    # text/signage -- see the city_hall/traffic notes above): 9177591 had
    # small Thai-script signage bottom-right, 18339293 was a Quebec/Canada
    # colonial reenactment with a visible UK flag, 28886690 had multiple
    # readable sponsor logos at a foreign trade fair. "Community events"
    # turned out to be the hardest category to source safely for -- crowd
    # photos risk real identifiable faces, market photos risk foreign
    # signage. Only found 2 solid replacements after several rounds of
    # full-resolution verification (a Texas farmers market with only
    # illegible small vendor-booth text, and a black-and-white photo of a
    # flag-bearer shot from BEHIND -- no face, palm trees genuinely matching
    # SoCal) -- shipping a 2-image pool for this one category rather than
    # force a 3rd risky pick.
    ("moreno_valley_ca", "events"): {
        "query": "aerial farmers market outdoor community booths",
        "chosen": _pool(30391784) + _pool(29332592, query="american flag community parade street aerial daytime"),
    },
    ("moreno_valley_ca", "home_sales"): {"query": "suburban stucco houses tile roof california", "chosen": _pool(34960819, 17613793, 11467685)},
    ("moreno_valley_ca", "jobs"): {"query": "warehouse distribution center exterior", "chosen": _pool(36006588, 29298971, 12585837)},
    ("moreno_valley_ca", "sports"): {"query": "american high school football field night lights california", "chosen": _pool(13345835, 9935427, 9935434)},
    ("moreno_valley_ca", "school_alerts"): {"query": "american elementary school building exterior", "chosen": _pool(8500417, 10127243, 10127241)},
    ("moreno_valley_ca", "weather_alert"): {"query": "desert heat haze highway sky", "chosen": _pool(13973966, 9898541, 2450291)},
    ("moreno_valley_ca", "traffic"): {
        "query": "freeway interchange overpass california",
        "chosen": _pool(8783583, 9716239) + _pool(9716230, query="suburban freeway highway traffic cars aerial"),
    },
    ("moreno_valley_ca", "workplace_watch"): {"query": "warehouse loading dock semi trucks", "chosen": _pool(35501716, 1267325, 27099093)},
}


def pexels_search(query: str, api_key: str, per_page: int = 8) -> list[dict]:
    resp = requests.get(
        "https://api.pexels.com/v1/search",
        headers={"Authorization": api_key},
        params={"query": query, "per_page": per_page, "orientation": "landscape"},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json().get("photos", [])


def unsplash_search(query: str, access_key: str, per_page: int = 8) -> list[dict]:
    resp = requests.get(
        "https://api.unsplash.com/search/photos",
        headers={"Authorization": f"Client-ID {access_key}", "Accept-Version": "v1"},
        params={"query": query, "per_page": per_page, "orientation": "landscape"},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json().get("results", [])


def _resize_cover(image: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Same aspect-fill crop as source_venue_images.py -- a real photo's
    native ratio is never exactly 3:2, so this is a center-crop, not a
    distorting stretch."""
    src_ratio = image.width / image.height
    target_ratio = target_w / target_h
    if src_ratio > target_ratio:
        new_height = target_h
        new_width = round(new_height * src_ratio)
    else:
        new_width = target_w
        new_height = round(new_width / src_ratio)
    resized = image.resize((new_width, new_height), Image.LANCZOS)
    left = (new_width - target_w) // 2
    top = (new_height - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def _download_and_save_pexels(photo: dict, out_path: Path) -> None:
    image_resp = requests.get(photo["src"]["original"], timeout=60)
    image_resp.raise_for_status()
    image = Image.open(BytesIO(image_resp.content)).convert("RGB")
    image = _resize_cover(image, IMAGE_WIDTH, IMAGE_HEIGHT)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path, format="PNG")


def _unsplash_hotlink_entry(photo: dict, access_key: str) -> dict:
    """Fires the mandatory one-time download-tracking ping (see module
    docstring), then builds the hotlinked path + the exact required
    dual-link attribution HTML -- never downloads the image itself."""
    requests.get(
        photo["links"]["download_location"],
        headers={"Authorization": f"Client-ID {access_key}"},
        timeout=REQUEST_TIMEOUT,
    )
    # `urls.raw` already carries its own query string (ixid/ixlib params) --
    # a bare f"{raw}?w=..." blindly appends a SECOND "?", producing a
    # malformed URL where the crop/size params silently don't apply.
    # Confirmed live 2026-08-27.
    separator = "&" if "?" in photo["urls"]["raw"] else "?"
    hotlink_path = f"{photo['urls']['raw']}{separator}w={IMAGE_WIDTH}&h={IMAGE_HEIGHT}&fit=crop&q=80"
    utm = f"utm_source={UNSPLASH_APP_NAME}&utm_medium=referral"
    photographer_url = f"{photo['user']['links']['html']}?{utm}"
    unsplash_url = f"https://unsplash.com/?{utm}"
    photographer_name = photo["user"]["name"]
    attribution_html = (
        f'Photo by <a href="{photographer_url}" rel="noopener nofollow" target="_blank">{photographer_name}</a> '
        f'on <a href="{unsplash_url}" rel="noopener nofollow" target="_blank">Unsplash</a>'
    )
    return {"path": hotlink_path, "attribution_html": attribution_html}


def build_montage(town: str, category: str, entry: dict, pexels_key: str) -> Path | None:
    """Fetches candidates, composites them into one labeled contact-sheet
    (3 columns) with each cell numbered and captioned with its Pexels id +
    photographer, saved under .review_montages/. Reviewing this ONE image
    replaces viewing every candidate individually."""
    photos = pexels_search(entry["query"], pexels_key, per_page=8)
    if not photos:
        print(f"  [{town}/{category}] no Pexels results for {entry['query']!r}")
        return None

    thumbs = []
    for p in photos:
        img_resp = requests.get(p["src"]["medium"], timeout=30)
        img_resp.raise_for_status()
        thumb = Image.open(BytesIO(img_resp.content)).convert("RGB")
        thumb = _resize_cover(thumb, 360, 240)
        thumbs.append((p, thumb))

    cols = 3
    rows = (len(thumbs) + cols - 1) // cols
    cell_w, cell_h, caption_h = 360, 240, 24
    grid = Image.new("RGB", (cols * cell_w, rows * (cell_h + caption_h)), "white")
    draw = ImageDraw.Draw(grid)
    for i, (p, thumb) in enumerate(thumbs):
        x, y = (i % cols) * cell_w, (i // cols) * (cell_h + caption_h)
        grid.paste(thumb, (x, y))
        caption = f"#{i} id={p['id']} {p['photographer'][:20]}"
        draw.rectangle([x, y + cell_h, x + cell_w, y + cell_h + caption_h], fill="black")
        draw.text((x + 4, y + cell_h + 4), caption, fill="white")

    MONTAGE_DIR.mkdir(exist_ok=True)
    out_path = MONTAGE_DIR / f"{town}-{category}.png"
    grid.save(out_path, format="PNG")
    print(f"  [{town}/{category}] montage -> {out_path} ({len(thumbs)} candidates, query {entry['query']!r})")
    return out_path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--montage", action="store_true", help="Build review contact-sheets instead of searching/applying.")
    ap.add_argument("--only", nargs=2, metavar=("TOWN", "CATEGORY"), help="Limit to one (town, category) pair.")
    args = ap.parse_args()

    pexels_key = os.environ.get("PEXELS_API_KEY")
    unsplash_key = os.environ.get("UNSPLASH_ACCESS_KEY")

    # --only + --apply is a real footgun: _write_category_images_ts() only
    # preserves town blocks this script doesn't manage at all (Broomfield's
    # empty placeholder), NOT individual categories within a managed town
    # that just weren't part of THIS run -- confirmed live 2026-08-27, a
    # single `--apply --only moreno_valley_ca city_hall` run (to fix one bad
    # photo) silently wiped all 16 other categories' pools down to the one
    # just (re)written. --only stays useful for --montage (a cheap, read-
    # only review step), refused here instead.
    if args.only and args.apply:
        print("--only cannot be combined with --apply -- it would silently drop every "
              "other category's pool (see _write_category_images_ts()). Fix CATEGORY_SEARCHES "
              "for the one you need to change, then run a full --apply.")
        return 1

    searches = CATEGORY_SEARCHES
    if args.only:
        key = (args.only[0], args.only[1])
        if key not in CATEGORY_SEARCHES:
            print(f"Unknown (town, category): {key}")
            return 1
        searches = {key: CATEGORY_SEARCHES[key]}

    if args.montage:
        if not pexels_key:
            print("PEXELS_API_KEY not set -- can't build montages.")
            return 1
        for (town, category), entry in searches.items():
            build_montage(town, category, entry, pexels_key)
        return 0

    if not args.apply:
        print("DRY RUN -- searching for each category, printing candidates.\n")
        if not pexels_key:
            print("PEXELS_API_KEY not set -- Pexels search skipped (get one free at pexels.com/api).\n")
        if not unsplash_key:
            print("UNSPLASH_ACCESS_KEY not set -- Unsplash fallback skipped (unsplash.com/developers).\n")
        for (town, category), entry in searches.items():
            print(f"[{town}/{category}] query: {entry['query']!r}")
            if pexels_key:
                for p in pexels_search(entry["query"], pexels_key):
                    print(f"    pexels: id={p['id']} by {p['photographer']} -> {p['url']}")
            if unsplash_key:
                for u in unsplash_search(entry["query"], unsplash_key):
                    print(f"    unsplash: id={u['id']} by {u['user']['name']} -> {u['links']['html']}")
            chosen = entry["chosen"]
            print(f"  -> chosen: {chosen!r}" if chosen else "  -> NOT YET REVIEWED")
            print()
        print("Dry run only -- no downloads, no writes. Use --montage to build review grids, "
              "fill in CATEGORY_SEARCHES['chosen'] (a list of {source, id, query?} dicts -- see _pool()), then --apply.")
        return 0

    unresolved = [k for k, v in searches.items() if not v["chosen"]]
    if unresolved:
        print("Refusing to --apply: these categories have no reviewed `chosen` selections yet:")
        for town, category in unresolved:
            print(f"  - {town}/{category}")
        print("Review --montage grids and fill in CATEGORY_SEARCHES first.")
        return 1

    generated: dict[tuple[str, str], list[dict]] = {}
    for (town, category), entry in searches.items():
        alt = ALT_TEXT[(town, category)]
        pool: list[dict] = []
        # Cache per QUERY, not per category -- a pool can mix picks from a
        # refined second search (see chosen entries' own `query` field,
        # e.g. moreno_valley_ca/city_hall pulling from both its main query
        # and a "suburban city hall" refinement after the first query's
        # results turned out to be famous, wrong-scale LA/Beverly Hills
        # landmarks) alongside the category's main query.
        pexels_cache: dict[str, list[dict]] = {}
        unsplash_cache: dict[str, list[dict]] = {}

        for i, choice in enumerate(entry["chosen"], start=1):
            source, ident, query = choice["source"], choice["id"], choice.get("query", entry["query"])
            if source == "pexels":
                if not pexels_key:
                    raise RuntimeError("PEXELS_API_KEY required for a pexels selection")
                if query not in pexels_cache:
                    pexels_cache[query] = pexels_search(query, pexels_key, per_page=10)
                photo = next((p for p in pexels_cache[query] if p["id"] == ident), None)
                if photo is None:
                    raise RuntimeError(
                        f"Pexels photo id {ident} not found for {town}/{category} under query {query!r} "
                        "-- re-run --montage"
                    )
                out_path = CATEGORIES_DIR / f"{town}-{category}-{i}.png"
                print(f"[{town}/{category}] downloading Pexels photo {ident} ({i}/{len(entry['chosen'])}) ...")
                _download_and_save_pexels(photo, out_path)
                web_path = "/" + str(out_path.relative_to("site/public")).replace("\\", "/")
                pool.append({
                    "path": web_path, "alt": alt,
                    "attribution_text": f"Photo by {photo['photographer']} on Pexels",
                    "attribution_url": photo["photographer_url"],
                })
            elif source == "unsplash":
                if not unsplash_key:
                    raise RuntimeError("UNSPLASH_ACCESS_KEY required for an unsplash selection")
                if query not in unsplash_cache:
                    unsplash_cache[query] = unsplash_search(query, unsplash_key, per_page=10)
                photo = next((p for p in unsplash_cache[query] if p["id"] == ident), None)
                if photo is None:
                    raise RuntimeError(
                        f"Unsplash photo id {ident} not found for {town}/{category} under query {query!r} "
                        "-- re-run --montage"
                    )
                print(f"[{town}/{category}] hotlinking Unsplash photo {ident} ({i}/{len(entry['chosen'])}) ...")
                hotlink = _unsplash_hotlink_entry(photo, unsplash_key)
                pool.append({"path": hotlink["path"], "alt": alt, "attribution_html": hotlink["attribution_html"]})
            else:
                raise ValueError(f"Unknown source {source!r} for {town}/{category}")

        generated[(town, category)] = pool

    _write_category_images_ts(generated)
    print(f"\nWrote {CATEGORY_IMAGES_TS}")
    print("Done.")
    return 0


def _write_category_images_ts(generated: dict[tuple[str, str], list[dict]]) -> None:
    """Same preserve-what-you-don't-manage discipline as the retired
    generate_venue_category_images.py's writer -- Broomfield's empty
    placeholder + the categoryImagesFor() helper must survive this rewrite."""
    _MANAGED_TOWNS = {"brookings_sd", "moreno_valley_ca"}

    def entry_literal(data: dict) -> str:
        parts = [f"path: {data['path']!r}", f"alt: {data['alt']!r}", f"width: {IMAGE_WIDTH}", f"height: {IMAGE_HEIGHT}"]
        if data.get("attribution_text"):
            parts.append(f"attributionText: {data['attribution_text']!r}")
        if data.get("attribution_url"):
            parts.append(f"attributionUrl: {data['attribution_url']!r}")
        if data.get("attribution_html"):
            parts.append(f"attributionHtml: {data['attribution_html']!r}")
        return "{ " + ", ".join(parts) + " }"

    def pool_literal(pool: list[dict]) -> str:
        return "[" + ", ".join(entry_literal(d) for d in pool) + "]"

    def town_block(town: str) -> str:
        lines = []
        for (t, category), pool in sorted(generated.items()):
            if t != town or not pool:
                continue
            lines.append(f"    {category}: {pool_literal(pool)},")
        return "\n".join(lines)

    existing_source = CATEGORY_IMAGES_TS.read_text(encoding="utf-8") if CATEGORY_IMAGES_TS.exists() else ""
    unmanaged_blocks = []
    for match in re.finditer(r"^  (\w+): \{(?:\}|\n(?:.*\n)*?  \}),\n", existing_source, re.MULTILINE):
        if match.group(1) not in _MANAGED_TOWNS:
            unmanaged_blocks.append(match.group(0).rstrip("\n"))
    unmanaged = ("\n\n" + "\n\n".join(unmanaged_blocks)) if unmanaged_blocks else ""
    trailing_match = re.search(r"\n\};\n(.*)", existing_source, re.DOTALL)
    trailing = trailing_match.group(1) if trailing_match else ""
    town_type_match = re.search(r"export type Town = .+;", existing_source)
    town_type_line = town_type_match.group(0) if town_type_match else "export type Town = 'brookings_sd' | 'moreno_valley_ca';"

    content = f"""/**
 * Per-town, per-category REAL photos for lib/images.ts's resolveImage()
 * tier 3 -- see NEEDS-HUMAN-REVIEW.md, "Switch venue/category images to
 * real photos" and "Images still repeating across all pages". Generated by
 * scripts/source_category_images.py -- edit the query/selection there and
 * re-run to change a pool, don't hand-edit paths here. Town entries not in
 * this script's own CATEGORY_SEARCHES are preserved verbatim, not deleted
 * (see _write_category_images_ts()).
 *
 * Each category holds a POOL of images, not a single winner -- see
 * lib/images.ts's pickFromPool()/resolveImage() for how one is picked per
 * item.
 */
import type {{ ImageCategory, ImageRef }} from '../lib/images';

{town_type_line}

export const CATEGORY_IMAGES: Record<Town, Partial<Record<ImageCategory, ImageRef[]>>> = {{
  brookings_sd: {{
{town_block('brookings_sd')}
  }},
  moreno_valley_ca: {{
{town_block('moreno_valley_ca')}
  }},{unmanaged}
}};
{trailing}"""
    CATEGORY_IMAGES_TS.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
