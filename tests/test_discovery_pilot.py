"""Source discovery pilot (scripts/discovery_pilot.py, configs/shared/discovery_pilot.json; owner 2026-11-18).

Every value comes from a real row (CLAUDE.md rule 15): the Brookings library LibCal feed (fetched 2026-11-18, the three rows
LibCal 18027845 / 18027811 / 18027797), Chipper's Lanes' tribe REST answer (2026-11-13) and its 100 Nickel live-music page with
four schema.org Events (2026-11-13), robots.txt files in tests/fixtures/robots/, and facility coordinates from data/facilities/.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from scrapers import robots
from scrapers.polite_fetch import Fetched, MemoryLedger, PoliteFetcher
from scripts import discovery_pilot as dp

FIX = Path(__file__).parent / "fixtures"
CFG = dp.load_config()
NOW = datetime(2026, 11, 18, 21, 0, tzinfo=timezone.utc)


def facility(town: str, slug: str) -> tuple[float, float]:
    data = json.loads((Path("data/facilities") / f"{town}.json").read_text(encoding="utf-8"))
    rows = data if isinstance(data, list) else data.get("facilities", [])
    row = next(r for r in rows if isinstance(r, dict) and r.get("slug") == slug)
    return row["lat"], row["lon"]


# --- config limits ---------------------------------------------------------------------------------------------------------------
def test_brave_cap_is_40_per_town_and_day_and_never_exceeded():
    assert CFG["brave"]["max_queries_per_town_per_day"] == 40
    calls = []

    class Session:
        def get(self, url, params=None, headers=None, timeout=None):
            calls.append(params["q"])

            class R:
                def raise_for_status(self):
                    pass

                def json(self):
                    return {"web": {"results": []}}
            return R()

    many = [f"q{i}" for i in range(100)]
    _, run, _ = dp.brave_candidates(Session(), many, "key", 20, "US", CFG["brave"]["max_queries_per_town_per_day"], sleep=lambda s: None)
    assert len(calls) == len(run) == 40


def test_queries_for_day_skips_earlier_queries_and_out_of_season():
    nov = dp.queries_for_day(CFG, "brookings_sd", set(), date(2026, 11, 20))
    assert "Brookings SD christmas market" in nov and len(nov) <= 40
    assert dp.queries_for_day(CFG, "brookings_sd", set(nov), date(2026, 11, 21)) == []
    assert "Brookings SD christmas market" not in dp.queries_for_day(CFG, "brookings_sd", set(), date(2027, 6, 1))


def test_run_dates_gate(capsys):
    dp.cmd_gate(CFG, date.fromisoformat(CFG["run_dates"][0]))
    assert "run=true" in capsys.readouterr().out
    dp.cmd_gate(CFG, date.fromisoformat(CFG["run_dates"][-1]).replace(day=int(CFG["run_dates"][-1][-2:]) + 1))
    assert "run=false" in capsys.readouterr().out


def test_nearby_radius_equals_the_site_rule():
    ts = Path("site/src/lib/town-boundary.ts").read_text(encoding="utf-8")
    assert float(re.search(r"NEARBY_RADIUS_MILES = (\d+)", ts).group(1)) == CFG["admission"]["nearby_radius_miles"]


# --- radius rule ------------------------------------------------------------------------------------------------------------------
def test_in_area_inside_boundary_nearby_and_outside():
    lat, lon = facility("brookings_sd", "public-library")
    bk = dp.town_config("brookings_sd")["coordinates"]
    assert dp.in_area(lat, lon, bk, dp.load_boundary("brookings_sd"), 25)
    # Farm House Collective lies outside Moreno Valley's boundary, 6.8 miles from the centre: nearby = in area
    flat, flon = facility("moreno_valley_ca", "farm-house-collective")
    mv = dp.load_boundary("moreno_valley_ca")
    assert not dp.in_boundary(flat, flon, mv)
    assert dp.in_area(flat, flon, dp.town_config("moreno_valley_ca")["coordinates"], mv, 25)
    # the Brookings library is hundreds of miles from Broomfield
    assert not dp.in_area(lat, lon, dp.town_config("broomfield_co")["coordinates"], dp.load_boundary("broomfield_co"), 25)


# --- exclusions -------------------------------------------------------------------------------------------------------------------
def test_existing_sources_social_and_own_sites_are_never_candidates():
    known = dp.known_hosts(dp.town_config("brookings_sd"))
    blocked = dp.blocked_hosts()
    assert dp.exclusion("brookingslibrary.libcal.com", CFG, known, blocked) == "already a source in the town's config"
    assert dp.exclusion(dp.host_of("https://www.visitbrookingssd.com/events/"), CFG, known, blocked)
    assert dp.exclusion("m.facebook.com", CFG, known, blocked)
    assert dp.exclusion("brookingsview.com", CFG, known, blocked)
    assert dp.exclusion("1stbankcenter.com", CFG, known, blocked) == "scripts/blocked-domains.json"
    assert dp.exclusion("chipperslanes.com", CFG, known, blocked) is None


# --- formats ----------------------------------------------------------------------------------------------------------------------
def test_jsonld_events_from_a_real_page():
    page = (FIX / "discovery" / "chipperslanes_100nickel_live_music_2026-11-13.html").read_text(encoding="utf-8")
    events = dp.events_from_jsonld(dp.jsonld_events(page))
    assert [e["title"] for e in events] == ["**FREE** Workingman’s Wednesdays ft. Aoxomoxoa", "Polysanto w/ The Risky Bets",
                                           "Lionel Young Blues Band (2 sets!)", "Colorado Rocks w/ Electric Flannel"]
    assert events[0]["start"] == "2026-12-02T18:30:00-07:00"
    assert events[0]["venue"] == "Broomfield, 100 Nickel St, Broomfield, CO, 80020"
    assert events[0]["address"] == "100 Nickel St, Broomfield, CO, 80020"  # geocoded without the place name (Nominatim finds it)


def test_ics_rows_from_the_real_libcal_feed_have_no_place():
    body = (FIX / "discovery" / "brookings_library_libcal_2026-11-18.ics").read_bytes()
    events = {e["url"].rsplit("/", 1)[-1]: e for e in dp.events_from_ics(body, "America/Chicago")}
    e = events["18027845"]
    assert e["title"] == "Discover Journaling" and e["venue"] is None
    assert e["start"] == "2027-01-05T00:00:00+00:00"  # DTSTART:20270105T000000Z, as events row 332817 stores it
    assert {"18027811", "18027797"} <= set(events)


def test_tribe_events_from_the_real_chippers_answer():
    body = (FIX / "chippers_tribe_rest_2026-11-13.json").read_text(encoding="utf-8")
    events = dp.events_from_tribe(body)
    raw = json.loads(body)["events"][0]
    assert events[0]["title"] and events[0]["start"].startswith(raw["start_date"].replace(" ", "T"))
    assert events[0]["venue"].startswith("Greeley, 2454 8th Ave, Greeley")


def test_ics_link_and_google_embed_detection():
    page = ('<link rel="alternate" type="text/calendar" href="/events/?ical=1">'
            '<iframe src="https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com&ctz=America/Chicago"></iframe>')
    links = dp.ics_links(page, "https://visitbrookingssd.com/")
    assert links[0] == ("ics", "https://visitbrookingssd.com/events/?ical=1")
    assert links[1] == ("google_calendar", "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics")


# --- probe through polite_fetch (no network: a session that serves fixtures) ------------------------------------------------------
class FixtureSession:
    def __init__(self, routes: dict[str, tuple[int, bytes]]):
        self.routes, self.asked = routes, []

    def get(self, url, headers=None, timeout=None, allow_redirects=True, stream=True):
        self.asked.append(url)
        status, body = next((v for k, v in self.routes.items() if url.startswith(k)), (404, b""))

        class R:
            pass
        r = R()
        r.status_code, r.url, r.headers, r.content, r.raw, r.encoding = status, url, {}, body, None, "utf-8"
        return r


def fetcher_for(routes, tmp_path):
    return PoliteFetcher("dryrun", "broomfield_co", session=FixtureSession(routes), ledger=MemoryLedger(), cache_dir=tmp_path,
                         sleep=lambda s: None, clock=lambda: NOW)


def test_probe_follows_the_spec_order_tribe_first(tmp_path):
    tribe = (FIX / "chippers_tribe_rest_2026-11-13.json").read_bytes()
    f = fetcher_for({"https://chipperslanes.com/robots.txt": (404, b""),
                     "https://chipperslanes.com/wp-json/tribe/events/v1/events": (200, tribe)}, tmp_path)
    p = dp.probe(f, {"host": "chipperslanes.com", "url": "https://chipperslanes.com/"}, CFG, NOW.date())
    assert (p["result"], p["format"]) == ("found", "tribe_rest")
    assert not any(u.rstrip("/").endswith("/events") and "wp-json" not in u for u in f.session.asked)  # stopped at step 2


def test_probe_ical_link_before_jsonld(tmp_path):
    page = (FIX / "discovery" / "chipperslanes_100nickel_live_music_2026-11-13.html").read_bytes()
    f = fetcher_for({"https://chipperslanes.com/robots.txt": (404, b""), "https://chipperslanes.com/events": (200, page),
                     "https://chipperslanes.com/": (200, b"<html><body>home</body></html>")}, tmp_path)
    p = dp.probe(f, {"host": "chipperslanes.com", "url": "https://chipperslanes.com/"}, CFG, NOW.date())
    # the real page has both an iCal export link (The Events Calendar) and four JSON-LD Events: iCal comes first in the spec
    assert (p["result"], p["format"], p["feed_url"]) == ("found", "ics", "https://chipperslanes.com/events/?ical=1")


def test_probe_finds_jsonld_when_the_ical_links_are_gone(tmp_path):
    page = (FIX / "discovery" / "chipperslanes_100nickel_live_music_2026-11-13.html").read_text(encoding="utf-8")
    no_ical = re.sub(r'href="[^"]*ical[^"]*"', 'href="#"', page)  # the one change: the page without its iCal links
    f = fetcher_for({"https://chipperslanes.com/robots.txt": (404, b""), "https://chipperslanes.com/events": (200, no_ical.encode()),
                     "https://chipperslanes.com/": (200, b"<html><body>home</body></html>")}, tmp_path)
    p = dp.probe(f, {"host": "chipperslanes.com", "url": "https://chipperslanes.com/"}, CFG, NOW.date())
    assert (p["result"], p["format"], p["feed_url"]) == ("found", "jsonld", "https://chipperslanes.com/events")


def test_probe_closed_by_robots_and_old_strict_column(tmp_path):
    visit = (FIX / "robots" / "visitbrookings.txt").read_bytes()
    f = fetcher_for({"https://visitbrookingssd.com/robots.txt": (200, visit)}, tmp_path)
    p = dp.probe(f, {"host": "visitbrookingssd.com", "url": "https://visitbrookingssd.com/"}, CFG, NOW.date())
    assert p["old_strict_ai_bot"] == "gptbot"  # names GPTBot: the old strict mode refused the whole host
    assert p["result"] != "closed"  # the current mode reads the `*` group, which allows /
    down = (FIX / "robots" / "downtownbrookings.txt").read_text(encoding="utf-8")
    assert robots.names_ai_bot(down) and robots.verdict(200, down, "https://downtownbrookings.com/festival-of-lights").ok


# --- Fas 3 rules ------------------------------------------------------------------------------------------------------------------
def test_judge_libcal_rows_no_place_means_not_in_area():
    body = (FIX / "discovery" / "brookings_library_libcal_2026-11-18.ics").read_bytes()
    events = dp.events_from_ics(body, "America/Chicago")
    st = dp.judge_events(events, lambda text: None, dp.town_config("brookings_sd")["coordinates"], dp.load_boundary("brookings_sd"),
                         CFG["admission"], NOW)
    assert st["events"] == len(events) and st["in_area_share"] == 0.0 and st["reasonable_share"] == 1.0


def test_date_rules_on_a_real_row():
    acfg = CFG["admission"]
    start = "2027-01-05T00:00:00+00:00"  # Discover Journaling (LibCal 18027845, events row 332817)
    assert dp.date_reasonable(start, NOW, acfg)
    assert not dp.date_reasonable(start.replace("2027", "1970"), NOW, acfg)  # only the year changed
    assert not dp.date_reasonable(start.replace("2027", "2028"), NOW, acfg)  # more than 12 months ahead
    assert not dp.date_reasonable(None, NOW, acfg)


def test_admission_needs_three_consecutive_days_and_80_percent():
    acfg = CFG["admission"]
    src = {"format": "jsonld", "in_area_share": 1.0, "reasonable_share": 1.0, "duplicate_share": 0.0,
           "consecutive_ok_days": dp.longest_consecutive_days(["2026-11-20", "2026-11-21", "2026-11-22"])}
    assert dp.admission(src, acfg) == (True, [])
    gap = {**src, "consecutive_ok_days": dp.longest_consecutive_days(["2026-11-20", "2026-11-22"])}
    assert not dp.admission(gap, acfg)[0]
    assert not dp.admission({**src, "in_area_share": 0.79}, acfg)[0]
    assert not dp.admission({**src, "duplicate_share": 0.51}, acfg)[0]


def test_duplicate_share_between_sources():
    page = (FIX / "discovery" / "chipperslanes_100nickel_live_music_2026-11-13.html").read_text(encoding="utf-8")
    ev = dp.events_from_jsonld(dp.jsonld_events(page))
    shares = dp.duplicate_shares({"chipperslanes.com": ev, "copy.example": ev[:1]})
    assert shares == {"chipperslanes.com": 0.25, "copy.example": 1.0}


def test_day_writes_no_database(monkeypatch, tmp_path):
    """A full day for one town with no network: the pilot never imports the db module's connection."""
    import db.db as dbmod
    monkeypatch.setattr(dbmod, "connect", lambda *a, **k: pytest.fail("the pilot opened a database connection"))
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    f = fetcher_for({}, tmp_path)
    day = dp.cmd_day(CFG, "brookings_sd", None, tmp_path / "out", NOW, fetcher=f, session=object())
    assert day["brave_calls"] == 0 and (tmp_path / "out" / "day-brookings_sd-2026-11-18.json").is_file()


