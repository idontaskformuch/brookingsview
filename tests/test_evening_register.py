"""scrapers/evening_register.py: robots rule, identity check, extraction validation, one-venue flow (no network, no model)."""
import json
from datetime import date, datetime, timedelta, timezone

import pytest

from scrapers import evening_register as er
from scripts import refresh_evening_register as refresh

TODAY = date(2026, 11, 2)
URL = "https://venue.example/whats-on"


# --- robots ---------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("status,text,ok", [
    (404, None, True),
    (200, "User-agent: *\nDisallow: /admin\n", True),
    (200, "", True),
    (200, "User-agent: *\nDisallow: /\n", False),
    (200, "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n", False),
    (200, "User-agent: *\nDisallow:\n\nUser-agent: anthropic-ai\nDisallow: /\n", False),
    (200, "User-agent: ClaudeBot\nAllow: /\n", False),  # naming the crawler at all excludes the venue
    (200, "User-agent: Google-Extended\nDisallow: /\n", False),
    (200, "User-agent: ViewMediaBot\nDisallow: /\n", False),
    (200, "User-agent: *\nDisallow: /whats-on\n", False),
    (200, "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\n", True),
    (403, "forbidden", False),
    (500, "", False),
    (None, None, False),
])
def test_robots_verdict(status, text, ok):
    assert er.robots_verdict(status, text, URL).ok is ok


def test_star_group_disallow_all_only_counts_for_star():
    assert er.robots_verdict(200, "User-agent: Googlebot\nDisallow: /\n", URL).ok


# --- identity -------------------------------------------------------------------------------------------------------------

def page(title, body="", h1=""):
    return f"<html><head><title>{title}</title></head><body><h1>{h1}</h1>{body}</body></html>"


def test_identity_ok_via_title_or_heading_and_aliases():
    assert er.identity_check("The Stand Comedy Club", page("What's On | The Stand Comedy Club")).ok
    assert er.identity_check("Òran Mór", page("Home", h1="Oran Mor Glasgow"), aliases=("Oran Mor",)).ok
    assert er.identity_check("St Luke's", page("Saint Luke's Music & Arts Venue"), aliases=("Saint Luke's",)).ok


def test_identity_fails_when_name_missing():
    v = er.identity_check("Arvada Center", page("Home", h1="Find Your Center"))
    assert not v.ok and "not found" in v.reason


@pytest.mark.parametrize("html", [
    page("The Stand Comedy Club - Best online casino bonus"),
    page("The Stand Comedy Club", h1="Sportsbook and betting odds"),
    page("The Stand Comedy Club", body="<p>casino</p><p>casino</p><p>Online casino</p>"),
    page("The Stand Comedy Club - this domain may be for sale"),
])
def test_identity_fails_on_hijack_markers(html):
    assert not er.identity_check("The Stand Comedy Club", html).ok


def test_identity_parked_domain_page_fails():
    assert not er.identity_check("Nighthawk Brewery", page("nighthawkbrewery.com is for sale | HugeDomains")).ok


# --- validation -----------------------------------------------------------------------------------------------------------

PAGE = """Comedy Night every Tuesday at 8pm. Free entry. 18+
The Big Quiz Thursdays 7.30pm £2 per team
Nov 14 Idlewild live, doors 19:00 £25
Barbie screening 6:30pm and 8:45pm on 5 November. All ages
Matinee Sunday 2pm family fun"""


def reply(*entries):
    return json.dumps({"entries": list(entries)})


def entry(**kw):
    base = {"kind": "recurring", "title": "Comedy Night", "weekdays": ["tue"], "date": None, "times": ["20:00"],
            "quote": "Comedy Night every Tuesday at 8pm. Free entry. 18+"}
    base.update(kw)
    return base


def test_valid_recurring_rule_with_price_and_age_from_the_quote():
    kept, rejected = er.validate_extraction(reply(entry()), PAGE, TODAY)
    assert not rejected
    r = kept[0]
    assert (r.kind, r.title, r.weekdays, r.times, r.price, r.age) == ("recurring", "Comedy Night", [2], ["20:00"], "Free", "18+")


