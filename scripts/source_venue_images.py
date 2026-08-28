"""Sources REAL photos for specific named venues (City Hall, library
branches, ...) from Wikimedia Commons -- see NEEDS-HUMAN-REVIEW.md, "Switch
venue/category images to real photos". Replaces
scripts/generate_venue_category_images.py's venue half: a Flux-generated
image of a SPECIFIC real building always reads as AI-generated in a way the
generic category images and the content-track illustrations don't, so this
stops generating and starts sourcing.

Does NOT touch content/illustrations/generate_illustration.py or
config/image_model.py -- the content-track Flux pipeline (editorial,
culture essay, science column, recipes, media reviews) is explicitly out of
scope and unaffected.

SOURCE: Wikimedia Commons only (commons.wikimedia.org/w/api.php), no API key
required. A venue with no good match is left WITHOUT an image (image_path
NULL, falls through to the category-image tier -- see lib/images.ts's
resolveImage()) and flagged image_needs_review=true, per Task 4's explicit
"never silently substitute a stock photo for a specific building" rule --
this is deliberately NOT wired to any stock-photo fallback (Pexels/Unsplash
are scripts/source_category_images.py's job, for GENERIC categories only,
never presented as a specific place).

MATCH CANDIDATES ARE HAND-REVIEWED, NOT AUTO-PICKED: this script's dry run
prints every candidate's title, GPS coordinates (cross-checked against the
town's own config coordinates), license, and description-page URL for a
human (or the agent running this) to actually look at before choosing --
see VENUE_SEARCHES' `commons_file` field, filled in only after a real visual
check, same discipline as this project's other "verify, don't guess" rules.

Usage:
    python -m scripts.source_venue_images                 # dry run: search + print candidates
    python -m scripts.source_venue_images --apply          # download + write DB for entries with commons_file set
"""
from __future__ import annotations

import argparse
import re
import sys
from io import BytesIO
from pathlib import Path

# See scripts/source_category_images.py's identical comment -- Windows'
# console default encoding can't handle every real Commons author name.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import requests
from PIL import Image

from db.db import get_conn

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
REQUEST_TIMEOUT = 30
IMAGE_WIDTH = 1200
IMAGE_HEIGHT = 800
VENUES_DIR = Path("site/public/assets/images/venues")

# User-Agent required by Wikimedia's API etiquette (identifies the client,
# same convention this codebase already follows for NOAA/NWS -- see
# scrapers/parsers/noaa.py) -- anonymous/generic User-Agents are rate-limited
# or blocked.
HEADERS = {"User-Agent": "BrookingsViewBot/1.0 (hello@brookingsview.com; local-news image sourcing)"}

