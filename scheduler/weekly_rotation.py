"""Rotationsschema för innehållsspåret — vilken typ körs vilken veckodag.

Ren config-dict, ingen kodändring krävs för att flytta om schemat. Stiltyperna är
medvetet generiskt beskrivna (t.ex. "kvick_essa", inte en riktig, namngiven persons
namn/stil) — se PLAN.md, Innehållsspår v1.

AdSense "low value content" remediation, Phase 0 (2026-10-07): hela
innehållsspåret stängt av HÄR, config-nivå -- genereringskoden i content/kronikor,
content/recensioner och content/recept rörs inte (se den egna handoff-specen,
"Global rules" #1: config-driven, kod kvar). ROTATION:s värden är alla None nu;
`content_type_for()` returnerar då None för varje veckodag, och
ai_pipeline/daily_content.py:s main() hoppar redan över en dag utan matchande
MODULES-post rent (se den filens egen docstring och _missing-kontroll, nu
justerad att tillåta None). Sätt tillbaka ett riktigt värde här (och ta bort
motsvarande rad i den filens _missing-filter om alla sju dagar slås på igen)
för att återaktivera -- ingen annan ändring krävs.
"""
from __future__ import annotations

import datetime

ROTATION: dict[str, str | None] = {
    "monday": None,
    "tuesday": None,
    "wednesday": None,
    "thursday": None,
    "friday": None,
    "saturday": None,
    "sunday": None,
}

_WEEKDAY_NAMES = (
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
)


def content_type_for(date: datetime.date) -> str | None:
    """Given a date, return the rotation's content type for that weekday, or
    None when the content track is disabled for that day (see module
    docstring, Phase 0)."""
    return ROTATION[_WEEKDAY_NAMES[date.weekday()]]