def test_price_amount_and_dot_time_and_pound():
    e = entry(title="The Big Quiz", weekdays=["thu"], times=["19:30"], quote="The Big Quiz Thursdays 7.30pm £2 per team")
    kept, rej = er.validate_extraction(reply(e), PAGE, TODAY)
    assert not rej and kept[0].price == "£2" and kept[0].age is None


def test_dated_with_several_times_for_one_film():
    e = {"kind": "dated", "title": "Barbie", "weekdays": [], "date": "2026-11-05", "times": ["20:45", "18:30"],
         "quote": "Barbie screening 6:30pm and 8:45pm on 5 November. All ages"}
    kept, rej = er.validate_extraction(reply(e), PAGE, TODAY)
    assert not rej and kept[0].times == ["18:30", "20:45"] and kept[0].age == "All ages" and kept[0].on_date == date(2026, 11, 5)


def test_dated_month_day_format():
    e = {"kind": "dated", "title": "Idlewild", "weekdays": [], "date": "2026-11-14", "times": ["19:00"], "quote": "Nov 14 Idlewild live, doors 19:00 £25"}
    kept, rej = er.validate_extraction(reply(e), PAGE, TODAY)
    assert not rej and kept[0].price == "£25"


@pytest.mark.parametrize("change,why", [
    ({"quote": "Comedy Night every Tuesday at 9pm"}, "quote is not found"),
    ({"times": ["21:00"]}, "no listed time appears"),
    ({"times": ["14:00"], "quote": "Matinee Sunday 2pm family fun", "weekdays": ["sun"]}, "before 17:00"),
    ({"title": "Comedy Night with a very long invented title that is nine words or more"}, "title"),
    ({"title": "Magic Show"}, "words that are not on the page"),
    ({"weekdays": ["fri"]}, "weekday is not in the quote"),
    ({"weekdays": []}, "needs weekdays"),
    ({"kind": "weekly"}, "kind"),
    ({"times": ["8pm"]}, "HH:MM"),
    ({"title": "Visit https://x.example"}, "title"),
])
def test_rejections(change, why):
    kept, rejected = er.validate_extraction(reply(entry(**change)), PAGE, TODAY)
    assert not kept and why in rejected[0].why


def test_dated_outside_window_or_date_not_in_quote_rejected():
    far = {"kind": "dated", "title": "Idlewild", "weekdays": [], "date": "2027-03-01", "times": ["19:00"], "quote": "Nov 14 Idlewild live, doors 19:00 £25"}
    past = dict(far, date="2026-10-01")
    wrong = dict(far, date="2026-11-20")
    for e in (far, past, wrong):
        kept, rej = er.validate_extraction(reply(e), PAGE, TODAY)
        assert not kept and rej


def test_duplicates_collapse_and_bad_json_is_rejected_not_raised():
    kept, _ = er.validate_extraction(reply(entry(), entry()), PAGE, TODAY)
    assert len(kept) == 1
    kept, rej = er.validate_extraction("sorry, I cannot", PAGE, TODAY)
    assert not kept and rej
    kept, _ = er.validate_extraction("```json\n" + reply(entry()) + "\n```", PAGE, TODAY)
    assert len(kept) == 1


# --- one venue ------------------------------------------------------------------------------------------------------------

class FakeSession:
    """Answers by URL: {url: (status, body, final_url)}; anything else is 'no answer'."""
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def get(self, url, headers, timeout, allow_redirects, stream):
        self.calls.append(url)
        if url not in self.routes:
            raise ConnectionError("no route")
        status, body, final = self.routes[url]
        final = final or url

        class R:
            status_code = status
            encoding, content, raw = "utf-8", body.encode(), None
            pass
        R.url = final
        return R()


def fx(session):
    """The venue check's fetcher: no log file, no saved copies, no waiting."""
    from scrapers.polite_fetch import MemoryLedger, PoliteFetcher
    return PoliteFetcher("register", "glasgow", session=session, ledger=MemoryLedger(), cache_dir=None, sleep=lambda s: None)


VENUE = {"venue_id": "stand", "name": "The Stand", "url": URL, "default_group": "Comedy & shows"}
LONG = "<p>" + ("Welcome to the venue. " * 20) + "</p>" + "<p>" + PAGE.replace("\n", "</p><p>") + "</p>"