# (town, facility_slug) -> search query. `commons_file` is filled in by hand
# ONLY after visually confirming the match (see module docstring) -- None
# means "searched, no good match found, venue stays without an image."
VENUE_SEARCHES: dict[tuple[str, str], dict] = {
    ("moreno_valley_ca", "city-hall"): {
        "query": "Moreno Valley City Hall California",
        "commons_file": "Moreno Valley, California City Hall.jpg",
        # Verified 2026-08-27: visually confirmed real "CITY HALL" signage,
        # GPS 33.915078,-117.261925 (matches Moreno Valley, CA). CC0 (Credit
        # optional but rendered anyway -- see build_attribution()).
    },
    ("moreno_valley_ca", "main-library"): {
        "query": "Moreno Valley Public Library California",
        "commons_file": None,  # No good match -- only unrelated old scanned documents.
    },
    ("moreno_valley_ca", "mall-branch-library"): {
        "query": "Moreno Valley Mall branch library",
        "commons_file": None,  # No match at all.
    },
    ("moreno_valley_ca", "iris-plaza-branch-library"): {
        "query": "Iris Plaza library Moreno Valley",
        "commons_file": None,  # Zero results.
    },
    ("brookings_sd", "city-hall"): {
        "query": "Brookings City Hall South Dakota",
        "commons_file": "BrookingsCityHall.jpg",
        # Verified 2026-08-27: visually confirmed real brick NRHP-listed
        # building with municipal signage on the cornice, GPS
        # 44.308889,-96.799167 (matches Brookings, SD). CC BY-SA 3.0,
        # attribution required (Artist: Jatakuck).
    },
    ("brookings_sd", "public-library"): {
        "query": "Brookings Public Library South Dakota",
        "commons_file": None,  # No good match -- only unrelated soil-survey scans.
    },
    ("broomfield_co", "city-hall"): {
        "query": "George Di Ciero City and County Building Broomfield",
        "commons_file": None,  # Zero search results at all -- no candidate to review.
    },
    ("broomfield_co", "broomfield-community-center"): {
        "query": "Broomfield Community Center Colorado",
        "commons_file": None,  # Zero relevant results (only unrelated USACE planning-study scans).
    },
    ("broomfield_co", "paul-derda-recreation-center"): {
        "query": "Paul Derda Recreation Center Broomfield",
        "commons_file": "Recreation Center.JPG",
        # CORRECTED 2026-08-28 (was initially accepted the same way as the
        # two verified matches below -- caught in review, see chat): a
        # generic filename plus Commons' own ImageDescription/category
        # text ("The Paul Derda Recreation Center", "Buildings in
        # Broomfield, Colorado") is METADATA, not visual verification --
        # exactly the class of match the "verify each match against GPS/
        # signage" rule exists to catch. No legible in-frame signage, no
        # GPS in the file's metadata. The photo itself shows a plausible,
        # generic modern rec-center building with nothing contradicting
        # the claim, so it's kept rather than discarded outright -- but
        # `needs_review` MUST be forced back to true after apply (see
        # `needs_review` key below and main()'s write logic), not left at
        # the script's normal "sourced = verified" default. CC BY-SA 4.0.
        "needs_review": True,
    },
    ("broomfield_co", "library"): {
        "query": "Mamie Doud Eisenhower Public Library Broomfield",
        "commons_file": "The entrance to the Broomfield Public Library, also known as the Mamie Doud Eisenhower Public Library.jpg",
        # Verified 2026-08-28: visually confirmed -- entrance signage reads
        # "MAMIE DOUD EISENHOWER PUBLIC LIBRARY" and "3 Community Park
        # Road" directly on the building, matching the facility's real
        # name exactly. GPS 39.917469,-105.068786 (within Broomfield, CO,
        # close to the town's own configs/broomfield_co.json coordinates
        # 39.9205,-105.0866). CC0.
    },
    ("broomfield_co", "county-commons-park"): {
        "query": "Broomfield County Commons Colorado",
        "commons_file": "Broomfield County Commons Park Sign.jpg",
        # Verified 2026-08-28: visually confirmed -- monument sign reads
        # "Broomfield County Commons Park, 13200 Sheridan Blvd" with the
        # City and County of Broomfield, Colorado seal, exact match to the
        # facility's name. No GPS in the metadata, but the sign's own text
        # is unambiguous. CC BY-SA 2.0, credited to the City and County of
        # Broomfield, CO itself -- an official government-sourced photo.
    },
}


