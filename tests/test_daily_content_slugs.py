"""Regression tests for ai_pipeline/daily_content.py:public_slug_prefix() --
2026-10-01 cleanup round, item 4. Extends the single vardagsmiddag->recipe
mapping (shipped 2026-08-23) to the other three Swedish-prefixed content
tracks. source_type itself (MODULES' own dispatch keys) is untouched by
this -- only the computed slug prefix for a NEW row changes.
"""
from ai_pipeline.daily_content import SLUG_PREFIX_OVERRIDES, public_slug_prefix


def test_all_four_swedish_types_map_to_their_english_prefix():
    assert public_slug_prefix("vardagsmiddag") == "recipe"
    assert public_slug_prefix("vetenskap_kronika") == "science-column"
    assert public_slug_prefix("kvick_essa") == "quick-essay"
    assert public_slug_prefix("media_recension") == "review"


def test_every_other_content_type_is_unchanged():
    for content_type in ("editorial", "culture_essay"):
        assert public_slug_prefix(content_type) == content_type


def test_overrides_dict_has_exactly_the_four_known_types():
    # Locks the override set itself, not just a few spot checks -- a typo'd
    # or accidentally-removed key here would silently publish a new row
    # under the wrong (old Swedish, or source_type-literal) prefix forever.
    assert set(SLUG_PREFIX_OVERRIDES) == {
        "vardagsmiddag", "vetenskap_kronika", "kvick_essa", "media_recension",
    }
