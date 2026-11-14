"""scrapers/polite_fetch.py (owner 2026-11-13, proposal 4): strict robots, one fetch per URL per UTC day for evidence/dryrun/register
(a second request gets that day's saved copy), 403/challenge = link only, another domain = refused. No network anywhere."""
from datetime import datetime, timezone
from pathlib import Path

import pytest

from scrapers import polite_fetch as pf

ROBOTS = Path(__file__).parent / "fixtures" / "robots"
URL = "https://venue.example/whats-on"
ROBOTS_URL = "https://venue.example/robots.txt"
NOON = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)


class FakeSession:
    """{url: (status, body[, final_url[, headers]])}; anything else is 'no answer'."""
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def get(self, url, headers, timeout, allow_redirects, stream):
        self.calls.append((url, headers["User-Agent"]))
        if url not in self.routes:
            raise ConnectionError("no route")
        status, body, final, hdrs = (list(self.routes[url]) + [None, None])[:4]

        class R:
            status_code = status
            encoding, content, raw = "utf-8", body.encode(), None
            headers = hdrs or {}
        R.url = final or url
        return R()


def fetcher(routes, purpose="register", ledger=None, tmp=None, clock=NOON):
    sess = FakeSession(routes)
    f = pf.PoliteFetcher(purpose, "broomfield_co", session=sess, ledger=ledger if ledger is not None else pf.MemoryLedger(),
                         cache_dir=tmp, clock=lambda: clock, sleep=lambda s: None)
    return f, sess


def urls(sess):
    return [u for u, _ in sess.calls]


def test_strict_robots_a_real_robots_txt_naming_gptbot_refuses_the_whole_site():
    # tests/fixtures/robots/visitbrookings.txt verbatim: GPTBot is only kept off /events/, strict mode excludes the site
    f, sess = fetcher({ROBOTS_URL: (200, (ROBOTS / "visitbrookings.txt").read_text(encoding="utf-8")), URL: (200, "<p>x</p>")})
    got = f.get(URL)
    assert isinstance(got, pf.Refused) and "gptbot" in got.reason.lower()
    assert urls(sess) == [ROBOTS_URL]


def test_strict_robots_anthropic_ai_refuses():
    # tests/fixtures/robots/sdhsaa.txt verbatim + ONE changed field: an anthropic-ai group (the token 4 Noses' robots.txt named, 13 Nov)
    body = (ROBOTS / "sdhsaa.txt").read_text(encoding="utf-8") + "\nUser-agent: anthropic-ai\nDisallow: /\n"
    f, sess = fetcher({ROBOTS_URL: (200, body), URL: (200, "<p>x</p>")})
    got = f.get(URL)
    assert isinstance(got, pf.Refused) and "anthropic-ai" in got.reason
    assert urls(sess) == [ROBOTS_URL]
    ok, _ = fetcher({ROBOTS_URL: (200, (ROBOTS / "sdhsaa.txt").read_text(encoding="utf-8")), URL: (200, "<p>x</p>")})
    assert isinstance(ok.get(URL), pf.Fetched)


def test_robots_is_read_once_per_origin_and_every_request_uses_the_one_ua():
    f, sess = fetcher({ROBOTS_URL: (404, ""), URL: (200, "a"), URL + "/2": (200, "b")}, purpose="source")
    f.get(URL)
    f.get(URL + "/2")
    assert urls(sess) == [ROBOTS_URL, URL, URL + "/2"]
    assert {ua for _, ua in sess.calls} == {"ViewMediaBot (+https://broomfieldview.com/contact)"}


@pytest.mark.parametrize("purpose", ["register", "dryrun", "evidence"])
def test_second_fetch_the_same_day_gets_the_saved_copy_not_a_request(purpose, tmp_path):
    ledger = pf.MemoryLedger()
    f, _ = fetcher({ROBOTS_URL: (404, ""), URL: (200, "first")}, purpose, ledger, tmp_path)
    assert f.get(URL).text == "first"
    g, sess2 = fetcher({ROBOTS_URL: (404, ""), URL: (200, "second")}, "register", ledger, tmp_path)
    again = g.get(URL)
    assert again.from_cache and again.text == "first" and URL not in urls(sess2)


