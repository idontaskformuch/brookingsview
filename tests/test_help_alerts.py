"""/help/ freshness alarms (owner order 2026-11-27, after f538d8ea): scripts/watch_sources.py help_findings -> qa/report.py issues.
  * a row that was shown goes to changed or gone      -> one issue per town (the row, the source, the diff); it lives as long as
                                                         any row of the town is changed/gone, closes when none is (verified again or removed)
  * a source unreadable on two runs in a row          -> one issue per source; closes after 1 clean run
  * a town with min_entries falls under it            -> one issue per town (/help/ would vanish silently); closes after 1 clean run
Pages and rows are the real 2026-11-27 fixtures (tests/test_help_freshness.py helpers); each case changes ONE thing."""
from datetime import timedelta

from qa import report as qr
from scrapers import help_sources as hs
from scrapers.polite_fetch import Fetched, Refused
from scripts import watch_sources as w
from tests.test_help_freshness import COC, FISH, NDC, TODAY, ok, ops, page, plan, results, rows_as_written, stored

PANTRIES = hs.SOURCE_BY_ID["moval-food-pantries"]
WATCH_MORENO = next(x for x in w.load() if x["id"] == "help-moreno_valley_ca")
WATCH_BROOMFIELD = next(x for x in w.load() if x["id"] == "help-broomfield_co")
GONE_404 = lambda src: {src.url: Fetched(src.url, src.url, 404)}   # noqa: E731


def places_as_written(*sources) -> list[dict]:
    """The town's help places as 1c wrote them from the same pages (what load_town_places returns)."""
    out = []
    for src in sources:
        for p in hs.parse(src, {u: page(src, u) for u in src.fixtures}, TODAY):
            if p.role or p.decision == "reject":
                continue
            e = p.entry
            out.append({"slug": e.slug, "category": e.category, "source_kind": e.source_kind,
                        "verification_status": "verified" if p.decision == "publish" else "queued",
                        "verified_date": TODAY - timedelta(days=7), "valid_from": e.valid_from, "valid_to": e.valid_to})
    return out


def pantry_rows() -> list[dict]:
    """moval.gov's 16 rows as 1c wrote them: 14 shown (verified), 2 queued (the parse's own decision)."""
    parsed = hs.parse(PANTRIES, {PANTRIES.url: page(PANTRIES)}, TODAY)
    rows = rows_as_written(PANTRIES)
    return [{**r, "status": "verified" if p.decision == "publish" else "queued"} for r, p in zip(rows, parsed)]


def findings(watch, plans, places=()):
    return w.help_findings(watch, plans, list(places), TODAY)


# --- changed / gone -------------------------------------------------------------------------------------------------------------
def test_a_row_lost_to_validation_is_one_finding_with_the_row_the_source_and_the_diff():
    # One change on the page (Cross of Christ's "All are welcome" is gone, so the meal is no longer free / open to all); the DB row's
    # requirements_note is set to "Call ahead" so the diff has a requirements part.
    body = page(COC).replace(b"All are welcome to come and serve", b"Volunteers are invited to come and serve")
    p = plan(COC, results(COC, body), stored(COC), rows_as_written(COC, requirements_note="Call ahead"))
    out = findings(WATCH_BROOMFIELD, [p])
    assert len(out) == 1
    f = out[0]
    assert (f["check"], f["town"], f["pattern"]) == ("ops.help-changed", "broomfield_co", "help-rows")
    assert "Cross of Christ Community Meals" in f["message"] and "cross-of-christ-community-meals" in f["message"]
    assert COC.url in f["message"] and "verified -> changed" in f["message"]
    assert "free or open to all" in f["message"] and "requirements Call ahead -> (none)" in f["message"]


def test_a_404_names_the_row_and_what_it_said():
    p = plan(FISH, GONE_404(FISH), stored(FISH), rows_as_written(FISH))
    (f,) = findings(WATCH_BROOMFIELD, [p])
    assert f["check"] == "ops.help-changed" and "verified -> gone" in f["message"] and "status 404" in f["message"]
    assert "was: Mon 12:00-16:30, Tue 10:00-15:30, Wed 13:00-18:00, Fri 12:00-16:30" in f["message"] and FISH.url in f["message"]


def test_a_layout_the_parser_cannot_read_is_a_finding_for_each_shown_row():
    body = page(FISH).replace(b"Upcoming Marketplace Closures:", b"Closures")
    (f,) = findings(WATCH_BROOMFIELD, [plan(FISH, results(FISH, body), stored(FISH), rows_as_written(FISH))])
    assert "verified -> changed" in f["message"] and "parse error" in f["message"] and "was: Mon 12:00-16:30" in f["message"]


