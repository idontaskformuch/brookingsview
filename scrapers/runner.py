"""Config-driven runner.

Läser configs/<town>.json, kör varje AKTIVERAD datakälla i tur och ordning:
  fetch → save_snapshot → parse → dedup-upsert → logga scrape_run.

Ingen ort-specifik logik här — allt kommer från configen. Ny ort = ny config.

Körning:
    python -m scrapers.runner --config configs/brookings_sd.json
    python -m scrapers.runner --config configs/brookings_sd.json --only weather sdsu_athletics
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
import traceback
from pathlib import Path

# gör paketimport möjlig oavsett var scriptet körs ifrån
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db import db  # noqa: E402
from scrapers.base_parser import BaseParser, StubParser  # noqa: E402

# ---------------------------------------------------------------------------
# Registry: mappar config-fältet "type" (eller "parser") → parser-klass.
# Håll denna som enda ställe där nya källor kopplas in.
# ---------------------------------------------------------------------------
REGISTRY: dict[str, str] = {
    # verifierade / dokumenterade API:er (byggda på riktigt)
    "noaa":            "scrapers.parsers.noaa:NoaaParser",
    "nws":             "scrapers.parsers.nws_alerts:NwsAlertsParser",
    "legistar":        "scrapers.parsers.legistar_v1:LegistarParser",
    "escribe":         "scrapers.parsers.escribe_v1:EscribeParser",
    "rivco_assessor":  "scrapers.parsers.rivco_property_sales_v1:PropertySalesParser",
    "usda":            "scrapers.parsers.usda:UsdaParser",
    # stubbar (väntar på Stage 0-verifiering av källstruktur)
    "smartgov":        "scrapers.parsers.smartgov_v1:SmartGovParser",
    "civicengage_agenda_center": "scrapers.parsers.civicengage_pdf_v1:CivicEngageParser",
    "sports":          "scrapers.parsers.gojacks_v1:GoJacksParser",
    "sd_dot_511":      "scrapers.parsers.sd511:SD511Parser",
    "county_alerts":   "scrapers.parsers.county_alerts:CountyAlertsParser",
    "events":          "scrapers.parsers.events:EventsParser",
}

# vissa källor anger provider/typ på olika sätt; normalisera.
# source_key är den yttre nyckeln i data_sources (t.ex. "county_alerts", "events") --
# provas som SISTA fallback, eftersom flera REGISTRY-nycklar råkar vara namngivna
# efter source_key snarare än efter type/provider/parser-fältens faktiska värden
# (upptäckt 2026-07-17: "events" har type="multi", "county_alerts" har
# type="html_scrape" -- ingetdera matchar REGISTRY-nyckeln på fältvärde).
def _resolve_key(source_cfg: dict, source_key: str | None = None) -> str | None:
    for candidate in (source_cfg.get("provider"),
                      source_cfg.get("type"),
                      source_cfg.get("parser")):
        if candidate and candidate in REGISTRY:
            return candidate
    # weather-blocket har type="api", provider="noaa"
    if source_cfg.get("type") == "api" and source_cfg.get("provider") in REGISTRY:
        return source_cfg["provider"]
    if source_key and source_key in REGISTRY:
        return source_key
    return None


def _load_parser(dotted: str, cfg: dict, source_cfg: dict) -> BaseParser:
    module_path, class_name = dotted.split(":")
    module = importlib.import_module(module_path)
    klass = getattr(module, class_name)
    return klass(cfg, source_cfg)


def run_source(conn, cfg: dict, source_key: str, source_cfg: dict) -> None:
    town_id = cfg["town_id"]
    reg_key = _resolve_key(source_cfg, source_key)
    if not reg_key:
        print(f"  [{source_key}] ingen parser registrerad — hoppar över")
        run_id = db.start_run(conn, town_id, source_key)
        db.finish_run(conn, run_id, status="skipped")
        return

    parser = _load_parser(REGISTRY[reg_key], cfg, source_cfg)
    parser.source_key = source_key
    run_id = db.start_run(conn, town_id, source_key)

    # stubbar loggas som 'stub' och avslutas tyst
    if isinstance(parser, StubParser):
        print(f"  [{source_key}] STUB — {parser.todo}")
        db.finish_run(conn, run_id, status="stub")
        return

    try:
        fetched = parser.fetch()
        snapshot_id = None
        if fetched.raw:
            snapshot_id = db.save_snapshot(
                conn, town_id, source_key, fetched.url, fetched.raw, fetched.content_type
            )
        records = parser.parse(fetched)
        new = db.upsert_records(conn, parser.table, town_id, records, snapshot_id)
        db.finish_run(conn, run_id, status="ok", http_code=fetched.http_code,
                      items_found=len(records), items_new=new)
        print(f"  [{source_key}] ok — {len(records)} poster, {new} nya")
    except Exception as exc:  # noqa: BLE001
        err = f"{exc.__class__.__name__}: {exc}"
        db.finish_run(conn, run_id, status="error", error=err)
        fails = db.consecutive_failures(conn, town_id, source_key)
        print(f"  [{source_key}] FEL ({fails} i rad): {err}", file=sys.stderr)
        traceback.print_exc()
        # alerting: mejla om samma källa failat upprepat
        if fails >= int(os.environ.get("ALERT_AFTER_FAILURES", "3")):
            _alert(town_id, source_key, fails, err)


def _alert(town_id: str, source_key: str, fails: int, err: str) -> None:
    """Enkelt händelsestyrt larm. Kopplas till valfri mejl/webhook via env.

    Lämnad som en tunn krok med flit: skriv hit din SMTP/Resend/Slack-integration.
    """
    hook = os.environ.get("ALERT_WEBHOOK")
    msg = f"[{town_id}] scraper '{source_key}' failat {fails} ggr i rad: {err}"
    print(f"ALERT: {msg}", file=sys.stderr)
    if hook:
        try:
            import requests
            requests.post(hook, json={"text": msg}, timeout=10)
        except Exception:  # pragma: no cover
            pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--only", nargs="*", help="kör bara dessa källnycklar")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    sources = cfg.get("data_sources", {})

    with db.get_conn() as conn:
        db.ensure_town(conn, cfg)
        print(f"Kör {cfg['display_name']} ({cfg['town_id']})")
        for source_key, source_cfg in sources.items():
            if not source_cfg.get("enabled", False):
                continue
            if args.only and source_key not in args.only:
                continue
            run_source(conn, cfg, source_key, source_cfg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
