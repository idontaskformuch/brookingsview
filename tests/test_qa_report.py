"""qa/report.py -- pure planning logic (no GitHub I/O)."""
from qa.report import (CLEAN_MARK, fingerprint, fp_of_body, group, plan_actions, render_issue,
                       severity, trailing_clean, url_pattern)


def f(check="web.h1", town="brookings_sd", path="/s/abc/", msg="x"):
    return {"check": check, "town": town, "path": path, "url": "https://x" + path, "message": msg}


def test_url_pattern_collapses_variable_tail():
    assert url_pattern("/s/some-slug/") == "/s/*"
    assert url_pattern("/events/") == "/events"
    assert url_pattern("/") == "/"
    assert url_pattern("/s/a/?utm=1") == "/s/*"


def test_same_template_one_fingerprint_different_town_another():
    assert fingerprint(f(path="/s/a/")) == fingerprint(f(path="/s/b/"))
    assert fingerprint(f()) != fingerprint(f(town="moreno_valley_ca"))
    assert fingerprint(f()) != fingerprint(f(check="web.img"))


def test_soft_findings_never_create_issues():
    assert group([f(check="web.title-dup"), f(check="qa.tracking")]) == {}
    assert plan_actions([f(check="web.title-dup")], []) == []


def test_new_hard_finding_creates_one_issue_with_fingerprint():
    acts = plan_actions([f(path="/s/a/"), f(path="/s/b/")], [])
    assert len(acts) == 1 and acts[0]["op"] == "create"
    assert fp_of_body(acts[0]["body"]) == fingerprint(f())
    assert "2 träff" in acts[0]["title"]


def test_known_open_issue_is_silent():
    fp = fingerprint(f())
    title, body = render_issue(fp, group([f()])[fp])
    assert plan_actions([f()], [{"number": 7, "body": body, "comments": []}]) == []


def test_clean_runs_comment_then_close_after_three():
    fp = fingerprint(f())
    _, body = render_issue(fp, group([f()])[fp])
    issue = {"number": 7, "body": body, "comments": []}
    a = plan_actions([], [issue])
    assert a[0]["op"] == "comment" and "1/3" in a[0]["body"]
    issue["comments"] = [CLEAN_MARK + "1", CLEAN_MARK + "2"]
    a = plan_actions([], [issue])
    assert a[0]["op"] == "close"


def test_recurrence_after_clean_run_posts_one_comment():
    fp = fingerprint(f())
    _, body = render_issue(fp, group([f()])[fp])
    a = plan_actions([f()], [{"number": 7, "body": body, "comments": [CLEAN_MARK + "1"]}])
    assert len(a) == 1 and a[0]["op"] == "comment" and "tillbaka" in a[0]["body"]


def test_run_for_one_town_never_closes_another_towns_issue():
    other = f(town="moreno_valley_ca")
    fp = fingerprint(other)
    _, body = render_issue(fp, group([other])[fp])
    issue = {"number": 9, "body": body, "comments": [CLEAN_MARK] * 5}
    assert plan_actions([], [issue], scope_towns={"brookings_sd"}) == []
    assert plan_actions([], [issue], scope_towns={"moreno_valley_ca"})[0]["op"] == "close"


def test_trailing_clean_counts_only_the_unbroken_tail():
    assert trailing_clean([CLEAN_MARK, "recurred", CLEAN_MARK]) == 1


def test_liveness_check_is_registered_hard():
    assert severity("ops.scrape-liveness") == "hard"
    assert severity("web.title-dup") == "soft"
