"""scrapers/parsers/capital_projects.py (Fas 5 source 2, Broomfield capital improvement projects; owner 2026-11-20).

Fixtures are the real list page and three real project pages as read 2026-11-20 (tests/fixtures/capital_projects/, trimmed to
div#moduleContent, markup unchanged): the list links 27 projects; "10th at Birch Intersection Improvements" (page 4536),
"Broomfield Police Building Expansion" (4390, a prose timeline and a cost line) and "Varra Park Hillside Stabilization" (4537,
"Final Design: November - January 2027", "Construction: TBD"). Every edge case is one of these real pages with the one changed
thing named in the test (CLAUDE.md rule 15).
"""
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from scrapers import polite_fetch as pf
from scrapers import runner
from scrapers.parsers.capital_projects import (
    BODY_NEW, BODY_REMOVED, CapitalProjectsParser, Listed, PageResult, Stored, Unrecognised, extract_page, extracted_hash,
    failure_streak_alert, names_specific_day, parse_dates, visible_timeline, parse_list, parse_timeline_line, plan_changes, summary_sentence,
)

FIX = Path(__file__).parent / "fixtures"
CP = FIX / "capital_projects"
LIST_HTML = (CP / "list.html").read_text(encoding="utf-8")
BIRCH_HTML = (CP / "birch.html").read_text(encoding="utf-8")
POLICE_HTML = (CP / "police.html").read_text(encoding="utf-8")
VARRA_HTML = (CP / "varra.html").read_text(encoding="utf-8")
ROBOTS = (FIX / "robots" / "broomfield.txt").read_text(encoding="utf-8")
CONFIG = json.loads((Path(__file__).parent.parent / "configs" / "broomfield_co.json").read_text(encoding="utf-8"))
SOURCE = CONFIG["data_sources"]["capital_projects"]
LIST_URL = SOURCE["list_url"]
NOW = datetime(2026, 11, 20, 11, 0, tzinfo=timezone.utc)
LISTED = parse_list(LIST_HTML, LIST_URL, SOURCE["list_heading"])
BY_ID = {item.page_id: item for item in LISTED}
PAGES = {4536: BIRCH_HTML, 4390: POLICE_HTML, 4537: VARRA_HTML}


def _pages(overrides=None):
    """A PageResult for every listed project: the three real pages where we have them, the Varra page for the rest (the hash
    differs by nothing that matters here: each project's stored row is built from the same result)."""
    html = {**PAGES, **(overrides or {})}
    return {item.page_id: PageResult(extracted=extract_page(html.get(item.page_id, VARRA_HTML))) for item in LISTED}


def _stored_from(plan_rows):
    return {r["page_id"]: Stored(i + 1, r["page_id"], r["slug"], r["title"], r["source_hash"], r["timeline"], r["cost_text"], None)
            for i, r in enumerate(plan_rows)}


def _baseline():
    plan = plan_changes({}, LISTED, _pages(), set())
    return plan, _stored_from(plan.upserts)


# --- list and page reading ------------------------------------------------------------------------------------------------------
def test_list_has_27_projects_with_the_citys_own_links():
    assert len(LISTED) == 27
    assert LISTED[0] == Listed(4536, "10th at Birch Intersection Improvements",
                               "https://www.broomfield.org/4536/10th-at-Birch-Intersection-Improvements")
    # An editor link exactly as the City's list has it: kept, never rewritten into a guessed cleaner address.
    assert BY_ID[4537].url == ("https://www.broomfield.org/4537/104107/Varra-Park-Hillside-Stabilization"
                               "?activeLiveTab=widgets#liveEditTab_widgets")
    assert BY_ID[4374].url == "https://broomfield.org/4374/2025-Parking-Lot-Renovations"  # no www on the list: same host


def test_project_page_fields_verbatim_and_no_contact_block():
    birch = extract_page(BIRCH_HTML)
    assert birch["title"] == "10th at Birch Intersection Improvements"
    assert birch["timeline"] == [
        "Final Design: May - September 2026",
        "Utility Coordination and Relocation: July 2026 - April 2027",
        "Winter 2026: The budget, scope, prioritization and timing of the project are being re-evaluated due to the planned "
        "closure of Birch Elementary School.",
    ]
    assert summary_sentence(birch["info"]) == (
        "The 10th Avenue at Birch Street intersection improvements project aims to improve safety around the Birch Elementary School.")
    police = extract_page(POLICE_HTML)
    assert police["cost"][0].startswith("The project is anticipated to cost $81.6M.")
    for html in (BIRCH_HTML, POLICE_HTML, VARRA_HTML):  # owner decision B: names, department, e-mail, phone never read
        dumped = json.dumps(extract_page(html))
        for needle in ("Zogorski", "Katie Allen", "@broomfield.org", "303.464", "CIP Project Manager", "Contact Us"):
            assert needle not in dumped


