"""scrapers/facility_hours.py on verbatim excerpts of the real pages (tests/fixtures/facility_hours/, read 2026-11-25)."""
from datetime import date
from pathlib import Path

from scrapers.facility_hours import (catalog_detail_links, name_key, parse_catalog_detail, parse_libcal_weeks)

FIX = Path(__file__).parent / "fixtures" / "facility_hours"


def _read(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def test_catalog_list_page_one_gives_its_five_detail_pages_once_each():
    links = catalog_detail_links(_read("brookings-catalog-page1.html"))
    assert links == [
        "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/22nd-Avenue-Fire-Station-2",
        "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/Airport-AdministrationARFFSRE-Building-10",
        "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/Airport-Terminal-Building-11",
        "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/Animal-ControlCommunity-Service-19",
        "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/Arrowhead-Park-27",
    ]


def test_catalog_detail_pioneer_park_hours_verbatim():
    url = "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/Pioneer-Park-33"
    entry = parse_catalog_detail(_read("brookings-pioneer-park-33.html"), url)
    assert entry.name == "Pioneer Park"
    assert entry.hours_text == "Sunrise to 11:00p.m."


def test_name_key_ignores_case_and_punctuation_only():
    assert name_key("Animal Control/Community Service") == name_key("animal control community service")
    assert name_key("Douglas Chittick Com. Gardens") != name_key("Douglas Chittick Community Gardens")


def test_libcal_dated_days_briggs_thanksgiving_week():
    days = parse_libcal_weeks(_read("libcal-sdstate-hours.html"), date(2026, 11, 25))
    # The week of 2026-11-22 as the page states it: Sun 12pm-12am, Mon 7:45am-12am, Tue 7:45am-9pm, Wed 8am-5pm, Thu-Sat Closed.
    assert days["2026-11-22"] == ("12:00", "00:00")
    assert days["2026-11-23"] == ("07:45", "00:00")
    assert days["2026-11-24"] == ("07:45", "21:00")
    assert days["2026-11-25"] == ("08:00", "17:00")
    assert days["2026-11-26"] is None and days["2026-11-28"] is None
    # The week after: Sun 12pm-12am ... Fri 7:45am-9pm, Sat 10am-9pm
    assert days["2026-12-04"] == ("07:45", "21:00") and days["2026-12-05"] == ("10:00", "21:00")
    # From Dec 17 the page shows "–" (no hours set yet): unknown, left out, never "closed".
    assert len(days) == 25 and "2026-12-17" not in days


def test_libcal_year_rolls_over_at_new_year():
    page = _read("libcal-sdstate-hours.html").replace("Nov 22", "Dec 31").replace("Nov 23", "Jan 01")
    days = parse_libcal_weeks(page, date(2026, 12, 20))
    assert "2026-12-31" in days and "2027-01-01" in days


def test_broomfield_court_business_hours_label():
    from scrapers.facility_hours import hours_block_text
    text = hours_block_text(_read("broomfield-court-services-hours.html"))
    assert text.startswith("Monday–Friday, 7:30 a.m.–4:30 p.m. (closed for lunch 11:30 a.m.–12:30 p.m.)")


def test_holiday_banner_alone_is_not_hours():
    from scrapers.facility_hours import hours_block_text
    # The banner on every broomfield.org page (2026-11-25): "Hours" is not followed by a day.
    assert hours_block_text("<h2>Holiday Adjusted Hours</h2><p>In observance of Thanksgiving, this facility may be closed</p>") is None


def test_catalog_search_form_is_the_pages_own_default_search():
    # brookings-catalog-sidebar.html: the list page's sidebar lines verbatim (2026-11-25): 11 types checked, 13 pages of 5
    from scrapers.facility_hours import catalog_last_page, catalog_search_form
    html = _read("brookings-catalog-sidebar.html")
    form = catalog_search_form(html, 2)
    assert form["categoryIDs"] == "8,9,10,2,11,4,5,12,3,7,6"
    assert (form["pageNumber"], form["pageSize"], form["sortBy"], form["isReservableOnly"]) == ("2", "100", "3", "false")
    assert catalog_last_page(html) == 13


def test_all_pages_posts_until_the_last_page_and_stops_at_a_refusal():
    from scrapers.facility_hours import CATALOG_SEARCH, catalog_all_links
    from scrapers.polite_fetch import Fetched, Refused
    sidebar = _read("brookings-catalog-sidebar.html")
    page1 = _read("brookings-catalog-page1.html")

    class F:
        def __init__(self, answers):
            self.answers, self.forms = list(answers), []

        def post(self, url, form):
            assert url == CATALOG_SEARCH
            self.forms.append(form["pageNumber"])
            return self.answers.pop(0)

    two_pages = page1 + '<input type="hidden" id="hiddenLastPageNumber" value="2"/>'
    f = F([Fetched(CATALOG_SEARCH, CATALOG_SEARCH, 200, two_pages.encode()), Fetched(CATALOG_SEARCH, CATALOG_SEARCH, 200, two_pages.encode())])
    assert len(catalog_all_links(f, sidebar)) == 5 and f.forms == ["1", "2"]
    refused = F([Refused(CATALOG_SEARCH, "robots")])
    assert isinstance(catalog_all_links(refused, sidebar), Refused)


def test_catalog_run_closes_the_read_transaction_before_fetching_and_writes_after(monkeypatch):
    # 2026-11-25: --all-pages fetched for ~10 min inside the open read transaction; the database ended it at the final
    # COMMIT (IdleInTransactionSessionTimeout), which would have rolled back every write of an --apply run.
    import scrapers.facility_hours as fh
    from scrapers.polite_fetch import Fetched
    log: list[str] = []
    # arrowhead-park as the catalog's detail page gives it (dry run 2026-11-25); the page itself is not parsed here.
    arrowhead = "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/Arrowhead-Park-27"

    class Cur:
        def execute(self, sql, params=None):
            log.append("write" if sql.lstrip().upper().startswith(("UPDATE", "DELETE", "INSERT")) else "select")

        def fetchall(self):
            return [(27, "arrowhead-park", "Arrowhead Park", None, None, None, arrowhead, 0, [])]

    class Conn:
        def cursor(self):
            return Cur()

        def commit(self):
            log.append("commit")

    class F:
        def get(self, url):
            log.append("fetch")
            return Fetched(url, url, 200, b"")

    monkeypatch.setattr(fh, "parse_catalog_detail",
                        lambda html, url: fh.CatalogEntry(url=url, name="Arrowhead Park", hours_text="Sunrise to 11:00 p.m."))
    assert fh.run_brookings_catalog(F(), Conn(), True, date(2026, 11, 25)) == 0
    assert log[:2] == ["select", "commit"]
    first_write = log.index("write")
    assert "fetch" in log[:first_write] and "fetch" not in log[first_write:]


def test_main_accepts_prod_flag_for_the_write_guard(monkeypatch):
    # 2026-11-25: `python -m scrapers.facility_hours briggs --apply --prod` stopped in argparse ("unrecognized arguments:
    # --prod"): main() gets a copy of argv, so db.db removing --prod from sys.argv never reached it.
    import contextlib
    import db.db
    import scrapers.facility_hours as fh
    seen = {}
    monkeypatch.setattr(db.db, "get_conn", lambda: contextlib.nullcontext("conn"))
    monkeypatch.setattr(fh, "PoliteFetcher", lambda *a: "fetcher")
    monkeypatch.setattr(fh, "run_briggs", lambda f, c, apply, today: seen.update(apply=apply) or 0)
    assert fh.main(["briggs", "--apply", "--prod"]) == 0
    assert seen == {"apply": True}


def test_catalog_finds_a_row_by_its_name_alias(monkeypatch):
    # 2026-11-25 dry run: "[no place row] 'Brookings Prairie': 'Sunrise to 11:00p.m.'" although brookings_sd place 87
    # (prairie-park, "Prairie Park") is the same park; the owner set the catalog's name as its alias.
    import scrapers.facility_hours as fh
    from scrapers.polite_fetch import Fetched
    url = "https://www.cityofbrookings-sd.gov/Facilities/Facility/Details/Brookings-Prairie-38"
    writes: list[tuple] = []

    class Cur:
        def execute(self, sql, params=None):
            if sql.lstrip().upper().startswith("UPDATE"):
                writes.append(params)

        def fetchall(self):
            return [(87, "prairie-park", "Prairie Park", None, None, None, None, 0, ["Brookings Prairie"])]

    class Conn:
        def cursor(self):
            return Cur()

        def commit(self):
            pass

    class F:
        def get(self, u):
            return Fetched(u, u, 200, b"")

    monkeypatch.setattr(fh, "catalog_detail_links", lambda html, base=fh.BROOKINGS_CATALOG: [url])
    monkeypatch.setattr(fh, "parse_catalog_detail",
                        lambda html, u: fh.CatalogEntry(url=u, name="Brookings Prairie", hours_text="Sunrise to 11:00p.m."))
    assert fh.run_brookings_catalog(F(), Conn(), True, date(2026, 11, 25)) == 0
    assert len(writes) == 1 and writes[0][0] == "Sunrise to 11:00p.m." and writes[0][-1] == 87


# --- re-verification (owner order 2026-11-25 kväll, punkt 3) ---------------------------------------------------------------
# glasgow/the-mitchell-library: place_hours as on file 2026-11-25 (Sun closed, Mon/Wed/Fri/Sat 09:00-17:00, Tue/Thu 09:00-20:00).
MITCHELL_URL = "https://www.glasgowlife.org.uk/libraries/venues/the-mitchell-library"
MITCHELL_ROWS = [(0, None, None, None), (1, "09:00:00", "17:00:00", None), (2, "09:00:00", "20:00:00", None),
                 (3, "09:00:00", "17:00:00", None), (4, "09:00:00", "20:00:00", None), (5, "09:00:00", "17:00:00", None),
                 (6, "09:00:00", "17:00:00", None)]


def test_glasgow_life_table_reads_as_one_week():
    from scrapers.facility_hours import parse_glasgow_life_week
    week = parse_glasgow_life_week(_read("glasgow-life-mitchell-hours.html"))
    assert week == {0: None, 1: ("09:00", "17:00"), 2: ("09:00", "20:00"), 3: ("09:00", "17:00"), 4: ("09:00", "20:00"),
                    5: ("09:00", "17:00"), 6: ("09:00", "17:00")}


def test_glasgow_life_table_with_an_unreadable_cell_is_none():
    from scrapers.facility_hours import parse_glasgow_life_week
    # The Mitchell's table with the one changed field marked: Tuesday's cell "By appointment".
    page = _read("glasgow-life-mitchell-hours.html").replace("<td>9:00am - 8:00pm</td>", "<td>By appointment</td>", 1)
    assert parse_glasgow_life_week(page) is None


def _reverify(page_html, rows=MITCHELL_ROWS, refused=False):
    import scrapers.facility_hours as fh
    from scrapers.polite_fetch import Fetched, Refused
    log = {"updates": [], "reconciled": None, "sent": [], "sleeps": []}

    class Cur:
        def __init__(self):
            self.last = None

        def execute(self, sql, params=None):
            self.last = sql
            if sql.startswith("UPDATE"):
                log["updates"].append(params)

        def fetchall(self):
            if "FROM places" in self.last:
                return [(11, "glasgow", "the-mitchell-library", fh.GLASGOW_LIFE_METHOD, MITCHELL_URL)]
            return [(11, *r) for r in rows]

    class Conn:
        def cursor(self):
            return Cur()

        def commit(self):
            pass

    class F:
        def get(self, url):
            return Refused(url, "403") if refused else Fetched(url, url, 200, page_html.encode())

    def reconcile(conn, scope, active, title, **k):
        log["reconciled"] = (scope, active)
        return {"new": list(active), "reminder": [], "resolved": []}

    assert fh.run_reverify(Conn(), True, date(2026, 11, 25), make_fetcher=lambda t: F(), sleep=log["sleeps"].append,
                           reconcile_fn=reconcile, send=lambda m, **k: log["sent"].append(m)) == 0
    return log


def test_reverify_same_week_updates_verified_date_and_raises_nothing():
    log = _reverify(_read("glasgow-life-mitchell-hours.html"))
    assert log["updates"] == [(date(2026, 11, 25), [11])]
    assert log["reconciled"] == ("hours-reverify|", {})


def test_reverify_changed_week_writes_nothing_and_alerts_with_both_weeks():
    # The Mitchell's page with the one changed field marked: Thursday 9:00am - 6:00pm instead of 8:00pm.
    page = _read("glasgow-life-mitchell-hours.html").replace("<td>9:00am - 8:00pm</td>", "<td>9:00am - 6:00pm</td>", 2)
    page = page.replace("<td>9:00am - 6:00pm</td>", "<td>9:00am - 8:00pm</td>", 1)
    log = _reverify(page)
    assert log["updates"] == []
    msg = log["reconciled"][1]["hours-reverify|glasgow|the-mitchell-library"]
    assert "ours" in msg and "Thu 09:00-20:00" in msg and "Thu 09:00-18:00" in msg and MITCHELL_URL in msg


def test_reverify_refused_page_writes_nothing_and_alerts():
    log = _reverify("", refused=True)
    assert log["updates"] == []
    assert "page could not be read (403)" in log["reconciled"][1]["hours-reverify|glasgow|the-mitchell-library"]
