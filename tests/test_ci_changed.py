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


# ---------------------------------------------------------------- the first run after local midnight always builds (owner 2026-11-27)
# 2026-11-22 both Brookings scrape runs printed changed=false, so a page with a date in it ("Next closed", facility-meta) kept yesterday's
# date. `after` reads the live <meta name="data-built-at">: built on another local day than today (the town's own timezone) = rebuild.
# Real value: data-built-at of the local battery build of Glasgow, 2026-11-27 (site/dist/index.html).
BUILT = '<meta name="data-built-at" content="2026-11-27T04:38:45.783Z" />'
NOW = cc.datetime(2026, 11, 27, 11, 0, tzinfo=cc.timezone.utc)  # the 11:00 UTC scrape run


def test_built_earlier_the_same_local_day_needs_no_rebuild_for_the_date():
    assert cc.built_today(BUILT, "Europe/London", NOW) is True  # 04:38 and 11:00 in Glasgow, both 27 Nov


def test_the_same_build_is_yesterday_in_brookings_so_the_first_run_after_local_midnight_builds():
    # only the timezone differs: 04:38 UTC is 22:38 on 26 Nov in America/Chicago, 11:00 UTC is 05:00 on 27 Nov
    assert cc.built_today(BUILT, "America/Chicago", NOW) is False


def test_no_page_or_no_tag_or_a_broken_tag_builds_anyway():
    assert cc.built_today(None, "America/Chicago", NOW) is False
    assert cc.built_today("<html><head></head></html>", "America/Chicago", NOW) is False
    assert cc.built_today('<meta name="data-built-at" content="not-a-time" />', "America/Chicago", NOW) is False


def test_decide_rebuilds_on_a_new_local_day_even_when_the_rows_are_the_same():
    assert cc.decide("abc", "abc", built_today=False) is True
    assert cc.decide("abc", "abc", built_today=True) is False
    assert cc.decide("abc", "abd", built_today=True) is True


def test_the_live_page_is_read_like_the_deploy_check_and_a_failed_fetch_is_none(monkeypatch):
    seen = {}

    class Resp:
        status_code = 200
        text = BUILT

    def get(url, timeout, headers):
        seen.update(url=url, headers=headers)
        return Resp()

    monkeypatch.setattr(cc.requests, "get", get)
    monkeypatch.setenv("DEPLOY_CHECK_SECRET", "s")
    assert cc.live_homepage("broomfield_co") == BUILT
    assert seen["url"] == "https://broomfieldview.com/"
    assert seen["headers"]["User-Agent"] == "ViewMediaBot (+https://broomfieldview.com/contact)" and seen["headers"]["X-BV-Deploy-Check"] == "s"

    Resp.status_code = 403
    assert cc.live_homepage("broomfield_co") is None

    def boom(url, timeout, headers):
        raise cc.requests.ConnectionError("down")

    monkeypatch.setattr(cc.requests, "get", boom)
    assert cc.live_homepage("glasgow") is None


def test_every_after_step_gets_the_deploy_check_secret():
    # without it the Broomfield and Glasgow zones answer GitHub's runners 403, and the fail-open rule would build on every run
    import re
    steps = []
    for wf in sorted((cc.ROOT / ".github" / "workflows").glob("*.yml")):
        steps += [(wf.name, s) for s in re.split(r"\n\s*- ", wf.read_text(encoding="utf-8")) if "scripts.ci_changed after" in s]
    assert len(steps) == 10
    for name, step in steps:
        assert "DEPLOY_CHECK_SECRET: ${{ secrets.DEPLOY_CHECK_SECRET }}" in step, name


def test_town_timezone_comes_from_the_town_config():
    assert cc.town_timezone("brookings_sd") == "America/Chicago" and cc.town_timezone("glasgow") == "Europe/London"


def test_restriction_checks_counts_so_safety_is_rebuilt():
    # 2026-11-20: broomfield-scrape run 44745867921 wrote restriction_checks rows 1-2 and printed changed=false.
    assert "restriction_checks" in cc.DATA_TABLES and "restriction_checks" not in cc.CONTENT_TABLES
