"""Sources REAL stock photos for the homepage "This week" segment's own
dedicated, SEASONAL image pool -- see NEEDS-HUMAN-REVIEW.md "This Week image
rotation" and site/src/config/this-week-images.ts's own module comment for
why this needed its own pool (the old shared 'events' category pool had no
seasonal awareness and was small enough -- 4-5 photos/town -- that the
segment read as "always the same picture").

Mirrors scripts/source_category_images.py's own established workflow (same
Pexels API, same hand-review-via-montage policy) -- reuses that script's
low-level Pexels/image helpers directly rather than duplicating them. Real
differences: the grid here is (town, SEASON) not (town, category), each
season needs at least 13 approved images (the brief's own minimum, vs.
category-images.py's 4-6 -- a 13-image pool is what actually survives a
60-day no-repeat rule across a ~13-week season), and candidates are sourced
from THREE BUCKETS per (town, season) instead of one undifferentiated query.

THREE-BUCKET MIX (2026-10-03): an all-nature-landscape first pass read as too
one-note for a segment that's supposed to feel like "this town, this week"
-- a street, a porch, a market stall says that far more than a pretty but
generic field does. Target distribution in the APPROVED pool:
  - ~50% built   -- residential streets, porches, house facades, suburb
                    views, gardens, bridges, buildings in the season's own
                    light
  - ~30% nature  -- landscape, parks, trails
  - ~20% life    -- market, food, an event, people at a distance
BUCKET_TARGET_COUNT below allocates montage candidate slots in roughly that
ratio too, so a reviewer picking a representative spread across what's shown
naturally lands close to it in the final pool -- it's a supply bias, not a
hard quota; `chosen` entries optionally carry their own "bucket" so the
actually-approved distribution is checkable (see --apply's summary).

BUILT QUERIES TARGET RESIDENTIAL/FACADE SHOTS, NOT SHOP BLOCKS (2026-10-03
round-2 revision): the first "built" pass leaned on "main street brick
storefronts" / "downtown" -- real, confirmed problem, those shots are
exactly where a readable shop sign or chain logo shows up (Brookings'
"HILL'S HARDWARE HANK", a "Gambles" storefront; Broomfield's "Caramel
Crisp" candy-shop sign, a visible Chase bank logo). Retargeted at quiet
residential streets, porches, and facades instead -- a house front or a
tree-lined block is far less likely to carry a legible sign than a
storefront is. "downtown"/"main street" are deliberately absent from every
town's built queries now, not just Moreno Valley/Broomfield's.

SEASONAL MOTIFS ARE TOWN-SPECIFIC, NOT A GENERIC CALENDAR ICON SET -- see
BUCKET_QUERIES below. Moreno Valley's autumn is dry hills, Santa Ana wind,
a pumpkin patch and a harvest market, NEVER fall foliage (South Dakota and
Colorado's own autumns genuinely do have that; Southern California's Inland
Empire does not) -- a wrong-season-for-this-real-place photo is its own kind
of "not actually this town" mismatch, same spirit as the no-other-
recognizable-place rule below, just about climate/landscape instead of a
specific landmark. Round-2 rejections also caught the same class of mismatch
in built/nature shots directly -- a dense downtown-LA skyline for Moreno
Valley, a mountain ski-village and Boulder's own Flatirons/Garden of the
Gods for Broomfield -- not just a seasonal motif, a wrong REAL PLACE in the
same regional neighborhood as the actual town.

EXTRA REJECTION RULE FOR "built" CANDIDATES: a street/house/storefront photo
is far more likely than a landscape to carry a readable sign, a license
plate, a chain-store logo, or a brand -- any of those is an automatic
reject, same as a recognizable landmark from another real place. A boring,
anonymous facade beats an interesting one that's secretly identifiable.
Apply this on TOP of source_category_images.py's existing bar (no real
identifiable faces, no readable text naming a real specific place, no
foreign-coded architecture/language for an American-town category, no
famous/identifiable landmark) -- not instead of it.

OCR TEXT DETECTION (2026-10-03, round 2): --round2 runs a scene-text
detector over every candidate thumbnail and marks anything with a 3+
character detection at reasonable confidence as "[TEXT]" in its caption
(red background, impossible to miss scrolling the grid). This is a SUPPORT
flag for a human reviewer, not an automatic reject -- a flagged image can
still be a real, approvable candidate (a false positive on texture/foliage
noise happens sometimes) and an unflagged image still needs the same full
visual check (a logo or a face isn't "text" and won't trip this at all,
but is still a reject). USES EasyOCR, NOT pytesseract/Tesseract: Tesseract
was tried first and genuinely failed the real test case this exists for --
round 1's large, legible "HILL'S HARDWARE HANK" storefront sign scored
ZERO readable text at every page-segmentation mode, full resolution
included (confirmed 2026-10-03 -- Tesseract is a document-OCR engine, not
built for text painted on a photographed real-world surface, a genuinely
different and harder problem). EasyOCR -- an actual scene-text model, not
a document engine repurposed -- read the same sign correctly on the first
try. Heavier dependency (pulls in torch); loaded lazily and once per run
(_get_ocr_reader()) specifically because that cost is real, and never
touched at all by --apply/dry-run, which don't need it. Montage building
degrades to unflagged (prints a warning once) if it's missing rather than
crashing the whole run over an optional check.

ROUND-2 SURVIVOR HANDLING: a prior round's approved-pending ("kept", i.e.
shown but not yet explicitly rejected) candidates are re-fetched by their
OWN Pexels id (pexels_get_photo(), not re-run through search) -- same
reasoning source_category_images.py's own pexels_get_photo() docstring
already gives: search ranking drifts, a specific id does not. See
ROUND1_KEPT_IDS/ROUND1_REJECTED_IDS below for exactly which 2026-10-03
round-1 ids survived human review and which didn't.

Requires PEXELS_API_KEY in the environment/.env (same free, instant signup
as source_category_images.py: pexels.com/api).

Usage:
    python -m scripts.source_this_week_images --montage          # build all 12 review grids
    python -m scripts.source_this_week_images --montage --only moreno_valley_ca autumn
    python -m scripts.source_this_week_images                    # dry run: search + print candidates as text
    python -m scripts.source_this_week_images --apply             # download + write site/src/config/this-week-images.ts
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from io import BytesIO
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import requests
from PIL import Image, ImageDraw

from scripts.source_category_images import (  # noqa: E402  (sys.path must be set first)
    pexels_search as _pexels_search_raw, pexels_get_photo as _pexels_get_photo_raw, _resize_cover, _download_and_save_pexels,
)

import time


def pexels_search(query: str, api_key: str, per_page: int = 8, max_retries: int = 5) -> list[dict]:
    """Wraps source_category_images.pexels_search with the same 429 backoff
    as pexels_get_photo below -- confirmed live 2026-10-03, round 3: the
    kept-id refetch loop (pexels_get_photo, already retrying) was on its own
    enough to exhaust Pexels' short burst window, so the very FIRST new-
    candidate pexels_search call of the run landed while still rate-limited
    and crashed immediately -- unlike pexels_get_photo, this had no retry at
    all, so one hot run (multiple kept ids to refetch, back-to-back new
    searches right after) reliably failed at the same spot every time."""
    for attempt in range(max_retries):
        try:
            return _pexels_search_raw(query, api_key, per_page)
        except requests.exceptions.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == 429 and attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    (429 rate-limited on query={query!r}, retrying in {wait}s...)")
                time.sleep(wait)
                continue
            raise


def pexels_get_photo(photo_id: int, api_key: str, max_retries: int = 5):
    """Wraps source_category_images.pexels_get_photo with 429 backoff --
    build_final_montage() re-fetches every surviving id one at a time
    (round 2/3's own kept-list re-fetches are much smaller and never tripped
    this), and a 50+-candidate final pool hit Pexels' short burst limit on
    the very first live run even though the monthly quota (25000/mo) was
    nowhere near exhausted -- confirmed via the X-Ratelimit-* response
    headers, 2026-10-03."""
    for attempt in range(max_retries):
        try:
            return _pexels_get_photo_raw(photo_id, api_key)
        except requests.exceptions.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == 429 and attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    (429 rate-limited on id={photo_id}, retrying in {wait}s...)")
                time.sleep(wait)
                continue
            raise

# Scene-text detection: plain Tesseract (pytesseract) was tried first and
# flagged NOTHING on the exact real reject this feature exists to catch --
# round 1's "HILL'S HARDWARE HANK" storefront sign, large and legible to the
# eye, scored zero readable text at every page-segmentation mode tried, full
# resolution included (confirmed 2026-10-03: Tesseract is tuned for
# scanned/flat documents, not text painted on a photographed real-world
# surface -- a genuinely different, harder problem). EasyOCR (a real scene-
# text detector, not a document OCR engine wearing that hat) read the same
# sign correctly on the first try ("HANK" at 1.0 confidence, "HARLIARE" --
# close enough to "HARDWARE" -- at 0.65). Heavier dependency (pulls in
# torch), loaded lazily/once per script run (_get_ocr_reader()) specifically
# because that cost is real -- never imported at all for --apply/dry-run,
# which don't need it.
_OCR_READER = None


def _get_ocr_reader():
    global _OCR_READER
    if _OCR_READER is None:
        import easyocr
        _OCR_READER = easyocr.Reader(["en"], gpu=False, verbose=False)
    return _OCR_READER


def _ocr_available() -> bool:
    try:
        _get_ocr_reader()
        return True
    except Exception as exc:
        print(f"WARNING: EasyOCR unavailable ({exc}) -- building montages WITHOUT [TEXT] flags.")
        return False

IMAGES_DIR = Path("site/public/assets/images/this-week")
CONFIG_TS = Path("site/src/config/this-week-images.ts")
MONTAGE_DIR = Path(".review_montages")

# 2026-10-06 review finding: _download_and_save_pexels() (shared with
# source_category_images.py) saves the native Pexels download as an
# uncompressed PNG -- fine at that script's own smaller scale, but this
# pool's first real run landed 45 files averaging ~1.6MB each (73MB total)
# for what's ultimately a homepage hero image. Compressing here, LOCALLY to
# this script, rather than changing the shared helper (which category
# images -- a separate, already-working pipeline -- also use and weren't
# asked to change). JPEG, not WebP: this site has zero WebP usage anywhere
# today (488 existing images are all PNG), and JPEG's universal downstream
# support (RSS readers, social-card crawlers, schema.org image validators)
# is the safer first image-format departure from PNG. Quality 80 confirmed
# live: the largest candidate in the actual applied pool (2.36MB native)
# compresses to ~390KB with no visible artifacts on inspection.
JPEG_QUALITY = 80
MAX_IMAGE_WIDTH = 1600


def _compress_to_jpeg(png_path: Path, quality: int = JPEG_QUALITY, max_width: int = MAX_IMAGE_WIDTH) -> Path:
    """Converts a just-saved native PNG to a compressed JPEG at the same
    basename, downscaling first if wider than `max_width` (preserving
    aspect ratio, never upscaling). Deletes the source PNG -- the JPEG is
    the only file `--apply`'s caller should reference afterward. Returns
    the new .jpg path."""
    image = Image.open(png_path).convert("RGB")
    if image.width > max_width:
        new_height = round(image.height * (max_width / image.width))
        image = image.resize((max_width, new_height), Image.LANCZOS)
    jpeg_path = png_path.with_suffix(".jpg")
    image.save(jpeg_path, format="JPEG", quality=quality, optimize=True)
    png_path.unlink()
    return jpeg_path

TOWNS = ["brookings_sd", "moreno_valley_ca", "broomfield_co"]
SEASONS = ["winter", "spring", "summer", "autumn"]
BUCKETS = ["built", "nature", "life"]

# Minimum pool size per the brief -- NOT a target to pad to with borderline
# matches (same "a smaller honest pool beats padding" rule
# source_category_images.py already established); a season that falls short
# after review stays short and gets flagged, not silently filled. Round 2's
# own target (18, see REVIEW -- 2026-10-03 instruction) is a buffer ABOVE
# this floor, not a replacement for it.
MIN_POOL_SIZE = 13
ROUND2_TARGET = 18

# Candidate SUPPLY slots per bucket for NEW candidates in one montage
# (~50/29/21%) -- see this file's own module comment. Split evenly across
# however many queries a given (town, season, bucket) lists; not a cap on
# how many a reviewer can approve from what's shown, just how many are
# fetched to choose from.
BUCKET_TARGET_COUNT = {"built": 12, "nature": 7, "life": 5}

# Caption background per bucket, for fast visual scanning of a grid's mix.
BUCKET_COLOR = {"built": (30, 60, 120), "nature": (30, 110, 60), "life": (150, 90, 20)}
TEXT_FLAG_COLOR = (170, 20, 20)  # OCR "[TEXT]" flag -- deliberately alarming red

# 2026-10-03 human review results, round 1 (24-ish candidates/town, one
# montage each, see that round's own 3 montage PNGs under .review_montages/
# before this round overwrote them). REJECTED is explicit, from the actual
# review; everything round 1 showed that ISN'T in REJECTED is "kept" per
# that review's own instruction ("Behåll kandidater från omgång 1 som inte
# förkastats"). (town, season) -> {"rejected": [...], "kept": [...]}, ids
# are each photo's own Pexels id (stable, NOT the montage index -- indices
# are only meaningful within one specific grid image).
# "kept" is [(id, bucket), ...] -- bucket recorded explicitly from round 1's
# own montage (not re-derived/guessed later) so round 2's distribution
# report is accurate for carried-over candidates, not just new ones.
ROUND1_REVIEW: dict[tuple[str, str], dict[str, list]] = {
    ("brookings_sd", "autumn"): {
        "rejected": [31020359, 31094777, 10130181],  # #0 "HILL'S HARDWARE HANK", #1 "Gambles", #21 Pepsi truck
        "kept": [
            (15623745, "built"), (29348605, "built"), (34762828, "built"), (1486689, "built"),
            (5875894, "built"), (34379208, "built"), (20534566, "built"), (33784496, "built"),
            (39470305, "built"), (35226305, "built"),
            (35077503, "nature"), (11089479, "nature"), (14633165, "nature"), (35365408, "nature"),
            (18843431, "nature"), (34356592, "nature"),
            (6280478, "life"), (30391784, "life"), (33815997, "life"),
        ],
    },
    ("moreno_valley_ca", "autumn"): {
        # #3/#4/#5 explicit (downtown LA skyline); #6 (dense urban grid, not
        # low-rise Inland Empire suburb), #11 (east-coast-coded brick
        # colonial facade, not SoCal stucco), #13 (city skyline + tower at
        # dusk -- wrong MOTIF, too urban/identifiable regardless of which
        # specific city) rejected on my own judgment per the review's
        # explicit "annars lämna dem till mig" allowance -- #7 (aerial
        # grid-pattern rooftops) kept: plausibly real Inland Empire tract
        # housing, not a skyline or a specific landmark.
        #
        # ROUND 2 additions (2026-10-03, confirmed against the actual
        # round-2 montage PNG via caption OCR, not a live re-fetch -- Pexels
        # search ranking drifted between build and review so a live re-query
        # no longer lines up with the montage index the reviewer actually
        # looked at): #20 id=18064861, a dense aerial street-grid shot, same
        # "too urban" problem as round 1's rejects above -- it was a NEW
        # round-2 candidate, never "kept". #13 id=29827029 ("fresh
        # blueberries at Los Angeles Farmers Market" per its own Pexels
        # title) -- names a specific, different, identifiable real place
        # even though the photo itself shows no readable text, same
        # no-other-real-place rule as a landmark or a sign.
        "rejected": [2820883, 17490121, 33572396, 19226822, 5859603, 5309166, 18064861, 29827029],
        "kept": [
            (31619753, "built"), (816198, "built"), (5365778, "built"), (38813637, "built"),
            (6794794, "built"), (6937796, "built"), (10104467, "built"),
            (18027616, "nature"), (12422188, "nature"), (2974614, "nature"), (36181722, "nature"),
            (18265979, "life"), (5528964, "life"), (28561867, "life"),
        ],
    },
    ("broomfield_co", "autumn"): {
        # ROUND 2 additions (2026-10-03, same caption-OCR-confirmed method as
        # Moreno Valley above): #2 id=20863264, whitewashed mountain-town
        # storefronts with a visible school bus and clock face -- plausibly
        # a specific identifiable mining town (Georgetown/Silver Plume), not
        # anonymous-enough. #11 id=4407593, a mountain range reflected in
        # still water -- the Flatirons/Boulder Reservoir, a specific named
        # Boulder-area landmark, not generic Front Range scenery.
        "rejected": [30161234, 9622493, 3258219, 12862797, 13862531, 29008121, 3968055, 20863264, 4407593],
        "kept": [
            (9739348, "built"), (3968059, "built"), (34674157, "built"),
            (28909177, "built"), (35491882, "built"), (1486689, "built"), (6937796, "built"),
            (18790368, "nature"), (4580538, "nature"), (5645251, "nature"),
            (6761058, "life"), (8540981, "life"),
        ],
    },
}

ALT_TEXT: dict[tuple[str, str], str] = {
    ("brookings_sd", "winter"): "Winter in Brookings, South Dakota.",
    ("brookings_sd", "spring"): "Spring in Brookings, South Dakota.",
    ("brookings_sd", "summer"): "Summer in Brookings, South Dakota.",
    ("brookings_sd", "autumn"): "Autumn in Brookings, South Dakota.",
    ("moreno_valley_ca", "winter"): "Winter in Moreno Valley, California.",
    ("moreno_valley_ca", "spring"): "Spring in Moreno Valley, California.",
    ("moreno_valley_ca", "summer"): "Summer in Moreno Valley, California.",
    ("moreno_valley_ca", "autumn"): "Autumn in Moreno Valley, California.",
    ("broomfield_co", "winter"): "Winter in Broomfield, Colorado.",
    ("broomfield_co", "spring"): "Spring in Broomfield, Colorado.",
    ("broomfield_co", "summer"): "Summer in Broomfield, Colorado.",
    ("broomfield_co", "autumn"): "Autumn in Broomfield, Colorado.",
}

# (town, season) -> {bucket: [query, ...]}. "built" queries point at
# residential streets/porches/facades, deliberately NOT shop blocks/squares
# -- see this file's own module comment for why ("main street"/"downtown"
# are the confirmed source of every round-1 signage reject). Only autumn has
# had a real review pass; winter/spring/summer keep the same three-bucket
# shape for consistency but haven't been run yet.
BUCKET_QUERIES: dict[tuple[str, str], dict[str, list[str]]] = {
    ("brookings_sd", "autumn"): {
        "built": [
            "quiet residential street autumn midwest trees",
            "suburban house front porch autumn pumpkins",
            "midwest farmhouse rural homestead autumn",
            "small town neighborhood houses autumn trees",
        ],
        "nature": [
            "south dakota prairie landscape autumn gold",
            "midwest park walking path fall leaves",
        ],
        "life": [
            "farmers market small town autumn",
            "community fall festival small town people",
        ],
    },
    ("moreno_valley_ca", "autumn"): {
        "built": [
            "stucco suburban homes palm trees quiet street",
            "southern california suburban neighborhood street autumn",
            "inland empire residential street stucco houses",
            "suburban house front porch california autumn",
        ],
        # Deliberately no "fall leaves"/foliage query -- see module comment.
        "nature": [
            "dry hills sunset neighborhood california autumn",
            "southern california desert hills golden hour",
        ],
        "life": [
            "pumpkin patch family california autumn",
            "farmers market southern california people",
        ],
    },
    ("broomfield_co", "autumn"): {
        "built": [
            "colorado suburban homes front range quiet street",
            "colorado neighborhood houses autumn trees",
            "suburban house front porch colorado autumn",
            "new suburban development street colorado",
        ],
        "nature": [
            "colorado plains foothills landscape autumn",
            "colorado front range trail park fall",
        ],
        "life": [
            "colorado farmers market autumn people",
            "community fall festival colorado small town",
        ],
    },

    # Winter/spring/summer: same three-bucket shape, residential-first
    # built queries, not yet reviewed -- fill in per-bucket detail (the way
    # autumn's were, after its own round-1/round-2 correction) before
    # actually running these.
    ("brookings_sd", "winter"): {
        "built": ["quiet residential street snow midwest", "midwest farmhouse winter snow"],
        "nature": ["south dakota prairie snow farmland"],
        "life": ["small town winter market indoor"],
    },
    ("brookings_sd", "spring"): {
        "built": ["quiet residential street spring blossom midwest", "suburban house front porch spring"],
        "nature": ["midwest prairie spring green fields"],
        "life": ["farmers market small town spring"],
    },
    ("brookings_sd", "summer"): {
        "built": ["quiet residential street summer midwest trees", "midwest suburban house front porch summer"],
        "nature": ["south dakota farmland summer corn field"],
        "life": ["small town summer festival people"],
    },
    ("moreno_valley_ca", "winter"): {
        "built": ["stucco suburban homes palm trees winter quiet street", "southern california suburban house winter mild"],
        "nature": ["southern california desert hills winter mild"],
        "life": ["southern california farmers market winter"],
    },
    ("moreno_valley_ca", "spring"): {
        "built": ["stucco suburban homes palm trees spring quiet street", "southern california suburban house front porch spring"],
        "nature": ["california desert hills spring wildflowers"],
        "life": ["southern california farmers market spring people"],
    },
    ("moreno_valley_ca", "summer"): {
        "built": ["stucco suburban homes palm trees summer quiet street", "southern california suburban house golden hour"],
        "nature": ["inland southern california dry hills summer heat"],
        "life": ["southern california summer market people"],
    },
    ("broomfield_co", "winter"): {
        "built": ["colorado suburban homes front range snow quiet street", "colorado suburban house front porch winter"],
        "nature": ["colorado front range snow mountains winter"],
        "life": ["colorado winter market indoor people"],
    },
    ("broomfield_co", "spring"): {
        "built": ["colorado suburban homes front range spring quiet street", "new neighborhood trail colorado spring"],
        "nature": ["colorado plains foothills spring"],
        "life": ["colorado farmers market spring people"],
    },
    ("broomfield_co", "summer"): {
        "built": ["colorado suburban homes front range summer quiet street", "colorado suburban house front porch summer"],
        "nature": ["colorado front range summer blue sky"],
        "life": ["colorado summer festival people"],
    },
}

# `chosen`: list of {"id": int, "bucket": "built"|"nature"|"life"} once
# reviewed -- bucket is optional bookkeeping (lets --apply report the real
# approved distribution) and isn't required for a pick to be valid.
SEASON_SEARCHES: dict[tuple[str, str], dict] = {key: {"chosen": []} for key in BUCKET_QUERIES}

# ROUND 3 (2026-10-03): life bucket only -- round 2's "life" count was thin
# everywhere (2-4 shown/town against a 20% target), so this round fetches
# ONLY new life candidates, with motifs specified directly by the reviewer:
# a harvest market seen from a distance, pumpkins on a table, a pastry/
# coffee cup with no visible packaging/branding, people shot from behind or
# far enough away not to be a recognizable face, a kid playing in leaves, a
# bike parked on a sidewalk. Deliberately no close-up-face queries (matches
# source_category_images.py's existing "no identifiable real faces" bar)
# and no query wording likely to pull in a storefront/market-stall sign
# (the exact thing OCR round 2 caught once already, see ROUND1_REVIEW
# comments and _ocr_has_text below).
ROUND3_LIFE_QUERIES: dict[str, list[str]] = {
    "brookings_sd": [
        "midwest farmers market produce stall autumn",
        "pumpkins table display autumn rustic",
        "coffee cup pastry wooden table autumn outdoor",
        "person walking away small town street autumn",
        "child playing autumn leaves park midwest",
        "bicycle parked sidewalk autumn leaves",
        "people distance autumn festival midwest",
    ],
    "moreno_valley_ca": [
        "southern california farmers market produce stall",
        "pumpkin patch table display autumn",
        "coffee cup pastry outdoor table california",
        "person walking away street palm trees autumn",
        "child playing autumn leaves park california",
        "bicycle parked sidewalk suburban street",
        "people distance outdoor market california",
    ],
    "broomfield_co": [
        "colorado farmers market produce stall autumn",
        "pumpkins table display autumn colorado",
        "coffee cup pastry outdoor table colorado autumn",
        "person walking away street autumn colorado",
        "child playing autumn leaves park colorado",
        "bicycle parked sidewalk autumn leaves colorado",
        "people distance trail autumn colorado",
    ],
}
LIFE_PER_QUERY = 4  # per-query fetch count -- 7 queries x 4 = generous surplus above the >=8-new floor


def _manifest_path(town: str, season: str, tag: str) -> Path:
    return MONTAGE_DIR / f"{town}-{season}-{tag}.manifest.json"


def _write_manifest(town: str, season: str, tag: str, thumbs: list[tuple[str, dict, object, bool]], kept_ids: set[int]) -> None:
    """Writes the index -> {id, bucket, origin} mapping actually used to
    build a montage, authored directly from the in-memory candidate list at
    build time. This is the authoritative record a later --select call
    resolves indices against -- NOT a live re-fetch, which can drift (Pexels
    search ranking isn't pinned to a result set; round 2's own montage
    already proved this: a fresh re-query for the same (town, season)
    shifted a "new" candidate's position by one -- see ROUND1_REVIEW's
    moreno_valley_ca round-2 comment)."""
    import json
    manifest = [
        {
            "index": i,
            "id": p["id"],
            "bucket": bucket,
            "origin": "R1" if p["id"] in kept_ids else "NEW",
            "flagged": flagged,
        }
        for i, (bucket, p, _thumb, flagged) in enumerate(thumbs)
    ]
    MONTAGE_DIR.mkdir(exist_ok=True)
    _manifest_path(town, season, tag).write_text(json.dumps(manifest, indent=1), encoding="utf-8")


def _load_manifest(town: str, season: str, tag: str) -> list[dict]:
    import json
    path = _manifest_path(town, season, tag)
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _ocr_has_text(image: Image.Image, ocr_ready: bool) -> bool:
    """True if EasyOCR finds at least one detection of 3+ characters at
    confidence >= 0.35 -- a deliberately loose bar (a SUPPORT flag for human
    review, not a verdict, see module comment): better to flag a texture/
    foliage false positive than miss a real readable sign. Threshold chosen
    against the real "HILL'S HARDWARE HANK" reject -- EasyOCR read "HANK"
    at 1.0 and "HARLIARE" (its own OCR approximation of "HARDWARE") at
    0.65, both comfortably above 0.35; junk detections on busy foliage/
    texture in testing scored under 0.1."""
    if not ocr_ready:
        return False
    try:
        import numpy as np
        results = _get_ocr_reader().readtext(np.array(image))
    except Exception:
        return False
    for _bbox, text, confidence in results:
        if confidence >= 0.35 and len(text.strip()) >= 3:
            return True
    return False


def _fetch_new_bucket_candidates(
    town: str, season: str, pexels_key: str, exclude_ids: set[int],
) -> list[tuple[str, dict]]:
    """[(bucket, photo), ...] for NEW candidates only -- excludes any id
    already accounted for by a prior round's kept/rejected lists, so a
    round-2 montage doesn't re-show something already decided."""
    queries = BUCKET_QUERIES[(town, season)]
    seen_ids: set[int] = set(exclude_ids)
    results: list[tuple[str, dict]] = []
    for bucket in BUCKETS:
        bucket_queries = queries.get(bucket, [])
        if not bucket_queries:
            continue
        per_query = max(1, BUCKET_TARGET_COUNT[bucket] // len(bucket_queries))
        for q in bucket_queries:
            for photo in pexels_search(q, pexels_key, per_page=per_query):
                if photo["id"] in seen_ids:
                    continue
                seen_ids.add(photo["id"])
                results.append((bucket, photo))
    return results


def _fetch_life_candidates(town: str, season: str, pexels_key: str, exclude_ids: set[int]) -> list[tuple[str, dict]]:
    """[("life", photo), ...] -- round 3's life-only fetch, using
    ROUND3_LIFE_QUERIES instead of BUCKET_QUERIES's life slice (that one was
    never the bottleneck query-wise, just under-targeted with slots; this is
    a dedicated, bigger pass)."""
    seen_ids: set[int] = set(exclude_ids)
    results: list[tuple[str, dict]] = []
    for q in ROUND3_LIFE_QUERIES[town]:
        for photo in pexels_search(q, pexels_key, per_page=LIFE_PER_QUERY):
            if photo["id"] in seen_ids:
                continue
            seen_ids.add(photo["id"])
            results.append(("life", photo))
    return results


def _build_grid(town: str, season: str, tag: str, candidates: list[tuple[str, dict]], kept_ids: set[int], ocr_ready: bool, preflagged: dict[int, bool] | None = None) -> tuple[Path, dict]:
    """Shared grid-building body for round2/round3/final montages -- downloads
    thumbnails, OCR-flags them (or reuses a prior round's flag via
    `preflagged`, see build_final_montage), draws the labeled grid, writes
    the PNG + its sidecar manifest. Returns (png_path, {counts, flagged})."""
    thumbs = []
    text_flag_count = 0
    for bucket, p in candidates:
        img_resp = requests.get(p["src"]["medium"], timeout=30)
        img_resp.raise_for_status()
        thumb = Image.open(BytesIO(img_resp.content)).convert("RGB")
        thumb = _resize_cover(thumb, 360, 240)
        if preflagged is not None and p["id"] in preflagged:
            flagged = preflagged[p["id"]]
        else:
            flagged = _ocr_has_text(thumb, ocr_ready)
        if flagged:
            text_flag_count += 1
        thumbs.append((bucket, p, thumb, flagged))

    cols = 4
    rows = (len(thumbs) + cols - 1) // cols
    cell_w, cell_h, caption_h = 360, 240, 24
    grid = Image.new("RGB", (cols * cell_w, rows * (cell_h + caption_h)), "white")
    draw = ImageDraw.Draw(grid)
    for i, (bucket, p, thumb, flagged) in enumerate(thumbs):
        x, y = (i % cols) * cell_w, (i // cols) * (cell_h + caption_h)
        grid.paste(thumb, (x, y))
        origin = "R1" if p["id"] in kept_ids else "NEW"
        text_marker = " [TEXT]" if flagged else ""
        caption = f"#{i} [{bucket}] {origin} id={p['id']} {p['photographer'][:12]}{text_marker}"
        caption_bg = TEXT_FLAG_COLOR if flagged else BUCKET_COLOR[bucket]
        draw.rectangle([x, y + cell_h, x + cell_w, y + cell_h + caption_h], fill=caption_bg)
        draw.text((x + 4, y + cell_h + 4), caption, fill="white")

    MONTAGE_DIR.mkdir(exist_ok=True)
    out_path = MONTAGE_DIR / f"{town}-{season}-{tag}.png"
    grid.save(out_path, format="PNG")
    _write_manifest(town, season, tag, thumbs, kept_ids)
    counts = {b: sum(1 for bb, *_ in thumbs if bb == b) for b in BUCKETS}
    return out_path, {"counts": counts, "flagged": text_flag_count, "total": len(thumbs)}


def build_round3_life_montage(town: str, season: str, pexels_key: str, ocr_ready: bool) -> Path | None:
    review = ROUND1_REVIEW.get((town, season), {"rejected": [], "kept": []})
    kept_life = [(pid, b) for pid, b in review["kept"] if b == "life"]
    already_decided = set(review["rejected"]) | {pid for pid, _ in review["kept"]}

    kept_entries = [("life", pexels_get_photo(pid, pexels_key)) for pid, _ in kept_life]
    new_entries = _fetch_life_candidates(town, season, pexels_key, already_decided)
    if len(new_entries) < 8:
        print(f"  WARNING [{town}/{season}] only found {len(new_entries)} new life candidates (<8 floor) -- "
              f"widen ROUND3_LIFE_QUERIES['{town}'] or raise LIFE_PER_QUERY")

    candidates = kept_entries + new_entries
    if not candidates:
        print(f"  [{town}/{season}] no life candidates (nothing kept, no new results)")
        return None

    kept_ids = {pid for pid, _ in kept_life}
    out_path, stats = _build_grid(town, season, "round3-life", candidates, kept_ids, ocr_ready)
    print(
        f"  [{town}/{season}] round-3 life montage -> {out_path} "
        f"({stats['total']} candidates: {len(kept_entries)} kept + {len(new_entries)} new; "
        f"{stats['flagged']} flagged [TEXT])"
        + ("" if ocr_ready else " -- OCR UNAVAILABLE, no [TEXT] flags were possible this run")
    )
    return out_path


def build_final_montage(town: str, season: str, pexels_key: str) -> Path | None:
    """Merges round-2's surviving (non-rejected) candidates with round-3's
    life candidates into ONE renumbered grid -- this is the actual pool
    --select's indices refer to, since round 2 and round 3 are two separate
    PNGs with their own independent #0-based numbering and a human picking
    across both by eye would otherwise have to disambiguate "built round-2
    #5" from "life round-3 #5". Rebuilds thumbnails fresh (no OCR re-run --
    already screened in their own round) so this is cheap."""
    review = ROUND1_REVIEW.get((town, season), {"rejected": [], "kept": []})
    rejected = set(review["rejected"])

    round2_manifest = _load_manifest(town, season, "round2")
    round3_manifest = _load_manifest(town, season, "round3-life")
    if not round2_manifest:
        print(f"  [{town}/{season}] no round-2 manifest found -- run --round2 first")
        return None

    # Round 4+ (2026-10-06 review instruction): ad-hoc supplementary
    # candidate batches, one manifest per (town, season, bucket) -- e.g.
    # "round4-nature", "round4-life" -- built by _build_grid() the same way
    # round2/round3 are, just outside the fixed round2/round3-life CLI
    # flags (a targeted top-up for one or two buckets doesn't need its own
    # permanent --round4 flag the way the first three rounds did). Globbed
    # by filename rather than listed explicitly, so a later round5/round6
    # top-up needs no code change here -- just a matching manifest file.
    round4_manifests: list[dict] = []
    for p in sorted(MONTAGE_DIR.glob(f"{town}-{season}-round4-*.manifest.json")):
        import json as _json
        round4_manifests.extend(_json.loads(p.read_text(encoding="utf-8")))

    seen: set[int] = set()
    final_ids: list[tuple[int, str]] = []  # (id, bucket)
    preflagged: dict[int, bool] = {}
    for entry in round2_manifest + round3_manifest + round4_manifests:
        pid, bucket = entry["id"], entry["bucket"]
        # Carry the OCR flag a source montage already computed -- re-running
        # EasyOCR here would just reproduce the same verdict at real cost
        # (and manifests predating the "flagged" field default to False,
        # i.e. "re-check it yourself", not "confirmed clean").
        preflagged[pid] = entry.get("flagged", False)
        if pid in rejected or pid in seen:
            continue
        seen.add(pid)
        final_ids.append((pid, bucket))

    candidates = []
    for pid, bucket in final_ids:
        candidates.append((bucket, pexels_get_photo(pid, pexels_key)))
        time.sleep(0.15)  # small proactive gap -- avoids tripping the burst limit on a 50+-candidate pool
    kept_ids = {pid for pid, _ in review["kept"]}
    out_path, stats = _build_grid(town, season, "final", candidates, kept_ids, ocr_ready=False, preflagged=preflagged)
    print(
        f"  [{town}/{season}] final montage -> {out_path} "
        f"({stats['total']} candidates: built={stats['counts']['built']} "
        f"nature={stats['counts']['nature']} life={stats['counts']['life']})"
    )
    return out_path


def _cross_town_duplicate_ids(town: str, season: str, candidate_ids: set[int]) -> dict[int, str]:
    """{id: other_town, ...} for every id in `candidate_ids` that another
    town has ALREADY chosen (written to its own {town}-{season}-chosen.json
    sidecar) for the same season -- the pools must be disjoint across towns
    (2026-10-03 review instruction): the same real Pexels photo reused for
    two towns both weakens "this town, this week" distinctiveness and (once
    --apply downloads it twice under two town-prefixed filenames) leaves no
    trace in config/this-week-images.ts that it ever happened -- see that
    file's own sourcePhotoId field, added for exactly this check and its
    vitest-side twin (this-week-images.test.ts)."""
    conflicts: dict[int, str] = {}
    for other in TOWNS:
        if other == town:
            continue
        sidecar = MONTAGE_DIR / f"{other}-{season}-chosen.json"
        if not sidecar.exists():
            continue
        import json
        other_ids = {c["id"] for c in json.loads(sidecar.read_text(encoding="utf-8"))}
        for pid in candidate_ids & other_ids:
            conflicts[pid] = other
    return conflicts


def _select_report(town: str, season: str, indices: list[int]) -> tuple[bool, list[dict]]:
    """Resolves comma-separated FINAL-montage indices to {"id","bucket"}
    picks, validates against the brief's own rules, writes the sidecar
    --apply reads, and prints a report. Returns (ok, chosen)."""
    manifest = _load_manifest(town, season, "final")
    if not manifest:
        print(f"  [{town}/{season}] no final manifest -- run --final first")
        return False, []
    by_index = {m["index"]: m for m in manifest}
    review = ROUND1_REVIEW.get((town, season), {"rejected": [], "kept": []})
    rejected = set(review["rejected"])

    chosen: list[dict] = []
    seen_ids: set[int] = set()
    for idx in indices:
        entry = by_index.get(idx)
        if entry is None:
            print(f"  ERROR: index #{idx} does not exist in the final montage (0-{len(manifest) - 1})")
            return False, []
        if entry["id"] in rejected:
            print(f"  ERROR: index #{idx} (id={entry['id']}) is on the rejected list -- it should not be "
                  f"in the final montage at all; re-run --final after updating ROUND1_REVIEW")
            return False, []
        if entry["id"] in seen_ids:
            print(f"  WARNING: index #{idx} (id={entry['id']}) selected more than once -- skipping duplicate")
            continue
        seen_ids.add(entry["id"])
        chosen.append({"id": entry["id"], "bucket": entry["bucket"]})

    cross_town = _cross_town_duplicate_ids(town, season, seen_ids)
    if cross_town:
        for pid, other in sorted(cross_town.items()):
            print(f"  ERROR: id={pid} is already chosen for \"{other}\" -- pools must be disjoint across "
                  f"towns (the same Pexels photo may only be used by ONE town). Pick a different candidate "
                  f"or run {other}'s --select again to drop it there first.")
        return False, []

    total = len(chosen)
    counts = {"built": 0, "nature": 0, "life": 0}
    for c in chosen:
        counts[c["bucket"]] += 1
    pct = {k: (round(100 * v / total) if total else 0) for k, v in counts.items()}

    print(f"  [{town}/{season}] selected {total} image(s): "
          f"built={counts['built']} ({pct['built']}%) nature={counts['nature']} ({pct['nature']}%) "
          f"life={counts['life']} ({pct['life']}%)")

    ok = True
    if total < MIN_POOL_SIZE:
        print(f"  ERROR: {total} < required minimum {MIN_POOL_SIZE} -- not enough to apply yet")
        ok = False
    elif total < 15 or total > 16:
        print(f"  NOTE: {total} is outside the 15-16 target range (still valid -- {MIN_POOL_SIZE} is the hard floor)")
    if pct["built"] < 40:
        print(f"  WARNING: built is {pct['built']}% (<40% target)")
    if pct["life"] < 10:
        print(f"  WARNING: life is {pct['life']}% (<10% target)")

    import json
    sidecar = MONTAGE_DIR / f"{town}-{season}-chosen.json"
    sidecar.write_text(json.dumps(chosen, indent=1), encoding="utf-8")
    print(f"  -> wrote {sidecar} ({'ready for --apply' if ok else 'NOT ready -- fix and re-run --select'})")
    return ok, chosen


def build_round2_montage(town: str, season: str, pexels_key: str, ocr_ready: bool) -> Path | None:
    review = ROUND1_REVIEW.get((town, season), {"rejected": [], "kept": []})
    kept_ids_with_bucket: list[tuple[int, str]] = review["kept"]
    already_decided = set(review["rejected"]) | {pid for pid, _ in kept_ids_with_bucket}

    kept_entries: list[tuple[str, dict]] = []
    for pid, bucket in kept_ids_with_bucket:
        photo = pexels_get_photo(pid, pexels_key)
        kept_entries.append((bucket, photo))

    shortfall = max(0, ROUND2_TARGET - len(kept_ids_with_bucket))
    # A real buffer above the bare shortfall -- some new candidates will
    # themselves get rejected on review, same as round 1's did.
    new_entries = _fetch_new_bucket_candidates(town, season, pexels_key, already_decided)
    if shortfall > 0:
        new_entries = new_entries[: max(shortfall + 6, len(new_entries))]

    candidates = kept_entries + new_entries
    if not candidates:
        print(f"  [{town}/{season}] no candidates (nothing kept, no new results)")
        return None

    kept_ids = {pid for pid, _ in kept_ids_with_bucket}
    out_path, stats = _build_grid(town, season, "round2", candidates, kept_ids, ocr_ready)
    print(
        f"  [{town}/{season}] round-2 montage -> {out_path} "
        f"({stats['total']} candidates: {len(kept_entries)} kept + {len(new_entries)} new; "
        f"built={stats['counts']['built']} nature={stats['counts']['nature']} life={stats['counts']['life']}; "
        f"{stats['flagged']} flagged [TEXT])"
        + ("" if ocr_ready else " -- OCR UNAVAILABLE, no [TEXT] flags were possible this run")
    )
    return out_path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--montage", action="store_true")
    ap.add_argument("--round2", action="store_true", help="Build round-2 montages (kept + new candidates, OCR-flagged).")
    ap.add_argument("--round3-life", action="store_true", help="Build round-3 life-only montages (kept life survivors + new life candidates, OCR-flagged).")
    ap.add_argument("--final", action="store_true", help="Merge round-2 survivors + round-3 life into one renumbered final montage per town (what --select's indices refer to).")
    ap.add_argument("--select", nargs=2, metavar=("TOWN", "INDICES"), help="Resolve comma-separated final-montage indices to a chosen list, validate, and write the --apply sidecar. E.g. --select brookings_sd \"2,5,7,9\"")
    ap.add_argument("--only", nargs=2, metavar=("TOWN", "SEASON"))
    args = ap.parse_args()

    pexels_key = os.environ.get("PEXELS_API_KEY")

    if args.select:
        town, indices_str = args.select
        season = "autumn"  # only season under active review so far
        try:
            indices = [int(x.strip()) for x in indices_str.split(",") if x.strip()]
        except ValueError:
            print(f"Could not parse indices from {indices_str!r} -- expected e.g. \"2,5,7,9\"")
            return 1
        ok, _chosen = _select_report(town, season, indices)
        return 0 if ok else 1

    if args.only and args.apply:
        print("--only cannot be combined with --apply -- same reasoning as "
              "source_category_images.py's identical guard (a partial run would "
              "silently drop every other town/season's pool on write-back).")
        return 1

    keys = list(BUCKET_QUERIES.keys())
    if args.only:
        key = (args.only[0], args.only[1])
        if key not in BUCKET_QUERIES:
            print(f"Unknown (town, season): {key}")
            return 1
        keys = [key]

    if args.round2:
        if not pexels_key:
            print("PEXELS_API_KEY not set -- can't build montages.")
            return 1
        ocr_ready = _ocr_available()
        for town, season in keys:
            if (town, season) not in ROUND1_REVIEW:
                print(f"  [{town}/{season}] no round-1 review recorded -- use --montage instead")
                continue
            build_round2_montage(town, season, pexels_key, ocr_ready)
        return 0

    if args.round3_life:
        if not pexels_key:
            print("PEXELS_API_KEY not set -- can't build montages.")
            return 1
        ocr_ready = _ocr_available()
        for town, season in keys:
            if (town, season) not in ROUND1_REVIEW:
                print(f"  [{town}/{season}] no round-1 review recorded -- use --montage/--round2 first")
                continue
            build_round3_life_montage(town, season, pexels_key, ocr_ready)
        return 0

    if args.final:
        if not pexels_key:
            print("PEXELS_API_KEY not set -- can't build montages.")
            return 1
        for town, season in keys:
            build_final_montage(town, season, pexels_key)
        return 0

    if args.montage:
        if not pexels_key:
            print("PEXELS_API_KEY not set -- can't build montages.")
            return 1
        for town, season in keys:
            candidates = _fetch_new_bucket_candidates(town, season, pexels_key, set())
            if not candidates:
                print(f"  [{town}/{season}] no Pexels results for any bucket query")
                continue
            counts = {b: sum(1 for bb, _ in candidates if bb == b) for b in BUCKETS}
            thumbs = []
            for bucket, p in candidates:
                img_resp = requests.get(p["src"]["medium"], timeout=30)
                img_resp.raise_for_status()
                thumb = Image.open(BytesIO(img_resp.content)).convert("RGB")
                thumbs.append((bucket, p, _resize_cover(thumb, 360, 240)))
            cols = 4
            rows = (len(thumbs) + cols - 1) // cols
            cell_w, cell_h, caption_h = 360, 240, 24
            grid = Image.new("RGB", (cols * cell_w, rows * (cell_h + caption_h)), "white")
            draw = ImageDraw.Draw(grid)
            for i, (bucket, p, thumb) in enumerate(thumbs):
                x, y = (i % cols) * cell_w, (i // cols) * (cell_h + caption_h)
                grid.paste(thumb, (x, y))
                caption = f"#{i} [{bucket}] id={p['id']} {p['photographer'][:16]}"
                draw.rectangle([x, y + cell_h, x + cell_w, y + cell_h + caption_h], fill=BUCKET_COLOR[bucket])
                draw.text((x + 4, y + cell_h + 4), caption, fill="white")
            MONTAGE_DIR.mkdir(exist_ok=True)
            out_path = MONTAGE_DIR / f"{town}-{season}.png"
            grid.save(out_path, format="PNG")
            print(
                f"  [{town}/{season}] montage -> {out_path} "
                f"({len(thumbs)} candidates: built={counts['built']} nature={counts['nature']} life={counts['life']})"
            )
        return 0

    if not args.apply:
        print("DRY RUN -- searching for each town/season/bucket, printing candidates.\n")
        if not pexels_key:
            print("PEXELS_API_KEY not set -- search skipped.\n")
        for town, season in keys:
            print(f"[{town}/{season}]")
            if pexels_key:
                for bucket, photo in _fetch_new_bucket_candidates(town, season, pexels_key, set()):
                    print(f"    [{bucket}] id={photo['id']} by {photo['photographer']} -> {photo['url']}")
            chosen = SEASON_SEARCHES[(town, season)]["chosen"]
            print(f"  -> chosen: {len(chosen)} image(s)" if chosen else "  -> NOT YET REVIEWED")
            print()
        print("Dry run only. Use --montage (first pass) or --round2 (after a prior ROUND1_REVIEW "
              "entry exists) to build review grids, fill in SEASON_SEARCHES['chosen'] "
              "(list of {\"id\": int, \"bucket\": \"built\"|\"nature\"|\"life\"} dicts, "
              f"at least {MIN_POOL_SIZE} per season), then --apply.")
        return 0

    # Pull in anything --select wrote to a sidecar (.review_montages/{town}-
    # {season}-chosen.json) -- this is how a reviewed pick actually reaches
    # --apply without hand-editing SEASON_SEARCHES's Python literal.
    import json
    for town, season in keys:
        if SEASON_SEARCHES[(town, season)]["chosen"]:
            continue
        sidecar = MONTAGE_DIR / f"{town}-{season}-chosen.json"
        if sidecar.exists():
            SEASON_SEARCHES[(town, season)]["chosen"] = json.loads(sidecar.read_text(encoding="utf-8"))

    # 2026-10-06 review instruction: a plain `--apply` (no --only) used to
    # hard-refuse the ENTIRE run the moment ANY (town, season) in
    # BUCKET_QUERIES had fewer than MIN_POOL_SIZE picks -- correct while
    # every season was reviewed together, but autumn is reviewed first here
    # and winter/spring/summer have never been started at all (0 picks, no
    # sidecar, nothing to lose). `--only` can't fix this (deliberately
    # blocked above, same reasoning as ever: a partial run must never
    # silently drop an ALREADY-reviewed town/season from the config on
    # write-back). The actual safety property that guard protects is
    # narrower than "every key must be ready" -- it's "never touch fewer
    # keys than the ones that already have real reviewed content" -- so a
    # season with NO sidecar at all (never attempted, nothing to regress)
    # is simply excluded from this run instead of blocking it. A season
    # that WAS reviewed and has since fallen below the floor still refuses,
    # same as before -- this only skips the ones that were always empty.
    if not args.only:
        keys = [k for k in keys if (MONTAGE_DIR / f"{k[0]}-{k[1]}-chosen.json").exists()]

    unresolved = [k for k in keys if len(SEASON_SEARCHES[k]["chosen"]) < MIN_POOL_SIZE]
    if unresolved:
        print(f"Refusing to --apply: these town/seasons have fewer than {MIN_POOL_SIZE} reviewed picks:")
        for town, season in unresolved:
            print(f"  - {town}/{season}: {len(SEASON_SEARCHES[(town, season)]['chosen'])}")
        return 1

    # Final disjointness safety net: --select already checks this at
    # curation time (see _cross_town_duplicate_ids), but SEASON_SEARCHES can
    # also be populated by hand-editing its Python literal directly (see
    # that dict's own comment) -- which bypasses --select entirely, so this
    # re-checks across every (town, season) actually being applied in THIS
    # run, not just against already-written sidecars.
    id_owner: dict[int, tuple[str, str]] = {}
    duplicate_problems: list[str] = []
    for town, season in keys:
        for choice in SEASON_SEARCHES[(town, season)]["chosen"]:
            pid = choice["id"]
            if pid in id_owner and id_owner[pid][1] == season:
                owner_town, _ = id_owner[pid]
                duplicate_problems.append(f"id={pid} chosen for both \"{owner_town}\" and \"{town}\" ({season})")
            else:
                id_owner[pid] = (town, season)
    if duplicate_problems:
        print(f"Refusing to --apply: pools must be disjoint across towns ({len(duplicate_problems)} conflict(s)):")
        for p in duplicate_problems:
            print(f"  - {p}")
        return 1

    lines: list[str] = []
    for town, season in keys:
        entry = SEASON_SEARCHES[(town, season)]
        alt = ALT_TEXT[(town, season)]
        bucket_counts = {"built": 0, "nature": 0, "life": 0, "unlabeled": 0}
        for i, choice in enumerate(entry["chosen"], start=1):
            photo = pexels_get_photo(choice["id"], pexels_key)
            image_id = f"{town}-{season}-{i:02d}"
            out_path = IMAGES_DIR / f"{image_id}.png"
            print(f"[{town}/{season}] downloading Pexels photo {choice['id']} ({i}/{len(entry['chosen'])}) -> {image_id} ...")
            _download_and_save_pexels(photo, out_path)
            out_path = _compress_to_jpeg(out_path)
            web_path = "/" + str(out_path.relative_to("site/public")).replace("\\", "/")
            bucket_counts[choice.get("bucket", "unlabeled")] += 1
            lines.append(
                "  { id: " + repr(image_id) + ", path: " + repr(web_path) + ", alt: " + repr(alt) +
                ", width: 1200, height: 800, attributionText: " +
                repr(f"Photo by {photo['photographer']} on Pexels") +
                ", attributionUrl: " + repr(photo["photographer_url"]) +
                ", seasons: [" + repr(season) + "], town_ids: [" + repr(town) + "]" +
                ", sourcePhotoId: " + str(choice["id"]) + " },"
            )
        total = len(entry["chosen"])
        pct = {k: (round(100 * v / total) if total else 0) for k, v in bucket_counts.items()}
        print(
            f"  [{town}/{season}] approved mix: built={bucket_counts['built']} ({pct['built']}%) "
            f"nature={bucket_counts['nature']} ({pct['nature']}%) life={bucket_counts['life']} ({pct['life']}%)"
            + (f" unlabeled={bucket_counts['unlabeled']}" if bucket_counts["unlabeled"] else "")
        )

    _write_config(lines, set(keys))
    print(f"\nWrote {CONFIG_TS}")
    return 0


# Matches ONE generated entry's own town_ids/seasons literals -- see the
# `lines.append(...)` call above for the exact text this reads back
# (always exactly one town, one season per entry, in this fixed order).
_ENTRY_TOWN_SEASON_RE = re.compile(r"seasons: \['([a-z]+)'\], town_ids: \['([a-z_]+)'\]")


def _write_config(entry_lines: list[str], touched_keys: set[tuple[str, str]]) -> None:
    """Merges `entry_lines` (freshly generated for `touched_keys`) into the
    EXISTING config file's THIS_WEEK_IMAGES array, rather than replacing the
    whole array -- 2026-10-06 review instruction + fix: the previous version
    blindly overwrote the entire array with only whatever this one run
    processed, which happened to "work" so far only because every
    previously-applied season's own {town}-{season}-chosen.json sidecar was
    still sitting on disk in .review_montages/ (so a plain `--apply` always
    re-included every season ever applied). Once that directory is
    gitignored (as instructed) and absent from a fresh checkout/CI run, a
    later `--apply --only ... winter` run would have silently DROPPED every
    autumn entry instead of leaving it alone -- confirmed by this file's own
    test (test_apply_preserves_other_seasons in
    scripts/test_source_this_week_images.py).
    Now: read the file's EXISTING entries, keep every one whose OWN
    (season, town) is NOT in `touched_keys`, and replace the rest with the
    newly generated `entry_lines` -- the file itself is the source of truth
    for what's already applied, not a scratch sidecar that may not exist."""
    text = CONFIG_TS.read_text(encoding="utf-8")
    marker_start = "export const THIS_WEEK_IMAGES: ThisWeekImage[] = ["
    marker_end = "];"
    start = text.index(marker_start) + len(marker_start)
    end = text.index(marker_end, start)
    existing_body = text[start:end]

    preserved: list[str] = []
    for raw_line in existing_body.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        m = _ENTRY_TOWN_SEASON_RE.search(line)
        if m is None:
            # Not a recognized entry shape -- keep it rather than silently
            # drop it (e.g. a hand-edited line); _apply would still catch a
            # genuinely malformed entry at `astro check` time.
            preserved.append(line)
            continue
        season, town = m.group(1), m.group(2)
        if (town, season) not in touched_keys:
            preserved.append(line)

    new_body = "\n" + "\n".join(preserved + entry_lines) + "\n"
    CONFIG_TS.write_text(text[:start] + new_body + text[end:], encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