def test_second_fetch_the_same_day_without_a_saved_copy_is_refused(tmp_path):
    ledger = pf.MemoryLedger()
    fetcher({ROBOTS_URL: (404, ""), URL: (200, "first")}, "dryrun", ledger, tmp_path)[0].get(URL)
    g, sess = fetcher({ROBOTS_URL: (404, ""), URL: (200, "x")}, "register", ledger, tmp_path / "elsewhere")
    got = g.get(URL)
    assert isinstance(got, pf.Refused) and "already fetched today at 12:00" in got.reason
    assert URL not in urls(sess)


def test_the_next_day_fetches_again_and_source_has_no_day_limit(tmp_path):
    ledger = pf.MemoryLedger()
    fetcher({ROBOTS_URL: (404, ""), URL: (200, "a")}, "register", ledger, tmp_path)[0].get(URL)
    nxt = datetime(2026, 11, 14, 0, 5, tzinfo=timezone.utc)
    assert not fetcher({ROBOTS_URL: (404, ""), URL: (200, "b")}, "register", ledger, tmp_path, nxt)[0].get(URL).from_cache
    s, sess = fetcher({ROBOTS_URL: (404, ""), URL: (200, "c")}, "source", ledger, tmp_path)
    assert s.get(URL).text == "c" and URL in urls(sess)


def test_every_request_is_logged_with_purpose_status_and_hash():
    ledger = pf.MemoryLedger()
    fetcher({ROBOTS_URL: (404, ""), URL: (200, "page")}, "register", ledger)[0].get(URL)
    rows = ledger.entries()
    assert [(r["url"], r["purpose"], r["status"]) for r in rows] == [(ROBOTS_URL, "robots", 404), (URL, "register", 200)]
    assert rows[1]["domain"] == "venue.example" and rows[1]["town_id"] == "broomfield_co" and rows[1]["where"] == "local"
    assert rows[1]["sha256"] == pf._sha(b"page") and rows[1]["utc"] == "2026-11-13T12:00:00+00:00"


def test_a_403_is_link_only_and_a_second_one_closes_the_domain():
    ledger = pf.MemoryLedger()
    f, _ = fetcher({ROBOTS_URL: (404, ""), URL: (403, "Forbidden")}, "source", ledger)
    got = f.get(URL)
    assert isinstance(got, pf.Refused) and got.link_only
    # the same day: no new request at all
    g, sess = fetcher({ROBOTS_URL: (404, ""), URL: (200, "ok")}, "source", ledger)
    assert isinstance(g.get(URL), pf.Refused) and sess.calls == []
    # one new attempt on a later day, then the domain is closed
    day2 = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
    h, _ = fetcher({ROBOTS_URL: (404, ""), URL: (403, "Forbidden")}, "source", ledger, clock=day2)
    assert isinstance(h.get(URL), pf.Refused)
    day9 = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)
    k, sess = fetcher({ROBOTS_URL: (404, ""), URL: (200, "ok")}, "source", ledger, clock=day9)
    got = k.get(URL + "/other")
    assert isinstance(got, pf.Refused) and "twice" in got.reason and got.link_only and sess.calls == []


def test_a_403_closes_the_host_not_a_shared_platform():
    # 2026-11-13 survey: services5.arcgis.com and services2.arcgis.com both answered 403 to robots.txt; other arcgis.com hosts did not
    ledger = pf.MemoryLedger()
    for host in ("services5", "services2"):
        f, _ = fetcher({f"https://{host}.arcgis.com/robots.txt": (403, "")}, "source", ledger)
        assert isinstance(f.get(f"https://{host}.arcgis.com/arcgis/rest/services"), pf.Refused)
    g, sess = fetcher({"https://geocode.arcgis.com/robots.txt": (404, ""), "https://geocode.arcgis.com/x": (200, "ok")}, "source", ledger)
    assert isinstance(g.get("https://geocode.arcgis.com/x"), pf.Fetched)


def test_a_cloudflare_challenge_is_a_no_and_robots_403_is_a_no():
    page = "<title>Just a moment...</title>challenge-platform"
    f, _ = fetcher({ROBOTS_URL: (404, ""), URL: (503, page, None, {"cf-mitigated": "challenge"})})
    got = f.get(URL)
    assert isinstance(got, pf.Refused) and "challenge" in got.reason and got.link_only
    g, sess = fetcher({ROBOTS_URL: (403, "no"), URL: (200, "ok")})
    assert isinstance(g.get(URL), pf.Refused) and urls(sess) == [ROBOTS_URL]


