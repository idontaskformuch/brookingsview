"""SmartGov (Granicus) — bygglov + affärs-/spritlicenser. STUB.

Dokumenterad väg (Stage 0):
  Portal: https://ci-brookings-sd.smartgovcommunity.com/
  + stadens månatliga bygglovsrapport: cityofbrookings-sd.gov/214/Past-Building-Permits
Verifiera att permit-/licensdata är publikt läsbar UTAN inloggning innan implementation.
Skriver till: permits. Fält att fylla: permit_type, address, description, applicant,
issued_date, raw_data, content_hash. applicant = företag/entitet, ALDRIG negativt om privatperson.
"""
from scrapers.base_parser import StubParser


class SmartGovParser(StubParser):
    table = "permits"
    platform = "smartgov"
    todo = "Verifiera SmartGov publik läsbarhet + parsa permits/licenser (Stage 0)."