def test_summary_sentence_only_when_25_words_or_fewer():
    # Varra's first sentence is 29 words: no summary at all, never a shortened one.
    assert summary_sentence(extract_page(VARRA_HTML)["info"]) is None


# --- owner addition 1: hash on extracted content ---------------------------------------------------------------------------------
def test_hash_ignores_cms_tokens_and_timestamps():
    # The real Varra page with its CMS version id, editor/widget ids changed and a timestamp comment added (the changed things).
    changed = (VARRA_HTML.replace('value="104107"', 'value="104999"')
               .replace("divEditorfd5e0109-d762-4de9-9cca-206fa41955a2", "divEditor00000000-0000-0000-0000-000000000000")
               .replace('data-widgetcontainerid="fb7d06ac', 'data-widgetcontainerid="aaaaaaaa')
               .replace("<h1", "<!-- generated 2026-11-21T11:00:03Z --><h1", 1))
    assert changed != VARRA_HTML
    assert extracted_hash(extract_page(changed)) == extracted_hash(extract_page(VARRA_HTML))


def test_hash_changes_when_a_timeline_line_changes():
    changed = VARRA_HTML.replace("Construction: TBD", "Construction: Spring 2027")
    assert extracted_hash(extract_page(changed)) != extracted_hash(extract_page(VARRA_HTML))


# --- owner addition 3: dates, never guessed -------------------------------------------------------------------------------------
def test_november_january_2027_is_nov_2026_to_jan_2027():
    assert parse_dates("November - January 2027") == (date(2026, 11, 1), date(2027, 1, 31))
    line = parse_timeline_line("Final Design: November - January 2027")  # Varra, verbatim
    assert (line["label"], line["start"], line["end"], line["completed"]) == ("Final Design", "2026-11-01", "2027-01-31", False)


@pytest.mark.parametrize("text, expected", [
    ("May - September 2026", (date(2026, 5, 1), date(2026, 9, 30))),          # Birch
    ("July 2026 - April 2027", (date(2026, 7, 1), date(2027, 4, 30))),        # Birch
    ("May - June2026", (date(2026, 5, 1), date(2026, 6, 30))),                # Varra, missing space as on the page
    ("July - October 2026", (date(2026, 7, 1), date(2026, 10, 31))),
])
def test_real_ranges(text, expected):
    assert parse_dates(text) == expected


@pytest.mark.parametrize("text", [
    "November - January",          # no year anywhere: no reading at all
    "Summer 2026",                 # a season: not guessed into months
    "Winter 2026",
    "May",
    "approximately 20 months",
    "Q3 2026",
])
def test_unreadable_dates_give_nothing(text):
    assert parse_dates(text) is None


def test_completed_tbd_and_prose_lines():
    done = parse_timeline_line("Preliminary Design: July - October 2026 (Completed)")
    assert done["completed"] is True and done["end"] == "2026-10-31"
    assert parse_timeline_line("Construction: TBD")["tbd"] is True
    prose = parse_timeline_line(extract_page(POLICE_HTML)["timeline"][0])  # "... from 5-6:30 pm ..." has a colon, not a phase
    assert (prose["label"], prose["start"], prose["tbd"]) == (None, None, False)
    assert prose["text"].startswith("A public (neighborhood) meeting is scheduled for Wednesday, May 6th")


# --- change plan ----------------------------------------------------------------------------------------------------------------
def test_first_run_is_a_baseline_without_new_updates():
    plan, _ = _baseline()
    assert len(plan.upserts) == 27 and plan.updates == [] and plan.delist == []
    assert plan.reparsed == 27
    assert {r["slug"] for r in plan.upserts} >= {"10th-at-birch-intersection-improvements", "varra-park-hillside-stabilization"}


