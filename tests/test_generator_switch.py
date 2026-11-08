"""ai.generators.<name>.enabled FAILS CLOSED (owner 2026-11-07): a generator that is not listed, or not listed as exactly true, makes no model call.
Every generator that should run has an explicit `enabled: true` in every town config; this file checks both halves."""
import json
import re
from pathlib import Path

import pytest

from ai_pipeline.generator_switch import generator_enabled

ROOT = Path(__file__).parent.parent
TOWNS = ["brookings_sd", "moreno_valley_ca", "broomfield_co", "glasgow"]
CONFIGS = {t: json.loads((ROOT / "configs" / f"{t}.json").read_text(encoding="utf-8")) for t in TOWNS}

# Running in production (scrape workflows): must be an explicit true everywhere, or nothing is written.
ON_EVERYWHERE = ["meeting", "event", "alert", "project_thread_match"]
SWITCHED_OFF = ["closure_watch_prose", "project_thread_synthesis",
                "project_thread_summary", "weekly", "sports_weekly_digest", "sdsu_weekly_digest",
                "local_sports_weekly_digest", "new_in_town_digest", "home_sales_digest", "workplace_watch_digest",
                "free_teaser_facility", "free_teaser_event", "new_in_town_extraction", "meeting_followups",
                "vardagsmiddag", "media_recension", "vetenskap_kronika", "kvick_essa", "editorial", "culture_essay", "illustrations"]
# The format_record() source types publish.py passes (SOURCES + alerts) and the content-track types generate_article() is called with.
DYNAMIC_NAMES = {"meeting", "event", "alert", "vardagsmiddag", "media_recension", "vetenskap_kronika", "kvick_essa", "editorial", "culture_essay"}
# Workflow steps and config keys removed by the owner 2026-11-07; modules remain, and fail-closed keeps them off without a key.
REMOVED = {"event_deck_digest", "whats_on_intro"}
CODE_DIRS = ["ai_pipeline", "content", "scripts", "scrapers"]


class Boom:
    def __getattr__(self, name):
        raise AssertionError("the model must not be called")


def _py_files():
    for d in CODE_DIRS:
        yield from (ROOT / d).rglob("*.py")


def test_a_missing_or_not_true_entry_is_off_and_only_an_explicit_true_is_on():
    assert not generator_enabled({}, "anything")
    assert not generator_enabled({"ai": {}}, "anything")
    assert not generator_enabled({"ai": {"generators": {}}}, "x")
    assert not generator_enabled({"ai": {"generators": {"x": {}}}}, "x")
    assert not generator_enabled({"ai": {"generators": {"x": {"_reason": "no enabled key"}}}}, "x")
    assert not generator_enabled({"ai": {"generators": {"x": {"enabled": False}}}}, "x")
    assert not generator_enabled({"ai": {"generators": {"x": {"enabled": "true"}}}}, "x")
    assert not generator_enabled({"ai": {"generators": {"x": False}}}, "x")
    assert generator_enabled({"ai": {"generators": {"x": {"enabled": True}}}}, "x")
    assert generator_enabled({"ai": {"generators": {"x": True}}}, "x")


@pytest.mark.parametrize("town", TOWNS)
def test_every_switch_name_used_in_code_is_listed_explicitly_in_every_town_with_a_reason(town):
    used = set(DYNAMIC_NAMES)
    for f in _py_files():
        used |= set(re.findall(r'generator_enabled\(\s*cfg(?: or \{\})?,\s*"([a-z_]+)"', f.read_text(encoding="utf-8")))
    used -= REMOVED
    listed = CONFIGS[town]["ai"]["generators"]
    missing = sorted(n for n in used if not isinstance(listed.get(n), dict) or "enabled" not in listed[n])
    assert not missing, f"{town}: generators with no explicit enabled entry (they would be OFF): {missing}"
    for n in used:
        assert listed[n].get("_reason"), f"{town}: {n} has no _reason"


@pytest.mark.parametrize("town", TOWNS)
def test_the_generators_that_run_in_production_are_explicitly_true(town):
    for name in ON_EVERYWHERE:
        assert CONFIGS[town]["ai"]["generators"][name]["enabled"] is True, f"{town}: {name}"
        assert generator_enabled(CONFIGS[town], name)


@pytest.mark.parametrize("town", TOWNS)
def test_removed_generators_have_no_key_and_are_off(town):
    for name in REMOVED:
        assert name not in CONFIGS[town]["ai"]["generators"]
        assert not generator_enabled(CONFIGS[town], name)


def test_evening_register_is_on_exactly_where_the_town_has_a_register():
    for town, cfg in CONFIGS.items():
        has = bool((cfg.get("evening_register") or {}).get("venues"))
        assert generator_enabled(cfg, "evening_register") is has, town


