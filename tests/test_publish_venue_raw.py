"""Events correctness Phase 5 follow-up (2026-10-09): confirmed live --
NWS alert rows (events-table, source_type='alert') were getting a
venue_raw copied straight from their own "venue" field, which is really
areaDesc (a county list) or, for some alert products, a bare product-
category phrase ("Hazardous Weather Alerts") -- never a resolvable
physical venue. See ai_pipeline/publish.py's _venue_eligible().
"""
from ai_pipeline.publish import _venue_eligible


def test_real_event_is_venue_eligible():
    assert _venue_eligible("events", "event") is True


def test_alert_row_is_never_venue_eligible():
    assert _venue_eligible("events", "alert") is False


def test_meeting_row_is_never_venue_eligible():
    assert _venue_eligible("meetings", "meeting") is False
