"""One-time cleanup for the 24 already-published Broomfield stories found
live 2026-09-30 (Broomfield handoff, Issue 2) whose source_url was copied
from AgendaLink's own agenda_url before ai_pipeline/publish.py's
build_source_url() was fixed to reject a sandbox.agendalink.app host (see
that function's _is_sandbox_url() comment, and site/src/lib/db.ts's
isSandboxUrl() for the render-side twin of this same rule).

Every render site (s/[slug].astro, article-jsonld.ts, city-hall/projects/
[slug].astro) already gates on isSandboxUrl(), so this backfill changes
nothing PUBLICLY VISIBLE -- it only makes the underlying data match what's
already being rendered (source_blurb fallback, not the sandbox link), and
clears build-checks.ts's KNOWN_SANDBOX_URL_GAP_EXPIRY warning.

Sets source_url = NULL (no production equivalent can be derived from the
data -- confirmed the API's own agendaUrl field never returns anything
else) rather than guessing at a replacement URL.

Usage:
    python -m scripts.backfill_sandbox_source_urls --dry-run
    python -m scripts.backfill_sandbox_source_urls
"""
from __future__ import annotations

import argparse

from db.db import get_conn


def find_affected_rows(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT town_id, slug, source_url
              FROM stories
             WHERE source_url LIKE 'https://sandbox.%'
             ORDER BY town_id, slug
            """
        )
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    with get_conn() as conn:
        rows = find_affected_rows(conn)
        if not rows:
            print("No stories with a sandbox.* source_url found -- nothing to do.")
            return

        print(f"Found {len(rows)} story row(s) with a sandbox.* source_url:")
        for r in rows:
            print(f"  {r['town_id']}/{r['slug']}: {r['source_url']}")

        if args.dry_run:
            print("\n--dry-run: no changes written.")
            return

        with conn.cursor() as cur:
            cur.execute("UPDATE stories SET source_url = NULL WHERE source_url LIKE 'https://sandbox.%'")
        print(f"\nCleared source_url on {len(rows)} row(s).")


if __name__ == "__main__":
    main()
