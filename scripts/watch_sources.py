"""Daily source watch (owner order 2026-11-26 (13)): is a page we depend on still saying what we built on?

configs/shared/source_watch.json lists the pages (URL + what to watch on each, as `rules`). Once a day (.github/workflows/source-watch.yml)
every page is read ONCE through PoliteFetcher (ViewMediaBot, robots.txt, the one-request-a-day rule of purpose "evidence") and each rule is
checked against its text:

  present    the text must still be on the page          (finding when it is gone: the city changed its wording)
  absent     the text must not be on the page            (finding when it appears)
  unchanged  the page text between `from` and `to` must equal the committed baseline (finding when it differs, with what was added and removed)

A rule that no longer holds is ONE finding per watch, which becomes ONE GitHub issue (qa/report.py, check ops.source-changed; GitHub's own mail
is the alert). Nothing is published, switched on or written by this job; the owner decides. A page that cannot be read (no answer, 403, robots
disallow) says nothing about its text: printed, no finding, an open issue neither grows nor closes on it.

Generic on purpose: the /help/ freshness check is a rule kind here (help_freshness, below), not a second job. Unlike the page rules
it writes: the /help/ rows of its town in the DB (verified / rewritten / hidden), once a week on the watch's weekday.

    python -m scripts.watch_sources                         # what the workflow runs: read, check, open/comment/close issues
    python -m scripts.watch_sources --dry-run               # read and print the findings; no issue; the DB only read
    python -m scripts.watch_sources --dry-run --help-only --all-towns --from-cache 2026-11-27   # help check from that day's cache
    python -m scripts.watch_sources --write-baseline <id>   # write the baseline file of the watch's `unchanged` rules from the page as it is now
"""
from __future__ import annotations

import argparse
import difflib
import html
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "configs" / "shared" / "source_watch.json"
CHECK_ID = "ops.source-changed"
SHOW_LINES = 6


def page_text(raw: str) -> str:
    """The page's visible text: scripts, styles and page chrome out, tags out, entities decoded, whitespace collapsed (a non-breaking space is a space)."""
    raw = re.sub(r"(?is)<(script|style|noscript|nav|header|footer)\b[^>]*>.*?</\1>", " ", raw)
    text = html.unescape(re.sub(r"(?s)<[^>]+>", " ", raw)).replace(" ", " ")
    return re.sub(r"\s+", " ", text).strip()


def section(text: str, start: str, end: str) -> str | None:
    """The text from `start` up to (not including) `end`, after `start`; None when either marker is missing."""
    i = text.find(start)
    if i < 0:
        return None
    j = text.find(end, i + len(start))
    return None if j < 0 else text[i:j].strip()


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def _present(rule: dict, text: str, base: Path) -> str | None:
    return None if rule["text"] in text else f'the text "{rule["text"]}" is no longer on the page'


def _absent(rule: dict, text: str, base: Path) -> str | None:
    return f'the text "{rule["text"]}" is now on the page' if rule["text"] in text else None


def _unchanged(rule: dict, text: str, base: Path) -> str | None:
    now = section(text, rule["from"], rule["to"])
    path = base / rule["baseline"]
    if not path.exists():
        return f'no baseline at {rule["baseline"]} (python -m scripts.watch_sources --write-baseline <id>)'
    was = path.read_text(encoding="utf-8").strip()
    if now is None:
        return f'the part of the page between "{rule["from"]}" and "{rule["to"]}" cannot be found any more'
    if now == was:
        return None
    a, b = sentences(was), sentences(now)
    removed = [s for s in a if s not in b][:SHOW_LINES]
    added = [s for s in b if s not in a][:SHOW_LINES]
    out = "the text between " + f'"{rule["from"]}" and "{rule["to"]}" changed.'
    if removed:
        out += " Removed: " + " | ".join(removed) + "."
    if added:
        out += " Added: " + " | ".join(added) + "."
    if not removed and not added:
        out += " " + "".join(d for d in difflib.ndiff([was], [now]) if d[0] in "+-")[:300]
    return out


RULES = {"present": _present, "absent": _absent, "unchanged": _unchanged}


