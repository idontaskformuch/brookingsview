"""Project entity matching -- see NEEDS-HUMAN-REVIEW.md, "Week 3 -- City
Hall Project Pages". Mirrors ai_pipeline/venue_registry.py's pattern: a
small, hand-curated registry (data/projects/<town_id>.json, loaded via
scripts/seed_projects.py) matched against with a narrow, deterministic
rule -- never fuzzy/keyword matching, which risks threading an unrelated
item onto the wrong project, splitting one real project across two pages,
or (worse) inventing a match that isn't real.

Matching is case-number-only: an application/case number like "PEN25-0098"
is specific enough that an exact (case-insensitive) substring match against
an agenda item's title+description is safe. New projects are added to the
registry by hand as real ones are identified (see data/projects/*.json) --
this module only threads NEW agenda items onto EXISTING known projects, it
never creates one from raw text.
"""
from __future__ import annotations

import re

# A hyphenated case number ("PEN26-0019") that happens to line-wrap inside
# a source PDF gets extracted with a stray space after the hyphen
# ("PEN26- 0019") -- a known pdfplumber limitation (it doesn't reconstruct
# word-wraps), verified against a real Action Summary PDF where this
# silently broke matching for a real project (Village Specific Plan 204,
# PEN26-0019). Collapsed before matching so the registry's clean
# "PEN26-0019" still matches either form.
_HYPHEN_WRAP_RE = re.compile(r"-\s+(\d)")


def load_projects(conn, town_id: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, slug, title, case_numbers FROM projects WHERE town_id = %s",
            (town_id,),
        )
        rows = cur.fetchall()
    return [{"id": r[0], "slug": r[1], "title": r[2], "case_numbers": r[3] or []} for r in rows]


def match_project(
    projects: list[dict], agenda_title: str, agenda_description: str = ""
) -> tuple[dict | None, list[dict] | None]:
    """Returns (matched_project, None) on a clean single match,
    (None, ambiguous_matches) when more than one project's case number
    appears in the same item (flag for review, never guess which one),
    or (None, None) when nothing matches."""
    haystack = _HYPHEN_WRAP_RE.sub(r"-\1", f"{agenda_title} {agenda_description}".upper())
    matches = [p for p in projects if any(cn.upper() in haystack for cn in p["case_numbers"])]
    if len(matches) == 1:
        return matches[0], None
    if len(matches) > 1:
        return None, matches
    return None, None


def status_for_outcome(outcome: str) -> str:
    """A project's overall `status`, derived from its most recent update's
    outcome text -- shared by both ingest pipelines (eSCRIBE's fixed
    Approved/Denied/Continued/Tabled/pending vocabulary and Legistar's
    freer one, e.g. "Read into the record"). Keyword-based rather than an
    exact-match dict so it doesn't silently misclassify a real outcome
    string it hasn't seen before as 'under_review' by falling through --
    it only actually claims 'approved'/'denied', the two states a real
    outcome can confirm; anything else (including a genuinely unresolved
    procedural step) stays 'under_review', never guessed further."""
    lowered = outcome.lower()
    if "denied" in lowered or "fail" in lowered:
        return "denied"
    if "approved" in lowered or "passed" in lowered or "adopted" in lowered:
        return "approved"
    return "under_review"


def queue_for_review(conn, town_id: str, meeting_id: int | None, counter: str, title: str, reason: str) -> None:
    """Records an ambiguous match for a human to triage -- same flag-not-
    guess pattern as ai_pipeline.venue_registry.queue_for_review()."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO project_match_review_queue
                (town_id, meeting_id, agenda_counter, agenda_title, reason)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (town_id, meeting_id, counter, title, reason),
        )