def test_a_row_missing_from_the_page_is_gone():
    rows = rows_as_written(FISH)
    rows.append({**rows[0], "key": ("place", "broomfield-fish-annex"), "id": 99, "name": "Broomfield FISH Annex"})
    (f,) = findings(WATCH_BROOMFIELD, [plan(FISH, results(FISH), None, rows)])
    assert "Broomfield FISH Annex" in f["message"] and "verified -> gone" in f["message"] and "no longer on the page" in f["message"]


def test_towns_rows_share_one_issue_but_each_row_is_an_item():
    rows = pantry_rows()
    out = findings(WATCH_MORENO, [plan(PANTRIES, GONE_404(PANTRIES), stored(PANTRIES), rows)], places_as_written(PANTRIES))
    assert [f["check"] for f in out].count("ops.help-min-entries") == 1   # 14 shown -> 0 (its own issue, tested below)
    out = [f for f in out if f["check"] == "ops.help-changed"]
    assert len(out) == 14   # the 14 shown rows; the 2 queued ones raise nothing
    assert len({qr.fingerprint(f) for f in out}) == 1 and len(qr.group(out)) == 1
    assert [a["op"] for a in qr.plan_actions(out, [])] == ["create"]


def test_a_queued_row_was_never_shown_it_stays_queued_and_raises_nothing():
    p = plan(FISH, GONE_404(FISH), stored(FISH), rows_as_written(FISH, status="queued"))
    assert not any(a[0] == "status" for a in p.actions) and findings(WATCH_BROOMFIELD, [p]) == []
    body = page(FISH).replace(b"Upcoming Marketplace Closures:", b"Closures")   # a parse error does not change it either
    p = plan(FISH, results(FISH, body), stored(FISH), rows_as_written(FISH, status="queued"))
    assert not any(a[0] == "status" for a in p.actions) and findings(WATCH_BROOMFIELD, [p]) == []


def test_which_losses_are_announced_on_an_open_issue():
    # verified and stale rows going to gone are news; a row that already was changed or gone is not.
    for status, announced in (("verified", True), ("stale", True), ("changed", False), ("gone", False)):
        p = plan(FISH, GONE_404(FISH), stored(FISH), rows_as_written(FISH, status=status, verified=TODAY - timedelta(days=7)))
        (f,) = findings(WATCH_BROOMFIELD, [p])
        assert f["announce"] is announced, status


def test_a_hidden_row_keeps_the_finding_every_run_until_it_is_verified_again():
    # Run 1: 404 -> gone, announced. Run 2 (a week later): still 404, the row is gone already: the same finding, not announced again.
    (first,) = findings(WATCH_BROOMFIELD, [plan(FISH, GONE_404(FISH), stored(FISH), rows_as_written(FISH))])
    assert first["announce"] is True and "verified -> gone" in first["message"]
    (second,) = findings(WATCH_BROOMFIELD, [plan(FISH, GONE_404(FISH), None, rows_as_written(FISH, status="gone"))])
    assert second["announce"] is False and "is gone since an earlier run" in second["message"] and FISH.url in second["message"]
    assert qr.fingerprint(first) == qr.fingerprint(second)
    # Run 3: the page is back and reads fine -> the row is verified again -> nothing hidden, no finding.
    third = plan(FISH, results(FISH), None, rows_as_written(FISH, status="gone"))
    assert ops(third) == [("write", (("place", "broomfield-fish"), "verified"))]
    assert findings(WATCH_BROOMFIELD, [third]) == []


def test_an_unreadable_source_does_not_clear_its_hidden_rows():
    p = plan(FISH, {FISH.url: Refused(FISH.url, "robots.txt disallows it")}, stored(FISH), rows_as_written(FISH, status="changed"))
    (f,) = findings(WATCH_BROOMFIELD, [p])
    assert f["check"] == "ops.help-changed" and "is changed since an earlier run" in f["message"] and f["announce"] is False


def test_a_hidden_row_is_read_again_even_when_the_page_has_not_changed():
    # After a parser fix the page hash is the same, but a changed or gone row must not stay hidden for ever.
    for status in ("changed", "gone"):
        p = plan(FISH, results(FISH), stored(FISH), rows_as_written(FISH, status=status))
        assert not p.page_changed and ops(p) == [("write", (("place", "broomfield-fish"), "verified"))], status
        assert findings(WATCH_BROOMFIELD, [p]) == []
    # and when it still fails validation it stays hidden, with this reading's reason
    body = page(COC).replace(b"All are welcome to come and serve", b"Volunteers are invited to come and serve")
    p = plan(COC, results(COC, body), w.page_hash({COC.url: body}), rows_as_written(COC, status="changed"))
    (f,) = findings(WATCH_BROOMFIELD, [p])
    assert f["announce"] is False and "free or open to all" in f["message"]
    assert not any(a[0] in ("write", "status") for a in p.actions)


