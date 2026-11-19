"""Fire and water restrictions from a CivicPlus Alert Center (Fas 5 source 1, owner 2026-11-19: Broomfield nr 1 + 5, same code).

Writes restriction_checks (db/migrations/073_restriction_checks.sql): one row per configured page per run. The site shows the
newest row per kind (site/src/lib/restrictions.ts).

Rules from the owner's decision (.claude/specs/fas5-source-inventory.md, "Beslut"):
- Every request through PoliteFetcher ("source", ViewMediaBot). broomfield.org robots.txt: `User-agent: *` Crawl-delay 10;
  PoliteFetcher reads it and waits at least 10 s between our two requests. Only the HTML pages in the config: never RSS.aspx,
  calendar.aspx, CivicAlerts.aspx or map.aspx (all disallowed there), and no link on the page is followed.
- No text of our own here. title and since_text are the source's words, whitespace collapsed; everything else is a state.
- Never "no restrictions" as a fallback. 'none' only when a category page loaded with its own counter at 0 and no alert listed.
  Anything else that is not a recognised alert (refused, not 200, cut, heading changed, counter missing, alert not marked
  active) is 'unknown' with the reason in `error`. Nothing raises past fetch/parse for a page problem: a changed page must give
  "unknown" on the site, not a failed run that leaves the last good row looking current.

Two page shapes, both seen live 2026-11-19 (.claude/evidence/fas5-restrictions/):
  shape "alert"     AlertCenter.aspx?AID=90, one alert:
                      div.singleAlert > h2 (category name), div.alert.on > span.date + h3 (title); div.updates > div.update
  shape "category"  AlertCenter.aspx?CID=...-9, one category:
                      div.divCat_<cid> > h2 (category name) + span.numAlerts ("1  Alert"), ol.alerts-list > li > div.alert.on >
                      span.date + h3 > a (title, link to the alert)
"since" is the date on the City's own alert (span.date in div.alert), not the "Latest Update" date.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult
from scrapers.polite_fetch import MAX_BYTES, PoliteFetcher, Refused
from scrapers.user_agent import user_agent

KINDS = ("fire", "water")
SHAPES = ("alert", "category")
_DATE_FMT = "%B %d, %Y %I:%M %p"  # "November 17, 2026 6:54 PM"
_COUNT = re.compile(r"^(\d+)\s+Alerts?$", re.I)


def _clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _parse_local(text: str, tz: str) -> str | None:
    try:
        return datetime.strptime(text, _DATE_FMT).replace(tzinfo=ZoneInfo(tz)).isoformat()
    except ValueError:
        return None


class Unrecognised(Exception):
    """The page answered but does not have the structure this parser checks for."""


def _alert_fields(div) -> tuple[str, str]:
    """(title, date text) of one div.alert, verbatim; Unrecognised when either is missing or the alert is not marked active."""
    if "on" not in (div.get("class") or []):
        raise Unrecognised("alert is not marked active (class 'on' missing)")
    date = div.find("span", class_="date")
    title = div.find("h3")
    date_text, title_text = _clean(date.get_text() if date else ""), _clean(title.get_text(" ") if title else "")
    if not date_text or not title_text:
        raise Unrecognised("alert without span.date or h3 title")
    return title_text, date_text


def parse_alert_page(html: bytes | str, category: str) -> dict:
    """Shape "alert" (one alert page). Returns {state, title, since_text, alert_count}; raises Unrecognised."""
    soup = BeautifulSoup(html, "html.parser")
    panel = soup.select_one("div.singleAlert")
    if panel is None:
        raise Unrecognised("div.singleAlert not found")
    heading = panel.find("h2")
    if _clean(heading.get_text() if heading else "") != category:
        raise Unrecognised(f"category heading is not {category!r}")
    div = panel.select_one("div.alert")
    if div is None:
        raise Unrecognised("div.alert not found")
    title, date_text = _alert_fields(div)
    return {"state": "active", "title": title, "since_text": date_text, "alert_count": 1, "alert_url": None}


def parse_category_page(html: bytes | str, category: str, cid: int) -> dict:
    """Shape "category". 'none' only when the page's own counter says 0 and no alert is listed; raises Unrecognised."""
    soup = BeautifulSoup(html, "html.parser")
    block = soup.select_one(f"div.divCat_{int(cid)}")
    if block is None:
        raise Unrecognised(f"div.divCat_{cid} not found")
    heading = block.find("h2")
    if _clean(heading.get_text() if heading else "") != category:
        raise Unrecognised(f"category heading is not {category!r}")
    counter = block.find("span", class_="numAlerts")
    m = _COUNT.match(_clean(counter.get_text() if counter else ""))
    if not m:
        raise Unrecognised("span.numAlerts missing or not '<n> Alert(s)'")
    count = int(m.group(1))
    items = block.select("li.alerts-list")
    if count != len(items):
        raise Unrecognised(f"counter says {count}, page lists {len(items)}")
    if count == 0:
        return {"state": "none", "title": None, "since_text": None, "alert_count": 0, "alert_url": None}
    alerts = []
    for li in items:
        div = li.find("div", class_="alert")
        if div is None:
            raise Unrecognised("li.alerts-list without div.alert")
        title, date_text = _alert_fields(div)
        link = div.select_one("h3 a[href]")
        alerts.append((title, date_text, link["href"] if link else None))
    title, date_text, href = alerts[0]  # the page's own order (newest first in CivicPlus)
    return {"state": "active", "title": title, "since_text": date_text, "alert_count": count, "alert_url": href}


