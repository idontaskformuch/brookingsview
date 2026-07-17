"""USDA NASS Quick Stats — råvarupriser för farm-country-läsarna.

Dokumenterat API: https://quickstats.nass.usda.gov/api/api_GET/?key=...
Kräver en GRATIS API-nyckel (NASS_API_KEY). Vi hämtar senaste pris per commodity
på delstatsnivå (South Dakota) som en enkel, tillförlitlig daglig datapunkt.

Obs: NASS är brett; exakta short_desc-strängar kan behöva justeras i Stage 0 mot
faktiska svar. Parsern är byggd men parametrarna är markerade för finjustering.
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
    "corn":     {"commodity_desc": "CORN", "statisticcat_desc": "PRICE RECEIVED"},
    "soybeans": {"commodity_desc": "SOYBEANS", "statisticcat_desc": "PRICE RECEIVED"},
    "cattle":   {"commodity_desc": "CATTLE", "statisticcat_desc": "PRICE RECEIVED",
                 "class_desc": "STEERS & HEIFERS, GE 500 LBS", "agg_level_desc": "NATIONAL"},
}
# commodities i denna mängd hämtas nationellt (ingen state_alpha) — se ovan.
_NATIONAL_ONLY = {"cattle"}


class UsdaParser(BaseParser):
    table = "ag_prices"
    platform = "usda"

    def fetch(self) -> FetchResult:
        key = os.environ.get("NASS_API_KEY")
        if not key:
            raise ValueError("NASS_API_KEY saknas (gratis nyckel från quickstats.nass.usda.gov)")
        results = {}
        for commodity in self.source_cfg.get("commodities", []):
            params = {
                "key": key,
                "year__GE": "2025",
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
            if not rows:
                continue
            # STAGE 0-FYND (2026-07-17): NASS returnerar INTE senaste först — inom
            # samma år kommer raderna i stigande månadsordning (JAN, FEB, ... MAY),
            # plus en separat "MARKETING YEAR"-rad. rows[0] gav t.ex. januaripriset
            # på corn i juli, fyra månader gammalt. Sortera explicit på (år, månad).
            latest = max(rows, key=_period_sort_key)
            out.append({
                "commodity": commodity,
                "price": _to_num(latest.get("Value")),
                "unit": latest.get("unit_desc"),
                "as_of": _as_of(latest),
                "raw_data": latest,
                "content_hash": content_hash("usda", commodity, latest.get("Value"),
                                             latest.get("year"), latest.get("reference_period_desc")),
            })
        return out


_MONTH_ORDER = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}


def _period_sort_key(row: dict) -> tuple[int, int]:
    """(år, månad) för att hitta senaste raden. Icke-månads-perioder som
    'MARKETING YEAR' saknar en specifik månad och sorteras lägst inom sitt år,
    så en riktig månadsobservation alltid vinner om en sådan finns."""
    year = int(row.get("year") or 0)
    month = _MONTH_ORDER.get((row.get("reference_period_desc") or "").upper(), 0)
    return (year, month)


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
