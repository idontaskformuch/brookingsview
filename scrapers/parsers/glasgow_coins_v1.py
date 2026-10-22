"""Glasgow City Council meetings via the council's public CoInS site
(onlineservices.glasgow.gov.uk/councillorsandcommittees, Northgate Public
Services, classic ASP, iso-8859-1/cp1252).

Verified 2026-10-22: no robots.txt (404), no ToS beyond the footer copyright
line, no login, no bot challenge on this host (www.glasgow.gov.uk IS behind a
Cloudflare challenge and is never touched here). Public committee data.

TWO PAGE TYPES ARE USED:
    latestMeetings.asp?sort=1&page=N
        -> table.resultsNew: committee (bodyid in the link), date dd/mm/yyyy,
           start time HH:MM (Europe/London wall clock), "Agenda Published"
           date, location. The date cell is a link to Agenda.asp?meetingid=N
           only once an agenda is published. Pages run until a page has no
           rows (5 pages / ~49 meetings on 2026-10-22). Covers every body
           incl. the 18 Area Partnerships and the Licensing Board.
    Agenda.asp?meetingid=N
        -> table.agendaItems: item number + title (report title, which names
           the responsible convener) + a "View Papers" link. Rows without a
           number are convener group headings. Only titles are read: the
           papers themselves are PDFs and are not fetched.

The meeting_date is the local wall clock converted to UTC (tz from the town
config), same as the other meetings parsers. IDENTITY is CoInS's own meetingid
(raw_data["id"] = "coins-<meetingid>"). Verified 2026-10-22: that id exists
ONLY once an agenda is published (list rows, the calendar and committee.asp
show no id for unscheduled meetings), so until then the row is keyed
"pending-<bodyid>-<local date>" and, when the meetingid appears, the same row
is found through raw_data["identity_aliases"] (db.upsert_records) and
re-keyed -- no duplicate. A meeting with an id that is moved to another date
stays one row; a pending one that is moved shows up as a new pending row.

exclude_bodies (source config) drops whole bodies before anything is stored, e.g.
the Personnel Appeals Committee (employment dismissal appeals).

Politeness: 2 s between requests, at most MAX_AGENDA_FETCHES agenda pages and
MAX_LIST_PAGES list pages per run, one run per day (refresh_minutes 1440).
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult
from scrapers.user_agent import user_agent

BASE_URL = "https://onlineservices.glasgow.gov.uk/councillorsandcommittees/"
MAX_LIST_PAGES = 10
MAX_AGENDA_FETCHES = 30
REQUEST_DELAY_SECONDS = 2.0
MAX_AGENDA_TEXT_CHARS = 20_000

_DATE_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")
_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")
_BODY_ID_RE = re.compile(r"bodyid=(\d+)")
_MEETING_ID_RE = re.compile(r"meetingid=(\d+)")


def _text(cell) -> str:
    return re.sub(r"\s+", " ", cell.get_text(" ", strip=True).replace("\xa0", " ")).strip()


def _local_to_utc(date_s: str, time_s: str, tz: str) -> datetime | None:
    d, t = _DATE_RE.match(date_s), _TIME_RE.match(time_s)
    if not d or not t:
        return None
    try:
        local = datetime(int(d[3]), int(d[2]), int(d[1]), int(t[1]), int(t[2]), tzinfo=ZoneInfo(tz))
    except ValueError:
        return None
    return local.astimezone(timezone.utc)


def parse_meeting_list(html: str, tz: str = "Europe/London") -> list[dict]:
    """Rows of table.resultsNew -> one dict per meeting. A row without a
    committee link, a valid date and a valid time is skipped, never guessed."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", class_="resultsNew")
    out: list[dict] = []
    if not table:
        return out
    for tr in table.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 5:
            continue
        body_a = cells[0].find("a", href=_BODY_ID_RE)
        if not body_a:
            continue
        date_s, time_s = _text(cells[1]), _text(cells[2])
        when = _local_to_utc(date_s, time_s, tz)
        if when is None:
            continue
        agenda_a = cells[1].find("a", href=_MEETING_ID_RE)
        agenda_href = agenda_a["href"] if agenda_a else None
        body_id = _BODY_ID_RE.search(body_a["href"])[1]
        meeting_id = _MEETING_ID_RE.search(agenda_href)[1] if agenda_href else None
        pending_id = f"pending-{body_id}-{when.astimezone(ZoneInfo(tz)).strftime('%Y%m%d')}"
        out.append({
            "id": f"coins-{meeting_id}" if meeting_id else pending_id,
            "identity_aliases": [pending_id] if meeting_id else [],
            "body_id": body_id,
            "board": _text(body_a),
            "local_date": date_s,
            "local_time": time_s,
            "schedule_iso": when.isoformat(),
            "agenda_published": _text(cells[3]) or None,
            "location": _text(cells[4]) or None,
            "meeting_id": meeting_id,
            "agenda_url": urljoin(BASE_URL, agenda_href) if agenda_href else None,
            "committee_url": urljoin(BASE_URL, body_a["href"].split("&bodytitle=")[0]),
        })
    return out


