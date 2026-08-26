"""Generates the venue and category illustrations for Venue & Category Image
Identity (see NEEDS-HUMAN-REVIEW.md §35, site/src/lib/images.ts). One image
per landmark venue, one per category, per town -- reused everywhere, never
regenerated per article.

Reuses the exact same fal.ai call mechanics as
content/illustrations/generate_illustration.py (same env var, same request
shape, same "images[0].url then download" flow) -- deliberately NOT that
module's STYLE_PROMPTS/IMAGE_WIDTH/IMAGE_HEIGHT, which are the content
track's own separate photorealistic style at 1600x900. This is a distinct,
flat-vector style at 1200x800 (3:2), the base prompt kept in
scripts/prompts/venue_style.txt so a single image can be regenerated later
without hunting the shared style text back out of this file.

Output paths (see site/src/lib/images.ts's own path convention):
  site/public/assets/images/venues/<town>-<slug>.png
  site/public/assets/images/categories/<town>-<category>.png

After generating, writes:
  - facilities.image_path/image_alt for each venue (DB UPDATE)
  - site/src/config/category-images.ts (CATEGORY_IMAGES literal, rewritten
    with the real paths -- see that file's own "intentionally empty until
    real assets exist" comment, now no longer true after --apply)

COST WARNING: real fal.ai calls, one per motif (~23 total). Requires
explicit authorization -- see this project's established discipline for
paid generation calls. Default is a dry run (prints the full motif list and
prompts, calls nothing); pass --apply to actually generate and write.

Usage:
    python -m scripts.generate_venue_category_images            # dry run
    python -m scripts.generate_venue_category_images --apply    # generates + writes
"""
from __future__ import annotations

import argparse
import os
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import requests
from PIL import Image

from db.db import get_conn

IMAGE_WIDTH = 1200
IMAGE_HEIGHT = 800
MODEL_ID = "fal-ai/flux/dev"  # same provider/model as the content track, see config/image_model.py
REQUEST_TIMEOUT = 60

STYLE_PROMPT_PATH = Path(__file__).parent / "prompts" / "venue_style.txt"

VENUES_DIR = Path("site/public/assets/images/venues")
CATEGORIES_DIR = Path("site/public/assets/images/categories")
CATEGORY_IMAGES_TS = Path("site/src/config/category-images.ts")

# --- motif list (see NEEDS-HUMAN-REVIEW.md §35's §7 art-direction section) --
# (town, facility_slug) -> (motif clause, alt text). alt text is the REAL,
# descriptive alt lib/images.ts's resolveImage() falls back to when a
# facility has no hand-authored image_alt of its own -- written here as the
# authored value, never the "Illustration for ..." pattern.
VENUE_MOTIFS: dict[tuple[str, str], tuple[str, str]] = {
    ("moreno_valley_ca", "city-hall"): (
        "Moreno Valley City Hall: a modern low-rise civic building with a flat "
        "roof and rows of windows, palm trees along the entrance walkway, the "
        "Box Springs Mountains and its hillside landmark visible on the horizon",
        "Moreno Valley City Hall, with the Box Springs Mountains on the horizon.",
    ),
    ("moreno_valley_ca", "main-library"): (
        "a single-story modern public library building with a covered entrance "
        "and large windows, xeriscaped desert landscaping with agave and "
        "decomposed granite, the Box Springs Mountains visible in the distance",
        "Moreno Valley's Main Library on Alessandro Boulevard.",
    ),
    ("moreno_valley_ca", "mall-branch-library"): (
        "a small storefront library branch inside a suburban shopping-center "
        "facade, covered walkway with columns, palm trees, flat high-desert "
        "skyline",
        "Moreno Valley's Mall branch library.",
    ),
    ("moreno_valley_ca", "iris-plaza-branch-library"): (
        "a small strip-mall branch library storefront beside a covered "
        "walkway, desert landscaping, distant low hills",
        "Moreno Valley's Iris Plaza branch library.",
    ),
    ("brookings_sd", "city-hall"): (
        "a Midwestern brick civic building with a flat prairie horizon behind "
        "it, an American flag on a pole, bare trees and open sky",
        "Brookings City Hall, on the South Dakota prairie.",
    ),
    ("brookings_sd", "public-library"): (
        "a modern brick-and-glass public library building on a small-town "
        "Main Street, open prairie sky, a bicycle rack out front",
        "Brookings Public Library.",
    ),
}