def test_unchanged_page_is_not_interpreted_again():
    _, stored = _baseline()
    plan = plan_changes(stored, LISTED, _pages(), set())
    assert plan.updates == [] and plan.reparsed == 0
    assert all(r["checked"] and r["unchanged"] for r in plan.upserts)


def test_new_project_on_the_list():
    # Baseline without the Birch project (the changed thing), then the real list: Birch is new.
    plan0 = plan_changes({}, [i for i in LISTED if i.page_id != 4536], _pages(), set())
    plan = plan_changes(_stored_from(plan0.upserts), LISTED, _pages(), {r["slug"] for r in plan0.upserts})
    assert plan.updates == [{"page_id": 4536, "change_kind": "new", "body": BODY_NEW}]


def test_changed_phase_is_a_dated_update_with_the_citys_words():
    _, stored = _baseline()
    # The real Varra page with its Final Design line changed (the changed thing).
    changed = VARRA_HTML.replace("Final Design: November - January 2027", "Final Design: December 2026 - February 2027")
    plan = plan_changes(stored, LISTED, _pages({4537: changed}), set())
    assert plan.updates == [{"page_id": 4537, "change_kind": "phase_changed", "body":
                             'Timeline line changed from "Final Design: November - January 2027" to '
                             '"Final Design: December 2026 - February 2027"'}]
    varra = next(r for r in plan.upserts if r["page_id"] == 4537)
    assert varra["timeline"][2]["start"] == "2026-12-01"


def test_removed_project():
    _, stored = _baseline()
    plan = plan_changes(stored, [i for i in LISTED if i.page_id != 4390], _pages(), set())
    assert plan.delist == [4390]
    assert plan.updates == [{"page_id": 4390, "change_kind": "removed", "body": BODY_REMOVED}]


def test_list_losing_more_than_half_is_a_broken_list_not_27_removals():
    _, stored = _baseline()
    with pytest.raises(Unrecognised):
        plan_changes(stored, LISTED[:5], _pages(), set())


# --- broken / changed HTML ----------------------------------------------------------------------------------------------------
def test_broken_list_html():
    with pytest.raises(Unrecognised):
        parse_list(LIST_HTML.replace("Current Capital Improvement Projects		</h1>", "Capital Projects</h1>"), LIST_URL,
                   SOURCE["list_heading"])
    with pytest.raises(Unrecognised):
        parse_list("<html><body><p>Down for maintenance</p></body></html>", LIST_URL, SOURCE["list_heading"])


def test_broken_project_page_keeps_last_data():
    _, stored = _baseline()
    with pytest.raises(Unrecognised):
        extract_page(BIRCH_HTML.replace('id="moduleContent"', 'id="content"'))
    pages = _pages()
    pages[4536] = PageResult(error="page structure changed: div#moduleContent not found")
    plan = plan_changes(stored, LISTED, pages, set())
    birch = next(r for r in plan.upserts if r["page_id"] == 4536)
    assert birch["checked"] is False and "timeline" not in birch  # last good data and last_checked_at stay
    assert plan.updates == []


class FakeSession:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def get(self, url, headers, timeout, allow_redirects, stream):
        self.calls.append(url)
        if url not in self.routes:
            raise ConnectionError("no route")
        status, body = self.routes[url]

        class R:
            status_code = status
            content = body.encode() if isinstance(body, str) else body
            encoding = "utf-8"
            headers = {}
            raw = None
        R.url = url
        return R()


def _parser(routes):
    parser = CapitalProjectsParser({"town_id": "broomfield_co"}, SOURCE)
    parser.fetcher = pf.PoliteFetcher("source", "broomfield_co", session=FakeSession(routes), ledger=pf.MemoryLedger(),
                                      cache_dir=None, sleep=lambda s: None)
    parser.now = lambda: NOW
    return parser


def _routes(list_html=LIST_HTML):
    routes = {"https://www.broomfield.org/robots.txt": (200, ROBOTS), "https://broomfield.org/robots.txt": (200, ROBOTS),
              LIST_URL: (200, list_html)}
    for item in LISTED:
        for url in (item.url, item.url.split("#")[0]):  # requests drops the #fragment; the fake session may see either
            routes[url] = (200, PAGES.get(item.page_id, VARRA_HTML))
    return routes


