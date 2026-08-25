"""SEO Fas 3.2 -- retroactively ensure every published story's TITLE names
its own town explicitly, per the SEO handoff's "place + entity + topic +
date" title rule.

WHY THIS EXISTS: `stories.title` doesn't only feed the <title> tag (which
already appends siteConfig.siteName, e.g. "Brookings View" -- itself
containing the town name). It's ALSO the visible H1 on /s/[slug]/, the
link text on hub pages, archive pages (/city-hall/archive/, /events/
past/), and every ItemList JSON-LD `name` field -- none of which append
the site name. A real DB check before writing this (see NEEDS-HUMAN-
REVIEW.md, "SEO Fas 3") found the gap is large: only 4/136 Brookings event
titles and 5/1068 Moreno Valley event titles already name the town.

RULE, DELIBERATELY MINIMAL (no AI, no narrative rewrite): if a title does
NOT already contain the town's display_name (case-insensitive substring),
prepend "{display_name}: " to it. Idempotent by construction -- the same
substring check is both the skip condition and what a second run would
see, so re-running never double-prefixes. This does NOT attempt the
brief's own flowery example format ("Moreno Valley City Council to
Consider [Issue] -- August 25, 2026") -- reconstructing a title into that
shape requires understanding WHAT is being decided, which is real content
judgment (i.e. an AI call), and the brief explicitly rules that out for
this pass. A uniform, reviewable prefix is the safe, rule-based version of
the same goal: every title names its town.

SAFETY: this mutates already-published, already-indexed content across
potentially thousands of rows in production. Defaults to a dry run that
only PRINTS what would change -- nothing is written to the database
unless --apply is passed explicitly. Always run without --apply first and
read the sample output before ever passing --apply.

Usage:
    python -m scripts.retrofit_story_titles --config configs/brookings_sd.json
        # dry run (default) -- prints a summary + a sample of proposed changes,
        # writes nothing
    python -m scripts.retrofit_story_titles --config configs/brookings_sd.json --apply
        # writes the new titles to the database
    python -m scripts.retrofit_story_titles --config configs/brookings_sd.json --apply --log out.json
        # also writes a full before/after log (every changed row) to a JSON
        # file, so the change is reviewable/revertible after the fact
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from db.db import get_conn


def load_config(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def needs_prefix(title: str, display_name: str) -> bool:
    return display_name.lower() not in title.lower()


def retrofit(conn, town_id: str, display_name: str, apply: bool) -> list[dict]:
    """Returns the list of {slug, source_type, old_title, new_title} for
    every row that needs (or, with apply=True, got) a prefix."""
    changes: list[dict] = []
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, slug, source_type, title FROM stories WHERE town_id = %s ORDER BY source_type, slug",
            (town_id,),
        )
        rows = cur.fetchall()

    for row_id, slug, source_type, title in rows:
        if not needs_prefix(title, display_name):
            continue
        new_title = f"{display_name}: {title}"
        changes.append({
            "slug": slug, "source_type": source_type,
            "old_title": title, "new_title": new_title,
        })
        if apply:
            with conn.cursor() as cur:
                cur.execute("UPDATE stories SET title = %s WHERE id = %s", (new_title, row_id))

    return changes


def print_summary(town_id: str, changes: list[dict], apply: bool) -> None:
    by_type: dict[str, int] = {}
    for c in changes:
        by_type[c["source_type"]] = by_type.get(c["source_type"], 0) + 1

    verb = "Updated" if apply else "Would update"
    print(f"\n=== {town_id} ===")
    print(f"{verb} {len(changes)} title(s):")
    for source_type, count in sorted(by_type.items()):
        print(f"  {source_type}: {count}")

    if changes:
        print("\nSample (up to 5 per source_type):")
        shown: dict[str, int] = {}
        for c in changes:
            shown.setdefault(c["source_type"], 0)
            if shown[c["source_type"]] >= 5:
                continue
            shown[c["source_type"]] += 1
            print(f"  [{c['source_type']}] {c['slug']}")
            print(f"    before: {c['old_title']}")
            print(f"    after:  {c['new_title']}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--apply", action="store_true",
                     help="Actually write the new titles. Without this flag, "
                          "nothing is written -- only a dry-run report is printed.")
    ap.add_argument("--log", help="Path to write a full before/after JSON log "
                                   "of every changed row (recommended with --apply).")
    args = ap.parse_args()

    cfg = load_config(args.config)
    town_id = cfg["town_id"]
    display_name = cfg["display_name"]

    with get_conn() as conn:
        changes = retrofit(conn, town_id, display_name, apply=args.apply)

    print_summary(town_id, changes, apply=args.apply)

    if args.log:
        Path(args.log).write_text(json.dumps(changes, indent=2), encoding="utf-8")
        print(f"\nFull before/after log written to {args.log}")

    if not args.apply and changes:
        print("\nDry run only -- nothing was written. Re-run with --apply to write these changes.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