def check_watch(watch: dict, text: str, base: Path = ROOT) -> list[str]:
    """What no longer holds on the page, one sentence per rule ([] = all hold). Pure."""
    out: list[str] = []
    for rule in watch["rules"]:
        fn = RULES.get(rule["kind"])
        if fn is None:
            out.append(f'unknown rule kind "{rule["kind"]}" in the config')
            continue
        problem = fn(rule, text, base)
        if problem:
            meaning = f' ({rule["meaning"]})' if rule.get("meaning") else ""
            out.append(problem + meaning)
    return out


def finding(watch: dict, problems: list[str]) -> dict:
    """The one QA finding of a watch (qa/report.py groups by check + town + pattern: one issue per watch)."""
    return {"check": CHECK_ID, "town": watch["town"], "pattern": watch["id"], "path": f'/{watch["town"]}/{watch["id"]}',
            "message": f'{watch["url"]}: ' + " ".join(problems) + (f' Why it matters: {watch["why"]}' if watch.get("why") else "")
                       + " Nothing was changed or published; the owner decides."}


def load(config_path: Path = CONFIG) -> list[dict]:
    return json.loads(config_path.read_text(encoding="utf-8"))["watches"]


def run(watches: list[dict], fetcher_for, base: Path = ROOT) -> tuple[list[dict], list[str]]:
    """(findings, unreadable). `fetcher_for(town)` gives a PoliteFetcher-like object with .get(url)."""
    from scrapers.polite_fetch import Refused
    findings: list[dict] = []
    unreadable: list[str] = []
    for w in watches:
        r = fetcher_for(w["town"]).get(w["url"])
        if isinstance(r, Refused) or r.status != 200:
            unreadable.append(f'{w["id"]}: ' + (r.reason if isinstance(r, Refused) else f"status {r.status}"))
            continue
        problems = check_watch(w, page_text(r.text), base)
        print(f'[source-watch] {w["id"]}: ' + ("all rules hold" if not problems else f"{len(problems)} rule(s) no longer hold"))
        if problems:
            findings.append(finding(w, problems))
    return findings, unreadable


# --- help_freshness (spec .claude/specs/help-resources.md Phase 2; owner order 2026-11-27) --------------------------------------------
# A watch {"town", "weekday", "rules": [{"kind": "help_freshness", "max_age_days": 45}]} checks every /help/ source of its town
# (scrapers/help_sources.SOURCES) once a week, on its weekday (UTC). Each source page is read ONCE (PoliteFetcher); its HTTP status
# and a hash of the page's visible text (help_sources.source_text: scripts and styles out, the same text the parser reads) go in
# help_source_checks. The stored hash is the hash of the last page that was re-read without a parse error, so:
#   unreadable (Refused, no answer, 403, 5xx)  no verdict: nothing changes (the age rule below still runs)
#   404 / 410                                  every row of the source -> gone (hidden); the hash is cleared, so the page is
#                                              re-read in full when it comes back
#   same hash                                  verified/stale rows: last verified = today, stale -> verified; queued rows: date
#                                              only (never published by this job); changed/gone rows: untouched. Monthly
#                                              patterns get their missing dated rows (today .. today + 8 weeks) from the parser.
#   new hash (or none stored)                  the parser runs again; hours and requirements are compared with the DB row.
#                                              Passes validation -> the row is rewritten (queued stays queued); fails ->
#                                              changed (hidden). A row the page no longer has -> gone. A parse error -> every
#                                              row changed, the old hash kept (re-read next week).
#   age                                        a verified row not verified within max_age_days -> stale (hidden)
#   season                                     a verified row past valid_to is hidden by help_places.is_visible; reported here,
#                                              status untouched (the status is about the source, not the season)
# A noisy page (a date in the footer) only costs a re-parse: an unchanged reading rewrites the same row.
HELP_KIND = "help_freshness"
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
GONE_STATUSES = (404, 410)


def is_help_watch(watch: dict) -> bool:
    return any(r.get("kind") == HELP_KIND for r in watch.get("rules", []))


def due(watch: dict, today) -> bool:
    return WEEKDAYS[today.weekday()] == watch["weekday"]


def _max_age(watch: dict) -> int:
    from db import help_places as hp
    return next((r.get("max_age_days", hp.MAX_AGE_DAYS) for r in watch["rules"] if r["kind"] == HELP_KIND), hp.MAX_AGE_DAYS)


