"""Re-derive stories.meta.category for the published Glasgow Life event stories with the current rules
(scrapers.glasgow_life_events.event_category: venue, then keywords, else none) and meta.tags (event_tags: Kids & families).

Works from what is already stored (events.title / venue / raw_data), no network. Sets meta.category where the rule
gives one, removes the key where it gives none (-> "Around town"), leaves rows whose result is unchanged alone. Backs up
the old meta of every row it changes first.

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
from scrapers.glasgow_life_events import event_category, event_tags

TOWN_ID = "glasgow"
BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"


def _json(v):
    return json.loads(v) if isinstance(v, str) else (v or {})


def find_changes(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.slug, s.title, s.meta, e.title, e.venue, e.raw_data
              FROM stories s
              JOIN events e ON e.town_id = s.town_id AND s.slug = 'event-' || e.id::text
             WHERE s.town_id = %s AND s.source_type = 'event' AND s.meta IS NOT NULL
             ORDER BY s.slug
            """,
            (TOWN_ID,),
        )
        rows = cur.fetchall()
    out = []
    for sid, slug, story_title, meta, ev_title, venue, raw in rows:
        meta = _json(meta)
        raw = _json(raw)
        new = event_category(raw, ev_title, venue)
        new_tags = event_tags(raw, ev_title)
        if new != meta.get("category") or new_tags != (meta.get("tags") or []):
            out.append({"id": sid, "slug": slug, "title": story_title, "old_meta": meta, "old": meta.get("category"), "new": new,
                        "old_tags": meta.get("tags") or [], "new_tags": new_tags})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    with get_conn() as conn:
        rows = find_changes(conn)
        for r in rows:
            print(f"  {r['slug']:<13} {str(r['old']):<16} -> {str(r['new']):<22} tags {r['old_tags']} -> {r['new_tags']}  {r['title'][:40]}")
        print(f"{len(rows)} Glasgow event stories change category.")
        if not args.apply or not rows:
            print("Dry run: nothing written." if not args.apply else "Nothing to do.")
            return 0
        BACKUP_DIR.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = BACKUP_DIR / f"glasgow_event_categories_tags_backfill_{stamp}.json"
        path.write_text(json.dumps(rows, indent=2, default=str), encoding="utf-8")
        print(f"Backed up old meta of {len(rows)} rows to {path}")
        with conn.cursor() as cur:
            for r in rows:
                if r["new"]:
                    cur.execute("UPDATE stories SET meta = meta || jsonb_build_object('category', %s::text) WHERE id = %s", (r["new"], r["id"]))
                else:
                    cur.execute("UPDATE stories SET meta = meta - 'category' WHERE id = %s", (r["id"],))
                if r["new_tags"]:
                    cur.execute("UPDATE stories SET meta = meta || jsonb_build_object('tags', %s::jsonb) WHERE id = %s", (json.dumps(r["new_tags"]), r["id"]))
                else:
                    cur.execute("UPDATE stories SET meta = meta - 'tags' WHERE id = %s", (r["id"],))
        print(f"Updated meta on {len(rows)} rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