def parse_agenda(html: str) -> list[dict]:
    """table.agendaItems -> [{item_number, agenda_group, title, papers_url}].
    A one-cell row is a convener heading and becomes the agenda_group of the
    numbered rows after it."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", class_="agendaItems")
    items: list[dict] = []
    if not table:
        return items
    group = None
    for tr in table.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) == 1:
            group = _text(cells[0]).rstrip(".") or None
            continue
        if len(cells) != 2:
            continue
        number = _text(cells[0])
        papers = cells[1].find("a", href=re.compile(r"submissiondocuments", re.I))
        papers_url = urljoin(BASE_URL, papers["href"]) if papers else None
        if papers:
            papers.extract()
        title = _text(cells[1])
        if not title:
            continue
        items.append({"item_number": number or None, "agenda_group": group,
                      "title": title, "papers_url": papers_url})
    return items


def items_to_text(items: list[dict]) -> str:
    lines = []
    for it in items:
        num = f"{it['item_number']}. " if it.get("item_number") else ""
        group = f"[{it['agenda_group']}] " if it.get("agenda_group") else ""
        lines.append(f"{num}{group}{it['title']}")
    return "\n".join(lines)


class GlasgowCoinsParser(BaseParser):
    table = "meetings"
    platform = "coins"
    conflict_columns = ("town_id", "content_hash")
    update_columns = ["body", "meeting_date", "agenda_url", "raw_data", "snapshot_id"]
    merge_raw_data = True
    identity_key = "id"

    def _tz(self) -> str:
        return self.cfg.get("timezone") or "Europe/London"

    def _get(self, session: requests.Session, path: str) -> requests.Response:
        r = session.get(urljoin(BASE_URL, path), timeout=30)
        r.encoding = "cp1252"
        return r

    def fetch(self) -> FetchResult:
        session = requests.Session()
        session.headers["User-Agent"] = user_agent(self.town_id)
        meetings: list[dict] = []
        seen: set[tuple[str, str]] = set()
        last = None
        for page in range(1, MAX_LIST_PAGES + 1):
            if page > 1:
                time.sleep(REQUEST_DELAY_SECONDS)
            last = self._get(session, f"latestMeetings.asp?sort=1&page={page}")
            if last.status_code != 200:
                break
            rows = [m for m in parse_meeting_list(last.text, self._tz())
                    if (m["id"], m["schedule_iso"]) not in seen]
            if not rows:
                break
            seen.update((m["id"], m["schedule_iso"]) for m in rows)
            meetings.extend(rows)

        attempted = failed = 0
        last_error = None
        for m in meetings:
            if not m["meeting_id"]:
                continue
            if attempted >= MAX_AGENDA_FETCHES:
                break
            time.sleep(REQUEST_DELAY_SECONDS)
            attempted += 1
            try:
                r = self._get(session, f"Agenda.asp?meetingid={m['meeting_id']}")
                if r.status_code != 200:
                    raise RuntimeError(f"HTTP {r.status_code}")
                m["_items"] = parse_agenda(r.text)
            except Exception as e:  # noqa: BLE001 -- one agenda must not sink the list
                failed += 1
                last_error = f"{type(e).__name__}: {e}"

        self._meetings = meetings
        return FetchResult(
            raw=json.dumps(meetings, ensure_ascii=False).encode("utf-8"),
            content_type="application/json",
            url=urljoin(BASE_URL, "latestMeetings.asp?sort=1"),
            http_code=last.status_code if last is not None else None,
            docs_attempted=attempted, docs_failed=failed, docs_last_error=last_error,
        )

    def parse(self, fetched: FetchResult) -> list[dict]:
        meetings = getattr(self, "_meetings", None)
        if meetings is None:
            meetings = json.loads(fetched.raw.decode("utf-8"))
        excluded = {b.casefold() for b in self.source_cfg.get("exclude_bodies", [])}
        out = []
        for m in meetings:
            items = m.pop("_items", None)
            if m["board"].casefold() in excluded:
                continue
            raw_data = dict(m)
            if items:
                raw_data["agenda_items"] = items
                text = items_to_text(items)
                if text:
                    raw_data["agenda_text"] = text[:MAX_AGENDA_TEXT_CHARS]
            out.append({
                "body": m["board"],
                "meeting_date": datetime.fromisoformat(m["schedule_iso"]),
                "agenda_url": m["agenda_url"] or m["committee_url"],
                "minutes_url": None,
                "raw_data": raw_data,
                "content_hash": content_hash("coins", m["id"], m["schedule_iso"]),
            })
        return out