def page_hash(pages: dict) -> str:
    """sha256 of the source's pages' visible text, in the order given (url -> body bytes)."""
    import hashlib
    from scrapers.help_sources import source_text
    return hashlib.sha256("\n\f\n".join(source_text(b) for b in pages.values()).encode("utf-8")).hexdigest()


def classify_fetch(res: dict) -> tuple[str, int | None, str]:
    """('ok' | 'gone' | 'unreadable', http status, note) for one source's pages (url -> Fetched | Refused). Gone wins over
    unreadable: a 404 is an answer."""
    from scrapers.polite_fetch import Refused
    verdict, status, notes = "ok", 200, []
    for url, r in res.items():
        if isinstance(r, Refused):
            notes.append(f"{url}: {r.reason}")
            if verdict == "ok":
                verdict, status = "unreadable", None
        elif r.status in GONE_STATUSES:
            notes.append(f"{url}: status {r.status}")
            verdict, status = "gone", r.status
        elif r.status != 200:
            notes.append(f"{url}: " + ("no answer" if r.status is None else f"status {r.status}"))
            if verdict == "ok":
                verdict, status = "unreadable", r.status
    return verdict, status, "; ".join(notes)


def _hm(t) -> str | None:
    return None if t is None else (t.strftime("%H:%M") if hasattr(t, "strftime") else str(t)[:5])


def row_key(parsed, resolve_role=None) -> tuple | None:
    if parsed.role:
        pid = resolve_role(parsed) if resolve_role else None
        return None if pid is None else ("role", pid, parsed.role)
    return ("place", parsed.entry.slug)


def row_from_parsed(parsed, row_id: int, status: str, verified, today, place_id: int | None = None) -> dict:
    """A DB row as the job reads it, built from a parse (tests; the same shape load_help_rows returns)."""
    e = parsed.entry
    if parsed.role:   # a role keeps its times as text (place_roles.schedule_text); the place's own hours are the venue's
        return {"key": ("role", place_id, parsed.role), "id": row_id, "status": status, "verified_date": verified,
                "valid_to": e.valid_to, "requirements_note": e.requirements_note, "weekly": (), "dates": (),
                "schedule_text": parsed.hours_text}
    return {"key": ("place", e.slug), "id": row_id, "status": status,
            "verified_date": verified, "valid_to": e.valid_to, "requirements_note": e.requirements_note,
            "weekly": tuple(sorted((d, _hm(o), _hm(c)) for d, o, c in parsed.weekly)),
            "dates": tuple(sorted((d, _hm(o), _hm(c)) for d, o, c in parsed.dates if d >= today)),
            "schedule_text": None}


def bumped_status(status: str) -> str:
    return "verified" if status == "stale" else status


def _hours_line(weekly, dates) -> str:
    from scrapers.help_sources import _DOW
    parts = [f"{_DOW[d]} {o}-{c}" for d, o, c in weekly]
    parts += [f"{d.isoformat()}" + (f" {o}-{c}" if o and c else "") for d, o, c in dates]
    return ", ".join(parts) or "(none)"


def _diff(row: dict, parsed, today) -> list[str]:
    new = row_from_parsed(parsed, row["id"], row["status"], None, today)
    out = []
    if (row["weekly"], row["dates"]) != (new["weekly"], new["dates"]):
        out.append(f"hours {_hours_line(row['weekly'], row['dates'])} -> {_hours_line(new['weekly'], new['dates'])}")
    if row.get("requirements_note") != new["requirements_note"]:
        out.append(f"requirements {row.get('requirements_note') or '(none)'} -> {new['requirements_note'] or '(none)'}")
    if parsed.role and row.get("schedule_text") != new["schedule_text"]:
        out.append(f"schedule {row.get('schedule_text')!r} -> {new['schedule_text']!r}")
    return out


@dataclass
class HelpPlan:
    source_id: str
    town_id: str
    url: str
    fetch: str
    http_status: int | None
    note: str
    page_hash: str | None
    page_changed: bool = False
    hash_action: str = "keep"   # keep | store | clear
    actions: list = field(default_factory=list)
    # ('bump', key) ('status', key, new) ('write', key | None, parsed, status) ('extend', key, [(date, opens, closes)]) ('expired', key)
    lines: list = field(default_factory=list)