@pytest.mark.parametrize("town", TOWNS)
def test_every_switched_off_generator_is_off_with_a_reason(town):
    for name in SWITCHED_OFF:
        assert not generator_enabled(CONFIGS[town], name), f"{town}: {name}"
        assert CONFIGS[town]["ai"]["generators"][name]["_reason"], f"{town}: {name} has no reason"


def test_every_module_that_calls_the_model_checks_a_switch():
    callers = {"api_usage.py", "search_client.py"}  # logging only / Brave Search: no model call
    offenders = []
    for f in _py_files():
        src = f.read_text(encoding="utf-8")
        if f.name in callers or "def safe_create" in src and "format_record" not in src:
            continue
        if re.search(r"safe_create\(|anthropic\.Anthropic\(", src) and "generator_enabled(" not in src:
            offenders.append(str(f.relative_to(ROOT)))
    assert not offenders, f"model-calling modules with no generator_enabled check: {offenders}"


def test_format_record_with_no_switch_entry_makes_no_model_call_and_falls_back():
    from ai_pipeline.format_prompt import format_record
    cfg = {"town_id": "brookings_sd", "display_name": "Brookings", "state": "SD", "timezone": "America/Chicago", "ai": {"monthly_budget_usd": 20}}
    record = {"id": 1, "title": "City Council", "meeting_date": "2026-11-10", "agenda_text": "Item 1"}
    result = format_record(record, "meeting", cfg, client=Boom())
    assert result.generated_by != "ai"


def test_project_thread_match_with_no_switch_entry_makes_no_model_call():
    from ai_pipeline.project_threads import ai_match_candidate as match_candidate
    out = match_candidate("Drain basin work", [{"id": 1, "title": "Drain basin", "summary": "x"}], {"ai": {}}, client=Boom())
    assert out["match_project_id"] is None and out["reasoning"] == "generator switched off"


def test_generate_article_with_no_switch_entry_makes_no_model_call():
    from content._base import generate_article
    assert generate_article("sys", "input", [], cfg={"ai": {}}, client=Boom(), content_type="editorial") is None


def test_meeting_followups_with_no_switch_entry_makes_no_model_call():
    from ai_pipeline.meeting_followups import generate
    text, by, _ = generate({"ai": {}}, "City Council", "Nov 10", "minutes text", client=Boom())
    assert by == "template_fallback"


def test_new_in_town_extraction_with_no_switch_entry_makes_no_model_call():
    from ai_pipeline.new_in_town_digest import extract_records
    assert extract_records({"ai": {}}, [{"title": "t", "url": "u", "description": "d"}], Boom()) == []


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
    "local_sports_weekly_digest": "def generate(",
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


def test_illustrations_with_no_switch_entry_or_off_make_no_provider_call(monkeypatch, tmp_path):
    from content.illustrations import generate_illustration as gi

    def boom(*a, **k):
        raise AssertionError("the image provider must not be called")

    monkeypatch.setattr(gi, "_PROVIDERS", {gi.IMAGE_API_PROVIDER: boom})
    assert gi.generate_illustration("theme", "slug", out_dir=tmp_path) is None  # no cfg at all
    assert gi.generate_illustration("theme", "slug", out_dir=tmp_path, cfg={"ai": {}}) is None
    off = {"ai": {"generators": {"illustrations": {"enabled": False}}}}
    assert gi.generate_illustration("theme", "slug", out_dir=tmp_path, cfg=off) is None
    assert list(tmp_path.iterdir()) == []


def test_illustrations_on_reaches_the_provider(monkeypatch, tmp_path):
    from content.illustrations import generate_illustration as gi

    called = []

    def fake(model_id, prompt):
        called.append(prompt)
        raise RuntimeError("stop here")  # past the switch; generate_illustration swallows it and returns None

    monkeypatch.setattr(gi, "_PROVIDERS", {gi.IMAGE_API_PROVIDER: fake})
    monkeypatch.setattr(gi.api_usage, "log_usage", lambda **k: None)
    on = {"ai": {"generators": {"illustrations": {"enabled": True}}}}
    assert gi.generate_illustration("theme", "slug", out_dir=tmp_path, cfg=on) is None
    assert len(called) == 1


def test_every_caller_of_generate_illustration_passes_cfg():
    for rel in ["ai_pipeline/daily_content.py", "scripts/backfill_content_track_image.py"]:
        src = (ROOT / rel).read_text(encoding="utf-8")
        calls = re.findall(r"= generate_illustration\((.*)\)$", src, re.M)
        assert calls and all("cfg=cfg" in c for c in calls), rel
