"""One-off regeneration of the 4 published media_recension reviews that
failed the 2026-10-01 season/month conflict check (see content/recensioner/
review_standard.py's _season_month_conflicts() and the Broomfield handoff
Issue 1 fix) -- each one described a month/season that didn't match its
own publish date (e.g. "Late July is a strange, sun-baked stretch for
moviegoing" published 2026-09-23), because the generation prompt had no
"today is X" anchor. That's fixed now (media_recension.py passes the real
date into the prompt, and the new deterministic check catches a conflict
if it still happens).

Same approach as scripts/regenerate_brookings_reviews.py (reconstructs the
real film's underlag from Wikidata + Wikipedia, same sourcing
content/now_playing.py uses for new reviews -- a regeneration of the SAME
real film each review already covers, not a different one). Two distinct
films across the 4 flagged rows:
  - Obsession (2025 film, wide US release 2026-05-15) -- Q136163067,
    confirmed live via Wikidata (enwiki sitelink "Obsession (2025 film)").
  - Spider-Man: Brand New Day -- Q113244935, same QID already verified by
    regenerate_brookings_reviews.py.

Updates each existing `stories` row IN PLACE (same slug, same town) with a
fresh published_at (this IS a genuine republish, not a backdated edit) --
same convention as regenerate_brookings_reviews.py. If regeneration fails
the gate (budget cap, API, originality, OR still fails the season check
after generate_article()'s own one retry), the row is left untouched here;
rerun scripts/backfill_sandbox_source_urls.py-style with --unpublish-on-
failure is NOT implemented -- per the handoff's own instruction
("unpublish if regeneration fails the gate"), a failed row is reported and
must be unpublished by hand (UPDATE stories SET published_at = NULL), not
silently auto-unpublished by a script that could have a bug of its own.

Usage:
    python -m scripts.regenerate_season_bug_reviews --dry-run
    python -m scripts.regenerate_season_bug_reviews
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from content import now_playing
from content.recensioner import media_recension
from db.db import get_conn

# (town_id, slug, wikidata QID, real US theatrical release date)
_TARGETS = [
    ("brookings_sd", "media_recension-2026-08-26", "Q136163067", "2026-05-15"),  # Obsession
    ("broomfield_co", "media_recension-2026-09-09", "Q113244935", "2026-08-12"),  # Spider-Man: Brand New Day
    ("broomfield_co", "media_recension-2026-09-23", "Q136163067", "2026-05-15"),  # Obsession
    ("moreno_valley_ca", "media_recension-2026-09-02", "Q136163067", "2026-05-15"),  # Obsession
]


def _build_movie(qid: str, release_date: str) -> dict | None:
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

    failures: list[str] = []

    with get_conn() as conn:
        for town_id, slug, qid, release_date in _TARGETS:
            print(f"\n{town_id}/{slug} ({qid})")
            cfg = json.loads(Path(f"configs/{town_id}.json").read_text(encoding="utf-8"))
            theaters = cfg.get("local_theaters", [])

            movie = _build_movie(qid, release_date)
            if movie is None:
                print("  could not rebuild underlag (no summary) -- skipping")
                failures.append(f"{town_id}/{slug}: no Wikipedia summary")
                continue

            local_input = now_playing.build_local_input(movie, theaters=theaters)
            article = media_recension.write(local_input, existing_corpus=[], cfg=cfg)
            if article is None:
                print("  generation failed (budget cap / API / originality) -- skipping")
                failures.append(f"{town_id}/{slug}: generation returned None")
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
                     WHERE town_id = %s AND slug = %s
                    """,
                    (article.title, article.body, article.rating, town_id, slug),
                )
                if article.review_flags:
                    cur.execute(
                        """
                        INSERT INTO review_quality_flags (town_id, story_slug, reasons)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (town_id, story_slug) DO UPDATE SET
                            reasons = EXCLUDED.reasons, created_at = now(), resolved = false
                        """,
                        (town_id, slug, article.review_flags),
                    )
            print("  updated")

    if failures:
        print("\n=== Rows that need manual unpublish (regeneration failed the gate) ===")
        for f in failures:
            print(f"  - {f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
