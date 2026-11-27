"""/help/ freshness (spec .claude/specs/help-resources.md Phase 2; owner order 2026-11-27): the `help_freshness` rule kind in
scripts/watch_sources.py. One test per state transition. Pages are the real 2026-11-27 fixtures (tests/fixtures/help_sources_2026-11-27);
each failing case changes ONE thing in that page, named in the test. DB rows are built from the same page's parse (rule 15: no
hand-written values), with the one field the case is about set explicitly."""
from dataclasses import replace
from datetime import date, timedelta

from db import help_places as hp
from scrapers import help_sources as hs
from scrapers.polite_fetch import Fetched, Refused
from scripts import watch_sources as w

TODAY = date(2026, 11, 27)
FISH = hs.SOURCE_BY_ID["broomfield-fish"]
COC = hs.SOURCE_BY_ID["cross-of-christ-meals"]
NDC = hs.SOURCE_BY_ID["north-denver-cares"]


def page(src, url=None) -> bytes:
    url = url or src.url
    return (hs.FIXTURES / src.fixtures[url]).read_bytes()


def ok(src, body: bytes | None = None, url=None) -> Fetched:
    url = url or src.url
    return Fetched(url, url, 200, body if body is not None else page(src, url), "utf-8")


def results(src, body: bytes | None = None) -> dict:
    return {src.url: ok(src, body)}


def rows_as_written(src, *, status="verified", verified=TODAY - timedelta(days=7), **change) -> list[dict]:
    """The source's rows as step 1c wrote them from the same page, ids 1.. in parse order."""
    pages = {u: page(src, u) for u in src.fixtures}
    out = []
    for i, p in enumerate(hs.parse(src, pages, TODAY), 1):
        out.append({**w.row_from_parsed(p, i, status, verified, TODAY), **change})
    return out


def stored(src) -> str:
    return w.page_hash({u: page(src, u) for u in src.fixtures})


def plan(src, res, stored_hash, rows, today=TODAY, **kw):
    return w.plan_help_source(src, res, stored_hash, rows, today, **kw)


def ops(p) -> list[tuple]:
    return [(a[0], a[1] if a[0] != "write" else (a[1], a[3])) + ((a[2],) if a[0] == "status" else ()) for a in p.actions]


# --- unchanged page -------------------------------------------------------------------------------------------------------------
def test_unchanged_page_bumps_last_verified():
    rows = rows_as_written(FISH)
    p = plan(FISH, results(FISH), stored(FISH), rows)
    assert p.fetch == "ok" and p.http_status == 200 and not p.page_changed
    assert ops(p) == [("bump", ("place", "broomfield-fish"))]
    assert p.hash_action == "keep"


def test_unchanged_page_brings_a_stale_row_back_and_leaves_changed_and_gone_alone():
    for status, expected in (("stale", [("bump", ("place", "broomfield-fish"))]), ("changed", []), ("gone", [])):
        rows = rows_as_written(FISH, status=status, verified=TODAY - timedelta(days=50))
        assert ops(plan(FISH, results(FISH), stored(FISH), rows)) == expected, status


def test_unchanged_page_keeps_a_queued_row_queued():
    rows = rows_as_written(FISH, status="queued")
    p = plan(FISH, results(FISH), stored(FISH), rows)
    assert ops(p) == [("bump", ("place", "broomfield-fish"))]
    assert w.bumped_status("queued") == "queued" and w.bumped_status("stale") == "verified"


def test_the_hash_ignores_scripts_and_styles_only():
    body = page(FISH).replace(b"</body>", b"<script>var t = 1764250000;</script></body>")
    assert w.page_hash({FISH.url: body}) == stored(FISH)
    moved = page(FISH).replace(b"<strong>Monday:</strong> 12:00 pm", b"<strong>Monday:</strong> 1:00 pm")
    assert w.page_hash({FISH.url: moved}) != stored(FISH)


