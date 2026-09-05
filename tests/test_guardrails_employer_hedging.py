"""Coverage for guardrails.validate_employer_hedging() -- no test file
previously existed for this function. Extended in Fas 4a (Recurring-traffic
layer, hiring layer) to also reject "hiring/headcount/growth" overreach in
sentences about job-posting counts, reusing the SAME function/vocabulary
mechanism rather than a parallel check (per the handoff's own instruction).
"""
from ai_pipeline.guardrails import validate_employer_hedging


def test_hedged_review_claim_passes():
    result = validate_employer_hedging("Reviews mention long shifts at Amazon.", ["Amazon"])
    assert result.passed


def test_unhedged_bare_claim_fails():
    result = validate_employer_hedging("Amazon is understaffed.", ["Amazon"])
    assert not result.passed
    assert "unhedged employer claim" in result.violations[0]


def test_hedged_posting_count_claim_passes():
    # Fas 4a: "postings"/"adzuna" now count as review-source vocabulary too.
    result = validate_employer_hedging(
        "Postings show Amazon had 4 open listings this month, according to Adzuna.", ["Amazon"])
    assert result.passed


def test_hiring_overreach_rejected_even_when_hedged():
    # Even attributed to a source, "hiring is booming" overstates what a
    # job-board listing count can support -- rejected regardless of hedging.
    result = validate_employer_hedging(
        "Postings suggest hiring is booming at Amazon this month.", ["Amazon"])
    assert not result.passed
    assert "overreach" in result.violations[0]


def test_headcount_and_growth_words_also_rejected():
    for phrase in [
        "Listings indicate Amazon's headcount is rising.",
        "Reviews describe strong growth at Amazon this quarter.",
        "Employees say Amazon is expanding rapidly.",
    ]:
        result = validate_employer_hedging(phrase, ["Amazon"])
        assert not result.passed, phrase


def test_hiring_words_without_employer_mention_are_untouched():
    # Guardrail only applies to sentences naming a TRACKED employer.
    result = validate_employer_hedging("The town saw overall job growth this year.", ["Amazon"])
    assert result.passed


def test_no_employer_names_always_passes():
    assert validate_employer_hedging("Some unrelated text.", []).passed