def test_a_redirect_to_another_domain_is_refused_www_is_fine():
    f, _ = fetcher({ROBOTS_URL: (404, ""), URL: (200, "x", "https://www.hugedomains.com/x")})
    got = f.get(URL)
    assert isinstance(got, pf.Refused) and "another domain" in got.reason
    g, _ = fetcher({ROBOTS_URL: (404, ""), URL: (200, "x", "https://www.venue.example/whats-on")})
    assert isinstance(g.get(URL), pf.Fetched)


def test_no_answer_is_a_fetched_without_status_and_unknown_purpose_raises():
    f, _ = fetcher({ROBOTS_URL: (404, "")})
    assert f.get(URL).status is None
    with pytest.raises(ValueError):
        pf.PoliteFetcher("scrape", session=FakeSession({}), ledger=pf.MemoryLedger())


def test_params_are_part_of_the_logged_url():
    ledger = pf.MemoryLedger()
    full = "https://venue.example/wp-json/tribe/events/v1/events?per_page=50&start_date=2026-11-12"
    f, _ = fetcher({ROBOTS_URL: (404, ""), full: (200, "{}")}, "source", ledger)
    got = f.get("https://venue.example/wp-json/tribe/events/v1/events", params={"per_page": 50, "start_date": "2026-11-12"})
    assert got.status == 200 and ledger.entries()[-1]["url"] == full


def test_file_ledger_writes_one_file_per_utc_day(tmp_path):
    led = pf.FileLedger(tmp_path)
    fetcher({ROBOTS_URL: (404, ""), URL: (200, "x")}, "register", led)[0].get(URL)
    assert [p.name for p in tmp_path.iterdir()] == ["2026-11-13.jsonl"] and len(led.entries()) == 2


# --- event_sources goes through polite_fetch in STANDARD mode (owner 2026-11-13: structured feeds the code parses) ----------------
# chippers_100_nickel from configs/broomfield_co.json (tribe_rest), library + chamber from configs/brookings_sd.json (ical)

CHIPPERS = {"name": "chippers_100_nickel", "kind": "tribe_rest", "url": "https://chipperslanes.com/wp-json/tribe/events/v1/events",
            "venue_city": "Broomfield"}
CHIPPERS_ROBOTS = "https://chipperslanes.com/robots.txt"
CHAMBER = {"name": "chamber", "kind": "ical", "url": "https://visitbrookingssd.com/events/?ical=1"}
LIBRARY = {"name": "library", "kind": "ical", "url": "https://brookingslibrary.libcal.com/ical_subscribe.php?src=p&cid=19943"}
UA_BROOMFIELD = {"User-Agent": "ViewMediaBot (+https://broomfieldview.com/contact)"}
UA_BROOKINGS = {"User-Agent": "ViewMediaBot (+https://brookingsview.com/contact)"}


def _patch(monkeypatch, routes, ledger):
    """event_sources' own _fetcher (its robots_mode included), with a fake session, an in-memory log and no waiting."""
    from scrapers import event_sources as es
    sess = FakeSession(routes)
    real = pf.PoliteFetcher
    monkeypatch.setattr(es, "PoliteFetcher", lambda *a, **kw: real(*a, session=sess, ledger=ledger, cache_dir=None,
                                                                    sleep=lambda s: None, **kw))
    return es, sess


def test_event_sources_use_standard_mode_and_the_register_strict(monkeypatch):
    es, _ = _patch(monkeypatch, {}, pf.MemoryLedger())
    assert es._fetcher(CHAMBER, UA_BROOKINGS).robots_mode == "standard"
    assert es._fetcher(CHAMBER, UA_BROOKINGS).town_id == "brookings_sd"
    assert pf.PoliteFetcher("register", "glasgow", session=FakeSession({}), ledger=pf.MemoryLedger()).robots_mode == "strict"


