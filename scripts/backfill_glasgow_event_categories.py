"""One-time backfill of stories.meta.category for already published Glasgow
Life event stories (publish.py only writes the category for NEW stories).

Category = scrapers/glasgow_life_events.event_category() (the source's own
channel / age text). Already stored events.raw_data lacks the channels, so the
listing is fetched again read-only (same requests as the daily scrape, nothing
written to events) and matched on the event uid. Rows without a category are
left alone; an existing meta.category is never overwritten. Backs up
every affected row's old meta before writing.

Usage:
    python -m scripts.backfill_glasgow_event_categories            # dry run
    python -m scripts.backfill_glasgow_event_categories --apply
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from db.db import get_conn
from scrapers import glasgow_life_events as gl
from scrapers.user_agent import user_agent

TOWN_ID = "glasgow"
BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"


def live_categories() -> dict[str, str]:
    """uid -> category from a fresh read-only fetch of the Glasgow Life listing (+ detail pages)."""
    cfg = json.loads((Path(__file__).resolve().parent.parent / "configs" / "glasgow.json").read_text(encoding="utf-8"))
    src = next(x for x in cfg["data_sources"]["events"]["sources"] if x["name"] == "glasgow_life")
    page = gl.fetch_pages(src, {"User-Agent": user_agent(TOWN_ID)})
    if not page:
        raise SystemExit("fetch failed, nothing to match against")
    out: dict[str, str] = {}
    for rec in gl.parse_pages("glasgow_life", page, cfg.get("timezone", "Europe/London")):
        raw = rec["raw_data"]
        if raw.get("site_category"):
            out[raw.get("series_uid") or raw["uid"]] = raw["site_category"]
    return out


def find_candidates(conn, cats: dict[str, str]) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.slug, s.title, s.meta, e.raw_data
              FROM stories s
              JOIN events e ON e.town_id = s.town_id AND s.slug = 'event-' || e.id::text
             WHERE s.town_id = %s AND s.source_type = 'event' AND s.meta IS NOT NULL
             ORDER BY s.slug
            """,
            (TOWN_ID,),
        )
        rows = cur.fetchall()
    out = []
    for sid, slug, title, meta, raw in rows:
        meta = json.loads(meta) if isinstance(meta, str) else (meta or {})
        raw = json.loads(raw) if isinstance(raw, str) else (raw or {})
        cat = cats.get(raw.get("series_uid") or raw.get("uid"))
        if cat and not meta.get("category"):
            out.append({"id": sid, "slug": slug, "title": title, "old_meta": meta, "category": cat})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    with get_conn() as conn:
        rows = find_candidates(conn, live_categories())
        for r in rows:
            print(f"  {r['slug']:<20} {r['category']:<22} {r['title'][:60]}")
        print(f"\n{len(rows)} Glasgow event stories would get meta.category.")
        if not args.apply or not rows:
            print("Dry run: nothing written." if not args.apply else "Nothing to do.")
            return 0
        BACKUP_DIR.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = BACKUP_DIR / f"glasgow_event_categories_backfill_{stamp}.json"
        path.write_text(json.dumps(rows, indent=2, default=str), encoding="utf-8")
        print(f"Backed up old meta of {len(rows)} rows to {path}")
        with conn.cursor() as cur:
            for r in rows:
                cur.execute(
                    "UPDATE stories SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('category', %s::text) WHERE id = %s",
                    (r["category"], r["id"]),
                )
        print(f"Updated meta on {len(rows)} rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
