"""Riverside County Assessor -- kvartalsvis fastighetsförsäljningsfil (R&T Code 408.1).

VARFÖR LOKAL FIL, INTE HTTP-HÄMTNING: rivcoacr.org/robots.txt blockerar uttryckligen
AI-agenter vid namn (anthropic-ai, ClaudeBot, Claude-Web m.fl. -- Disallow: / för hela
sajten). Det är ett medvetet policyval från sajtägaren, inte en teknisk begränsning --
att kringgå det med en annan User-Agent vore att medvetet trotsa en uttalad policy,
samma disciplin som civicengage_pdf_v1/events.py följer för robots.txt-blockerade
källor någon annanstans i den här kodbasen. En människa laddar därför ner filen
manuellt (kvartalsvis, ingen brådska -- se refresh_minutes i configen) och lägger den
i data/property_sales/<town_id>/. Parsern läser bara den senast nedladdade filen,
hämtar aldrig något från nätet själv.

VERIFIERAT 2026-07-24 mot en riktig nedladdad fil (447569.xlsx, ~13 MB, 161 353 rader,
DocumentDate 2024-01-01 -- 2025-12-08 -- exakt de senaste två åren R&T 408.1 kräver):
  - Enda arket heter "SalesListing".
  - Kolumner (i ordning): GeographicalCode, PIN, StreetNumber, StreetNumberSfx,
    Predirectional, StreetName, StreetType, UnitIdentifier, City, PostalCd,
    DocumentDate, RecordDate, DocumentNumber, Consideration, PropertyUse.
  - HELA countyt, inte bara Moreno Valley -- filtreras på City == "MORENO VALLEY".
  - INGA köpar-/säljarnamn i filen överhuvudtaget (bekräftat, alla 15 kolumner
    granskade) -- till skillnad från vad uppgiften antog behövs ingen
    namn-strippning innan AI-prompten, det finns inget namn att strippa.
  - Consideration = 0 för en betydande andel rader (icke-armslängds-överlåtelser:
    trust-överföringar, quitclaims m.m.) -- det är INTE en försäljning i den
    meningen "Recent home sales" avser, filtreras bort.
  - PropertyUse innehåller allt från Single Family Dwelling till Vacant Commercial
    Land och Full Service Restaurant -- bara bostadstyper räknas som "home sale"
    (se _RESIDENTIAL_PROPERTY_USES nedan).

Fältnamnen matchar Riverside Countys egen exportfil, inte en tredjeparts-aggregator
(Zillow/Redfin/Realtor scrapas ALDRIG -- se moduldocstring-motsvarigheten i uppgiften).
"""
from __future__ import annotations

import glob
import json
import os

from dataclasses import dataclass, field
from datetime import date, datetime

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

# Bara faktiska bostäder räknas som "home sale" -- HOMESITE (obebyggd tomt),
# Vacant Residential Land, Apartment/Fourplex (hyresfastighet) m.fl. är
# medvetet uteslutna. Se moduldocstring för hela PropertyUse-fördelningen som
# låg till grund för det här urvalet.
_RESIDENTIAL_PROPERTY_USES = {
    "Single Family Dwelling",
    "Condo or PUD",
    "SFD with Secondary Unit(s)",
    "MH on Foundation (MF)",
    "MH Lot with MH on LPT (MO)",
}

_HEADER = [
    "GeographicalCode", "PIN", "StreetNumber", "StreetNumberSfx", "Predirectional",
    "StreetName", "StreetType", "UnitIdentifier", "City", "PostalCd",
    "DocumentDate", "RecordDate", "DocumentNumber", "Consideration", "PropertyUse",
]


@dataclass
class ParsedSales:
    """Resultatet av en hel-fil-parse: de filtrerade Moreno Valley-raderna PLUS
    hela filens (countywide, ofiltrerade) täckningsfönster.

    window_start/window_end byggs på RecordDate över ALLA rader i filen, inte
    bara de Moreno Valley-matchande -- annars ser täckningen ut att sluta vid
    den senaste RIKTIGA lokala försäljningen i stället för vid var länets data
    faktiskt når, vilket gör en genuint tom månad omöjlig att skilja från en
    månad länet ännu inte hunnit publicera. Se
    ai_pipeline/home_sales_state.py för hur det här fönstret används."""
    records: list[dict] = field(default_factory=list)
    rows_seen: int = 0
    window_start: date | None = None
    window_end: date | None = None

    @property
    def rows_matched(self) -> int:
        return len(self.records)


def latest_file(local_dir: str) -> str:
    candidates = sorted(glob.glob(os.path.join(local_dir, "*.xlsx")), key=os.path.getmtime)
    if not candidates:
        raise FileNotFoundError(
            f"ingen .xlsx-fil hittad i {local_dir} -- ladda ner kvartalsfilen från "
            "rivcoacr.org/property-sales-report manuellt (se moduldocstring för varför)"
        )
    return candidates[-1]


