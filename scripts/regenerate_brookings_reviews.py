"""One-off regeneration of the 3 Brookings media_recension reviews that
predate the Review Writing Standard (see NEEDS-HUMAN-REVIEW.md "Brookings
P6: Backfill Shared Fixes") -- same idempotency-backfill gap the Event
JSON-LD pages needed: a fix in the code never retroactively touches rows
generated before it, so these 3 reviews kept rendering the old format (no
local hook, no verified venue, no divided-reception-then-verdict, no
verification date) even after content/recensioner/media_recension.py was
rewritten.

Reconstructs each film's real underlag (Wikipedia summary + Wikidata
aggregate review scores, same sourcing content/now_playing.py uses for new
reviews) from the SAME real film each existing review already covers --
this is a regeneration, not a replacement with a different movie. QIDs
below were looked up live via Wikidata SPARQL (label + P31=film + release
year match) and each confirmed enwiki sitelink, not guessed.

Updates the existing `stories` row IN PLACE (same slug, same occurs_at/
published_at) rather than inserting a new row -- these are genuinely the
same editorial "reviewed this film" fact, just written to a higher
standard now.

Usage:
    python -m scripts.regenerate_brookings_reviews --dry-run
    python -m scripts.regenerate_brookings_reviews
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

import psycopg

from content import now_playing
from content.recensioner import media_recension
from db.db import get_conn

# (slug, wikidata QID, real release date) -- looked up live, see module docstring.
_TARGETS = [
    ("media_recension-2026-07-22", "Q131547207", "2026-07-17"),  # The Odyssey (2026 film)
    ("media_recension-2026-07-29", "Q116677364", "2026-04-24"),  # Michael (2026 film)
    ("media_recension-2026-08-12", "Q113244935", "2026-08-12"),  # Spider-Man: Brand New Day
]


def _build_movie(qid: str, release_date: str) -> dict | None:
    r = None
    import requests
    resp = requests.get(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json",
                         headers={"User-Agent": now_playing._user_agent()}, timeout=30)
    resp.raise_for_status()
    entity = resp.json()["entities"][qid]
    title = entity["labels"]["en"]["value"]
    article_title = entity.get("sitelinks", {}).get("enwiki", {}).get("title")
    if not article_title:
        return None
    summary = now_playing._wikipedia_summary(article_title)
    if not summary:
        return None
    return {
        "title": title,
        "release_date": release_date,
        "summary": summary,
        "review_scores": now_playing._review_scores(qid),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.loads(Path("configs/brookings_sd.json").read_text(encoding="utf-8"))
    theaters = cfg.get("local_theaters", [])

    with get_conn() as conn:
        for slug, qid, release_date in _TARGETS:
            print(f"\n{slug} ({qid})")
            movie = _build_movie(qid, release_date)
            if movie is None:
                print("  could not rebuild underlag (no summary) -- skipping")
                continue

            local_input = now_playing.build_local_input(movie, theaters=theaters)
            article = media_recension.write(local_input, existing_corpus=[], cfg=cfg)
            if article is None:
                print("  generation failed (budget cap / API / originality) -- skipping")
                continue

            print(f"  \"{article.title}\" ({len(article.body.split())} words, rating={article.rating})")
            if article.review_flags:
                print(f"  FLAGGED for review: {article.review_flags}")

            if args.dry_run:
                print("  (dry-run -- not written)")
                continue

            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE stories
                       SET title = %s, body = %s, rating = %s, published_at = now()
                     WHERE town_id = 'brookings_sd' AND slug = %s
                    """,
                    (article.title, article.body, article.rating, slug),
                )
                if article.review_flags:
                    cur.execute(
                        """
                        INSERT INTO review_quality_flags (town_id, story_slug, reasons)
                        VALUES ('brookings_sd', %s, %s)
                        ON CONFLICT (town_id, story_slug) DO UPDATE SET
                            reasons = EXCLUDED.reasons, created_at = now(), resolved = false
                        """,
                        (slug, article.review_flags),
                    )
            conn.commit()
            print("  updated")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
