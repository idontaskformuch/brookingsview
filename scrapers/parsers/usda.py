"""USDA NASS Quick Stats — råvarupriser för farm-country-läsarna.

Dokumenterat API: https://quickstats.nass.usda.gov/api/api_GET/?key=...
Kräver en GRATIS API-nyckel (NASS_API_KEY). Vi hämtar historik per commodity
på delstatsnivå (South Dakota) där en sådan serie finns.

Farm Report-fördjupning (2026-08-23, se NEEDS-HUMAN-REVIEW.md "Brookings —
Farm Report Depth"): utökad från 3 till 7 commodities, och parse() sparar nu
VARJE månadsrad istället för bara den senaste (se _monthly_rows() nedan) --
en tidigare version kastade all historik direkt efter att ha hittat max(),
vilket gjorde riktning/trend omöjligt trots att API-anropet redan hämtade
den datan. Ingen ny källa, inga nya termer -- samma API, fler parametrar,
mer av redan hämtat svar sparas.

Varje ny commodity+SD-kombination VERIFIERAD live mot API:et innan den
lades till här (aldrig antagen från NASS dokumentation allena):
  - WHEAT: SD PRICE RECEIVED faktiskt har TRE class_desc-varianter (ALL
    CLASSES, WINTER, SPRING EXCL DURUM), alla i samma $/BU-enhet -- ett
    ospecificerat class_desc lät _monthly_rows() tyst blanda olika
    veteklasser månad för månad, upptäckt genom att faktiskt inspektera
    API-svaret innan produktionskörning, inte antaget. class_desc="ALL
    CLASSES" pinnad explicit (18+ riktiga månadsrader 2025-2026).
  - SUNFLOWER, class_desc="OIL TYPE": SD har en riktig månadsserie (verifierat
    Jan-Aug 2025 + en separat MARKETING YEAR-årsrad som filtreras bort, se
    _monthly_rows()). Oil type är majoriteten av SD:s solrosproduktion --
    samma val brevet efterfrågade. OBS: ingen 2026-rad fanns vid
    verifieringen, så senaste faktiska datapunkt kan vara över ett år
    gammal -- as_of-stämpeln gör den åldern synlig istället för att dölja
    den, samma "visa ingenting trasigt"-princip som resten av sajten.
  - HOGS: bara nationell nivå (samma situation som CATTLE -- SD-specifik
    delstatsserie finns inte i NASS Quick Stats för detta, verifierat). Har
    DESSUTOM samma unit_desc-fälla som wheats class_desc: samma class_desc
    ("ALL CLASSES") returnerar BÅDE en riktig "$ / CWT"-serie och en
    orelaterad "PCT OF PARITY"-parity-kvot -- unit_desc="$ / CWT" pinnad
    explicit efter att en första körning faktiskt visade PCT OF PARITY-
    värden på sidan (31.0 där ett pris skulle stått), inte teoretiskt.
  - OATS: SD har en riktig, relativt tät månadsserie (verifierat 2025 in i
    2026), en enda class/unit-kombination, ingen extra pinning behövs.
Uteslutna trots att brevet nämnde dem som möjliga: sorghum-for-silage och
alfalfa är avkastnings-/produktionssiffror i NASS, inte PRICE RECEIVED-serier
-- irrelevanta för en prislista oavsett delstatsnivå.
"""
from __future__ import annotations

import json
import os
from datetime import date

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

API = "https://quickstats.nass.usda.gov/api/api_GET/"

