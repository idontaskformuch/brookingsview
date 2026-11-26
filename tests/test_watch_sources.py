"""scripts/watch_sources.py (owner order 2026-11-26 (13)): a daily, generic source watch; one GitHub issue per watch when a rule no longer holds.
Fixture: broomfield.org/4401/Holiday-Tree-Recycling as read 2026-11-19 (PoliteFetcher, one request); the committed baseline was written from the
page of 2026-11-26 and the two are identical. Each failing case changes ONE thing in that real page."""
from pathlib import Path

from qa.report import fingerprint, group, plan_actions
from scrapers.polite_fetch import Fetched, Refused
from scripts import watch_sources as w

FIX = Path(__file__).parent / "fixtures" / "source_watch" / "broomfield-4401-holiday-tree-recycling-2026-11-19.html"
HTML = FIX.read_text(encoding="utf-8")
WATCH = w.load()[0]
ANNOUNCE = "Holiday tree recycle drop-off sites and dates for 2026-27 will be announced in the Fall."


def problems(html: str) -> list[str]:
    return w.check_watch(WATCH, w.page_text(html))


def test_the_page_as_it_is_holds_every_rule():
    assert problems(HTML) == []


def test_the_announcement_sentence_going_away_is_a_finding():
    now = HTML.replace("will be announced in the Fall", "are listed below")
    out = problems(now)
    assert len(out) == 1 and '"will be announced in the Fall" is no longer on the page' in out[0] and "2026-27 sites and dates are not out" in out[0]


def test_a_changed_site_list_says_what_was_added_and_removed():
    # One changed thing: Meridian Park's sentence is replaced by a new site.
    old = "Meridian Park McKay Circle and Park Cove Way in McKay Landing."
    assert old in w.page_text(HTML)
    now = HTML.replace("Meridian Park", "Jessup Park").replace("McKay Circle and Park Cove Way in McKay Landing", "Main Street")
    out = problems(now)
    assert len(out) == 1 and out[0].startswith('the text between "Drop-Off Locations" and "Wreaths, live garland" changed.')
    assert "Removed:" in out[0] and "Added:" in out[0] and "Jessup Park" in out[0] and "list of drop-off sites" in out[0]


def test_a_missing_baseline_or_marker_is_reported_not_ignored(tmp_path):
    assert any("no baseline" in p for p in w.check_watch(WATCH, w.page_text(HTML), tmp_path))
    gone = HTML.replace("Drop-Off Locations", "Where")
    assert any("cannot be found any more" in p for p in problems(gone))


def test_absent_and_unknown_kinds():
    watch = {"rules": [{"kind": "absent", "text": "will be announced"}, {"kind": "mystery", "x": 1}]}
    out = w.check_watch(watch, w.page_text(HTML))
    assert out[0] == 'the text "will be announced" is now on the page' and 'unknown rule kind "mystery"' in out[1]
    assert w.check_watch({"rules": [{"kind": "absent", "text": "dates are out"}]}, w.page_text(HTML)) == []


def test_one_finding_per_watch_and_its_own_issue():
    f = w.finding(WATCH, ["a", "b"])
    assert (f["check"], f["town"], f["pattern"]) == ("ops.source-changed", "broomfield_co", "broomfield-holiday-tree-2026-27")
    assert WATCH["url"] in f["message"] and "Nothing was changed or published" in f["message"]
    other = {**f, "pattern": "another-page"}
    assert fingerprint(f) != fingerprint(other) and len(group([f, other])) == 2
    assert [a["op"] for a in plan_actions([f], [])] == ["create"]


class Fake:
    def __init__(self, result):
        self.result = result

    def get(self, url):
        return self.result


def test_run_reads_each_page_once_and_an_unreadable_page_is_no_finding():
    ok = Fetched(WATCH["url"], WATCH["url"], 200, HTML.encode("utf-8"), "utf-8")
    assert w.run([WATCH], lambda t: Fake(ok)) == ([], [])
    changed = Fetched(WATCH["url"], WATCH["url"], 200, HTML.replace("will be announced in the Fall", "x").encode("utf-8"), "utf-8")
    findings, unreadable = w.run([WATCH], lambda t: Fake(changed))
    assert len(findings) == 1 and unreadable == []
    for bad in (Refused(WATCH["url"], "robots.txt disallows it"), Fetched(WATCH["url"], WATCH["url"], 403)):
        assert w.run([WATCH], lambda t, b=bad: Fake(b))[0] == []
        assert len(w.run([WATCH], lambda t, b=bad: Fake(b))[1]) == 1


def test_write_baseline_round_trips(tmp_path):
    text = w.page_text(HTML)
    paths = w.write_baseline(WATCH, text, tmp_path)
    assert [p.name for p in paths] == ["broomfield-holiday-tree-2026-27.txt"]
    assert w.check_watch(WATCH, text, tmp_path) == []


def test_the_config_is_valid():
    for watch in w.load():
        assert watch["url"].startswith("https://") and watch["id"] and watch["town"] and watch["rules"]
        assert all(r["kind"] in w.RULES for r in watch["rules"])
