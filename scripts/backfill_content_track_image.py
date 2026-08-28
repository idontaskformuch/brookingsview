"""Backfill: regenerate the illustration for one existing content-track
story whose image_path is null -- generation failed at original publish
time (missing key, network/provider error) and was never retried. See
site/src/lib/build-checks.ts's assertContentTrackImagesComplete() for why
this can no longer ship silently.

Does NOT regenerate the article text -- only calls generate_illustration()
against the story's EXISTING title/body, the same way ai_pipeline/
daily_content.py does at original publish time. Regenerating the article
itself would be a much bigger, separate action (new guardrail/originality
checks, new AI cost, a genuinely different text) that isn't warranted just
to backfill a missing image for text that's already fine.

Usage:
    python -m scripts.backfill_content_track_image --config configs/brookings_sd.json --slug editorial-2026-07-21 --dry-run
    python -m scripts.backfill_content_track_image --config configs/brookings_sd.json --slug editorial-2026-07-21
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

from content._base import illustration_theme
from content.illustrations.generate_illustration import generate_illustration
from db.db import get_conn


@dataclass
class _ExistingArticle:
    """Just enough shape for illustration_theme() -- title/body only, see
    that function's own signature. Not a real GeneratedArticle: this
    represents a story that already exists, not a fresh AI draft."""
    title: str
    body: str


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--dry-run", action="store_true", help="Print the theme, generate nothing, write nothing.")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    display_name = cfg["display_name"]

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT title, body, source_type, image_path FROM stories WHERE town_id = %s AND slug = %s",
                (town_id, args.slug),
            )
            row = cur.fetchone()
        if row is None:
            print(f"No story found for {town_id}/{args.slug}")
            return 1

        title, body, source_type, existing_image_path = row
        if existing_image_path:
            print(f"  {args.slug} already has image_path={existing_image_path!r} -- nothing to backfill "
                  "(this script only fills a NULL image_path, it never overwrites an existing one).")
            return 0

        # Undo prefix_town_name() (ai_pipeline/publish.py) -- illustration_theme()
        # wants the raw, unprefixed title, same as at original publish time (see
        # ai_pipeline/daily_content.py's own comment on this).
        prefix = f"{display_name}: "
        unprefixed_title = title[len(prefix):] if title.startswith(prefix) else title

        article = _ExistingArticle(title=unprefixed_title, body=body)
        theme = illustration_theme(article)
        image_slug = f"{args.slug}-{town_id}"

        print(f"[{town_id}/{args.slug}] source_type={source_type!r}")
        print(f"  theme: {theme!r}")

        if args.dry_run:
            print("  (dry-run -- no image generated, no DB write)")
            return 0

        saved = generate_illustration(theme, image_slug, content_type=source_type)
        if saved is None:
            print("  generation failed -- see error above. Nothing written; story stays image-less.")
            return 1

        image_path = "/" + str(saved.native.relative_to(Path("site/public"))).replace("\\", "/")
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE stories SET image_path = %s, image_alt = %s WHERE town_id = %s AND slug = %s",
                (image_path, theme, town_id, args.slug),
            )
        print(f"  saved {image_path} (+4:3/1:1 crops), image_alt set, DB updated")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
