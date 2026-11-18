"""Model gate: may a row's source go through a language model? (owner 2026-11-18, specs/us-christmas-2026.md "Beslut steg 2").

One answer per SOURCE, not per row (G1): the source's fetch URL comes from the town config (the source registry), and its robots.txt
is read at run time, once per host and run (PoliteFetcher caches per origin; this class caches per source key). That is always the
latest verdict, in CI too, with no shared fetch log and no DB column.

Closed when unsure (G2). A source is ok for the model only when
  * its URL is under a public API's own terms, listed in configs/shared/llm_gate.json (not in code), or
  * robots.txt allows it for us AND no AI crawler's own group disallows its path (robots.Verdict.llm_excluded, CCBot included).
Anything else stays away from the model: llm_excluded, disallowed for us, robots.txt unreachable/403, a source the config does not
list, or a row the gate cannot place. Such rows may still be shown in template-built parts of a page (title, time, place, link).

    gate = LlmGate(cfg)
    reason = gate.blocked_reason("events", row)   # None = the model may see it
"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

_ROOT = Path(__file__).resolve().parents[1]
GATE_CONFIG = _ROOT / "configs" / "shared" / "llm_gate.json"

# The fields a meetings config names its fetch URL in, most specific first (the API a scraper calls before a public viewer).
_MEETING_URL_FIELDS = ("prefer_api", "session_endpoint", "url", "base_url", "public_viewer")
# Which raw_data field marks which meetings format (format knowledge, the same for every town that uses the format).
_MEETING_FORMAT_MARKERS = {
    "legistar": "EventId",
    "agendalink": "clientId",
    "coins": "committee_url",
    "escribe": "MeetingDocumentLink",
    "civicengage_agenda_center": "place",
}
_EVENT_URL_FIELDS = ("url", "listing_url", "ical_base_url")


def load_api_terms(path: Path = GATE_CONFIG) -> list[dict]:
    return list(json.loads(path.read_text(encoding="utf-8")).get("api_terms_sources", []))


def _event_source_url(src: dict) -> str | None:
    for field in _EVENT_URL_FIELDS:
        if src.get(field):
            return src[field]
    urls = src.get("urls") or []
    return urls[0] if urls else None


class LlmGate:
    def __init__(self, cfg: dict, *, fetcher=None, api_terms: list[dict] | None = None):
        self.cfg = cfg
        self.town_id = cfg.get("town_id")
        self._fetcher = fetcher
        self.api_terms = load_api_terms() if api_terms is None else api_terms
        self._by_key: dict[str, str | None] = {}

    # --- registry: source key -> fetch URL ------------------------------------------------------------------------------------
    def source_url(self, key: str) -> str | None:
        kind, _, name = key.partition(":")
        ds = self.cfg.get("data_sources") or {}
        if kind == "events":
            for src in (ds.get("events") or {}).get("sources", []):
                if src.get("name") == name:
                    return _event_source_url(src)
            return None
        if kind == "meetings":
            block = ds.get(name) or {}
            return next((block[f] for f in _MEETING_URL_FIELDS if isinstance(block.get(f), str) and block[f].startswith("http")), None)
        return None

    def key_for(self, table: str, row: dict) -> str | None:
        """The source key of a row, or None when the gate cannot place it (then the row is blocked)."""
        if table == "events":
            return f"events:{row['source']}" if row.get("source") else None
        if table == "meetings":
            raw = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else {}
            ds = self.cfg.get("data_sources") or {}
            hits = [name for name, block in ds.items()
                    if name.endswith("meetings") and isinstance(block, dict) and block.get("enabled") is not False
                    and _MEETING_FORMAT_MARKERS.get(block.get("type", "")) in raw]
            return f"meetings:{hits[0]}" if len(hits) == 1 else None
        return None

    # --- verdict -----------------------------------------------------------------------------------------------------------------
    def _api_terms(self, url: str) -> dict | None:
        p = urlparse(url)
        return next((t for t in self.api_terms if p.netloc.lower() == t["host"] and (p.path or "/").startswith(t["path"])), None)

    def _fetch(self):
        if self._fetcher is None:
            from scrapers.polite_fetch import PoliteFetcher
            self._fetcher = PoliteFetcher("source", self.town_id)
        return self._fetcher

    def key_blocked_reason(self, key: str | None) -> str | None:
        if key is None:
            return "source unknown: the gate cannot place this row"
        if key in self._by_key:
            return self._by_key[key]
        url = self.source_url(key)
        if not url:
            reason = f"{key}: no fetch URL in the town config"
        elif self._api_terms(url):
            reason = None
        else:
            try:
                v = self._fetch().robots_verdict(url)
            except Exception as exc:  # noqa: BLE001 -- closed when unsure
                reason = f"{key}: robots.txt not read ({type(exc).__name__})"
            else:
                if v.llm_excluded:
                    reason = f"{key}: llm_excluded ({v.ai_bot}: {v.ai_rule})"
                elif not v.ok:
                    reason = f"{key}: {v.reason}"
                else:
                    reason = None
        self._by_key[key] = reason
        return reason

    def blocked_reason(self, table: str, row: dict) -> str | None:
        return self.key_blocked_reason(self.key_for(table, row))