def run(routes, raw_reply=None):
    calls = []

    def extract(system, text):
        calls.append(text)
        return raw_reply if raw_reply is not None else reply(entry())

    res = er.check_venue(VENUE, fx(FakeSession(routes)), extract, TODAY)
    return res, calls


def test_flow_ok_extracts_and_keeps_rules():
    res, calls = run({"https://venue.example/robots.txt": (404, "", None), URL: (200, page("The Stand Comedy Club", LONG), None)})
    assert res.status == "ok" and len(res.rules) == 1 and calls


def test_flow_robots_names_ai_bot_skips_without_fetching_page():
    sess = FakeSession({"https://venue.example/robots.txt": (200, "User-agent: GPTBot\nDisallow: /", None)})
    res = er.check_venue(VENUE, fx(sess), lambda s, t: pytest.fail("model must not run"), TODAY)
    assert res.status == "skipped" and sess.calls == ["https://venue.example/robots.txt"]


def test_flow_identity_failure_flags_and_never_calls_the_model():
    routes = {"https://venue.example/robots.txt": (404, "", None), URL: (200, page("Best Online Casino", LONG), None)}
    res, calls = run(routes)
    assert res.status == "flagged" and not calls and not res.rules


def test_flow_redirect_to_other_domain_is_flagged():
    routes = {"https://venue.example/robots.txt": (404, "", None), URL: (200, page("The Stand", LONG), "https://www.hugedomains.com/x")}
    res, calls = run(routes)
    assert res.status == "flagged" and "another domain" in res.reason and not calls


def test_flow_www_redirect_is_fine_and_script_rendered_page_extracts_nothing():
    routes = {"https://venue.example/robots.txt": (404, "", None), URL: (200, page("The Stand", "<p>Loading</p>"), "https://www.venue.example/whats-on")}
    res, calls = run(routes)
    assert res.status == "ok" and not res.rules and not calls


def test_a_second_dry_run_the_same_day_reads_the_saved_copy(tmp_path):
    # 2026-11-13: every dry run refetched (the 7-day/24 h guards were read only with --apply); now polite_fetch's day limit holds
    from scrapers.polite_fetch import MemoryLedger, PoliteFetcher
    routes = {"https://venue.example/robots.txt": (404, "", None), URL: (200, page("The Stand Comedy Club", LONG), None)}
    ledger, sessions = MemoryLedger(), [FakeSession(routes), FakeSession(routes)]
    for sess in sessions:
        f = PoliteFetcher("dryrun", "glasgow", session=sess, ledger=ledger, cache_dir=tmp_path, sleep=lambda s: None)
        assert er.check_venue(VENUE, f, lambda s, t: reply(entry()), TODAY).status == "ok"
    assert URL in sessions[0].calls and URL not in sessions[1].calls


def test_flow_unreachable_or_error_page_is_skipped():
    assert run({})[0].status == "skipped"
    assert run({"https://venue.example/robots.txt": (404, "", None), URL: (429, "", None)})[0].status == "skipped"


# --- refresh script -------------------------------------------------------------------------------------------------------

def test_due_guard():
    now = datetime(2026, 11, 9, 11, tzinfo=timezone.utc)
    assert refresh.due(None, now)
    assert refresh.due(datetime(2026, 11, 2, tzinfo=timezone.utc), now)
    assert refresh.due(datetime(2026, 11, 8, tzinfo=timezone.utc), now, force=True)
    assert not refresh.due(now - timedelta(hours=19, minutes=59), now)  # a double run the same day
    assert not refresh.due(now - timedelta(hours=1), now)


def test_a_venue_checked_four_days_ago_is_not_skipped():
    # 2026-11-02 regression: checked Thu 10-29, the Monday tick 4 days later skipped every venue and the dated rules lapsed
    assert refresh.MIN_HOURS_BETWEEN_RUNS == 20
    assert refresh.due(datetime(2026, 10, 29, 11, tzinfo=timezone.utc), datetime(2026, 11, 2, 11, tzinfo=timezone.utc))
    assert refresh.due(datetime(2026, 11, 2, 11, tzinfo=timezone.utc), datetime(2026, 11, 9, 11, tzinfo=timezone.utc))
    assert refresh.due(datetime(2026, 11, 2, 11, 3, tzinfo=timezone.utc), datetime(2026, 11, 3, 7, 3, tzinfo=timezone.utc))  # exactly 20 h


