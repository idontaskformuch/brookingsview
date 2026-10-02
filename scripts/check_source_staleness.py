"""Standalone CLI for scrapers/staleness.py -- see that module's own
docstring for the full "why" (diagnosing Moreno Valley's eSCRIBE meetings
gap found 2026-10-01: a scraper that runs and exits 'ok' every time while
the data it finds goes stale, which the existing consecutive-failures
alerting never catches).

Runs as its own scheduled workflow (.github/workflows/source-staleness-check.yml,
daily, one job per town via a matrix), not folded into runner.py's own
exit code and NOT a step inside scrape.yml/moval-scrape.yml/broomfield-scrape.yml
(where it originally lived, 2026-10-01 to 2026-10-02): a GitHub Actions
step's non-zero exit skips every step after it by default, so publish,
build, deploy would all be skipped for the ENTIRE town over one stale
source if this ran early in that job -- and running it LAST (if: always(),
the original placement) avoided that but meant a stale-source alert made a
genuinely successful scrape-and-publish run show the same red X as an
actually broken scraper, conflating two different failure classes in one
job's pass/fail. A separate daily workflow fails VISIBLY on its own (a red
X here really does mean "a source is stale") without touching either the
scrape or the deploy workflow's own status.

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