def parse_workbook(path: str, target_city: str) -> ParsedSales:
    """Läs HELA kvartalsfilen: filtrerade Moreno Valley-poster + countywide
    täckningsfönster. Delad av både PropertySalesParser (den generiska
    scrapers.runner-vägen) och scripts/reconcile_property_sales.py (den
    kvartalsvisa reconcile-körningen med full ingest-rapportering)."""
    import openpyxl  # tung importerad bara här -- endast denna parser behöver den

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["SalesListing"]

    result = ParsedSales()
    target_city_upper = target_city.upper()

    for row in ws.iter_rows(min_row=2, values_only=True):
        record = dict(zip(_HEADER, row))
        result.rows_seen += 1

        record_date = _to_date(record.get("RecordDate"))
        if record_date is not None:
            if result.window_start is None or record_date < result.window_start:
                result.window_start = record_date
            if result.window_end is None or record_date > result.window_end:
                result.window_end = record_date

        city = record.get("City")
        if not isinstance(city, str) or city.strip().upper() != target_city_upper:
            continue

        if record.get("PropertyUse") not in _RESIDENTIAL_PROPERTY_USES:
            continue

        consideration = record.get("Consideration") or 0
        if not consideration:
            continue

        address = _build_address(record)
        if address is None:
            continue

        sale_date = _to_date(record.get("DocumentDate"))
        doc_number = record.get("DocumentNumber")
        pin = record.get("PIN")

        result.records.append({
            "address": address,
            "sale_price": consideration,
            "sale_date": sale_date,
            "pin": _clean_str(pin) or None,
            "doc_number": _clean_str(doc_number) or None,
            "record_date": record_date,
            "raw_data": {k: _jsonable(v) for k, v in record.items()},
            # DocumentNumber ENSAMT räcker inte: en enda inspelad handling kan
            # täcka flera separata parceller/enheter (t.ex. en flerbostadsfastighet
            # såld som en transaktion, verifierat i verkliga data -- 8 olika
            # LASSELLE ST-adresser delade samma DocumentNumber). Adressen med i
            # hashen så varje distinkt enhet får sin egen rad i stället för att
            # dedupen tyst slänger alla utom den första. (pin, doc_number) är
            # den riktiga identiteten sedan migration 019 -- content_hash lever
            # kvar för bakåtkompatibilitet med rader skrivna innan den migrationen.
            "content_hash": content_hash("rivco_property_sales", doc_number, address),
        })
    wb.close()
    return result


class PropertySalesParser(BaseParser):
    table = "property_sales"
    platform = "rivco_assessor"
    # Migration 019: (town_id, pin, doc_number) är en verifierat unik identitet
    # per fysisk enhet såld (0 kollisioner mot alla 2610 befintliga rader). Med
    # DO UPDATE blir en omkörning mot samma eller en överlappande kvartalsfil
    # en riktig reconcile i stället för att bara droppa allt som redan har en
    # matchande content_hash -- en rad vars uppgifter korrigerats i en senare
    # fil (t.ex. Consideration) uppdateras då i stället för att tyst ignoreras.
    conflict_columns = ("town_id", "pin", "doc_number")
    update_columns = ["address", "sale_price", "sale_date", "record_date", "raw_data",
                       "content_hash", "snapshot_id"]

    def _local_dir(self) -> str:
        local_dir = self.source_cfg.get("local_dir")
        if not local_dir:
            raise ValueError("property_sales local_dir saknas i config (mänskligt nedladdad fil förväntas)")
        return local_dir

    def fetch(self) -> FetchResult:
        path = latest_file(self._local_dir())
        with open(path, "rb") as f:
            raw = f.read()
        return FetchResult(raw=raw, content_type="application/vnd.openxmlformats", url=path, http_code=200)

    def parse(self, fetched: FetchResult) -> list[dict]:
        target_city = (self.source_cfg.get("city") or self.cfg.get("display_name") or "")
        return parse_workbook(fetched.url, target_city).records


def _clean_str(value) -> str:
    """Källfilen blandar typer per rad (t.ex. UnitIdentifier/City är ibland int,
    ibland whitespace-only sträng) -- gör om till sträng defensivt oavsett."""
    if value is None:
        return ""
    return str(value).strip()


def _build_address(record: dict) -> str | None:
    street_number = record.get("StreetNumber")
    street_name = record.get("StreetName")
    if not street_number or not street_name:
        # ingen gatuadress (t.ex. Timeshare Estate-rader) -- inget att rapportera
        return None

    parts = [
        _clean_str(street_number),
        _clean_str(record.get("Predirectional")),
        _clean_str(street_name),
        _clean_str(record.get("StreetType")),
    ]
    unit = _clean_str(record.get("UnitIdentifier"))
    if unit:
        parts.append(f"#{unit}")
    street_line = " ".join(p for p in parts if p)

    city = _clean_str(record.get("City"))
    postal = record.get("PostalCd")
    city_line = f"{city} {postal}".strip() if postal else city

    return f"{street_line}, {city_line}" if city_line else street_line


def _to_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def _jsonable(value):
    """raw_data blir JSONB -- datetime/date är inte JSON-serialiserbara direkt."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value