def test_configs_register_is_well_formed():
    towns = {t["town_id"]: t for t in refresh.towns_with_register()}
    assert set(towns) == {"glasgow", "broomfield_co"}
    for t in towns.values():
        ids = [v["venue_id"] for v in t["venues"]]
        assert len(ids) == len(set(ids))
        for v in t["venues"]:
            assert v["url"].startswith("https://") and v["default_group"] in er.GROUPS


def test_time_in_quote_formats():
    assert er._time_in_quote("12th November 2026 @ 08:00 PM", "20:00")
    assert er._time_in_quote("Thu 29 Oct 22:00", "22:00")
    assert er._time_in_quote("doors 7pm", "19:00")
    assert er._time_in_quote("Tuesdays 7.30pm", "19:30")
    assert not er._time_in_quote("12th November 2026", "20:00")
    assert not er._time_in_quote("doors 7pm", "17:00")


def test_json_with_fence_and_trailing_remark_is_still_read():
    raw = "```json\n" + reply(entry()) + "\n```\n\nThe page lists one night."
    kept, rej = er.validate_extraction(raw, PAGE, TODAY)
    assert len(kept) == 1 and not rej


# --- owner 2026-10-29: og:site_name / header identity, detail pages ----------------------------------------------------------

def test_identity_accepts_og_site_name_and_header():
    og = '<html><head><title>Event Calendar</title><meta property="og:site_name" content="Arvada Center"></head><body></body></html>'
    assert er.identity_check("Arvada Center", og).ok
    hdr = "<html><head><title>Home</title></head><body><header><a>Arvada Center for the Arts</a></header></body></html>"
    assert er.identity_check("Arvada Center", hdr).ok
    assert not er.identity_check("Arvada Center", "<html><head><title>Home</title></head><body><p>Arvada Center</p></body></html>").ok


def test_hijack_marker_in_og_site_name_still_fails():
    og = '<html><head><title>The Stand</title><meta property="og:site_name" content="Casino Royale"></head></html>'
    assert not er.identity_check("The Stand", og).ok


LIST_PAGE = ("<html><head><title>What's On | The Stand</title></head><body><h1>The Stand</h1>" + "<p>" + "Welcome to the venue. " * 20 + "</p>"
             '<ul><li><a href="/event/idlewild">Idlewild</a> Nov 14</li><li><a href="https://other.example/x">Idlewild elsewhere</a></li></ul></body></html>')
DETAIL = ("<html><head><title>Idlewild | The Stand</title></head><body><h1>Idlewild</h1><p>" + "Details about the night. " * 10 +
          "</p><p>Nov 14 Idlewild live, doors 19:00 £25</p></body></html>")


def detail_routes(extra=None):
    r = {"https://venue.example/robots.txt": (404, "", None), URL: (200, LIST_PAGE, None), "https://venue.example/event/idlewild": (200, DETAIL, None)}
    r.update(extra or {})
    return r


def detail_extract(system, text):
    if "doors 19:00" in text:
        return reply({"kind": "dated", "title": "Idlewild", "weekdays": [], "date": "2026-11-14", "times": ["19:00"], "quote": "Nov 14 Idlewild live, doors 19:00 £25"})
    return reply({"kind": "dated", "title": "Idlewild", "weekdays": [], "date": "2026-11-14", "times": [], "quote": "Idlewild Nov 14"})


def test_detail_page_read_only_for_entries_without_time_and_same_domain():
    sess = FakeSession(detail_routes())
    res = er.check_venue(VENUE, fx(sess), detail_extract, TODAY)
    assert [r.title for r in res.rules] == ["Idlewild"] and res.rules[0].times == ["19:00"] and res.rules[0].price == "£25"
    assert res.rules[0].source_url == "https://venue.example/event/idlewild"
    assert res.detail_urls == ["https://venue.example/event/idlewild"]
    assert "https://other.example/x" not in sess.calls


