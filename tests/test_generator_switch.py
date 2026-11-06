"""ai.generators.<name>.enabled: model calls whose output the site no longer reads are switched off in config (owner 2026-11-06)."""
import json
from pathlib import Path

import pytest

from ai_pipeline.generator_switch import generator_enabled

ROOT = Path(__file__).parent.parent
TOWNS = ["brookings_sd", "moreno_valley_ca", "broomfield_co", "glasgow"]
SWITCHED_OFF = ["event_deck_digest", "whats_on_intro", "closure_watch_prose", "project_thread_synthesis"]


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


def _whats_on_cfg(town="moreno_valley_ca"):
    cfg = json.loads((ROOT / "configs" / f"{town}.json").read_text(encoding="utf-8"))
    cfg.setdefault("features", {})["whats_on"] = {"enabled": True, "ticketmaster": {"enabled": True, "marquee_size": 6}}
    return cfg


@pytest.mark.parametrize("module", ["event_deck_digest", "whats_on_intro"])
def test_a_switched_off_digest_returns_before_any_network_or_database_use(module, tmp_path, monkeypatch, capsys):
    import importlib
    mod = importlib.import_module(f"ai_pipeline.{module}")
    cfg = _whats_on_cfg()
    path = tmp_path / "cfg.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")
    for var in ("TICKETMASTER_API_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr("sys.argv", [module, "--config", str(path)])
    assert mod.main() == 0
    assert "switched off" in capsys.readouterr().out


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
