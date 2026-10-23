from scripts.seed_brookings_places_enrichment import CURATED, park_amenities, park_update


def test_park_amenities_are_read_from_the_city_record():
    d = "A 2.36-acre park in Brookings (general). Amenities: playground, baseball, softball, modern restrooms, on-site parking, pets on leash."
    assert park_amenities(d) == ["playground", "baseball", "softball", "modern restrooms", "on-site parking", "pets on leash"]
    upd = park_update(d)
    assert upd["services"] == ["Playground", "Baseball", "Softball", "Modern restrooms", "Pets on leash"]
    assert upd["parking_note"].startswith("On-site parking")


def test_park_without_amenities_is_left_alone():
    assert park_update("A 5-acre park in Brookings.") is None
    assert park_update(None) is None
    assert park_update("Amenities: on-site parking.")["services"] is None


def test_every_curated_entry_names_an_official_source_and_no_guessed_fields():
    allowed = {"slug", "sources", "hours_text", "is_free", "fee_note", "services", "accessibility_note", "parking_note", "visit_notes"}
    for item in CURATED:
        assert item["sources"] and all(s.startswith("https://") for s in item["sources"]), item["slug"]
        assert set(item) <= allowed, item["slug"]
        if item.get("is_free") is False:
            assert item.get("fee_note"), item["slug"]
