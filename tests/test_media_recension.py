"""Regression tests for content/recensioner/media_recension.py's pure
post-processing helpers (rating extraction, verification-date line). No AI
call -- write() itself (the generate/retry/flag orchestration) isn't tested
here, same scope as this project's other content/*.py modules (see
tests/test_content_prompts.py's docstring: prompt-string and pure-function
tests only, no mocked AI client)."""
import datetime

from content._base import GeneratedArticle
from content.recensioner.media_recension import _append_verification_line, _extract_rating


def test_extract_rating_strips_line_and_sets_field():
    article = GeneratedArticle(title="T", body="Some review text.\n\nBetyg: 3.5/5")
    result = _extract_rating(article)
    assert result.rating == 3.5
    assert "Betyg" not in result.body
    assert result.body == "Some review text."


def test_extract_rating_accepts_comma_decimal():
    article = GeneratedArticle(title="T", body="Text.\n\nBetyg: 4,5/5")
    result = _extract_rating(article)
    assert result.rating == 4.5


def test_extract_rating_missing_line_leaves_rating_none():
    article = GeneratedArticle(title="T", body="Some review text with no rating line.")
    result = _extract_rating(article)
    assert result.rating is None
    assert result.body == article.body


def test_append_verification_line_uses_todays_date_no_platform_crash():
    # Regression guard for the %-d Windows crash pattern already hit once in
    # ai_pipeline/meeting_followups.py (glibc-only strftime flag) -- this
    # helper must never use that flag.
    article = GeneratedArticle(title="T", body="Body text.")
    result = _append_verification_line(article)
    today = datetime.date.today()
    assert f"Facts verified as of" in result.body
    assert str(today.year) in result.body
    assert result.body.startswith("Body text.")
