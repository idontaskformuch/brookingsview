"""Meta description audit over a built dist/ (owner 2026-11-03, Bing "too short"). Read-only.

Lists, per page type (first path segment + depth), the pages whose <meta name=description> is missing, under 120 or over
160 characters, or shared with another page in the same build. Only indexable pages (no noindex) count.
    python -m scripts.audit_descriptions site/dist
"""
from __future__ import annotations

import html
import re
import sys
from collections import defaultdict
from pathlib import Path

DESC = re.compile(r'<meta\s+name="description"\s+content="([^"]*)"', re.I)
ROBOTS = re.compile(r'<meta\s+name="robots"\s+content="([^"]*)"', re.I)


def page_type(rel: str) -> str:
    parts = [p for p in rel.strip("/").split("/") if p]
    if not parts:
        return "/"
    return parts[0] + ("/*" if len(parts) > 1 else "")


def scan(dist: Path) -> list[dict]:
    rows = []
    for f in sorted(dist.rglob("index.html")):
        rel = "/" + f.parent.relative_to(dist).as_posix() + "/" if f.parent != dist else "/"
        t = f.read_text(encoding="utf-8", errors="replace")
        r = ROBOTS.search(t)
        if r and "noindex" in r.group(1).lower():
            continue
        m = DESC.search(t)
        d = html.unescape(m.group(1)).strip() if m else ""
        rows.append({"path": rel, "type": page_type(rel), "desc": d})
    return rows


def main() -> int:
    rows = scan(Path(sys.argv[1]))
    seen = defaultdict(list)
    for r in rows:
        seen[r["desc"]].append(r["path"])
    bad = defaultdict(list)
    for r in rows:
        n = len(r["desc"])
        why = "missing" if n == 0 else "short" if n < 120 else "long" if n > 160 else ""
        if r["desc"] and len(seen[r["desc"]]) > 1:
            why = (why + "+dup").lstrip("+")
        if why:
            bad[r["type"]].append((why, n, r["path"]))
    print(f"{len(rows)} indexable pages; {sum(len(v) for v in bad.values())} with a problem")
    for t, items in sorted(bad.items(), key=lambda kv: -len(kv[1])):
        kinds = defaultdict(int)
        for w, _, _ in items:
            kinds[w] += 1
        print(f"\n{t}: {len(items)}  {dict(kinds)}  e.g. {items[0][2]} ({items[0][1]} chars)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
