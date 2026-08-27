"""Sources REAL stock photos for GENERIC category images (a library, a
park, a warehouse, ...) -- see NEEDS-HUMAN-REVIEW.md, "Switch venue/category
images to real photos". Replaces the category half of
scripts/generate_venue_category_images.py (that script and
scripts/prompts/venue_style.txt are retired once this and
source_venue_images.py fully cover their job).

Does NOT touch content/illustrations/generate_illustration.py or
config/image_model.py -- the content-track Flux pipeline stays untouched.

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

CANDIDATES ARE HAND-REVIEWED, NOT AUTO-PICKED: same discipline as
source_venue_images.py -- dry run prints candidates, CATEGORY_SEARCHES'
`chosen` field is filled in only after actually looking at the photo.

Requires PEXELS_API_KEY and (only if a category falls back to it)
UNSPLASH_ACCESS_KEY in the environment/.env -- both free, instant signups
(pexels.com/api, unsplash.com/developers). Neither is provisioned yet as of
this writing; this script is fully built and ready to run the moment they
are, per the explicit "real paid/keyed API calls need a human's go-ahead
first" discipline this project follows throughout (see e.g.
scripts/generate_venue_category_images.py's own COST WARNING).

Usage:
    python -m scripts.source_category_images                # dry run: search + print candidates
    python -m scripts.source_category_images --apply          # download/hotlink + write category-images.ts
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
from PIL import Image

IMAGE_WIDTH = 1200
IMAGE_HEIGHT = 800
REQUEST_TIMEOUT = 30
CATEGORIES_DIR = Path("site/public/assets/images/categories")
CATEGORY_IMAGES_TS = Path("site/src/config/category-images.ts")

# Stable per-fleet identifier for Unsplash's required UTM parameters (all
# three towns share one codebase/attribution identity -- see
# NEEDS-HUMAN-REVIEW.md, not worth a per-town value for a tracking param).
UNSPLASH_APP_NAME = "brookingsview"

# The same human-facing alt text CATEGORY_MOTIFS already had in
# generate_venue_category_images.py -- reused verbatim, this feature only
# changes the IMAGE, never the alt text a reader/screen-reader sees.
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

# (town, category) -> stock-photo search query (plain photographic subject
# terms, NOT the old Flux art-direction motif text -- "a small-town athletic
# field with bleachers, distant silhouetted players, floodlight poles" was
# an AI PROMPT, not something you'd type into a stock search bar). `chosen`
# is (source, id_or_url) filled in only after visually reviewing real search
# results -- None means not yet reviewed (requires API keys first).
CategorySearch = dict
# `chosen` filled in 2026-08-27 after visually reviewing real candidates
# (see NEEDS-HUMAN-REVIEW.md) -- several first-pick results were rejected on
# sight for showing a DIFFERENT real, identifiable place (e.g. a Pexels
# "city hall" result literally reading "MILLVILLE CITY HALL" in the brick,
# a "university" result that was Washington State's own named clock tower,
# a "school" result with readable Vietnamese/Chinese signage, football
# photos with visible Brazilian sponsor branding) -- a generic CATEGORY
# photo must not read as a specific OTHER real place/institution any more
# than a venue photo should be a fabricated one. Four entries' `query` was
# replaced outright by a second, more specific search after the first
# query's top results were all rejected on sight (university, MV events, MV
# sports, MV school_alerts) -- `query` here is always the ACTUAL string that
# produced `chosen`, since --apply re-runs it to find the photo by id.
CATEGORY_SEARCHES: dict[tuple[str, str], CategorySearch] = {
    ("brookings_sd", "city_hall"): {"query": "small town city hall brick building", "chosen": ("pexels", 38855972)},
    ("brookings_sd", "events"): {"query": "small town street festival community", "chosen": ("pexels", 10148954)},
    ("brookings_sd", "home_sales"): {"query": "midwest suburban houses tree lined street", "chosen": ("pexels", 38211756)},
    ("brookings_sd", "jobs"): {"query": "grain elevator silo farm building", "chosen": ("pexels", 33406024)},
    ("brookings_sd", "sports"): {"query": "high school football stadium bleachers", "chosen": ("pexels", 13345801)},
    ("brookings_sd", "school_alerts"): {"query": "elementary school building exterior", "chosen": ("pexels", 35758714)},
    ("brookings_sd", "weather_alert"): {"query": "prairie storm clouds sky", "chosen": ("pexels", 30068845)},
    ("brookings_sd", "university"): {"query": "university campus lawn trees buildings", "chosen": ("pexels", 7752993)},
    ("moreno_valley_ca", "city_hall"): {"query": "modern civic building palm trees california", "chosen": ("pexels", 32957453)},
    ("moreno_valley_ca", "events"): {"query": "outdoor community fair crowd tents daytime", "chosen": ("pexels", 9177591)},
    ("moreno_valley_ca", "home_sales"): {"query": "suburban stucco houses tile roof california", "chosen": ("pexels", 34960819)},
    ("moreno_valley_ca", "jobs"): {"query": "warehouse distribution center exterior", "chosen": ("pexels", 36006588)},
    ("moreno_valley_ca", "sports"): {"query": "american high school football field night lights california", "chosen": ("pexels", 13345835)},
    ("moreno_valley_ca", "school_alerts"): {"query": "american elementary school building exterior", "chosen": ("pexels", 8500417)},
    ("moreno_valley_ca", "weather_alert"): {"query": "desert heat haze highway sky", "chosen": ("pexels", 13973966)},
    ("moreno_valley_ca", "traffic"): {"query": "freeway interchange overpass california", "chosen": ("pexels", 8783583)},
    ("moreno_valley_ca", "workplace_watch"): {"query": "warehouse loading dock semi trucks", "chosen": ("pexels", 35501716)},
}


def pexels_search(query: str, api_key: str, per_page: int = 5) -> list[dict]:
    resp = requests.get(
        "https://api.pexels.com/v1/search",
        headers={"Authorization": api_key},
        params={"query": query, "per_page": per_page, "orientation": "landscape"},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json().get("photos", [])


def unsplash_search(query: str, access_key: str, per_page: int = 5) -> list[dict]:
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
    # malformed URL where the crop/size params silently don't apply (or
    # worse). Confirmed live 2026-08-27: the raw URL from a real search
    # result already had "?ixid=...&ixlib=..." in it.
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    pexels_key = os.environ.get("PEXELS_API_KEY")
    unsplash_key = os.environ.get("UNSPLASH_ACCESS_KEY")

    if not args.apply:
        print("DRY RUN -- searching for each category, printing candidates.\n")
        if not pexels_key:
            print("PEXELS_API_KEY not set -- Pexels search skipped (get one free at pexels.com/api).\n")
        if not unsplash_key:
            print("UNSPLASH_ACCESS_KEY not set -- Unsplash fallback skipped (unsplash.com/developers).\n")
        for (town, category), entry in CATEGORY_SEARCHES.items():
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
        print("Dry run only -- no downloads, no writes. Fill in CATEGORY_SEARCHES['chosen'] "
              "after reviewing, then re-run with --apply.")
        return 0

    unresolved = [k for k, v in CATEGORY_SEARCHES.items() if not v["chosen"]]
    if unresolved:
        print("Refusing to --apply: these categories have no reviewed `chosen` selection yet:")
        for town, category in unresolved:
            print(f"  - {town}/{category}")
        print("Review dry-run candidates and fill in CATEGORY_SEARCHES first.")
        return 1

    generated: dict[tuple[str, str], dict] = {}
    for (town, category), entry in CATEGORY_SEARCHES.items():
        source, ident = entry["chosen"]
        alt = ALT_TEXT[(town, category)]
        if source == "pexels":
            if not pexels_key:
                raise RuntimeError("PEXELS_API_KEY required for a pexels selection")
            photo = next((p for p in pexels_search(entry["query"], pexels_key, per_page=10) if p["id"] == ident), None)
            if photo is None:
                raise RuntimeError(f"Pexels photo id {ident} not found for {town}/{category} -- re-run dry run")
            out_path = CATEGORIES_DIR / f"{town}-{category}.png"
            print(f"[{town}/{category}] downloading Pexels photo {ident} ...")
            _download_and_save_pexels(photo, out_path)
            web_path = "/" + str(out_path.relative_to("site/public")).replace("\\", "/")
            generated[(town, category)] = {
                "path": web_path, "alt": alt,
                "attribution_text": f"Photo by {photo['photographer']} on Pexels",
                "attribution_url": photo["photographer_url"],
            }
        elif source == "unsplash":
            if not unsplash_key:
                raise RuntimeError("UNSPLASH_ACCESS_KEY required for an unsplash selection")
            results = unsplash_search(entry["query"], unsplash_key, per_page=10)
            photo = next((p for p in results if p["id"] == ident), None)
            if photo is None:
                raise RuntimeError(f"Unsplash photo id {ident} not found for {town}/{category} -- re-run dry run")
            print(f"[{town}/{category}] hotlinking Unsplash photo {ident} ...")
            hotlink = _unsplash_hotlink_entry(photo, unsplash_key)
            generated[(town, category)] = {
                "path": hotlink["path"], "alt": alt,
                "attribution_html": hotlink["attribution_html"],
            }
        else:
            raise ValueError(f"Unknown source {source!r} for {town}/{category}")

    _write_category_images_ts(generated)
    print(f"\nWrote {CATEGORY_IMAGES_TS}")
    print("Done.")
    return 0


def _write_category_images_ts(generated: dict[tuple[str, str], dict]) -> None:
    """Same preserve-what-you-don't-manage discipline as
    generate_venue_category_images.py's own writer (see that script's
    _preserve_unmanaged_content -- Broomfield's empty placeholder + the
    categoryImagesFor() helper must survive this rewrite too)."""
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

    def town_block(town: str) -> str:
        lines = []
        for (t, category), data in sorted(generated.items()):
            if t != town:
                continue
            lines.append(f"    {category}: {entry_literal(data)},")
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
 * real photos". Generated by scripts/source_category_images.py -- edit the
 * query/selection there and re-run to change one image, don't hand-edit
 * paths here. Town entries not in this script's own CATEGORY_SEARCHES are
 * preserved verbatim, not deleted (see _write_category_images_ts()).
 */
import type {{ ImageCategory, ImageRef }} from '../lib/images';

{town_type_line}

export const CATEGORY_IMAGES: Record<Town, Partial<Record<ImageCategory, ImageRef>>> = {{
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