def test_detail_page_skipped_when_fetched_today_or_blocked_by_robots_or_identity():
    res = er.check_venue(VENUE, fx(FakeSession(detail_routes())), detail_extract, TODAY, detail_allowed=lambda u: False)
    assert not res.rules and not res.detail_urls and any("24 h" in n for n in res.notes)
    robots = detail_routes({"https://venue.example/robots.txt": (200, "User-agent: *\nDisallow: /event/\n", None)})
    res = er.check_venue(VENUE, fx(FakeSession(robots)), detail_extract, TODAY)
    assert not res.rules and any("robots" in n for n in res.notes)
    hijacked = detail_routes({"https://venue.example/event/idlewild": (200, DETAIL.replace("The Stand", "Best Online Casino"), None)})
    res = er.check_venue(VENUE, fx(FakeSession(hijacked)), detail_extract, TODAY)
    assert not res.rules and any("identity" in n for n in res.notes)


def test_detail_pages_capped_at_ten():
    links = "".join(f'<a href="/event/e{i}">Event number {i} show</a>' for i in range(15))
    page_html = LIST_PAGE.replace("</body>", links + "</body>")
    rejected = [er.Rejected({"title": f"Event number {i} show", "times": []}, "times must be HH:MM") for i in range(15)]
    p, _ = er.parse_page(page_html)
    assert len(er.detail_links(rejected, p.links, URL)) == er.MAX_DETAIL_PAGES


# --- weeks of the month, an end date, happy hour, opening-hours notices (owner 2026-11-13) ------------------------------------
# Verbatim page text from .claude/evidence/venues-2026-11/broomfield/ (Rails End /live-music/, The Old Man Bar specials) and
# .claude/evidence/feeds-2026-11/broomfield/ (4 Noses /broomfield-events), fetched 2026-11-13.
NOV13 = date(2026, 11, 13)
RAILS_END = ("LIVE MUSIC\nOPEN MIC NIGHT\n3rd Thursday of every month\nThursday, Nov 19th 6:00-10:00PM\nCome enjoy the show!\n"
             "LIVE MUSIC\nOPEN JAM\n1st & 3rd Monday from 6:00-9:00PM.")
FOUR_NOSES = ("TRIVIA EVERY MONDAY 6:30PM-8:30PM Nov 1 to Nov 24\nClosed For Thanksgiving Thursday, November 26, 2026\n"
              "Black Friday Hours Friday, November 27, 2026 11:00 AM 9:00 PM")
OLD_MAN = ("Monday November 16th\nBurger Mondays All Day | $9.00 Pub Burger\n11:00 AM - 10:00 PM\n"
           "Happy Hour | 3-6pm & 10pm-Close | $4.00 - Wells | $1.00 OFF - Wine | $1.00 OFF - Micro Drafts\n03:00 PM - 02:00 AM")


def test_first_and_third_monday_is_kept_with_its_weeks_and_its_own_key():
    e = entry(title="Open Jam", weekdays=["mon"], weeks_of_month=[1, 3], times=["18:00"], quote="1st & 3rd Monday from 6:00-9:00PM")
    kept, rej = er.validate_extraction(reply(e), RAILS_END, NOV13)
    assert not rej and kept[0].weeks_of_month == [1, 3] and kept[0].times == ["18:00"]
    assert kept[0].key.endswith("|w1,3")
    # an every-week rule keeps the key it had before weeks_of_month existed
    plain, _ = er.validate_extraction(reply(entry()), PAGE, TODAY)
    assert plain[0].key == "recurring|comedy night|2|"


def test_third_thursday_from_a_range_with_the_pm_on_the_end():
    e = entry(title="Open Mic Night", weekdays=["thu"], weeks_of_month=[3], times=["18:00"],
              quote="3rd Thursday of every month\nThursday, Nov 19th 6:00-10:00PM")
    kept, rej = er.validate_extraction(reply(e), RAILS_END, NOV13)
    assert not rej and kept[0].weeks_of_month == [3]