def test_a_feed_whose_robots_names_an_ai_crawler_is_still_read_in_standard_mode(monkeypatch):
    # visitbrookings.txt verbatim (GPTBot kept off /events/): the chamber iCal stays (owner 2026-11-13)
    body = (ROBOTS / "visitbrookings.txt").read_text(encoding="utf-8")
    es, sess = _patch(monkeypatch, {"https://visitbrookingssd.com/robots.txt": (200, body), CHAMBER["url"]: (200, "BEGIN:VCALENDAR")}, pf.MemoryLedger())
    assert es._fetch_ical(CHAMBER, UA_BROOKINGS) == b"BEGIN:VCALENDAR"
    assert CHAMBER["url"] in urls(sess)


def test_a_disallow_in_standard_mode_always_stops_a_feed(monkeypatch):
    # sdhsaa.txt verbatim ("User-agent: *" ... "Disallow: /*?") served for libcal: the feed URL has a query, so it is disallowed for us
    # (the way tockify.com disallows /api/feeds/ics/ for Moreno Valley's two feeds, survey 2026-11-13)
    body = (ROBOTS / "sdhsaa.txt").read_text(encoding="utf-8")
    es, sess = _patch(monkeypatch, {"https://brookingslibrary.libcal.com/robots.txt": (200, body), LIBRARY["url"]: (200, "x")}, pf.MemoryLedger())
    assert es._fetch_ical(LIBRARY, UA_BROOKINGS) is None
    assert urls(sess) == ["https://brookingslibrary.libcal.com/robots.txt"]


def test_event_source_fetch_is_logged_and_an_error_status_raises(monkeypatch):
    ledger = pf.MemoryLedger()
    es, sess = _patch(monkeypatch, {CHIPPERS_ROBOTS: (404, "")}, ledger)
    import json as _json
    from datetime import timedelta
    since = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    full = f"{CHIPPERS['url']}?per_page=50&start_date={since}"
    sess.routes[full] = (200, _json.dumps({"events": []}))
    raw = es._fetch_tribe_rest(CHIPPERS, UA_BROOMFIELD)
    assert _json.loads(raw)["response"] == {"events": []}
    assert [(e["url"], e["purpose"]) for e in ledger.entries()] == [(CHIPPERS_ROBOTS, "robots"), (full, "source")]
    sess.routes[full] = (500, "oops")
    with pytest.raises(RuntimeError, match="answered 500"):
        es._fetch_tribe_rest(CHIPPERS, UA_BROOMFIELD)


# --- public APIs: their API terms, not robots.txt (owner 2026-11-13) ----------------------------------------------------------------

@pytest.mark.parametrize("url,terms", [
    ("https://overpass-api.de/api/interpreter", "https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances"),
    ("https://nominatim.openstreetmap.org/search?q=x", "https://operations.osmfoundation.org/policies/nominatim/"),
    ("https://commons.wikimedia.org/w/api.php?action=query", "https://www.mediawiki.org/wiki/API:Etiquette"),
])
def test_api_terms_replace_robots_for_the_three_apis(url, terms):
    # robots.txt is never asked: the route table has none, so a robots request would show up as "no answer"
    ledger, slept = pf.MemoryLedger(), []
    sess = FakeSession({url: (200, "{}")})
    f = pf.PoliteFetcher("source", "glasgow", session=sess, ledger=ledger, cache_dir=None, sleep=slept.append)
    assert f.get(url).status == 200 and f.get(url).status == 200
    assert urls(sess) == [url, url]
    assert ledger.entries()[-1]["note"] == f"API terms, not robots.txt: {terms}"
    assert slept and min(slept) > 0  # the second request waited for the host's gap
    assert {ua for _, ua in sess.calls} == {"ViewMediaBot (+https://glasgowloop.co.uk/contact)"}


def test_api_terms_cover_only_their_path_and_the_gaps_match_the_terms():
    assert pf.api_terms("https://commons.wikimedia.org/wiki/File:X.jpg") is None
    assert pf.api_terms("https://nominatim.openstreetmap.org/search").min_gap_s >= 1.0  # "maximum of 1 request per second"
    assert all(t.attribution and t.terms_url.startswith("https://") for t in pf.API_TERMS)


# --- Crawl-delay above the cap (owner 2026-11-14, QA logic.crawl-delay-over-cap) ---------------------------------------------------

