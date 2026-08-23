"""Retroactive, READ-ONLY scan of already-published `stories` for cross-site
(Brookings <-> Moreno Valley) contamination -- see ai_pipeline/town_guard.py
for the shared blocklists and the root-cause writeup (a hardcoded-town-name
bug in content/*.py, fixed 2026-08-07 in a5ebec0/e108341).

This script does NOT unpublish, edit, or delete anything. It produces
CONTAMINATION_REPORT.md at the repo root: every flagged row, the matched
term(s) in context, a tier (hard/review), and a recommended action --
`unpublish` / `relocate to sister site` / `rewrite locally` / `false
positive` -- for a human to act on. See NEEDS-HUMAN-REVIEW.md.

STRUCTURED DATA, NOT JUST PROSE (added 2026-08-23, "Brookings Parity Audit"
-- see NEEDS-HUMAN-REVIEW.md): `stories` is AI-generated text, where a wrong-
town leak comes from a model mistake. `facilities` and `events` are human-
curated or mechanically-scraped and already structurally isolated by
town_id (every read is `WHERE town_id = %s`, and site-config.ts/
configs/<town_id>.json key per-town data by object, never by string match)
-- but "structurally isolated" isn't the same guarantee as "scanned," and a
future copy-paste into the wrong town's facilities row would be exactly the
kind of contamination this scanner exists to catch. Scanned here too, same
blocklist, same report.

Usage:
    python -m scripts.scan_contamination
    python -m scripts.scan_contamination --town moreno_valley_ca
"""
from __future__ import annotations

import argparse
import textwrap

from ai_pipeline.town_guard import (
    ALL_TOWN_IDS, HARD_BLOCKLIST, REVIEW_BLOCKLIST, addressed_reader_hits,
    validate_town_identity,
)
from db.db import get_conn


def gather_stories(conn, town_id: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT slug, title, body, source_type, published_at
              FROM stories
             WHERE town_id = %s
             ORDER BY published_at
            """,
            (town_id,),
        )
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def excerpt(text: str, term: str, context: int = 60) -> str:
    low = text.casefold()
    idx = low.find(term.casefold())
    if idx == -1:
        return ""
    start = max(0, idx - context)
    end = min(len(text), idx + len(term) + context)
    snippet = text[start:end].replace("\n", " ")
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{snippet}{suffix}"


def recommend_action(hard_hits: list[str], escalated: list[str]) -> str:
    """Best-effort pre-sort, not a final decision -- see module docstring."""
    if not hard_hits:
        return "false positive"  # only review-tier hits, or nothing hard
    if escalated:
        # A hard term appeared next to an "addressed reader" marker --
        # the piece talks TO the other town, not just ABOUT it.
        return "rewrite locally"
    return "relocate to sister site"


def _flag_text(full_text: str, town_id: str, label: str, published_at=None) -> dict | None:
    """Shared classification logic behind scan_town()/scan_facilities()/
    scan_events() -- `label` is whatever identifies the row in the report
    (`/s/<slug>`, `facility:<slug>`, `event:<id>`), not necessarily a URL."""
    gate = validate_town_identity(full_text, town_id)
    if gate.passed and not gate.reviews:
        return None

    hard_terms = [v.split(": ", 1)[1] for v in gate.violations]
    review_terms = [v.split(": ", 1)[1] for v in gate.reviews]
    escalated = addressed_reader_hits(full_text, hard_terms)

    return {
        "town_id": town_id,
        "slug": label,
        "source_type": "n/a",
        "published_at": published_at,
        "hard_terms": hard_terms,
        "review_terms": review_terms,
        "escalated": escalated,
        "excerpts": {t: excerpt(full_text, t) for t in (hard_terms + review_terms)},
        "recommended_action": recommend_action(hard_terms, escalated),
    }


def scan_town(conn, town_id: str) -> list[dict]:
    flagged = []
    for row in gather_stories(conn, town_id):
        full_text = f"{row['title']}\n\n{row['body']}"
        item = _flag_text(full_text, town_id, f"/s/{row['slug']}", row["published_at"])
        if item:
            item["source_type"] = row["source_type"]
            flagged.append(item)
    return flagged


def gather_facilities(conn, town_id: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT slug, name, address, description, phone, website
              FROM facilities WHERE town_id = %s
            """,
            (town_id,),
        )
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def scan_facilities(conn, town_id: str) -> list[dict]:
    """facilities is human-curated, not AI-generated -- see this module's
    docstring for why it's still worth scanning (a future copy-paste error,
    not a model hallucination)."""
    flagged = []
    for row in gather_facilities(conn, town_id):
        full_text = " ".join(str(v) for v in
                              (row["name"], row["address"], row["description"],
                               row["phone"], row["website"]) if v)
        item = _flag_text(full_text, town_id, f"facility:{row['slug']}")
        if item:
            item["source_type"] = "facility"
            flagged.append(item)
    return flagged


