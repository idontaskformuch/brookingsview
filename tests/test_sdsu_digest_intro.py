"""University digest = the same structure as the city roundup (owner 2026-10-23, .claude/spec-university-digest.md):
the model writes ONLY a short intro; the page lists the events itself."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from ai_pipeline import sdsu_weekly_digest as d

CFG = {"display_name": "Brookings", "state": "South Dakota"}
TZ = ZoneInfo("America/Chicago")


def _ev(title, hour):
    return {"title": title, "starts_at": datetime(2026, 10, 24, hour, tzinfo=timezone.utc), "location": "Campus",
            "primary_category": "Athletics", "external_event_id": title}


def test_prompt_asks_for_a_short_intro_with_no_days_times_or_dates():
    p = d.build_prompt(CFG, "October 19-25")
    assert "ONLY the short introduction" in p
    assert "at most 80 words" in p
    assert "NO days of the week, NO times, NO dates" in p
    assert "2-3 short paragraphs" not in p


def test_min_words_is_an_intro_not_an_article():
    assert d.MIN_WORDS <= 30


def test_template_fallback_is_count_only_and_has_no_list():
    text = d.template_fallback([_ev("Soccer vs Idaho", 20), _ev("VB vs USD", 22)], "October 19-25", TZ, [{"label": "Finals", "starts_on": "Dec 14"}])
    assert "2 campus events" in text and "1 academic date" in text
    assert "\n" not in text and "- " not in text


def test_template_fallback_with_nothing_says_so():
    assert d.template_fallback([], "October 19-25", TZ, []).startswith("No tracked SDSU events")


def test_intro_guard_is_the_cities_guard():
    # the digest must reject exactly what the city roundup intro rejects: days, clock times, dates, lists
    assert d.intro_format_violations("Soccer plays on Friday at 7 p.m.")
    assert d.intro_format_violations("A busy week for campus music, with a home game and two concerts.") == []
