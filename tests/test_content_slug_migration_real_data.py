"""Verifies the 2026-10-01 slug migration (item 4) against the REAL,
live `stories` table -- not a fixture -- for the four content types that
used to publish under a Swedish-word slug prefix (vardagsmiddag,
vetenskap_kronika, kvick_essa, media_recension).

This is a correctness check on the DATA, independent of the TypeScript
redirect/routing logic (server/content-slug-redirects.ts,
site/src/lib/content-slugs.ts) -- those are unit-tested directly in
vitest (content-slug-redirects.test.ts, content-slugs.test.ts) against the
SAME transform, reimplemented here in Python since the DB itself is only
reachable from here. Confirms real counts and real uniqueness rather than
assuming them: found live (2026-10-01) that only 67 of the 79 real rows
across these four types still carry the OLD prefix -- the other 12
(vardagsmiddag rows published since the 2026-08-23 recipe-prefix change)
already use the new "recipe-" prefix and need no redirect at all. Skipped
entirely (not failed) if DATABASE_URL isn't configured, matching this
codebase's existing convention for DB-dependent tests
(e.g. tests/test_staleness.py's own module docstring).
"""
from __future__ import annotations

import os
import re

import pytest
from dotenv import load_dotenv

# db/db.py itself calls load_dotenv() at import time, but the skipif check
# below runs at collection time, BEFORE db.db is ever imported -- without
# this, DATABASE_URL being set only in .env (not a real shell env var) would
# make every test here skip even when a real database is reachable.
load_dotenv()

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not configured"
)

OLD_PREFIX_TO_PUBLIC = {
    "vardagsmiddag": "recipe",
    "vetenskap_kronika": "science-column",
    "kvick_essa": "quick-essay",
    "media_recension": "review",
}
OLD_PREFIX_RE = re.compile(r"^(" + "|".join(OLD_PREFIX_TO_PUBLIC) + r")-")


def public_slug(db_slug: str) -> str:
    """Python port of content-slugs.ts's publicSlug() -- see that module's
    own docstring for the full reasoning. Kept in sync by hand."""
    m = OLD_PREFIX_RE.match(db_slug)
    if not m:
        return db_slug
    return OLD_PREFIX_TO_PUBLIC[m.group(1)] + db_slug[len(m.group(0)) - 1:]


@pytest.fixture(scope="module")
def affected_rows():
    from db.db import get_conn
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT town_id, source_type, slug
              FROM stories
             WHERE source_type IN ('vardagsmiddag','vetenskap_kronika','kvick_essa','media_recension')
             ORDER BY town_id, slug
            """
        )
        return cur.fetchall()


def test_real_row_count_is_79_across_all_three_towns(affected_rows):
    assert len(affected_rows) == 79


def test_exactly_67_rows_still_carry_an_old_prefix(affected_rows):
    old = [slug for _, _, slug in affected_rows if OLD_PREFIX_RE.match(slug)]
    assert len(old) == 67


def test_exactly_12_rows_already_use_the_new_prefix(affected_rows):
    already_new = [slug for _, _, slug in affected_rows if not OLD_PREFIX_RE.match(slug)]
    assert len(already_new) == 12
    # All 12 are the pre-existing recipe-* rows (2026-08-23 vardagsmiddag
    # migration) -- confirm, don't assume, since a stray already-new row of
    # a DIFFERENT type here would indicate a second, undocumented migration.
    assert all(slug.startswith("recipe-") for slug in already_new)


def test_every_old_prefix_actually_changes_under_public_slug(affected_rows):
    for _, _, slug in affected_rows:
        if OLD_PREFIX_RE.match(slug):
            assert public_slug(slug) != slug, f"{slug} should be rewritten"


def test_every_already_new_slug_is_unchanged_by_public_slug(affected_rows):
    for _, _, slug in affected_rows:
        if not OLD_PREFIX_RE.match(slug):
            assert public_slug(slug) == slug, f"{slug} should be a no-op"


def test_no_two_rows_in_the_same_town_collide_on_their_public_slug(affected_rows):
    """The real correctness risk this migration could introduce: if an old-
    prefixed row and an already-new-prefixed row (or two old-prefixed rows
    of different source types) happened to compute the SAME public slug for
    the SAME town, one would silently overwrite the other's static page."""
    from collections import defaultdict
    by_town: dict[str, list[str]] = defaultdict(list)
    for town_id, _, slug in affected_rows:
        by_town[town_id].append(public_slug(slug))
    for town_id, public_slugs in by_town.items():
        duplicates = {s for s in public_slugs if public_slugs.count(s) > 1}
        assert not duplicates, f"{town_id} has colliding public slugs: {duplicates}"


def test_public_slugs_still_look_like_valid_url_path_segments(affected_rows):
    valid = re.compile(r"^[a-z0-9-]+$")
    for _, _, slug in affected_rows:
        new_slug = public_slug(slug)
        assert valid.match(new_slug), f"{new_slug!r} (from {slug!r}) is not a clean path segment"
