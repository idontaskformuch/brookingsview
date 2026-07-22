"""Curated källa för vardagsmiddag: vilken huvudingrediens som föreslås varje torsdag.

Samma enkla ansats som media_recension tidigare hade (nu content/now_playing.py,
ett live TMDb-API): ingen scraper för lokala matbutikers
utbud, bara en säsongslista grundad i vad som faktiskt växer/skördas i South
Dakotas klimatzon (ungefär zon 4b/5a, Upper Midwest-odlingssäsong) månad för
månad. Deterministisk pick per dag-i-året, ingen tillståndsspårning behövs.

UNDERHÅLL: listan är statisk och kräver ingen manuell påfyllning (till skillnad
från now_playing.py, som är en live källa) -- säsongerna återkommer likadant
varje år. Justera bara om
den lokala odlingskalendern faktiskt ändras (klimat, nya lokala grödor osv).
"""
from __future__ import annotations

import datetime

# Månad -> flera kandidater, roterade inom månaden så inte samma ingrediens
# föreslås varje enskild torsdag i en och samma månad.
SEASONAL_INGREDIENTS: dict[int, list[str]] = {
    1: ["butternut squash", "russet potatoes", "root vegetables (carrots, parsnips)"],
    2: ["cabbage", "stored winter squash", "dried beans"],
    3: ["cabbage", "leeks", "eggs (spring laying season)"],
    4: ["asparagus", "spinach", "green onions"],
    5: ["asparagus", "rhubarb", "radishes"],
    6: ["strawberries", "peas", "new potatoes"],
    7: ["sweet corn", "zucchini", "green beans"],
    8: ["sweet corn", "tomatoes", "bell peppers"],
    9: ["tomatoes", "apples", "winter squash (early harvest)"],
    10: ["apples", "pumpkin", "Brussels sprouts"],
    11: ["winter squash", "sweet potatoes", "cranberries"],
    12: ["root vegetables", "stored apples", "dried beans"],
}


def next_pick(today: datetime.date) -> str:
    """Deterministic pick within today's month -- same pick if rerun the same day,
    rotates across the month's candidates by day-of-month."""
    candidates = SEASONAL_INGREDIENTS[today.month]
    return candidates[today.day % len(candidates)]


def build_local_input(ingredient: str) -> str:
    return (
        f"Main ingredient: {ingredient}, in season now in South Dakota. "
        f"Write a weeknight dinner recipe centered on it."
    )