def gather_events(conn, town_id: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT id, title, venue FROM events WHERE town_id = %s", (town_id,))
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def scan_events(conn, town_id: str) -> list[dict]:
    """events.venue is scraped verbatim from each town's own source feed
    (never cross-town by construction -- see runner.py's per-town config
    dispatch), but scanned anyway for the same reason facilities is: a feed
    or config mistake should be caught, not assumed impossible."""
    flagged = []
    for row in gather_events(conn, town_id):
        full_text = f"{row['title']} {row['venue'] or ''}"
        item = _flag_text(full_text, town_id, f"event:{row['id']}")
        if item:
            item["source_type"] = "event"
            flagged.append(item)
    return flagged


def render_report(all_flagged: dict[str, list[dict]]) -> str:
    lines = [
        "# Contamination scan report",
        "",
        "Generated by `scripts/scan_contamination.py` (read-only -- nothing here has "
        "been unpublished). Every row is a recommendation, not a decision -- a human "
        "makes the final call per item. See NEEDS-HUMAN-REVIEW.md.",
        "",
    ]
    total = sum(len(v) for v in all_flagged.values())
    lines.append(f"**Total flagged rows: {total}**")
    lines.append("")

    for town_id in ALL_TOWN_IDS:
        flagged = all_flagged.get(town_id, [])
        lines.append(f"## {town_id} ({len(flagged)} flagged)")
        lines.append("")
        if not flagged:
            lines.append("Nothing flagged.")
            lines.append("")
            continue
        for item in flagged:
            when = f", published {item['published_at']}" if item["published_at"] else ""
            lines.append(f"### `{item['slug']}` — {item['source_type']}{when}")
            lines.append(f"**Recommended action:** `{item['recommended_action']}`")
            if item["hard_terms"]:
                lines.append(f"- Hard-blocklist terms: {', '.join(item['hard_terms'])}")
            if item["review_terms"]:
                lines.append(f"- Review-tier terms: {', '.join(item['review_terms'])}")
            if item["escalated"]:
                lines.append(
                    f"- Addressed-reader escalation (appears with \"here in\"/\"our own\"/"
                    f"etc.): {', '.join(item['escalated'])}"
                )
            for term, snippet in item["excerpts"].items():
                if snippet:
                    lines.append(f"  - `{term}`: {textwrap.shorten(snippet, 200)}")
            lines.append("")

    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--town", choices=ALL_TOWN_IDS, help="scan only this town (default: both)")
    args = ap.parse_args()

    towns = [args.town] if args.town else ALL_TOWN_IDS

    all_flagged: dict[str, list[dict]] = {}
    with get_conn() as conn:
        for town_id in towns:
            print(f"Scanning {town_id}...")
            flagged = scan_town(conn, town_id)
            flagged += scan_facilities(conn, town_id)
            flagged += scan_events(conn, town_id)
            all_flagged[town_id] = flagged
            print(f"  {len(flagged)} flagged")

    report = render_report(all_flagged)
    with open("CONTAMINATION_REPORT.md", "w", encoding="utf-8") as f:
        f.write(report)
    print("\nWrote CONTAMINATION_REPORT.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
