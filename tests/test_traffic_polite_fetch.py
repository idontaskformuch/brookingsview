"""Traffic scrapers through scrapers/polite_fetch.py (owner 2026-11-19, Beslut 10 punkt 2a). QA: qa/checks.json "ops.traffic-polite-fetch".
- No own HTTP client left in scrapers/parsers/traffic_v1.py or cdot_v1.py (a source scan, like test_alerts' repo scan).
- A feed that reaches the 1.5 MB cap fails the run with a clear error; it is never parsed cut (owner: "misslyckas tydligt").
- CDOT's apiKey is sent but never written to the fetch log, Fetched.url/final_url or an error.
Before this change both parsers called requests.get themselves: the scan and the fetch tests fail on eb9dfedb.
Robots answers are the real ones read via PoliteFetcher 19 Nov 2026: quickmap.dot.ca.gov/robots.txt = 200 with the app's HTML page
(no rules), data.cotrip.org/robots.txt = 404. URLs = configs/moreno_valley_ca.json / broomfield_co.json. No network anywhere."""
import re
from pathlib import Path

import pytest

from scrapers import polite_fetch as pf
from scrapers.parsers import cdot_v1, traffic_v1

ROOT = Path(__file__).resolve().parent.parent
LCS = "https://quickmap.dot.ca.gov/data/lcs2way.kml"
CHP = "https://quickmap.dot.ca.gov/data/chp-only.kml"
QUICKMAP_ROBOTS = "https://quickmap.dot.ca.gov/robots.txt"
COTRIP = "https://data.cotrip.org/api/v1/incidents"
COTRIP_ROBOTS = "https://data.cotrip.org/robots.txt"
QUICKMAP_ROBOTS_BODY = '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>QuickMap</title>'
KML = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document></Document></kml>'
SECRET = "not-the-real-key-0123456789"


class FakeSession:
    """{url: (status, body)}; anything else is 'no answer'. Records every URL requested."""
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def get(self, url, headers, timeout, allow_redirects, stream):
        self.calls.append(url)
        if url not in self.routes:
            raise ConnectionError("no route")
        status, body = self.routes[url]

        class R:
            status_code = status
            encoding, content, raw, headers = "utf-8", body.encode(), None, {}
        R.url = url
        return R()


@pytest.fixture
def wired(monkeypatch):
    """Both parsers build PoliteFetcher("source", town, ua=...); give them a fake session and an in-memory log."""
    state = {"ledger": pf.MemoryLedger(), "session": None}

    def make(purpose, town_id=None, **kw):
        return pf.PoliteFetcher(purpose, town_id, session=state["session"], ledger=state["ledger"], cache_dir=None,
                                sleep=lambda s: None, ua=kw.get("ua"))
    monkeypatch.setattr(traffic_v1, "PoliteFetcher", make)
    monkeypatch.setattr(cdot_v1, "PoliteFetcher", make)
    monkeypatch.setenv("CDOT_API_KEY", SECRET)
    return state


def _caltrans():
    return traffic_v1.TrafficParser({"town_id": "moreno_valley_ca"}, {
        "source": "caltrans_quickmap", "urls": {"lane_closures": LCS, "chp_incidents": CHP}})


def _cdot():
    return cdot_v1.CdotParser({"town_id": "broomfield_co"}, {"url": COTRIP})


def test_no_own_http_client_in_the_traffic_scrapers():
    for name in ("traffic_v1.py", "cdot_v1.py"):
        src = (ROOT / "scrapers" / "parsers" / name).read_text(encoding="utf-8")
        assert not re.search(r"^\s*(import|from)\s+(requests|httpx|urllib3|aiohttp)\b", src, re.M), name
        assert not re.search(r"\b(requests|httpx|urllib\.request|urlopen)\s*[\.(]", src), name
        assert "PoliteFetcher(" in src and "source_body(" in src, name


def test_caltrans_reads_both_feeds_through_polite_fetch(wired):
    wired["session"] = FakeSession({QUICKMAP_ROBOTS: (200, QUICKMAP_ROBOTS_BODY), LCS: (200, KML), CHP: (200, KML)})
    got = _caltrans().fetch()
    assert wired["session"].calls == [QUICKMAP_ROBOTS, LCS, CHP]
    assert got.raw == f"{KML}\n{KML}".encode()
    assert [e["url"] for e in wired["ledger"].entries()] == [QUICKMAP_ROBOTS, LCS, CHP]


def test_a_feed_at_the_size_cap_fails_the_run_and_is_never_parsed_cut(wired):
    big = KML + " " * pf.MAX_BYTES  # only the size differs from the real feed shape
    wired["session"] = FakeSession({QUICKMAP_ROBOTS: (200, QUICKMAP_ROBOTS_BODY), LCS: (200, big), CHP: (200, KML)})
    with pytest.raises(RuntimeError, match=r"traffic lane_closures: .*lcs2way\.kml reached the \d+ byte size cap"):
        _caltrans().fetch()


def test_a_refusal_or_an_error_answer_fails_the_run(wired):
    wired["session"] = FakeSession({QUICKMAP_ROBOTS: (200, "User-agent: *\nDisallow: /data/\n"), LCS: (200, KML), CHP: (200, KML)})
    with pytest.raises(RuntimeError, match="polite_fetch refused"):
        _caltrans().fetch()
    wired["session"] = FakeSession({COTRIP_ROBOTS: (404, ""), f"{COTRIP}?apiKey={SECRET}": (500, "")})
    with pytest.raises(RuntimeError, match="answered 500") as err:
        _cdot().fetch()
    assert SECRET not in str(err.value)


def test_cdot_sends_the_key_but_never_writes_it(wired):
    wired["session"] = FakeSession({COTRIP_ROBOTS: (404, ""), f"{COTRIP}?apiKey={SECRET}": (200, '{"features": []}')})
    got = _cdot().fetch()
    assert wired["session"].calls == [COTRIP_ROBOTS, f"{COTRIP}?apiKey={SECRET}"]
    assert got.raw == b'{"features": []}' and got.url == COTRIP
    assert SECRET not in repr(wired["ledger"].entries())
    assert [e["url"] for e in wired["ledger"].entries()] == [COTRIP_ROBOTS, COTRIP]


def test_secret_params_never_reach_fetched_urls():
    sess = FakeSession({COTRIP_ROBOTS: (404, ""), f"{COTRIP}?apiKey={SECRET}": (200, "{}")})
    f = pf.PoliteFetcher("source", "broomfield_co", session=sess, ledger=pf.MemoryLedger(), cache_dir=None, sleep=lambda s: None)
    got = f.get(COTRIP, secret_params={"apiKey": SECRET})
    assert isinstance(got, pf.Fetched) and SECRET not in got.url + got.final_url
