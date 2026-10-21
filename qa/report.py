"""QA/watchdog reporting: hard findings -> GitHub issues (GitHub's own notification
mail is the alert; no ALERT_WEBHOOK needed), everything else -> run summary.

One issue per fingerprint (check + town + url pattern). Pure planning (`plan_actions`)
is separated from the GitHub I/O so it can be unit-tested.

Lifecycle:
  * new hard finding            -> create issue (labels qa-auto, qa-hard)
  * known finding again         -> nothing (no mail spam) -- unless the issue had clean-run
                                   comments in a row at the end, then one "recurred" comment
  * open issue, finding absent  -> "clean run" comment; after `clean_to_close` in a row -> close

QA_REPORT_ONLY=1 (the default until the owner turns it off after baseline triage) prints
what WOULD happen and touches nothing. The scrape watchdog passes report_only=False.

Env: GITHUB_TOKEN, GITHUB_REPOSITORY (set by Actions; workflow needs `issues: write`).

CLI:  python -m qa.report --in qa/out/brookings_sd.json [--summary-file $GITHUB_STEP_SUMMARY]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REGISTRY = json.loads((Path(__file__).parent / "checks.json").read_text(encoding="utf-8"))["checks"]
LABEL_AUTO = "qa-auto"
CLEAN_MARK = "<!-- qa-clean -->"
RECUR_MARK = "<!-- qa-recur -->"


def severity(check_id: str) -> str:
    return REGISTRY.get(check_id, {}).get("severity", "hard")


def url_pattern(path: str) -> str:
    """Collapse the variable tail of a URL so one broken template = one issue."""
    parts = [p for p in (path or "").split("?")[0].split("/") if p]
    return "/" + "/".join(parts[:1]) + ("/*" if len(parts) > 1 else "") if parts else "/"


def fingerprint(f: dict) -> str:
    key = f"{f['check']}|{f.get('town', '')}|{f.get('pattern') or url_pattern(f.get('path', ''))}"
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def group(findings: list[dict]) -> dict[str, dict]:
    """fingerprint -> {check, town, pattern, items: [finding...]} for hard findings only."""
    out: dict[str, dict] = {}
    for f in findings:
        if severity(f["check"]) != "hard":
            continue
        fp = fingerprint(f)
        g = out.setdefault(fp, {"check": f["check"], "town": f.get("town", ""),
                                "pattern": f.get("pattern") or url_pattern(f.get("path", "")), "items": []})
        g["items"].append(f)
    return out


def fp_of_body(body: str) -> str | None:
    m = re.search(r"<!-- qa-fp:([0-9a-f]{12}) -->", body or "")
    return m.group(1) if m else None


def render_issue(fp: str, g: dict, run_url: str = "") -> tuple[str, str]:
    title = f"[QA] {g['check']} — {g['town'] or 'all'} {g['pattern']} ({len(g['items'])} träff)"
    lines = [f"<!-- qa-fp:{fp} -->", f"**Kontroll:** `{g['check']}`  ", f"**Stad:** {g['town'] or '-'}  ",
             f"**Vad den fångar:** {REGISTRY.get(g['check'], {}).get('what', '')}  ",
             f"**Skapades av:** {REGISTRY.get(g['check'], {}).get('born_from', '')}", ""]
    for it in g["items"][:15]:
        lines.append(f"- {it.get('url') or it.get('path') or ''} — {it.get('message', '')}")
    if len(g["items"]) > 15:
        lines.append(f"- … och {len(g['items']) - 15} till")
    if run_url:
        lines += ["", f"Körning: {run_url}"]
    lines += ["", "Stängs automatiskt efter 3 rena körningar i rad. Waiver: `qa/known-issues.json`."]
    return title, "\n".join(lines)


def trailing_clean(comments: list[str]) -> int:
    n = 0
    for c in reversed(comments):
        if CLEAN_MARK in c:
            n += 1
        else:
            break
    return n


def plan_actions(findings: list[dict], open_issues: list[dict], clean_to_close: int = 3,
                 scope_towns: set[str] | None = None) -> list[dict]:
    """open_issues: [{number, body, comments: [str]}] already labelled qa-auto.
    scope_towns: only auto-close issues whose body names these fingerprints' towns -- the caller
    passes the set of towns that were actually checked this run, so a run for one town never
    closes another town's issue (fingerprint bodies carry the town)."""
    groups = group(findings)
    by_fp = {fp_of_body(i["body"]): i for i in open_issues if fp_of_body(i["body"])}
    actions: list[dict] = []
    for fp, g in groups.items():
        issue = by_fp.get(fp)
        if issue is None:
            title, body = render_issue(fp, g)
            actions.append({"op": "create", "fp": fp, "title": title, "body": body})
        elif trailing_clean(issue.get("comments", [])) > 0:
            actions.append({"op": "comment", "number": issue["number"], "body": f"{RECUR_MARK}Felet är tillbaka ({len(g['items'])} träff)."})
    for fp, issue in by_fp.items():
        if fp in groups:
            continue
        town_m = re.search(r"\*\*Stad:\*\* (\S+)", issue["body"])
        town = town_m.group(1) if town_m else ""
        if scope_towns is not None and town not in scope_towns:
            continue
        n = trailing_clean(issue.get("comments", [])) + 1
        if n >= clean_to_close:
            actions.append({"op": "close", "number": issue["number"], "body": f"{CLEAN_MARK}Ren körning ({n}/{clean_to_close}) — stänger."})
        else:
            actions.append({"op": "comment", "number": issue["number"], "body": f"{CLEAN_MARK}Ren körning ({n}/{clean_to_close})."})
    return actions


