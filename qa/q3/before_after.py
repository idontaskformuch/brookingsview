"""Before/after for Q3 fixes: compare the findings stored from earlier runs (BEFORE) with a fresh run on the same paths (AFTER).

    python qa/q3/before_after.py --before qa/out/q3/2026-10-23 --before qa/out/q3/2026-10-23-broomfield-opus \
        --after qa/out/q3/after-sonnet --out qa/out/q3/after-sonnet/before_after.md

A BEFORE finding counts as RESOLVED when no AFTER finding on the same page shares enough words with it (same matching rule as the
model comparison: word overlap plus a bonus for the same checklist item). AFTER findings with no BEFORE match are NEW. Both runs
used a reviewer model, so a finding that merely moved in wording can show as resolved + new; read the lists, not only the counts.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

STOP = set("the a an of and or to in on for with is are was be it this that at by as from not no page pages shows show has have its their there which than then but".split())


def toks(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9']{3,}", s.lower()) if w not in STOP}


def reviewer_findings(page: dict) -> list[dict]:
    return [f for f in page["findings"] if f.get("source") in ("ai", "det") and "usable JSON" not in f["evidence"] and "unparsable" not in f["evidence"]]


def match(a: dict, pool: list[dict], used: set[int]) -> int | None:
    ta = toks(a["evidence"] + " " + a.get("cause", ""))
    best, score = None, 0.0
    for i, b in enumerate(pool):
        if i in used:
            continue
        tb = toks(b["evidence"] + " " + b.get("cause", ""))
        j = len(ta & tb) / max(1, len(ta | tb)) + (0.15 if str(b["check"]) == str(a["check"]) else 0)
        if j > score:
            best, score = i, j
    return best if score >= 0.22 else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--before", action="append", required=True)
    ap.add_argument("--after", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    before = {}
    for d in args.before:
        for p in json.loads(Path(d, "pages.json").read_text(encoding="utf-8"))["pages"]:
            before[(p["town"], p["path"])] = p
    after = {(p["town"], p["path"]): p for p in json.loads(Path(args.after, "pages.json").read_text(encoding="utf-8"))["pages"]}
    lines = ["# Q3 before / after", "", "| Town | Page | Before (high/med/low) | After (high/med/low) | Resolved | New |", "|---|---|---|---|---|---|"]
    details = []
    tot_b = tot_a = tot_res = tot_new = 0
    for key in sorted(after):
        if key not in before:
            continue
        b, a = reviewer_findings(before[key]), reviewer_findings(after[key])
        used: set[int] = set()
        resolved = []
        for f in b:
            i = match(f, a, used)
            if i is None:
                resolved.append(f)
            else:
                used.add(i)
        new = [f for i, f in enumerate(a) if i not in used]
        cnt = lambda fs: "/".join(str(sum(1 for f in fs if f["severity"] == s)) for s in ("high", "medium", "low"))
        lines.append(f"| {key[0]} | {key[1]} | {cnt(b)} ({len(b)}) | {cnt(a)} ({len(a)}) | {len(resolved)} | {len(new)} |")
        tot_b += len(b); tot_a += len(a); tot_res += len(resolved); tot_new += len(new)
        details.append((key, resolved, new))
    lines += ["", f"**Total: {tot_b} findings before, {tot_a} after; {tot_res} resolved, {tot_new} new.**", ""]
    for (town, path), resolved, new in details:
        if not resolved and not new:
            continue
        lines.append(f"## {town} {path}")
        for f in resolved:
            if f["severity"] in ("high", "medium"):
                lines.append(f"- RESOLVED [{f['severity']}] {f['evidence'][:200]}")
        for f in new:
            if f["severity"] in ("high", "medium"):
                lines.append(f"- NEW [{f['severity']}] {f['evidence'][:200]}")
        lines.append("")
    Path(args.out).write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:4 + len(details) + 4]))


if __name__ == "__main__":
    main()
