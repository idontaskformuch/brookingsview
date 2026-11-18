"""Every town's scrape workflow maps the secrets its enabled sources need.

Born from glasgow-scrape.yml 2026-11-18 (qa/checks.json ci.scrape-workflow-env):
configs/glasgow.json enabled the Adzuna jobs source on 2026-10-22, but the
workflow's job-level env: never mapped ADZUNA_APP_ID/ADZUNA_APP_KEY, so every
CI run since logged "RuntimeError: ADZUNA_APP_ID/ADZUNA_APP_KEY saknas" (23
error rows in scrape_runs, jobs data frozen at the 22 Oct local write) while
the step stayed green. ALERT_WEBHOOK was missing too, so the alert never left
the log. The workflow files are read as text (no yaml dependency).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"


def job_env_keys(text: str) -> set[str]:
    """Keys of the job-level env: block (4-space indent, ends at steps:)."""
    m = re.search(r"^    env:\n(.*?)^    steps:", text, re.S | re.M)
    return set(re.findall(r"^      ([A-Z][A-Z0-9_]*):", m.group(1), re.M)) if m else set()


def scrape_workflow_for(town: str) -> Path | None:
    # The full scrape (scrape.yml, <town>-scrape.yml); closure-watch runs only one source with --only.
    for p in sorted(WORKFLOWS.glob("*scrape.yml")):
        if re.search(rf"scrapers\.runner --config configs/{re.escape(town)}\.json", p.read_text(encoding="utf-8")):
            return p
    return None


def required_keys(cfg: dict) -> set[str]:
    keys = {"ALERT_WEBHOOK"}
    for src in cfg.get("data_sources", {}).values():
        if isinstance(src, dict) and src.get("enabled") and src.get("parser") == "jobs_v1":
            keys |= {"ADZUNA_APP_ID", "ADZUNA_APP_KEY"}
    return keys


def test_glasgow_workflow_before_fix_is_caught():
    # The real env: block of glasgow-scrape.yml at b17ce73 (the 2026-11-17 23:00 run).
    before = (
        "    env:\n"
        "      DATABASE_URL: ${{ secrets.DATABASE_URL }}\n"
        "      MET_OFFICE_WARNINGS_API_KEY: ${{ secrets.MET_OFFICE_WARNINGS_API_KEY }}\n"
        "      MET_OFFICE_API_KEY: ${{ secrets.MET_OFFICE_API_KEY }}\n"
        "      SPORTMONKS_API_KEY: ${{ secrets.SPORTMONKS_API_KEY }}\n"
        "      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}\n"
        '      USER_AGENT:   "ViewMediaBot (+https://glasgowloop.co.uk/contact)"\n'
        "    steps:\n"
    )
    cfg = json.loads((ROOT / "configs" / "glasgow.json").read_text(encoding="utf-8"))
    assert required_keys(cfg) - job_env_keys(before) == {"ADZUNA_APP_ID", "ADZUNA_APP_KEY", "ALERT_WEBHOOK"}


def test_every_town_scrape_workflow_maps_its_secrets():
    missing = {}
    for cfg_path in sorted((ROOT / "configs").glob("*.json")):
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        wf = scrape_workflow_for(cfg_path.stem)
        if wf is None:
            continue
        lack = required_keys(cfg) - job_env_keys(wf.read_text(encoding="utf-8"))
        if lack:
            missing[wf.name] = sorted(lack)
    assert missing == {}