# (town, category) -> (motif clause, alt text).
CATEGORY_MOTIFS: dict[tuple[str, str], tuple[str, str]] = {
    ("moreno_valley_ca", "city_hall"): (
        "a generic Inland Empire civic building, flat-roofed municipal "
        "architecture, flagpoles, palm trees, the Box Springs Mountains on "
        "the horizon",
        "Civic buildings in Moreno Valley.",
    ),
    ("moreno_valley_ca", "events"): (
        "a small outdoor community gathering in a plaza at midday, distant "
        "silhouetted figures, palm trees, plain banners with no lettering",
        "Community events in Moreno Valley.",
    ),
    ("moreno_valley_ca", "traffic"): (
        "a freeway interchange with multiple overpasses, palm trees along the "
        "shoulder, distant mountains, no signage",
        "Freeway traffic in Moreno Valley.",
    ),
    ("moreno_valley_ca", "home_sales"): (
        "a row of single-story stucco suburban houses with tile roofs and "
        "desert-friendly front yards on a quiet residential street",
        "Residential homes in Moreno Valley.",
    ),
    ("moreno_valley_ca", "jobs"): (
        "the exterior of a large warehouse and logistics distribution "
        "building with loading docks, flat desert landscape, distant hills",
        "Warehouse and logistics employers in Moreno Valley.",
    ),
    ("moreno_valley_ca", "sports"): (
        "a small-town athletic field with bleachers, distant silhouetted "
        "players, floodlight poles, open sky",
        "Regional sports in the Moreno Valley area.",
    ),
    ("moreno_valley_ca", "school_alerts"): (
        "a single-story school building exterior with a covered walkway and "
        "flagpole, palm trees",
        "Schools in Moreno Valley.",
    ),
    ("moreno_valley_ca", "weather_alert"): (
        "a desert sky with visible heat haze over a flat highway, distant "
        "mountains, warm tones",
        "Weather conditions in Moreno Valley.",
    ),
    ("moreno_valley_ca", "workplace_watch"): (
        "a warehouse and logistics loading-dock exterior at midday, semi "
        "trucks parked at the dock with no branding visible, flat desert "
        "landscape",
        "Warehouse and logistics workplaces in Moreno Valley.",
    ),
    ("brookings_sd", "city_hall"): (
        "a Midwestern brick municipal building, flat prairie horizon, a grain "
        "elevator silhouette in the distance",
        "Civic buildings in Brookings.",
    ),
    ("brookings_sd", "events"): (
        "a small town square gathering at midday, string lights, distant "
        "silhouetted figures, brick storefronts with no signage lettering",
        "Community events in Brookings.",
    ),
    ("brookings_sd", "home_sales"): (
        "a row of single-family Midwestern homes with front porches on a "
        "tree-lined street",
        "Residential homes in Brookings.",
    ),
    ("brookings_sd", "jobs"): (
        "an agricultural and light-industrial building exterior, grain silos "
        "in the distance, open prairie sky",
        "Local employers in Brookings.",
    ),
    ("brookings_sd", "sports"): (
        "a small college athletic stadium exterior with bleachers and "
        "floodlight towers, open prairie sky",
        "Jackrabbits and regional sports in Brookings.",
    ),
    ("brookings_sd", "school_alerts"): (
        "a Midwestern school building exterior with a flagpole and covered "
        "entrance, prairie sky",
        "Schools in Brookings.",
    ),
    ("brookings_sd", "weather_alert"): (
        "a prairie sky with distant storm clouds over flat farmland",
        "Weather conditions in Brookings.",
    ),
    ("brookings_sd", "university"): (
        "a Midwestern university campus quad with a clock tower silhouette in "
        "the distance, trees, open lawn",
        "South Dakota State University in Brookings.",
    ),
}


def _generate_fal(prompt: str) -> bytes:
    api_key = os.environ.get("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY is not set.")
    resp = requests.post(
        f"https://fal.run/{MODEL_ID}",
        headers={"Authorization": f"Key {api_key}"},
        json={"prompt": prompt, "image_size": {"width": IMAGE_WIDTH, "height": IMAGE_HEIGHT}},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    images = data.get("images") or []
    if not images:
        raise RuntimeError(f"fal.ai response had no images: {data}")
    image_resp = requests.get(images[0]["url"], timeout=REQUEST_TIMEOUT)
    image_resp.raise_for_status()
    return image_resp.content


def _save(image_bytes: bytes, out_path: Path) -> None:
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    if image.size != (IMAGE_WIDTH, IMAGE_HEIGHT):
        image = image.resize((IMAGE_WIDTH, IMAGE_HEIGHT))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path, format="PNG")


