"""Standalone CLI for scrapers/staleness.py -- see that module's own
docstring for the full "why" (diagnosing Moreno Valley's eSCRIBE meetings
gap found 2026-10-01: a scraper that runs and exits 'ok' every time while
the data it finds goes stale, which the existing consecutive-failures
alerting never catches).

Deliberately a LAST, separate workflow step (same placement as
scripts/check_deployed_content.py), not folded into scrapers/runner.py's
own exit code: runner.py runs FIRST in each *-scrape.yml, and a GitHub
Actions step's non-zero exit skips every step after it by default --
publish, build, deploy would all be skipped for the ENTIRE town over one
stale source, which is a far worse outcome than the staleness itself. This
script fails the job VISIBLY (a red X, per the handoff's own ask) without
blocking anything that already ran.

Usage:
    python -m scripts.check_source_staleness --config configs/moreno_valley_ca.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from db.db import get_conn
from scrapers.staleness import report_and_alert


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", required=True)
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    with get_conn() as conn:
        fresh = report_and_alert(conn, cfg)
    return 0 if fresh else 1


if __name__ == "__main__":
    raise SystemExit(main())
