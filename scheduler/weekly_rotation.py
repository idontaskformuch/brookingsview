"""Rotationsschema för innehållsspåret — vilken typ körs vilken veckodag.

Ren config-dict, ingen kodändring krävs för att flytta om schemat. Stiltyperna är
medvetet generiskt beskrivna (t.ex. "kvick_essa", inte en riktig, namngiven persons
namn/stil) — se PLAN.md, Innehållsspår v1.
"""
from __future__ import annotations

import datetime

ROTATION: dict[str, str] = {
    "monday": "kultur_essa",
    "tuesday": "ledare",
    "wednesday": "media_recension",
    "thursday": "vardagsmiddag",
    "friday": "vetenskap_kronika",
    "saturday": "kvick_essa",
    "sunday": "kultur_essa",
}

_WEEKDAY_NAMES = (
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
)


def content_type_for(date: datetime.date) -> str:
    """Given a date, return the rotation's content type for that weekday."""
    return ROTATION[_WEEKDAY_NAMES[date.weekday()]]
