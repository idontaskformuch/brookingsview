"""Model gate (scrapers/llm_gate.py) + structured meta (ai_pipeline/structured_meta.py) + publish_table wiring.

Owner 2026-11-18 (specs/us-christmas-2026.md "Beslut steg 2", G1/G2/G4). Rows are real: events 330024 "Arts at The Oscar" and 325662
"Gifting for Good" (brookings_sd, chamber = visitbrookingssd.com ICS), 332817 "Discover Journaling" (brookings_sd, library = LibCal
ICS), 332882 "The Pogs!" (broomfield_co, chippers_100_nickel = tribe REST). robots.txt texts are the live fixtures in
tests/fixtures/robots/.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

import pytest

from ai_pipeline import publish, structured_meta
from scrapers import robots
from scrapers.llm_gate import LlmGate, load_api_terms

ROOT = Path(__file__).resolve().parents[1]
FX = Path(__file__).parent / "fixtures" / "robots"
CHICAGO = ZoneInfo("America/Chicago")
DENVER = ZoneInfo("America/Denver")


def _cfg(town: str) -> dict:
    return json.loads((ROOT / "configs" / f"{town}.json").read_text(encoding="utf-8"))


class FakeFetcher:
    """robots_verdict() from a live fixture per host; any host without a fixture raises (closed when unsure)."""

    def __init__(self, by_host: dict[str, str]):
        self.by_host = by_host
        self.calls: list[str] = []

    def robots_verdict(self, url: str):
        self.calls.append(url)
        host = url.split("/")[2]
        if host not in self.by_host:
            raise ConnectionError(f"no robots.txt for {host} in this test")
        if self.by_host[host] is None:  # the host answers 404 for robots.txt (live: webapi.legistar.com, 2026-11-18)
            return robots.verdict(404, None, url)
        return robots.verdict(200, (FX / f"{self.by_host[host]}.txt").read_text(encoding="utf-8"), url)


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s).astimezone(timezone.utc)


ARTS_AT_THE_OSCAR = {
    "id": 330024, "town_id": "brookings_sd", "title": "Arts at The Oscar",
    "starts_at": _ts("2026-11-20 23:30:00+00:00"), "ends_at": _ts("2026-11-21 04:00:00+00:00"),
    "venue": "Oscar Larson Performing Arts Center, 1601 University Boulevard, Brookings, SD, 57007", "source": "chamber",
    "url": "https://visitbrookingssd.com/event/arts-at-the-oscar-2/",
    "raw_data": {"uid": "10020966-1795195800-1795212000@visitbrookingssd.com",
                 "categories": ["Entertainment", "Family Friendly", "Live Music", "University"],
                 "description": "Join us for an evening celebrating the arts! Enjoy appetizers, drinks, live music from The Oak Lake "
                                "String Band and Monarch Aerial Arts during the social hour, followed by community performances and "
                                "visual art showcases throughout the Oscar Larson Performing Arts Center. The evening continues with a "
                                "short recognition ceremony in the Oscar Larson Theatre and followed by live music and dancing "
                                "featuring The Oscar All-Star Band. \nCost: Public $20, Children (18 & Under) $10, SDSU Students Free"},
    "content_hash": "h330024",
}
GIFTING_FOR_GOOD = {
    "id": 325662, "town_id": "brookings_sd", "title": "Gifting for Good",
    "starts_at": _ts("2026-11-19 06:00:00+00:00"), "ends_at": _ts("2026-11-22 06:00:00+00:00"),
    "venue": "521 4th St, Brookings, SD 57006", "source": "chamber",
    "url": "https://visitbrookingssd.com/event/gifting-for-good-6/",
    "raw_data": {"uid": "10020509-1795046400-1795305599@visitbrookingssd.com", "categories": ["Shopping"],
                 "description": "Get your holiday shopping done early and shop local at these unique mission-driven museum gift shops "
                                "from Thursday, Nov. 19, to Saturday, Nov. 21. \nParticipating Gift Shops: "},
}
DISCOVER_JOURNALING = {
    "id": 332817, "town_id": "brookings_sd", "title": "Discover Journaling",
    "starts_at": _ts("2027-01-05 00:00:00+00:00"), "ends_at": _ts("2027-01-05 01:30:00+00:00"),
    "venue": None, "source": "library", "url": "https://brookingslibrary.libcal.com/event/18027845",
    "raw_data": {"uid": "LibCal-19943-18027845",
                 "description": "Learn about various methods of journaling, such as bullet journaling, junk journaling, reflective "
                                "journaling, and more! Each participant will receive some supplies and will have time to start "
                                "personalizing their journals after the presentation. Register starting February 2."},
}
THE_POGS = {
    "id": 332882, "town_id": "broomfield_co", "title": "The Pogs!",
    "starts_at": _ts("2027-02-26 02:00:00+00:00"), "ends_at": _ts("2027-02-26 05:00:00+00:00"),
    "venue": "100 Nickel at Chipper's Lanes, 100 Nickel St, Broomfield, CO 80020", "source": "chippers_100_nickel",
    "url": "https://chipperslanes.com/event/the-pogs_5/",
    "raw_data": {"uid": "15682", "cost": None, "categories": ["Broomfield", "Live Music"],
                 "ticket_url": "https://chipperslanes.thundertix.com/events/274316", "description": None},
}


# --- the gate ---------------------------------------------------------------------------------------------------------------------
def test_chamber_feed_is_llm_excluded_by_gptbots_events_rule():
    gate = LlmGate(_cfg("brookings_sd"), fetcher=FakeFetcher({"visitbrookingssd.com": "visitbrookings"}), api_terms=[])
    assert gate.blocked_reason("events", ARTS_AT_THE_OSCAR) == "events:chamber: llm_excluded (gptbot: Disallow: /events/)"


def test_an_allowed_source_passes_and_robots_is_read_once_per_source():
    # downtownbrookings.txt: the AI crawlers share the `*` rules -> not llm_excluded. Stand-in host for an allowed source.
    cfg = _cfg("brookings_sd")
    cfg["data_sources"]["events"]["sources"].append({"name": "downtown", "kind": "ical",
                                                     "url": "https://www.downtownbrookings.com/festival-of-lights"})
    fetcher = FakeFetcher({"www.downtownbrookings.com": "downtownbrookings"})
    gate = LlmGate(cfg, fetcher=fetcher, api_terms=[])
    row = {**ARTS_AT_THE_OSCAR, "source": "downtown"}
    assert gate.blocked_reason("events", row) is None
    assert gate.blocked_reason("events", row) is None
    assert len(fetcher.calls) == 1


def test_sdsu_and_gojacks_fixtures_are_llm_excluded_ccbot_included():
    gate = LlmGate({"town_id": "brookings_sd"}, fetcher=FakeFetcher({"gojacks.com": "gojacks", "sdstate.edu": "sdstate"}), api_terms=[])
    v1 = gate._fetch().robots_verdict("https://gojacks.com/sports/football/schedule/text")
    v2 = gate._fetch().robots_verdict("https://sdstate.edu/event-calendar")
    assert (v1.llm_excluded, v1.ai_bot) == (True, "ccbot") and (v2.llm_excluded, v2.ai_bot) == (True, "gptbot")


def test_closed_when_unsure():
    cfg = _cfg("brookings_sd")
    gate = LlmGate(cfg, fetcher=FakeFetcher({}), api_terms=[])
    assert gate.blocked_reason("events", {**ARTS_AT_THE_OSCAR, "source": None}).startswith("source unknown")
    assert gate.blocked_reason("events", {**ARTS_AT_THE_OSCAR, "source": "not_in_config"}) == \
        "events:not_in_config: no fetch URL in the town config"
    assert gate.blocked_reason("events", DISCOVER_JOURNALING) == "events:library: robots.txt not read (ConnectionError)"
    assert gate.blocked_reason("meetings", {"raw_data": {"agenda_text": "x"}}).startswith("source unknown")


def test_api_terms_sources_come_from_config_and_skip_robots():
    terms = load_api_terms()
    assert {t["host"] for t in terms} >= {"app.ticketmaster.com", "api.adzuna.com", "statsapi.mlb.com", "api.sportmonks.com"}
    cfg = {"town_id": "glasgow", "data_sources": {"events": {"sources": [
        {"name": "tm", "kind": "ticketmaster", "url": "https://app.ticketmaster.com/discovery/v2/events.json"}]}}}
    fetcher = FakeFetcher({})
    assert LlmGate(cfg, fetcher=fetcher).blocked_reason("events", {"source": "tm"}) is None
    assert fetcher.calls == []


def test_meeting_rows_are_placed_by_their_format():
    gate = LlmGate(_cfg("brookings_sd"), fetcher=FakeFetcher({}), api_terms=[])
    assert gate.key_for("meetings", {"raw_data": {"EventId": 1}}) == "meetings:city_meetings"
    assert gate.key_for("meetings", {"raw_data": {"place": "x"}}) == "meetings:county_meetings"
    assert gate.source_url("meetings:city_meetings") == "https://webapi.legistar.com/v1/cityofbrookings"
    g2 = LlmGate(_cfg("broomfield_co"), fetcher=FakeFetcher({}), api_terms=[])
    assert g2.key_for("meetings", {"raw_data": {"clientId": 1}}) == "meetings:city_meetings"
    assert g2.source_url("meetings:city_meetings") == "https://api.agendalink.app/api/session/all/broomfield"


# --- structured meta ----------------------------------------------------------------------------------------------------------------
def test_ics_mapping_venue_and_labelled_cost():
    assert structured_meta.meta_from_source(ARTS_AT_THE_OSCAR, "ical", CHICAGO) == {
        "venue": "Oscar Larson Performing Arts Center, 1601 University Boulevard, Brookings, SD, 57007",
        "cost": "Public $20, Children (18 & Under) $10, SDSU Students Free",
    }


def test_ics_mapping_multi_day_when_with_exclusive_midnight_end():
    # The source text says "from Thursday, Nov. 19, to Saturday, Nov. 21"; DTEND is Sunday 00:00 local.
    assert structured_meta.meta_from_source(GIFTING_FOR_GOOD, "ical", CHICAGO) == {
        "venue": "521 4th St, Brookings, SD 57006", "when": "Nov 19 – Nov 21"}


def test_ics_mapping_leaves_missing_fields_empty():
    # LibCal never sends LOCATION; "Register starting February 2." is not a labelled cost line.
    assert structured_meta.meta_from_source(DISCOVER_JOURNALING, "ical", CHICAGO) == {}


def test_tribe_mapping_venue_and_ticket_url():
    assert structured_meta.meta_from_source(THE_POGS, "tribe_rest", DENVER) == {
        "venue": "100 Nickel at Chipper's Lanes, 100 Nickel St, Broomfield, CO 80020",
        "registration": "https://chipperslanes.thundertix.com/events/274316"}
    assert structured_meta.meta_from_source({**THE_POGS, "raw_data": {**THE_POGS["raw_data"], "free": True}},
                                            "tribe_rest", DENVER)["cost"] == "Free"


def test_unknown_format_maps_nothing():
    assert structured_meta.meta_from_source(ARTS_AT_THE_OSCAR, "glasgow_life", CHICAGO) == {}


# --- publish_table: a gated row never reaches format_record ------------------------------------------------------------------------
def _conn(rows):
    cur = MagicMock()
    cur.fetchall.return_value = rows
    cur.fetchone.return_value = None
    cur.__enter__.return_value = cur
    cur.__exit__.return_value = False
    conn = MagicMock()
    conn.cursor.return_value = cur
    return conn, cur


def _patch(monkeypatch, calls):
    monkeypatch.setattr(publish, "load_given_up_records", lambda *a: {})
    monkeypatch.setattr(publish, "load_registry", lambda *a: {})
    monkeypatch.setattr(publish, "has_substance", lambda *a: True)
    monkeypatch.setattr(publish, "is_current", lambda *a: True)
    monkeypatch.setattr(publish, "already_has_a_story", lambda *a: False)
    monkeypatch.setattr(publish, "_recent_openings", lambda *a: [])
    monkeypatch.setattr(publish, "format_record", lambda *a, **k: calls.append(a) or (_ for _ in ()).throw(RuntimeError("model called")))


def test_llm_excluded_event_never_reaches_format_record(monkeypatch, capsys):
    calls: list = []
    _patch(monkeypatch, calls)
    cfg = _cfg("brookings_sd")
    gate = LlmGate(cfg, fetcher=FakeFetcher({"visitbrookingssd.com": "visitbrookings"}), api_terms=[])
    conn, cur = _conn([dict(ARTS_AT_THE_OSCAR)])
    slugs: set[str] = set()
    out = publish.publish_table(conn, cfg, "events", slugs, gate=gate)
    assert calls == []
    assert out[0] == 1 and "event-330024" in slugs
    assert "NO MODEL event-330024  (events:chamber: llm_excluded (gptbot: Disallow: /events/))" in capsys.readouterr().out
    insert = next(c for c in cur.execute.call_args_list if "INSERT INTO stories" in c.args[0])
    params = insert.args[1]
    assert "Arts at The Oscar at Oscar Larson Performing Arts Center, 1601 University Boulevard, Brookings, SD, 57007." in params
    assert "template" in params
    meta = next(p.obj for p in params if type(p).__name__ == "Jsonb")
    assert meta["cost"] == "Public $20, Children (18 & Under) $10, SDSU Students Free"


def test_allowed_event_still_goes_to_format_record(monkeypatch):
    calls: list = []
    _patch(monkeypatch, calls)
    cfg = _cfg("brookings_sd")
    cfg["data_sources"]["events"]["sources"].append({"name": "downtown", "kind": "ical",
                                                     "url": "https://www.downtownbrookings.com/festival-of-lights"})
    gate = LlmGate(cfg, fetcher=FakeFetcher({"www.downtownbrookings.com": "downtownbrookings"}), api_terms=[])
    conn, _ = _conn([{**ARTS_AT_THE_OSCAR, "source": "downtown"}])
    with pytest.raises(RuntimeError, match="model called"):
        publish.publish_table(conn, cfg, "events", set(), gate=gate)
    assert len(calls) == 1
