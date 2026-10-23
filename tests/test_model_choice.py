"""Model choice (owner 2026-10-23, .claude/spec-model-choice.md): Haiku for all AI text until a site earns revenue, ONE line to upgrade."""
from ai_pipeline import format_prompt as fp


def test_every_text_type_runs_on_the_one_central_model():
    assert fp.TEXT_MODEL == fp.HAIKU
    assert set(fp.CONTENT_TYPE_MODELS.values()) == {fp.TEXT_MODEL}
    assert fp.DEFAULT_MODEL == fp.TEXT_MODEL


def test_town_config_model_cannot_keep_a_type_on_a_dearer_model():
    cfg = {"ai": {"model": fp.SONNET}}
    for t in list(fp.CONTENT_TYPE_MODELS) + ["free_teaser_event", "project_thread_match", "unknown_type", None]:
        assert fp.resolve_model(t, cfg) == fp.TEXT_MODEL


def test_a_per_type_override_wins_and_nothing_else_changes(monkeypatch):
    monkeypatch.setitem(fp.CONTENT_TYPE_MODEL_OVERRIDES, "editorial", fp.SONNET)
    assert fp.resolve_model("editorial") == fp.SONNET
    assert fp.resolve_model("weekly") == fp.TEXT_MODEL


def test_content_base_follows_the_central_default():
    import content._base as base
    assert base.DEFAULT_MODEL == fp.TEXT_MODEL
