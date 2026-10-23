from scripts.source_glasgow_commons_images import evaluate, is_glasgow, license_ok, needs_attribution, strip_html


def page(**over):
    meta = {
        "LicenseShortName": {"value": "CC BY-SA 4.0"},
        "License": {"value": "cc-by-sa-4.0"},
        "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0"},
        "Artist": {"value": '<a href="//commons.wikimedia.org/wiki/User:X">Jane Photographer</a>'},
        "ImageDescription": {"value": "Kelvingrove Park in autumn, Glasgow"},
        "Categories": {"value": "Kelvingrove Park|Autumn in Scotland"},
    }
    meta.update(over.pop("meta", {}))
    info = {"mime": "image/jpeg", "width": 3000, "height": 2000, "thumburl": "https://upload.wikimedia.org/t.jpg",
            "thumbwidth": 480, "thumbheight": 320, "descriptionurl": "https://commons.wikimedia.org/wiki/File:Park.jpg",
            "extmetadata": meta}
    info.update(over.pop("info", {}))
    return {"pageid": 1, "title": over.pop("title", "File:Kelvingrove Park autumn.jpg"), "imageinfo": [info]}


def test_license_policy_allows_only_cc0_pd_by_and_by_sa():
    for ok in ("CC0", "CC0 1.0", "Public domain", "PD-old-70", "CC BY 4.0", "CC BY 2.0", "CC BY-SA 4.0", "CC BY-SA 3.0"):
        assert license_ok(ok, None), ok
    for bad in ("CC BY-NC 4.0", "CC BY-ND 2.0", "CC BY-NC-SA 3.0", "CC BY-NC-ND 4.0", "GFDL", "OGL v3.0", "Fair use", "", None):
        assert not license_ok(bad, None), bad


def test_attribution_needed_unless_cc0_or_pd():
    assert needs_attribution("CC BY 4.0") and needs_attribution("CC BY-SA 3.0")
    assert not needs_attribution("CC0") and not needs_attribution("Public domain")


def test_good_candidate_keeps_attribution_fields():
    cand, reason = evaluate(page())
    assert reason is None
    assert cand["artist"] == "Jane Photographer" and cand["license"] == "CC BY-SA 4.0"
    assert cand["page_url"].startswith("https://commons.wikimedia.org/wiki/File:")
    assert cand["flags"] == []


def test_rejections():
    assert evaluate(page(meta={"LicenseShortName": {"value": "CC BY-NC 4.0"}, "License": {"value": "cc-by-nc-4.0"}}))[1] == "license"
    assert evaluate(page(meta={"Artist": {"value": ""}}))[1] == "no-author"
    assert evaluate(page(meta={"Artist": {"value": "Unknown author"}}))[1] == "no-author"
    assert evaluate(page(info={"width": 1000, "height": 700}))[1] == "size-or-aspect"
    assert evaluate(page(info={"width": 2000, "height": 2000}))[1] == "size-or-aspect"
    assert evaluate(page(info={"mime": "image/svg+xml"}))[1] == "mime"
    assert evaluate(page(meta={"ImageDescription": {"value": "Park in Glasgow, Kentucky"}}))[1] == "not-glasgow"
    assert evaluate(page(meta={"ImageDescription": {"value": "A park"}, "Categories": {"value": "Parks"}}, title="File:Park.jpg"))[1] == "not-glasgow"


def test_cc0_without_author_is_fine():
    cand, reason = evaluate(page(meta={"LicenseShortName": {"value": "CC0"}, "License": {"value": "cc0"}, "Artist": {"value": ""}}))
    assert reason is None and cand["artist"] is None


def test_2d_artworks_and_people_are_dropped_or_flagged():
    assert evaluate(page(title="File:Glasgow mural Clutha.jpg"))[1] == "2d-artwork"
    assert evaluate(page(meta={"ImageDescription": {"value": "Street art in Glasgow city centre"}}))[1] == "2d-artwork"
    assert evaluate(page(title="File:Portrait of a woman, Glasgow.jpg"))[1] == "people-main-subject"
    assert evaluate(page(meta={"Categories": {"value": "Crowds in Glasgow"}}))[1] == "people-main-subject"
    cand, reason = evaluate(page(meta={"ImageDescription": {"value": "People walking in Kelvingrove Park, Glasgow"}}))
    assert reason is None and "people?" in cand["flags"]


def test_helpers():
    assert is_glasgow("View of the Clyde at dusk") and is_glasgow("Glasgow Necropolis")
    assert not is_glasgow("Glasgow, Montana")
    assert strip_html('<a href="x">Jane &amp; John</a>  ') == "Jane & John"