def test_a_week_of_the_month_the_quote_does_not_say_is_rejected():
    e = entry(title="Open Jam", weekdays=["mon"], weeks_of_month=[2], times=["18:00"], quote="1st & 3rd Monday from 6:00-9:00PM")
    kept, rej = er.validate_extraction(reply(e), RAILS_END, NOV13)
    assert not kept and "week of the month" in rej[0].why


def test_valid_until_from_the_quote():
    e = entry(title="Trivia", weekdays=["mon"], times=["18:30"], valid_until="2026-11-24", quote="TRIVIA EVERY MONDAY 6:30PM-8:30PM Nov 1 to Nov 24")
    kept, rej = er.validate_extraction(reply(e), FOUR_NOSES, NOV13)
    assert not rej and kept[0].valid_until == date(2026, 11, 24)
    wrong = dict(e, valid_until="2026-11-30")
    kept, rej = er.validate_extraction(reply(wrong), FOUR_NOSES, NOV13)
    assert not kept and "valid_until" in rej[0].why


@pytest.mark.parametrize("title,day,time,quote", [
    ("Closed For Thanksgiving", "2026-11-26", "17:00", "Closed For Thanksgiving Thursday, November 26, 2026"),
    ("Black Friday Hours", "2026-11-27", "21:00", "Black Friday Hours Friday, November 27, 2026 11:00 AM 9:00 PM"),
])
def test_opening_hours_notices_are_not_events(title, day, time, quote):
    e = {"kind": "dated", "title": title, "weekdays": [], "date": day, "times": [time], "quote": quote}
    kept, rej = er.validate_extraction(reply(e), FOUR_NOSES, NOV13)
    assert not kept and "opening-hours notice" in rej[0].why


def test_happy_hour_may_start_at_15_and_nothing_else_may():
    e = entry(title="Happy Hour", weekdays=["mon"], times=["15:00"], quote="Monday November 16th\nBurger Mondays All Day | $9.00 Pub Burger\n11:00 AM - 10:00 PM\nHappy Hour | 3-6pm")
    kept, rej = er.validate_extraction(reply(e), OLD_MAN, NOV13)
    assert not rej and kept[0].times == ["15:00"]
    burger = dict(e, title="Burger Mondays", times=["11:00"])
    kept, rej = er.validate_extraction(reply(burger), OLD_MAN, NOV13)
    assert not kept and "before 17:00" in rej[0].why


# Proposal 6 (owner 2026-11-13): The Old Man Bar's specials page, lines 25-60 verbatim of
# .claude/evidence/venues-2026-11/broomfield/the-old-man-happy-hours.txt (fetched 2026-11-13 10:40 UTC): a week, Fri 13 - Thu 19 Nov,
# one date heading per day and the day's own lines under it.
from pathlib import Path  # noqa: E402

OLD_MAN_WEEK = (Path(__file__).parent / "fixtures" / "old_man_specials_2026-11-13.txt").read_text(encoding="utf-8")
HAPPY_LINE = "Happy Hour | 3-6pm & 10pm-Close | $4.00 - Wells | $1.00 OFF - Wine | $1.00 OFF - Micro Drafts"
TUESDAY_LINE = "Tuesday Specials | $2 Tuesday! $2 WELL drinks and Bud Light from 6:30p-2a"


def test_bare_p_and_a_suffixes_are_times():
    assert er._time_in_quote(TUESDAY_LINE, "18:30")
    assert er._time_in_quote("3-6p", "15:00") and er._time_in_quote("from 6p", "18:00")
    assert not er._time_in_quote("6 people", "18:00") and not er._time_in_quote("6pax", "18:00")


def test_two_part_quote_two_dollar_tuesday_is_kept_for_tuesday_at_1830():
    e = {"kind": "dated", "title": "$2 Tuesday", "weekdays": [], "date": "2026-11-17", "times": ["18:30"],
         "quote": TUESDAY_LINE, "date_quote": "Tuesday November 17th"}
    kept, rej = er.validate_extraction(reply(e), OLD_MAN_WEEK, NOV13)
    assert not rej
    # the page shows 7 consecutive days, so a line under one Tuesday is the Tuesday rule
    assert [(r.kind, r.weekdays, r.times) for r in kept] == [("recurring", [2], ["18:30"])]
    assert kept[0].quote == f"Tuesday November 17th / {TUESDAY_LINE}" and kept[0].price == "$2"