def _name(key) -> str:
    return key[1] if key[0] == "place" else f"{key[2]} on place {key[1]}"


def plan_help_source(src, res: dict, stored_hash: str | None, rows: list[dict], today, max_age_days: int | None = None,
                     resolve_role=None) -> HelpPlan:
    """What the freshness check does to one source's rows. Pure: res = url -> Fetched | Refused, rows = the DB rows of this
    source (load_help_rows). resolve_role(parsed) -> the place id a role row belongs on, or None."""
    from db import help_places as hp
    from scrapers import help_sources as hs
    max_age = hp.MAX_AGE_DAYS if max_age_days is None else max_age_days
    fetch, status, note = classify_fetch(res)
    pages = {u: res[u].body for u in src.fixtures if u in res and fetch == "ok"}
    p = HelpPlan(src.id, src.town_id, src.url, fetch, status, note, page_hash(pages) if fetch == "ok" else None)
    by_key = {r["key"]: r for r in rows}
    touched: set = set()

    def status_to(key, new, why):
        if by_key[key]["status"] != new:
            p.actions.append(("status", key, new))
            p.lines.append(f"{new.upper():8} {_name(key)}: {why}")
        touched.add(key)

    if fetch == "gone":
        p.hash_action = "clear"
        for r in rows:
            status_to(r["key"], "gone", note)
    elif fetch == "ok" and p.page_hash == stored_hash:
        parsed = {}
        try:
            parsed = {row_key(x, resolve_role): x for x in hs.parse(src, pages, today)}
        except hs.ParseError as exc:   # cannot happen on the page that was read before; reported, rows only bumped
            p.lines.append(f"unchanged page, but parse error for the dates: {exc}")
        for r in rows:
            if r["status"] not in ("verified", "stale", "queued"):
                continue
            p.actions.append(("bump", r["key"]))
            touched.add(r["key"])
            x = parsed.get(r["key"])
            have = {d for d, _, _ in r["dates"]}
            new = [(d, _hm(o), _hm(c)) for d, o, c in (x.dates if x else ()) if d >= today and d not in have]
            if new:
                p.actions.append(("extend", r["key"], new))
                p.lines.append(f"EXTEND   {_name(r['key'])}: " + ", ".join(d.isoformat() for d, _, _ in new))
    elif fetch == "ok":
        p.page_changed = True
        try:
            parsed = hs.parse(src, pages, today)
        except hs.ParseError as exc:
            p.lines.append(f"parse error: {exc}")
            for r in rows:
                if r["status"] not in ("gone",):
                    status_to(r["key"], "changed", f"parse error: {exc}")
            parsed = None
        if parsed is not None:
            p.hash_action = "store"
            seen = set()
            for x in parsed:
                key = row_key(x, resolve_role)
                if x.role and key is None:
                    p.lines.append(f"role {x.entry.name}: no single place to put it on; not written")
                    continue
                seen.add(key)
                r = by_key.get(key)
                if x.decision == "reject":
                    if r is not None:
                        status_to(key, "changed", x.why)
                    else:
                        p.lines.append(f"new row rejected {x.entry.name}: {x.why}")
                    continue
                new_status = "queued" if x.decision == "queue" or (r and r["status"] == "queued") else "verified"
                p.actions.append(("write", key if r else None, x, new_status))
                touched.add(key)
                if r is None:
                    p.lines.append(f"NEW      {x.entry.name} ({new_status})")
                else:
                    d = _diff(r, x, today)
                    p.lines.append(f"{'UPDATE' if d else 'REREAD':8} {_name(key)} ({new_status}): "
                                   + ("; ".join(d) if d else "same hours and requirements"))
            for r in rows:
                if r["key"] not in seen and r["status"] != "gone":
                    status_to(r["key"], "gone", "no longer on the page")
    # age and season, on the rows nothing above has re-verified
    for r in rows:
        if r["key"] in touched or r["status"] != "verified":
            continue
        vd = r.get("verified_date")
        if vd is None or (today - vd).days > max_age:
            status_to(r["key"], "stale", f"not verified since {vd} (over {max_age} days)")
        elif r.get("valid_to") and r["valid_to"] < today:
            p.actions.append(("expired", r["key"]))
            p.lines.append(f"EXPIRED  {_name(r['key'])}: season ended {r['valid_to']} (hidden by valid_to)")
    return p


