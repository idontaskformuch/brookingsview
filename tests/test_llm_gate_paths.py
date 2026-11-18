"""G3 (owner 2026-11-18, specs/us-christmas-2026.md "Beslut steg 2"): per model path, a row from an llm_excluded source never reaches
the prompt, while the template keeps every row. The paths are switched off in ai.generators today; the tests switch them on.

Real rows (brookings_sd): events 330024 "Arts at The Oscar" (chamber = visitbrookingssd.com /events/ feed, llm_excluded) and
287184 "Lean 101 Workshop - Watertown" (chamber_business, growthzoneapp.com); meeting 15218 Brookings Disability Awareness Committee
(Legistar); sport_events 12 football vs Indiana State (internal = gojacks.com, CCBot Disallow: /); sdsu_events 17743 "SDSU Jazz
Ensembles Fall Concert"; academic date "Thanksgiving recess" (sdstate.edu/academics/...); place 85 Pioneer Park.
Robots texts: tests/fixtures/robots/. growthzoneapp.com has no fixture of its own; the test serves it downtownbrookings.txt
(AI crawlers share the `*` rules = an allowed source), the one changed input, named here.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from ai_pipeline import free_teasers, sdsu_weekly_digest, weekly
from ai_pipeline.format_prompt import GenerationUnavailable
from scrapers.llm_gate import LlmGate
from tests.test_llm_gate import ARTS_AT_THE_OSCAR, FakeFetcher

ROOT = Path(__file__).resolve().parents[1]
CHICAGO = ZoneInfo("America/Chicago")
HOSTS = {"visitbrookingssd.com": "visitbrookings", "brookingsareachamberofcommerce.growthzoneapp.com": "downtownbrookings",
         "gojacks.com": "gojacks", "www.sdstate.edu": "sdstate", "webapi.legistar.com": None}


def _cfg() -> dict:
    return json.loads((ROOT / "configs" / "brookings_sd.json").read_text(encoding="utf-8"))


def _gate(cfg: dict) -> LlmGate:
    return LlmGate(cfg, fetcher=FakeFetcher(HOSTS), api_terms=[])


LEAN_101 = {"id": 287184, "title": "Lean 101 Workshop - Watertown", "starts_at": datetime(2026, 11, 18, 14, 0, tzinfo=timezone.utc),
            "venue": "Opera Hall 100 East Kemp Ave Watertown SD 57201", "source": "chamber_business",
            "url": "https://brookingsareachamberofcommerce.growthzoneapp.com/bpnevents/Details/lean-101-workshop-watertown-1923310"
                   "?sourceTypeId=Hub", "raw_data": {}}
MEETING = {"id": 15218, "body": "Brookings Disability Awareness Committee", "meeting_date": datetime(2026, 11, 19, tzinfo=timezone.utc),
           "agenda_url": "https://cityofbrookings.legistar1.com/cityofbrookings/meetings/2026/11/3862_A_Brookings_Disability_Awareness_"
                         "Committee_26-11-19_Meeting_Agenda.pdf", "raw_data": {"EventId": 3862}}
GAME = weekly._game({"id": 12, "source": "internal", "sport": "football", "gender": "men", "program_id": "sdsu",
                     "starts_at": datetime(2026, 11, 21, 20, 0, tzinfo=timezone.utc),
                     "venue": "Brookings, S.D. (Dana J. Dykhouse Stadium)", "status": "scheduled", "time_tba": False,
                     "neutral_site": False, "exhibition": False, "home_program_id": "sdsu", "home_name": None,
                     "away_program_id": None, "away_name": "Indiana State", "score_home": None, "score_away": None})
JAZZ = {"id": 17743, "title": "SDSU Jazz Ensembles Fall Concert", "teaser": None, "location": "The Oscar Larson Performing Arts Center",
        "starts_at": datetime(2026, 11, 17, 1, 30, tzinfo=timezone.utc), "primary_category": "Music",
        "event_url": "https://www.sdstate.edu/events/2026/11/sdsu-jazz-ensembles-fall-concert"}
RECESS = {"label": "Thanksgiving recess", "category": "break", "starts_on": datetime(2026, 11, 25).date(),
          "ends_on": datetime(2026, 11, 29).date(), "source_url": "https://www.sdstate.edu/academics/academic-calendar"}


@pytest.fixture
def prompts(monkeypatch):
    """Switch every generator on, give the module a client, and capture the prompt instead of calling the API."""
    seen: list[str] = []

    def capture(client, **kw):
        seen.append(kw["system"] + "\n" + kw["messages"][0]["content"])
        raise GenerationUnavailable("test: prompt captured")

    for mod in (weekly, sdsu_weekly_digest, free_teasers):
        monkeypatch.setattr(mod, "generator_enabled", lambda *a: True)
        monkeypatch.setattr(mod, "_spent_this_month", lambda *a: 0.0)
        monkeypatch.setattr(mod, "safe_create", capture)
    return seen


def test_weekly_prompt_leaves_out_llm_excluded_rows_but_the_template_keeps_them(prompts):
    cfg = _cfg()
    data = {"meetings": [MEETING], "events": [dict(ARTS_AT_THE_OSCAR), LEAN_101], "games": [GAME]}
    text, by, _ = weekly.generate(data, "November 16-22", cfg, client=object(), gate=_gate(cfg))
    assert len(prompts) == 1
    assert "Lean 101 Workshop - Watertown" in prompts[0] and "Brookings Disability Awareness Committee" in prompts[0]
    assert "Arts at The Oscar" not in prompts[0] and "Indiana State" not in prompts[0]
    assert by == "template_fallback" and "2 community events" in text and "1 Jackrabbits game" in text


def test_weekly_with_nothing_the_model_may_see_makes_no_call(prompts):
    cfg = _cfg()
    text, by, _ = weekly.generate({"meetings": [], "events": [dict(ARTS_AT_THE_OSCAR)], "games": [GAME]}, "November 16-22", cfg,
                                  client=object(), gate=_gate(cfg))
    assert prompts == [] and by == "template_fallback"


def test_sdsu_digest_never_sends_sdstate_rows(prompts):
    cfg = _cfg()
    text, by, _ = sdsu_weekly_digest.generate([JAZZ], "November 16-22", cfg, CHICAGO, client=object(),
                                              academic_dates=[RECESS], gate=_gate(cfg))
    assert prompts == [] and by == "template_fallback" and "1 campus event" in text and "1 academic date" in text


def test_free_teaser_event_from_excluded_or_unknown_source_makes_no_call(prompts):
    cfg = _cfg()
    gate = _gate(cfg)
    assert free_teasers.generate_event_teaser("Arts at The Oscar", "x", cfg, client=object(), source="chamber", gate=gate) is None
    assert free_teasers.generate_event_teaser("Arts at The Oscar", "x", cfg, client=object(), source=None, gate=gate) is None
    assert prompts == []
    assert free_teasers.generate_event_teaser("Lean 101 Workshop - Watertown", "Lean 101 Workshop - Watertown", cfg,
                                              client=object(), source="chamber_business", gate=gate) is None  # captured, then fallback
    assert len(prompts) == 1 and "Lean 101 Workshop - Watertown" in prompts[0]


def test_free_teaser_facility_with_unreadable_robots_gets_the_template(prompts):
    cfg = _cfg()
    park = {"id": 85, "name": "Pioneer Park", "category": "park", "address": None, "hours_text": None, "description": None,
            "source_url": "https://brookingsopendata-brookingscosd.hub.arcgis.com/apps/2ee88e2cc9ec45b1bf36e18aa2fff5b2"}
    text, by = free_teasers.generate_facility_teaser(park, cfg, client=object(), gate=_gate(cfg))  # no fixture for the host
    assert prompts == [] and by == "template_fallback" and text == free_teasers.facility_template_fallback(park)
