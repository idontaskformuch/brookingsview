"""Tests for ai_pipeline/publish.py's prefix_town_name() -- the forward-
going half of the SEO title rule from NEEDS-HUMAN-REVIEW.md "SEO Fas 3".
scripts/retrofit_story_titles.py only fixed titles that already existed;
this is what keeps every NEWLY published title compliant going forward
(found live, regressing silently, while building the Google News sitemap
-- see NEEDS-HUMAN-REVIEW.md "Google News sitemap")."""
from ai_pipeline.publish import prefix_town_name


def test_prefixes_a_title_with_no_town_mention():
    assert prefix_town_name("City Council — Tue, Aug 25, 2026", "Brookings") == \
        "Brookings: City Council — Tue, Aug 25, 2026"


def test_idempotent_when_the_title_already_names_the_town():
    title = "Weed & Pest Board covers Brookings County business"
    assert prefix_town_name(title, "Brookings") == title


def test_case_insensitive_match_still_skips_prefixing():
    title = "A guide to brookings city hall"
    assert prefix_town_name(title, "Brookings") == title


def test_moreno_valley_title():
    assert prefix_town_name("Worker Pulse: ALDI — August 2026", "Moreno Valley") == \
        "Moreno Valley: Worker Pulse: ALDI — August 2026"
