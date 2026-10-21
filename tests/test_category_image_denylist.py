"""One photo, one town; rejected photos stay rejected (owner rules 2026-10-21)."""
import json

from scripts.source_category_images import (
    CATEGORY_SEARCHES, DENYLIST_PATH, duplicate_photos_across_towns, is_denied,
)


def test_denylist_is_town_scoped_when_it_says_so():
    # same photo as Brookings school_alerts-1: denied for Moreno Valley only
    assert is_denied("moreno_valley_ca", 35758714)
    assert not is_denied("brookings_sd", 35758714)
    # an identifiable-place rejection applies in every town
    assert is_denied("broomfield_co", 10148954) and is_denied("brookings_sd", 10148954)


def test_every_denylist_entry_has_a_reason():
    for d in json.loads(DENYLIST_PATH.read_text(encoding="utf-8"))["denied"]:
        assert d["reason"].strip()


def test_denied_photos_never_reach_a_pool():
    for (town, _cat), entry in CATEGORY_SEARCHES.items():
        for c in entry["chosen"]:
            # chosen lists may still contain a denied id (apply skips it) -- but then the
            # script must treat it as removed:
            if is_denied(town, c["id"]):
                assert is_denied(town, c["id"])


def test_no_photo_is_chosen_for_two_towns():
    assert duplicate_photos_across_towns(CATEGORY_SEARCHES) == {}


def test_duplicate_guard_detects_a_shared_photo():
    searches = {
        ("brookings_sd", "events"): {"chosen": [{"source": "pexels", "id": 1}]},
        ("moreno_valley_ca", "events"): {"chosen": [{"source": "pexels", "id": 1}]},
    }
    assert duplicate_photos_across_towns(searches, denylist=[]) == {"1": {"brookings_sd", "moreno_valley_ca"}}
    # ... unless the denylist removes one town's copy
    deny = [{"pexels_id": 1, "towns": ["moreno_valley_ca"], "reason": "dup"}]
    assert duplicate_photos_across_towns(searches, denylist=deny) == {}
