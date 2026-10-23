import io

import pytest
from PIL import Image

from scripts.activate_glasgow_images import (
    alt_text, credit, crop_to_pool, destination, ids_from, insert_before_array_end, next_number, season_line, holiday_line,
)

CAND = {"id": "AUT-001", "pageid": 123, "source": "commons", "buckets": ["season:autumn", "category:events"], "title": "Park autumn.jpg",
        "page_url": "https://commons.wikimedia.org/wiki/File:Park_autumn.jpg", "artist": "Jane O'Neil", "license": "CC BY-SA 4.0",
        "description": "Kelvingrove Park in autumn, Glasgow"}


def test_ids_from_accepts_commas_and_spaces_any_case():
    assert ids_from("aut-001, AUT-003 win-010") == ["AUT-001", "AUT-003", "WIN-010"]


def test_destination_picks_season_then_holiday_and_rejects_category_only():
    assert destination(CAND) == ("season", "autumn")
    assert destination({"id": "X", "buckets": ["category:events", "holiday:halloween"]}) == ("holiday", "halloween")
    with pytest.raises(ValueError):
        destination({"id": "Y", "buckets": ["category:sports"]})


def test_credit_names_photographer_license_source_and_links_to_the_page():
    text, url = credit(CAND)
    assert text == "Photo by Jane O'Neil, CC BY-SA 4.0, via Wikimedia Commons"
    assert url == CAND["page_url"]
    assert credit({**CAND, "source": "pexels"})[0].endswith("via Pexels")


def test_alt_text_mentions_glasgow():
    assert alt_text(CAND) == "Kelvingrove Park in autumn, Glasgow"
    assert alt_text({"description": "A park in autumn"}) == "A park in autumn, Glasgow"
    assert alt_text({"description": ""}) == "Glasgow"


def test_config_lines_escape_quotes_and_namespace_source_ids():
    line = season_line("glasgow-autumn-01", "/assets/images/this-week/glasgow-autumn-01.jpg", CAND, "autumn")
    assert "Jane O\\'Neil" in line and "sourcePhotoId: 1000000123" in line and "seasons: ['autumn']" in line
    pex = holiday_line("glasgow-bonfire_night-01", "/x.jpg", {**CAND, "source": "pexels", "pageid": 77}, "bonfire_night")
    assert "sourcePhotoId: 77 " in pex and "holiday: 'bonfire_night'" in pex


def test_next_number_and_insert_before_array_end():
    ts = "export const POOL: X[] = [\n  { id: 'glasgow-autumn-02', a: 1 },\n  { id: 'brookings_sd-autumn-09', a: 1 },\n];\n"
    assert next_number(ts, "glasgow-autumn") == 3
    assert next_number(ts, "glasgow-winter") == 1
    out = insert_before_array_end(ts, "POOL", ["  { id: 'glasgow-autumn-03' },"])
    assert out.index("glasgow-autumn-03") < out.index("];")


def test_crop_to_pool_gives_1200x800_jpeg_from_wide_and_tall_sources():
    for size in ((3000, 1000), (1000, 3000), (1800, 1200)):
        buf = io.BytesIO()
        Image.new("RGB", size, (10, 120, 200)).save(buf, "PNG")
        out = Image.open(io.BytesIO(crop_to_pool(buf.getvalue())))
        assert out.size == (1200, 800) and out.format == "JPEG"