# --- changed page ---------------------------------------------------------------------------------------------------------------
def test_changed_page_with_valid_new_hours_updates_the_row_and_says_what_changed():
    # One change: Monday opens at 1:00 pm instead of 12:00 pm.
    body = page(FISH).replace(b"<strong>Monday:</strong> 12:00 pm", b"<strong>Monday:</strong> 1:00 pm")
    assert body != page(FISH)
    rows = rows_as_written(FISH)
    p = plan(FISH, results(FISH, body), stored(FISH), rows)
    assert p.page_changed and p.hash_action == "store"
    assert ops(p) == [("write", (("place", "broomfield-fish"), "verified"))]
    assert any("Mon 12:00-16:30" in ln and "Mon 13:00-16:30" in ln for ln in p.lines), p.lines


def test_changed_requirements_are_diffed_and_updated():
    # One change on North Denver Cares: the "Photo ID" cell becomes plain "ID" (no label any more).
    body = page(NDC).replace(b"Photo ID", b"ID")
    assert body != page(NDC)
    p = plan(NDC, results(NDC, body), stored(NDC), rows_as_written(NDC))
    assert ops(p) == [("write", (("place", "north-denver-cares"), "verified"))]
    assert any("requirements" in ln and "Photo ID; Proof of address; Proof of income" in ln
               and "-> Proof of address; Proof of income" in ln for ln in p.lines), p.lines


def test_changed_page_that_fails_validation_marks_changed_and_hides():
    # One change on Cross of Christ: the meal paragraph no longer says "All are welcome" (a meal must be free / open to all).
    body = page(COC).replace(b"All are welcome to come and serve", b"Volunteers are invited to come and serve")
    assert body != page(COC)
    p = plan(COC, results(COC, body), stored(COC), rows_as_written(COC))
    assert ops(p) == [("status", ("place", "cross-of-christ-community-meals"), "changed")]
    assert any("free or open to all" in ln for ln in p.lines), p.lines
    assert p.hash_action == "store"   # the page was read; the row stays hidden until the page changes again
    assert not hp.is_visible({"category": "meal_program", "source_kind": "operator", "verification_status": "changed",
                              "verified_date": TODAY}, TODAY)


def test_a_layout_the_parser_no_longer_reads_marks_every_row_changed_and_keeps_the_old_hash():
    body = page(FISH).replace(b"Upcoming Marketplace Closures:", b"Closures")
    p = plan(FISH, results(FISH, body), stored(FISH), rows_as_written(FISH))
    assert ops(p) == [("status", ("place", "broomfield-fish"), "changed")]
    assert p.hash_action == "keep" and any("parse error" in ln for ln in p.lines)


def test_a_queued_row_stays_queued_after_a_valid_change():
    body = page(FISH).replace(b"<strong>Monday:</strong> 12:00 pm", b"<strong>Monday:</strong> 1:00 pm")
    p = plan(FISH, results(FISH, body), stored(FISH), rows_as_written(FISH, status="queued"))
    assert ops(p) == [("write", (("place", "broomfield-fish"), "queued"))]


def test_no_stored_hash_is_read_as_changed():
    p = plan(FISH, results(FISH), None, rows_as_written(FISH))
    assert p.page_changed and p.hash_action == "store"
    assert ops(p) == [("write", (("place", "broomfield-fish"), "verified"))]
    assert any("same hours and requirements" in ln for ln in p.lines)


def test_an_entry_missing_from_the_new_page_is_gone():
    rows = rows_as_written(FISH) + [{**rows_as_written(FISH)[0], "key": ("place", "broomfield-fish-annex"), "id": 99}]
    p = plan(FISH, results(FISH), None, rows)
    assert ("status", ("place", "broomfield-fish-annex"), "gone") in ops(p)


# --- 404 / gone and unreadable --------------------------------------------------------------------------------------------------
def test_404_marks_gone_hides_and_clears_the_hash():
    for status in (404, 410):   # (an alert for it: tests/test_help_alerts.py)
        p = plan(FISH, {FISH.url: Fetched(FISH.url, FISH.url, status)}, stored(FISH), rows_as_written(FISH))
        assert p.fetch == "gone" and p.http_status == status
        assert ops(p) == [("status", ("place", "broomfield-fish"), "gone")]
        assert p.hash_action == "clear"