def _business_center(slept):
    # tests/fixtures/robots/morenovalleybusiness.txt verbatim (fetched 2026-11-14): "Crawl-delay: 600" in its `*` group. The probe of
    # 14 Nov sent robots + 3 requests about a minute apart because the 600 s were cut to MAX_CRAWL_DELAY_S.
    robots = "https://morenovalleybusiness.com/robots.txt"
    pages = ["https://morenovalleybusiness.com/events/", "https://morenovalleybusiness.com/events/?ical=1"]
    sess = FakeSession({robots: (200, (ROBOTS / "morenovalleybusiness.txt").read_text(encoding="utf-8")),
                        pages[0]: (200, "a"), pages[1]: (200, "b")})
    f = pf.PoliteFetcher("source", "moreno_valley_ca", session=sess, ledger=pf.MemoryLedger(), cache_dir=None, sleep=slept.append)
    return f, sess, robots, pages


def test_a_crawl_delay_above_the_cap_is_never_shortened_one_request_per_host_and_run():
    slept = []
    f, sess, robots, pages = _business_center(slept)
    assert f.get(pages[0]).status == 200
    second = f.get(pages[1])
    assert isinstance(second, pf.Refused) and "600" in second.reason and "one request per host" in second.reason
    assert urls(sess) == [robots, pages[0]]  # the second page is never requested
    assert all(s < pf.MAX_CRAWL_DELAY_S for s in slept)  # nothing waited a shortened delay instead
    again, sess2, _, _ = _business_center([])  # a new run (a new fetcher) gets its one request
    assert again.get(pages[1]).status == 200 and len(sess2.calls) == 2


def test_a_crawl_delay_under_the_cap_is_still_waited_between_requests():
    body = (ROBOTS / "morenovalleybusiness.txt").read_text(encoding="utf-8").replace("Crawl-delay: 600", "Crawl-delay: 10")  # the one changed field
    slept = []
    sess = FakeSession({ROBOTS_URL: (200, body), URL: (200, "a"), URL + "/2": (200, "b")})
    f = pf.PoliteFetcher("source", "broomfield_co", session=sess, ledger=pf.MemoryLedger(), cache_dir=None, sleep=slept.append)
    assert f.get(URL).status == 200 and f.get(URL + "/2").status == 200
    assert max(slept) > 9


# --- a higher size cap for one call (owner's one-off yes 2026-11-14: main.withapps.io's _app bundle was cut at MAX_BYTES) -------------

def test_max_bytes_raises_the_cap_for_one_call_and_the_default_cap_is_unchanged(tmp_path):
    big = "x" * (pf.MAX_BYTES + 500_000)  # only the size matters here: the real bundle was cut at exactly MAX_BYTES on 14 Nov
    f, sess = fetcher({ROBOTS_URL: (404, ""), URL: (200, big)}, purpose="evidence", tmp=tmp_path)
    assert len(f.get(URL).body) == pf.MAX_BYTES  # the default call is still cut
    assert len(f.get(URL).body) == pf.MAX_BYTES and urls(sess) == [ROBOTS_URL, URL]  # same day, default cap: the saved copy
    full = f.get(URL, max_bytes=5_000_000)  # the saved copy was cut at the cap, so a higher cap fetches once more
    assert len(full.body) == len(big) and urls(sess) == [ROBOTS_URL, URL, URL]
    assert f.get(URL, max_bytes=5_000_000).from_cache and len(sess.calls) == 3  # now the full copy is the day's copy


def test_max_bytes_never_lowers_the_cap_and_an_uncut_copy_is_reused():
    f, sess = fetcher({ROBOTS_URL: (404, ""), URL: (200, "small")}, purpose="source")
    assert f.get(URL, max_bytes=2).body == b"small"
    g, sess2 = fetcher({ROBOTS_URL: (404, ""), URL: (200, "small")}, purpose="evidence", tmp=None)
    g.cache_dir = None
    assert g.get(URL).status == 200
    assert isinstance(g.get(URL, max_bytes=5_000_000), pf.Refused)  # already fetched today, no cut copy: the day limit holds


def test_unknown_robots_mode_raises():
    with pytest.raises(ValueError):
        pf.PoliteFetcher("source", session=FakeSession({}), ledger=pf.MemoryLedger(), robots_mode="lenient")