def test_happy_hour_under_all_seven_days_is_one_daily_rule_at_15_and_its_own_rule_at_22():
    e = {"kind": "dated", "title": "Happy Hour", "weekdays": [], "date": "2026-11-14", "times": ["15:00"],
         "quote": HAPPY_LINE, "date_quote": "Saturday November 14th"}
    kept, rej = er.validate_extraction(reply(e), OLD_MAN_WEEK, NOV13)
    assert not rej
    assert [(r.kind, r.weekdays, r.times) for r in kept] == [("recurring", [1, 2, 3, 4, 5, 6, 7], ["15:00"]),
                                                             ("recurring", [1, 2, 3, 4, 5, 6, 7], ["22:00"])]
    assert kept[0].quote == f"{HAPPY_LINE} (listed under each day Nov 13-Nov 19)"
    assert kept[0].key == "recurring|happy hour|1,2,3,4,5,6,7|" and kept[1].key == "recurring|happy hour|1,2,3,4,5,6,7||22:00"


def test_the_model_listing_happy_hour_once_per_day_still_gives_two_rules():
    days = [("Friday November 13th", "2026-11-13"), ("Saturday November 14th", "2026-11-14"), ("Monday November 16th", "2026-11-16")]
    entries = [{"kind": "dated", "title": "Happy Hour", "weekdays": [], "date": d, "times": ["15:00", "22:00"],
                "quote": HAPPY_LINE, "date_quote": h} for h, d in days]
    kept, rej = er.validate_extraction(reply(*entries), OLD_MAN_WEEK, NOV13)
    assert not rej and [r.times for r in kept] == [["15:00"], ["22:00"]]


def test_a_date_heading_after_the_rule_line_or_another_heading_between_is_rejected():
    after = {"kind": "dated", "title": "$2 Tuesday", "weekdays": [], "date": "2026-11-18", "times": ["18:30"],
             "quote": TUESDAY_LINE, "date_quote": "Wednesday November 18th"}
    between = dict(after, date="2026-11-16", date_quote="Monday November 16th")
    for e in (after, between):
        kept, rej = er.validate_extraction(reply(e), OLD_MAN_WEEK, NOV13)
        assert not kept and rej[0].why == "date_quote is not the date heading directly above the quote"


def test_the_time_must_stand_in_the_rule_line_not_on_the_next_line():
    e = {"kind": "dated", "title": "Fireball Friday", "weekdays": [], "date": "2026-11-13", "times": ["17:00"],
         "quote": "Fireball Friday! $4 all day", "date_quote": "Friday November 13th"}
    kept, rej = er.validate_extraction(reply(e), OLD_MAN_WEEK, NOV13)
    assert not kept and rej[0].why == "no listed time appears in the quote"


def test_without_seven_consecutive_days_a_line_under_some_days_stays_dated_per_date():
    # The same page cut to Fri 13 - Mon 16 (the one changed field: the week is shorter)
    short = OLD_MAN_WEEK.split("Tuesday November 17th")[0]
    e = {"kind": "dated", "title": "Happy Hour", "weekdays": [], "date": "2026-11-13", "times": ["15:00"],
         "quote": HAPPY_LINE, "date_quote": "Friday November 13th"}
    kept, rej = er.validate_extraction(reply(e), short, NOV13)
    assert not rej
    assert sorted({(r.kind, r.on_date) for r in kept}) == [("dated", date(2026, 11, d)) for d in (13, 14, 15, 16)]
    assert {tuple(r.times) for r in kept} == {("15:00",), ("22:00",)}
    assert kept[0].quote == f"Friday November 13th / {HAPPY_LINE}"


def test_a_heading_whose_weekday_does_not_fit_its_date_is_ignored():
    # "Saturday November 15th": the one changed field is the weekday (Nov 15 2026 is a Sunday)
    assert er._heading_date("Saturday November 15th", NOV13) is None
    assert er._heading_date("Sunday November 15th", NOV13) == date(2026, 11, 15)