def test_unreadable_page_changes_nothing():
    for res in (Refused(FISH.url, "robots.txt disallows it"), Fetched(FISH.url, FISH.url, None),
                Fetched(FISH.url, FISH.url, 403), Fetched(FISH.url, FISH.url, 503)):
        p = plan(FISH, {FISH.url: res}, stored(FISH), rows_as_written(FISH))
        assert p.fetch == "unreadable" and ops(p) == [] and p.hash_action == "keep", res


# --- age and season -------------------------------------------------------------------------------------------------------------
def test_not_verified_in_45_days_is_stale_and_hidden():
    old = rows_as_written(FISH, verified=TODAY - timedelta(days=46))
    p = plan(FISH, {FISH.url: Refused(FISH.url, "no answer")}, stored(FISH), old)
    assert ops(p) == [("status", ("place", "broomfield-fish"), "stale")]
    edge = rows_as_written(FISH, verified=TODAY - timedelta(days=45))
    assert ops(plan(FISH, {FISH.url: Refused(FISH.url, "no answer")}, stored(FISH), edge)) == []
    assert ops(plan(FISH, {FISH.url: Refused(FISH.url, "x")}, stored(FISH), old, max_age_days=60)) == []


def test_a_bump_saves_a_row_from_the_age_rule():
    old = rows_as_written(FISH, verified=TODAY - timedelta(days=46))
    assert ops(plan(FISH, results(FISH), stored(FISH), old)) == [("bump", ("place", "broomfield-fish"))]


def test_a_seasonal_row_past_valid_to_is_hidden():
    rows = rows_as_written(FISH, valid_to=TODAY - timedelta(days=1))
    p = plan(FISH, {FISH.url: Refused(FISH.url, "x")}, stored(FISH), rows)
    assert ops(p) == [("expired", ("place", "broomfield-fish"))]
    assert not hp.is_visible({"category": "food_pantry", "source_kind": "operator", "verification_status": "verified",
                              "verified_date": TODAY, "valid_to": TODAY - timedelta(days=1)}, TODAY)
    on_the_day = rows_as_written(FISH, valid_to=TODAY)
    assert ops(plan(FISH, {FISH.url: Refused(FISH.url, "x")}, stored(FISH), on_the_day)) == []


# --- monthly patterns -----------------------------------------------------------------------------------------------------------
def test_monthly_pattern_gets_new_dated_rows_8_weeks_ahead():
    # Written 27 Nov (window to 22 Jan): 1 Dec, 15 Dec, 5 Jan, 19 Jan. Two weeks later (11 Dec) the window reaches 5 Feb: 2 Feb is new.
    rows = rows_as_written(COC)
    assert [d for d, _, _ in rows[0]["dates"]] == [date(2026, 12, 1), date(2026, 12, 15), date(2027, 1, 5), date(2027, 1, 19)]
    later = TODAY + timedelta(days=14)
    p = plan(COC, results(COC), stored(COC), rows, today=later)
    assert [a[0] for a in p.actions] == ["bump", "extend"]
    ext = p.actions[1]
    assert ext[1] == ("place", "cross-of-christ-community-meals")
    assert [r[0] for r in ext[2]] == [date(2027, 2, 2)] and all(r[1] is None and r[2] is None for r in ext[2])


def test_no_new_dates_on_the_same_day():
    p = plan(COC, results(COC), stored(COC), rows_as_written(COC))
    assert [a[0] for a in p.actions] == ["bump"]


# --- roles (warm_space on a place we already have) ------------------------------------------------------------------------------
WARM = hs.SOURCE_BY_ID["moval-warm"]


def warm_rows(**change):
    """moval.org/warm/ as 1c wrote it: four queued warm_space roles; place ids 1..4 in parse order."""
    pages = {WARM.url: page(WARM)}
    parsed = hs.parse(WARM, pages, TODAY)
    ids = {x.entry.slug: i for i, x in enumerate(parsed, 1)}
    # weekly/dates empty: what load_help_rows reads for a role (place_roles has no hours rows; its times are schedule_text)
    rows = [{**w.row_from_parsed(x, 100 + i, "queued", TODAY - timedelta(days=7), TODAY, place_id=i), "weekly": (), "dates": (),
             **change} for i, x in enumerate(parsed, 1)]
    return rows, (lambda x: ids.get(x.entry.slug))