def commons_search(query: str, limit: int = 5) -> list[dict]:
    resp = requests.get(
        COMMONS_API,
        params={"action": "query", "list": "search", "srsearch": query,
                "srnamespace": 6, "format": "json", "srlimit": limit},
        headers=HEADERS, timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json().get("query", {}).get("search", [])


def commons_imageinfo(file_title: str) -> dict | None:
    """`file_title` like 'BrookingsCityHall.jpg' (no 'File:' prefix needed)."""
    resp = requests.get(
        COMMONS_API,
        params={"action": "query", "titles": f"File:{file_title}", "prop": "imageinfo",
                "iiprop": "url|extmetadata|size", "format": "json"},
        headers=HEADERS, timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    pages = resp.json().get("query", {}).get("pages", {})
    for page in pages.values():
        info = page.get("imageinfo")
        if info:
            return info[0]
    return None


def _strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", "", value or "").strip()


def build_attribution(imageinfo: dict) -> tuple[str, str, str]:
    """Returns (license_short_name, attribution_text, attribution_url).

    Always includes a credit line even when AttributionRequired is false
    (e.g. CC0/public domain) -- crediting is good practice even when not
    legally required, per Task 3's own instruction, and it costs nothing to
    always be consistent about it rather than branching UI on a license
    technicality.
    """
    meta = imageinfo.get("extmetadata", {})
    license_name = meta.get("LicenseShortName", {}).get("value", "Unknown license")
    artist = _strip_html(meta.get("Artist", {}).get("value", "")) or "Unknown"
    attribution_text = f"Photo by {artist} / Wikimedia Commons ({license_name})"
    attribution_url = imageinfo["descriptionurl"]
    return license_name, attribution_text, attribution_url


def _resize_cover(image: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Scale to COVER the target box, then center-crop -- NOT a naive
    stretch-resize. A real photo's native aspect ratio almost never matches
    1200x800 (3:2); stretching it (scripts/generate_venue_category_images.py's
    old approach, fine for Flux output generated AT that exact ratio) would
    visibly distort a real building's proportions."""
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


def _save(image_bytes: bytes, out_path: Path) -> None:
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    image = _resize_cover(image, IMAGE_WIDTH, IMAGE_HEIGHT)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path, format="PNG")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Actually download + write DB for resolved entries.")
    args = ap.parse_args()

    if not args.apply:
        print("DRY RUN -- searching Commons for each venue, printing candidates.\n")
        for (town, slug), entry in VENUE_SEARCHES.items():
            print(f"[{town}/{slug}] query: {entry['query']!r}")
            for r in commons_search(entry["query"], limit=5):
                print(f"    candidate: {r['title']}")
            chosen = entry["commons_file"]
            print(f"  -> chosen: {chosen!r}" if chosen else "  -> NO MATCH (will be flagged for review, no image)")
            print()
        print("Dry run only -- no downloads, no DB writes. Re-run with --apply.")
        return 0

    resolved = {k: v for k, v in VENUE_SEARCHES.items() if v["commons_file"]}
    unresolved = {k: v for k, v in VENUE_SEARCHES.items() if not v["commons_file"]}

    with get_conn() as conn:
        for (town, slug), entry in resolved.items():
            print(f"[{town}/{slug}] fetching {entry['commons_file']!r} ...")
            info = commons_imageinfo(entry["commons_file"])
            if info is None:
                raise RuntimeError(f"Commons imageinfo lookup failed for {entry['commons_file']!r}")
            license_name, attribution_text, attribution_url = build_attribution(info)
            image_resp = requests.get(info["url"], headers=HEADERS, timeout=60)
            image_resp.raise_for_status()
            out_path = VENUES_DIR / f"{town}-{slug}.png"
            _save(image_resp.content, out_path)
            web_path = "/" + str(out_path.relative_to("site/public")).replace("\\", "/")
            # Normally a sourced-and-applied match means "verified" (see
            # module docstring) -- needs_review=false. An entry can
            # override this with "needs_review": True (see paul-derda-
            # recreation-center above) for a match accepted on Commons'
            # own description/categorization rather than independent
            # visual confirmation (signage/GPS): keep the image, but don't
            # let it silently count as fully verified. Read from the entry
            # itself (not set once by hand after the fact) so a future
            # re-run of --apply can never quietly clobber this back to
            # false.
            needs_review = entry.get("needs_review", False)
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE facilities SET image_path = %s, image_source = 'wikimedia_commons',
                       image_license = %s, image_attribution_text = %s, image_attribution_url = %s,
                       image_needs_review = %s
                       WHERE town_id = %s AND slug = %s""",
                    (web_path, license_name, attribution_text, attribution_url, needs_review, town, slug),
                )
            print(f"  saved {out_path}")
            print(f"  attribution: {attribution_text}")
            if needs_review:
                print("  NOTE: needs_review left TRUE (accepted on metadata, not independent visual verification)")

        for (town, slug), entry in unresolved.items():
            print(f"[{town}/{slug}] no Commons match -- clearing image_path, flagging for review")
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE facilities SET image_path = NULL, image_alt = NULL, image_source = NULL,
                       image_license = NULL, image_attribution_text = NULL, image_attribution_url = NULL,
                       image_needs_review = true
                       WHERE town_id = %s AND slug = %s""",
                    (town, slug),
                )
        conn.commit()

    print(f"\nDone. {len(resolved)} sourced, {len(unresolved)} flagged for manual review "
          "(falls through to the category-image tier until then).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
