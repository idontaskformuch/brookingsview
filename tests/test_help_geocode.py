"""/help/ lat/lon at write time (owner 2026-11-28): postcodes.io for a UK postcode, Nominatim for a US street address, nothing guessed.
Responses are the real ones fetched 2026-11-28 through PoliteFetcher (tests/fixtures/help_geocode_2026-11-28/): postcodes.io for
glasgow place 295 glasgow-sw-foodbank-ibrox (G51 1QH) and Nominatim for moreno_valley_ca place 314 salvation-army-moreno-valley
(13300 Indian St., 92553). An edge case changes ONE thing in such a response or row and says which (CLAUDE.md rule 15)."""
from __future__ import annotations

import copy
import json
from pathlib import Path

from scrapers import help_geocode as g
from scrapers.polite_fetch import Fetched, Refused

FIX = Path(__file__).resolve().parent / "fixtures" / "help_geocode_2026-11-28"
PC_IBROX = json.loads((FIX / "postcodes_io_G51_1QH.json").read_text(encoding="utf-8"))
NOM_SALVATION = json.loads((FIX / "nominatim_13300_indian_st.json").read_text(encoding="utf-8"))

IBROX = {"id": 295, "town_id": "glasgow", "slug": "glasgow-sw-foodbank-ibrox", "street_address": "67 Clifford Street",
         "postal_code": "G51 1QH", "lat": None, "lon": None}
SALVATION = {"id": 314, "town_id": "moreno_valley_ca", "slug": "salvation-army-moreno-valley", "street_address": "13300 Indian St.",
             "postal_code": "92553", "lat": None, "lon": None}


class FakeFetcher:
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def get(self, url, params=None):
        self.calls.append((url, params))
        status, body = self.answers.get(url, (404, {"status": 404, "error": "Postcode not found"}))
        if status is None:
            return Refused(url, body)
        return Fetched(url, url, status, json.dumps(body).encode())


PC_URL = "https://api.postcodes.io/postcodes/G51%201QH"


def test_uk_postcode_from_postcodes_io():
    f = FakeFetcher({PC_URL: (200, PC_IBROX)})
    assert g.locate(IBROX, f) == (55.849929, -4.300626, "postcodes.io")
    assert f.calls == [(PC_URL, None)]


def test_uk_postcode_not_found_is_nothing():
    assert g.locate(IBROX, FakeFetcher({})) is None   # 404 (the default answer)


def test_us_address_from_nominatim_with_the_same_house_number_and_zip():
    f = FakeFetcher({g.NOMINATIM_URL: (200, NOM_SALVATION)})
    assert g.locate(SALVATION, f) == (33.928315, -117.234949, "nominatim")
    (url, params), = f.calls
    assert params["q"] == "13300 Indian St., Moreno Valley, CA 92553" and params["countrycodes"] == "us" and params["limit"] == 1


def test_us_hit_without_the_house_number_is_nothing():
    street_only = copy.deepcopy(NOM_SALVATION)
    del street_only[0]["address"]["house_number"]   # changed: a street centroid, not the building
    assert g.locate(SALVATION, FakeFetcher({g.NOMINATIM_URL: (200, street_only)})) is None


def test_us_hit_in_another_zip_is_nothing():
    other = copy.deepcopy(NOM_SALVATION)
    other[0]["address"]["postcode"] = "92555"   # changed: the ZIP
    assert g.locate(SALVATION, FakeFetcher({g.NOMINATIM_URL: (200, other)})) is None


def test_us_row_without_a_house_number_is_never_looked_up():
    f = FakeFetcher({g.NOMINATIM_URL: (200, NOM_SALVATION)})
    assert g.locate({**SALVATION, "street_address": "Indian St."}, f) is None and f.calls == []   # changed: street_address


def test_refused_or_empty_answer_is_nothing():
    assert g.locate(SALVATION, FakeFetcher({g.NOMINATIM_URL: (200, [])})) is None
    assert g.locate(IBROX, FakeFetcher({PC_URL: (None, "robots.txt disallows")})) is None


def test_plan_skips_rows_that_have_coordinates_and_never_overwrites():
    f = FakeFetcher({PC_URL: (200, PC_IBROX), g.NOMINATIM_URL: (200, NOM_SALVATION)})
    done = {**IBROX, "id": 300, "lat": 55.85, "lon": -4.2}   # changed: lat/lon already set
    plan = g.plan([IBROX, SALVATION, done], lambda town: f)
    assert [(p.place_id, p.lat, p.lon, p.how) for p in plan.found] == [(295, 55.849929, -4.300626, "postcodes.io"),
                                                                        (314, 33.928315, -117.234949, "nominatim")]
    assert plan.missed == [] and len(f.calls) == 2


def test_apply_writes_only_null_coordinates():
    class Cur:
        def __init__(self):
            self.sql = []

        def execute(self, sql, params=None):
            self.sql.append((" ".join(sql.split()), params))
    cur = Cur()
    g.apply(cur, [g.Found(295, "glasgow-sw-foodbank-ibrox", 55.849929, -4.300626, "postcodes.io")])
    assert cur.sql == [("UPDATE places SET lat = %s, lon = %s WHERE id = %s AND lat IS NULL AND lon IS NULL",
                        (55.849929, -4.300626, 295))]


def test_the_weekly_job_fills_coordinates_after_its_writes_and_only_in_write_mode(monkeypatch):
    from scrapers import help_sources
    from scripts import watch_sources as w
    calls = []
    monkeypatch.setattr(help_sources, "SOURCES", [])
    monkeypatch.setattr(w, "load_town_places", lambda cur, town: [])
    monkeypatch.setattr(g, "fill", lambda cur, fetcher_for, town=None: calls.append(town) or g.Plan())
    watch = {"town": "glasgow"}
    w.run_help(watch, lambda t: None, object(), None, write=False)
    assert calls == []
    w.run_help(watch, lambda t: None, object(), None, write=True)
    assert calls == ["glasgow"]
