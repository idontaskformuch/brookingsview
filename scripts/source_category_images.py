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
# How many images to actually keep per category pool -- raised from 3
# (module docstring's original target) per the image-pool-rotation
# follow-up (Addendum 2, 2026-09-09): a real incrementing rotation
# (ai_pipeline/assign_category_image_rotation.py) makes a bigger pool
# actually pay off in visible variety, where a 3-image pool mostly didn't.
# Not every category reaches 6 -- see CATEGORY_SEARCHES' own per-category
# comments for where fewer genuine real candidates were found; a smaller
# honest pool beats padding with a borderline match, same principle the
# original 2-image Moreno Valley "events" pool already established.
POOL_SIZE = 6

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
# Addendum 2 (2026-09-09): pool expansion from 3 to (up to) 6, reviewed via
# --montage at the new per_page=24 (see build_montage()'s own comment).
# Same rejection bar as the original pass throughout: no real identifiable
# faces, no readable text/signage naming a real specific place, no visible
# brand/company logos or manufacturer nameplates, no foreign-coded
# architecture/flags/language, no famous/identifiable landmark. Several
# categories (Moreno Valley city_hall/events/school_alerts especially)
# still didn't reach 6 -- their own per-category comments below say why;
# a smaller honest pool over a padded risky one, same rule as before.
CATEGORY_SEARCHES: dict[tuple[str, str], CategorySearch] = {
    ("brookings_sd", "city_hall"): {"query": "small town city hall brick building", "chosen": _pool(38855972, 37485219, 37469663, 38855973, 14456574)},
    # Addendum 2: 3 of the 4 montage-thumbnail picks failed the mandatory
    # FULL-RESOLUTION recheck this file already requires (see city_hall/
    # traffic notes above) -- a parade truck with "MAYO CLINIC" branding
    # clearly readable (a specific, nationally-recognized real institution
    # -- also reads as a specific real place's parade, not generic), a
    # Revolutionary War-reenactment scene in an unmistakably New-England-
    # coded setting with several close, identifiable faces, and a food-
    # truck scene with a large readable Pepsi logo plus several more close,
    # identifiable faces. Only the aerial downtown-plaza shot (34003747,
    # crowd too small/distant to be identifiable, no readable signage)
    # survived. Lesson already stated elsewhere in this file, worth
    # restating: a montage thumbnail (360x240) cannot resolve a brand logo,
    # a readable sign, or whether a face is actually identifiable --
    # crowd/parade/market photography specifically needs the full-res
    # check applied to EVERY candidate, not just aerial/wide ones.
    ("brookings_sd", "events"): {"query": "small town street festival community", "chosen": _pool(10148954, 10130178, 8839417, 34003747)},
    ("brookings_sd", "home_sales"): {"query": "midwest suburban houses tree lined street", "chosen": _pool(38211756, 8148346, 5846801, 19278016, 1546166, 33711126, 2758265)},
    # Addendum 2: 2 of the 5 montage picks failed the FULL-RESOLUTION
    # recheck -- 221369 had a manufacturer nameplate ("BROCK") clearly
    # readable on the bin, same class of rejection as the original pass's
    # "BUTLER"/"AGI WESTFIELD" catches; 16959340's brick construction and
    # roof-tile style read as Northern European, not American Midwest, on
    # closer inspection.
    ("brookings_sd", "jobs"): {"query": "grain elevator silo farm building", "chosen": _pool(33406024, 2714630, 12380134, 10274179, 3753794, 4093909)},
    # Addendum 2: 15362139 looked like generic lit bleachers at montage
    # thumbnail size; at full resolution it's an enormous professional
    # soccer stadium in a Spanish-speaking country (readable Spanish
    # advertising banners, e.g. "IGLESIAS FRATERNAS") -- dropped.
    ("brookings_sd", "sports"): {"query": "high school football stadium bleachers", "chosen": _pool(13345801, 13345803, 13345751, 13345808, 30903546, 4680027, 13345794)},
    # Addendum 2: 3 of the 4 montage picks failed the mandatory FULL-
    # RESOLUTION recheck -- one had "FARMINGTON HIGH SCHOOL" (plus a
    # "Farmington RiverHawks" banner) clearly readable on the facade, a
    # specific real school invisible at 360x240 thumbnail size; two others
    # had no readable text but unmistakably non-US institutional
    # architecture (South African-style terracotta roof tiles and louvered
    # windows; a worn concrete facade matching neither US school
    # convention). Only one (5896843, a US-style brick school with a track)
    # survived.
    ("brookings_sd", "school_alerts"): {"query": "elementary school building exterior", "chosen": _pool(35758714, 18145430, 17144608, 5896843)},
    # 5387516 (a lightning-over-farmhouse shot, initially chosen from the
    # montage) had been deleted from Pexels entirely by the time --apply
    # ran minutes later -- confirmed 404 on direct lookup AND absent from a
    # fresh search, not a transcription error. Dropped rather than
    # substituted; 6 is still a healthy pool.
    ("brookings_sd", "weather_alert"): {"query": "prairie storm clouds sky", "chosen": _pool(30068845, 4824517, 29383810, 10831793, 13021192, 2753471)},
    # Addendum 2: this query is even more landmark-dominated than the
    # original pass already found -- 3 of 4 montage picks failed the
    # FULL-RESOLUTION recheck (an ornate collegiate-gothic dormitory too
    # grand/specific to pass as generic; a building with a bronze memorial
    # bust and named plaque, clearly a real, specific historic building; a
    # monumental single clock tower distinctive enough to likely be a real
    # named campus landmark on its own). Only one genuinely generic,
    # low-detail campus-lawn shot survived.
    ("brookings_sd", "university"): {"query": "university campus lawn trees buildings", "chosen": _pool(7752993, 27276232, 36725428, 16275762)},
    # Addendum 2: this query is dominated by nationally-iconic, unmistakably
    # identifiable landmarks (Beverly Hills City Hall's own gold-domed
    # tower appeared TWICE more in the 24-candidate re-search, LA City
    # Hall's own unmistakable tower, downtown LA's skyline, the California
    # State Capitol twice, San Diego's Convention Center) -- exactly the
    # "far too identifiable AND badly mismatched in scale for a city Moreno
    # Valley's size" problem the original 3 picks already had to route
    # around with a v2 query. The one candidate that looked generic at
    # montage size (palm trees, no building landmark) turned out at full
    # resolution to closely match Stanford's own iconic palm-lined campus
    # silhouette (matching red-tile roofs, a distant bell-tower-like
    # structure) -- dropped too. Shipping the original 3 rather than
    # forcing a risky pick just to hit a bigger number.
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
    #
    # Addendum 2: re-searched at per_page=24 specifically to grow this one
    # past 2 -- most of the 24 were still foreign/ambiguous-origin bazaars
    # (Turkish, Indonesian, Vietnamese, Middle Eastern market scenes). Two
    # ground-level vendor shots (1635330, 1151058) looked fine at MONTAGE
    # thumbnail size but failed the mandatory FULL-RESOLUTION recheck this
    # same file already requires elsewhere (see the city_hall/traffic notes
    # above) -- both turned out to show one real, clearly identifiable
    # person's face prominently and in sharp focus (one also had a
    # readable non-English tablecloth banner, the other a readable
    # specific business name, "Safari Farm...", on its own tent banner) --
    # dropped. A third vendor shot (9650047) survived: the vendor's face is
    # substantially obscured by a mask and greater distance, closer to the
    # existing pool's own "flag-bearer shot from behind" risk tolerance
    # than a posed close-up portrait.
    ("moreno_valley_ca", "events"): {
        "query": "aerial farmers market outdoor community booths",
        "chosen": _pool(30391784, 35120074, 33273893, 9650047)
            + _pool(29332592, query="american flag community parade street aerial daytime"),
    },
    # Addendum 2: 15461302 (a real-estate-listing-style photo) had a
    # visible house number plate on the facade -- a genuine street address,
    # not just a generic architectural style, dropped on the FULL-
    # RESOLUTION recheck this file already requires elsewhere.
    ("moreno_valley_ca", "home_sales"): {"query": "suburban stucco houses tile roof california", "chosen": _pool(34960819, 17613793, 11467685, 29837542, 17375721, 9875677)},
    # Addendum 2: 2 of 5 montage picks failed the FULL-RESOLUTION recheck --
    # 35501715 had a partial blue/white trailer logo matching Amazon's own
    # livery closely enough to risk the same "real tracked employer" issue
    # the original pass's own Amazon rejection already established; 221047
    # showed a European cab-over-style semi truck, not a US long-nose
    # tractor, reading as a non-US facility.
    ("moreno_valley_ca", "jobs"): {"query": "warehouse distribution center exterior", "chosen": _pool(36006588, 29298971, 12585837, 20021122, 2804929, 34968619)},
    # Addendum 2: 2 of 5 montage picks failed the FULL-RESOLUTION recheck --
    # 34424817's background scoreboard clearly reads "RAVSTED STADIUM", a
    # specific real venue name; 34010498 has a jersey reading "BEARCATS"
    # plus a "PRIDE" paw-print wall banner, the same class of specific-
    # school-identification rejection as "KNIGHTS"/"SAN MATEO BULLDOGS"
    # already caught on the montage pass.
    ("moreno_valley_ca", "sports"): {"query": "american high school football field night lights california", "chosen": _pool(13345835, 9935427, 9935434, 13345832, 13345808, 13345799)},
    # Addendum 2: this query's re-search (24 candidates) was almost
    # entirely posed stock photography of children's faces in close-up --
    # exactly the "real children's faces in close-up ... skipped even where
    # not textually identifiable" rule the original pass already
    # established (see CATEGORY_SEARCHES' own top-of-dict comment). Of the
    # 2 that showed no children at all, one (37820241, a building exterior)
    # turned out on FULL-RESOLUTION recheck to be "FARMINGTON HIGH SCHOOL"
    # -- a specific real school, readable on its facade -- and was dropped
    # (see brookings_sd's own school_alerts comment, where the same id was
    # caught the same way). Only the empty-hallway shot survived.
    ("moreno_valley_ca", "school_alerts"): {"query": "american elementary school building exterior", "chosen": _pool(8500417, 10127243, 10127241, 35758714)},
    # Addendum 2: 2 of 4 montage picks failed the FULL-RESOLUTION recheck --
    # 37108200's utility-pole style and terrain read as Central Asian/
    # Middle Eastern, not California desert; 25526060's tanker trailer had
    # readable ad-campaign text ("...COWS", a real dairy-industry slogan).
    ("moreno_valley_ca", "weather_alert"): {"query": "desert heat haze highway sky", "chosen": _pool(13973966, 9898541, 2450291, 5996410, 13064248)},
    # Addendum 2: 3 of 4 montage picks failed the FULL-RESOLUTION recheck --
    # 8783598's skyline includes a distinctive tiered white hospital tower
    # matching LAC+USC Medical Center closely enough to risk identifying a
    # specific real interchange; 13178602's double-roundabout "dumbbell"
    # interchange design is a European road-engineering pattern, not
    # typical California cloverleaf/diamond style; 3717242 has Chinese
    # characters clearly readable in the road markings.
    ("moreno_valley_ca", "traffic"): {
        "query": "freeway interchange overpass california",
        "chosen": _pool(8783583, 9716239, 9716238) + _pool(9716230, query="suburban freeway highway traffic cars aerial"),
    },
    # Addendum 2: 4 of 5 montage picks failed the FULL-RESOLUTION recheck --
    # 2800121's painted no-stopping pictograms are a European road-marking
    # convention, not used in the US; 257636 shows the same European
    # cab-over-style semi already rejected once for this town's jobs
    # category; 2449454 is unambiguously Tesla's real Fremont Factory
    # ("Welcome to Fremont Factory", "TESLA GATE 8" both clearly readable
    # -- a specific, named real company facility, the most severe class of
    # miss this whole pass found); 7267443 is blanketed in snow, a climate
    # Moreno Valley's actual desert-adjacent Southern California setting
    # never sees. Only one generic shipping-yard shot survived.
    ("moreno_valley_ca", "workplace_watch"): {"query": "warehouse loading dock semi trucks", "chosen": _pool(35501716, 1267325, 27099093, 29348624)},
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


def pexels_get_photo(photo_id: int, api_key: str) -> dict:
    """Direct single-photo lookup -- used by --apply instead of re-searching
    and hoping a previously-chosen id is still ranked in the top N. Pexels'
    own search ranking drifts over time (confirmed live, Addendum 2,
    2026-09-09: brookings_sd/city_hall's own original #1 pick, chosen and
    downloaded weeks earlier, had fallen out of its query's top 24 results
    entirely) -- a chosen id, once downloaded, must stay resolvable forever
    regardless of where the query later ranks it."""
    resp = requests.get(
        f"https://api.pexels.com/v1/photos/{photo_id}",
        headers={"Authorization": api_key},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def unsplash_get_photo(photo_id: str, access_key: str) -> dict:
    """Direct single-photo lookup -- see pexels_get_photo()'s own comment
    for why --apply uses this instead of re-searching."""
    resp = requests.get(
        f"https://api.unsplash.com/photos/{photo_id}",
        headers={"Authorization": f"Client-ID {access_key}", "Accept-Version": "v1"},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


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
    # 24, not the original 8 -- Addendum 2 grows pools from 3 to up to 6,
    # which needs real NEW candidates beyond the ones already `chosen`
    # (Pexels' search results are stable per query, so a re-run against the
    # same query at the old per_page=8 would show only already-decided
    # candidates, nothing to grow the pool with).
    photos = pexels_search(entry["query"], pexels_key, per_page=24)
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

    cols = 4
    rows = (len(thumbs) + cols - 1) // cols
    cell_w, cell_h, caption_h = 360, 240, 24
    grid = Image.new("RGB", (cols * cell_w, rows * (cell_h + caption_h)), "white")
    draw = ImageDraw.Draw(grid)
    already_chosen_ids = {c["id"] for c in entry.get("chosen", []) if c.get("source", "pexels") == "pexels"}
    for i, (p, thumb) in enumerate(thumbs):
        x, y = (i % cols) * cell_w, (i // cols) * (cell_h + caption_h)
        grid.paste(thumb, (x, y))
        mark = "[IN POOL] " if p["id"] in already_chosen_ids else ""
        caption = f"#{i} {mark}id={p['id']} {p['photographer'][:20]}"
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

        for i, choice in enumerate(entry["chosen"], start=1):
            source, ident = choice["source"], choice["id"]
            if source == "pexels":
                if not pexels_key:
                    raise RuntimeError("PEXELS_API_KEY required for a pexels selection")
                photo = pexels_get_photo(ident, pexels_key)
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
                photo = unsplash_get_photo(ident, unsplash_key)
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