# --- unreadable twice -----------------------------------------------------------------------------------------------------------
def test_unreadable_once_is_silent_twice_is_a_finding_per_source():
    for bad in (Refused(FISH.url, "robots.txt disallows it"), Fetched(FISH.url, FISH.url, None), Fetched(FISH.url, FISH.url, 403),
                Fetched(FISH.url, FISH.url, 503)):
        first = plan(FISH, {FISH.url: bad}, stored(FISH), rows_as_written(FISH), prev_unreadable=False)
        assert findings(WATCH_BROOMFIELD, [first]) == [], bad
        second = plan(FISH, {FISH.url: bad}, stored(FISH), rows_as_written(FISH), prev_unreadable=True)
        (f,) = findings(WATCH_BROOMFIELD, [second])
        assert (f["check"], f["town"], f["pattern"]) == ("ops.help-unreadable", "broomfield_co", "broomfield-fish")
        assert FISH.url in f["message"] and "two runs in a row" in f["message"] and "Nothing was changed" in f["message"]


def test_a_readable_or_gone_page_after_an_unreadable_one_is_no_finding():
    assert findings(WATCH_BROOMFIELD, [plan(FISH, results(FISH), stored(FISH), rows_as_written(FISH), prev_unreadable=True)]) == []
    gone = plan(FISH, GONE_404(FISH), stored(FISH), rows_as_written(FISH, status="gone"), prev_unreadable=True)
    # a 404 is an answer: not "unreadable twice" (its row is hidden, so ops.help-changed has it)
    assert [f["check"] for f in findings(WATCH_BROOMFIELD, [gone])] == ["ops.help-changed"]


def test_what_counts_as_the_last_run_being_unreadable():
    Prev = w.PrevCheck
    assert w.was_unreadable(Prev(None, None, False)) is False   # never checked
    assert w.was_unreadable(Prev("h", 200, True)) is False
    assert w.was_unreadable(Prev(None, 404, True)) is False and w.was_unreadable(Prev(None, 410, True)) is False
    for status in (None, 403, 429, 500, 503):
        assert w.was_unreadable(Prev("h", status, True)) is True, status


def test_each_unreadable_source_has_its_own_issue():
    a = plan(FISH, {FISH.url: Refused(FISH.url, "x")}, stored(FISH), rows_as_written(FISH), prev_unreadable=True)
    b = plan(NDC, {NDC.url: Fetched(NDC.url, NDC.url, 503)}, stored(NDC), rows_as_written(NDC), prev_unreadable=True)
    out = findings(WATCH_BROOMFIELD, [a, b])
    assert [f["pattern"] for f in out] == ["broomfield-fish", "north-denver-cares"] and len(qr.group(out)) == 2


# --- min_entries ----------------------------------------------------------------------------------------------------------------
def test_visible_entries_before_and_after():
    places = places_as_written(PANTRIES)
    assert w.visible_entries(places, [], TODAY, 45) == (14, 14)
    p = plan(PANTRIES, GONE_404(PANTRIES), stored(PANTRIES), pantry_rows())
    assert w.visible_entries(places, [p], TODAY, 45) == (14, 0)
    again = plan(PANTRIES, results(PANTRIES), stored(PANTRIES), pantry_rows())
    assert w.visible_entries(places, [again], TODAY + timedelta(days=60), 45) == (0, 14)   # old rows, bumped by the check


def test_a_town_falling_under_min_entries_is_a_finding():
    places = places_as_written(PANTRIES)
    p = plan(PANTRIES, GONE_404(PANTRIES), stored(PANTRIES), pantry_rows())
    out = findings(WATCH_MORENO, [p], places)
    assert [f["check"] for f in out].count("ops.help-min-entries") == 1
    f = next(f for f in out if f["check"] == "ops.help-min-entries")
    assert (f["town"], f["pattern"]) == ("moreno_valley_ca", "help-min-entries")
    assert "0 visible" in f["message"] and "was 14" in f["message"] and "min_entries 6" in f["message"]


def test_a_town_still_at_or_over_min_entries_is_silent():
    places = places_as_written(PANTRIES)
    p = plan(PANTRIES, results(PANTRIES), stored(PANTRIES), pantry_rows())   # nothing lost: 14 shown, over 6
    assert [f["check"] for f in findings(WATCH_MORENO, [p], places)] == []
    five = places[:5] + [{**x, "verification_status": "gone"} for x in places[5:]]
    assert w.visible_entries(five, [], TODAY, 45) == (5, 5)


