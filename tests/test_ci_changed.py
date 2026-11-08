"""scripts/ci_changed.py -- the pure parts: the rebuild decision and which tables count."""
from scripts import ci_changed as cc


def test_same_fingerprint_means_no_build():
    assert cc.decide("abc", "abc") is False


def test_different_or_missing_fingerprint_means_build():
    assert cc.decide("abc", "abd") is True
    assert cc.decide(None, "abc") is True
    assert cc.decide("abc", None) is True
    assert cc.decide("", "abc") is True


def test_traffic_and_weather_never_count():
    for preset in cc.PRESETS.values():
        for noise in ("traffic_incidents", "weather_snapshots", "scrape_runs", "source_snapshots", "ai_crawler_hits", "api_usage"):
            assert noise not in preset


def test_data_preset_contains_the_content_preset_and_the_scraped_tables():
    assert set(cc.CONTENT_TABLES) <= set(cc.DATA_TABLES)
    assert {"events", "meetings", "stories"} <= set(cc.DATA_TABLES)


def test_row_hash_ignores_volatile_columns_and_filters_on_town():
    sql = cc.table_sql("events")
    for col in ("snapshot_id", "created_at", "updated_at", "id"):
        assert f"- '{col}'" in sql
    assert "WHERE town_id = %s" in sql


def test_live_warnings_never_count_as_a_site_change():
    sql = cc.table_sql("events")
    assert "source NOT IN ('nws_alert', 'met_office_warning')" in sql
    assert "source NOT IN" not in cc.table_sql("meetings")


def test_sport_events_counts_but_its_last_seen_touch_does_not():
    assert "sport_events" in cc.DATA_TABLES and "sport_events" not in cc.CONTENT_TABLES
    assert "last_seen" in cc.VOLATILE and "first_seen" not in cc.VOLATILE
    assert "- 'last_seen'" in cc.table_sql("sport_events")