def load_help_rows(cur, src, today) -> tuple[list[dict], str | None, list]:
    """(rows of this source, stored hash or None, the town's places for role placement). Read-only."""
    from db import help_places as hp
    cur.execute("SELECT id, slug, verification_status, verified_date, valid_to, requirements_note FROM places "
                "WHERE town_id = %s AND source_url = %s AND category = ANY(%s) ORDER BY id",
                (src.town_id, src.url, list(hp.HELP_CATEGORIES)))
    places = cur.fetchall()
    hours: dict = {}
    if places:
        # open days only, as the parser gives them: a day without a time is open only with time_unknown (migration 079); a
        # null/null row without it means closed (help places keep closures in place_hours_exceptions, so none is expected)
        cur.execute("SELECT place_id, day_of_week, opens, closes, valid_from FROM place_hours WHERE place_id = ANY(%s) AND (opens IS NOT NULL OR time_unknown)",
                    ([r[0] for r in places],))
        for pid, dow, o, c, vf in cur.fetchall():
            hours.setdefault(pid, []).append((dow, _hm(o), _hm(c), vf))
    rows = []
    for pid, slug, st, vd, vt, req in places:
        hs_ = hours.get(pid, [])
        rows.append({"key": ("place", slug), "id": pid, "status": st, "verified_date": vd, "valid_to": vt, "requirements_note": req,
                     "weekly": tuple(sorted((d, o, c) for d, o, c, vf in hs_ if vf is None)),
                     "dates": tuple(sorted((vf, o, c) for d, o, c, vf in hs_ if vf is not None and vf >= today)),
                     "schedule_text": None})
    cur.execute("SELECT pr.id, pr.place_id, pr.role, pr.verification_status, pr.verified_date, pr.valid_to, pr.requirements_note, "
                "pr.schedule_text FROM place_roles pr JOIN places p ON p.id = pr.place_id WHERE p.town_id = %s AND pr.source_url = %s",
                (src.town_id, src.url))
    for rid, pid, role, st, vd, vt, req, sched in cur.fetchall():
        rows.append({"key": ("role", pid, role), "id": rid, "status": st, "verified_date": vd, "valid_to": vt,
                     "requirements_note": req, "weekly": (), "dates": (), "schedule_text": sched})
    stored = None
    cur.execute("SELECT to_regclass('help_source_checks') IS NOT NULL")
    if cur.fetchone()[0]:
        cur.execute("SELECT section_hash FROM help_source_checks WHERE source_id = %s", (src.id,))
        got = cur.fetchone()
        stored = got[0] if got else None
    cur.execute("SELECT id, slug, name, category, coalesce(address, '') FROM places WHERE town_id = %s", (src.town_id,))
    return rows, stored, cur.fetchall()


def role_resolver(town_places):
    from scrapers.help_sources import role_target

    def resolve(parsed):
        try:
            return role_target(parsed, town_places)[0]
        except ValueError:
            return None
    return resolve


