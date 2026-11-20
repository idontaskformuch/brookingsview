"""Fire and water restrictions from a CivicPlus Alert Center (Fas 5 source 1, owner 2026-11-19: Broomfield nr 1 + 5, same code).

Writes restriction_checks (db/migrations/073_restriction_checks.sql): one row per configured category page per run. The site shows
the newest row per kind (site/src/lib/restrictions.ts).

Rules from the owner's decisions (.claude/specs/fas5-source-inventory.md, "Beslut"; changes 2026-11-19 evening):
- Every request through PoliteFetcher ("source", ViewMediaBot). broomfield.org robots.txt: `User-agent: *` Crawl-delay 10;
  PoliteFetcher reads it and waits at least 10 s between our requests. Only the category pages in the config: never RSS.aspx,
  calendar.aspx, CivicAlerts.aspx or map.aspx (all disallowed there), and no link on the page is followed.
- Both kinds read a CATEGORY page (fire: CID=8, water: CID=9; owner 2026-11-19 evening: fire moved off the single alert AID=90,
  which could be archived or replaced by a new alert for another level). Every active alert in the category is stored, newest
  first by the alert's own date; the site shows at most 3.
- No text of our own here. Titles and dates are the source's words, whitespace collapsed; everything else is a state.
- Never "no restrictions" as a fallback. 'none' only when the page loaded with its own counter at 0 and no alert listed.
  Anything else that is not a set of recognised alerts (refused, not 200, cut, heading changed, counter missing or disagreeing
  with the list, an alert not marked active, a date we cannot read) is 'unknown' with the reason in `error`. Nothing raises past
  fetch/parse for a page problem: a changed page must give "unknown" on the site, not a failed run that leaves the last good
  row looking current.
- A kind that has been 'unknown' for more than 72 h in a row sends one ntfy alert (scrapers/alerts.send_alert, the existing
  ALERT_WEBHOOK flow), once per unknown streak: after_upsert() marks the row that sent it (alert_sent_at).

Page shape, seen live 2026-11-19 (.claude/evidence/fas5-restrictions/cid8.html, cid9.html):
  div.divCat_<cid> > h2 (category name) + span.numAlerts ("2  Alerts"), ol.alerts-list > li.alerts-list > div.alert.on >
  span.date ("November 18, 2026 6:00 PM") + h3 > a (title, link to the alert); div.update ("Latest Update") is not used.
"since" is the date on the City's own alert (span.date in div.alert), not the "Latest Update" date.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

from db.db import content_hash
from scrapers.alerts import send_alert
from scrapers.base_parser import BaseParser, FetchResult
from scrapers.polite_fetch import MAX_BYTES, PoliteFetcher, Refused
from scrapers.user_agent import user_agent

KINDS = ("fire", "water")
UNKNOWN_ALERT_AFTER = timedelta(hours=72)
_DATE_FMT = "%B %d, %Y %I:%M %p"  # "November 17, 2026 6:54 PM"
_COUNT = re.compile(r"^(\d+)\s+Alerts?$", re.I)


def _clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


class Unrecognised(Exception):
    """The page answered but does not have the structure this parser checks for."""


def parse_category_page(html: bytes | str, category: str, cid: int, tz: str = "America/Denver", origin: str = "") -> dict:
    """{state, alerts, alert_count}; 'none' only when the page's own counter says 0 and no alert is listed. Raises Unrecognised."""
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
        return {"state": "none", "alerts": [], "alert_count": 0}
    alerts = []
    for li in items:
        div = li.find("div", class_="alert")
        if div is None:
            raise Unrecognised("li.alerts-list without div.alert")
        if "on" not in (div.get("class") or []):
            raise Unrecognised("alert is not marked active (class 'on' missing)")
        date, title = div.find("span", class_="date"), div.find("h3")
        date_text, title_text = _clean(date.get_text() if date else ""), _clean(title.get_text(" ") if title else "")
        if not date_text or not title_text:
            raise Unrecognised("alert without span.date or h3 title")
        try:
            since_at = datetime.strptime(date_text, _DATE_FMT).replace(tzinfo=ZoneInfo(tz))
        except ValueError:
            raise Unrecognised(f"alert date {date_text!r} is not '{_DATE_FMT}'") from None
        link = div.select_one("h3 a[href]")
        href = link["href"] if link else None
        if href and href.startswith("/"):
            href = origin + href
        alerts.append({"title": title_text, "since_text": date_text, "since_at": since_at.isoformat(), "url": href})
    alerts.sort(key=lambda a: a["since_at"], reverse=True)  # newest first by the alert's own date, not page order
    return {"state": "active", "alerts": alerts, "alert_count": count}


