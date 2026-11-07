"""ai.generators.<name>.enabled: model calls whose output the site no longer reads are switched off in config (owner 2026-11-06)."""
import json
from pathlib import Path

import pytest

from ai_pipeline.generator_switch import generator_enabled

ROOT = Path(__file__).parent.parent
TOWNS = ["brookings_sd", "moreno_valley_ca", "broomfield_co", "glasgow"]
SWITCHED_OFF = ["closure_watch_prose", "project_thread_synthesis",
                "project_thread_summary", "weekly", "sports_weekly_digest", "sdsu_weekly_digest", "jackrabbits_season_digest",
                "local_sports_weekly_digest", "new_in_town_digest", "home_sales_digest", "workplace_watch_digest",
                "free_teaser_facility", "free_teaser_event"]


def test_unlisted_generators_stay_on_and_a_false_switch_turns_one_off():
    assert generator_enabled({}, "anything")
    assert generator_enabled({"ai": {}}, "anything")
    assert generator_enabled({"ai": {"generators": {"x": {"enabled": True}}}}, "x")
    assert not generator_enabled({"ai": {"generators": {"x": {"enabled": False}}}}, "x")
    assert not generator_enabled({"ai": {"generators": {"x": False}}}, "x")


@pytest.mark.parametrize("town", TOWNS)
def test_every_town_has_the_unused_generators_switched_off_with_a_reason(town):
    cfg = json.loads((ROOT / "configs" / f"{town}.json").read_text(encoding="utf-8"))
    for name in SWITCHED_OFF:
        assert not generator_enabled(cfg, name), f"{town}: {name}"
        assert cfg["ai"]["generators"][name]["_reason"], f"{town}: {name} has no reason"


def test_a_generator_that_stays_on_is_not_listed():
    cfg = json.loads((ROOT / "configs" / "moreno_valley_ca.json").read_text(encoding="utf-8"))
    assert generator_enabled(cfg, "project_thread_match") and generator_enabled(cfg, "event") and generator_enabled(cfg, "evening_register")


def test_switched_off_synthesis_makes_no_model_call_and_stores_the_plain_restatement():
    from ai_pipeline.project_threads import generate_synthesis

    class Boom:
        def __getattr__(self, name):
            raise AssertionError("the model must not be called")

    cfg = {"ai": {"generators": {"project_thread_synthesis": {"enabled": False}}}}
    assert generate_synthesis("Drain basin", "Drain basin item text", cfg, client=Boom()) == ("New item: Drain basin.", "template_fallback", True)


def test_closure_watch_prose_switch_sits_after_the_data_accrual_and_before_any_prose():
    src = (ROOT / "ai_pipeline" / "closure_watch_digest.py").read_text(encoding="utf-8")
    body = src[src.index("def main("):]
    assert body.index("record_closure_history(") < body.index('generator_enabled(cfg, "closure_watch_prose")') < body.index("generate(alert")


# Every switched-off generator must test its switch before any model client is built or used.
GUARDED = {
    "weekly": "def generate(", "sports_weekly_digest": "def generate(", "sdsu_weekly_digest": "def generate(",
    "jackrabbits_season_digest": "def generate(", "local_sports_weekly_digest": "def generate(",
    "new_in_town_digest": "def generate_roundup(", "home_sales_digest": "def generate(",
    "workplace_watch_digest": "def generate(", "free_teasers": "def generate_facility_teaser(",
    "project_threads": "def generate_rolling_summary(",
}


@pytest.mark.parametrize("module,marker", sorted(GUARDED.items()))
def test_each_switch_sits_before_the_budget_check_and_any_model_client(module, marker):
    src = (ROOT / "ai_pipeline" / f"{module}.py").read_text(encoding="utf-8")
    body = src[src.index(marker):]
    assert body.index("generator_enabled(cfg,") < body.index("_spent_this_month()") < body.index("anthropic.Anthropic()")


def test_switched_off_rolling_summary_makes_no_model_call():
    from ai_pipeline.project_threads import generate_rolling_summary

    class Boom:
        def __getattr__(self, name):
            raise AssertionError("the model must not be called")

    cfg = {"ai": {"generators": {"project_thread_summary": {"enabled": False}}}}
    text, by, _ = generate_rolling_summary("Drain basin", "- x", cfg, client=Boom())
    assert by == "template_fallback" and "Drain basin" in text