# grov mappning commodity -> NASS-parametrar. FINJUSTERAD i Stage 0 mot riktiga svar
# (2026-07-17): utan class_desc matchar CATTLE+PRICE RECEIVED på delstatsnivå (SD)
# BARA "COWS, MILK" ($/HEAD) — inte den köttboskapspris ($/CWT) folk faktiskt menar.
# Den kategorin ("STEERS & HEIFERS, GE 500 LBS") publiceras bara på nationell nivå i
# NASS Quick Stats, så cattle måste hämtas utan state_alpha (se fetch()).
COMMODITY_PARAMS = {
    "corn":       {"commodity_desc": "CORN", "statisticcat_desc": "PRICE RECEIVED"},
    "soybeans":   {"commodity_desc": "SOYBEANS", "statisticcat_desc": "PRICE RECEIVED"},
    # class_desc pinned explicitly -- verified live that SD wheat PRICE
    # RECEIVED actually has THREE distinct class breakdowns ("ALL CLASSES",
    # "WINTER", "SPRING, (EXCL DURUM)"), all in the same $/BU unit, unlike
    # corn/soybeans/oats which only ever return one. Leaving class_desc
    # unset would let _monthly_rows()'s per-period dedup silently mix
    # different wheat classes across different months.
    "wheat":      {"commodity_desc": "WHEAT", "statisticcat_desc": "PRICE RECEIVED",
                   "class_desc": "ALL CLASSES"},
    "sunflowers": {"commodity_desc": "SUNFLOWER", "statisticcat_desc": "PRICE RECEIVED",
                   "class_desc": "OIL TYPE"},
    "oats":       {"commodity_desc": "OATS", "statisticcat_desc": "PRICE RECEIVED"},
    "cattle":     {"commodity_desc": "CATTLE", "statisticcat_desc": "PRICE RECEIVED",
                   "class_desc": "STEERS & HEIFERS, GE 500 LBS", "agg_level_desc": "NATIONAL"},
    # unit_desc pinned explicitly -- verified live that NASS returns HOGS
    # PRICE RECEIVED under class_desc="ALL CLASSES" in TWO different units
    # ("$ / CWT" and the unrelated "PCT OF PARITY" parity-ratio metric),
    # which _monthly_rows()'s per-period dedup would otherwise silently mix,
    # picking whichever the API happened to return last for a given month.
    "hogs":       {"commodity_desc": "HOGS", "statisticcat_desc": "PRICE RECEIVED",
                   "class_desc": "ALL CLASSES", "unit_desc": "$ / CWT",
                   "agg_level_desc": "NATIONAL"},
}
# commodities i denna mängd hämtas nationellt (ingen state_alpha) — se ovan
# och moduldocstring.
_NATIONAL_ONLY = {"cattle", "hogs"}
# En vanlig läsare bryr sig om SD:s egna siffror först -- den ordning
# frontend visar dem i, inte alfabetisk eller API-svarsordning.
DISPLAY_ORDER = ["corn", "soybeans", "wheat", "sunflowers", "oats", "cattle", "hogs"]
# farm-report.astro:s disclosure-rad använder detta för att namnge exakt
# vilka serier som är delstats- kontra nationella, utan att hårdkoda listan
# på två ställen.
STATE_SERIES = [c for c in DISPLAY_ORDER if c not in _NATIONAL_ONLY]
NATIONAL_SERIES = [c for c in DISPLAY_ORDER if c in _NATIONAL_ONLY]
# 13 månader bakåt räcker för både ett 12-månaders spann och samma-månad-
# förra-året-jämförelsen, med en månads marginal för NASS eftersläpning.
_HISTORY_MONTHS = 13


class UsdaParser(BaseParser):
    table = "ag_prices"
    platform = "usda"

    def fetch(self) -> FetchResult:
        key = os.environ.get("NASS_API_KEY")
        if not key:
            raise ValueError("NASS_API_KEY saknas (gratis nyckel från quickstats.nass.usda.gov)")
        # Dynamiskt "förra året och i år" i stället för ett hårdkodat "2025"
        # -- ger alltid minst _HISTORY_MONTHS månaders täckning oavsett när
        # skriptet körs, utan att någon manuellt behöver uppdatera årtalet.
        year_ge = date.today().year - 1
        results = {}
        for commodity in self.source_cfg.get("commodities", []):
            params = {
                "key": key,
                "year__GE": str(year_ge),
                "format": "JSON",
                **COMMODITY_PARAMS.get(commodity, {"commodity_desc": commodity.upper()}),
            }
            if commodity not in _NATIONAL_ONLY:
                params["state_alpha"] = self.cfg.get("state", "SD")
            r = requests.get(API, params=params, timeout=30)
            if r.status_code == 200:
                results[commodity] = r.json().get("data", [])
        raw = json.dumps(results).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/json", url=API, http_code=200)

    def parse(self, fetched: FetchResult) -> list[dict]:
        results = json.loads(fetched.raw.decode("utf-8"))
        out = []
        for commodity, rows in results.items():
            for row in _monthly_rows(rows):
                out.append({
                    "commodity": commodity,
                    "price": _to_num(row.get("Value")),
                    "unit": row.get("unit_desc"),
                    "as_of": _as_of(row),
                    "raw_data": row,
                    "content_hash": content_hash("usda", commodity, row.get("Value"),
                                                 row.get("year"), row.get("reference_period_desc")),
                })
        return out


_MONTH_ORDER = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}


def _period_sort_key(row: dict) -> tuple[int, int]:
    """(år, månad) -- 0 för icke-månads-perioder som 'MARKETING YEAR'
    (ingen specifik månad), så de sorteras lägst och filtreras bort av
    _monthly_rows() nedan snarare än att blandas in i en månadstrend."""
    year = int(row.get("year") or 0)
    month = _MONTH_ORDER.get((row.get("reference_period_desc") or "").upper(), 0)
    return (year, month)


def _monthly_rows(rows: list[dict], history_months: int = _HISTORY_MONTHS) -> list[dict]:
    """Riktiga månadsobservationer, senaste _HISTORY_MONTHS, en per (år,
    månad) -- droppar 'MARKETING YEAR'-årsrader (ingen specifik månad, skulle
    annars förstöra en månad-för-månad-trend) och eventuella dubbletter för
    samma period (behåller den som kom sist i API-svaret)."""
    by_period: dict[tuple[int, int], dict] = {}
    for row in rows:
        key = _period_sort_key(row)
        if key[1] == 0:  # ingen månad -- t.ex. MARKETING YEAR
            continue
        by_period[key] = row
    latest_keys = sorted(by_period.keys())[-history_months:]
    return [by_period[k] for k in latest_keys]


def _to_num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _as_of(row: dict):
    year = row.get("year")
    month = _MONTH_ORDER.get((row.get("reference_period_desc") or "").upper())
    if not year or not month:
        return None  # t.ex. "MARKETING YEAR" är ett årsgenomsnitt, ingen specifik dag
    return date(int(year), month, 1)