class AlertCenterRestrictionsParser(BaseParser):
    table = "restriction_checks"
    jsonb_columns = ("alerts",)  # list of dicts; first live run 2026-11-20 failed "cannot adapt type 'dict'" without it
    platform = "civicplus_alert_center"

    def __init__(self, cfg: dict, source_cfg: dict):
        super().__init__(cfg, source_cfg)
        self.tz = cfg.get("timezone") or "America/Denver"
        self.pages = list(source_cfg.get("pages") or [])
        for page in self.pages:
            if page.get("kind") not in KINDS or not page.get("url") or not page.get("category") or not page.get("cid"):
                raise ValueError(f"restrictions page config needs kind {KINDS}, url, category and cid: {page!r}")
        self.fetcher: PoliteFetcher | None = None  # tests inject one with a fake session
        self.now = lambda: datetime.now(timezone.utc)
        self.send_alert = send_alert  # tests inject a recorder
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
        # The snapshot is what was asked and what came back, not the ~280 kB pages (the parsed fields are in the rows).
        summary = [{"kind": r["page"]["kind"], "url": r["page"]["url"], "error": r["error"],
                    "bytes": len(r["body"]) if r["body"] is not None else 0} for r in self._results]
        return FetchResult(raw=json.dumps(summary).encode(), content_type="application/json", url=None, http_code=200,
                           docs_attempted=len(self.pages), docs_failed=failed, docs_last_error=last_error)

    def parse(self, fetched: FetchResult) -> list[dict]:
        checked_at = self.now().isoformat()
        records = []
        for result in self._results:
            page = result["page"]
            origin = (re.match(r"^https?://[^/]+", page["url"]) or [""])[0]
            parsed = {"state": "unknown", "alerts": None, "alert_count": None}
            error = result["error"]
            if result["body"] is not None:
                try:
                    parsed = parse_category_page(result["body"], page["category"], page["cid"], self.tz, origin)
                except Unrecognised as exc:
                    error = f"page structure changed: {exc}"
                except Exception as exc:  # noqa: BLE001 -- a page we cannot read is 'unknown', never a crash
                    error = f"page could not be parsed: {type(exc).__name__}: {exc}"
            newest = (parsed["alerts"] or [None])[0]
            records.append({
                "kind": page["kind"],
                "state": parsed["state"],
                "title": newest["title"] if newest else None,
                "since_text": newest["since_text"] if newest else None,
                "since_at": newest["since_at"] if newest else None,
                "alert_url": newest["url"] if newest else None,
                "alerts": parsed["alerts"],
                "alert_count": parsed["alert_count"],
                "error": error,
                "source_url": page["url"],
                "checked_at": checked_at,
                "content_hash": content_hash("restriction_check", page["kind"], page["url"], checked_at),
            })
        return records

    def after_upsert(self, conn) -> None:
        """72 h unknown alert (owner 2026-11-19): for each kind whose NEWEST row is 'unknown', the streak starts at the first
        'unknown' row after the last non-unknown one (or the first row ever). Past 72 h and not yet alerted in this streak: one
        ntfy alert; only a delivered alert marks the newest row (alert_sent_at), so an undelivered one is tried again next run.
        Never raises: an alert problem must not fail the scrape (the rows are already written)."""
        try:
            now = self.now()
            for page in self.pages:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        WITH last_good AS (
                          SELECT max(checked_at) AS at FROM restriction_checks
                           WHERE town_id = %(t)s AND kind = %(k)s AND state <> 'unknown')
                        SELECT (SELECT state FROM restriction_checks WHERE town_id = %(t)s AND kind = %(k)s
                                 ORDER BY checked_at DESC, id DESC LIMIT 1),
                               (SELECT id FROM restriction_checks WHERE town_id = %(t)s AND kind = %(k)s
                                 ORDER BY checked_at DESC, id DESC LIMIT 1),
                               min(r.checked_at), bool_or(r.alert_sent_at IS NOT NULL), max(r.error)
                          FROM restriction_checks r, last_good
                         WHERE r.town_id = %(t)s AND r.kind = %(k)s AND r.state = 'unknown'
                           AND (last_good.at IS NULL OR r.checked_at > last_good.at)
                        """,
                        {"t": self.town_id, "k": page["kind"]},
                    )
                    newest_state, newest_id, streak_start, alerted, error = cur.fetchone()
                if not should_alert(newest_state, streak_start, alerted, now):
                    continue
                hours = int((now - streak_start).total_seconds() // 3600)
                msg = (f"{self.town_id} {page['kind']} restrictions: status unknown for {hours} h "
                       f"(since {streak_start.isoformat(timespec='minutes')}). Last error: {error or 'n/a'}. Source: {page['url']}")
                if self.send_alert(msg, title=f"{self.town_id}: {page['kind']} restrictions unknown > 72 h", priority="high"):
                    with conn.cursor() as cur:
                        cur.execute("UPDATE restriction_checks SET alert_sent_at = %s WHERE id = %s", (now, newest_id))
        except Exception as exc:  # noqa: BLE001
            print(f"  [restrictions] 72 h-larmkontrollen misslyckades: {type(exc).__name__}: {exc}")


def should_alert(newest_state: str | None, streak_start: datetime | None, already_alerted: bool | None, now: datetime) -> bool:
    """True once per unknown streak: the newest row is 'unknown', the streak is older than 72 h, no row in it has alerted yet."""
    return (newest_state == "unknown" and streak_start is not None and not already_alerted
            and now - streak_start > UNKNOWN_ALERT_AFTER)