def test_fetch_reads_list_and_every_project_page_once():
    parser = _parser(_routes())
    fetched = parser.fetch()
    assert fetched.docs_attempted == 28 and fetched.docs_failed == 0
    assert len(parser.pages) == 27 and all(p.extracted for p in parser.pages.values())
    calls = parser.fetcher.session.calls
    assert calls.count(LIST_URL) == 1 and len([c for c in calls if "robots.txt" not in c]) == 28


def test_fetch_with_broken_list_counts_a_failure_and_reads_nothing_else():
    parser = _parser(_routes("<html><body><div id='moduleContent'><h1>Page Not Found</h1></div></body></html>"))
    fetched = parser.fetch()
    assert parser.listed is None and fetched.docs_failed == 1 and "list page structure changed" in fetched.docs_last_error
    assert len([c for c in parser.fetcher.session.calls if "robots.txt" not in c]) == 1


# --- 72 h alert ------------------------------------------------------------------------------------------------------------------
def _runs(*specs):
    return [{"id": 100 - i, "status": s, "docs_failed": f, "started_at": NOW - timedelta(days=i), "alert_sent_at": a}
            for i, (s, f, a) in enumerate(specs)]


def test_alert_after_72_hours_of_failures_once_per_streak():
    failing = _runs(("running", 0, None), ("degraded", 1, None), ("ok", 2, None), ("ok", 1, None), ("error", 0, None),
                    ("ok", 0, None))
    assert failure_streak_alert(failing, True, NOW) is True              # 4 days of failures (> 72 h)
    assert failure_streak_alert(failing[:4] + failing[5:], True, NOW) is False  # exactly 72 h: not more than 72 h
    assert failure_streak_alert(failing[:3], True, NOW) is False         # 2 days: not yet
    sent = _runs(("running", 0, None), ("ok", 1, NOW - timedelta(hours=1)), ("ok", 1, None), ("ok", 1, None), ("ok", 0, None))
    assert failure_streak_alert(sent, True, NOW) is False                # already alerted in this streak
    assert failure_streak_alert(failing, False, NOW) is False            # this run went fine


def test_runner_registry_and_daily_gate(monkeypatch):
    assert runner._resolve_key(SOURCE, "capital_projects") == "capital_projects"
    assert SOURCE["run_at_utc_hours"] == [11] and SOURCE["refresh_minutes"] >= 12 * 60

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 20, 23, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(runner, "datetime", Clock)
    called = []
    monkeypatch.setattr(runner.db, "start_run", lambda *a: called.append(a))
    runner.run_source(object(), {"town_id": "broomfield_co"}, "capital_projects", SOURCE)
    assert called == []  # the 23:00 UTC run skips the source without a run row


# --- the DB layer, through a recording fake connection --------------------------------------------------------------------------
class FakeConn:
    """Answers the parser's SELECTs from `stored` rows and records every other statement."""

    def __init__(self, stored_rows=(), slugs=(), runs=()):
        self.stored_rows, self.slugs, self.runs, self.sql = list(stored_rows), list(slugs), list(runs), []
        self._next_id = 1000

    def transaction(self):
        import contextlib
        return contextlib.nullcontext()

    def cursor(self):
        conn = self

        class Cur:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def execute(self, query, params=()):
                conn.sql.append((" ".join(query.split()), params))
                q = query.lstrip()
                if "FROM projects WHERE town_id = %s AND source_type" in " ".join(query.split()):
                    self._rows = conn.stored_rows
                elif q.startswith("SELECT slug FROM projects"):
                    self._rows = [(s,) for s in conn.slugs]
                elif "FROM scrape_runs" in query:
                    self._rows = conn.runs
                elif "RETURNING id" in query:
                    conn._next_id += 1
                    self._rows = [(conn._next_id,)]
                else:
                    self._rows = []

            def fetchall(self):
                return self._rows

            def fetchone(self):
                return self._rows[0]
        return Cur()


def _run_after_upsert(conn, routes=None):
    parser = _parser(routes or _routes())
    parser.source_key = "capital_projects"
    sent = []
    parser.send_alert = lambda msg, **kw: sent.append(msg) or True
    parser.fetch()
    parser.after_upsert(conn)
    return parser, sent


