"""CATEGORY_BY_SOURCE_TYPE is a hand-kept port of site/src/lib/images.ts's
own dict of the same name (see assign_category_image_rotation.py's module
docstring for why the duplication is deliberate). This test doesn't
verify cross-language parity automatically (nothing here can parse the
.ts file) -- it guards against the two more common ways this specific
dict silently drifts: a category string that doesn't exist in the real
ImageCategory vocabulary (a typo an Astro build would catch as a missing
pool, but this Python script never would, since it doesn't validate
against category-images.ts at all), and a source_type value that isn't a
real SourceType (a copy-paste mistake that would just silently never
match any real story, `.get()` returning None -> skipped, no error).
"""
from __future__ import annotations

from ai_pipeline.assign_category_image_rotation import CATEGORY_BY_SOURCE_TYPE

# Mirrors site/src/lib/images.ts's ImageCategory union exactly.
KNOWN_IMAGE_CATEGORIES = {
    "city_hall", "events", "traffic", "home_sales", "jobs", "sports",
    "school_alerts", "weather_alert", "workplace_watch", "university",
}

# Mirrors db/schema.sql's SourceType/stories.source_type vocabulary for the
# subset this dict cares about.
KNOWN_SOURCE_TYPES = {
    "meeting", "meeting_followup", "event", "weekly", "alert",
    "home_sales_digest", "sports_digest", "local_sports_digest",
    "jackrabbits_season_summary", "university_digest", "workplace_watch_digest",
    "editorial", "culture_essay", "kvick_essa", "vetenskap_kronika",
    "media_recension", "vardagsmiddag", "job_posting", "traffic_incident",
    "school_alert", "closure_watch",
}


def test_every_mapped_category_is_a_real_image_category():
    unknown = set(CATEGORY_BY_SOURCE_TYPE.values()) - KNOWN_IMAGE_CATEGORIES
    assert not unknown, f"CATEGORY_BY_SOURCE_TYPE maps to unknown categories: {unknown}"


def test_every_mapped_source_type_is_a_real_source_type():
    unknown = set(CATEGORY_BY_SOURCE_TYPE.keys()) - KNOWN_SOURCE_TYPES
    assert not unknown, f"CATEGORY_BY_SOURCE_TYPE has unrecognized source_type keys: {unknown}"


def test_content_track_types_have_no_category_mapping():
    """Content-track types always carry their own image_path (an AI
    illustration) -- they should never appear here, since a mapping would
    only matter if resolveImage() ever reached tier 4 for one, which by
    design it never does (see images.ts's own comment on this)."""
    content_track_types = {
        "editorial", "culture_essay", "kvick_essa", "vetenskap_kronika",
        "media_recension", "vardagsmiddag",
    }
    assert not (content_track_types & CATEGORY_BY_SOURCE_TYPE.keys())
