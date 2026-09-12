"""Render-window handoff, Phase 2: the retention guarantee.

The three concepts (retention / render window / index policy) must never
collapse into one -- see site/src/lib/render-window.ts's own module
docstring. The specific failure mode named in the handoff: a time filter
that starts as a page-generation concern and later gets copied into an
ingestion or backfill script, silently narrowing what ever gets stored.

This codebase has NO live-database integration tests anywhere (confirmed:
tests/test_new_in_town_digest.py's own tests specifically assert certain
code paths never even REACH DATABASE_URL, rather than mocking a real
connection -- there's no "run the pipeline against a real Postgres, then
query it back" pattern to extend here). The real, structural guarantee
this spec relies on is stronger than any single integration test could
prove anyway: isWithinRenderWindow() is a pure TypeScript function with no
database access, and Python code -- every scraper, every backfill script,
every ai_pipeline module -- cannot import a TypeScript module at all,
different language and runtime. A record's storage is therefore
UNREACHABLE by this mechanism by construction, not merely by discipline.

What an automated test CAN usefully prove, and what this one does: that
the render-window concept never actually gets reimplemented as a second,
parallel time filter somewhere in the Python pipeline (the concrete way
this failure mode would actually happen in practice -- not literally
importing the TS file, but someone adding an equivalent `if age > N
months: skip` check to a scraper or reconcile script, closing over the
same real intent by copying the pattern rather than the code). Fails loud
if that ever happens, same convention as this codebase's other structural
guards (e.g. town_guard.py's blocklist tests).
"""
from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Every directory that can write to the database or feed a write path --
# the full "ingestion / backfill / database write path" surface the
# handoff's own guardrail names. ai_pipeline includes render/publish
# scripts that only READ (e.g. daily_content.py's own local_context
# reads), but scoping to "does this directory ever run against the DB at
# all" is the honest, checkable boundary -- narrower would require
# maintaining a second list of "which of these files specifically write,"
# which is exactly the kind of parallel bookkeeping this test exists to
# avoid needing.
PIPELINE_DIRS = ["scrapers", "ai_pipeline", "scripts", "db"]

# Matches "render_window", "renderwindow", "render window" case-
# insensitively, and the TS-cased "renderWindow" -- broad on purpose: this
# guard is cheap to satisfy (there is no legitimate reason for the concept
# to appear here at all) and a narrow regex would be easy to accidentally
# dodge with a slightly different spelling.
FORBIDDEN_PATTERN = "render_window|render window|renderwindow"


def test_render_window_concept_never_appears_in_the_python_pipeline():
    import re
    pattern = re.compile(FORBIDDEN_PATTERN, re.IGNORECASE)
    offenders = []
    for dirname in PIPELINE_DIRS:
        directory = REPO_ROOT / dirname
        if not directory.is_dir():
            continue
        for path in directory.rglob("*.py"):
            text = path.read_text(encoding="utf-8", errors="ignore")
            if pattern.search(text):
                offenders.append(str(path.relative_to(REPO_ROOT)))
    assert not offenders, (
        "The render-window concept (page-generation-only, see site/src/lib/"
        "render-window.ts) must never appear in the ingestion/backfill/DB-write "
        f"pipeline. Found it in: {offenders}"
    )


def test_render_window_helper_has_no_database_access():
    """A cheap, direct check on the helper itself: it must not import
    anything that could reach a database (psycopg, the neon serverless
    client, or this project's own db.ts) -- the isolation the retention
    guarantee depends on is that this function is PURE, not merely that
    nothing currently calls it destructively."""
    helper = REPO_ROOT / "site" / "src" / "lib" / "render-window.ts"
    text = helper.read_text(encoding="utf-8")
    forbidden_imports = ["from './db'", "from \"./db\"", "neon(", "psycopg"]
    offenders = [f for f in forbidden_imports if f in text]
    assert not offenders, f"render-window.ts must have zero database access; found: {offenders}"
