"""South Dakota DOT 511 — väglag (vinterprioritet). STUB.

Dokumenterad väg (Stage 0): hitta SD 511 data-endpoint (troligen sd511.org / SDDOT-API).
Skriver till: events (source='road_conditions') eller egen statusrad för banner.
Säsong: vinter = hög relevans i SD.
"""
from scrapers.base_parser import StubParser


class SD511Parser(StubParser):
    table = "events"
    platform = "sd511"
    todo = "Fastställ SD 511 data-endpoint (Stage 0)."
