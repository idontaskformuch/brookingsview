"""Model choice (owner 2026-10-23, .claude/spec-model-choice.md): Haiku for all AI text until a site earns revenue, ONE line to upgrade."""
from ai_pipeline import format_prompt as fp


def test_haiku_by_default_and_sonnet_only_for_events_and_meetings():
    assert fp.TEXT_MODEL == fp.HAIKU
    assert fp.DEFAULT_MODEL == fp.TEXT_MODEL
    sonnet_types = {t for t, m in fp.CONTENT_TYPE_MODELS.items() if m == fp.SONNET}
    assert sonnet_types == {"event", "meeting"}  # owner 2026-10-24
    assert fp.resolve_model("meeting_followup") == fp.SONNET
    assert {m for t, m in fp.CONTENT_TYPE_MODELS.items() if t not in sonnet_types} == {fp.HAIKU}


def test_town_config_model_cannot_keep_a_type_on_a_dearer_model():
    cfg = {"ai": {"model": fp.SONNET}}
    for t in ["weekly", "editorial", "free_teaser_event", "project_thread_match", "unknown_type", None]:
        assert fp.resolve_model(t, cfg) == fp.TEXT_MODEL
    assert fp.resolve_model("event", {"ai": {"model": fp.HAIKU}}) == fp.SONNET


def test_a_per_type_override_wins_and_nothing_else_changes(monkeypatch):
    monkeypatch.setitem(fp.CONTENT_TYPE_MODEL_OVERRIDES, "editorial", fp.SONNET)
    assert fp.resolve_model("editorial") == fp.SONNET
    assert fp.resolve_model("weekly") == fp.TEXT_MODEL


def test_content_base_follows_the_central_default():
    import content._base as base
    assert base.DEFAULT_MODEL == fp.TEXT_MODEL
