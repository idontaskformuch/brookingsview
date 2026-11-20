"""scrapers/parsers/alert_center_restrictions.py (Fas 5 source 1, Broomfield fire + water restrictions).

Fixtures are excerpts of the two real category pages as read 2026-11-19 (tests/fixtures/alert_center/, markup unchanged):
fire CID=8 lists "Red Flag Warning" (November 18, 2026 6:00 PM) and "Level 1 Fire Restrictions in Effect" (November 17, 2026
6:54 PM); water CID=9 lists "Broomfield is Under a Drought Watch" (February 9, 2026 8:00 AM). Edge cases are the same real page
with the one changed thing named in the test (CLAUDE.md rule 15). The "data too old" case is the site's
(site/src/lib/restrictions.test.ts): the parser only records what it read and when.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from scrapers import polite_fetch as pf
from scrapers.parsers.alert_center_restrictions import (
    AlertCenterRestrictionsParser,
    Unrecognised,
    parse_category_page,
    should_alert,
)
from scrapers.runner import REGISTRY, _resolve_key

FIX = Path(__file__).parent / "fixtures"
FIRE_HTML = (FIX / "alert_center" / "broomfield_cid8_2026-11-19.html").read_text(encoding="utf-8")
WATER_HTML = (FIX / "alert_center" / "broomfield_cid9_2026-11-19.html").read_text(encoding="utf-8")
ROBOTS = (FIX / "robots" / "broomfield.txt").read_text(encoding="utf-8")
CONFIG = json.loads((Path(__file__).parent.parent / "configs" / "broomfield_co.json").read_text(encoding="utf-8"))
SOURCE = CONFIG["data_sources"]["restrictions"]
FIRE_URL, WATER_URL = (p["url"] for p in SOURCE["pages"])
FIRE_CAT, WATER_CAT = (p["category"] for p in SOURCE["pages"])
ROBOTS_URL = "https://broomfield.org/robots.txt"
NOW = datetime(2026, 11, 19, 23, 0, tzinfo=timezone.utc)


def _drop_li(html: str, alert_id: int) -> str:
    start = html.index(f'<li aria-labelledby="alertHeader_{alert_id}"')
    end = html.index('<li aria-labelledby="alertHeader_', start + 1) if alert_id == 88 else html.rindex("</li>") + 5
    return html[:start] + html[end:]


# The real water page with its one alert taken out and its own counter at 0 (the two changed things).
WATER_NONE_HTML = _drop_li(WATER_HTML, 92).replace('<span class="numAlerts">1  Alert</span>', '<span class="numAlerts">0  Alerts</span>')
# The real fire page with both alerts taken out and its counter at 0 (the changed things).
FIRE_NONE_HTML = _drop_li(_drop_li(FIRE_HTML, 88), 90).replace("2  Alerts</span>", "0  Alerts</span>")


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


def make_parser(routes=None, slept=None):
    parser = AlertCenterRestrictionsParser({"town_id": "broomfield_co", "timezone": "America/Denver"}, SOURCE)
    session = FakeSession(routes or {})
    parser.fetcher = pf.PoliteFetcher("source", "broomfield_co", session=session, ledger=pf.MemoryLedger(), cache_dir=None,
                                      sleep=(slept.append if slept is not None else (lambda s: None)))
    parser.now = lambda: NOW
    return parser, session


def run(routes, slept=None):
    parser, session = make_parser(routes, slept)
    fetched = parser.fetch()
    rows = {r["kind"]: r for r in parser.parse(fetched)}
    return rows, fetched, session


OK = {ROBOTS_URL: (200, ROBOTS), FIRE_URL: (200, FIRE_HTML), WATER_URL: (200, WATER_HTML)}


def test_fire_category_lists_every_active_alert_verbatim_newest_first():
    rows, fetched, _ = run(OK)
    fire = rows["fire"]
    assert fire["state"] == "active" and fire["alert_count"] == 2
    assert [(a["title"], a["since_text"]) for a in fire["alerts"]] == [
        ("Red Flag Warning", "November 18, 2026 6:00 PM"),
        ("Level 1 Fire Restrictions in Effect", "November 17, 2026 6:54 PM"),  # the alert's date, not the 4:48 PM update
    ]
    assert fire["alerts"][1]["since_at"] == "2026-11-17T18:54:00-07:00"
    assert fire["alerts"][1]["url"] == "https://broomfield.org/AlertCenter.aspx?AID=Level-1-Fire-Restrictions-in-Effect-90"
    assert (fire["title"], fire["since_text"]) == ("Red Flag Warning", "November 18, 2026 6:00 PM")  # newest repeated
    assert fire["source_url"] == FIRE_URL and fire["checked_at"] == NOW.isoformat() and fire["error"] is None
    assert fetched.docs_failed == 0


def test_newest_first_by_the_alerts_own_date_not_page_order():
    # The real fire page with its two <li> swapped (the changed thing): the order stays newest first.
    first_end = FIRE_HTML.index('<li aria-labelledby="alertHeader_90"')
    a, b = FIRE_HTML[FIRE_HTML.index('<li aria-labelledby="alertHeader_88"'):first_end], FIRE_HTML[first_end:FIRE_HTML.rindex("</li>") + 5]
    swapped = FIRE_HTML.replace(a + b, b + a)
    assert swapped != FIRE_HTML
    titles = [x["title"] for x in parse_category_page(swapped, FIRE_CAT, 8)["alerts"]]
    assert titles == ["Red Flag Warning", "Level 1 Fire Restrictions in Effect"]


def test_water_drought_watch_from_the_category_page():
    rows, _, _ = run(OK)
    water = rows["water"]
    assert (water["state"], water["title"], water["since_text"], water["alert_count"]) == (
        "active", "Broomfield is Under a Drought Watch", "February 9, 2026 8:00 AM", 1)
    assert water["alert_url"] == "https://broomfield.org/AlertCenter.aspx?AID=Broomfield-is-Under-a-Drought-Watch-92"


@pytest.mark.parametrize("kind, html", [("fire", FIRE_NONE_HTML), ("water", WATER_NONE_HTML)])
def test_no_restriction_only_when_the_category_page_itself_says_zero(kind, html):
    routes = dict(OK)
    routes[FIRE_URL if kind == "fire" else WATER_URL] = (200, html)
    rows, _, _ = run(routes)
    assert rows[kind]["state"] == "none" and rows[kind]["title"] is None and rows[kind]["alerts"] == []


@pytest.mark.parametrize("answer, reason", [
    ((500, "Server Error"), "answered 500"),
    ((403, "Forbidden"), "refused"),
    (None, "nothing (no answer)"),  # no route: ConnectionError
])
def test_fetch_failure_is_unknown_never_none(answer, reason):
    routes = {ROBOTS_URL: (200, ROBOTS), FIRE_URL: (200, FIRE_HTML)}
    if answer is not None:
        routes[WATER_URL] = answer
    rows, fetched, _ = run(routes)
    assert rows["water"]["state"] == "unknown" and reason in rows["water"]["error"]
    assert rows["water"]["title"] is None and rows["water"]["alerts"] is None
    assert rows["fire"]["state"] == "active"  # one page failing does not touch the other
    assert fetched.docs_failed == 1 and fetched.docs_attempted == 2


def test_both_pages_failing_marks_the_run_degraded():
    _, fetched, _ = run({ROBOTS_URL: (200, ROBOTS)})
    assert fetched.docs_failed == fetched.docs_attempted == 2


@pytest.mark.parametrize("change, html, expect", [
    ("category block renamed", FIRE_HTML.replace("divCat_8", "divCat_18"), "divCat_8 not found"),
    ("category heading changed", FIRE_HTML.replace(">Fire Alerts and Restrictions</h2>", ">Fire Alerts</h2>"), "category heading"),
    ("counter gone", FIRE_HTML.replace('<span class="numAlerts">2  Alerts</span>', ""), "numAlerts"),
    ("counter disagrees with the list", FIRE_HTML.replace("2  Alerts</span>", "3  Alerts</span>"), "counter says 3"),
    ("counter 0 but alerts listed", FIRE_HTML.replace("2  Alerts</span>", "0  Alerts</span>"), "counter says 0"),
    ("an alert no longer marked 'on'", FIRE_HTML.replace('class="alert on first"', 'class="alert first"'), "not marked active"),
    ("title element gone", FIRE_HTML.replace('<h3 id="alertHeader_90">', '<h4 id="alertHeader_90">'), "h3 title"),
    ("date in another format", FIRE_HTML.replace("November 18, 2026 6:00 PM", "18/11/2026 18:00"), "is not"),
    ("not HTML at all", "\x00\x01 not a page", "divCat_8 not found"),
])
def test_changed_page_is_unknown_not_none_and_not_a_crash(change, html, expect):
    with pytest.raises(Unrecognised, match=expect):
        parse_category_page(html, FIRE_CAT, 8)
    rows, _, _ = run({**OK, FIRE_URL: (200, html)})
    assert rows["fire"]["state"] == "unknown", change
    assert "page structure changed" in rows["fire"]["error"] and expect in rows["fire"]["error"]
    assert rows["water"]["state"] == "active"


def test_crawl_delay_10_between_pages_and_only_configured_urls():
    slept: list[float] = []
    _, _, session = run(OK, slept)
    assert session.calls == [ROBOTS_URL, FIRE_URL, WATER_URL]
    assert len([s for s in slept if s > 9.0]) >= 2  # robots -> fire and fire -> water, each about 10 s


def test_config_reads_two_category_pages_and_no_disallowed_path():
    assert REGISTRY[_resolve_key(SOURCE, "restrictions")].endswith(":AlertCenterRestrictionsParser")
    assert [(p["kind"], p["cid"]) for p in SOURCE["pages"]] == [("fire", 8), ("water", 9)]
    for page in SOURCE["pages"]:
        path = page["url"].split("broomfield.org", 1)[1].lower()
        assert path.startswith(f"/alertcenter.aspx?cid=") and path.endswith(f"-{page['cid']}")
        for denied in ("/rss.aspx", "/civicalerts.aspx", "/calendar.aspx", "/map.aspx", "/common/modules/icalendar/"):
            assert not path.startswith(denied)


# --- 72 h unknown alert ----------------------------------------------------------------------------------------------------

def test_should_alert_once_per_unknown_streak_after_72_hours():
    start = NOW - timedelta(hours=73)
    assert should_alert("unknown", start, False, NOW) is True
    assert should_alert("unknown", start, True, NOW) is False             # this streak already alerted
    assert should_alert("unknown", NOW - timedelta(hours=72), False, NOW) is False  # exactly 72 h: not yet
    assert should_alert("active", start, False, NOW) is False             # streak ended by a good check
    assert should_alert("unknown", None, None, NOW) is False


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params):
        self.conn.executed.append((sql, params))

    def fetchone(self):
        return self.conn.answers.pop(0)


class FakeConn:
    """Answers the streak query in order (one tuple per configured page)."""
    def __init__(self, answers):
        self.answers, self.executed = list(answers), []

    def cursor(self):
        return FakeCursor(self)


def test_after_upsert_sends_one_alert_and_marks_the_row_only_when_delivered():
    parser, _ = make_parser()
    sent = []
    parser.send_alert = lambda msg, title=None, priority="default": sent.append((msg, title, priority)) or True
    start = NOW - timedelta(hours=80)
    conn = FakeConn([("unknown", 41, start, False, "fire: answered 500"), ("active", 42, None, None, None)])
    parser.after_upsert(conn)
    assert len(sent) == 1 and "fire restrictions: status unknown for 80 h" in sent[0][0] and sent[0][2] == "high"
    assert FIRE_URL in sent[0][0]
    updates = [(sql, p) for sql, p in conn.executed if sql.startswith("UPDATE")]
    assert updates == [("UPDATE restriction_checks SET alert_sent_at = %s WHERE id = %s", (NOW, 41))]

    # next run, same streak, row now marked: no second alert
    sent.clear()
    parser.after_upsert(FakeConn([("unknown", 43, start, True, "fire: answered 500"), ("active", 44, None, None, None)]))
    assert sent == []


def test_after_upsert_undelivered_alert_is_not_marked_and_never_raises():
    parser, _ = make_parser()
    parser.send_alert = lambda *a, **k: False
    conn = FakeConn([("unknown", 41, NOW - timedelta(hours=80), False, None), ("unknown", 42, NOW - timedelta(hours=1), False, None)])
    parser.after_upsert(conn)
    assert not any(sql.startswith("UPDATE") for sql, _ in conn.executed)
    parser.after_upsert(FakeConn([]))  # a broken query answer: logged, not raised


def _insert_params_adapt(records, jsonb_columns):
    """Every INSERT parameter upsert_records builds must be adaptable by psycopg (no DB needed: psycopg's own Transformer)."""
    from unittest.mock import MagicMock

    from psycopg.adapt import PyFormat, Transformer

    from db.db import upsert_records
    cur = MagicMock()
    cur.rowcount = 1
    cur.__enter__.return_value = cur
    conn = MagicMock()
    conn.cursor.return_value = cur
    upsert_records(conn, "restriction_checks", "broomfield_co", records, jsonb_columns=jsonb_columns)
    tx = Transformer()
    inserts = [c.args for c in cur.execute.call_args_list if c.args[0].startswith("INSERT")]
    assert len(inserts) == len(records)
    dumped = []
    for sql, params in inserts:
        cols = sql[sql.index("(") + 1:sql.index(")")].split(", ")
        row = {}
        for col, value in zip(cols, params):
            if value is not None:
                row[col] = tx.get_dumper(value, PyFormat.AUTO).dump(value)  # raises ProgrammingError when it cannot adapt
        dumped.append(row)
    return dumped


@pytest.mark.parametrize("routes", [OK, {**OK, WATER_URL: (200, WATER_NONE_HTML)}], ids=["active", "water-none"])
def test_parsed_rows_reach_the_database_with_alerts_as_jsonb(routes):
    # Born 2026-11-20: the first live run (11:00 UTC) failed "cannot adapt type 'dict'" -- the alerts list went to psycopg raw.
    # An empty list must be JSON [] (a raw Python [] would have become '{}', an object).
    parser, _ = make_parser(routes)
    records = parser.parse(parser.fetch())
    rows = {bytes(r["kind"]).decode(): r for r in _insert_params_adapt(records, parser.jsonb_columns)}
    assert json.loads(bytes(rows["fire"]["alerts"]))[0]["title"] == "Red Flag Warning"
    expected_water = [] if routes is not OK else ["Broomfield is Under a Drought Watch"]
    assert [a["title"] for a in json.loads(bytes(rows["water"]["alerts"]))] == expected_water
