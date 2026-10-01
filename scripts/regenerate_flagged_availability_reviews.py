"""One-off regeneration of the 9 published media_recension reviews flagged
by the 2026-10-01 unverifiable-availability check (validation/
unverifiable_availability.py, Phase 0 check 7 -- see that module's own
docstring). Each one asserted a confirmed current showtime/availability
("playing now", "showtimes", "first crack at it", "still has time to catch
it") that content/now_playing.py has no actual data for.

Same approach as scripts/regenerate_season_bug_reviews.py: reconstructs the
real film's underlag from Wikidata + Wikipedia (the SAME sourcing
content/now_playing.py uses for new reviews), regenerating the SAME real
film each flagged review already covers, through the now-fixed prompt
(content/recensioner/media_recension.py, rewritten 2026-10-01 to stop
asking for "shown now at..." framing) and the new hard-block gate. QIDs
below were found live via the exact SPARQL query content/now_playing.py's
own _recent_films() runs, restricted to a window covering every flagged
review's publish date (2026-05-01 to 2026-09-30) -- not guessed.

Unlike regenerate_season_bug_reviews.py (which left a failing row for a
human to unpublish by hand), this one unpublishes automatically on a
regeneration failure (published_at = NULL), per explicit instruction --
the title/body are left untouched so the "before" state stays visible in
the DB for the report, only published_at changes.

Usage:
    python -m scripts.regenerate_flagged_availability_reviews --dry-run
    python -m scripts.regenerate_flagged_availability_reviews
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from content import now_playing
from content.recensioner import media_recension
from validation.unverifiable_availability import check_unverifiable_availability

# (town_id, slug, wikidata QID, real release/re-release date -- verified live
# against Wikidata's own P577 statement within the review's own recent-film
# window, not assumed from the precedent script's dates)
_TARGETS = [
    ("brookings_sd", "media_recension-2026-07-22", "Q131547207", "2026-07-06"),  # The Odyssey
    ("brookings_sd", "media_recension-2026-07-29", "Q116677364", "2026-05-21"),  # Michael
    ("brookings_sd", "media_recension-2026-08-12", "Q113244935", "2026-07-29"),  # Spider-Man: Brand New Day
    ("brookings_sd", "media_recension-2026-09-09", "Q116921951", "2026-06-22"),  # Supergirl
    ("broomfield_co", "media_recension-2026-09-09", "Q113244935", "2026-07-29"),  # Spider-Man: Brand New Day
    ("broomfield_co", "media_recension-2026-09-30", "Q182153", "2026-09-17"),  # Cars (20th anniversary)
    ("moreno_valley_ca", "media_recension-2026-08-26", "Q113244935", "2026-07-29"),  # Spider-Man: Brand New Day
    ("moreno_valley_ca", "media_recension-2026-09-09", "Q116921951", "2026-06-22"),  # Supergirl
    ("moreno_valley_ca", "media_recension-2026-09-30", "Q637290", "2026-08-13"),  # Cobra (40th anniversary)
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

    from db.db import get_conn

    report: list[dict] = []

    with get_conn() as conn:
        for town_id, slug, qid, release_date in _TARGETS:
            row = {"town_id": town_id, "slug": slug}
            with conn.cursor() as cur:
                cur.execute("SELECT title FROM stories WHERE town_id = %s AND slug = %s", (town_id, slug))
                before = cur.fetchone()
            row["before_title"] = before[0] if before else "(not found)"

            print(f"\n{town_id}/{slug} ({qid})")
            print(f"  BEFORE: \"{row['before_title']}\"")
            cfg = json.loads(Path(f"configs/{town_id}.json").read_text(encoding="utf-8"))
            theaters = cfg.get("local_theaters", [])

            movie = _build_movie(qid, release_date)
            if movie is None:
                print("  could not rebuild underlag (no summary) -- unpublishing")
                row.update(after_title=None, result="unpublished (no underlag)")
                report.append(row)
                if not args.dry_run:
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE stories SET published_at = NULL WHERE town_id = %s AND slug = %s",
                            (town_id, slug),
                        )
                continue

            local_input = now_playing.build_local_input(movie, theaters=theaters)
            article = media_recension.write(local_input, existing_corpus=[], cfg=cfg)
            if article is None:
                print("  generation failed (budget cap / API / gate) -- unpublishing")
                row.update(after_title=None, result="unpublished (generation returned None)")
                report.append(row)
                if not args.dry_run:
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE stories SET published_at = NULL WHERE town_id = %s AND slug = %s",
                            (town_id, slug),
                        )
                continue

            # Belt and suspenders: generate_article()'s own retry-then-skip
            # already enforces the new check inside pre_publish_check() (a
            # non-None article here already passed it), but re-check
            # explicitly so this script's own report is self-verifying
            # rather than trusting that wiring silently.
            recheck = check_unverifiable_availability(f"{article.title}\n{article.body}", "media_recension")
            print(f"  AFTER:  \"{article.title}\" ({len(article.body.split())} words, rating={article.rating})")
            if not recheck.passed:
                print(f"  STILL FAILS the check post-generation ({recheck.violations}) -- unpublishing")
                row.update(after_title=article.title, result=f"unpublished (still fails: {recheck.violations})")
                report.append(row)
                if not args.dry_run:
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE stories SET published_at = NULL WHERE town_id = %s AND slug = %s",
                            (town_id, slug),
                        )
                continue

            row.update(after_title=article.title, result="regenerated")
            report.append(row)
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

    print("\n=== Summary ===")
    for r in report:
        print(f"  {r['town_id']}/{r['slug']}: {r['result']}")
        print(f"    before: {r['before_title']!r}")
        print(f"    after:  {r['after_title']!r}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
