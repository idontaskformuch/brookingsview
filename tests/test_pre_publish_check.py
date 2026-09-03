"""Regression tests for validation/pre_publish_check.py -- the consolidated
Phase 0 entry point every generator calls before publishing.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

from validation import pre_publish_check

MORENO_VALLEY_CFG = {"town_id": "moreno_valley_ca", "display_name": "Moreno Valley",
                      "state": "CA", "timezone": "America/Los_Angeles"}
BROOKINGS_CFG = {"town_id": "brookings_sd", "display_name": "Brookings",
                  "state": "SD", "timezone": "America/Chicago"}

# The real, historical failure this handoff exists because of --
# culture_essay-2026-08-03, town_id=moreno_valley_ca, verbatim body from the
# live database (confirmed 2026-09-03; see NEEDS-HUMAN-REVIEW.md's
# "unpublished rows" and CONTAMINATION_REPORT.md). Written entirely from
# Brookings' own perspective (SDSU, De Smet, Volga, Elkton, "Brookings Public
# Library on Main Avenue") and published under moreno_valley_ca -- exactly
# the wrong-town leakage check 1 exists to catch, and per the handoff itself:
# "This is the check that would have caught the culture essay that had to be
# pulled."
REAL_CONTAMINATED_ESSAY = """Somewhere in the pipeline that produces the weekly roundup of community events for this region, something broke. Readers looking for what is happening around Brookings this month were instead handed the library schedule of Moreno Valley, California: Toddler Time at the Iris Plaza branch on Perris Boulevard, Discovery Club at a mall library suite in Riverside County, a Summer Food Service lunch program governed by rules from the California Department of Education.

The problem is not that this information exists. The problem is that it arrived here, attached to a byline implying it belongs to Brookings, South Dakota, a town on the eastern edge of the Dakotas with its own library, its own children, its own 605 area code, none of which appear anywhere in the feed.

In a place like Brookings, wrapped around South Dakota State University, ringed by soybean and corn ground that stretches toward De Smet and the old Ingalls homestead, distances between towns are real and consequential. A family in Volga or Elkton is not going to drive to a library event in Riverside County."""


def test_the_real_pulled_essay_fails_pre_publish_check_for_moreno_valley():
    result = pre_publish_check(
        REAL_CONTAMINATED_ESSAY, source_records=None, cfg=MORENO_VALLEY_CFG,
        content_type="culture_essay", record_id="culture_essay-2026-08-03",
    )
    assert not result.passed
    assert "wrong_town_leakage" in result.failing_checks
    assert any("Brookings" in v for v in result.violations)


def test_a_clean_moreno_valley_essay_passes():
    text = ("Moreno Valley's library system spends its summer budget on Discovery Club "
            "and Toddler Time at the Iris Plaza branch, real programs for real families "
            "in the Inland Empire.")
    result = pre_publish_check(text, source_records=None, cfg=MORENO_VALLEY_CFG, content_type="culture_essay")
    assert result.passed
    assert result.failing_checks == []


def test_multiple_failing_checks_are_all_reported_not_just_the_first():
    tz = ZoneInfo("America/Chicago")
    record_date = datetime(2026, 9, 10, 18, 0, tzinfo=tz)  # a Thursday
    text = "Moreno Valley meets today to discuss the plan, according to city staff in Colorado."
    result = pre_publish_check(
        text, source_records=None, cfg=BROOKINGS_CFG, content_type="meeting",
        record_date=record_date, reference_now=datetime(2026, 9, 3, 9, 0, tzinfo=tz),
    )
    assert not result.passed
    assert "wrong_town_leakage" in result.failing_checks   # "Moreno Valley"
    assert "wrong_state_place" in result.failing_checks     # "Colorado", not sourced
    assert "date_coherence" in result.failing_checks         # "today" != record_date


def test_a_record_with_no_town_id_skips_the_town_leakage_check_only():
    # cfg without town_id (e.g. a test/dry-run cfg) must not crash -- it just
    # can't run check 1, every other check still runs normally.
    cfg = {"display_name": "Test Town", "state": "SD", "timezone": "America/Chicago"}
    result = pre_publish_check("A clean, unrelated sentence about a local bake sale.",
                                source_records=None, cfg=cfg, content_type="editorial")
    assert result.passed


def test_pass_result_is_truthy_and_fail_result_is_falsy():
    passing = pre_publish_check("A clean sentence about the town.", None, BROOKINGS_CFG)
    failing = pre_publish_check(REAL_CONTAMINATED_ESSAY, None, MORENO_VALLEY_CFG)
    assert bool(passing) is True
    assert bool(failing) is False