class AlertCenterRestrictionsParser(BaseParser):
    table = "restriction_checks"
    platform = "civicplus_alert_center"

    def __init__(self, cfg: dict, source_cfg: dict):
        super().__init__(cfg, source_cfg)
        self.tz = cfg.get("timezone") or "America/Denver"
        self.pages = list(source_cfg.get("pages") or [])
        for page in self.pages:
            if page.get("kind") not in KINDS or page.get("shape") not in SHAPES or not page.get("url") or not page.get("category"):
                raise ValueError(f"restrictions page config needs kind {KINDS}, shape {SHAPES}, url and category: {page!r}")
        self.fetcher: PoliteFetcher | None = None  # tests inject one with a fake session
        self.now = lambda: datetime.now(timezone.utc)
        self._results: list[dict] = []

    def _fetcher(self) -> PoliteFetcher:
        if self.fetcher is None:
            self.fetcher = PoliteFetcher("source", self.town_id, ua=user_agent(self.town_id))
        return self.fetcher

    def fetch(self) -> FetchResult:
        """Reads every configured page once. A page problem is recorded, never raised (see the module docstring); the run is
        'degraded' when every page failed (FetchResult.docs_*), so it still shows in scrape_runs."""
        self._results = []
        failed, last_error = 0, None
        for page in self.pages:
            got = self._fetcher().get(page["url"])
            result = {"page": page, "body": None, "error": None}
            if isinstance(got, Refused):
                result["error"] = f"refused: {got.reason}"
            elif got.status != 200:
                result["error"] = f"answered {got.status if got.status else 'nothing (no answer)'}"
            elif got.cut:
                result["error"] = f"reached the {MAX_BYTES} byte size cap, not parsed"
            else:
                result["body"] = got.body
            if result["error"]:
                failed, last_error = failed + 1, f"{page['kind']}: {result['error']}"
            self._results.append(result)
        # The snapshot is what was asked and what came back, not the two ~280 kB pages (the parsed fields are in the rows).
        summary = [{"kind": r["page"]["kind"], "url": r["page"]["url"], "error": r["error"],
                    "bytes": len(r["body"]) if r["body"] is not None else 0} for r in self._results]
        return FetchResult(raw=json.dumps(summary).encode(), content_type="application/json", url=None, http_code=200,
                           docs_attempted=len(self.pages), docs_failed=failed, docs_last_error=last_error)

    def parse(self, fetched: FetchResult) -> list[dict]:
        checked_at = self.now().isoformat()
        records = []
        for result in self._results:
            page = result["page"]
            row = {"state": "unknown", "title": None, "since_text": None, "alert_count": None, "alert_url": None,
                   "error": result["error"]}
            if result["body"] is not None:
                try:
                    if page["shape"] == "alert":
                        row.update(parse_alert_page(result["body"], page["category"]))
                    else:
                        row.update(parse_category_page(result["body"], page["category"], page.get("cid", 0)))
                except Unrecognised as exc:
                    row["error"] = f"page structure changed: {exc}"
                except Exception as exc:  # noqa: BLE001 -- a page we cannot read is 'unknown', never a crash
                    row["error"] = f"page could not be parsed: {type(exc).__name__}: {exc}"
            if row["alert_url"] and row["alert_url"].startswith("/"):
                origin = re.match(r"^https?://[^/]+", page["url"])
                row["alert_url"] = (origin.group(0) if origin else "") + row["alert_url"]
            records.append({
                "kind": page["kind"],
                **row,
                "since_at": _parse_local(row["since_text"], self.tz) if row["since_text"] else None,
                "source_url": page["url"],
                "checked_at": checked_at,
                "content_hash": content_hash("restriction_check", page["kind"], page["url"], checked_at),
            })
        return records