def apply_help_plan(cur, p: HelpPlan, rows_by_key: dict, today) -> None:
    """Write one source's plan (the job's write mode; CI, or local with --prod + ALLOW_PROD_WRITE=watch_sources)."""
    from db import help_places as hp
    cats = list(hp.HELP_CATEGORIES)
    for a in p.actions:
        kind, key = a[0], a[1]
        r = rows_by_key.get(key)
        if kind == "bump":
            sql = ("UPDATE places SET verified_date = %s, verification_status = CASE WHEN verification_status = 'stale' "
                   "THEN 'verified' ELSE verification_status END, updated_at = now() WHERE id = %s AND category = ANY(%s)"
                   if key[0] == "place" else
                   "UPDATE place_roles SET verified_date = %s, verification_status = CASE WHEN verification_status = 'stale' "
                   "THEN 'verified' ELSE verification_status END WHERE id = %s")
            cur.execute(sql, (today, r["id"], cats) if key[0] == "place" else (today, r["id"]))
        elif kind == "status":
            if key[0] == "place":
                cur.execute("UPDATE places SET verification_status = %s, updated_at = now() WHERE id = %s AND category = ANY(%s)",
                            (a[2], r["id"], cats))
            else:
                cur.execute("UPDATE place_roles SET verification_status = %s WHERE id = %s", (a[2], r["id"]))
        elif kind == "write":
            parsed, status = a[2], a[3]
            e = parsed.entry
            if parsed.role:
                hp.write_role(cur, (key or row_key(parsed))[1], parsed.role, e, today, status=status, schedule_text=parsed.hours_text)
                continue
            hp.write_entry(cur, e, today, status=status)
            cur.execute("SELECT id FROM places WHERE town_id = %s AND slug = %s", (e.town_id, e.slug))
            hp.write_schedule(cur, cur.fetchone()[0], parsed.weekly, parsed.dates, parsed.closed, e.source_url, today)
        elif kind == "extend":
            for d, o, c in a[2]:
                cur.execute("INSERT INTO place_hours (place_id, day_of_week, opens, closes, valid_from, valid_to, time_unknown) "
                            "VALUES (%s, %s, %s, %s, %s, %s, %s)", (r["id"], (d.weekday() + 1) % 7, o, c, d, d, o is None and c is None))
    keep = p.hash_action == "keep"
    cur.execute("INSERT INTO help_source_checks (source_id, town_id, url, http_status, note, section_hash, checked_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, now()) ON CONFLICT (source_id) DO UPDATE SET town_id = EXCLUDED.town_id, "
                "url = EXCLUDED.url, http_status = EXCLUDED.http_status, note = EXCLUDED.note, checked_at = now(), section_hash = "
                + ("help_source_checks.section_hash" if keep else "EXCLUDED.section_hash"),
                (p.source_id, p.town_id, p.url, p.http_status, p.note or None, p.page_hash if p.hash_action == "store" else None))


def run_help(watch: dict, fetcher_for, cur, today, write: bool = False) -> list[HelpPlan]:
    """Every /help/ source of the watch's town: read, plan, and (write=True) apply. cur reads the DB (and writes when write)."""
    from scrapers.help_sources import SOURCES
    plans = []
    for src in (s for s in SOURCES if s.town_id == watch["town"]):
        f = fetcher_for(src.town_id)
        res = {u: f.get(u) for u in src.fixtures}
        rows, stored, town_places = load_help_rows(cur, src, today)
        p = plan_help_source(src, res, stored, rows, today, _max_age(watch), role_resolver(town_places))
        if write:
            apply_help_plan(cur, p, {r["key"]: r for r in rows}, today)
        plans.append(p)
    return plans


class CacheOnly:
    """The dry run's fetcher: today's PoliteFetcher day cache (.cache/polite_fetch/<UTC date>/), never the network."""

    def __init__(self, day: str):
        from scrapers import polite_fetch as pf
        self.dir, self.pf = pf.CACHE_DIR / day, pf

    def get(self, url: str):
        meta = self.dir / (self.pf._sha(url.encode())[:32] + ".json")
        if not meta.is_file():
            return self.pf.Refused(url, f"not in the cache of {self.dir.name}")
        m = json.loads(meta.read_text(encoding="utf-8"))
        return self.pf.Fetched(url, m["final_url"], m["status"], meta.with_suffix(".body").read_bytes(), m.get("encoding"), True)


