"""Curated källa för vardagsmiddag: vilken huvudingrediens som föreslås varje torsdag.

Samma enkla ansats som media_recension tidigare hade (nu content/now_playing.py,
ett live TMDb-API): ingen scraper för lokala matbutikers
utbud, bara en säsongslista grundad i vad som faktiskt växer/skördas i orten
klimatzon, månad för månad. Deterministisk pick per dag-i-året, ingen
tillståndsspårning behövs.

TVÅ SÄSONGSLISTOR, EN PER KLIMAT (2026-08-23, se NEEDS-HUMAN-REVIEW.md "3.4
Recipes"): Phase 1:s dekontaminering tog bort de FELAKTIGA "South Dakota"-
strängarna ur Moreno Valley-publicerat innehåll, men den ENDA säsongslistan
som fanns kvar var fortfarande South Dakotas eget odlingskalender (zon 4b/5a,
Upper Midwest, kort växtsäsong, tydliga fyra årstider) -- rätt för Brookings,
FEL för Moreno Valley oavsett att delstatsnamnet var bortstädat. Riverside
County/Inland Empire ligger i Sunset-zon 18/19: långt, milt växtsäsong,
minimal frost, historiskt citrusdistrikt. SOCAL_SEASONAL_INGREDIENTS nedan är
den motsvarande listan för det klimatet -- en annan lista, inte en
sträng-och-ersätt av samma data.

UNDERHÅLL: listorna är statiska och kräver ingen manuell påfyllning (till
skillnad från now_playing.py, som är en live källa) -- säsongerna återkommer
likadant varje år. Justera bara om den lokala odlingskalendern faktiskt
ändras (klimat, nya lokala grödor osv).
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

# Inland Empire / Riverside County (Sunset zone 18/19): long warm season,
# minimal frost, a real citrus-growing region -- deliberately NOT a copy of
# the Upper Midwest list above with names swapped. Citrus and avocado carry
# through winter (the opposite of a Midwest "root vegetables in January"
# pattern); summer stone fruit and melons arrive earlier and run longer.
SOCAL_SEASONAL_INGREDIENTS: dict[int, list[str]] = {
    1: ["navel oranges", "avocado", "leafy greens (chard, kale)"],
    2: ["mandarins", "artichokes", "leafy greens"],
    3: ["strawberries (early)", "artichokes", "snap peas"],
    4: ["strawberries", "asparagus", "spring onions"],
    5: ["strawberries", "apricots", "cherries"],
    6: ["peaches", "cherries", "zucchini"],
    7: ["tomatoes", "sweet corn", "bell peppers"],
    8: ["tomatoes", "melons", "bell peppers"],
    9: ["grapes", "figs", "bell peppers"],
    10: ["pomegranates", "persimmons", "winter squash"],
    11: ["persimmons", "sweet potatoes", "navel oranges (early)"],
    12: ["navel oranges", "avocado", "winter greens"],
}

# Colorado Front Range (Broomfield, USDA zone 5b/6a, semi-arid, ~150-day
# frost-free season) -- added 2026-08-26 for the Broomfield launch.
# Deliberately NOT reused from SEASONAL_INGREDIENTS: Denver-area elevation/
# aridity gives a genuinely different pattern than Upper Midwest humidity,
# and the region's real, well-known agricultural specialties (Western Slope
# peaches, Arkansas Valley melons, San Luis Valley potatoes -- all shipped
# into and sold at Front Range markets) are worth naming specifically rather
# than defaulting to a generic "root vegetables in winter" list that could
# describe almost anywhere.
COLORADO_SEASONAL_INGREDIENTS: dict[int, list[str]] = {
    1: ["Colorado potatoes (San Luis Valley, stored)", "winter squash", "root vegetables"],
    2: ["stored potatoes", "dried beans", "cabbage"],
    3: ["spinach", "green onions", "early greens"],
    4: ["asparagus", "spinach", "radishes"],
    5: ["asparagus", "rhubarb", "spring greens"],
    6: ["Western Slope strawberries", "peas", "new potatoes"],
    7: ["early Palisade peaches", "sweet corn", "zucchini"],
    8: ["Palisade peaches (peak)", "Olathe sweet corn", "Rocky Ford cantaloupe"],
    9: ["Pueblo chiles", "apples", "winter squash (early harvest)"],
    10: ["late-season Pueblo chiles", "pumpkin", "apples"],
    11: ["winter squash", "sweet potatoes", "stored apples"],
    12: ["root vegetables", "stored winter squash", "dried beans"],
}

_REGIONS: dict[str, tuple[dict[int, list[str]], str]] = {
    "socal": (SOCAL_SEASONAL_INGREDIENTS, "Southern California's Inland Empire"),
    "midwest": (SEASONAL_INGREDIENTS, "South Dakota"),
    "colorado_front_range": (COLORADO_SEASONAL_INGREDIENTS, "Colorado's Front Range"),
}

# town_id -> region key. New towns default to "midwest" (the original list)
# unless added here -- an explicit mapping instead of inferring from state
# abbreviation, since climate zone doesn't follow state lines cleanly enough
# to guess safely.
_TOWN_REGION: dict[str, str] = {
    "moreno_valley_ca": "socal",
    "brookings_sd": "midwest",
    "broomfield_co": "colorado_front_range",
}


def _region_for(cfg: dict | None) -> tuple[dict[int, list[str]], str]:
    town_id = (cfg or {}).get("town_id")
    key = _TOWN_REGION.get(town_id, "midwest")
    return _REGIONS[key]


def next_pick(today: datetime.date, cfg: dict | None = None) -> str:
    """Deterministic pick within today's month -- same pick if rerun the same day,
    rotates across the month's candidates by day-of-month."""
    ingredients, _ = _region_for(cfg)
    candidates = ingredients[today.month]
    return candidates[today.day % len(candidates)]


def build_local_input(ingredient: str, cfg: dict | None = None) -> str:
    _, region_label = _region_for(cfg)
    return (
        f"Main ingredient: {ingredient}, in season now in {region_label}. "
        f"Write a weeknight dinner recipe centered on it. Do not name a "
        f"specific farmers market, grocery store, or produce stand -- you "
        f"have no verified information about which ones currently carry "
        f"this ingredient or when they're open. Describe the ingredient as "
        f"being in season for the region generally."
    )
