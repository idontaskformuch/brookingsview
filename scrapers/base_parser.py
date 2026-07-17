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


class BaseParser(abc.ABC):
    #: DB-tabell posterna skrivs till
    table: str = ""
    #: nyckeln i configens data_sources (sätts av runner)
    source_key: str = ""
    #: plattformsnamn för återanvändning ("legistar", "noaa", ...)
    platform: str = ""

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
