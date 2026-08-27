"""One-time historical backfill for the Vail Resorts newsroom feed
(vail_news table). See scrapers/parsers/vail_news_v1.py for the regular,
SCHEDULED incremental scraper -- that one goes through scrapers.runner's
refresh_minutes throttle (48h) and only ever walks forward from page 1.

This script is DELIBERATELY separate and NOT wired into any GitHub Actions
workflow: a one-off historical pull, meant to be run manually, once, right
after the feature launches (see Handoff: "Vail Resorts news section
(/vail-resorts) — Broomfield only", acceptance criterion "Backfill run
respects the 24-month floor and does not re-insert duplicates"). Reuses
vail_news_v1.py's own extraction/translation-detection helpers so there is
exactly one implementation of "what counts as an item" and "is this a
Spanish duplicate" -- not a second, drifting copy.

Walks ?o=<offset>&l=50 pages (bigger page size than the incremental
scraper's 25, per the handoff, to reduce request count during a one-time
walk) until either a page comes back empty or its OLDEST item is older
than the floor (default 24 months back -- older than that isn't useful to
a reader and just inflates the page, per the handoff).

Usage:
    python -m scripts.backfill_vail_news
    python -m scripts.backfill_vail_news --months 12
    python -m scripts.backfill_vail_news --dry-run
"""
from __future__ import annotations

import argparse
import time
from datetime import date, timedelta

import requests

from db.db import content_hash, get_conn, save_snapshot, upsert_records
from scrapers.parsers.vail_news_v1 import (
    BASE_URL,
    LISTING_PATH,
    _extract_items,
    _flag_translations,
    _parse_date,
)

TOWN_ID = "broomfield_co"
PAGE_SIZE = 50


def _headers() -> dict:
    return {"User-Agent": "broomfieldview.com (contact: hello@broomfieldview.com)"}


def _fetch_page(offset: int) -> str:
    url = f"{BASE_URL}{LISTING_PATH}?o={offset}&l={PAGE_SIZE}"
    r = requests.get(url, headers=_headers(), timeout=30)
    r.raise_for_status()
    return r.text


def backfill(months: int, dry_run: bool) -> int:
    floor = date.today() - timedelta(days=months * 30)
    print(f"Backfill-golv: {floor} ({months} månader bakåt)")

    kept_items: list[dict] = []
    offset = 0
    page_num = 0
    while True:
        if page_num > 0:
            time.sleep(2)  # minst 2s mellan anrop, samma rate limit som vail_news_v1.py
        html = _fetch_page(offset)
        items = _extract_items(html)
        if not items:
            print(f"  sida {page_num} (o={offset}): tom -- slut på historik")
            break

        parsed = []
        for it in items:
            d = _parse_date(it["date_text"])
            if d is None:
                continue
            parsed.append({**it, "published_at": d})

        oldest_on_page = min((p["published_at"] for p in parsed), default=None)
        page_kept = [p for p in parsed if p["published_at"] >= floor]
        print(f"  sida {page_num} (o={offset}): {len(parsed)} poster, "
              f"{len(page_kept)} innanför golvet, äldst={oldest_on_page}")
        kept_items.extend(page_kept)

        if oldest_on_page is not None and oldest_on_page < floor:
            print(f"  äldsta posten på sidan ({oldest_on_page}) < golv ({floor}) -- stoppar")
            break

        offset += PAGE_SIZE
        page_num += 1

    # dedupe över sidorna (samma säkerhetsnät som vail_news_v1.py:s parse())
    seen: set[str] = set()
    deduped = []
    for it in kept_items:
        if it["url"] in seen:
            continue
        seen.add(it["url"])
        deduped.append(it)

    _flag_translations(deduped, [])

    rows = []
    for p in deduped:
        rows.append({
            "external_url": p["url"],
            "title": p["title"],
            "published_at": p["published_at"],
            "categories": p["categories"],
            "teaser": p["teaser"],
            "image_url": p["image_url"],
            "image_source": "vailresorts" if p["image_url"] else None,
            "is_translation": p["is_translation"],
            "content_hash": content_hash("vail_news", p["url"], p["title"], p["teaser"]),
        })

    print(f"{len(rows)} unika poster inom {months}-månadersgolvet")
    if dry_run:
        print("--dry-run: skriver inget till DB")
        return 0

    with get_conn() as conn:
        snapshot_id = save_snapshot(conn, TOWN_ID, "vail_news_backfill",
                                     f"{BASE_URL}{LISTING_PATH}", b"", "text/html")
        new = upsert_records(
            conn, "vail_news", TOWN_ID, rows, snapshot_id,
            conflict_columns=("town_id", "external_url"),
            update_columns=["title", "categories", "teaser", "image_url",
                             "image_source", "is_translation", "content_hash"],
        )
    print(f"{new} nya/uppdaterade rader skrivna (ON CONFLICT (town_id, external_url) -- "
          f"redan sedda URL:er dubbleras aldrig)")
    return new


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--months", type=int, default=24,
                         help="Hur långt bakåt i månader räknat (default 24, se handoffens golv).")
    parser.add_argument("--dry-run", action="store_true",
                         help="Skrapa och räkna, skriv inget till DB.")
    args = parser.parse_args()
    backfill(args.months, args.dry_run)


if __name__ == "__main__":
    main()
