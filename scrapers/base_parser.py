"""Parser-kontraktet som alla källor följer.

Poängen: runner.py bryr sig aldrig om HUR en källa hämtas eller parsas — bara att
den ger en lista normaliserade poster. Det gör att en ny ort som kör samma plattform
(t.ex. Legistar) återanvänder parsern rakt av.

En parser implementerar:
  - table:      måltabell i DB ("meetings", "permits", ...)
  - fetch():    hämta rådata → (raw_bytes, content_type, url, http_code)
  - parse():    rådata → lista av dict-poster (ett fält 'content_hash' krävs för dedup)

Stubbar (källor vi inte verifierat än) subclassar StubParser och skippas snyggt.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any


@dataclass
class FetchResult:
    raw: bytes
    content_type: str = "text/html"
    url: str | None = None
    http_code: int | None = 200
    #: per-document fetch attempts WITHIN this fetch (e.g. escribe_v1's
    #: agenda/minutes/action-summary PDFs, legistar_v1's eventitems) -- a
    #: parser that fetches sub-documents after its own main request should
    #: set these so runner.py can downgrade status='ok' to 'degraded' when
    #: every attempt failed, instead of a doc-fetch failure only reaching a
    #: print() (the bug this exists to fix -- see db.finish_run()'s docstring).
    docs_attempted: int = 0
    docs_failed: int = 0
    docs_last_error: str | None = None


class BaseParser(abc.ABC):
    #: DB-tabell posterna skrivs till
    table: str = ""
    #: nyckeln i configens data_sources (sätts av runner)
    source_key: str = ""
    #: plattformsnamn för återanvändning ("legistar", "noaa", ...)
    platform: str = ""
    #: valfri override av upsert-konfliktmål/uppdateringskolumner (se
    #: db.upsert_records()) -- lämnade som None är standardbeteendet
    #: (content_hash + DO NOTHING) oförändrat för alla befintliga parsers.
    #: Sätt dessa bara för källor vars poster legitimt ÄNDRAS över tid för
    #: SAMMA rad (t.ex. en sportmatch vars status/resultat uppdateras),
    #: till skillnad från oföränderlig källdata som möten/event/försäljningar.
    conflict_columns: tuple[str, ...] | None = None
    update_columns: list[str] | None = None
    #: extra safety net, independent of content_hash -- see db.upsert_records()'s
    #: own docstring and scrapers/parsers/escribe_v1.py's EscribeParser for why
    #: this exists (a real bug: a date-parsing fix changed what content_hash
    #: computed for the SAME real meeting, producing a byte-identical-content
    #: second row under a new hash). Leave None (the default) for any source
    #: whose content_hash is already a reliable identity on its own.
    dedup_check_columns: tuple[str, ...] | None = None

    def __init__(self, cfg: dict, source_cfg: dict):
        self.cfg = cfg                    # hela town-configen
        self.source_cfg = source_cfg      # bara denna källas config-block
        self.town_id = cfg["town_id"]

    @abc.abstractmethod
    def fetch(self) -> FetchResult:
        ...

    @abc.abstractmethod
    def parse(self, fetched: FetchResult) -> list[dict]:
        ...

    # gemensam hjälpare för proveniens-fält i varje post
    def _base_fields(self) -> dict[str, Any]:
        return {}


class StubParser(BaseParser):
    """Dokumenterad platshållare för källor som väntar på Stage 0-verifiering.

    Kraschar inte pipelinen — loggar status='stub' och returnerar noll poster,
    så hela kedjan kan köras end-to-end innan varje enskild källa är klar.
    """
    is_stub = True
    todo = "Verifiera källans URL/struktur (Stage 0) och implementera fetch()/parse()."

    def fetch(self) -> FetchResult:  # pragma: no cover
        return FetchResult(raw=b"", content_type="none", url=self.source_cfg.get("url"))

    def parse(self, fetched: FetchResult) -> list[dict]:  # pragma: no cover
        return []