# ---------------------------------------------------------------- GitHub I/O

def _gh(method: str, path: str, token: str, repo: str, payload: dict | None = None):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}{path}", method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "qa-report"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read()
        return json.loads(body) if body else None


def load_open_issues(token: str, repo: str) -> list[dict]:
    issues = _gh("GET", f"/issues?state=open&labels={LABEL_AUTO}&per_page=100", token, repo) or []
    out = []
    for i in issues:
        if "pull_request" in i:
            continue
        cs = _gh("GET", f"/issues/{i['number']}/comments?per_page=100", token, repo) or []
        out.append({"number": i["number"], "body": i.get("body") or "", "comments": [c["body"] for c in cs]})
    return out


def apply_actions(actions: list[dict], token: str, repo: str, run_url: str = "") -> None:
    for a in actions:
        if a["op"] == "create":
            body = a["body"] + (f"\n\nKörning: {run_url}" if run_url else "")
            r = _gh("POST", "/issues", token, repo, {"title": a["title"], "body": body, "labels": [LABEL_AUTO, "qa-hard"]})
            print(f"  [qa-report] created #{r['number']}: {a['title']}")
        else:
            _gh("POST", f"/issues/{a['number']}/comments", token, repo, {"body": a["body"]})
            if a["op"] == "close":
                _gh("PATCH", f"/issues/{a['number']}", token, repo, {"state": "closed", "state_reason": "completed"})
            print(f"  [qa-report] #{a['number']} {a['op']}")


def report(findings: list[dict], *, report_only: bool, scope_towns: set[str] | None = None,
           clean_to_close: int = 3, run_url: str = "") -> list[dict]:
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if report_only or not (token and repo):
        actions = plan_actions(findings, [], clean_to_close, scope_towns)
        why = "QA_REPORT_ONLY" if report_only else "no GITHUB_TOKEN/GITHUB_REPOSITORY"
        for a in actions:
            print(f"  [qa-report] ({why}) would {a['op']}: {a.get('title') or a.get('body')}")
        return actions
    actions = plan_actions(findings, load_open_issues(token, repo), clean_to_close, scope_towns)
    apply_actions(actions, token, repo, run_url)
    return actions


def summary_md(res: dict) -> str:
    by: dict[str, int] = {}
    for f in res["findings"]:
        by[f["check"]] = by.get(f["check"], 0) + 1
    rows = "\n".join(f"| `{c}` | {severity(c)} | {n} |" for c, n in sorted(by.items())) or "| (inga) | | |"
    return (f"### QA {res['town']}\n{res['pages']} sidor, {res['links_checked']} extra länkar, "
            f"{res['requests_total']} förfrågningar (UA `{res['user_agent']}`, bypass-header: {res['bypass_header']}).\n\n"
            f"| kontroll | allvar | antal |\n|---|---|---|\n{rows}\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--summary-file")
    args = ap.parse_args()
    res = json.loads(Path(args.inp).read_text(encoding="utf-8"))
    report_only = os.environ.get("QA_REPORT_ONLY", "1") != "0"
    run_url = ""
    if os.environ.get("GITHUB_RUN_ID") and os.environ.get("GITHUB_REPOSITORY"):
        run_url = f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    md = summary_md(res)
    print(md)
    if args.summary_file:
        with open(args.summary_file, "a", encoding="utf-8") as fh:
            fh.write(md + "\n")
    report(res["findings"], report_only=report_only, scope_towns={res["town"]}, run_url=run_url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