def test_after_upsert_baseline_inserts_27_projects_and_no_updates():
    conn = FakeConn(slugs=["palisade-park-chipotle-mexican-grill"])
    _run_after_upsert(conn)
    inserts = [p for q, p in conn.sql if q.startswith("INSERT INTO projects")]
    assert len(inserts) == 27 and not [q for q, _ in conn.sql if q.startswith("INSERT INTO project_updates")]
    birch = next(p for p in inserts if p[1] == "10th-at-birch-intersection-improvements")
    assert birch[4] == "cip_page" and birch[5] == BY_ID[4536].url and json.loads(birch[7])[0]["text"] == "Final Design: May - September 2026"


def test_after_upsert_writes_dated_updates_for_a_removed_project():
    plan, stored = _baseline()
    rows = [(s.id, s.slug, s.title, BY_ID[s.page_id].url, s.source_hash, s.timeline, s.cost_text, None) for s in stored.values()]
    routes = _routes(LIST_HTML.replace('href="https://www.broomfield.org/4390/Broomfield-Police-Building-Expansion"', 'href="#"'))
    conn = FakeConn(stored_rows=rows)
    _run_after_upsert(conn, routes)
    updates = [p for q, p in conn.sql if q.startswith("INSERT INTO project_updates")]
    assert [(u[1], u[2], u[3]) for u in updates] == [("cip_page", "removed", BODY_REMOVED)] and updates[0][4] == NOW
    assert any(q.startswith("UPDATE projects SET status = 'delisted'") for q, _ in conn.sql)


def test_after_upsert_broken_list_writes_nothing_and_alerts_after_72_h():
    runs = [(200, "running", 0, NOW, None)] + [(200 - i, "degraded", 1, NOW - timedelta(days=i), None) for i in range(1, 5)]
    conn = FakeConn(runs=runs)
    _, sent = _run_after_upsert(conn, _routes("<html><body><div id='moduleContent'><h1>Page Not Found</h1></div></body></html>"))
    assert not [q for q, _ in conn.sql if q.startswith(("INSERT", "UPDATE projects"))]
    assert len(sent) == 1 and "more than 72 h" in sent[0]
    assert any(q.startswith("UPDATE scrape_runs SET alert_sent_at") for q, _ in conn.sql)


# --- owner 2026-11-20 before push: free-text lines naming a specific day are hidden ------------------------------------------
def test_police_meeting_line_hidden_season_lines_kept():
    police = [l["text"] for l in visible_timeline(extract_page(POLICE_HTML)["timeline"])]
    assert police == ["Construction is anticipated to start in Summer 2026 and take approximately 20 months to complete."]
    birch = [l["text"] for l in visible_timeline(extract_page(BIRCH_HTML)["timeline"])]
    assert birch[-1].startswith("Winter 2026: The budget, scope, prioritization and timing of the project are being re-evaluated")
    assert len(birch) == 3
    assert len(visible_timeline(extract_page(VARRA_HTML)["timeline"])) == 4  # phases with dates and TBD are never hidden


@pytest.mark.parametrize("text, hidden", [
    # The real Police meeting line, then the same line with only its date written differently (the changed thing).
    ("A public (neighborhood) meeting is scheduled for Wednesday, May 6th from 5-6:30 pm in the Elmwood 1 Conference Room at the "
     "Broomfield Community Center (280 Spader Way) .", True),
    ("A public (neighborhood) meeting is scheduled for May 6 from 5-6:30 pm in the Elmwood 1 Conference Room.", True),
    ("A public (neighborhood) meeting is scheduled for 6 May from 5-6:30 pm in the Elmwood 1 Conference Room.", True),
    ("A public (neighborhood) meeting is scheduled for 5/6/2026 from 5-6:30 pm in the Elmwood 1 Conference Room.", True),
    ("Winter 2026: The budget, scope, prioritization and timing of the project are being re-evaluated due to the planned "
     "closure of Birch Elementary School.", False),
    ("Construction is anticipated to start in Summer 2026 and take approximately 20 months to complete.", False),
    ("Construction is anticipated to start in May 2026 and take approximately 20 months to complete.", False),  # month + year only
])
def test_specific_day_rule(text, hidden):
    assert names_specific_day(parse_timeline_line(text)) is hidden


def test_hidden_line_never_becomes_a_change():
    # Baseline, then the real Police page: its meeting line is never stored, so it never shows as "Timeline line added".
    _, stored = _baseline()
    plan = plan_changes(stored, LISTED, _pages(), set())
    police = next(r for r in plan.upserts if r["page_id"] == 4390)
    assert police.get("unchanged") is True and plan.updates == []