def print_help(watch: dict, plans: list[HelpPlan], stored_note: str = "") -> None:
    counts: dict = {}
    for p in plans:
        for a in p.actions:
            k = a[0] if a[0] != "status" else f"-> {a[2]}"
            counts[k] = counts.get(k, 0) + 1
    print(f"\n=== {watch['town']} (help check on {watch['weekday']}): {len(plans)} sources; "
          + (", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "no changes"))
    for p in plans:
        state = p.fetch if p.fetch != "ok" else ("page changed (re-read)" if p.page_changed else "page unchanged")
        print(f"  {p.source_id}: HTTP {p.http_status} {state}, hash {(p.page_hash or '-')[:12]} ({p.hash_action})"
              + (f"  [{p.note}]" if p.note else ""))
        for ln in p.lines:
            print(f"      {ln}")


def write_baseline(watch: dict, text: str, base: Path = ROOT) -> list[Path]:
    out: list[Path] = []
    for rule in watch["rules"]:
        if rule["kind"] != "unchanged":
            continue
        part = section(text, rule["from"], rule["to"])
        if part is None:
            raise SystemExit(f'{watch["id"]}: cannot find "{rule["from"]}" .. "{rule["to"]}" on the page')
        path = base / rule["baseline"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(part + "\n", encoding="utf-8")
        out.append(path)
    return out


def main_help(help_watches: list[dict], fetcher_for, today, write: bool) -> None:
    """The due help watches. write=False: the DB is only read (dry run). write=True: one transaction per town."""
    from db.db import connect
    conn = connect()
    try:
        for watch in help_watches:
            with conn.cursor() as cur:
                plans = run_help(watch, fetcher_for, cur, today, write=write)
            if write:
                conn.commit()
            else:
                conn.rollback()
            print_help(watch, plans)
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    from datetime import date, datetime, timezone
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--write-baseline", metavar="ID")
    ap.add_argument("--help-only", action="store_true", help="only the help_freshness watches")
    ap.add_argument("--all-towns", action="store_true", help="every town's help check, whatever its weekday")
    ap.add_argument("--from-cache", metavar="YYYY-MM-DD", help="dry run: read pages from that day's PoliteFetcher cache, no network")
    ap.add_argument("--today", type=date.fromisoformat, default=None)
    raw = sys.argv[1:] if argv is None else argv
    args = ap.parse_args([a for a in raw if a != "--prod"])   # db.db reads --prod from sys.argv (the write guard)
    if args.from_cache and not args.dry_run:
        ap.error("--from-cache is for --dry-run only")
    today = args.today or datetime.now(timezone.utc).date()
    from scrapers.polite_fetch import PoliteFetcher
    fetchers: dict[str, PoliteFetcher] = {}

    def fetcher_for(town: str):
        if args.from_cache:
            return fetchers.setdefault("cache", CacheOnly(args.from_cache))
        return fetchers.setdefault(town, PoliteFetcher("evidence", town))

    everything = load()
    help_watches = [x for x in everything if is_help_watch(x) and (args.all_towns or due(x, today))]
    watches = [x for x in everything if not is_help_watch(x)]
    if args.help_only:
        watches = []
    help_failed = 0
    if help_watches and not args.write_baseline:
        try:
            main_help(help_watches, fetcher_for, today, write=not args.dry_run)
        except Exception as exc:   # the page watches below still run; the run ends red (exit 1)
            print(f"[source-watch] help freshness failed: {exc.__class__.__name__}: {exc}", file=sys.stderr)
            help_failed = 1
    if args.help_only:
        return help_failed
    if args.write_baseline:
        w = next((x for x in watches if x["id"] == args.write_baseline), None)
        if w is None:
            print(f"no watch with id {args.write_baseline}", file=sys.stderr)
            return 2
        r = fetcher_for(w["town"]).get(w["url"])
        if getattr(r, "status", None) != 200:
            print(f"cannot read {w['url']}: {getattr(r, 'reason', None) or getattr(r, 'status', None)}", file=sys.stderr)
            return 1
        for p in write_baseline(w, page_text(r.text)):
            print(f"wrote {p.relative_to(ROOT)}")
        return 0

    findings, unreadable = run(watches, fetcher_for)
    for u in unreadable:
        print(f"[source-watch] unreadable, no verdict: {u}")
    if args.dry_run:
        for f in findings:
            print("FINDING", f["pattern"], "-", f["message"])
        print(f"[source-watch] dry run: {len(findings)} finding(s); no issue touched")
        return help_failed
    from qa.report import report
    repo, run_id = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_RUN_ID")
    # A page that could not be read says nothing: while any watch is unreadable, no open issue gets a "clean run" or is closed (new
    # findings and recurrences are handled as usual), so an unreadable page never counts as "the problem went away".
    clean = (lambda c: c == CHECK_ID) if not unreadable else (lambda c: False)
    try:
        report(findings, report_only=False, scope_towns={w["town"] for w in watches}, clean_to_close=3,
               run_url=f"https://github.com/{repo}/actions/runs/{run_id}" if repo and run_id else "", scope_checks=clean)
    except Exception as exc:  # pragma: no cover -- GitHub's API must not hide the result printed above
        print(f"[source-watch] issue reporting failed: {exc}", file=sys.stderr)
    return help_failed


if __name__ == "__main__":
    raise SystemExit(main())
