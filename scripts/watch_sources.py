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

Generic on purpose: a later freshness check (the /help/ spec) adds its pages and rule kinds here, not a second job.

    python -m scripts.watch_sources                         # what the workflow runs: read, check, open/comment/close issues
    python -m scripts.watch_sources --dry-run               # read and print the findings; no issue
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--write-baseline", metavar="ID")
    args = ap.parse_args(argv)
    from scrapers.polite_fetch import PoliteFetcher
    fetchers: dict[str, PoliteFetcher] = {}

    def fetcher_for(town: str) -> PoliteFetcher:
        return fetchers.setdefault(town, PoliteFetcher("evidence", town))

    watches = load()
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
        return 0
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