def _day(d: str, events: list[dict]) -> dict:
    st = dp.judge_events([dict(e) for e in events], lambda text: (39.918863, -105.088526),  # Nominatim 2026-11-18: 100 Nickel St
                         dp.town_config("broomfield_co")["coordinates"], dp.load_boundary("broomfield_co"), CFG["admission"], NOW)
    return {"town_id": "broomfield_co", "date": d, "generated_utc": NOW.isoformat(), "brave_calls": 0, "excluded": {},
            "candidates": {"chipperslanes.com": {"host": "chipperslanes.com", "source": "osm"}},
            "probes": {"chipperslanes.com": {"result": "found", "format": "jsonld", "feed_url": "https://chipperslanes.com/events",
                                             "old_strict_ai_bot": None}},
            "fetches": {"chipperslanes.com": {"format": "jsonld", "ok": True, "reason": "", "stats": st, "events": events}}}


def test_report_admits_only_after_three_days_in_a_row():
    page = (FIX / "discovery" / "chipperslanes_100nickel_live_music_2026-11-13.html").read_text(encoding="utf-8")
    ev = dp.events_from_jsonld(dp.jsonld_events(page))
    two = dp.town_report([_day("2026-11-20", ev), _day("2026-11-21", ev)], CFG)
    assert two["admitted"] == 0 and "2 successful day(s) in a row < 3" in two["sources"][0]["why_not"]
    three = dp.town_report([_day("2026-11-20", ev), _day("2026-11-21", ev), _day("2026-11-22", ev)], CFG)
    assert three["admitted"] == 1 and three["admitted_upcoming_events"] == 4 and len(three["examples"]) == 4
    assert "| chipperslanes.com | jsonld |" in dp.render_markdown([three])
