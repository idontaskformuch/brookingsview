"""Capital improvement projects from a city's own CIP list (Fas 5 source 2, owner 2026-11-20; .claude/specs/fas5-source-inventory.md,
"Källa 2"). Broomfield today: https://www.broomfield.org/3763/Current-Capital-Improvement-Projects plus one page per project.

Writes the existing Story Threads tables (db/migrations/074_capital_projects.sql), no parallel tables:
  projects         one row per project the City lists, source_type = 'cip_page'
  project_updates  one dated row per change between two checks (source_type = 'cip_page', change_kind set): new / relisted /
                   removed project, a Timeline line added / changed / removed, the cost line changed. That is the page's timeline.

Rules (owner 2026-11-20):
- Every request through PoliteFetcher ("source", ViewMediaBot); broomfield.org robots.txt `User-agent: *` Crawl-delay 10 is read and
  kept by the fetcher. Only the list page and the project pages it links to (all under /<number>/, none disallowed). Nothing else.
- At most once a day: the config's run_at_utc_hours ([11]) + refresh_minutes gate in scrapers/runner.py.
- No AI text. Everything stored is the source's words with whitespace collapsed, inside fixed templates. No long description:
  at most ONE short sentence per project (the first sentence under "Project Information", <= 25 words, verbatim; otherwise none).
  The contact block (names, department, e-mail, phone) is never read into anything (owner decision B).
- source_hash is computed on the EXTRACTED content (heading, Project Information, Timeline, Project Cost), not the HTML, so CMS
  tokens and timestamps do not count as a change (owner addition 1). Same hash as last time: the page is not interpreted again;
  only last_checked_at moves.
- First run for a town (no cip_page rows yet) is a baseline: no "new" updates (owner decision A).
- A Timeline line's dates are read only from a fixed grammar ("May - September 2026", "July 2026 - April 2027", "November -
  January 2027" = Nov 2026 to Jan 2027, "TBD", "(Completed)"). Anything else gets no dates at all, never a guess (owner addition 3);
  the line is still stored and shown verbatim.
- A changed page structure never empties anything: a list page that cannot be read (heading changed, no project links, or more
  than half the listed projects gone at once) changes nothing; a project page that cannot be read keeps its last data and its
  last_checked_at. Both count as failures in scrape_runs (docs_failed), and more than 72 h of failures in a row sends ONE ntfy alert
  per streak (after_upsert, scrape_runs.alert_sent_at).

Page shape, seen live 2026-11-20 (list + 3 project pages, session scratchpad; fixtures in tests/fixtures/capital_projects/):
  div#moduleContent > h1 (page heading); list: li/span > a[href="/<page id>/..."] per project. Project page: h1#versionHeadLine,
  then a CivicPlus editor (div.fr-view) with h2/h3 section headings "Project Information", "Timeline", "Project Cost", "Contact Us"
  (sometimes with a trailing ':'); Timeline is a ul of lines "Phase: dates".
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from calendar import monthrange
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from db.db import content_hash
from scrapers.alerts import send_alert
from scrapers.base_parser import BaseParser, FetchResult
from scrapers.polite_fetch import MAX_BYTES, PoliteFetcher, Refused
from scrapers.user_agent import user_agent

SOURCE_TYPE = "cip_page"
FAILURE_ALERT_AFTER = timedelta(hours=72)
MAX_SUMMARY_WORDS = 25
# The version prefixes the stored source_hash. A stored hash without the current prefix was made by an older extractor/parser: the
# project is re-read as its own baseline (no change rows), because the difference is ours, not the City's (v2 2026-11-20: 112th's
# sub-task bullets dropped, "- completed." and a closing period read).
HASH_VERSION = "cip-extract-v2"

# Fixed templates for project_updates.body (the only text of ours; the quoted parts are the source's words).
BODY_NEW = "Added to the City's list of current capital improvement projects."
BODY_RELISTED = "Back on the City's list of current capital improvement projects."
BODY_REMOVED = "No longer on the City's list of current capital improvement projects."

_INFO_KEYS = ("project information",)
_TIMELINE_KEYS = ("timeline",)
_COST_KEYS = ("project cost",)
_HEADING_TAGS = ("h2", "h3", "h4", "h5")

_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}
_MONTHS.update({k[:3]: v for k, v in list(_MONTHS.items())})
_MONTHS["sept"] = 9
_MONTH_RE = r"(" + "|".join(sorted(_MONTHS, key=len, reverse=True)) + r")\.?"
_POINT = _MONTH_RE + r"(?:\s+(\d{1,2})(?:st|nd|rd|th)?,?)?(?:\s+(\d{4}))?"
_RANGE = re.compile(r"^" + _POINT + r"\s*-\s*" + _POINT + r"$", re.I)
_SINGLE = re.compile(r"^" + _POINT + r"$", re.I)
# "(Completed)" (Varra Park) or "- completed." (Airport Creek, owner 2026-11-20 b) at the end of the line.
_COMPLETED = re.compile(r"\s*(?:\((?:completed?)\)|-\s*completed?)\.?\s*$", re.I)
_LABEL_COLON = re.compile(r":(?!\d)")  # "Winter 2026: The ...", not the "6:30" in "5-6:30 pm" (Police meeting line)
_TBD = re.compile(r"^(tbd|tba|to be determined)\.?$", re.I)
_PAGE_ID = re.compile(r"^/(\d+)/")
# Abbreviations that end with a period but do not end a sentence (street names, "i.e.").
_ABBREV = re.compile(r"(?:\b(?:St|Ave|Dr|Blvd|Rd|Ln|Ct|Pkwy|Hwy|Mt|No|Inc|Co|E|W|N|S|i\.e|e\.g|U\.S|approx|ft|sq)\.)$", re.I)


class Unrecognised(Exception):
    """The page answered but does not have the structure this parser checks for."""


def _clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").replace(" ", " ")).strip()


def _heading_key(text: str) -> str:
    return _clean(text).rstrip(":").strip().lower()


# --- list page --------------------------------------------------------------------------------------------------------------------
@dataclass
class Listed:
    page_id: int
    title: str
    url: str


def page_id_of(url: str) -> int | None:
    m = _PAGE_ID.match(urlparse(url).path)
    return int(m.group(1)) if m else None


def parse_list(html: bytes | str, list_url: str, heading: str) -> list[Listed]:
    """Every project the list page links to, in page order. Raises Unrecognised."""
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find(id="moduleContent")
    if main is None:
        raise Unrecognised("div#moduleContent not found on the list page")
    h1 = main.find("h1")
    if _clean(h1.get_text() if h1 else "") != heading:
        raise Unrecognised(f"list heading is not {heading!r}")
    host = urlparse(list_url).netloc.lower().removeprefix("www.")
    own_id = page_id_of(list_url)
    seen: dict[int, Listed] = {}
    for a in main.find_all("a", href=True):
        url = urljoin(list_url, a["href"])
        parts = urlparse(url)
        if parts.netloc.lower().removeprefix("www.") != host:
            continue
        pid = page_id_of(url)
        title = _clean(a.get_text())
        if pid is None or pid == own_id or not title or pid in seen:
            continue
        seen[pid] = Listed(pid, title, url)
    if not seen:
        raise Unrecognised("no project links on the list page")
    return list(seen.values())


# --- project page ---------------------------------------------------------------------------------------------------------------
def _is_nested(el, main) -> bool:
    for parent in el.parents:
        if parent is main:
            return False
        if parent.name in ("p", "li"):
            return True
    return False


def _is_label_paragraph(el) -> bool:
    """<p><strong>Timeline:</strong></p> used as a heading."""
    if el.name != "p":
        return False
    strong = el.find(["strong", "b"])
    return strong is not None and _clean(strong.get_text()) == _clean(el.get_text()) and _clean(el.get_text()).endswith(":")


def extract_page(html: bytes | str) -> dict:
    """{title, info, timeline, cost}: the parts the hash and the page use, verbatim (whitespace collapsed). The contact block and
    every section not named here are dropped. Raises Unrecognised."""
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find(id="moduleContent")
    if main is None:
        raise Unrecognised("div#moduleContent not found")
    h1 = main.find("h1", id="versionHeadLine") or main.find("h1")
    title = _clean(h1.get_text() if h1 else "")
    if not title:
        raise Unrecognised("no page heading (h1)")
    sections: dict[str, list[tuple[str, str]]] = {}
    current: str | None = None
    for el in main.find_all(list(_HEADING_TAGS) + ["p", "li"]):
        if el.name in ("p", "li") and _is_nested(el, main):
            continue
        text = _clean(el.get_text(""))
        if not text:
            continue
        if el.name in _HEADING_TAGS or _is_label_paragraph(el):
            current = _heading_key(text)
            continue
        if current is not None:
            sections.setdefault(current, []).append((el.name, text))

    def blocks(keys: tuple[str, ...]) -> list[tuple[str, str]]:
        return next((sections[k] for k in keys if k in sections), [])

    timeline_blocks = blocks(_TIMELINE_KEYS)
    # Owner 2026-11-20 (a): bullet lines with neither a date nor a "label: when" colon are not Timeline lines. 112th & Uptown lists
    # its phases as paragraphs ("Phase 3 - Misc. Closeout Tasks: May thru July 2026.") with sub-task bullets under each ("Paving Pt.
    # 1"): the phases are kept, the bullets dropped. Bullets with a colon (Varra, Birch, Airport Creek) stay the Timeline as before,
    # without the captions and repeats in paragraphs next to them. A section with no colon line at all keeps every line (Police).
    li_lines = [t for tag, t in timeline_blocks if tag == "li"]
    lines = ([t for t in li_lines if _LABEL_COLON.search(t)] or [t for _, t in timeline_blocks if _LABEL_COLON.search(t)]
             or li_lines or [t for _, t in timeline_blocks])
    return {
        "title": title,
        "info": [t for _, t in blocks(_INFO_KEYS)],
        "timeline": lines,
        "cost": [t for _, t in blocks(_COST_KEYS)],
    }


def extracted_hash(extracted: dict) -> str:
    """Hash of the extracted content only (owner addition 1): heading, Project Information, Timeline, Project Cost."""
    return f"{HASH_VERSION}:" + content_hash(HASH_VERSION, extracted["title"], json.dumps(extracted["info"]),
                                              json.dumps(extracted["timeline"]), json.dumps(extracted["cost"]))


def sentences(text: str) -> list[str]:
    out, start = [], 0
    for m in re.finditer(r"[.!?](?=\s+[A-Z0-9\"“(]|\s*$)", text):
        candidate = text[start:m.end()].strip()
        if _ABBREV.search(candidate):
            continue
        out.append(candidate)
        start = m.end()
    rest = text[start:].strip()
    if rest:
        out.append(rest)
    return out


def summary_sentence(info: list[str]) -> str | None:
    """The first sentence under "Project Information", verbatim, when it has at most 25 words; otherwise none."""
    if not info:
        return None
    first = (sentences(info[0]) or [None])[0]
    if not first or len(first.split()) > MAX_SUMMARY_WORDS:
        return None
    return first


def cost_sentence(cost: list[str]) -> str | None:
    """The first sentence with a $ amount under "Project Cost", verbatim; otherwise none."""
    for block in cost:
        for s in sentences(block):
            if re.search(r"\$\s?\d", s):
                return s
    return None


# --- timeline lines ---------------------------------------------------------------------------------------------------------------
def _point(month: str, day: str | None, year: str | None):
    return _MONTHS[month.lower().rstrip(".")], (int(day) if day else None), (int(year) if year else None)


def _first_day(y: int, m: int, d: int | None) -> date:
    return date(y, m, d or 1)


def _last_day(y: int, m: int, d: int | None) -> date:
    return date(y, m, d or monthrange(y, m)[1])


def parse_dates(text: str) -> tuple[date, date] | None:
    """(start, end) from the fixed grammar, or None. Never a guess: a range needs its end year; a start without a year takes the end's
    year, or the year before when its month comes after the end month ("November - January 2027" = 2026-11-01 .. 2027-01-31).
    A single point needs its year. Seasons ("Summer 2026"), quarters and prose give None."""
    t = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", _clean(text))  # "June2026" -> "June 2026" (seen live, Varra Park)
    t = re.sub(r"\s*[–—]\s*", " - ", t)
    try:
        m = _RANGE.match(t)
        if m:
            sm, sd, sy = _point(m.group(1), m.group(2), m.group(3))
            em, ed, ey = _point(m.group(4), m.group(5), m.group(6))
            if ey is None:
                return None
            if sy is None:
                sy = ey if (sm, sd or 0) <= (em, ed or 99) else ey - 1
            start, end = _first_day(sy, sm, sd), _last_day(ey, em, ed)
            return (start, end) if start <= end else None
        m = _SINGLE.match(t)
        if m:
            mo, d, y = _point(m.group(1), m.group(2), m.group(3))
            if y is None:
                return None
            return _first_day(y, mo, d), _last_day(y, mo, d)
    except ValueError:  # a day that does not exist in that month
        return None
    return None


def parse_timeline_line(text: str) -> dict:
    """{text, label, start, end, completed, tbd}. text is the line verbatim; the rest is what can be read without guessing."""
    line = _clean(text)
    out = {"text": line, "label": None, "start": None, "end": None, "completed": False, "tbd": False}
    if ":" not in line:
        return out
    label, rest = line.split(":", 1)
    label, rest = label.strip(), rest.strip()
    if not label or not rest:
        return out
    completed = bool(_COMPLETED.search(rest))
    rest_bare = _COMPLETED.sub("", rest).strip()
    rest_bare = re.sub(r"\.$", "", rest_bare).strip()  # owner 2026-11-20 (c): "April 2026." reads as "April 2026"
    if _TBD.match(rest_bare):
        out.update(label=label, tbd=True, completed=completed)
        return out
    dates = parse_dates(rest_bare)
    if dates is None:
        out["completed"] = completed  # what the City marked, also when the date is a year or season we do not read ("2022 - completed.")
        return out
    out.update(label=label, start=dates[0].isoformat(), end=dates[1].isoformat(), completed=completed)
    return out


# Owner 2026-11-20 (before push): a free-text line (no phase dates read, not TBD) that names a specific day is not kept: a one-off
# meeting date ("Wednesday, May 6th from 5-6:30 pm ...") goes stale and is not a phase. Lines with only a season, month or year
# ("Winter 2026: ...", "... start in Summer 2026 ...") stay. Matches "May 6", "May 6th", "Sept. 14", "6 May", "5/6/2026".
_MONTH_NAMES = r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)"
_SPECIFIC_DAY = re.compile(
    r"\b" + _MONTH_NAMES + r"\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?!\d)"
    r"|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?" + _MONTH_NAMES + r"\b"
    r"|\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b")


def names_specific_day(line: dict) -> bool:
    """True for a free-text Timeline line (no dates read, not TBD) that mentions a specific day."""
    return line["start"] is None and not line["tbd"] and bool(_SPECIFIC_DAY.search(line["text"]))


def visible_timeline(texts: list[str]) -> list[dict]:
    """The Timeline lines we store and show: every line parsed, minus free-text lines that name a specific day."""
    return [line for line in (parse_timeline_line(t) for t in texts) if not names_specific_day(line)]


# --- the change plan (pure; the DB layer below only applies it) -----------------------------------------------------------------
@dataclass
class Stored:
    id: int
    page_id: int
    slug: str
    title: str
    source_hash: str | None
    timeline: list | None
    cost_text: str | None
    delisted_at: datetime | None


@dataclass
class PageResult:
    extracted: dict | None = None
    error: str | None = None


@dataclass
class Plan:
    upserts: list[dict] = field(default_factory=list)      # one per listed project
    updates: list[dict] = field(default_factory=list)      # {page_id, change_kind, body}
    delist: list[int] = field(default_factory=list)        # page ids that left the list
    reparsed: int = 0                                      # pages interpreted (hash changed or first read)


def _timeline_key_map(timeline: list[dict]) -> dict[str, str]:
    out, counts = {}, {}
    for row in timeline:
        base = (row.get("label") or row["text"]).lower()
        counts[base] = counts.get(base, 0) + 1
        out[f"{base}#{counts[base]}"] = row["text"]
    return out


def timeline_changes(old: list[dict], new: list[dict]) -> list[tuple[str, str]]:
    """(change_kind, body) per Timeline line added / changed / removed, matched on the phase label (the whole line when it has none)."""
    a, b = _timeline_key_map(old), _timeline_key_map(new)
    out = []
    for key, text in b.items():
        if key not in a:
            out.append(("phase_added", f'Timeline line added: "{text}"'))
        elif a[key] != text:
            out.append(("phase_changed", f'Timeline line changed from "{a[key]}" to "{text}"'))
    for key, text in a.items():
        if key not in b:
            out.append(("phase_removed", f'Timeline line removed: "{text}"'))
    return out


def cost_change(old: str | None, new: str | None) -> tuple[str, str] | None:
    if old == new:
        return None
    if old is None:
        return ("cost_changed", f'Cost line added: "{new}"')
    if new is None:
        return ("cost_changed", f'Cost line removed: "{old}"')
    return ("cost_changed", f'Cost line changed from "{old}" to "{new}"')


def slugify(title: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", title.lower().replace("&", " and "))).strip("-")


def plan_changes(stored: dict[int, Stored], listed: list[Listed], pages: dict[int, PageResult], taken_slugs: set[str]) -> Plan:
    """What to write, from the stored rows, this run's list and project pages. Raises Unrecognised when more than half of the projects
    still listed last time are gone at once (a broken list, not a real change): nothing is written then."""
    active = [s for s in stored.values() if s.delisted_at is None]
    listed_ids = {item.page_id for item in listed}
    removed = [s for s in active if s.page_id not in listed_ids]
    if active and len(removed) > max(3, len(active) // 2):
        raise Unrecognised(f"the list lost {len(removed)} of {len(active)} projects at once")
    baseline = not stored
    plan = Plan()
    slugs = set(taken_slugs)
    for item in listed:
        st = stored.get(item.page_id)
        page = pages.get(item.page_id) or PageResult(error="not read")
        row = {"page_id": item.page_id, "id": st.id if st else None, "title": item.title, "url": item.url, "checked": False}
        if st is None:
            slug = slugify(item.title) or f"project-{item.page_id}"
            if slug in slugs:
                slug = f"{slug}-{item.page_id}"
            slugs.add(slug)
            row["slug"] = slug
            if not baseline:
                plan.updates.append({"page_id": item.page_id, "change_kind": "new", "body": BODY_NEW})
        else:
            row["slug"] = st.slug
            if st.delisted_at is not None:
                plan.updates.append({"page_id": item.page_id, "change_kind": "relisted", "body": BODY_RELISTED})
        if page.extracted is not None:
            row["checked"] = True
            h = extracted_hash(page.extracted)
            if st is not None and st.source_hash == h:
                row["unchanged"] = True
            else:
                plan.reparsed += 1
                timeline = visible_timeline(page.extracted["timeline"])
                cost = cost_sentence(page.extracted["cost"])
                row.update(unchanged=False, source_hash=h, timeline=timeline, cost_text=cost,
                           description=summary_sentence(page.extracted["info"]) or "")
                # Changes only against a timeline we read before with this HASH_VERSION; the first successful read of a project, and
                # the first read after a parser change, is its own baseline (a real City change on that same day is not dated then).
                if st is not None and st.timeline is not None and (st.source_hash or "").startswith(f"{HASH_VERSION}:"):
                    for kind, body in timeline_changes(st.timeline, timeline):
                        plan.updates.append({"page_id": item.page_id, "change_kind": kind, "body": body})
                    change = cost_change(st.cost_text, cost)
                    if change:
                        plan.updates.append({"page_id": item.page_id, "change_kind": change[0], "body": change[1]})
        plan.upserts.append(row)
    for s in removed:
        plan.delist.append(s.page_id)
        plan.updates.append({"page_id": s.page_id, "change_kind": "removed", "body": BODY_REMOVED})
    return plan


def failure_streak_alert(rows: list[dict], current_failed: bool, now: datetime) -> bool:
    """rows: this source's scrape_runs, newest first, the current (still running) run first. True once per streak: the current run
    failed, the failures in a row go back more than 72 h, and no run in the streak has sent the alert yet. 'skipped'/'stub' rows
    are not runs; a run failed when its status is error/degraded or it had docs_failed > 0."""
    if not current_failed or not rows:
        return False
    streak_start, alerted = rows[0]["started_at"], bool(rows[0].get("alert_sent_at"))
    for row in rows[1:]:
        if row["status"] in ("skipped", "stub", "running"):
            continue
        if not (row["status"] in ("error", "degraded") or (row.get("docs_failed") or 0) > 0):
            break
        streak_start = row["started_at"]
        alerted = alerted or bool(row.get("alert_sent_at"))
    return not alerted and now - streak_start > FAILURE_ALERT_AFTER


# --- the parser -------------------------------------------------------------------------------------------------------------------
class CapitalProjectsParser(BaseParser):
    table = "projects"  # parse() returns no rows: after_upsert() writes projects/project_updates from the plan
    platform = "civicplus_cip_pages"

    def __init__(self, cfg: dict, source_cfg: dict):
        super().__init__(cfg, source_cfg)
        self.list_url = source_cfg.get("list_url")
        self.list_heading = source_cfg.get("list_heading")
        if not self.list_url or not self.list_heading:
            raise ValueError("capital_projects config needs list_url and list_heading")
        self.fetcher: PoliteFetcher | None = None  # tests inject one with a fake session
        self.now = lambda: datetime.now(timezone.utc)
        self.send_alert = send_alert  # tests inject a recorder
        self.listed: list[Listed] | None = None
        self.pages: dict[int, PageResult] = {}
        self.list_error: str | None = None
        self.failures: list[str] = []

    def _fetcher(self) -> PoliteFetcher:
        if self.fetcher is None:
            self.fetcher = PoliteFetcher("source", self.town_id, ua=user_agent(self.town_id))
        return self.fetcher

    def _get(self, url: str) -> tuple[bytes | None, str | None]:
        got = self._fetcher().get(url)
        if isinstance(got, Refused):
            return None, f"refused: {got.reason}"
        if got.status != 200:
            return None, f"answered {got.status if got.status else 'nothing (no answer)'}"
        if got.cut:
            return None, f"reached the {MAX_BYTES} byte size cap, not parsed"
        return got.body, None

    def fetch(self) -> FetchResult:
        """List page, then every project page it links to (each once). Reading and extracting happen here so a page whose structure
        changed counts in docs_failed; nothing raises for a page problem (module docstring)."""
        self.listed, self.pages, self.list_error, self.failures = None, {}, None, []
        body, error = self._get(self.list_url)
        if body is not None:
            try:
                self.listed = parse_list(body, self.list_url, self.list_heading)
            except Unrecognised as exc:
                error = f"list page structure changed: {exc}"
            except Exception as exc:  # noqa: BLE001
                error = f"list page could not be parsed: {type(exc).__name__}: {exc}"
        if self.listed is None:
            self.list_error = error
            self.failures.append(f"list: {error}")
        for item in self.listed or []:
            page_body, page_error = self._get(item.url)
            result = PageResult(error=page_error)
            if page_body is not None:
                try:
                    result.extracted = extract_page(page_body)
                except Unrecognised as exc:
                    result.error = f"page structure changed: {exc}"
                except Exception as exc:  # noqa: BLE001
                    result.error = f"page could not be parsed: {type(exc).__name__}: {exc}"
            if result.error:
                self.failures.append(f"{item.page_id}: {result.error}")
            self.pages[item.page_id] = result
        summary = {"list_url": self.list_url, "list_error": self.list_error, "listed": len(self.listed or []),
                   "failed": self.failures[:20]}
        return FetchResult(raw=json.dumps(summary).encode(), content_type="application/json", url=self.list_url, http_code=200,
                           docs_attempted=1 + len(self.listed or []), docs_failed=len(self.failures),
                           docs_last_error=self.failures[-1] if self.failures else None)

    def parse(self, fetched: FetchResult) -> list[dict]:
        return []

    # --- DB ---------------------------------------------------------------------------------------------------------------------
    def _load(self, conn) -> tuple[dict[int, Stored], set[str]]:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, slug, title, source_url, source_hash, timeline, cost_text, delisted_at
                     FROM projects WHERE town_id = %s AND source_type = %s""", (self.town_id, SOURCE_TYPE))
            rows = cur.fetchall()
            cur.execute("SELECT slug FROM projects WHERE town_id = %s", (self.town_id,))
            slugs = {r[0] for r in cur.fetchall()}
        stored = {}
        for rid, slug, title, url, h, timeline, cost, delisted in rows:
            pid = page_id_of(url or "")
            if pid is not None:
                stored[pid] = Stored(rid, pid, slug, title, h, timeline, cost, delisted)
        return stored, slugs

    def _apply(self, conn, plan: Plan, stored: dict[int, Stored], now: datetime) -> None:
        ids: dict[int, int] = {pid: s.id for pid, s in stored.items()}
        with conn.cursor() as cur:
            for row in plan.upserts:
                if row["id"] is None:
                    cur.execute(
                        """INSERT INTO projects (town_id, slug, title, description, status, source_type, source_url, source_hash,
                                                 timeline, cost_text, last_checked_at, updated_at)
                           VALUES (%s, %s, %s, %s, 'listed', %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                        (self.town_id, row["slug"], row["title"], row.get("description", ""), SOURCE_TYPE, row["url"],
                         row.get("source_hash"), json.dumps(row["timeline"]) if "timeline" in row else None,
                         row.get("cost_text"), now if row["checked"] else None, now))
                    ids[row["page_id"]] = cur.fetchone()[0]
                    continue
                sets = ["title = %s", "source_url = %s", "status = 'listed'", "delisted_at = NULL"]
                args: list = [row["title"], row["url"]]
                if row["checked"]:
                    sets.append("last_checked_at = %s")
                    args.append(now)
                if row["checked"] and not row.get("unchanged"):
                    sets += ["source_hash = %s", "timeline = %s", "cost_text = %s", "description = %s", "updated_at = %s"]
                    args += [row["source_hash"], json.dumps(row["timeline"]), row["cost_text"], row["description"], now]
                cur.execute(f"UPDATE projects SET {', '.join(sets)} WHERE id = %s", (*args, row["id"]))
            for pid in plan.delist:
                cur.execute("UPDATE projects SET status = 'delisted', delisted_at = %s, updated_at = %s WHERE id = %s",
                            (now, now, ids[pid]))
            for upd in plan.updates:
                url = next((r["url"] for r in plan.upserts if r["page_id"] == upd["page_id"]), None) or self.list_url
                cur.execute(
                    """INSERT INTO project_updates (project_id, source_type, change_kind, body, entry_date, source_url, outcome)
                       VALUES (%s, %s, %s, %s, %s, %s, 'pending')""",
                    (ids[upd["page_id"]], SOURCE_TYPE, upd["change_kind"], upd["body"], now, url))

    def after_upsert(self, conn) -> None:
        """Applies the change plan (one savepoint: all or nothing), then the 72 h failure alert. A list that could not be read changes
        nothing. Raises only for a DB problem (e.g. migration 074 not applied), which the runner records as a failed run."""
        now = self.now()
        if self.listed is not None:
            stored, slugs = self._load(conn)
            try:
                plan = plan_changes(stored, self.listed, self.pages, slugs)
            except Unrecognised as exc:
                self.failures.append(f"list: {exc}")
                plan = None
                print(f"  [capital_projects] VARNING: {exc} -- inget skrivet, senaste giltiga data behålls")
            if plan is not None:
                with conn.transaction():
                    self._apply(conn, plan, stored, now)
                print(f"  [capital_projects] {len(plan.upserts)} listade, {plan.reparsed} tolkade, {len(plan.updates)} ändringar, "
                      f"{len(plan.delist)} borttagna")
        else:
            print(f"  [capital_projects] VARNING: listsidan kunde inte läsas ({self.list_error}) -- inget ändrat")
        for failure in self.failures:
            print(f"  [capital_projects] VARNING: {failure}")
        self._maybe_alert(conn, now)

    def _maybe_alert(self, conn, now: datetime) -> None:
        try:
            with conn.transaction(), conn.cursor() as cur:  # savepoint: a failed query here must not abort the run's transaction
                cur.execute(
                    """SELECT id, status, docs_failed, started_at, alert_sent_at FROM scrape_runs
                        WHERE town_id = %s AND source_key = %s ORDER BY id DESC LIMIT 200""",
                    (self.town_id, self.source_key))
                rows = [{"id": r[0], "status": r[1], "docs_failed": r[2], "started_at": r[3], "alert_sent_at": r[4]}
                        for r in cur.fetchall()]
            if not failure_streak_alert(rows, bool(self.failures), now):
                return
            msg = (f"{self.town_id} capital projects: reading has failed for more than 72 h. Last problem: {self.failures[-1]}. "
                   f"Source: {self.list_url}")
            if self.send_alert(msg, title=f"{self.town_id}: capital projects failing > 72 h", priority="high"):
                with conn.transaction(), conn.cursor() as cur:
                    cur.execute("UPDATE scrape_runs SET alert_sent_at = %s WHERE id = %s", (now, rows[0]["id"]))
        except Exception as exc:  # noqa: BLE001 -- an alert problem must not fail the run
            print(f"  [capital_projects] 72 h-larmkontrollen misslyckades: {type(exc).__name__}: {exc}")