def test_only_a_town_with_min_entries_in_its_config_is_checked():
    places = places_as_written(PANTRIES)[:3]   # Broomfield's own count is 3: under 6 by owner decision 1, /help/ hidden there
    out = findings(WATCH_BROOMFIELD, [], places)
    assert out == []
    armed = sorted(x["town"] for x in w.load() if w.is_help_watch(x) and w._min_entries(x) is not None)
    assert armed == ["glasgow", "moreno_valley_ca"]
    assert all(w._min_entries(x) == 6 for x in w.load() if w.is_help_watch(x) and w._min_entries(x) is not None)


# --- into the issue lifecycle (qa/report.py) --------------------------------------------------------------------------------------
def _open_issue(finding, number=41, clean_to_close=1, comments=()):
    fp = qr.fingerprint(finding)
    _, body = qr.render_issue(fp, qr.group([finding])[fp], clean_to_close=clean_to_close)
    return {"number": number, "body": body, "comments": list(comments)}


def _a_finding():
    p = plan(PANTRIES, GONE_404(PANTRIES), stored(PANTRIES), pantry_rows())
    return findings(WATCH_MORENO, [p])[0]


def _min_finding():
    p = plan(PANTRIES, GONE_404(PANTRIES), stored(PANTRIES), pantry_rows())
    return next(f for f in findings(WATCH_MORENO, [p], places_as_written(PANTRIES)) if f["check"] == "ops.help-min-entries")


def test_the_issue_closes_when_nothing_is_hidden_any_more_in_the_same_town():
    # (the run that verifies the last hidden row is the first run without the finding)
    issue = _open_issue(_a_finding())
    scope = lambda c: c in w.HELP_CHECK_IDS   # noqa: E731
    acts = qr.plan_actions([], [issue], w.HELP_CLEAN_TO_CLOSE, {"moreno_valley_ca"}, scope)
    assert [a["op"] for a in acts] == ["close"] and "(1/1)" in acts[0]["body"]
    # another town's run, or another kind of check's run, never closes it
    assert qr.plan_actions([], [issue], 1, {"glasgow"}, scope) == []
    assert qr.plan_actions([], [issue], 1, {"moreno_valley_ca"}, lambda c: c == w.CHECK_ID) == []
    # and the page watches' own clean runs (3) do not touch a help issue
    assert qr.plan_actions([], [issue], 3, {"moreno_valley_ca"}, lambda c: c == w.CHECK_ID) == []


def test_a_known_finding_does_not_open_a_second_issue_or_repeat_itself():
    issue = _open_issue(_a_finding())
    assert qr.plan_actions([{**_a_finding(), "announce": False}], [issue], 1) == []


def test_a_row_lost_while_the_issue_is_open_is_announced_in_a_comment():
    old = {**_a_finding(), "announce": False}
    issue = _open_issue(old)
    newer = {**old, "message": "Broomfield FISH (broomfield-fish) verified -> gone: source X: status 404. Diff: was: Mon", "announce": True}
    (act,) = qr.plan_actions([old, newer], [issue], 1)
    assert act["op"] == "comment" and act["number"] == 41 and "Broomfield FISH (broomfield-fish)" in act["body"]
    assert old["message"] not in act["body"]   # only what is new this run


def test_the_issue_text_says_when_it_closes():
    assert "Stängs automatiskt när ingen rad i staden är dold längre" in _open_issue(_a_finding())["body"]
    assert "ren körning" not in _open_issue(_a_finding())["body"]
    text = _open_issue(_min_finding())["body"]
    assert "Stängs automatiskt efter 1 ren körning." in text and "3 rena" not in text
    fp = qr.fingerprint(_min_finding())
    assert "3 rena körningar i rad" in qr.render_issue(fp, qr.group([_min_finding()])[fp])[1]   # the default is unchanged


def test_report_help_scopes_the_run_to_the_towns_it_checked(monkeypatch):
    seen = {}
    monkeypatch.setattr(qr, "report", lambda fs, **kw: seen.update(findings=fs, **kw))
    w.report_help([_a_finding()], {"moreno_valley_ca"}, run_url="https://example.invalid/run/1")
    assert seen["report_only"] is False and seen["clean_to_close"] == 1 and seen["scope_towns"] == {"moreno_valley_ca"}
    assert seen["scope_checks"]("ops.help-changed") and not seen["scope_checks"]("ops.source-changed")
    assert seen["run_url"] == "https://example.invalid/run/1"


def test_every_help_check_is_registered():
    assert set(w.HELP_CHECK_IDS) == {"ops.help-changed", "ops.help-unreadable", "ops.help-min-entries"}
    for check in w.HELP_CHECK_IDS:
        entry = qr.REGISTRY[check]
        assert entry["severity"] == "hard" and entry["born_from"] and entry["what"], check
    assert qr.REGISTRY["ops.help-changed"]["closes"]   # the only help check that does not close after 1 clean run
