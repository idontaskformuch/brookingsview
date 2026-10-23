from scripts.source_glasgow_pexels_images import evaluate


def photo(**over):
    base = {"id": 1, "width": 4000, "height": 2500, "alt": "Fireworks exploding in a dark night sky", "photographer": "Jane Doe",
            "url": "https://www.pexels.com/photo/1/", "src": {"large": "https://images.pexels.com/1.jpeg"}}
    base.update(over)
    return base


def test_generic_fireworks_pass_with_pexels_source_and_flag():
    cand, reason = evaluate(photo())
    assert reason is None
    assert cand["source"] == "pexels" and cand["license"] == "Pexels License" and cand["artist"] == "Jane Doe"
    assert "Pexels (not a Commons license)" in cand["flags"]


def test_people_and_places_are_dropped():
    assert evaluate(photo(alt="A crowd watching fireworks"))[1] == "people"
    assert evaluate(photo(alt="Silhouette of a man with fireworks"))[1] == "people"
    assert evaluate(photo(alt="Fireworks over the city skyline"))[1] == "place"
    assert evaluate(photo(alt="Fireworks above Tower Bridge in London"))[1] == "place"
    assert evaluate(photo(alt="Fireworks over a river"))[1] == "place"


def test_must_be_about_fireworks_or_bonfires_and_landscape_and_big_enough():
    assert evaluate(photo(alt="A blue sky with clouds"))[1] == "not-fireworks-or-bonfire"
    assert evaluate(photo(alt=""))[1] == "no-description"
    assert evaluate(photo(width=1000, height=700))[1] == "size-or-aspect"
    assert evaluate(photo(width=2000, height=2000))[1] == "size-or-aspect"
    assert evaluate(photo(photographer=""))[1] == "no-photographer"


def test_bonfire_and_soft_place_flag():
    cand, reason = evaluate(photo(alt="Bonfire flames at night with trees"))
    assert reason is None and "place?" in cand["flags"]