def test_roles_are_bumped_and_stay_queued():
    rows, resolve = warm_rows()
    p = plan(WARM, results(WARM), stored(WARM), rows, resolve_role=resolve)
    assert ops(p) == [("bump", ("role", i, "warm_space")) for i in (1, 2, 3, 4)]


def test_a_changed_role_schedule_is_diffed_and_rewritten_queued():
    # One change: the Iris branch's Saturday closes at 5 p.m. instead of 6 p.m.
    body = page(WARM).replace(b"Sat., 10 a.m. - 6 p.m.", b"Sat., 10 a.m. - 5 p.m.")
    assert body != page(WARM)
    rows, resolve = warm_rows()
    p = plan(WARM, results(WARM, body), stored(WARM), rows, resolve_role=resolve)
    assert ("write", (("role", 4, "warm_space"), "queued")) in ops(p)
    assert any("schedule" in ln and "Sat., 10 a.m. - 5 p.m." in ln for ln in p.lines), p.lines
    # a role's times are its schedule text only: the other three roles re-read with no diff (dry run 2026-11-27 showed
    # "hours (none) -> ..." on all four: the venue's place_hours were compared with the role's times)
    assert sum("same hours and requirements" in ln for ln in p.lines) == 3, p.lines


def test_a_role_with_no_place_to_go_is_not_written():
    rows, _ = warm_rows()
    p = plan(WARM, results(WARM), None, rows, resolve_role=lambda x: None)
    assert not any(a[0] == "write" for a in p.actions)
    assert sum("no single place" in ln for ln in p.lines) == 4


# --- apply: what each action writes ---------------------------------------------------------------------------------------------
class Cur:
    def __init__(self):
        self.sql = []
        self._one = None

    def execute(self, sql, params=None):
        self.sql.append((" ".join(sql.split()), params))
        self._one = (1, "food_pantry") if sql.lstrip().startswith("SELECT id, category") else (7,)

    def fetchone(self):
        return self._one


def test_apply_writes_status_bump_extend_and_the_source_check():
    rows = rows_as_written(COC)
    p = plan(COC, results(COC), stored(COC), rows, today=TODAY + timedelta(days=14))
    cur = Cur()
    w.apply_help_plan(cur, p, {r["key"]: r for r in rows}, TODAY + timedelta(days=14))
    text = [s for s, _ in cur.sql]
    assert any(s.startswith("UPDATE places SET verified_date = %s, verification_status = CASE") for s in text)
    assert any(s.startswith("INSERT INTO place_hours") for s in text)
    assert any(s.startswith("INSERT INTO help_source_checks") for s in text)
    gone = plan(FISH, {FISH.url: Fetched(FISH.url, FISH.url, 404)}, stored(FISH), rows_as_written(FISH))
    cur = Cur()
    w.apply_help_plan(cur, gone, {r["key"]: r for r in rows_as_written(FISH)}, TODAY)
    assert ("UPDATE places SET verification_status = %s, updated_at = now() WHERE id = %s AND category = ANY(%s)",
            ("gone", 1, list(hp.HELP_CATEGORIES))) in cur.sql
    upsert = next(p for s, p in cur.sql if s.startswith("INSERT INTO help_source_checks"))
    assert upsert[3] == 404 and upsert[5] is None   # status stored, hash cleared


# --- config ---------------------------------------------------------------------------------------------------------------------
def test_every_town_has_a_weekly_help_check():
    hw = [x for x in w.load() if w.is_help_watch(x)]
    assert sorted(x["town"] for x in hw) == sorted(hp.TOWN_NAMES)
    assert all(x["weekday"] in w.WEEKDAYS for x in hw)
    assert w.due(hw[0], date(2026, 11, 30)) == (hw[0]["weekday"] == "Mon")