def _full_prompt(motif: str) -> str:
    base = STYLE_PROMPT_PATH.read_text(encoding="utf-8").strip()
    return f"{base} Motif: {motif}"


def _write_category_images_ts(generated_categories: dict[tuple[str, str], Path]) -> None:
    def town_block(town: str) -> str:
        entries = []
        for (t, category), path in sorted(generated_categories.items()):
            if t != town:
                continue
            _, alt = CATEGORY_MOTIFS[(t, category)]
            web_path = "/" + str(path.relative_to("site/public")).replace("\\", "/")
            entries.append(
                f'    {category}: {{ path: {web_path!r}, alt: {alt!r}, '
                f'width: {IMAGE_WIDTH}, height: {IMAGE_HEIGHT} }},'
            )
        return "\n".join(entries)

    content = f"""/**
 * Per-town, per-category illustrations for lib/images.ts's resolveImage()
 * tier 3 -- see NEEDS-HUMAN-REVIEW.md, "Venue & Category Image Identity".
 * Generated by scripts/generate_venue_category_images.py -- edit the motif
 * there and re-run to regenerate a single image, don't hand-edit paths here.
 */
import type {{ ImageCategory, ImageRef }} from '../lib/images';

export type Town = 'brookings_sd' | 'moreno_valley_ca';

export const CATEGORY_IMAGES: Record<Town, Partial<Record<ImageCategory, ImageRef>>> = {{
  brookings_sd: {{
{town_block('brookings_sd')}
  }},
  moreno_valley_ca: {{
{town_block('moreno_valley_ca')}
  }},
}};
"""
    CATEGORY_IMAGES_TS.write_text(content, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Actually call fal.ai and write files/DB.")
    args = ap.parse_args()

    total = len(VENUE_MOTIFS) + len(CATEGORY_MOTIFS)
    print(f"{len(VENUE_MOTIFS)} venue image(s), {len(CATEGORY_MOTIFS)} category image(s), {total} total.\n")

    if not args.apply:
        for (town, slug), (motif, alt) in VENUE_MOTIFS.items():
            print(f"[venue] {town}/{slug} -> {VENUES_DIR / f'{town}-{slug}.png'}")
            print(f"  alt: {alt}")
        for (town, category), (motif, alt) in CATEGORY_MOTIFS.items():
            print(f"[category] {town}/{category} -> {CATEGORIES_DIR / f'{town}-{category}.png'}")
            print(f"  alt: {alt}")
        print("\nDry run only -- no API calls made, nothing written. Re-run with --apply to generate.")
        return 0

    generated_categories: dict[tuple[str, str], Path] = {}

    with get_conn() as conn:
        for i, ((town, slug), (motif, alt)) in enumerate(VENUE_MOTIFS.items(), 1):
            out_path = VENUES_DIR / f"{town}-{slug}.png"
            print(f"[{i}/{total}] venue {town}/{slug} ...")
            image_bytes = _generate_fal(_full_prompt(motif))
            _save(image_bytes, out_path)
            web_path = "/" + str(out_path.relative_to("site/public")).replace("\\", "/")
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE facilities SET image_path = %s, image_alt = %s WHERE town_id = %s AND slug = %s",
                    (web_path, alt, town, slug),
                )
            print(f"  saved {out_path}, facilities row updated")
        conn.commit()

    n = len(VENUE_MOTIFS)
    for j, ((town, category), (motif, alt)) in enumerate(CATEGORY_MOTIFS.items(), 1):
        out_path = CATEGORIES_DIR / f"{town}-{category}.png"
        print(f"[{n + j}/{total}] category {town}/{category} ...")
        image_bytes = _generate_fal(_full_prompt(motif))
        _save(image_bytes, out_path)
        generated_categories[(town, category)] = out_path
        print(f"  saved {out_path}")

    _write_category_images_ts(generated_categories)
    print(f"\nWrote {CATEGORY_IMAGES_TS}")
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
